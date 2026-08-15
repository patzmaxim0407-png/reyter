/* ============================================================
   REYTER — склад і рух товару
   ------------------------------------------------------------
   Портовано з js/admin.js (другий модуль) один в один: залишки
   (inventory), журнал руху (stock_moves), приходи (restocks),
   списання, очікувана дата (restock_eta) і листи «знову
   в наявності» (stock_alerts).

   Склад — єдине місце адмінки, де помилка коштує грошей: зайвий
   мінус у залишку означає проданий товар, якого немає, а зайвий
   плюс — товар, який ніхто не відвантажить. Тому вся арифметика
   винесена в чисті функції, а в Firestore іде вже готовий план.

   Стану модуль не тримає: каталог-чернетка й кеш залишків
   приходять аргументом (у старому коді це були products() і
   змінна inv), час — теж аргументом. Розмітки немає зовсім:
   рядки складу, картки приходів і стрічка журналу малюються
   в React, а звідси йдуть лише числа й підписи.

   Дві межі з сусідніми модулями:
   • CONSUMING і adjustOrderStock живуть тут, хоч викликає їх
     панель замовлень: питання «чи списаний товар» — складське,
     і відповідь на нього має бути одна;
   • лист «знову в наявності» шле воркер, а notify.ts такого
     відправника поки не має, тож він приходить аргументом.
   ============================================================ */

import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Transaction,
  type WriteBatch
} from 'firebase/firestore';

import { ALL_SIZES, LOW_STOCK_AT, isSet } from '../catalog';
import type { OrderItem, OrderStatus, Product, Stock, StockEntry } from '../types';

/* Колекції. Назви лежать поруч, бо один і той самий документ
   читає адмінка й пише покупець (stock_alerts), а restock_eta ще
   й показує сайт. */
export const INVENTORY_COL = 'inventory';
export const MOVES_COL = 'stock_moves';
export const RESTOCKS_COL = 'restocks';
export const ETA_COL = 'restock_eta';
export const ALERTS_COL = 'stock_alerts';

/* Службова картка, якою колись додавали в ручне замовлення
   вартість доставки. Тепер доставка має окреме поле shipping і
   фізичною одиницею складу не є. Старі замовлення з EFJ-1209 ще
   можуть лишатися в базі, тому відсікаємо її на спільному вході
   до списання, повернення й перевірки нестачі. */
const NON_STOCK_IDS = new Set(['EFJ-1209']);

export function tracksStock(id: string | null | undefined): boolean {
  return !!id && !NON_STOCK_IDS.has(id);
}

/* Поріг «закінчується» — той самий, що на вітрині: інакше
   адмінка й сайт по-різному відповідали б на одне питання. */
export { LOW_STOCK_AT as LOW_AT } from '../catalog';

/* ============================================================
   СТАН
   ============================================================ */

/** Усе, з чого рахується склад: каталог-чернетка й кеш живих
 *  залишків. У старому модулі це були products() і змінна inv,
 *  які кожна функція читала із замикання. */
export interface StockState {
  products: Product[];
  /** pid → документ inventory. Товару без документа тут немає
   *  зовсім — це не те саме, що нульовий залишок. */
  inv: Stock;
}

/** Хто пише. Пошта підписує кожен запис журналу руху: інакше
 *  через місяць не дізнатись, хто саме списав. */
export interface StockWriter {
  db: Firestore;
  by: string;
}

/** Результат запису. Помилку не глушимо в тиші, але й не кидаємо:
 *  адмінці треба показати рівно те, що показував старий тост, —
 *  «немає прав» відрізняється від «збережено». */
export type StockResult = { ok: true } | { ok: false; message: string };

export function productById(s: StockState, id: string): Product | null {
  return s.products.find((p) => p.id === id) || null;
}

/** Чи рахується товар за розмірами.
 *
 *  Розмірна сітка — це те, що стоїть у картці. Немає жодного
 *  розміру — товар штучний: свічка, аромат, доставка окремою
 *  позицією. Доти тут ішлося лише про обʼєм, і склад малював
 *  такому товарові всі пʼять розмірів із нулями — рядок, у якому
 *  все неправда.
 *
 *  Запобіжник для старих записів: якщо в залишках уже лежать
 *  числа за розмірами, сітку вважаємо наявною попри порожню
 *  картку. Інакше проставлені колись кількості зникли б з очей,
 *  а зникати вони не мають права. */
export function isSized(p: Product, s?: StockState): boolean {
  if (p.volume) return false;
  if (p.sizes && p.sizes.length) return true;
  if (!s) return false;
  const sizes = invOf(s, p.id).sizes || {};
  return Object.keys(sizes).some((k) => Number(sizes[k]));
}

/** Складники комплекту, які реально є в каталозі. Схований
 *  складник лишається (див. catalog.ts), відпадають лише
 *  видалений і той, що сам став комплектом. */
export function setPartsOf(s: StockState, p: Product | null | undefined): Product[] {
  if (!p || !Array.isArray(p.set)) return [];
  return p.set
    .map((id) => productById(s, id))
    .filter((x): x is Product => !!x && !isSet(x));
}

/** Комплект, від якого не лишилось жодного складника, складом не
 *  керує: власних залишків у нього немає, а рахувати нема з чого.
 *  Тому ознака рахується по складниках, а не по полю set. */
export function isSetOf(s: StockState, p: Product | null | undefined): boolean {
  return setPartsOf(s, p).length > 0;
}

/* ============================================================
   ЧИТАННЯ ЗАЛИШКІВ
   ============================================================ */

export function invOf(s: StockState, pid: string): StockEntry {
  return s.inv[pid] || {};
}

export function sizeQty(s: StockState, pid: string, size: string): number {
  const sizes = invOf(s, pid).sizes || {};
  return Number(sizes[size]) || 0;
}

export function unitQty(s: StockState, pid: string): number {
  return Number(invOf(s, pid).qty) || 0;
}

export function totalQty(s: StockState, p: Product): number {
  if (!isSized(p, s)) return unitQty(s, p.id);
  const sizes = invOf(s, p.id).sizes || {};
  return Object.keys(sizes).reduce((sum, k) => sum + (Number(sizes[k]) || 0), 0);
}

/** Чи ведеться облік цього товару взагалі. Нуль у залишку і
 *  відсутній документ — різні речі: перше означає «немає»,
 *  друге — «не рахуємо», і попереджати про нестачу в другому
 *  випадку нема про що. */
export function hasInvDoc(s: StockState, pid: string): boolean {
  return !!s.inv[pid];
}

/** Скільки комплектів такого розміру можна зібрати.
 *  null — хоч один складник без обліку: вигадувати замість нього
 *  число не можна, сторінка складу покаже «—». */
export function setSizeQty(s: StockState, p: Product, size: string): number | null {
  const parts = setPartsOf(s, p);
  if (!parts.length) return 0;
  if (parts.some((x) => !hasInvDoc(s, x.id))) return null;
  return (
    parts.reduce((min, x) => {
      const have = isSized(x, s) ? sizeQty(s, x.id, size) : unitQty(s, x.id);
      return Math.min(min, have);
    }, Infinity) || 0
  );
}

/* ============================================================
   ЖУРНАЛ РУХУ
   ============================================================ */

export type MoveReason =
  | 'manual'
  | 'order'
  | 'order-cancel'
  | 'order-return'
  | 'restock'
  | 'writeoff';

/* Довгі підписи причин. У старому модулі цей перелік лежав поруч
   із рештою констант, але жоден екран його не читав — стрічку
   журналу малює MOVE_TAGS. Переїхав разом із ним: назви тут
   пояснюють причину повністю, і десь у звіті вони ще знадобляться. */
export const MOVE_REASONS: Record<MoveReason, string> = {
  manual: 'Ручне коригування',
  order: 'Списання під замовлення',
  'order-cancel': 'Повернення (скасування)',
  'order-return': 'Повернення від покупця',
  restock: 'Прихід товару',
  writeoff: 'Списання'
};

export interface MoveTag {
  title: string;
  cls: 'is-in' | 'is-out' | 'is-back' | 'is-manual' | 'is-off';
}

/** Мітка руху в стрічці журналу. */
export const MOVE_TAGS: Record<MoveReason, MoveTag> = {
  restock: { title: 'Прихід', cls: 'is-in' },
  order: { title: 'Замовлення', cls: 'is-out' },
  'order-cancel': { title: 'Повернення', cls: 'is-back' },
  manual: { title: 'Коригування', cls: 'is-manual' },
  'order-return': { title: 'Повернення від покупця', cls: 'is-back' },
  writeoff: { title: 'Списання', cls: 'is-off' }
};

/** Запис, який лягає в stock_moves. */
export interface MoveEntry {
  productId: string;
  productName: string;
  size: string | null;
  delta: number;
  reason: MoveReason;
  ref: string;
}

/** Час запису так, як його віддає Firestore. Метод
 *  необовʼязковий: serverTimestamp() своє значення отримує вже
 *  на сервері, і в першому ж кадрі підписки поля ще немає. */
export interface MoveStamp {
  toDate?: () => Date;
}

/** Запис журналу так, як він приходить із бази: причина тут
 *  просто рядок, бо в старих записах трапляються ті, яких
 *  у переліку вже немає. */
export interface Move {
  productId?: string;
  productName?: string;
  size?: string | null;
  delta?: number;
  reason?: string;
  ref?: string;
  ts?: MoveStamp | null;
  by?: string;
}

export function moveTag(m: Move): MoveTag {
  return (
    MOVE_TAGS[m.reason as MoveReason] || {
      title: m.reason || '—',
      cls: 'is-manual' as const
    }
  );
}

/** І batch, і transaction мають однаковий set(), але Firebase
 *  повертає з нього різні класи. Решті складської арифметики
 *  різниця не потрібна: вона лише складає атомарний запис. */
export type StockMutation = WriteBatch | Transaction;

function mutationSet(
  mutation: StockMutation,
  ref: ReturnType<typeof doc>,
  data: Record<string, unknown>,
  options?: { merge: boolean }
): void {
  const set = mutation.set.bind(mutation) as (
    target: ReturnType<typeof doc>,
    value: Record<string, unknown>,
    opts?: { merge: boolean }
  ) => unknown;
  if (options) set(ref, data, options);
  else set(ref, data);
}

export function logMove(w: StockWriter, mutation: StockMutation, entry: MoveEntry): void {
  mutationSet(mutation, doc(collection(w.db, MOVES_COL)), {
    ts: serverTimestamp(),
    by: w.by,
    ...entry
  });
}

export function logMoves(w: StockWriter, mutation: StockMutation, moves: MoveEntry[]): void {
  moves.forEach((m) => logMove(w, mutation, m));
}

/* ---------- Читання журналу ---------- */

export const MOVES_PER_PAGE = 25;

export function filteredMoves(moves: Move[], reason: string, search: string): Move[] {
  const q = search.trim().toLowerCase();
  return moves.filter((m) => {
    if (reason !== 'all' && m.reason !== reason) return false;
    if (!q) return true;
    return (
      String(m.productName || '').toLowerCase().includes(q) ||
      String(m.productId || '').toLowerCase().includes(q) ||
      String(m.ref || '').toLowerCase().includes(q)
    );
  });
}

export function moveDate(m: Move): Date | null {
  const ts = m.ts;
  return ts && ts.toDate ? ts.toDate() : null;
}

/** Заголовок дня: «Сьогодні», «Вчора» або дата з днем тижня. */
export function dayTitle(d: Date, now: Date): string {
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);

  if (same(d, now)) return 'Сьогодні';
  if (same(d, yest)) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', weekday: 'long' });
}

export interface MovesDay {
  /** Ключ доби; порожній рядок — запис без часу. */
  key: string;
  title: string;
  moves: Move[];
}

export interface MovesPage {
  page: number;
  pages: number;
  /** Скільки записів лишилось позаду — з нього рядок «Показано N–M». */
  from: number;
  shown: Move[];
  days: MovesDay[];
  /** Підсумки саме за фільтром, а не за сторінкою: скільки
   *  одиниць надійшло і скільки вибуло. */
  plus: number;
  minus: number;
}

/** Сторінка журналу з групуванням за добою: у стрічці на сотні
 *  записів важливо бачити межу доби, інакше вчорашній прихід
 *  зливається із сьогоднішнім. */
export function movesPage(list: Move[], page: number, now: Date): MovesPage {
  const pages = Math.max(1, Math.ceil(list.length / MOVES_PER_PAGE));
  const current = Math.min(page, pages);
  const from = (current - 1) * MOVES_PER_PAGE;
  const shown = list.slice(from, from + MOVES_PER_PAGE);

  const plus = list.reduce((n, m) => n + Math.max(0, Number(m.delta) || 0), 0);
  const minus = list.reduce((n, m) => n + Math.min(0, Number(m.delta) || 0), 0);

  const days: MovesDay[] = [];
  shown.forEach((m) => {
    const d = moveDate(m);
    const key = d ? d.toDateString() : '';
    const last = days[days.length - 1];
    if (!last || last.key !== key) {
      days.push({ key, title: d ? dayTitle(d, now) : 'Без дати', moves: [m] });
    } else {
      last.moves.push(m);
    }
  });

  return { page: current, pages, from, shown, days, plus, minus };
}

/** Номери сторінок: перша, остання й вікно навколо поточної. */
export function pagerNumbers(page: number, pages: number): (number | '…')[] {
  if (pages < 2) return [];
  const nums: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return nums;
}

/* ============================================================
   ЗМІНА ЗАЛИШКІВ ПІД ЗАМОВЛЕННЯ
   ============================================================ */

/** Замовлення очима складу. Ширше за Order із order.ts навмисно:
 *  сюди приходять і документи з бази, де items може не доїхати. */
export interface StockOrder {
  num?: string;
  items?: OrderItem[] | null;
}

/** Позиція замовлення, переведена в одиниці складу. */
export interface StockUnit {
  id: string;
  name: string;
  size: string | null;
  volume: boolean;
  qty: number;
}

/** Зміна одного документа inventory. */
export interface StockDelta {
  sizes: Record<string, number>;
  qty: number;
}

export type StockGroups = Record<string, StockDelta>;

/** План зміни складу: скільки додати/відняти в кожному документі
 *  inventory і що записати в журнал. */
export interface StockPlan {
  groups: StockGroups;
  moves: MoveEntry[];
}

export function emptyPlan(): StockPlan {
  return { groups: {}, moves: [] };
}

/** Позиції замовлення в «одиниці складу»: комплект власних
 *  залишків не має, тож замість нього рахуємо його складники.
 *  Одна одиниця комплекту = по одній одиниці кожного складника
 *  в обраному покупцем розмірі. */
export function stockUnits(order: StockOrder): StockUnit[] {
  const units: StockUnit[] = [];
  (order.items || []).forEach((item) => {
    if (!tracksStock(item.id)) return;
    const qty = Number(item.qty) || 0;
    if (!qty) return;
    if (item.parts && item.parts.length) {
      item.parts.forEach((x) => {
        if (!tracksStock(x.id)) return;
        units.push({
          id: x.id,
          name: (x.name || x.id) + ' (у складі «' + (item.name || item.id) + '»)',
          size: x.size || null,
          volume: !!x.volume,
          qty: qty
        });
      });
    } else {
      units.push({
        id: item.id,
        name: item.name || item.id,
        size: item.size || null,
        volume: !!item.volume,
        qty: qty
      });
    }
  });
  return units;
}

/** Накопичує зміни в СПІЛЬНИЙ план. Спільний він навмисно: при
 *  редагуванні замовлення ми повертаємо старий склад і списуємо
 *  новий, і той самий товар має отримати РІВНО ОДИН запис
 *  у документі inventory. Двома окремими планами другий запис
 *  затер би перший — саме через це колись і переписували. */
export function collectStock(
  s: StockState,
  order: StockOrder,
  direction: number,
  into: StockPlan,
  reason?: MoveReason,
  refText?: string
): void {
  stockUnits(order).forEach((item) => {
    const p = productById(s, item.id);
    const delta = direction * item.qty;
    if (!delta) return;

    /* Товар міг зникнути з каталогу після замовлення — тоді
       спираємось на ознаку, збережену в самій позиції */
    const sized = p ? isSized(p) : !item.volume && !!item.size;
    if (!into.groups[item.id]) into.groups[item.id] = { sizes: {}, qty: 0 };
    if (!sized) {
      into.groups[item.id].qty += delta;
    } else if (item.size) {
      into.groups[item.id].sizes[item.size] =
        (into.groups[item.id].sizes[item.size] || 0) + delta;
    }

    into.moves.push({
      productId: item.id,
      productName: item.name,
      size: item.size || null,
      delta: delta,
      reason: reason || (direction < 0 ? 'order' : 'order-cancel'),
      ref: refText || order.num || ''
    });
  });
}

/** Записує накопичені зміни залишків. Нульові розміри й товари,
 *  у яких після взаємозаліку нічого не змінилось, документа не
 *  торкаються зовсім: зайвий запис створив би документ inventory
 *  там, де обліку не було, і товар раптом став би «немає». */
export function writeStock(w: StockWriter, mutation: StockMutation, groups: StockGroups): void {
  Object.keys(groups).forEach((pid) => {
    const g = groups[pid];
    const sizeKeys = Object.keys(g.sizes).filter((s) => g.sizes[s]);
    if (!g.qty && !sizeKeys.length) return;

    const upd: Record<string, unknown> = { updated: serverTimestamp() };
    if (g.qty) upd.qty = increment(g.qty);
    if (sizeKeys.length) {
      const sizes: Record<string, unknown> = {};
      sizeKeys.forEach((s) => {
        sizes[s] = increment(g.sizes[s]);
      });
      upd.sizes = sizes;
    }
    mutationSet(mutation, doc(w.db, INVENTORY_COL, pid), upd, { merge: true });
  });
}

export function applyStockPlan(w: StockWriter, mutation: StockMutation, plan: StockPlan): void {
  logMoves(w, mutation, plan.moves);
  writeStock(w, mutation, plan.groups);
}

/** Один напрямок і одне замовлення: −1 списує, +1 повертає. */
export function adjustOrderStock(
  w: StockWriter,
  mutation: StockMutation,
  s: StockState,
  order: StockOrder,
  direction: number,
  reason?: MoveReason
): void {
  const plan = emptyPlan();
  collectStock(s, order, direction, plan, reason);
  applyStockPlan(w, mutation, plan);
}

/* Статуси, за яких товар вважається списаним зі складу. Перехід
   у будь-який із них списує, вихід із них — повертає; переходи
   всередині переліку складу не торкаються зовсім. */
export const CONSUMING: readonly OrderStatus[] = ['confirmed', 'shipped', 'done'];

export function consumesStock(status: string | null | undefined): boolean {
  return CONSUMING.includes(status as OrderStatus);
}

/** Чого не вистачить, якщо списати це замовлення. Рядки готові
 *  до показу — саме їх бачив адмін у діалозі підтвердження. */
export function stockShortage(s: StockState, order: StockOrder): string[] {
  const short: string[] = [];

  // Комплект перевіряємо по складниках — власних залишків у нього немає
  const units: { id: string; name: string; size: string | null; qty: number }[] = [];
  (order.items || []).forEach((item) => {
    if (!tracksStock(item.id)) return;
    if (item.parts && item.parts.length) {
      item.parts.forEach((x) => {
        if (!tracksStock(x.id)) return;
        units.push({
          id: x.id,
          name: (x.name || x.id) + ' — у складі «' + (item.name || item.id) + '»',
          size: x.size || null,
          qty: Number(item.qty) || 0
        });
      });
    } else {
      units.push({ id: item.id, name: item.name, size: item.size, qty: item.qty });
    }
  });

  /* Один товар може стояти в кількох позиціях — окремо й у
     складі комплекту. Рахуємо сумарну потребу, інакше
     попередження не спрацює й залишок мовчки піде в мінус. */
  const need: Record<string, { id: string; size: string | null; name: string; qty: number }> = {};
  units.forEach((item) => {
    const p = productById(s, item.id);
    if (!p || !hasInvDoc(s, item.id)) return; // облік не ведеться — не перевіряємо
    const key = item.id + '|' + (item.size || '');
    if (!need[key]) {
      need[key] = {
        id: item.id,
        size: isSized(p) ? item.size : null,
        name: p.name,
        qty: 0
      };
    }
    need[key].qty += Number(item.qty) || 0;
  });

  /* Товар міг стати комплектом уже після замовлення: розмірів
     складників у такій позиції немає, і списати їх нема з чого */
  (order.items || []).forEach((item) => {
    if (!tracksStock(item.id)) return;
    if (item.parts && item.parts.length) return;
    const p = productById(s, item.id);
    if (p && isSetOf(s, p)) {
      short.push(
        item.name +
          ': товар став комплектом після замовлення — ' +
          'складники доведеться списати вручну'
      );
    }
  });

  Object.keys(need).forEach((key) => {
    const it = need[key];
    const have = it.size ? sizeQty(s, it.id, it.size) : unitQty(s, it.id);
    if (have < it.qty) {
      short.push(
        it.name +
          (it.size ? ' (' + it.size + ')' : '') +
          ': потрібно ' + it.qty + ', на складі ' + have
      );
    }
  });
  return short;
}

/* ============================================================
   РЯДОК СКЛАДУ
   ============================================================ */

export interface RowState {
  /** Порожній клас — облік не ведеться: це не «в наявності»
   *  і не «немає», а «ми цього не рахуємо». */
  cls: '' | 'is-ok' | 'is-low' | 'is-out';
  label: string;
}

export function productRowState(s: StockState, p: Product): RowState {
  if (isSetOf(s, p)) {
    /* Комплект живе складниками. Стан рахуємо за тим, чи можна
       його взагалі продати: покупець змішує розміри, тож
       «немає жодного розміру, спільного для всіх» ще не означає
       «не зібрати». Не зібрати — лише коли якогось складника
       немає зовсім або він випав із каталогу. */
    const parts = setPartsOf(s, p);
    if (!parts.length || parts.length !== (p.set || []).length) {
      return { cls: 'is-out', label: 'складник відсутній' };
    }
    const tracked = parts.filter((x) => hasInvDoc(s, x.id));
    if (!tracked.length) return { cls: '', label: 'не ведеться' };

    const least = tracked.reduce((min, x) => Math.min(min, totalQty(s, x)), Infinity);
    if (least <= 0) return { cls: 'is-out', label: 'не зібрати' };
    if (least <= LOW_STOCK_AT) return { cls: 'is-low', label: 'закінчується' };
    return { cls: 'is-ok', label: 'можна зібрати' };
  }

  const total = totalQty(s, p);
  if (!hasInvDoc(s, p.id)) return { cls: '', label: 'не ведеться' };
  if (total <= 0) return { cls: 'is-out', label: 'немає' };
  if (isSized(p, s)) {
    const sizes = invOf(s, p.id).sizes || {};
    const lows = Object.keys(sizes).filter(
      (k) => Number(sizes[k]) > 0 && Number(sizes[k]) <= LOW_STOCK_AT
    );
    if (lows.length) return { cls: 'is-low', label: 'закінчується ' + lows.join(', ') };
  } else if (total <= LOW_STOCK_AT) {
    return { cls: 'is-low', label: 'закінчується' };
  }
  return { cls: 'is-ok', label: 'в наявності' };
}

export interface StockSize {
  size: string;
  /** Розміру немає в картці товару, а штуки на складі лишились. */
  stray: boolean;
}

/** Розміри рядка складу: зафіксовані в картці товару плюс ті,
 *  яких у картці вже немає, але залишок ненульовий — інакше ці
 *  штуки зникли б з очей і зіпсували підсумок. */
export function stockSizes(s: StockState, p: Product): StockSize[] {
  const carded = p.sizes && p.sizes.length ? p.sizes : ALL_SIZES;
  const inv = invOf(s, p.id).sizes || {};
  return ALL_SIZES.filter((size) => carded.includes(size) || Number(inv[size])).map((size) => ({
    size: size,
    stray: !carded.includes(size)
  }));
}

export interface StockCell extends StockSize {
  qty: number;
}

export interface StockRow {
  state: RowState;
  total: number;
  sized: boolean;
  /** Порожньо в товару без сітки — уся кількість лежить в unit. */
  cells: StockCell[];
  unit: number;
}

/** Рядок звичайного товару. Кількості не редагуються руками:
 *  базу вже задано, далі склад змінюють лише прихід і замовлення,
 *  і в журналі лишається повна історія, а не тихі виправлення. */
export function stockRow(s: StockState, p: Product): StockRow {
  const sized = isSized(p, s);
  return {
    state: productRowState(s, p),
    total: totalQty(s, p),
    sized: sized,
    cells: sized
      ? stockSizes(s, p).map((it) => ({ ...it, qty: sizeQty(s, p.id, it.size) }))
      : [],
    unit: sized ? 0 : unitQty(s, p.id)
  };
}

export interface SetStockCell {
  size: string;
  /** null — хоч один складник без обліку. */
  qty: number | null;
}

export interface SetStockRow {
  parts: Product[];
  /** Комплект без жодного складника з сіткою: кількість одна
   *  на весь комплект, розмірів у нього немає. */
  sized: boolean;
  /** Скільки комплектів можна зібрати взагалі; null — облік
   *  ведеться не для всіх складників. */
  total: number | null;
  /** Порожньо в sized-комплекті означає, що спільних розмірів
   *  немає зовсім (стара розмітка показувала на цьому місці «—»). */
  sizes: SetStockCell[];
  state: RowState;
}

/** Рядок комплекту: власних залишків у нього немає, тому числа
 *  рахуються за складниками.
 *
 *  Загальне число обмежує найдефіцитніший складник за ВСІМА
 *  своїми розмірами — саме воно, а не сума по розмірах: складник
 *  без сітки (свічка) інакше порахувався б у кожному розмірі
 *  окремо. */
export function setStockRow(s: StockState, p: Product): SetStockRow {
  const parts = setPartsOf(s, p);
  const tracked = parts.length > 0 && parts.every((x) => hasInvDoc(s, x.id));
  const sized = parts.some((x) => isSized(x, s));

  const total = tracked
    ? parts.reduce((min, x) => Math.min(min, totalQty(s, x)), Infinity)
    : null;

  const sizes: SetStockCell[] = sized
    ? ALL_SIZES.filter((sz) =>
        parts.every((x) => !isSized(x) || stockSizes(s, x).some((it) => it.size === sz))
      ).map((sz) => ({ size: sz, qty: setSizeQty(s, p, sz) }))
    : [];

  return { parts, sized, total, sizes, state: productRowState(s, p) };
}

/* ============================================================
   ПРИХІД
   ------------------------------------------------------------
   Прихід не змінює залишків одразу: він стає в чергу очікування
   і додає штуки лише тоді, коли товар фізично приїхав і його
   оприбуткували.
   ============================================================ */

export interface Restock {
  _id: string;
  productId: string;
  productName?: string;
  /** Очікувана дата у форматі YYYY-MM-DD — її ж читає сайт. */
  expected?: string;
  note?: string;
  status?: 'pending' | 'received';
  /** Собівартість одиниці в цій партії, грн. Саме прихід — те
   *  місце, де ціна закупівлі й змінюється: інша партія, інший
   *  курс, інший постачальник. При оприбуткуванні вона стає
   *  поточною собівартістю товару. */
  cost?: number;
  /** Кількості по розмірах або одним числом: що саме, залежить
   *  від товару на момент створення приходу. */
  items?: Record<string, number>;
  qty?: number;
  by?: string;
  receivedBy?: string;
  receivedAt?: MoveStamp | null;
}

/* Дата місцевою добою, а не UTC: інакше вечірній прихід
   потрапив би на завтра. */
export function localISO(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

export function todayISO(now: Date): string {
  return localISO(now);
}

export function restockTotal(r: Restock): number {
  return r.items
    ? Object.keys(r.items).reduce((n, k) => n + (Number(r.items![k]) || 0), 0)
    : Number(r.qty) || 0;
}

/** Прихід із розмірами. Дивимось спершу на сам документ, і лише
 *  потім на товар: сітку могли прибрати з картки вже після того,
 *  як прихід запланували. */
export function restockSized(r: Restock, p: Product | null): boolean {
  return !!(r.items || (p && isSized(p)));
}

/** Розміри для редагування приходу: з картки товару плюс ті, що
 *  вже вписані в цей прихід. */
export function restockEditSizes(r: Restock, p: Product | null): string[] {
  const carded = p && p.sizes && p.sizes.length ? p.sizes : ALL_SIZES;
  const inDoc = Object.keys(r.items || {});
  return ALL_SIZES.filter((s) => carded.includes(s) || inDoc.includes(s));
}

/** Приходи, які ще чекають. Порядок — той, у якому їх прочитали:
 *  за зростанням очікуваної дати, тобто найближчі згори. */
export function pendingRestocks(list: Restock[]): Restock[] {
  return list.filter((r) => r.status !== 'received');
}

/** Останні оприбутковані. Список іде за зростанням очікуваної
 *  дати, тож свіжі — в кінці; беремо їх і перевертаємо. Брати
 *  перші означало б показувати найдавніші прийоми, а щойно
 *  оприбуткований у блок не потрапляв би взагалі. */
export function lastReceived(list: Restock[], max = 10): Restock[] {
  return list
    .filter((r) => r.status === 'received')
    .slice(-max)
    .reverse();
}

export function restockOverdue(r: Restock, now: Date): boolean {
  return r.status !== 'received' && !!r.expected && r.expected < todayISO(now);
}

/* Кількість із форми: вручну вписати можна що завгодно, а в базу
   має піти ціле невідʼємне число. */
function count(v: unknown): number {
  return Math.max(0, Math.trunc(Number(v) || 0));
}

function positives(src: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  Object.keys(src || {}).forEach((k) => {
    const v = count((src as Record<string, number>)[k]);
    if (v > 0) out[k] = v;
  });
  return out;
}

/* ============================================================
   ЧЕРГА ПАРТІЙ: ЩО ПРИЙШЛО ПЕРШИМ, ТЕ Й ПРОДАЄТЬСЯ ПЕРШИМ
   ------------------------------------------------------------
   Питання, з якого це народилось: лишалось три пари по 300,
   приїхало десять по 330 — по чому рахувати ті три?

   Відповідь власника однозначна: залишок лишається за старою
   ціною, нова партія йде за новою. Це FIFO, і в товарному обліку
   він і є нормою: пари, куплені дешевше, справді принесли більшу
   маржу, і розмазувати її по наступних партіях — значить не
   бачити ані першої вигоди, ані подорожчання.

   ЩО ЛЕЖИТЬ У ЧЕРЗІ. Партії в порядку приходу: скільки одиниць і
   по чому. Продаж їсть її з голови: три по 300, далі десять по
   330. Розміри тут ні до чого — ціна закупівлі однакова для
   всієї партії, а скільки саме розмірів у ній, склад знає й так.

   ДЕ ЛЕЖИТЬ. Окремим документом stock_costs/{товар}, а не в
   картці товару. Причина не в стрункості: картку публікують, і
   кожна зміна в ній піднімає кнопку «Опублікувати». Прихід
   товару до публікації каталогу не має жодного стосунку.
   ============================================================ */

export const COSTS_COL = 'stock_costs';

export interface CostBatch {
  /** Скільки одиниць цієї партії ще не продано. */
  qty: number;
  /** По чому куплена одиниця. */
  cost: number;
  /** Коли оприбуткована — щоб черга читалась очима. */
  at: string;
}

export interface CostQueue {
  batches: CostBatch[];
}

export function emptyQueue(): CostQueue {
  return { batches: [] };
}

/** Додати партію в кінець черги. */
export function pushBatch(q: CostQueue, qty: number, cost: number, at: string): CostQueue {
  const units = Math.max(0, Math.round(qty));
  const price = Math.max(0, Math.round(cost));
  if (!units || !price) return q;
  return { batches: [...(q.batches || []), { qty: units, cost: price, at }] };
}

/** Продаж: беремо потрібне з голови черги.
 *
 *  Повертає нову чергу й СЕРЕДНЮ ціну одиниці саме цього продажу
 *  — коли він перетнув межу партій, у ньому справді дві ціни, і
 *  чесно віддати одну можна тільки так. Число заморожується в
 *  замовленні, тож далі воно вже не зміниться ніколи.
 *
 *  Черга скінчилась, а товар продається — так буває: щось
 *  оприбуткували без ціни, щось лежало ще до цієї механіки.
 *  Тоді беремо ціну останньої відомої партії, а як і її немає —
 *  кажемо про це нулем, і аналітика такий товар просто не рахує
 *  в маржу. Вигадувати тут не можна. */
export function takeUnits(q: CostQueue, qty: number): { queue: CostQueue; unit: number } {
  const need = Math.max(0, Math.round(qty));
  const batches = (q.batches || []).map((b) => ({ ...b }));
  if (!need) return { queue: { batches }, unit: 0 };

  let left = need;
  let spent = 0;
  let taken = 0;

  while (left > 0 && batches.length) {
    const head = batches[0];
    const take = Math.min(head.qty, left);
    spent += take * head.cost;
    taken += take;
    head.qty -= take;
    left -= take;
    if (head.qty <= 0) batches.shift();
  }

  /* Не вистачило черги — решту рахуємо останньою відомою ціною. */
  if (left > 0) {
    const last = spent && taken ? Math.round(spent / taken) : lastKnown(q);
    if (last) {
      spent += left * last;
      taken += left;
    }
  }

  return { queue: { batches }, unit: taken ? Math.round(spent / taken) : 0 };
}

function lastKnown(q: CostQueue): number {
  const list = q.batches || [];
  return list.length ? list[list.length - 1].cost : 0;
}

/** Повернення: одиниці стають знову першими в черзі — вони й
 *  були найстарішими. Без цього скасоване замовлення тихо
 *  вкрало б у магазину дешеву партію. */
export function giveBack(q: CostQueue, qty: number, cost: number, at: string): CostQueue {
  const units = Math.max(0, Math.round(qty));
  const price = Math.max(0, Math.round(cost));
  if (!units || !price) return q;
  return { batches: [{ qty: units, cost: price, at }, ...(q.batches || [])] };
}

/** Скільки коштує наступна одиниця — для картки товару й для
 *  замовлень, яким черга нічого не сказала. */
export function headCost(q: CostQueue): number {
  const list = (q.batches || []).filter((b) => b.qty > 0);
  return list.length ? list[0].cost : lastKnown(q);
}

/** Скільки грошей лежить на складі цього товару. */
export function queueValue(q: CostQueue): number {
  return (q.batches || []).reduce((n, b) => n + Math.max(0, b.qty) * Math.max(0, b.cost), 0);
}

/** Черга з бази. Немає документа — складаємо початкову з того,
 *  що вже лежить на складі й що вписано в картці товару: інакше
 *  перший же прихід зробив би вигляд, ніби до нього магазин не
 *  торгував нічим. */
export async function readQueue(
  w: { db: Firestore },
  pid: string,
  s?: StockState
): Promise<CostQueue> {
  try {
    const snap = await getDoc(doc(w.db, COSTS_COL, pid));
    if (snap.exists()) {
      const box = snap.data() as CostQueue;
      if (Array.isArray(box.batches)) return { batches: box.batches.filter((b) => b && b.qty > 0) };
    }
  } catch {
    /* немає прав або звʼязку — краще порожня черга, ніж падіння */
  }

  const p = s ? productById(s, pid) : null;
  const cost = Math.max(0, Math.round(Number(p?.cost) || 0));
  const have = p && s ? totalQty(s, p) : 0;
  return cost > 0 && have > 0 ? { batches: [{ qty: have, cost, at: '' }] } : emptyQueue();
}

/** Тіло документа restocks/*. created і by дописує сам запис. */
export interface RestockDoc {
  productId: string;
  productName: string;
  expected: string;
  note: string;
  status: 'pending';
  items?: Record<string, number>;
  qty?: number;
  cost?: number;
}

export interface RestockInput {
  productId: string;
  /** Порожньо — сьогодні. */
  expected: string;
  note: string;
  sizes?: Record<string, number>;
  qty?: number;
  /** Скільки коштує одиниця в цій партії. Порожньо — лишається
   *  та, що була. */
  cost?: number;
}

export type RestockPlan = { ok: true; doc: RestockDoc } | { ok: false; message: string };

export function planRestock(s: StockState, input: RestockInput, now: Date): RestockPlan {
  const p = productById(s, input.productId);
  if (!p) return { ok: false, message: 'Оберіть товар' };

  const cost = Math.max(0, Math.round(Number(input.cost) || 0));
  const base: RestockDoc = {
    productId: input.productId,
    productName: p.name,
    expected: input.expected || todayISO(now),
    note: input.note.trim(),
    status: 'pending',
    ...(cost > 0 ? { cost } : {})
  };

  if (isSized(p, s)) {
    const items = positives(input.sizes);
    if (!Object.keys(items).length) {
      return { ok: false, message: 'Вкажіть кількість хоча б для одного розміру' };
    }
    return { ok: true, doc: { ...base, items } };
  }

  const v = count(input.qty);
  if (!v) return { ok: false, message: 'Вкажіть кількість' };
  return { ok: true, doc: { ...base, qty: v } };
}

/** Результат дії над приходами. restocks — список, перечитаний
 *  із бази вже після запису; якщо перечитати не вдалося, тут буде
 *  той самий список, який передали, — так само поводився старий
 *  loadRestocks, що при помилці лишав кеш недоторканим. */
export type RestockWriteResult =
  | { ok: true; restocks: Restock[] }
  | { ok: false; message: string };

export async function createRestock(
  w: StockWriter,
  s: StockState,
  restocks: Restock[],
  input: RestockInput,
  now: Date
): Promise<RestockWriteResult> {
  const plan = planRestock(s, input, now);
  if (!plan.ok) return plan;

  try {
    await addDoc(collection(w.db, RESTOCKS_COL), {
      ...plan.doc,
      created: serverTimestamp(),
      by: w.by
    });
    return { ok: true, restocks: await refreshEta(w, restocks, input.productId) };
  } catch {
    return { ok: false, message: 'Не вдалося зберегти прихід' };
  }
}

export interface RestockEditInput {
  expected: string;
  note: string;
  /** Не null — прихід редагують по розмірах. Порожній обʼєкт теж
   *  означає розміри: гілку обирає форма, а не заповненість. */
  sizes?: Record<string, number> | null;
  qty?: number;
}

export interface RestockUpdate {
  expected: string;
  note: string;
  /** null — поле треба ПРИБРАТИ з документа: прихід переїхав
   *  із розмірів на штуки або навпаки, і залишок старого поля
   *  оприбуткувався б удруге. */
  items: Record<string, number> | null;
  qty: number | null;
}

export type RestockEditPlan =
  | { ok: true; update: RestockUpdate }
  | { ok: false; message: string };

export function planRestockEdit(input: RestockEditInput, now: Date): RestockEditPlan {
  const expected = input.expected || todayISO(now);
  const note = input.note.trim();

  if (input.sizes) {
    const items = positives(input.sizes);
    if (!Object.keys(items).length) {
      return { ok: false, message: 'Вкажіть кількість хоча б для одного розміру' };
    }
    return { ok: true, update: { expected, note, items, qty: null } };
  }

  const v = count(input.qty);
  if (!v) return { ok: false, message: 'Вкажіть кількість' };
  return { ok: true, update: { expected, note, items: null, qty: v } };
}

/** Оприбутковується саме та кількість, яку тут збережуть, — тому
 *  редагування приходу міняє й дату очікування на сайті. */
export async function saveRestockEdit(
  w: StockWriter,
  restocks: Restock[],
  r: Restock,
  input: RestockEditInput,
  now: Date
): Promise<RestockWriteResult> {
  const plan = planRestockEdit(input, now);
  if (!plan.ok) return plan;

  const u = plan.update;
  try {
    await updateDoc(doc(w.db, RESTOCKS_COL, r._id), {
      expected: u.expected,
      note: u.note,
      items: u.items === null ? deleteField() : u.items,
      qty: u.qty === null ? deleteField() : u.qty
    });
    return { ok: true, restocks: await refreshEta(w, restocks, r.productId) };
  } catch {
    return { ok: false, message: 'Не вдалося зберегти прихід' };
  }
}

export async function deleteRestock(
  w: StockWriter,
  restocks: Restock[],
  r: Restock
): Promise<RestockWriteResult> {
  try {
    await deleteDoc(doc(w.db, RESTOCKS_COL, r._id));
    return { ok: true, restocks: await refreshEta(w, restocks, r.productId) };
  } catch {
    return { ok: false, message: 'Немає прав' };
  }
}

/* ---------- Оприбуткування ---------- */

export interface ReceivePlanOk {
  ok: true;
  /** Яку гілку писати. 'none' — прихід порожній: залишків він не
   *  змінить, але документ inventory однаково зʼявиться, і товар
   *  із цієї миті вважається обліковим. */
  mode: 'sizes' | 'qty' | 'none';
  sizes: Record<string, number>;
  qty: number;
  moves: MoveEntry[];
  /** Розміри, які повертаються в наявність із нуля; null — писати
   *  підписникам нема про що. Порожній масив означає «товар без
   *  сітки знову є». */
  back: string[] | null;
}

export type ReceivePlan = ReceivePlanOk | { ok: false; message: string };

export function planReceive(s: StockState, r: Restock): ReceivePlan {
  /* Товар міг стати комплектом після створення приходу —
     власного складу в нього більше немає */
  const p = productById(s, r.productId);
  if (isSetOf(s, p)) {
    return {
      ok: false,
      message:
        '«' + (p ? p.name : r.productId) +
        '» тепер комплект — прихід оприбутковують по складниках'
    };
  }

  const name = r.productName || (p && p.name) || r.productId;
  const moves: MoveEntry[] = [];
  const sizes: Record<string, number> = {};
  let qty = 0;
  let mode: ReceivePlanOk['mode'] = 'none';

  if (r.items) {
    mode = 'sizes';
    Object.keys(r.items).forEach((size) => {
      const v = Number(r.items![size]) || 0;
      if (!v) return;
      sizes[size] = v;
      moves.push({
        productId: r.productId,
        productName: name,
        size: size,
        delta: v,
        reason: 'restock',
        ref: r.note || ''
      });
    });
  } else if (r.qty) {
    mode = 'qty';
    qty = Number(r.qty) || 0;
    moves.push({
      productId: r.productId,
      productName: name,
      size: null,
      delta: qty,
      reason: 'restock',
      ref: r.note || ''
    });
  }

  /* Які розміри зараз по нулях — саме вони «повертаються
     в наявність». Питати кеш можна лише ДО запису: після коміту
     він ще якийсь час показує старі числа, і жоден розмір уже не
     виглядав би нульовим. */
  const cameBack = r.items
    ? Object.keys(r.items).filter(
        (sz) => (Number(r.items![sz]) || 0) > 0 && sizeQty(s, r.productId, sz) <= 0
      )
    : null;
  const unitBack = !r.items && (Number(r.qty) || 0) > 0 && unitQty(s, r.productId) <= 0;

  return {
    ok: true,
    mode,
    sizes,
    qty,
    moves,
    back: (cameBack && cameBack.length) || unitBack ? cameBack || [] : null
  };
}

export type ReceiveResult =
  | { ok: true; restocks: Restock[]; back: string[] | null }
  | { ok: false; message: string };

/** Оприбуткування пише залишки повз writeStock навмисно: воно
 *  завжди торкається документа inventory, навіть коли додавати
 *  нічого. Так товар, у якого обліку ще не було, з цієї миті
 *  вважається обліковим — і сайт починає показувати живі числа. */
export async function receiveRestock(
  w: StockWriter,
  s: StockState,
  restocks: Restock[],
  r: Restock
): Promise<ReceiveResult> {
  const plan = planReceive(s, r);
  if (!plan.ok) return plan;

  try {
    const batch = writeBatch(w.db);
    const upd: Record<string, unknown> = { updated: serverTimestamp() };

    if (plan.mode === 'sizes') {
      const sizes: Record<string, unknown> = {};
      Object.keys(plan.sizes).forEach((size) => {
        sizes[size] = increment(plan.sizes[size]);
      });
      upd.sizes = sizes;
    } else if (plan.mode === 'qty') {
      upd.qty = increment(plan.qty);
    }

    logMoves(w, batch, plan.moves);
    batch.set(doc(w.db, INVENTORY_COL, r.productId), upd, { merge: true });

    /* Нова партія — нова собівартість.

       Саме тут вона й змінюється насправді: товар приїхав за
       іншою ціною, і від цієї хвилини кожен наступний продаж
       коштує магазину інакше. Пишемо в ЧЕРНЕТКУ товару, і
       публікації для цього не потрібно — у відкритий каталог це
       число не потрапляє взагалі.

       Уже виконані замовлення від цього не змінюються: у них
       собівартість заморожена в мить продажу. Партія міняє
       майбутнє, а не минуле. */
    const batchCost = Math.max(0, Math.round(Number(r.cost) || 0));
    if (batchCost > 0) {
      const add = plan.mode === 'sizes'
        ? Object.values(plan.sizes).reduce((n, v) => n + (Number(v) || 0), 0)
        : plan.qty;
      const was = await readQueue(w, r.productId, s);
      const next = pushBatch(was, add, batchCost, todayISO(new Date()));
      batch.set(doc(w.db, COSTS_COL, r.productId), next, { merge: false });
    }

    batch.update(doc(w.db, RESTOCKS_COL, r._id), {
      status: 'received',
      receivedAt: serverTimestamp(),
      receivedBy: w.by
    });
    await batch.commit();

    return {
      ok: true,
      restocks: await refreshEta(w, restocks, r.productId),
      back: plan.back
    };
  } catch {
    return { ok: false, message: 'Не вдалося оприбуткувати' };
  }
}

/* ---------- «Очікується ~дата» для сайту ----------
   З усіх запланованих приходів товару рахуємо найближчу дату по
   кожному розміру і кладемо в публічний документ restock_eta/{id}.
   Сайт показує «Очікується ~15 серпня» на розпроданих розмірах.
   Кількості й нотатки за межі адмінки не виходять. */

export interface RestockEta {
  /** Найближчий прихід узагалі — для товару без сітки. */
  any: string;
  sizes: Record<string, string>;
}

/** null — запланованих приходів немає: документ треба прибрати,
 *  інакше сайт обіцяв би дату, якої вже ніхто не чекає. */
export function planRestockEta(restocks: Restock[], pid: string): RestockEta | null {
  const pending = restocks.filter((r) => r.productId === pid && r.status === 'pending');
  if (!pending.length) return null;

  const sizes: Record<string, string> = {};
  let any = '';
  pending.forEach((r) => {
    const d = r.expected || '';
    if (!d) return;
    if (!any || d < any) any = d;
    Object.keys(r.items || {}).forEach((sz) => {
      if (!sizes[sz] || d < sizes[sz]) sizes[sz] = d;
    });
  });

  return { any, sizes };
}

export async function syncRestockEta(
  w: StockWriter,
  restocks: Restock[],
  pid: string
): Promise<void> {
  if (!pid) return;
  try {
    const eta = planRestockEta(restocks, pid);
    if (!eta) {
      await deleteDoc(doc(w.db, ETA_COL, pid)).catch(() => {});
      return;
    }
    await setDoc(doc(w.db, ETA_COL, pid), { ...eta, updated: serverTimestamp() });
  } catch {
    /* некритично: сайт просто не покаже дату */
  }
}

/* Після кожної дії над приходами список перечитується з бази, і
   вже з нього рахується дата для сайту: рахувати з памʼяті означало
   б обіцяти покупцю прихід, який щойно видалили. Якщо перечитати
   не вдалось — лишається те, що було, як і в старій адмінці. */
async function refreshEta(w: StockWriter, current: Restock[], pid: string): Promise<Restock[]> {
  const fresh = await loadRestocks(w.db);
  const list = fresh ?? current;
  await syncRestockEta(w, list, pid);
  return list;
}

/* ============================================================
   СПИСАННЯ
   ------------------------------------------------------------
   Списання діє одразу: чекати нема чого, річ уже зіпсувалась.
   Окремого документа не створюємо — воно не «очікується».
   ============================================================ */

export type WriteoffReason =
  | 'damaged'
  | 'defect'
  | 'lost'
  | 'supplier'
  | 'gift'
  | 'recount'
  | 'other';

/* Причина потрапляє в журнал руху — потім видно, скільки
   втрачено на браку, а скільки просто загубилось. */
export const WRITEOFF_REASONS: { id: WriteoffReason; title: string }[] = [
  { id: 'damaged', title: 'Зіпсувався' },
  { id: 'defect', title: 'Брак від виробника' },
  { id: 'lost', title: 'Загубився / недостача' },
  { id: 'supplier', title: 'Повернуто постачальнику' },
  { id: 'gift', title: 'Подарунок / зразок' },
  { id: 'recount', title: 'Перерахунок' },
  { id: 'other', title: 'Інше' }
];

export function writeoffTitle(reason: string): string {
  return WRITEOFF_REASONS.find((r) => r.id === reason)?.title || 'Списання';
}

export interface WriteoffInput {
  productId: string;
  reason: WriteoffReason;
  note: string;
  sizes?: Record<string, number>;
  qty?: number;
}

export interface WriteoffPlanOk {
  ok: true;
  product: Product;
  total: number;
  title: string;
  /** Що побачать у журналі: причина й нотатка. */
  ref: string;
  /** Розміри (або «шт»), яких списують більше, ніж є. Порожньо —
   *  питати нічого не треба. */
  over: string[];
  /** Текст попередження про мінус — показувати, коли over не порожній. */
  overWarning: string;
  /** Підтвердження самого списання. */
  confirm: string;
  plan: StockPlan;
}

export type WriteoffPlan = WriteoffPlanOk | { ok: false; message: string };

/** Списати більше, ніж є, зазвичай означає помилку в цифрі —
 *  але не завжди: товар могли продати повз систему. Тому це
 *  питання, а не заборона. */
export function planWriteoff(s: StockState, input: WriteoffInput): WriteoffPlan {
  const pid = input.productId;
  const p = productById(s, pid);
  if (!p) return { ok: false, message: 'Оберіть товар' };
  if (isSetOf(s, p)) {
    return { ok: false, message: 'Комплект не списують — списують його складники' };
  }

  const title = writeoffTitle(input.reason);
  const note = input.note.trim();
  const ref = title + (note ? ' · ' + note : '');

  const sized = isSized(p, s);
  const sizes = sized ? positives(input.sizes) : {};
  const qty = sized ? 0 : count(input.qty);
  const total = sized
    ? Object.keys(sizes).reduce((n, k) => n + sizes[k], 0)
    : qty;

  if (!total) return { ok: false, message: 'Вкажіть кількість для списання' };

  const over = sized
    ? Object.keys(sizes).filter((sz) => hasInvDoc(s, pid) && sizes[sz] > sizeQty(s, pid, sz))
    : hasInvDoc(s, pid) && qty > unitQty(s, pid)
      ? ['шт']
      : [];

  const plan: StockPlan = { groups: { [pid]: { sizes: {}, qty: 0 } }, moves: [] };
  if (sized) {
    Object.keys(sizes).forEach((sz) => {
      plan.groups[pid].sizes[sz] = -sizes[sz];
      plan.moves.push({
        productId: pid,
        productName: p.name,
        size: sz,
        delta: -sizes[sz],
        reason: 'writeoff',
        ref: ref
      });
    });
  } else {
    plan.groups[pid].qty = -qty;
    plan.moves.push({
      productId: pid,
      productName: p.name,
      size: null,
      delta: -qty,
      reason: 'writeoff',
      ref: ref
    });
  }

  return {
    ok: true,
    product: p,
    total,
    title,
    ref,
    over,
    overWarning:
      'Списуєте більше, ніж є на складі: ' + over.join(', ') + '.\n\n' +
      'Залишок піде в мінус — так буває, коли товар продали повз систему. Продовжити?',
    confirm:
      'Списати ' + total + ' шт «' + p.name + '» зі складу?\n\nПричина: ' + title +
      (note ? '\nНотатка: ' + note : ''),
    plan
  };
}

export async function createWriteoff(w: StockWriter, plan: WriteoffPlanOk): Promise<StockResult> {
  try {
    const batch = writeBatch(w.db);
    applyStockPlan(w, batch, plan.plan);
    await batch.commit();
    return { ok: true };
  } catch {
    return { ok: false, message: 'Не вдалося списати — перевірте права' };
  }
}

/* ============================================================
   ЧИТАННЯ З БАЗИ
   ============================================================ */

/** Залишки читаємо підпискою: магазин ведуть удвох, і прихід,
 *  оприбуткований із телефона, має зʼявитись на ноутбуці сам. */
export function watchInventory(
  db: Firestore,
  onChange: (inv: Stock) => void,
  onError?: (e: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, INVENTORY_COL),
    (snap) => {
      const inv: Stock = {};
      snap.forEach((d) => {
        inv[d.id] = d.data() as StockEntry;
      });
      onChange(inv);
    },
    (e) => onError?.(e)
  );
}

/** null — прочитати не вдалося. Порожній список тут означав би
 *  «приходів немає», і адмінка стерла б дату очікування на сайті. */
export async function loadRestocks(db: Firestore): Promise<Restock[] | null> {
  try {
    const snap = await getDocs(
      query(collection(db, RESTOCKS_COL), orderBy('expected'), limit(100))
    );
    return snap.docs.map((d) => ({ _id: d.id, ...d.data() }) as Restock);
  } catch {
    return null;
  }
}

export async function loadMoves(db: Firestore): Promise<Move[] | null> {
  try {
    const snap = await getDocs(
      query(collection(db, MOVES_COL), orderBy('ts', 'desc'), limit(400))
    );
    return snap.docs.map((d) => d.data() as Move);
  } catch {
    return null;
  }
}

/* ============================================================
   «ПОВІДОМИТИ, КОЛИ ЗʼЯВИТЬСЯ»
   ------------------------------------------------------------
   Підписки лежать у stock_alerts. Щойно розмір поповнився з нуля,
   шлемо лист і позначаємо підписку виконаною. Працює з сесії
   адміна: свого сервера в проєкту немає, а наявність зʼявляється
   саме в момент його дій.
   ============================================================ */

/** Адреса картки товару в листі. Веде на старий сайт, поки він
 *  живий: підписник має потрапити саме на товар, який чекав, а не
 *  на головну — з новим доменом цей рядок доведеться замінити. */
/* Адреса товару в листі. Стара панель складала '#p/<id>' —
   тодішній сайт відкривав картку якорем. Тепер у товару є власна
   сторінка, і посилання з якорем привело б покупця просто на
   головну. */
export const ALERT_PRODUCT_URL = 'https://reyter.men/p/';

export interface StockAlert {
  productId?: string;
  productName?: string;
  size?: string | null;
  email?: string;
  lang?: string;
  notified?: boolean;
}

export interface StockAlertMail {
  to: string;
  product: string;
  size: string;
  image: string;
  url: string;
  lang: string;
}

export interface StockAlertDeps {
  db: Firestore;
  /** Лист шле той самий воркер, що й підтвердження замовлення.
   *  notify.ts такого відправника поки не має, тож він приходить
   *  аргументом — і заразом дає змогу перевірити розсилку, нікому
   *  нічого не надсилаючи. */
  send: (mail: StockAlertMail) => Promise<boolean>;
}

export interface AlertsSent {
  productId: string;
  productName: string;
  sent: number;
  /** true — писали підписникам комплекту, а не самого товару. */
  isSet: boolean;
}

function alertsQuery(db: Firestore, pid: string) {
  return query(
    collection(db, ALERTS_COL),
    where('productId', '==', pid),
    where('notified', '==', false),
    limit(50)
  );
}

/** Розсилка по одному товару. Помилку ковтаємо: воркер може бути
 *  не налаштований, а прихід від цього скасовувати безглуздо. */
export async function notifyStockAlerts(
  deps: StockAlertDeps,
  s: StockState,
  pid: string,
  sizesBackInStock: string[] | null
): Promise<AlertsSent[]> {
  const out: AlertsSent[] = [];
  const p = productById(s, pid);

  try {
    const snap = await getDocs(alertsQuery(deps.db, pid));
    /* Виходимо зовсім, а не пропускаємо гілку: якщо на сам товар
       ніхто не підписаний, комплекти теж не перевіряємо — так було
       в оригіналі, і на цьому тримається його швидкодія. */
    if (snap.empty) return out;

    const backAll = !sizesBackInStock || !sizesBackInStock.length;
    const hits = snap.docs.filter((d) => {
      const a = d.data() as StockAlert;
      return backAll || !a.size || (sizesBackInStock as string[]).includes(a.size);
    });
    if (!hits.length) return out;

    let sent = 0;
    for (const d of hits) {
      const a = d.data() as StockAlert;
      const ok = await deps.send({
        to: a.email || '',
        product: a.productName || (p && p.name) || pid,
        size: a.size || '',
        image: (p && (p.images || [])[0]) || '',
        url: ALERT_PRODUCT_URL + encodeURIComponent(pid),
        lang: a.lang || 'uk'
      });
      if (ok) {
        await updateDoc(d.ref, { notified: true, notifiedAt: serverTimestamp() });
        sent++;
      }
    }
    out.push({ productId: pid, productName: (p && p.name) || pid, sent, isSet: false });
  } catch {
    /* воркер не налаштований — тихо */
  }

  // Прихід складника міг «зібрати» комплект — тим, хто чекав
  // на комплект, теж треба написати
  return out.concat(await notifySetAlerts(deps, s, pid, sizesBackInStock));
}

/** Комплекти, до складу яких входить товар і які після цього
 *  приходу знову можна зібрати. */
export async function notifySetAlerts(
  deps: StockAlertDeps,
  s: StockState,
  pid: string,
  sizes: string[] | null
): Promise<AlertsSent[]> {
  const sets = s.products.filter((x) => isSetOf(s, x) && (x.set || []).includes(pid));
  if (!sets.length) return [];

  const out: AlertsSent[] = [];
  for (const set of sets) {
    /* Кеш залишків оновиться знімком із бази лише за мить, тож про
       щойно оприбуткований складник питати його не можна. Він за
       визначенням у наявності — перевіряємо решту. */
    const others = setPartsOf(s, set).filter((x) => x.id !== pid);
    const back = (sizes && sizes.length ? sizes : ALL_SIZES).filter((sz) =>
      others.every((x) => {
        if (!hasInvDoc(s, x.id)) return true; // облік не ведеться
        return (isSized(x) ? sizeQty(s, x.id, sz) : unitQty(s, x.id)) > 0;
      })
    );
    if (!back.length) continue;
    out.push(await notifyStockAlertsFor(deps, set, back));
  }
  return out;
}

/** Та сама розсилка, але без повторного заходу в комплекти —
 *  інакше два комплекти з одним складником зациклили б одне одного. */
export async function notifyStockAlertsFor(
  deps: StockAlertDeps,
  p: Product,
  sizesBackInStock: string[]
): Promise<AlertsSent> {
  let sent = 0;
  try {
    const snap = await getDocs(alertsQuery(deps.db, p.id));
    if (snap.empty) return { productId: p.id, productName: p.name, sent, isSet: true };

    const hits = snap.docs.filter((d) => {
      const a = d.data() as StockAlert;
      return !a.size || sizesBackInStock.includes(a.size);
    });

    for (const d of hits) {
      const a = d.data() as StockAlert;
      const ok = await deps.send({
        to: a.email || '',
        product: a.productName || p.name,
        size: a.size || '',
        image: (p.images || [])[0] || '',
        url: ALERT_PRODUCT_URL + encodeURIComponent(p.id),
        lang: a.lang || 'uk'
      });
      if (ok) {
        await updateDoc(d.ref, { notified: true, notifiedAt: serverTimestamp() });
        sent++;
      }
    }
  } catch {
    /* тихо */
  }
  return { productId: p.id, productName: p.name, sent, isSet: true };
}
