/* ============================================================
   REYTER — випуск: один дроп від витрат до відбиття
   ------------------------------------------------------------
   Випуск — це те, як магазин думає насправді. Не «товар», а
   партія: пошили тканину, зняли зйомку, спакували, запустили
   рекламу — і з цього вийшло сто двадцять бріфів, вісімдесят
   білих і сорок сорочок. Собівартість кожного народжується тут,
   а не в картці товару.

   ЩО РОБИТЬ ЦЕЙ ФАЙЛ. Розкладає витрати випуску на товари й каже,
   скільки коштує одиниця кожного. Далі з цього постають приходи —
   і працює вже черга партій: що прийшло першим, те й продається
   першим.

   ПРЯМІ ВИТРАТИ І СПІЛЬНІ. Тканина на бріфи — пряма: вона лягає
   на бріфи цілком. Зйомка — спільна: її ділять усі. Як саме
   ділити, вирішує власник, і обидва способи чесні по-різному:

     за штуками — зйомка ділиться порівну на кожну річ. Просто й
       звично, але при 200 бріфах проти 40 сорочок бріфи візьмуть
       на себе 83% зйомки, хоч фотографували обидві речі;

     за моделями — зйомка ділиться на кількість ПОЗИЦІЙ. Чесніше
       саме для зйомки й контенту: знімають речі, а не тираж. Зате
       річ малого тиражу стає дорогою.

   ВІДБИТТЯ. Скільки з вкладеного вже повернулось. Продажі
   привʼязуємо до випуску не «за датою й товаром» — так у нього
   потрапили б і старі залишки, — а за собівартістю, замороженою
   в замовленні: черга партій віддає саме ту ціну, з якою партія
   стала в чергу. Збіглася — значить, продали цю партію.
   ============================================================ */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  where,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore
} from 'firebase/firestore';

import type { AdminOrder } from './orders';
import type { Catalogue } from '../catalog';
import { linesOf, soldOrders } from './insights';
import { spendOf, type CostLine, type Spend } from './pricing';
import {
  COSTS_COL,
  RESTOCKS_COL,
  emptyQueue,
  readQueue,
  restateQueue,
  unsoldOf,
  type CostQueue
} from './stock';

export const RELEASES_COL = 'releases';

export type Split = 'units' | 'models';

/** Що вийшло у випуску: товар і скільки одиниць. */
export interface ReleaseItem {
  productId: string;
  /** Кількості за розмірами — з них і постане прихід. */
  sizes?: Record<string, number>;
  /** Для товару без сітки. */
  qty?: number;
}

export interface Release {
  _id: string;
  title: string;
  /** Категорія, за якою калькулятор бере ціни й маржу магазину.
   *  Зберігається разом із випуском: інакше при поверненні до
   *  нього поради рахувались би по всьому каталогу, і три ціни
   *  щоразу виходили б інші. */
  category?: string;
  /** День випуску, YYYY-MM-DD. */
  at: string;
  lines: CostLine[];
  items: ReleaseItem[];
  split: Split;
  /** Приходи вже створені — щоб не зробити їх удруге. */
  restockedAt?: string;
  by?: string;
}

/** Скільки одиниць у позиції — з розмірів або числом. */
export function unitsOf(item: ReleaseItem): number {
  const sizes = item.sizes || {};
  const bySize = Object.keys(sizes).reduce((n, k) => n + Math.max(0, Math.round(Number(sizes[k]) || 0)), 0);
  return bySize || Math.max(0, Math.round(Number(item.qty) || 0));
}

export function totalUnits(items: ReleaseItem[]): number {
  return items.reduce((n, i) => n + unitsOf(i), 0);
}

/* ============================================================
   РОЗПОДІЛ
   ============================================================ */

export interface Share {
  productId: string;
  units: number;
  /** Пряме — тканина й пошив саме цієї речі. */
  direct: number;
  /** Частка спільного — зйомка, пакування партією. */
  shared: number;
  /** Що лягло в товар разом. */
  goods: number;
  /** Собівартість одиниці. */
  unit: number;
  /** Частка того, що відбивається окремо: реклама. У
   *  собівартість не входить. */
  apart: number;
}

export interface Plan {
  shares: Share[];
  /** Разом вкладено, включно з рекламою. */
  spend: Spend;
  units: number;
  /** Позицій у випуску. */
  models: number;
}

export function planOf(release: Pick<Release, 'lines' | 'items' | 'split'>): Plan {
  const items = release.items.filter((i) => unitsOf(i) > 0);
  const units = totalUnits(items);
  const models = items.length;
  const spend = spendOf(release.lines, units);

  const shares: Share[] = items.map((i) => ({
    productId: i.productId,
    units: unitsOf(i),
    direct: 0,
    shared: 0,
    goods: 0,
    unit: 0,
    apart: 0
  }));
  const at = new Map(shares.map((s) => [s.productId, s]));

  /* Спільні казани збираємо окремо: у товар і поза товаром. */
  let sharedGoods = 0;
  let sharedApart = 0;

  for (const l of release.lines) {
    const sum = Math.max(0, Math.round(Number(l.sum) || 0));
    if (!sum) continue;

    const mine = l.for ? at.get(l.for) : null;
    if (mine) {
      /* «За штуку» в прямій витраті рахується від штук САМЕ ЦІЄЇ
         речі, а не всього випуску: інакше пакування сорочок
         полічилось би за кількістю бріфів. */
      const total = l.perUnit ? sum * mine.units : sum;
      if (l.apart) mine.apart += total;
      else mine.direct += total;
      continue;
    }

    const total = l.perUnit ? sum * units : sum;
    if (l.apart) sharedApart += total;
    else sharedGoods += total;
  }

  /* Ділимо спільне. Ваги — або штуки, або позиції. */
  const weights = shares.map((s) => (release.split === 'models' ? 1 : s.units));
  const weight = weights.reduce((n, w) => n + w, 0) || 1;

  /* Останній забирає залишок: інакше сума часток після округлень
     не дорівнює тому, що витратили, і випуск «не відбивається» на
     кілька гривень вічно. */
  let leftGoods = sharedGoods;
  let leftApart = sharedApart;

  shares.forEach((s, i) => {
    const last = i === shares.length - 1;
    const partGoods = last ? leftGoods : Math.round((sharedGoods * weights[i]) / weight);
    const partApart = last ? leftApart : Math.round((sharedApart * weights[i]) / weight);
    leftGoods -= partGoods;
    leftApart -= partApart;

    s.shared = partGoods;
    s.apart += partApart;
    s.goods = s.direct + partGoods;
    s.unit = s.units ? Math.round(s.goods / s.units) : 0;
  });

  return { shares, spend, units, models };
}

/* ============================================================
   ВІДБИТТЯ
   ============================================================ */

export interface Payback {
  /** Скільки вкладено — товар і реклама разом. */
  spent: number;
  /** Скільки повернулось: виручка за проданими одиницями партії. */
  back: number;
  /** Скільки одиниць випуску вже продано. */
  sold: number;
  units: number;
  /** Частка повернутого, 0–1. */
  ratio: number;
}

/** Скільки з випуску вже повернулось.
 *
 *  Продажі привʼязуємо за СОБІВАРТІСТЮ, замороженою в замовленні.
 *  Черга партій віддає саме ту ціну, з якою партія стала в чергу,
 *  тож збіг ціни означає: продали одиницю саме цієї партії.
 *  Дата тут запасна умова — на випадок, коли дві партії вийшли за
 *  однаковою ціною.
 *
 *  Це не бухгалтерська точність, а чесне наближення, і воно
 *  чесніше за «усе продане після дати випуску»: у те число
 *  потрапив би й старий залишок. */
export function paybackOf(
  release: Release,
  plan: Plan,
  orders: AdminOrder[],
  c: Catalogue,
  now: Date
): Payback {
  const byId = new Map((c.products || []).map((p) => [String(p.id), p]));
  const mine = new Map(plan.shares.map((s) => [s.productId, s]));
  const from = new Date(release.at || 0);
  const sold = soldOrders(orders, Number.isNaN(from.getTime()) ? new Date(0) : from, now);

  let back = 0;
  let count = 0;

  for (const o of sold) {
    for (const l of linesOf(o, byId)) {
      const share = mine.get(l.id);
      if (!share) continue;
      const frozen = Math.round(Number(o.costs?.[l.id]) || 0);
      /* Ціна не збіглася — це інша партія того самого товару. */
      if (!frozen || Math.abs(frozen - share.unit) > 1) continue;
      back += l.paid;
      count += l.qty;
    }
  }

  const spent = plan.spend.total;
  return {
    spent,
    back,
    sold: count,
    units: plan.units,
    ratio: spent > 0 ? Math.min(9, back / spent) : 0
  };
}

/* ============================================================
   ПРИХОДИ З ВИПУСКУ
   ============================================================ */

export interface RestockDraft {
  productId: string;
  sizes?: Record<string, number>;
  qty?: number;
  cost: number;
  note: string;
}

/** Що саме створювати на складі. Собівартість уже порахована —
 *  її не треба набирати вдруге, і саме тому вона не розійдеться
 *  з випуском. */
export function restocksFrom(release: Release, plan: Plan): RestockDraft[] {
  const note = release.title ? 'Випуск: ' + release.title : 'Випуск';
  return plan.shares
    .filter((s) => s.units > 0 && s.unit > 0)
    .map((s) => {
      const item = release.items.find((i) => i.productId === s.productId);
      const sizes = item?.sizes && Object.keys(item.sizes).length ? item.sizes : undefined;
      return {
        productId: s.productId,
        ...(sizes ? { sizes } : { qty: s.units }),
        cost: s.unit,
        note
      };
    });
}


/* ============================================================
   ЗАПИС
   ============================================================ */

export async function loadReleases(db: Firestore): Promise<Release[]> {
  try {
    const snap = await getDocs(query(collection(db, RELEASES_COL), orderBy('at', 'desc')));
    return snap.docs.map((d) => ({ _id: d.id, ...(d.data() as Omit<Release, '_id'>) }));
  } catch {
    return [];
  }
}

export async function saveRelease(
  db: Firestore,
  by: string,
  release: Omit<Release, '_id'> & { _id?: string }
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const body = {
    title: release.title.trim() || 'Випуск',
    at: release.at,
    category: release.category || '',
    lines: release.lines.filter((l) => Number(l.sum) > 0 || l.title.trim()),
    items: release.items.filter((i) => unitsOf(i) > 0),
    split: release.split,
    ...(release.restockedAt ? { restockedAt: release.restockedAt } : {}),
    by
  };

  try {
    if (release._id) {
      await setDoc(doc(db, RELEASES_COL, release._id), body, { merge: true });
      return { ok: true, id: release._id };
    }
    const ref = await addDoc(collection(db, RELEASES_COL), { ...body, created: serverTimestamp() });
    return { ok: true, id: ref.id };
  } catch {
    return { ok: false, message: 'Не вдалося зберегти випуск' };
  }
}

export async function deleteRelease(db: Firestore, id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, RELEASES_COL, id));
    return true;
  } catch {
    return false;
  }
}

/** Створити приходи з випуску — по одному на товар, із уже
 *  порахованою собівартістю.
 *
 *  Однією пачкою: половина створених приходів гірша за жодного,
 *  бо друга половина створиться ще раз при повторній спробі. І
 *  сам випуск позначається — щоб кнопка не зробила їх удруге.
 *
 *  Приходи створюються НЕ оприбуткованими: партія стане в чергу
 *  тоді, коли товар справді приїде, а не коли його порахували. */
export async function makeRestocks(
  db: Firestore,
  by: string,
  release: Release,
  plan: Plan,
  names: Map<string, string>,
  now: Date
): Promise<{ ok: true; made: number } | { ok: false; message: string }> {
  const drafts = restocksFrom(release, plan);
  if (!drafts.length) return { ok: false, message: 'У випуску немає товарів із кількістю й ціною' };

  try {
    const batch = writeBatch(db);
    for (const d of drafts) {
      batch.set(doc(collection(db, RESTOCKS_COL)), {
        productId: d.productId,
        productName: names.get(d.productId) || d.productId,
        expected: release.at || now.toISOString().slice(0, 10),
        note: d.note,
        status: 'pending',
        cost: d.cost,
        /* Звідки прихід. За цим полем ми потім знайдемо і його, і
           його партію в черзі, коли витрати випуску уточнять. */
        releaseId: release._id,
        ...(d.sizes ? { items: d.sizes } : { qty: d.qty }),
        created: serverTimestamp(),
        by
      });
    }
    batch.set(
      doc(db, RELEASES_COL, release._id),
      { restockedAt: now.toISOString().slice(0, 10) },
      { merge: true }
    );
    await batch.commit();
    return { ok: true, made: drafts.length };
  } catch {
    return { ok: false, message: 'Не вдалося створити приходи' };
  }
}


/* ============================================================
   КОЛИ ВИТРАТИ УТОЧНИЛИ
   ------------------------------------------------------------
   Рахунок за фурнітуру приходить через три дні, реклама через
   два тижні. Собівартість випуску від цього змінюється — а
   приходи вже створені, партія вже, може, оприбуткована, і
   частину товару вже продали.

   ЩО МОЖНА, А ЧОГО НЕ МОЖНА.

   Продане не чіпаємо ніколи. У замовленні собівартість заморожена
   в мить продажу: вона була правдою тоді, і переписати її означало
   б переписати вже закритий місяць. Звіт, який змінюється заднім
   числом, — це не звіт.

   Прихід, який ще очікується,правимо цілком: він нічого нікому
   не сказав, у чергу не потрапив.

   Оприбуткована партія правиться в НЕПРОДАНОМУ залишку: ті
   одиниці ще лежать на складі, і саме вони підуть за новою ціною.

   Тому виправлення завжди часткове — і функція каже, чого саме
   вона торкнулась, щоб це не виглядало магією.
   ============================================================ */

export interface Restated {
  /** Приходів, які ще очікувались і тепер мають нову ціну. */
  pending: number;
  /** Одиниць у чергах, чия ціна змінилась. */
  unsold: number;
  /** Товарів, яких це торкнулось. */
  products: number;
}

export async function restateCosts(
  db: Firestore,
  release: Release,
  plan: Plan
): Promise<{ ok: true; done: Restated } | { ok: false; message: string }> {
  if (!release._id) return { ok: false, message: 'Випуск ще не збережено' };

  const done: Restated = { pending: 0, unsold: 0, products: 0 };

  try {
    /* Спершу читаємо все, потім пишемо: у Firestore пакет не
       вміє читати після запису, та й помилка на середині лишила
       б половину партій за старою ціною. */
    const restocks = await getDocs(
      query(collection(db, RESTOCKS_COL), where('releaseId', '==', release._id))
    );

    const queues = new Map<string, CostQueue>();
    for (const s of plan.shares) {
      queues.set(s.productId, await readQueue({ db }, s.productId));
    }

    const batch = writeBatch(db);

    for (const share of plan.shares) {
      if (!share.unit) continue;
      let touched = false;

      /* Приходи, які ще не оприбуткували. */
      for (const d of restocks.docs) {
        const r = d.data() as { productId?: string; status?: string; cost?: number };
        if (String(r.productId || '') !== share.productId) continue;
        if (r.status === 'received') continue;
        if (Math.round(Number(r.cost) || 0) === share.unit) continue;
        batch.update(d.ref, { cost: share.unit });
        done.pending += 1;
        touched = true;
      }

      /* І непроданий залишок у черзі. */
      const queue = queues.get(share.productId) || emptyQueue();
      const left = unsoldOf(queue, release._id);
      if (left > 0) {
        const next = restateQueue(queue, release._id, share.unit);
        batch.set(doc(db, COSTS_COL, share.productId), next);
        done.unsold += left;
        touched = true;
      }

      if (touched) done.products += 1;
    }

    await batch.commit();
    return { ok: true, done };
  } catch {
    return { ok: false, message: 'Не вдалося оновити партії' };
  }
}
