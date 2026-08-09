/* ============================================================
   REYTER — кошик
   ------------------------------------------------------------
   Портовано з js/cart.js один в один: тільки робота з даними,
   без панелі й без оформлення. Поведінка має збігатися зі старим
   сайтом, поки він працює поруч.

   Дві відмінності від оригіналу — вимушені, не змістовні:
   • каталог модуль не тримає, тож функції, яким потрібен товар,
     беруть Catalogue першим аргументом (у старому коді це був
     глобальний R.getProduct);
   • замість оновлення бейджа в шапці save() будить підписників —
     React-шар читає ті самі дані через subscribe/snapshot.
   ============================================================ */

import { getProduct, isSet, productCats, setParts, type Catalogue } from './catalog';
import type { Profile } from './address';
import type { CartLine, CartPart, OrderItem, OrderStatus, Product } from './types';

export const KEY_CART = 'reyter:cart';
export const KEY_ORDERS = 'reyter:orders';
export const KEY_PROFILE = 'reyter:profile';

/* ---------- Типи, яких немає в предметній моделі ---------- */

/** Профіль покупця. Один тип на весь застосунок: у ньому ж
 *  лежить адресна книга, тож описаний він там, де з нею працюють.
 *  Полів більше, ніж перелічено, — роками дописувалось. */
export type { Profile };

/** Замовлення так, як воно лягає в історію браузера. */
export interface Order {
  num: string;
  date: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  promoCode: string;
  total: number;
  customer: Profile;
  /** Готовий текст для листа й Telegram — складається при оформленні. */
  message?: string;
  status?: OrderStatus;
  [key: string]: unknown;
}

/** Позиція у вигляді, зрозумілому рушію промокодів. */
export interface PromoLine {
  id: string;
  category: string;
  categories: string[];
  price: number;
  qty: number;
  sale: boolean;
}

/* ---------- Сховище ----------
   Модуль має рендеритись і на сервері, де localStorage немає
   зовсім. Тому доступ іде через адаптер: у браузері це
   localStorage, на сервері — нічого, і читання просто повертає
   значення за замовчуванням. */

export interface CartStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let injected: CartStorage | null = null;

/** Підмінити сховище (тести, memory-режим). null — повернутись
 *  до localStorage. */
export function setStorage(storage: CartStorage | null): void {
  injected = storage;
  notify();
}

function store(): CartStorage | null {
  if (injected) return injected;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Доступ до сховища може бути заборонений політикою сторінки
    return null;
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const s = store();
    if (!s) return fallback;
    const raw = s.getItem(key);
    // Порожній рядок, "null" і "0" так само дають fallback — як в оригіналі
    return ((raw ? (JSON.parse(raw) as T) : null) || fallback) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    const s = store();
    if (!s) return;
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* приватний режим — ігноруємо */
  }
}

/* ---------- Підписка ----------
   Кошик показують кілька компонентів одночасно (бейдж у шапці,
   панель, картка товару). Щоб вони не розʼїхались, усі читають
   один снапшот і оновлюються з однієї події. */

type Listener = (lines: CartLine[]) => void;

const listeners = new Set<Listener>();

let snap: CartLine[] | null = null;

/** Сирі позиції зі сховища, без звірки з каталогом.
 *  Посилання стабільне до наступного запису — інакше
 *  useSyncExternalStore зациклився б на новому масиві щорендеру. */
export function snapshot(): CartLine[] {
  if (!snap) snap = read<CartLine[]>(KEY_CART, []);
  return snap;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Скинути кеш і розбудити підписників.
 *  Каталог приходить із бази вже після першого рендеру, і разом
 *  із ним можуть відпасти позиції (зниклий товар, змінений склад
 *  комплекту). Лічильник у шапці має це побачити. */
export function notify(): void {
  snap = null;
  const lines = snapshot();
  listeners.forEach((fn) => fn(lines));
}

/* ---------- Ключ позиції ---------- */

/* Ключ позиції кошика.
   У комплекті розміри складників — частина ідентичності: той
   самий комплект із бріфами M і з бріфами L це різні позиції,
   і зливати їх в одну не можна. */
export function lineKey(
  id: string,
  size?: string | null,
  parts?: CartPart[] | null
): string {
  /* Сортуємо й серіалізуємо: порядок складників не має робити
     з тієї самої комбінації дві різні позиції, а роздільники
     в артикулах не мають ламати ключ. */
  const list = (parts || [])
    .map((x) => [String(x.id), x.size == null ? '' : String(x.size)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify([id, size || '', list]);
}

function itemKey(i: CartLine): string {
  return lineKey(i.id, i.size, i.parts);
}

/* ---------- Позиції ---------- */

export function items(c: Catalogue): CartLine[] {
  return read<CartLine[]>(KEY_CART, []).filter((i) => {
    const p = getProduct(c, i.id);
    if (!p) return false; // товару більше немає в каталозі

    /* Склад комплекту могли змінити в адмінці, поки кошик
       лежав у браузері. Стара позиція зібрала б не той товар
       і списала б не ті залишки — прибираємо її. */
    if (isSet(p)) {
      const want = setParts(c, p)
        .map((x) => x.id)
        .sort()
        .join(',');
      const have = (i.parts || [])
        .map((x) => x.id)
        .sort()
        .join(',');
      return !!want && want === have;
    }
    // товар перестав бути комплектом — стара позиція теж не годиться
    return !(i.parts && i.parts.length);
  });
}

/* Записуємо ЗВІРЕНИЙ список: усі мутації нижче починаються з
   items(), тож перша ж зміна кошика вичищає зі сховища позиції,
   які каталог більше не визнає. Так було й у старому коді. */
export function save(lines: CartLine[]): void {
  write(KEY_CART, lines);
  notify();
}

export function add(
  c: Catalogue,
  id: string,
  size?: string | null,
  parts?: CartPart[] | null
): void {
  const list = items(c);
  const key = lineKey(id, size, parts);
  const found = list.find((i) => itemKey(i) === key);
  if (found) found.qty += 1;
  else {
    const line: CartLine = { id: id, size: size || null, qty: 1 };
    if (parts && parts.length) line.parts = parts.map((x) => ({ id: x.id, size: x.size || null }));
    list.push(line);
  }
  save(list);
}

/* idx — індекс у звіреному списку items(), а не у сховищі */
export function setQty(c: Catalogue, idx: number, qty: number): void {
  const list = items(c);
  if (!list[idx]) return;
  list[idx].qty = Math.max(1, Math.min(99, qty));
  save(list);
}

/* Скільки саме цього товару в цьому розмірі вже в кошику */
export function qtyOf(
  c: Catalogue,
  id: string,
  size?: string | null,
  parts?: CartPart[] | null
): number {
  const key = lineKey(id, size, parts);
  const found = items(c).find((i) => itemKey(i) === key);
  return found ? found.qty : 0;
}

/* Встановити кількість; 0 — прибрати позицію з кошика */
export function setQtyOf(
  c: Catalogue,
  id: string,
  size: string | null | undefined,
  parts: CartPart[] | null | undefined,
  qty: number
): number {
  const list = items(c);
  const key = lineKey(id, size, parts);
  const idx = list.findIndex((i) => itemKey(i) === key);
  const next = Math.max(0, Math.min(99, qty));

  if (idx < 0) {
    if (next > 0) {
      const line: CartLine = { id: id, size: size || null, qty: next };
      if (parts && parts.length) line.parts = parts.map((x) => ({ id: x.id, size: x.size || null }));
      list.push(line);
    }
  } else if (next === 0) {
    list.splice(idx, 1);
  } else {
    list[idx].qty = next;
  }
  save(list);
  return next;
}

export function remove(c: Catalogue, idx: number): void {
  const list = items(c);
  list.splice(idx, 1);
  save(list);
}

export function clear(): void {
  save([]);
}

export function count(c: Catalogue): number {
  return items(c).reduce((s, i) => s + i.qty, 0);
}

export function subtotal(c: Catalogue): number {
  return items(c).reduce((s, i) => {
    const p = getProduct(c, i.id);
    return s + (p ? p.price * i.qty : 0);
  }, 0);
}

/* Позиції у вигляді, зрозумілому рушію промокодів */
export function forPromo(c: Catalogue): PromoLine[] {
  return items(c).map((i) => {
    // items() уже відсіяв позиції без товару, тож null тут не буває —
    // TypeScript про цю гарантію не знає
    const p = getProduct(c, i.id) as Product;
    return {
      id: p.id,
      category: p.category,
      // товар може стояти в кількох категоріях — промокод
      // на будь-яку з них має спрацювати
      categories: productCats(p),
      price: p.price,
      qty: i.qty,
      sale: !!p.sale
    };
  });
}

/* ---------- Профіль і замовлення ---------- */

export function getProfile(): Profile {
  return read<Profile>(KEY_PROFILE, {});
}

export function saveProfile(profile: Profile): void {
  write(KEY_PROFILE, profile);
}

export function getOrders(): Order[] {
  return read<Order[]>(KEY_ORDERS, []);
}

export function saveOrders(orders: Order[]): void {
  write(KEY_ORDERS, orders);
}
