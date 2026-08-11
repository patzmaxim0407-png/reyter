/* ============================================================
   REYTER — замовлення в адмінці
   ------------------------------------------------------------
   Портовано з js/admin.js (другий модуль) один в один: список
   замовлень, фільтри, статистика, зміна статусу, вивантаження
   й ручне створення замовлення.

   Замовлення — єдина річ в адмінці, яку не можна перемалювати
   заново: за нею їдуть гроші й товар. Тому кожна перевірка,
   кожне питання адміну й кожен запис у журнал перенесені
   дослівно, разом із формулюваннями — вони і є поведінка.

   Розмітки тут немає: старий модуль сам збирав картку, сам
   малював фільтри, сам відкривав вікно друку. Сюди переїхали
   лише рішення — які замовлення показати, що вважати
   розбіжністю, що саме лягає в документ і що спитати перед тим,
   як чіпати склад.

   Дві речі приходять ззовні навмисно:
   • СКЛАД. Списання, повернення й журнал руху живуть у stock.ts
     і викликаються звідси напряму. Другого примірника тих
     правил тут немає й бути не може: одна розбіжність — і
     залишки перестають збігатися з фактом.
   • ПИТАННЯ АДМІНУ. «Повернути товар на склад?» — це діалог,
     тобто DOM. Текст питання лишається тут (він частина
     поведінки), а показує його викликач через OrderDialogs.

   Час і випадковість теж аргументи: без цього ні номер
   замовлення, ні запис у журналі не перевірити.
   ============================================================ */

import {
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
  writeBatch,
  type FieldValue,
  type Firestore,
  type Timestamp
} from 'firebase/firestore';

import { addressLine, type Address } from '../address';
import { ALL_SIZES, setParts, type Catalogue } from '../catalog';
import { orderNumber, type Confirm, type Customer } from '../order';
import {
  promoCheck,
  promoMessage,
  promoNormalize,
  promoTerms,
  type Promo,
  type PromoItem,
  type PromoText
} from '../promo';
import { SITE_CONFIG } from '../site-config';
import { phoneTail, trackCreate, trackDelete, trackKey, trackUpdate } from '../track';
import type { OrderItem, OrderStatus } from '../types';
import {
  adjustOrderStock,
  applyStockPlan,
  collectStock,
  consumesStock,
  emptyPlan,
  stockShortage,
  writeoffTitle,
  WRITEOFF_REASONS,
  type StockState,
  type StockWriter
} from './stock';

/* Номер замовлення рахує order.ts — той самий, що й на сайті.
   Формат «R-РРММДД-NNN» зашитий у ключ відстеження і в очі
   покупця: два різні генератори рано чи пізно розійшлися б. */
export { orderNumber };

export const ORDER_COL = 'orders';

/* ============================================================
   СТАТУСИ
   ============================================================ */

export interface AdminStatus {
  id: OrderStatus;
  title: string;
}

/* Ті самі статуси, що в data.js старого сайту (R.config
   .orderStatuses). Підписи українські й без i18n: адмінку
   ведуть удвох, обидва українською, а от у документі замовлення
   лежить саме id — його перекладає вже кабінет покупця. */
export const STATUSES: readonly AdminStatus[] = SITE_CONFIG.orderStatuses.map((s) => ({
  id: s.id,
  title: s.title
}));

/** Статус приходить із бази, де полем може бути будь-що
 *  (або нічого) — незнайоме показуємо як перший крок. */
export function statusInfo(id: string | null | undefined): AdminStatus {
  return STATUSES.find((s) => s.id === id) ?? STATUSES[0];
}

/* Які статуси списують товар — знає stock.ts (consumesStock).
   Тут цього переліку немає навмисно: списання й перехід статусу
   мусять відповідати на це питання однаково. */

/** Наступний крок у життєвому циклі — для кнопки швидкої дії.
 *  У 'done' і 'cancelled' наступного кроку немає: шлях скінчився. */
export const NEXT_STEP: Partial<Record<OrderStatus, { id: OrderStatus; label: string }>> = {
  new: { id: 'confirmed', label: 'Підтвердити' },
  confirmed: { id: 'shipped', label: 'Відправлено' },
  shipped: { id: 'done', label: 'Виконано' }
};


/* ============================================================
   ЧЕРГА СПРАВ
   ------------------------------------------------------------
   Головне питання робочого вікна — не «які в мене замовлення»,
   а «що зробити просто зараз». Тому список групується не за
   статусом, а за дією: підтвердити, зібрати, вписати номер,
   розібратися з тим, що лежить, закрити отримане.

   Порядок смуг жорсткий і не міняється ніколи: рука памʼятає
   місце, а не число. Порожня смуга не зникає, а гасне — інакше
   екран перестрибує щоразу, коли остання справа закінчилась.

   Це чиста функція від документа замовлення й останнього знімка
   трекера. Жодної нової колекції, нічого зберігати не треба —
   отже, і розсинхронізуватись нема чому.
   ============================================================ */

export type BandId = 'confirm' | 'pack' | 'ttn' | 'waiting' | 'back' | 'close' | 'transit';

export interface Band {
  id: BandId;
  icon: string;
  title: string;
  /** Що робить головна кнопка рядка. */
  action: string;
}

export const BANDS: readonly Band[] = [
  { id: 'confirm', icon: '☎', title: 'Підтвердити', action: 'Підтвердити' },
  { id: 'pack', icon: '📦', title: 'Зібрати й відправити', action: 'Відправити' },
  { id: 'ttn', icon: '🔖', title: 'Без номера накладної', action: 'Вписати ТТН' },
  { id: 'back', icon: '↩', title: 'Повернення й помилки', action: 'Розібратись' },
  { id: 'waiting', icon: '⏳', title: 'Лежить у відділенні', action: 'Нагадати' },
  { id: 'close', icon: '✓', title: 'Отримано — можна закрити', action: 'Закрити' },
  { id: 'transit', icon: '🚚', title: 'У дорозі', action: '' }
];

export interface Task {
  band: BandId;
  /** Скільки годин замовлення чекає цієї дії. */
  hours: number;
  /** 0 — спокій, 1 — увага, 2 — горить. */
  urgency: 0 | 1 | 2;
  /** Рядок під номером: чому воно тут. */
  why: string;
}

/** Стан посилки в тому вигляді, в якому він потрібен черзі. */
export interface ParcelHint {
  code?: string;
  waiting?: number;
  gotAt?: string;
}

const ГОДИНА = 3_600_000;

/** Яка справа за цим замовленням. null — його місце в архіві. */
export function nextTask(
  o: AdminOrder,
  parcel?: ParcelHint | null,
  now: Date = new Date(),
  пороги = { увага: 3, біда: 5, новеГодин: 4 }
): Task | null {
  const st = o.status || 'new';
  if (st === 'done' || st === 'cancelled') return null;

  const від = orderDate(o);
  const hours = від ? Math.max(0, Math.floor((now.getTime() - від.getTime()) / ГОДИНА)) : 0;

  if (st === 'new') {
    return {
      band: 'confirm',
      hours,
      /* Нове замовлення, яке висить пів дня, — це людина, яка вже
         почала сумніватись. */
      urgency: hours >= пороги.новеГодин * 3 ? 2 : hours >= пороги.новеГодин ? 1 : 0,
      why: hours ? 'чекає ' + годинами(hours) : 'щойно'
    };
  }

  if (st === 'confirmed') {
    return {
      band: 'pack',
      hours,
      urgency: hours >= 48 ? 2 : hours >= 24 ? 1 : 0,
      why: 'підтверджено ' + годинами(hours) + ' тому'
    };
  }

  // далі — тільки відправлені
  if (o.pickup) {
    return { band: 'close', hours, urgency: 0, why: 'самовиніс — чекає покупця' };
  }
  if (!String(o.ttn || '').trim()) {
    return { band: 'ttn', hours, urgency: 2, why: 'номера немає — покупець не знає, де посилка' };
  }

  const code = String(parcel?.code || '');
  const лежить = Number(parcel?.waiting) || 0;

  if (code === '9' || code === '10' || code === '11') {
    return { band: 'close', hours, urgency: 0, why: 'перевізник каже: отримано' };
  }
  if (code === '3') {
    return { band: 'back', hours, urgency: 2, why: 'перевізник не знає такого номера' };
  }
  if (['2', '102', '103', '105', '106', '111', '112'].includes(code)) {
    return { band: 'back', hours, urgency: 2, why: 'посилка повертається' };
  }
  if ((code === '7' || code === '8') && лежить >= пороги.увага) {
    return {
      band: 'waiting',
      hours,
      urgency: лежить >= пороги.біда ? 2 : 1,
      why: 'лежить у відділенні ' + лежить + ' дн.'
    };
  }

  return { band: 'transit', hours, urgency: 0, why: 'у дорозі' };
}

function годинами(h: number): string {
  if (h < 1) return 'щойно';
  if (h < 24) return h + ' год';
  const d = Math.floor(h / 24);
  return d + (d === 1 ? ' день' : d < 5 ? ' дні' : ' днів');
}

/** Черга: смуги з замовленнями, у сталому порядку. */
export function queue(
  list: AdminOrder[],
  parcels: Map<string, ParcelHint>,
  now: Date = new Date()
): { band: Band; rows: { order: AdminOrder; task: Task }[] }[] {
  const по: Record<string, { order: AdminOrder; task: Task }[]> = {};
  for (const o of list) {
    const t = nextTask(o, parcels.get(String(o.ttn || '').trim()), now);
    if (!t) continue;
    (по[t.band] ||= []).push({ order: o, task: t });
  }
  /* Усередині смуги — найтерміновіше зверху, а за рівної
     терміновості найстаріше: воно чекає найдовше. */
  for (const k of Object.keys(по)) {
    по[k].sort((a, b) => b.task.urgency - a.task.urgency || b.task.hours - a.task.hours);
  }
  return BANDS.map((band) => ({ band, rows: по[band.id] || [] }));
}

/** Скільки замовлень показуємо за раз. */
export const PAGE_SIZE = 25;
/** Розмір порції для масових дій. */
export const BULK_CHUNK = 20;

/* ============================================================
   ЗАМОВЛЕННЯ ТАК, ЯК ВОНО ЛЕЖИТЬ У БАЗІ
   ============================================================ */

export interface StatusLogEntry {
  status: OrderStatus;
  at: string;
  /** Пошта адміністратора, який перемкнув статус. */
  by: string;
}

/** Позначка «товар не повернувся на склад»: причина видно прямо
 *  в картці замовлення, а не лише в журналі руху. */
export interface WriteoffMark {
  reason: string;
  title: string;
  note: string;
  at: string;
  by: string;
}

/** Покупець у збереженому замовленні. Ті самі поля, що в
 *  order.ts, але всі необовʼязкові: замовлення лежать роками, і
 *  в найстаріших немає навіть пошти. */
export interface AdminCustomer extends Address {
  name?: string;
  phone?: string;
  email?: string;
  comment?: string;
  confirm?: Confirm;
  /** Спадок часів, коли закордонна адреса лежала плоскими
   *  полями, а не у вкладеному intl. */
  intlCity?: string;
  [key: string]: unknown;
}

/** Документ orders/<id> так, як його читає адмінка. Майже все
 *  необовʼязкове: поля дописували роками, і старі замовлення
 *  половини з них не мають. */
export interface AdminOrder {
  /** id документа — у самому документі його немає. */
  _id: string;
  num?: string;
  date?: string;
  /** Проставляє сервер. Є не всюди: у найперших замовленнях
   *  час був лише в date. */
  created?: Timestamp;
  status?: OrderStatus;
  statusLog?: StatusLogEntry[];
  items?: OrderItem[];
  subtotal?: number;
  discount?: number;
  shipping?: number;
  promoCode?: string;
  total?: number;
  customer?: AdminCustomer;
  email?: string;
  ttn?: string;
  /** Коли номер накладної пішов покупцеві листом. */
  ttnSentAt?: string;
  /** Покупець забирає сам — накладної не буде й не треба. */
  pickup?: boolean;
  /** Мовою якої сторінки оформлено замовлення. */
  lang?: string;
  note?: string;
  source?: string;
  uid?: string | null;
  trackKey?: string;
  message?: string;
  createdBy?: string;
  /** Товар за цим замовленням уже знято з залишків. */
  stockApplied?: boolean;
  /** Останній відкат: товар повернули в залишки чи ні. */
  stockReturned?: boolean;
  writeoff?: WriteoffMark;
}

/* Дата замовлення: date пише браузер покупця, created — сервер.
   Порядок саме такий, бо date є в кожному замовленні, а created
   зʼявився пізніше. Замовлення без обох дат стає на 1970 рік —
   не ховаємо його, а показуємо в самому кінці списку. */
export function orderDate(o: AdminOrder): Date {
  if (o.date) return new Date(o.date);
  if (o.created && typeof o.created.toDate === 'function') return o.created.toDate();
  return new Date(0);
}

/** Скільки штук товару в замовленні. */
export function orderUnits(o: AdminOrder): number {
  return (o.items || []).reduce((n, i) => n + (Number(i.qty) || 0), 0);
}

/* Гроші в адмінці. Це НЕ fmt із catalog.ts: там Number(n) без
   запобіжника, бо на сайті число завжди є. Сюди ж числа
   приходять із бази, де поля може не бути зовсім, і без «|| 0»
   у картці світилося б «NaN грн». */
function fmt(n: unknown): string {
  return (Number(n) || 0).toLocaleString('uk-UA');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localISO(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* ============================================================
   КАТАЛОГ ПІД РУКОЮ
   ------------------------------------------------------------
   Замовлення зберігає назви товарів, але не всі: категорію й
   склад комплекту в старих замовленнях доводиться підглядати
   в каталозі.
   ============================================================ */

/** Назва категорії. На відміну від catTitle із catalog.ts,
 *  невідома категорія показує свій id: у списку замовлень краще
 *  побачити «briefs», ніж порожнє місце й гадати, що зникло. */
export function catName(c: Catalogue, id?: string | null): string {
  const cat = (c.categories || []).find((x) => x.id === id);
  return cat ? cat.title : id || '';
}

/** Товар за артикулом; null — його вже немає в каталозі. */
function productById(c: Catalogue, id?: string | null) {
  return c.products.find((p) => p.id === id) || null;
}

/* Чи має товар розмір. Це НЕ isSized із catalog.ts: там ще й
   перевіряється непорожня сітка sizes. В адмінці «має розмір»
   означає лише «це не обʼєм» — товар без заповненої сітки має
   отримати попередження «оберіть розмір», а не мовчки
   зберегтися без нього. */
function isSized(p: { volume?: string } | null | undefined): boolean {
  return !!p && !p.volume;
}

/** Категорія позиції: у нових замовленнях вона збережена разом
 *  із назвою, у старих — беремо з каталогу, якщо товар ще там. */
export function itemCat(c: Catalogue, i: { id: string; category?: string }): string {
  if (i.category) return i.category;
  const p = productById(c, i.id);
  return p ? catName(c, p.category) : '';
}

/** Складник комплекту в одному рядку: категорія, назва, розмір. */
export function partLine(
  c: Catalogue,
  x: { id: string; name?: string; category?: string; size?: string | null }
): string {
  const cat = itemCat(c, x);
  return (cat ? cat + ' · ' : '') + (x.name || x.id) + (x.size ? ' · ' + x.size : '');
}

/* Як покупець просив із ним звʼязатися. Підписи месенджерів ті
   самі, що в order.ts, а от резервні слова — свої й з малої
   літери: у вивантаженні й на аркуші друку це середина рядка
   («дзвінок · +380…»), а не окремий підпис у кошику. */
const MSGR: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  viber: 'Viber'
};

export function confirmText(c: AdminCustomer | null | undefined): string {
  const cf = c?.confirm;
  if (!cf) return '';
  const phone = cf.phoneMode === 'other' && cf.altPhone ? cf.altPhone : c?.phone || '';
  const how = cf.method === 'messenger' ? MSGR[cf.messenger] || 'месенджер' : 'дзвінок';
  return [how, phone, cf.telegram ? '@' + cf.telegram : ''].filter(Boolean).join(' · ');
}

/* ============================================================
   ПЕРІОДИ Й ФІЛЬТРИ
   ============================================================ */

export type PeriodId = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all' | 'custom';
export type SortId = 'new' | 'old' | 'sum' | 'sumAsc';

export interface OrderFilters {
  /** 'all' або id статусу. */
  status: string;
  period: PeriodId;
  /** 'РРРР-ММ-ДД' — межі свого періоду. */
  from: string;
  to: string;
  search: string;
  sort: SortId;
  /** Скільки замовлень показано зараз. */
  limit: number;
}

export const DEFAULT_FILTERS: OrderFilters = {
  status: 'all',
  period: '30d',
  from: '',
  to: '',
  search: '',
  sort: 'new',
  limit: PAGE_SIZE
};

export interface PeriodRange {
  from: Date | null;
  /** Верхня межа НЕ включно: 'вчора' закінчується опівночі. */
  to: Date | null;
}

/** Межі обраного періоду. Рахуються від дня, а не від години:
 *  «7 днів» — це сім календарних днів разом із сьогоднішнім, а
 *  не 168 годин назад. */
export function periodRange(
  f: Pick<OrderFilters, 'period' | 'from' | 'to'>,
  now: Date
): PeriodRange {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(now);

  switch (f.period) {
    case 'today':
      return { from: today, to: null };
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: y, to: today };
    }
    case '7d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      return { from: d, to: null };
    }
    case '30d': {
      const d = new Date(today);
      d.setDate(d.getDate() - 29);
      return { from: d, to: null };
    }
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    case 'custom': {
      const from = f.from ? new Date(f.from + 'T00:00:00') : null;
      let to: Date | null = null;
      if (f.to) {
        to = new Date(f.to + 'T00:00:00');
        to.setDate(to.getDate() + 1); // включно з кінцевим днем
      }
      return { from: from, to: to };
    }
    default:
      return { from: null, to: null };
  }
}

export function inPeriod(
  o: AdminOrder,
  f: Pick<OrderFilters, 'period' | 'from' | 'to'>,
  now: Date
): boolean {
  const range = periodRange(f, now);
  if (!range.from && !range.to) return true;
  const d = orderDate(o);
  if (range.from && d < range.from) return false;
  if (range.to && d >= range.to) return false;
  return true;
}

/** Пошук по всьому, за чим менеджер шукає замовлення на слух:
 *  номер, імʼя, телефон, пошта, ТТН, місто, відділення й назви
 *  товарів — одним рядком. */
export function matchesSearch(o: AdminOrder, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  const c = o.customer || {};
  const items = (o.items || []).map((i) => i.name + ' ' + i.id).join(' ');
  const hay = [o.num, c.name, c.phone, c.email, o.email, o.ttn, c.city, c.branch, items]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

/** Замовлення в межах періоду — база для статистики і лічильників
 *  статусів. Саме тому статус і пошук сюди не входять: інакше
 *  «виручка за період» стрибала б від кожного натискання чіпа. */
export function periodOrders(
  orders: AdminOrder[],
  f: Pick<OrderFilters, 'period' | 'from' | 'to'>,
  now: Date
): AdminOrder[] {
  return orders.filter((o) => inPeriod(o, f, now));
}

/** Повністю відфільтровані та відсортовані. */
export function filteredOrders(orders: AdminOrder[], f: OrderFilters, now: Date): AdminOrder[] {
  const list = periodOrders(orders, f, now).filter((o) => {
    if (f.status !== 'all' && (o.status || 'new') !== f.status) return false;
    return matchesSearch(o, f.search);
  });

  return list.slice().sort((a, b) => {
    if (f.sort === 'old') return orderDate(a).getTime() - orderDate(b).getTime();
    if (f.sort === 'sum') return (b.total || 0) - (a.total || 0);
    if (f.sort === 'sumAsc') return (a.total || 0) - (b.total || 0);
    return orderDate(b).getTime() - orderDate(a).getTime();
  });
}

/* ============================================================
   СТАТИСТИКА
   ============================================================ */

export interface OrderStats {
  /** Скільки замовлень за період — разом зі скасованими. */
  count: number;
  /** Потребують уваги: ще нікому не передані. */
  newCount: number;
  /** Виручка без скасованих. */
  revenue: number;
  /** Середній чек, теж без скасованих. */
  avg: number;
  units: number;
  /** Відправлені посилки без номера накладної. */
  noTtn: number;
}

/* Скасовані рахуються лише в загальній кількості: гроші за ними
   не прийшли, і в середньому чеку вони б лише псували картину. */
export function orderStats(list: AdminOrder[]): OrderStats {
  const active = list.filter((o) => o.status !== 'cancelled');
  const revenue = active.reduce((s, o) => s + (Number(o.total) || 0), 0);
  return {
    count: list.length,
    newCount: list.filter((o) => (o.status || 'new') === 'new').length,
    revenue: revenue,
    avg: active.length ? Math.round(revenue / active.length) : 0,
    units: active.reduce((s, o) => s + orderUnits(o), 0),
    /* Скільки посилок уже в дорозі без номера. Це не статистика,
       а список справ: доки число не нуль, хтось із покупців не
       знає, де його замовлення. Виконані не рахуємо — там
       посилку вже забрали, і номер нічого не змінить. */
    noTtn: list.filter((o) => o.status === 'shipped' && !String(o.ttn || '').trim()).length
  };
}

/** Числа на чіпах статусів. 'all' — скільки всього в списку. */
export function statusCounts(list: AdminOrder[]): Record<string, number> {
  const counts: Record<string, number> = { all: list.length };
  STATUSES.forEach((s) => {
    counts[s.id] = list.filter((o) => (o.status || 'new') === s.id).length;
  });
  return counts;
}

/* Сума позицій має сходитися з тим, що прислав браузер.
   Розбіжність — привід перевірити замовлення вручну: або ціну
   змінили між кошиком і оплатою, або хтось підправив запит. */
export function orderMismatch(o: AdminOrder): string {
  if (!(o.items || []).length || o.subtotal === undefined) return '';
  const itemsSum = (o.items || []).reduce(
    (s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0),
    0
  );
  const sub = Number(o.subtotal) || 0;
  const off = Number(o.discount) || 0;
  const tot = Number(o.total) || 0;
  if (itemsSum !== sub) return 'сума позицій ' + fmt(itemsSum) + ' грн ≠ вказана ' + fmt(sub) + ' грн';
  // гривня різниці — це округлення відсоткової знижки, а не помилка
  if (Math.abs(sub - off - tot) > 1) return 'підсумок не сходиться';
  return '';
}

/* ============================================================
   СКЛАД І ПИТАННЯ АДМІНУ
   ============================================================ */

/* Складу потрібні ті самі дані, тільки під іншим кутом: товари
   й залишки, категорії — ні. Складаємо його стан із каталогу,
   щоб адмінка не тримала двох списків товарів, які можуть
   розʼїхатись. */
function stockState(c: Catalogue): StockState {
  return { products: c.products, inv: c.stock };
}

/** Питання адміну. Текст складається тут — він частина
 *  поведінки; малює вікно викликач. */
export interface Question {
  title: string;
  text: string;
  okText: string;
  /** Небезпечна дія: кнопка червона. */
  danger?: boolean;
  /** Третя кнопка — друге «так» з іншим наслідком. */
  altText?: string;
}

export interface WriteoffQuestion extends Question {
  /** Перелік для випадайки — той самий, що на сторінці складу. */
  reasons: readonly { id: string; title: string }[];
  /** Причина, обрана в списку спершу. */
  reason: string;
  label: string;
  placeholder: string;
}

export interface WriteoffAnswer {
  reason: string;
  note: string;
}

export interface OrderDialogs {
  /** true — згода, false — відмова. */
  confirmAsk(q: Question): Promise<boolean>;
  /** 'ok' — головна кнопка, 'alt' — третя, null — передумали. */
  ask(q: Question): Promise<'ok' | 'alt' | null>;
  /** null — передумали. */
  askWriteoff(q: WriteoffQuestion): Promise<WriteoffAnswer | null>;
  /** Запитати рядок. null — передумали, '' — лишили порожнім. */
  askText(q: {
    title: string;
    text: string;
    label: string;
    placeholder?: string;
    okText?: string;
  }): Promise<string | null>;
}

/** Повідомлення, яке адмінка показує тостом. */
export interface Toast {
  text: string;
  /** true — зелений тост «готово». */
  success: boolean;
}

/* ============================================================
   ЗМІНА СТАТУСУ
   ------------------------------------------------------------
   Найтонше місце модуля: перехід статусу зачіпає залишки,
   публічне відстеження й сповіщення. Порядок такий:
   спитати → скласти план → записати одним пакетом.
   ============================================================ */

export function statusLogEntry(status: OrderStatus, now: Date, by: string): StatusLogEntry {
  return { status: status, at: now.toISOString(), by: by };
}

/** Що зробити зі складом під час переходу. */
export type StockAction =
  | { kind: 'none' }
  /** Перше списання під замовлення. */
  | { kind: 'consume' }
  /** Відкат: товар повертається в залишки. */
  | { kind: 'return'; reason: 'order-cancel' | 'order-return' }
  /** Відкат без повернення: повертаємо і одразу списуємо. */
  | { kind: 'writeoff'; reason: 'order-cancel' | 'order-return'; ref: string; title: string };

export interface StatusUpdate {
  status: OrderStatus;
  stockApplied?: boolean;
  stockReturned?: boolean;
  writeoff?: WriteoffMark;
}

export interface StatusPlan {
  /** Запис в історію. Окремо від update, бо в базу він іде через
   *  arrayUnion: журнал там може бути довшим за прочитаний. */
  entry: StatusLogEntry;
  update: StatusUpdate;
  stock: StockAction;
  toast: Toast;
}

/** Відповіді на питання, які встигли поставити адміну. */
export interface StatusAnswer {
  /** Повертати товар у залишки. Має значення лише при відкаті. */
  putBack: boolean;
  /** Чому не повернувся; null — повертається. */
  lost: WriteoffAnswer | null;
}

/** Що саме має лягти в документ і що зробити зі складом.
 *  Складу тут не торкаємось — лише вирішуємо. */
export function planStatusChange(
  order: AdminOrder,
  next: OrderStatus,
  answer: StatusAnswer,
  at: { now: Date; by: string }
): StatusPlan {
  const wasApplied = !!order.stockApplied;
  const willConsume = consumesStock(next);

  const entry = statusLogEntry(next, at.now, at.by);
  const update: StatusUpdate = { status: next };
  let stock: StockAction = { kind: 'none' };
  let toast: Toast = { text: 'Статус: ' + statusInfo(next).title + ' ✓', success: true };

  if (willConsume && !wasApplied) {
    stock = { kind: 'consume' };
    update.stockApplied = true;
    toast = { text: 'Статус оновлено, товар списано зі складу ✓', success: true };
  }

  if (!willConsume && wasApplied) {
    const back = next === 'cancelled' ? 'order-cancel' : 'order-return';

    const lost = answer.lost;
    if (answer.putBack) {
      stock = { kind: 'return', reason: back };
      toast = { text: 'Статус оновлено, товар повернено на склад ✓', success: true };
    } else if (lost) {
      const title = writeoffTitle(lost.reason);
      stock = {
        kind: 'writeoff',
        reason: back,
        title: title,
        ref: (order.num || '') + ' · ' + title + (lost.note ? ' · ' + lost.note : '')
      };
      update.writeoff = {
        reason: lost.reason,
        title: title,
        note: lost.note || '',
        at: at.now.toISOString(),
        by: at.by
      };
      toast = { text: 'Статус оновлено, товар списано: ' + title, success: false };
    } else {
      /* Ні повернення, ні причини: склад не чіпаємо взагалі, але
         кажемо про це прямо. applyStatus такої відповіді не
         складе — вона можлива лише з чужих рук, і мовчазне
         «статус оновлено» приховало б долю товару. */
      toast = { text: 'Статус оновлено, товар списано: не повернувся', success: false };
    }

    update.stockApplied = false;
    update.stockReturned = answer.putBack;
  }

  return { entry, update, stock, toast };
}

export interface StatusChangeDeps {
  db: Firestore;
  /** Каталог і живі залишки: за ними рахується нестача й списання. */
  c: Catalogue;
  ask: OrderDialogs;
  /** Момент зміни: один і той самий у журналі та в записі списання. */
  now: Date;
  /** Пошта адміністратора — вона підписує і статус, і журнал руху. */
  by: string;
  /** true — масова зміна: не питаємо нічого й не показуємо тостів. */
  silent?: boolean;
}

export interface StatusChangeResult {
  /** true — статус справді змінили (або він уже був таким). */
  ok: boolean;
  /** 'same' — статус той самий; 'cancelled' — адмін передумав
   *  у діалозі; 'no-ttn' — відправлення без накладної;
   *  'error' — запис не пройшов. */
  reason?: 'same' | 'cancelled' | 'no-ttn' | 'error';
  toast: Toast | null;
  /** Накладна, яку щойно вписали в діалозі: її треба зберегти
   *  разом зі статусом і надіслати покупцеві. */
  ttn?: string;
}

export async function applyStatus(
  order: AdminOrder,
  next: OrderStatus,
  deps: StatusChangeDeps
): Promise<StatusChangeResult> {
  const prev = order.status || 'new';
  if (prev === next) return { ok: true, reason: 'same', toast: null };

  const silent = !!deps.silent;

  /* «Відправлено» без накладної не буває. Саме тут менеджер і
     забуває: статус міняє, а номер лишається порожнім — і
     покупець не дізнається, що посилка вже їде. Тому питаємо
     номер просто в мить переходу, а не сподіваємось, що хтось
     згадає повернутись у картку.

     У масовій зміні діалогів немає, тож такі замовлення просто
     не пропускаємо — і кажемо про це в підсумку. */
  let свіжаТТН = '';
  let самовиніс = !!order.pickup;

  if (next === 'shipped' && !String(order.ttn || '').trim() && !самовиніс) {
    if (silent) return { ok: false, reason: 'no-ttn', toast: null };
    const відповідь = await deps.ask.askText({
      title: 'Номер накладної',
      text:
        'Замовлення №' + (order.num || '') +
        ' переходить у «Відправлено». Впишіть ТТН — ми одразу надішлемо його покупцеві, ' +
        'і він бачитиме рух посилки у своєму кабінеті.',
      label: 'ТТН',
      placeholder: 'напр.: 20450000000000',
      okText: 'Відправити'
    });
    if (відповідь === null) return { ok: false, reason: 'cancelled', toast: null };
    свіжаТТН = відповідь.trim();
    if (!свіжаТТН) {
      return {
        ok: false,
        reason: 'no-ttn',
        toast: { text: 'Без номера накладної відправити не можна', success: false }
      };
    }
  }

  /* «Виконано» означає, що замовлення дійшло до покупця. Без
     накладної воно дійти не могло — хіба що покупець забрав сам.
     Тому питаємо прямо, а не пропускаємо мовчки: закрите
     замовлення без сліду доставки згодом неможливо ані
     перевірити, ані знайти. */
  if (next === 'done' && !String(order.ttn || '').trim() && !самовиніс) {
    if (silent) return { ok: false, reason: 'no-ttn', toast: null };
    const відповідь = await deps.ask.ask({
      title: 'Немає накладної',
      text:
        'Замовлення №' + (order.num || '') +
        ' закривається без номера накладної. Так буває лише тоді, коли покупець забрав ' +
        'замовлення сам. Якщо ж посилку відправляли — впишіть номер, інакше згодом ' +
        'ніхто не доведе, що вона доїхала.',
      okText: 'Вписати номер',
      altText: 'Це самовиніс'
    });
    if (відповідь === null) return { ok: false, reason: 'cancelled', toast: null };
    if (відповідь === 'alt') {
      самовиніс = true;
    } else {
      const номер = await deps.ask.askText({
        title: 'Номер накладної',
        text: 'Впишіть ТТН — ми одразу надішлемо його покупцеві.',
        label: 'ТТН',
        placeholder: 'напр.: 20450000000000',
        okText: 'Зберегти'
      });
      const чистий = String(номер || '').trim();
      if (!чистий) {
        return {
          ok: false,
          reason: 'no-ttn',
          toast: {
            text: 'Без номера накладної або позначки «самовиніс» закрити не можна',
            success: false
          }
        };
      }
      свіжаТТН = чистий;
    }
  }


  const wasApplied = !!order.stockApplied;
  const willConsume = consumesStock(next);
  const s = stockState(deps.c);
  const w: StockWriter = { db: deps.db, by: deps.by };

  // Попередження про нестачу лише при першому списанні
  if (willConsume && !wasApplied && !silent) {
    const short = stockShortage(s, order);
    if (short.length) {
      const ok = await deps.ask.confirmAsk({
        title: 'Нестача на складі',
        text:
          'На складі не вистачає товару:\n\n' +
          short.join('\n') +
          '\n\nПродовжити? Залишки підуть у мінус — це видно на сторінці «Склад».',
        okText: 'Продовжити',
        danger: true
      });
      if (!ok) return { ok: false, reason: 'cancelled', toast: null };
    }
  }

  /* Товар був списаний, а замовлення відкочують — питаємо, чи
     повертати речі на склад. Не завжди повертають: посилку
     могли не забрати й вона їде назад тижнями, річ могла
     повернутись пошкодженою або не повернутись зовсім. */
  let putBack = true;
  let lost: WriteoffAnswer | null = null;

  if (!willConsume && wasApplied && !silent) {
    const units = orderUnits(order);
    const answer = await deps.ask.ask({
      title: next === 'cancelled' ? 'Скасування замовлення' : 'Повернення статусу',
      text:
        'Замовлення №' +
        (order.num || '') +
        ' — товар (' +
        units +
        ' шт) уже списаний зі складу.' +
        '\n\nПовернути його в залишки? Якщо річ не повернулась або повернулась ' +
        'зіпсованою — оберіть «Не повертати», і ми одразу запишемо причину.',
      okText: 'Повернути на склад',
      altText: 'Не повертати'
    });
    if (answer === null) return { ok: false, reason: 'cancelled', toast: null };
    putBack = answer !== 'alt';

    /* Не повертається — питаємо, що сталося. Кількість від цього
       не зміниться (товар уже списаний), але в журналі буде видно
       і скасування, і причину втрати, а не мовчазний «-1 під
       замовлення», якого вже не існує. */
    if (!putBack) {
      lost = await deps.ask.askWriteoff({
        // перелік причин — той самий, що на сторінці складу
        title: 'Що сталося з товаром',
        text:
          'Товар (' +
          units +
          ' шт) не повертається на склад. ' +
          'Запишемо це списанням — щоб потім було видно, скільки втрачено і чому.',
        reasons: WRITEOFF_REASONS,
        reason: 'lost',
        label: 'Нотатка (необовʼязково)',
        placeholder: 'напр.: посилку не забрали, повернулась пошкодженою',
        okText: 'Записати списання',
        danger: true
      });
      if (lost === null) return { ok: false, reason: 'cancelled', toast: null };
    }
  }

  const plan = planStatusChange(order, next, { putBack, lost }, { now: deps.now, by: deps.by });

  try {
    const batch = writeBatch(deps.db);

    if (plan.stock.kind === 'consume') {
      adjustOrderStock(w, batch, s, order, -1);
    } else if (plan.stock.kind === 'return') {
      adjustOrderStock(w, batch, s, order, +1, plan.stock.reason);
    } else if (plan.stock.kind === 'writeoff') {
      /* Повертаємо й одразу списуємо: у залишках нічого не
         змінюється (нетто нуль, документ inventory навіть не
         чіпається), зате журнал розповідає повну історію. */
      const moved = emptyPlan();
      collectStock(s, order, +1, moved, plan.stock.reason);
      collectStock(s, order, -1, moved, 'writeoff', plan.stock.ref);
      applyStockPlan(w, batch, moved);
    }

    batch.update(doc(deps.db, ORDER_COL, order._id), {
      ...plan.update,
      ...(свіжаТТН ? { ttn: свіжаТТН } : {}),
      ...(самовиніс && !order.pickup ? { pickup: true } : {}),
      statusLog: arrayUnion(plan.entry)
    });
    await batch.commit();

    /* Публічне відстеження: покупець-гість бачить рух замовлення
       за номером і телефоном. Не чекаємо й не перевіряємо —
       статус уже в базі, а відстеження вторинне. */
    void trackUpdate({
      ...order,
      status: next,
      ttn: свіжаТТН || order.ttn || '',
      statusLog: (order.statusLog || []).concat([plan.entry])
    });

    return { ok: true, toast: silent ? null : plan.toast, ttn: свіжаТТН };
  } catch {
    return {
      ok: false,
      reason: 'error',
      toast: silent ? null : { text: 'Не вдалося оновити статус', success: false }
    };
  }
}

/* ---------- Масова зміна ---------- */

export interface BulkDeps extends StatusChangeDeps {
  /** Тост «беремось за N замовлень». Пакет іде послідовно й може
   *  тривати помітно довго — без цього рядка здається, що
   *  кнопка не спрацювала. */
  onStart?: (toast: Toast) => void;
}

export type BulkResult =
  | { kind: 'none' }
  | { kind: 'already'; toast: Toast }
  | { kind: 'cancelled' }
  | { kind: 'done'; done: number; total: number; toast: Toast };

export async function bulkStatus(
  orders: AdminOrder[],
  ids: string[],
  next: OrderStatus,
  deps: BulkDeps
): Promise<BulkResult> {
  if (!ids.length) return { kind: 'none' };

  const picked = ids
    .map((id) => orders.find((o) => o._id === id))
    .filter((o): o is AdminOrder => !!o);
  const toChange = picked.filter((o) => (o.status || 'new') !== next);

  if (!toChange.length) {
    return {
      kind: 'already',
      toast: { text: 'Усі обрані замовлення вже мають цей статус', success: false }
    };
  }

  const okBulk = await deps.ask.confirmAsk({
    title: 'Масова зміна статусу',
    text:
      'Змінити статус на «' +
      statusInfo(next).title +
      '» для ' +
      toChange.length +
      ' замовлень?',
    okText: 'Змінити'
  });
  if (!okBulk) return { kind: 'cancelled' };

  deps.onStart?.({ text: 'Оновлюємо ' + toChange.length + ' замовлень…', success: false });

  let done = 0;
  /* Пакетом ніхто не питає номер накладної, тож замовлення без
     неї просто не пропускаємо — і кажемо про це прямо. Мовчазне
     «оновлено 8» приховало б, що двоє покупців не дізнаються
     про свої посилки. */
  let безТТН = 0;
  for (let i = 0; i < toChange.length; i += BULK_CHUNK) {
    const chunk = toChange.slice(i, i + BULK_CHUNK);
    // послідовно, щоб не перевищити ліміт операцій у батчі
    for (const o of chunk) {
      const res = await applyStatus(o, next, { ...deps, silent: true });
      if (res.ok) done++;
      else if (res.reason === 'no-ttn') безТТН++;
    }
  }

  return {
    kind: 'done',
    done: done,
    total: toChange.length,
    toast: безТТН
      ? {
          text:
            'Оновлено: ' + done + '. Пропущено без ТТН: ' + безТТН +
            ' — впишіть номер у картці й змініть статус там.',
          success: false
        }
      : { text: 'Оновлено замовлень: ' + done + ' ✓', success: true }
  };
}

/* ============================================================
   ЕКСПОРТ І ДРУК
   ============================================================ */

/** Комірка CSV. Лапки навколо всього: у назвах товарів і адресах
 *  трапляються і коми, і переноси рядка. */
export function csvCell(v: unknown): string {
  const s = String(v === null || v === undefined ? '' : v).replace(/"/g, '""');
  return '"' + s + '"';
}

export const CSV_HEAD = [
  'Номер', 'Дата', 'Статус', 'Клієнт', 'Телефон', 'Email',
  'Перевізник', 'Місто', 'Відділення / вулиця', 'Індекс', 'Штат / область', 'Підтвердження',
  'ТТН', 'Товари', 'Кількість', 'Сума, грн', 'Нотатка'
];

/** Що саме вивантажувати: обране, а якщо не обрано нічого — усе,
 *  що зараз показує фільтр. */
export function exportList(list: AdminOrder[], selection: ReadonlySet<string>): AdminOrder[] {
  return selection.size ? list.filter((o) => selection.has(o._id)) : list;
}

/** Вивантаження одним рядком, разом із заголовком.
 *  Порожній список сюди давати не варто: у старій адмінці кнопка
 *  казала «Немає що експортувати» і файл не створювався зовсім —
 *  тут би вийшов файл із самих назв колонок. */
export function exportCSV(list: AdminOrder[], c: Catalogue): string {
  const rows = list.map((o) => {
    const cu = o.customer || {};
    const items = (o.items || [])
      .map(
        (i) =>
          i.name +
          (i.size ? ' (' + i.size + ')' : '') +
          // склад комплекту: інакше з вивантаження не зрозуміти, що пакувати
          ((i.parts || []).length ? ' [' + (i.parts || []).map((x) => partLine(c, x)).join(' + ') + ']' : '') +
          ' ×' +
          i.qty
      )
      .join('; ');

    return [
      o.num,
      orderDate(o).toLocaleString('uk-UA'),
      statusInfo(o.status || 'new').title,
      cu.name || '', cu.phone || '', cu.email || o.email || '',
      cu.carrier || '', cu.city || '', cu.branch || '',
      (cu.intl && cu.intl.zip) || '', (cu.intl && cu.intl.state) || '', confirmText(cu),
      o.ttn || '', items, orderUnits(o), o.total || 0, o.note || ''
    ]
      .map(csvCell)
      .join(',');
  });

  // BOM — щоб Excel правильно показав кирилицю
  return '\uFEFF' + [CSV_HEAD.map(csvCell).join(',')].concat(rows).join('\r\n');
}

export function csvName(now: Date): string {
  return 'reyter-zamovlennya-' + localISO(now) + '.csv';
}

/* ---------- Аркуш для друку ----------
   За цим аркушем комплектують посилку, тож склад комплекту в
   ньому обовʼязковий: із самої назви «Комплект Basic» не видно,
   які саме розміри класти. */

export interface PrintItem {
  name: string;
  category: string;
  size: string;
  /** Складники комплекту готовими рядками. */
  parts: string[];
  qty: number;
  sum: number;
}

export interface PrintOrder {
  num: string;
  /** Дата й статус так, як їх читає людина. */
  date: string;
  status: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  confirm: string;
  ttn: string;
  comment: string;
  items: PrintItem[];
  total: number;
}

/** Дані для аркуша друку. Числа лишаються числами: формат їм
 *  дасть уже сама сторінка. Порожній список — те саме, що з CSV:
 *  адмінка казала «Немає що друкувати» й вікна не відкривала. */
export function printOrders(list: AdminOrder[], c: Catalogue): PrintOrder[] {
  return list.map((o) => {
    const cu = o.customer || {};
    return {
      num: o.num || '',
      date: orderDate(o).toLocaleString('uk-UA'),
      status: statusInfo(o.status || 'new').title,
      name: cu.name || '',
      phone: cu.phone || '',
      email: cu.email || '',
      address: addressLine(cu),
      confirm: confirmText(cu),
      ttn: o.ttn || '',
      comment: cu.comment || '',
      total: Number(o.total) || 0,
      items: (o.items || []).map((i) => ({
        name: i.name,
        category: itemCat(c, i),
        size: i.size || '',
        parts: (i.parts || []).map((x) => partLine(c, x)),
        qty: i.qty,
        sum: i.price * i.qty
      }))
    };
  });
}

/* ============================================================
   РУЧНЕ СТВОРЕННЯ ЗАМОВЛЕННЯ
   (дзвінок, Direct, особисте спілкування)
   ============================================================ */

/** Обраний розмір складника комплекту. */
export interface ManualPart {
  id: string;
  size: string;
}

/** Рядок товару у формі. uid — щоб рядок пережив перемальовку
 *  списку: артикул ще не обрано, а відрізняти рядки вже треба. */
export interface ManualRow {
  uid: string;
  pid: string;
  size: string;
  qty: number;
  price: number;
  parts?: ManualPart[] | null;
}

/** Рахуємо лише заповнені рядки — порожні не впливають на підсумок. */
export function noFilledRows(rows: ManualRow[], c: Catalogue): ManualRow[] {
  return rows.filter((r) => !!productById(c, r.pid));
}

export function noItemsTotal(rows: ManualRow[], c: Catalogue): number {
  return noFilledRows(rows, c).reduce(
    (s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0),
    0
  );
}

export function noTotal(
  rows: ManualRow[],
  c: Catalogue,
  discount: number,
  shipping: number
): number {
  return Math.max(0, noItemsTotal(rows, c) - (Number(discount) || 0) + (Number(shipping) || 0));
}

/** Розміри, які можна обрати в рядку. Якщо облік ще не ведеться —
 *  показуємо розміри з картки товару: інакше новий товар не
 *  вдалося б продати руками, поки складу нема. */
export function availableSizes(c: Catalogue, p: { id: string; volume?: string; sizes?: string[] }): string[] {
  if (!isSized(p)) return [];
  const s = (c.stock && c.stock[p.id] && c.stock[p.id].sizes) || {};
  const tracked = Object.keys(s);
  return tracked.length ? ALL_SIZES.filter((x) => tracked.includes(x)) : p.sizes || [];
}

/* Склад комплекту міг змінитися після створення замовлення.
   Приводимо рядок до поточного складу: збережені розміри
   лишаємо, для нових складників беремо перший доступний.
   Без цього форма показує розмір, а перевірка каже «оберіть
   розмір» — бо в даних рядка цього складника немає.

   На відміну від оригіналу рядки не правляться на місці, а
   повертаються новим списком: правило має бути перевіряним. */
export function normalizeSetRows(rows: ManualRow[], c: Catalogue): ManualRow[] {
  return rows.map((row) => {
    const p = productById(c, row.pid);
    const parts = setParts(c, p);
    if (!parts.length) return row.parts ? { ...row, parts: null } : row;

    const was = row.parts || [];
    const next = parts.map((part) => {
      const old = was.find((x) => x.id === part.id);
      const sizes = isSized(part) ? availableSizes(c, part) : [part.volume || ''];
      const keep = old && old.size && sizes.includes(old.size) ? old.size : '';
      return { id: part.id, size: keep || sizes[0] || '' };
    });

    // у комплекту свого розміру немає — він лише в складників
    return { ...row, parts: next, size: '' };
  });
}

/* ---------- Промокод у формі замовлення ----------
   Адмін вписує код, а знижку рахує той самий рушій, що й на
   сайті, — інакше сума в замовленні з Direct не збігалася б із
   тією, яку покупець бачив у кошику. Код зберігається в
   замовленні: без нього незрозуміло, звідки взялася знижка,
   і статистика використань промокоду не сходиться. */

export function noPromoItems(rows: ManualRow[], c: Catalogue): PromoItem[] {
  const out: PromoItem[] = [];
  rows.forEach((r) => {
    const p = productById(c, r.pid);
    if (!p) return;
    out.push({
      id: r.pid,
      category: p.category,
      categories: p.categories,
      sale: !!p.sale,
      price: Number(r.price) || 0,
      qty: Number(r.qty) || 0
    });
  });
  return out;
}

export interface NoPromoInput {
  /** Код так, як його ввели: нормалізує сам план. */
  code: string;
  /** Завантажений документ; null — такого коду немає. */
  doc: Promo | null;
  /** Для якого коду документ завантажений. Розбіжність означає
   *  «ще вантажиться». */
  loadedFor: string;
  /** Значення поля знижки. */
  discount: number;
  /** Скільки в це поле підставив сам код. */
  auto: number;
  /** Пошта із поля замовлення — для персонального коду. */
  email: string;
  rows: ManualRow[];
  /** true — код щойно змінили руками, знижку перебиваємо завжди. */
  force: boolean;
}

export interface NoPromoHint {
  kind: '' | 'is-bad' | 'is-warn' | 'is-ok';
  text: string;
  /** Персональний код: чия це пошта і чи збігається вона з
   *  поштою замовлення. Той самий текст уже є в text — окремо
   *  лише щоб виділити пошту в розмітці. */
  personal: { email: string; matches: boolean } | null;
}

export interface NoPromoPlan {
  /** true — документ ще вантажиться: у формі не міняємо нічого. */
  pending: boolean;
  /** Число — підставити в поле знижки, '' — очистити,
   *  null — не чіпати (там ручна сума). */
  discount: number | '' | null;
  /** Нове значення лічильника «скільки підставив код». */
  auto: number;
  hint: NoPromoHint;
}

export interface NoPromoDeps extends PromoText {
  /** Момент перевірки — як у promoCheck. */
  now?: Date;
}

const NO_HINT: NoPromoHint = { kind: '', text: '', personal: null };

/** Знижка й підказка під полем промокоду.
 *
 *  Без force чіпаємо поле, лише поки в ньому наша ж сума: якщо
 *  адмін вписав свою знижку, перерахунок кошика її не зʼїсть. */
export function applyNoPromo(
  input: NoPromoInput,
  c: Catalogue,
  deps: NoPromoDeps
): NoPromoPlan {
  const code = promoNormalize(input.code);
  const cur = Number(input.discount) || 0;
  const own = input.force || !cur || cur === input.auto;

  if (!code) {
    const clear = own && !!input.auto;
    return {
      pending: false,
      discount: clear ? '' : null,
      auto: clear ? 0 : input.auto,
      hint: NO_HINT
    };
  }

  if (input.loadedFor !== code) {
    return { pending: true, discount: null, auto: input.auto, hint: NO_HINT };
  }

  if (!input.doc) {
    return {
      pending: false,
      discount: own ? '' : null,
      auto: own ? 0 : input.auto,
      hint: { kind: 'is-bad', text: 'Такого промокоду немає в базі', personal: null }
    };
  }

  /* Персональний код перевіряємо на пошту замовлення, а не на
     пошту адміна — інакше рушій відхилив би будь-який чужий код. */
  const promo: Promo = { ...input.doc };
  const owner = String(promo.email || '').toLowerCase();
  delete promo.email;

  const res = promoCheck(promo, noPromoItems(input.rows, c), deps.now);
  const terms = promoTerms(input.doc, deps);

  const personal = owner
    ? { email: input.doc.email || '', matches: input.email.trim().toLowerCase() === owner }
    : null;
  const whose = personal
    ? '\nПерсональний код: ' + personal.email + (personal.matches ? '' : ' — пошта замовлення інша')
    : '';

  if (res.ok) {
    const discount = res.discount ?? 0;
    // Знижку могли вписати руками — тоді чесно кажемо, що код
    // дає інше число, і нічого не перебиваємо
    const shown = own ? discount : cur;
    const manual = shown !== discount;
    return {
      pending: false,
      discount: own ? discount : null,
      auto: own ? discount : input.auto,
      hint: {
        kind: manual ? 'is-warn' : 'is-ok',
        text:
          (manual
            ? 'Код дає ' + fmt(discount) + ' грн, у замовленні — ' + fmt(shown) + ' грн'
            : 'Знижка ' + fmt(discount) + ' грн') +
          (terms ? ' · ' + terms : '') +
          whose,
        personal: personal
      }
    };
  }

  return {
    pending: false,
    discount: own ? '' : null,
    auto: own ? 0 : input.auto,
    hint: {
      kind: 'is-warn',
      text: promoMessage(res, input.doc, deps) + whose,
      personal: personal
    }
  };
}

/* ---------- Постійний клієнт за телефоном ----------
   Адмін вводить номер — шукаємо його в минулих замовленнях
   і пропонуємо підставити пошту, ПІБ та адресу, щоб не
   передруковувати їх із листування. */

export interface KnownCustomer {
  customer: AdminCustomer;
  /** Скільки разів цей номер уже замовляв. */
  orders: number;
}

/* Телефон порівнюємо за останніми девʼятьма цифрами — той самий
   хвіст, що й у ключі відстеження: покупець пише номер то з +380,
   то з нуля, то з пробілами. */
export function findKnownCustomer(
  orders: AdminOrder[],
  phone: string | null | undefined
): KnownCustomer | null {
  const key = phoneTail(phone);
  if (key.length < 9) return null;

  const mine = orders
    .filter((o) => phoneTail((o.customer || {}).phone) === key)
    .sort((a, b) => orderDate(b).getTime() - orderDate(a).getTime());
  if (!mine.length) return null;

  // найсвіжіші дані клієнта + скільки разів замовляв
  return { customer: mine[0].customer || {}, orders: mine.length };
}

/* ---------- Текст замовлення ----------
   Це НЕ buildMessage із order.ts, хоч початок і збігається.
   Замовлення з адмінки має доставку окремим рядком, не має
   рядка «Сума:» і не має способу підтвердження — його щойно
   узгодили голосом. Категорію теж бере інакше: із каталогу,
   якщо в позиції її не збережено. Поки старий сайт працює
   поруч, обидва тексти мають лишатись такими, як були. */

export interface MessageSource {
  num: string;
  items: OrderItem[];
  discount?: number;
  promoCode?: string;
  shipping?: number;
  total: number;
  /** Саме Customer, а не AdminCustomer: текст складається лише
   *  для щойно зібраного замовлення, де імʼя й телефон уже
   *  перевірені. */
  customer: Customer;
}

export function buildOrderMessage(order: MessageSource, c: Catalogue): string {
  const lines: string[] = [];
  lines.push('🛍 Замовлення №' + order.num + ' — reyter.men');
  lines.push('');

  order.items.forEach((i, n) => {
    const cat = itemCat(c, i);
    lines.push(n + 1 + '. ' + i.name + (cat ? ' — ' + cat : '') + ' (' + i.id + ')');
    lines.push(
      '   ' +
        (i.size ? (i.volume ? 'обʼєм ' : 'розмір ') + i.size + ' · ' : '') +
        i.qty +
        ' шт · ' +
        fmt(i.price * i.qty) +
        ' грн'
    );
    (i.parts || []).forEach((x) => {
      lines.push('      – ' + partLine(c, x));
    });
  });

  lines.push('');
  if (order.discount) {
    lines.push(
      'Знижка' +
        (order.promoCode ? ' (' + order.promoCode + ')' : '') +
        ': −' +
        fmt(order.discount) +
        ' грн'
    );
  }
  if (order.shipping) lines.push('Доставка: +' + fmt(order.shipping) + ' грн');
  lines.push('Разом: ' + fmt(order.total) + ' грн');
  lines.push('');
  lines.push('👤 ' + order.customer.name);
  lines.push('📞 ' + order.customer.phone);

  const delivery = addressLine(order.customer);
  if (delivery) lines.push('🚚 ' + delivery);
  if (order.customer.comment) lines.push('💬 ' + order.customer.comment);

  return lines.join('\n');
}

/* ---------- Складання й запис ---------- */

/** Поля форми «Нове замовлення», крім списку товарів. */
export interface ManualForm {
  name: string;
  phone: string;
  email: string;
  comment: string;
  /** Значення блоку адреси. */
  address: Address;
  discount: number;
  shipping: number;
  /** Промокод так, як його ввели. */
  promo: string;
  /** Галочка «повідомити покупця». */
  notify?: boolean;
}

export interface ManualDraft {
  items: OrderItem[];
  discount: number;
  shipping: number;
  promoCode: string;
  customer: Customer;
  total: number;
}

export type ManualPlan = { ok: false; message: string } | { ok: true; draft: ManualDraft };

/** Що саме піде в замовлення — і чи можна його створювати.
 *  Порядок перевірок той самий, що в адмінці: людина бачить
 *  першу незаповнену річ, а не останню. */
export function planManualOrder(form: ManualForm, rows: ManualRow[], c: Catalogue): ManualPlan {
  const name = form.name.trim();
  const phone = form.phone.trim();

  if (!name) return { ok: false, message: 'Вкажіть імʼя клієнта' };
  if (!phone) return { ok: false, message: 'Вкажіть телефон клієнта' };

  const items: OrderItem[] = [];
  for (const row of rows) {
    const p = productById(c, row.pid);
    if (!p) continue; // порожній рядок

    const parts = setParts(c, p);
    const partSize = (part: { id: string }) =>
      (row.parts || []).find((x) => x.id === part.id)?.size || '';

    if (parts.length) {
      const missing = parts.find((part) => isSized(part) && !partSize(part));
      if (missing) {
        return {
          ok: false,
          message: 'Оберіть розмір для «' + missing.name + '» у комплекті «' + p.name + '»'
        };
      }
    } else if (isSized(p) && !row.size) {
      return { ok: false, message: 'Оберіть розмір для «' + p.name + '»' };
    }

    const item: OrderItem = {
      id: p.id,
      name: p.name,
      category: catName(c, p.category) || '',
      // у комплекту свого розміру немає: він у кожного складника
      size: parts.length ? null : row.size || null,
      qty: Math.max(1, Math.trunc(Number(row.qty) || 1)),
      price: Math.max(0, Math.trunc(Number(row.price) || 0)),
      volume: !!p.volume
    };
    if (parts.length) {
      item.parts = parts.map((part) => ({
        id: part.id,
        name: part.name,
        category: catName(c, part.category) || '',
        size: partSize(part) || null,
        // обʼєм фіксуємо в замовленні: якщо товар зникне з
        // каталогу, списувати треба буде все одно правильно
        volume: !!part.volume
      }));
    }
    items.push(item);
  }

  if (!items.length) return { ok: false, message: 'Додайте хоча б один товар' };

  const discount = Number(form.discount) || 0;
  const shipping = Number(form.shipping) || 0;

  const customer: Customer = {
    name: name,
    phone: phone,
    email: form.email.trim(),
    ...form.address,
    comment: form.comment.trim()
  };

  return {
    ok: true,
    draft: {
      items: items,
      discount: discount,
      shipping: shipping,
      /* Код зберігаємо лише разом зі знижкою: код без знижки
         зіпсував би статистику використань промокоду. */
      promoCode: discount ? promoNormalize(form.promo) : '',
      customer: customer,
      total: Math.max(0, items.reduce((s, i) => s + i.price * i.qty, 0) - discount + shipping)
    }
  };
}

/** Документ orders/<id> для щойно створеного замовлення. */
export interface OrderDoc {
  num: string;
  date: string;
  items: OrderItem[];
  discount: number;
  promoCode: string;
  shipping: number;
  total: number;
  customer: Customer;
  email: string;
  status: OrderStatus;
  /** Замовлення завів адмін — акаунта покупця за ним немає. */
  uid: string | null;
  source: string;
  createdBy: string;
  created: FieldValue;
  statusLog: StatusLogEntry[];
  trackKey: string;
  message: string;
  stockApplied?: boolean;
}

export interface ManualDeps {
  db: Firestore;
  ask: OrderDialogs;
  now: Date;
  /** Випадкове число для номера замовлення. */
  rand?: number;
  /** Пошта адміністратора. */
  by: string;
  /** Статус, обраний у формі. Для редагування не читається:
   *  статус міняють кнопками картки. */
  status: OrderStatus;
  /** Звідки замовлення: дзвінок, Direct, інше. */
  source: string;
  /** Замовлення, яке редагують; null — нове. */
  editing?: AdminOrder | null;
  /** Сповістити покупця. Викликається лише коли стоїть галочка
   *  і в замовленні є пошта. */
  notify?: (order: OrderDoc) => void;
  /** Рядок стану під кнопкою: запис іде разом зі складом і може
   *  тривати секунди, а форма весь цей час виглядає живою. */
  onProgress?: (text: string) => void;
}

export type ManualResult =
  | { ok: false; kind: 'invalid' | 'error'; message: string }
  | { ok: false; kind: 'cancelled' }
  | { ok: true; kind: 'created'; id: string; order: OrderDoc; toast: Toast }
  | { ok: true; kind: 'updated'; order: AdminOrder; toast: Toast };

/** Створює замовлення руками — або зберігає зміни в наявному.
 *  Форма одна на обидва випадки, різниця лише в тому, що саме
 *  лягає в базу. */
export async function createManualOrder(
  form: ManualForm,
  rows: ManualRow[],
  c: Catalogue,
  deps: ManualDeps
): Promise<ManualResult> {
  const plan = planManualOrder(form, rows, c);
  if (!plan.ok) return { ok: false, kind: 'invalid', message: plan.message };
  const d = plan.draft;

  const s = stockState(c);
  const w: StockWriter = { db: deps.db, by: deps.by };

  if (deps.editing) {
    const prev = deps.editing;

    /* Ключ відстеження залежить від номера й телефону: якщо
       телефон виправили, старий запис треба прибрати, інакше
       покупець побачить заморожений статус за старими даними. */
    const key = await trackKey(prev.num || '', d.customer.phone);

    const updated: AdminOrder = {
      ...prev,
      trackKey: key || prev.trackKey || '',
      items: d.items,
      discount: d.discount,
      promoCode: d.promoCode,
      shipping: d.shipping,
      total: d.total,
      customer: d.customer,
      email: d.customer.email,
      source: deps.source
    };
    updated.message = buildOrderMessage(
      {
        num: prev.num || '',
        items: d.items,
        discount: d.discount,
        promoCode: d.promoCode,
        shipping: d.shipping,
        total: d.total,
        customer: d.customer
      },
      c
    );

    deps.onProgress?.('Зберігаємо зміни…');

    try {
      const batch = writeBatch(deps.db);
      if (prev.stockApplied) {
        /* Повертаємо старий склад і списуємо новий однією
           операцією: Firestore не любить двох записів в один
           документ у межах одного batch, та й розміри, які не
           змінилися, взагалі не треба чіпати. */
        const moved = emptyPlan();
        collectStock(s, prev, 1, moved);
        collectStock(s, updated, -1, moved);
        applyStockPlan(w, batch, moved);
      }
      batch.update(doc(deps.db, ORDER_COL, prev._id), {
        items: updated.items,
        discount: updated.discount,
        promoCode: updated.promoCode,
        shipping: updated.shipping,
        total: updated.total,
        customer: updated.customer,
        email: updated.email,
        source: updated.source,
        message: updated.message,
        trackKey: updated.trackKey,
        editedAt: serverTimestamp(),
        editedBy: deps.by
      });
      await batch.commit();

      if (prev.trackKey && key && prev.trackKey !== key) {
        void trackDelete(prev.trackKey); // телефон змінили
      }
      void trackUpdate(updated);

      return {
        ok: true,
        kind: 'updated',
        order: updated,
        toast: { text: 'Замовлення №' + (prev.num || '') + ' оновлено ✓', success: true }
      };
    } catch {
      return { ok: false, kind: 'error', message: 'Не вдалося зберегти зміни' };
    }
  }

  const order: OrderDoc = {
    num: orderNumber(deps.now, deps.rand),
    date: deps.now.toISOString(),
    items: d.items,
    discount: d.discount,
    promoCode: d.promoCode,
    shipping: d.shipping,
    total: d.total,
    customer: d.customer,
    email: d.customer.email,
    status: deps.status,
    uid: null,
    source: deps.source,
    createdBy: deps.by,
    created: serverTimestamp(),
    statusLog: [statusLogEntry(deps.status, deps.now, deps.by)],
    trackKey: '',
    message: ''
  };
  order.trackKey = await trackKey(order.num, d.customer.phone);
  order.message = buildOrderMessage(order, c);

  // Попередження про нестачу, якщо одразу підтверджуємо
  if (consumesStock(deps.status)) {
    const short = stockShortage(s, order);
    if (short.length) {
      const ok = await deps.ask.confirmAsk({
        title: 'Нестача на складі',
        text:
          'На складі не вистачає товару:\n\n' +
          short.join('\n') +
          '\n\nСтворити замовлення? Залишки підуть у мінус.',
        okText: 'Все одно створити',
        danger: true
      });
      if (!ok) return { ok: false, kind: 'cancelled' };
    }
  }

  deps.onProgress?.('Створюємо замовлення…');

  try {
    const batch = writeBatch(deps.db);
    const ref = doc(collection(deps.db, ORDER_COL));

    if (consumesStock(deps.status)) {
      order.stockApplied = true;
      adjustOrderStock(w, batch, s, order, -1);
    }

    batch.set(ref, order);
    await batch.commit();

    void trackCreate(order);

    // Замовлення завів адмін — сповіщати самого себе зайве,
    // тому лист іде лише покупцеві й лише з галочкою
    if (form.notify && d.customer.email) deps.notify?.(order);

    return {
      ok: true,
      kind: 'created',
      id: ref.id,
      order: order,
      toast: { text: 'Замовлення №' + order.num + ' створено ✓', success: true }
    };
  } catch {
    return {
      ok: false,
      kind: 'error',
      message:
        'Не вдалося створити замовлення. Перевірте правила Firestore (потрібен дозвіл create для адміна).'
    };
  }
}
