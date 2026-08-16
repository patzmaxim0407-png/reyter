/* ============================================================
   REYTER — звірка складу з журналом руху
   ------------------------------------------------------------
   Питання просте: чи те, що лежить на полиці, дорівнює тому, що
   написано в журналі. Відповіді на нього не було ніде — а без
   неї «залишки правильні» лишається справою віри.

   ЯК ЦЕ ПРАЦЮЄ. Кожна зміна залишку пише рядок у stock_moves:
   прихід, продаж, повернення, списання, коригування. Отже сума
   всіх рухів товару має дорівнювати його теперішньому залишку —
   але ЛИШЕ якщо журнал знає всю його історію.

   ДЕ ТУТ ПАСТКА. Товар, залишок якого колись проставили руками
   в картці, у журналі не має свого початку. Його сума завжди
   вийде меншою за полицю — і це не поломка, а просто відсутній
   початок відліку. Плутати ці два випадки не можна: у першому
   треба шукати помилку, у другому — ні.

   Тому кожен товар маркується: чи покриває журнал усе його
   життя. Ознака — найперший рух у журналі. Якщо це прихід або
   коригування вгору, історія почалась при нас, і розбіжність
   означає справжню втрату. Якщо перший рух — продаж, товар уже
   лежав на полиці до журналу, і різницю пояснює саме він.
   ============================================================ */

import {
  hasInvDoc,
  invOf,
  isSized,
  moveDate,
  sizeQty,
  totalQty,
  type Move,
  type StockState
} from './stock';

/** Скільки товару каже журнал і скільки лежить насправді. */
export interface Check {
  id: string;
  name: string;
  /** Сума всіх рухів у журналі. */
  logged: number;
  /** Що зараз на полиці. */
  shelf: number;
  /** shelf − logged. Нуль — усе сходиться. */
  diff: number;
  /** Чи знає журнал початок цього товару. */
  covered: boolean;
  /** Скільки рухів знайшлось. */
  moves: number;
  /** Різниці по розмірах — щоб було видно, де саме розійшлось. */
  bySize: { size: string; logged: number; shelf: number; diff: number }[];
  /** Коли товар востаннє рухався. */
  last: Date | null;
}

export interface AuditResult {
  rows: Check[];
  /** Товари, у яких журнал знає все й числа розійшлись, — саме
   *  вони й потребують уваги. */
  broken: Check[];
  /** Товари без початку в журналі: різницю пояснює те, що було
   *  до нього. */
  partial: Check[];
  ok: number;
  /** Рухи, що вказують на товар, якого вже немає в каталозі. */
  orphans: number;
}

/** Рухи, які додають товар на полицю. Саме з такого руху
 *  починається життя товару, що заведений уже при журналі. */
function isIncoming(m: Move): boolean {
  const r = String(m.reason || '');
  return r === 'restock' || (r === 'manual' && (Number(m.delta) || 0) > 0);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Звірити все, що ведеться.
 *
 *  moves — журнал ЦІЛКОМ, від першого запису. Обрізаний журнал
 *  дасть розбіжність у кожного товару, і звірка перетвориться
 *  на шум. */
export function reconcile(s: StockState, moves: Move[], all = true): AuditResult {
  const byProduct = new Map<string, Move[]>();
  const known = new Set(s.products.map((p) => String(p.id)));
  let orphans = 0;

  for (const m of moves) {
    const id = String(m.productId || '');
    if (!id) continue;
    if (!known.has(id)) {
      orphans += 1;
      continue;
    }
    const box = byProduct.get(id);
    if (box) box.push(m);
    else byProduct.set(id, [m]);
  }

  const rows: Check[] = [];

  for (const p of s.products) {
    /* Комплект власних штук не має — його «залишок» рахується
       складниками, і звіряти там нічого. */
    if (Array.isArray(p.set) && p.set.length) continue;
    if (!hasInvDoc(s, p.id)) continue;

    const mine = (byProduct.get(String(p.id)) || [])
      .slice()
      .sort((a, b) => (moveDate(a)?.getTime() ?? 0) - (moveDate(b)?.getTime() ?? 0));

    const logged = mine.reduce((n, m) => n + num(m.delta), 0);
    const shelf = totalQty(s, p);

    /* Початок історії. Найперший рух — прихід або коригування
       вгору? Тоді журнал знає все. */
    const first = mine[0];
    const covered = all && !!first && isIncoming(first);

    /* По розмірах — щоб було видно, де саме розійшлось: у сумі
       мінус три й плюс три взаємно ховаються. */
    const bySize: Check['bySize'] = [];
    if (isSized(p, s)) {
      const sizes = new Set<string>([
        ...Object.keys(invOf(s, p.id).sizes || {}),
        ...mine.map((m) => String(m.size || '')).filter(Boolean)
      ]);
      for (const size of [...sizes].sort()) {
        const inLog = mine
          .filter((m) => String(m.size || '') === size)
          .reduce((n, m) => n + num(m.delta), 0);
        const onShelf = sizeQty(s, p.id, size);
        bySize.push({ size, logged: inLog, shelf: onShelf, diff: onShelf - inLog });
      }
    }

    const lastMove = mine[mine.length - 1];
    rows.push({
      id: String(p.id),
      name: String(p.name || p.id),
      logged,
      shelf,
      diff: shelf - logged,
      covered,
      moves: mine.length,
      bySize,
      last: lastMove ? moveDate(lastMove) : null
    });
  }

  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name));

  return {
    rows,
    broken: rows.filter((r) => r.covered && r.diff !== 0),
    partial: rows.filter((r) => !r.covered && r.diff !== 0),
    ok: rows.filter((r) => r.diff === 0).length,
    orphans
  };
}

/* ============================================================
   ЧИ ЗБІГАЄТЬСЯ СПИСАННЯ З ЗАМОВЛЕННЯМИ
   ------------------------------------------------------------
   Друге питання, окреме від першого: за кожним виконаним
   замовленням мав піти рух «Замовлення» рівно на його склад.
   Якщо статус перемикали туди-сюди, у журналі лягли і списання,
   і повернення — і НЕТТО має дорівнювати мінус кількості
   замовлення. Нуль означає, що товар списали й повернули, а
   замовлення лишилось виконаним: полиця показує штуки, яких
   насправді немає.
   ============================================================ */

export interface OrderCheck {
  num: string;
  /** Скільки одиниць у замовленні. */
  want: number;
  /** Скільки насправді списалось за журналом (нетто, зі знаком). */
  got: number;
  /** want + got. Нуль — усе гаразд. */
  diff: number;
}

export interface SoldOrder {
  num?: string;
  status?: string;
  items?: Array<{ id?: string; qty?: number; size?: string }> | null;
}

/** Звірити виконані замовлення з журналом.
 *
 *  Береться лише те, що вже мало списатись: нове й скасоване
 *  замовлення складу не чіпає, і питати з нього нічого. */
export function checkOrders(orders: SoldOrder[], moves: Move[]): OrderCheck[] {
  const byRef = new Map<string, number>();
  for (const m of moves) {
    const r = String(m.reason || '');
    /* Лише те, що стосується замовлення: прихід і списання «на
       подарунок» до нього не мають відношення. */
    if (r !== 'order' && r !== 'order-cancel' && r !== 'order-return') continue;
    const ref = String(m.ref || '');
    if (!ref) continue;
    byRef.set(ref, (byRef.get(ref) || 0) + num(m.delta));
  }

  const out: OrderCheck[] = [];
  for (const o of orders) {
    const status = String(o.status || '');
    if (status !== 'confirmed' && status !== 'shipped' && status !== 'done') continue;
    const ref = String(o.num || '');
    if (!ref) continue;

    const want = (o.items || []).reduce((n, i) => n + num(i.qty), 0);
    const got = byRef.get(ref) ?? 0;
    out.push({ num: ref, want, got, diff: want + got });
  }

  return out.filter((x) => x.diff !== 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}
