/* ============================================================
   REYTER — аналітика магазину
   ------------------------------------------------------------
   Чисті підрахунки, без React і без бази. Сюди приходять
   замовлення й каталог, звідси виходять числа — тому кожне з них
   можна перевірити прогоном, а не покладатися на екран.

   ЩО ВВАЖАЄТЬСЯ ПРОДАЖЕМ. Тільки виконані замовлення. Не нові, не
   підтверджені, не відправлені: доки посилку не забрали, вона
   може повернутись, а звіт, який рахує невикуплене як виручку,
   бреше саме там, де ціна помилки найбільша — у рішенні «чого
   закупити більше».

   Скасовані рахуються окремо: це не втрачені гроші, а міра того,
   скільки роботи йде в нікуди.

   ЗВІДКИ БЕРЕТЬСЯ МАРЖА. З собівартості, ЗАМОРОЖЕНОЇ В
   ЗАМОВЛЕННІ в мить продажу. Ціни закупівлі змінюються — інша
   партія, інший курс, — і якби звіт брав сьогоднішнє число, то
   кожна правка в картці товару переписувала б і минулий рік.
   Прибуток за березень не має ставати іншим від того, що в
   травні подорожчала тканина.

   Замовленням, закритим до появи цього поля, лишається запасний
   шлях — сьогоднішня собівартість із каталогу. Це наближення, і
   екран про нього не мовчить.

   Товарам без собівартості маржа не вигадується взагалі: вони
   рахуються окремо, а екран каже, для якої частки виручки її
   взагалі пораховано. «Приблизна маржа» гірша за відсутню — за
   нею ухвалять рішення.

   ЧОМУ BCG САМЕ ТАКА. Класична матриця ділить товари за часткою
   ринку й темпом його зростання — чисел, яких у магазину немає й
   бути не може. Тому осі тут ті, що в нього є: скільки штук
   продано і скільки грошей це принесло. Межі — МЕДІАНИ, а не
   середні: одна «Тоні Пепероні» з шістдесятьма тисячами зсуває
   середнє так, що половина полиці опиняється «нижче середнього»
   без жодної на те причини.
   ============================================================ */

import type { AdminOrder } from './orders';
import type { Catalogue } from '../catalog';
import type { Product } from '../types';

/** Замовлення, які вважаються продажем. */
const SOLD = 'done';

export interface Money {
  /** Скільки заплатили за товари, без доставки й після знижок. */
  revenue: number;
  /** Скільки з цього — маржа. Лише за товарами з собівартістю. */
  margin: number;
  /** Скільки штук. */
  qty: number;
}

export interface Kpi extends Money {
  orders: number;
  /** Середній чек за товарами. */
  average: number;
  /** Скільки грошей віддано знижками. */
  discounts: number;
  /** Скільки замовлень скасовано й на яку суму. */
  cancelled: number;
  cancelledSum: number;
  /** Частка виручки, покрита собівартістю: наскільки маржі
   *  взагалі можна вірити. */
  covered: number;
  /** Скільки покупців і скільки з них повернулись. */
  buyers: number;
  repeat: number;
}

export interface Point {
  /** ISO-день або місяць. */
  at: string;
  revenue: number;
  margin: number;
  orders: number;
}

export interface Row extends Money {
  id: string;
  name: string;
  category: string;
  /** Скільки замовлень містили цей товар. */
  orders: number;
  /** Ціна й собівартість — щоб було видно, звідки маржа. */
  price: number;
  cost: number | null;
  /** Виручка, за якою собівартість ВІДОМА. Маржа рахується лише
   *  з неї, тож без цього числа не можна ні показати витрати, ні
   *  сказати, наскільки маржі вірити. */
  costed: number;
  /** Частка у виручці, 0–1. */
  share: number;
}

export type Quadrant = 'star' | 'cow' | 'question' | 'dog';

export interface BcgPoint extends Row {
  quadrant: Quadrant;
  /** Вісь X: маржа на одиницю, коли собівартість відома;
   *  інакше ціна. Що саме — каже поле `axis`. */
  x: number;
  y: number;
}

export interface Bcg {
  points: BcgPoint[];
  /** Межі — медіани. */
  midX: number;
  midY: number;
  axis: 'margin' | 'price';
  /** Скільки товарів у кожній чверті. */
  counts: Record<Quadrant, number>;
}

export const QUADRANTS: Record<Quadrant, { title: string; hint: string }> = {
  star: {
    title: 'Зірки',
    hint: 'беруть часто й заробляють добре — тримати на видноті й не давати закінчуватись'
  },
  cow: {
    title: 'Робочі конячки',
    hint: 'беруть часто, але заробляють мало — сюди дивитись у бік ціни або закупівлі'
  },
  question: {
    title: 'Загадки',
    hint: 'заробляють добре, але їх майже не беруть — варто спробувати показати краще'
  },
  dog: {
    title: 'Баласт',
    hint: 'і рідко, і мало — місце на полиці коштує дорожче'
  }
};

/* ============================================================
   ЩО САМЕ ПРОДАЛОСЬ
   ============================================================ */

export interface SoldLine {
  id: string;
  name: string;
  category: string;
  qty: number;
  /** Ціна рядка після знижки замовлення, пропорційно. */
  paid: number;
  cost: number | null;
}

/** Рядки одного замовлення з уже розкиданою знижкою.
 *
 *  Знижку розкидаємо пропорційно вартості рядка — так само, як це
 *  робить банк у кошику. Інакше товар, на який дали промокод,
 *  виглядав би прибутковішим, ніж він є. */
export function linesOf(o: AdminOrder, byId: Map<string, Product>): SoldLine[] {
  const items = Array.isArray(o.items) ? o.items : [];
  const gross = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const off = Math.max(0, Math.min(gross, Math.round(Number(o.discount) || 0)));

  return items.map((i) => {
    const price = Number(i.price) || 0;
    const qty = Math.max(0, Math.round(Number(i.qty) || 0));
    const sum = price * qty;
    const share = gross > 0 ? (off * sum) / gross : 0;
    /* Спершу — те, що заморожено в самому замовленні: саме воно
       було правдою в мить продажу. Каталог тут лише запасний
       шлях, для замовлень, закритих до появи цього поля: їхню
       маржу він рахує сьогоднішньою ціною закупівлі, і це
       наближення, а не факт. */
    const id = String(i.id || '');
    const p = byId.get(id);
    const frozen = Number(o.costs?.[id]);
    const live = Number(p?.cost);
    const cost = Number.isFinite(frozen) && frozen > 0
      ? frozen
      : Number.isFinite(live) && live > 0
        ? live
        : null;
    return {
      id: String(i.id || ''),
      name: String(i.name || p?.name || i.id || ''),
      category: String(i.category || p?.category || ''),
      qty,
      paid: Math.max(0, Math.round(sum - share)),
      cost
    };
  });
}

function catalogueIndex(c: Catalogue): Map<string, Product> {
  return new Map((c.products || []).map((p) => [String(p.id), p]));
}

/** Замовлення періоду, які вважаються продажем. */
export function soldOrders(orders: AdminOrder[], from: Date, to: Date): AdminOrder[] {
  return orders.filter((o) => o.status === SOLD && within(o, from, to));
}

function within(o: AdminOrder, from: Date, to: Date): boolean {
  const t = dateOf(o).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

/** Коли це сталося. Дата замовлення, а не дата виконання: саме
 *  вона стоїть у картці, і саме за нею власник шукає. */
export function dateOf(o: AdminOrder): Date {
  const raw = String(o.date || '');
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d;
  const stamp = o.created as { toDate?: () => Date } | undefined;
  return stamp?.toDate ? stamp.toDate() : new Date(0);
}

/* ============================================================
   ПІДСУМКИ
   ============================================================ */

export function kpiOf(orders: AdminOrder[], c: Catalogue, from: Date, to: Date): Kpi {
  const byId = catalogueIndex(c);
  const sold = soldOrders(orders, from, to);

  let revenue = 0;
  let margin = 0;
  let qty = 0;
  let discounts = 0;
  let withCost = 0;

  const buyers = new Map<string, number>();

  for (const o of sold) {
    discounts += Math.max(0, Math.round(Number(o.discount) || 0));
    for (const l of linesOf(o, byId)) {
      revenue += l.paid;
      qty += l.qty;
      if (l.cost !== null) {
        withCost += l.paid;
        margin += l.paid - l.cost * l.qty;
      }
    }
    const who = keyOfBuyer(o);
    if (who) buyers.set(who, (buyers.get(who) || 0) + 1);
  }

  const dead = orders.filter((o) => o.status === 'cancelled' && within(o, from, to));

  return {
    revenue,
    margin: Math.round(margin),
    qty,
    orders: sold.length,
    average: sold.length ? Math.round(revenue / sold.length) : 0,
    discounts,
    cancelled: dead.length,
    cancelledSum: dead.reduce((s, o) => s + Math.max(0, Math.round(Number(o.total) || 0)), 0),
    covered: revenue > 0 ? withCost / revenue : 0,
    buyers: buyers.size,
    repeat: [...buyers.values()].filter((n) => n > 1).length
  };
}

/** Хто покупець. Пошта надійніша за телефон: її звіряє вхід, а
 *  телефон той самий покупець пише то з +38, то без. */
export function keyOfBuyer(o: AdminOrder): string {
  const mail = String(o.email || o.customer?.email || '').trim().toLowerCase();
  if (mail) return mail;
  const phone = String(o.customer?.phone || '').replace(/\D/g, '');
  return phone.length >= 9 ? phone.slice(-9) : '';
}

/* ============================================================
   ЧАСОВИЙ РЯД
   ============================================================ */

export type Grain = 'day' | 'week' | 'month';

export function seriesOf(
  orders: AdminOrder[],
  c: Catalogue,
  from: Date,
  to: Date,
  grain: Grain
): Point[] {
  const byId = catalogueIndex(c);
  const box = new Map<string, Point>();

  for (const o of soldOrders(orders, from, to)) {
    const at = bucket(dateOf(o), grain);
    const p = box.get(at) || { at, revenue: 0, margin: 0, orders: 0 };
    p.orders += 1;
    for (const l of linesOf(o, byId)) {
      p.revenue += l.paid;
      if (l.cost !== null) p.margin += l.paid - l.cost * l.qty;
    }
    box.set(at, p);
  }

  /* Порожні дні теж потрібні: без них лінія стрибає з понеділка
     на пʼятницю однаковим кроком, і провал посеред тижня видно
     не як провал, а як звичайний нахил. */
  const out: Point[] = [];
  for (const at of buckets(from, to, grain)) {
    const p = box.get(at);
    out.push(p || { at, revenue: 0, margin: 0, orders: 0 });
  }
  return out;
}

export function bucket(d: Date, grain: Grain): string {
  const iso = day(d);
  if (grain === 'day') return iso;
  if (grain === 'month') return iso.slice(0, 7);
  return day(mondayOf(d));
}

function buckets(from: Date, to: Date, grain: Grain): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const step = new Date(from.getTime());
  /* Крок — доба навіть для місяців: перебирати дні дешевше, ніж
     розбирати, скільки їх у лютому. */
  while (step.getTime() <= to.getTime() && out.length < 800) {
    const key = bucket(step, grain);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    step.setDate(step.getDate() + 1);
  }
  return out;
}

function mondayOf(d: Date): Date {
  const copy = new Date(d.getTime());
  const shift = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - shift);
  return copy;
}

export function day(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const x = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${x}`;
}

/* ============================================================
   ТОВАРИ Й КАТЕГОРІЇ
   ============================================================ */

export function rowsOf(orders: AdminOrder[], c: Catalogue, from: Date, to: Date): Row[] {
  const byId = catalogueIndex(c);
  const box = new Map<string, Row & { seen: Set<string> }>();

  for (const o of soldOrders(orders, from, to)) {
    for (const l of linesOf(o, byId)) {
      if (!l.id) continue;
      const p = byId.get(l.id);
      const row =
        box.get(l.id) ||
        box
          .set(l.id, {
            id: l.id,
            name: l.name,
            category: l.category,
            revenue: 0,
            margin: 0,
            qty: 0,
            orders: 0,
            price: Math.round(Number(p?.price) || 0),
            cost: l.cost,
            costed: 0,
            share: 0,
            seen: new Set<string>()
          })
          .get(l.id)!;
      row.revenue += l.paid;
      row.qty += l.qty;
      if (l.cost !== null) {
        row.margin += l.paid - l.cost * l.qty;
        row.costed += l.paid;
      }
      row.seen.add(o._id);
    }
  }

  const all = [...box.values()];
  const total = all.reduce((s, r) => s + r.revenue, 0);
  return all
    .map(({ seen, ...r }) => ({ ...r, orders: seen.size, share: total > 0 ? r.revenue / total : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function byCategory(rows: Row[], titles: Map<string, string>): Row[] {
  const box = new Map<string, Row>();
  for (const r of rows) {
    const id = r.category || '—';
    const at =
      box.get(id) ||
      box
        .set(id, {
          id,
          name: titles.get(id) || id,
          category: id,
          revenue: 0,
          margin: 0,
          qty: 0,
          orders: 0,
          price: 0,
          cost: null,
          costed: 0,
          share: 0
        })
        .get(id)!;
    at.revenue += r.revenue;
    at.margin += r.margin;
    at.costed += r.costed;
    at.qty += r.qty;
    at.orders += r.orders;
  }
  const all = [...box.values()];
  const total = all.reduce((s, r) => s + r.revenue, 0);
  return all
    .map((r) => ({ ...r, share: total > 0 ? r.revenue / total : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

/* ============================================================
   BCG
   ============================================================ */

/** Скільки коштували продані товари — тобто витрати на закупівлю.
 *
 *  Рахуємо ЛИШЕ з тієї виручки, за якою собівартість відома:
 *  інакше товар без ціни закупівлі виглядав би безкоштовним, і
 *  категорія з ним — найприбутковішою в магазині.
 *
 *  Це витрати на ТОВАР, а не всі витрати магазину: реклама,
 *  пакування, комісія банку сюди не входять — їх ніхто не веде за
 *  категоріями, та й прив'язати їх до категорії чесно не вийде. */
export function spentOn(r: Row): number {
  return Math.max(0, r.costed - r.margin);
}

/** Маржинальність — у відсотках від тієї виручки, яку ми справді
 *  вміємо порахувати. */
export function marginPercent(r: Row): number | null {
  return r.costed > 0 ? Math.round((r.margin / r.costed) * 100) : null;
}

export function bcgOf(rows: Row[]): Bcg {
  /* Вісь грошей — маржа на одиницю там, де собівартість відома
     хоч у частини товарів. Немає жодної — беремо ціну й чесно
     кажемо про це підписом осі: вигадувати маржу не можна. */
  const anyCost = rows.some((r) => r.cost !== null);
  const axis: 'margin' | 'price' = anyCost ? 'margin' : 'price';

  const points = rows
    .filter((r) => r.qty > 0)
    .map((r) => ({
      ...r,
      x: axis === 'margin' && r.cost !== null ? r.price - r.cost : r.price,
      y: r.qty,
      quadrant: 'dog' as Quadrant
    }));

  const midX = median(points.map((p) => p.x));
  const midY = median(points.map((p) => p.y));

  const counts: Record<Quadrant, number> = { star: 0, cow: 0, question: 0, dog: 0 };
  for (const p of points) {
    const rich = p.x >= midX;
    const often = p.y >= midY;
    p.quadrant = rich && often ? 'star' : !rich && often ? 'cow' : rich ? 'question' : 'dog';
    counts[p.quadrant] += 1;
  }

  return { points, midX, midY, axis, counts };
}

export function median(list: number[]): number {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/* ============================================================
   ЗВІДКИ ЗАМОВЛЕННЯ
   ============================================================ */

export interface Slice {
  id: string;
  name: string;
  value: number;
  share: number;
}

export function sliceBy(
  orders: AdminOrder[],
  from: Date,
  to: Date,
  pick: (o: AdminOrder) => string,
  weigh: (o: AdminOrder) => number = () => 1
): Slice[] {
  const box = new Map<string, number>();
  for (const o of soldOrders(orders, from, to)) {
    const key = pick(o) || '—';
    box.set(key, (box.get(key) || 0) + Math.max(0, weigh(o)));
  }
  const all = [...box.entries()].map(([id, value]) => ({ id, name: id, value, share: 0 }));
  const total = all.reduce((s, x) => s + x.value, 0);
  return all
    .map((x) => ({ ...x, share: total > 0 ? x.value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

/** Середня знижка саме на цей товар: скільки з повної ціни
 *  каталогу до магазину не дійшло. Потрібна порадам — знижка,
 *  якої не помічають, з'їдає маржу тихіше за все інше. */
export function discountByProduct(
  orders: AdminOrder[],
  c: Catalogue,
  from: Date,
  to: Date
): Map<string, number> {
  const byId = catalogueIndex(c);
  const gross = new Map<string, number>();
  const paid = new Map<string, number>();

  for (const o of soldOrders(orders, from, to)) {
    for (const l of linesOf(o, byId)) {
      const price = Math.round(Number(byId.get(l.id)?.price) || 0);
      if (!price) continue;
      gross.set(l.id, (gross.get(l.id) || 0) + price * l.qty);
      paid.set(l.id, (paid.get(l.id) || 0) + l.paid);
    }
  }

  const out = new Map<string, number>();
  for (const [id, full] of gross) {
    if (full <= 0) continue;
    out.set(id, Math.max(0, Math.min(0.9, 1 - (paid.get(id) || 0) / full)));
  }
  return out;
}

/** Звідки прийшов покупець.
 *
 *  Показуємо ПЕРШИЙ дотик, а не останній: питання, заради якого
 *  все це рахується, звучить «куди вкладати гроші», а відповідає
 *  на нього той, хто ПРИВІВ людину. Останній дотик майже завжди
 *  виявився б пошуком за назвою бренду — і будь-яка реклама
 *  виглядала б марною, хоч саме вона й привела покупця тиждень
 *  тому. */
export function channelOf(o: AdminOrder): string {
  const from = (o.customer as { from?: { first?: { channel?: string } } } | undefined)?.from;
  return String(from?.first?.channel || '');
}

/** Скільки замовлень узагалі знають про своє джерело. Доки поле
 *  тільки зʼявилось, більшість історії його не має, і мовчати про
 *  це не можна: інакше «Прямий захід» виглядав би головним
 *  каналом магазину. */
export function knownSource(orders: AdminOrder[], from: Date, to: Date): number {
  const sold = soldOrders(orders, from, to);
  if (!sold.length) return 0;
  return sold.filter((o) => channelOf(o)).length / sold.length;
}

/** Місто отримувача — коротко, без назви відділення. */
export function cityOf(o: AdminOrder): string {
  const city = String(o.customer?.city || '').replace(/^м\.\s*/i, '').trim();
  return city || (o.customer?.intl ? 'За кордон' : '');
}

/* ============================================================
   ПЕРІОДИ
   ============================================================ */

export type Span = '7' | '30' | '90' | '365' | 'all';

export const SPANS: { id: Span; title: string }[] = [
  { id: '7', title: 'Тиждень' },
  { id: '30', title: 'Місяць' },
  { id: '90', title: 'Квартал' },
  { id: '365', title: 'Рік' },
  { id: 'all', title: 'Увесь час' }
];

export function rangeOf(span: Span, now: Date): { from: Date; to: Date } {
  const to = new Date(now.getTime());
  to.setHours(23, 59, 59, 999);
  if (span === 'all') return { from: new Date(0), to };
  const from = new Date(now.getTime());
  from.setDate(from.getDate() - (Number(span) - 1));
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/** Той самий відрізок, але попередній — для порівняння «було».
 *  Для «увесь час» порівнювати нема з чим, і вигадувати не
 *  будемо: краще без стрілки, ніж зі стрілкою в нікуди. */
export function previous(span: Span, now: Date): { from: Date; to: Date } | null {
  if (span === 'all') return null;
  const days = Number(span);
  const { from } = rangeOf(span, now);
  const to = new Date(from.getTime() - 1);
  const start = new Date(from.getTime());
  start.setDate(start.getDate() - days);
  return { from: start, to };
}

/** Наскільки виріс показник, у відсотках. null — порівнювати
 *  нема з чим: із нуля будь-яке число дає нескінченність. */
export function growth(now: number, was: number): number | null {
  if (!was) return null;
  return Math.round(((now - was) / was) * 100);
}

/** Крок часового ряду під довжину періоду: за рік по днях —
 *  триста шістдесят рисок, у яких нічого не видно. */
export function grainFor(span: Span, orders: AdminOrder[]): Grain {
  if (span === '7' || span === '30') return 'day';
  if (span === '90') return 'week';
  if (span === '365') return 'month';
  /* «Увесь час» міряємо тим, що є: у магазину з піврічною
     історією тижні читаються краще за місяці. */
  const days = orders.length ? spanDays(orders) : 0;
  return days > 400 ? 'month' : days > 90 ? 'week' : 'day';
}

function spanDays(orders: AdminOrder[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const o of orders) {
    const t = dateOf(o).getTime();
    if (!t) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? (max - min) / 86_400_000 : 0;
}
