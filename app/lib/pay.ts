/* ============================================================
   REYTER — оплата карткою (Monobank)
   ------------------------------------------------------------
   Тут немає жодного секрету й жодної суми, якій можна вірити.
   Токен еквайрингу лежить у воркері, і суму рахунку рахує теж
   воркер: сайт лише каже, ЩО замовили, а скільки це коштує —
   вирішує той, хто має доступ до каталогу й до промокодів.

   Стан оплати ми не зберігаємо ніде. Щоразу питаємо банк: те,
   чого немає в нашій базі, неможливо ні підробити, ні
   розсинхронізувати з дійсністю.

   Номер рахунку (invoiceId) — не таємниця й не ключ: він лише
   вказує, ПРО ЩО питати. Дізнатись за ним можна рівно те, що
   покупець і так бачить на сторінці подяки.
   ============================================================ */

import { normalizeUrl } from './notify';
import type { MetaBrowserContext } from './meta';
import type { Lang } from './types';

/** Стан рахунку словами самого Monobank. */
export type PayState =
  | 'created' // рахунок виставлено, покупець ще не платив
  | 'processing' // банк обробляє
  | 'hold' // гроші заблоковано (у нас не використовується)
  | 'success' // оплачено
  | 'failure' // не вдалося
  | 'reversed' // повернуто
  | 'expired' // строк рахунку минув
  | ''; // невідомо

export interface PayStatus {
  ok: boolean;
  state: PayState;
  /** Скільки оплачено, грн. */
  amount: number;
  /** Чому не вдалося — словами банку. */
  why: string;
  at: string;
  error: string;
}

export interface PayInvoice {
  ok: boolean;
  invoiceId: string;
  pageUrl: string;
  amount: number;
  error: string;
  /** Банк каже: за це замовлення вже платили. Рахунку не буде —
   *  і це не помилка, а захист від подвійного списання. */
  paidAlready?: boolean;
}

/** Позиція для рахунку. Ціни тут немає навмисно: її бере воркер
 *  із каталогу, інакше суму можна було б переписати в консолі. */
export interface PayLine {
  id: string;
  size?: string;
  qty: number;
}

async function ask(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const where = normalizeUrl(url);
  if (!where) return { ok: false, error: 'Не налаштовано адресу воркера' };
  try {
    const res = await fetch(where, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'Немає звʼязку з платіжним сервісом' };
  }
}

/** Виставити рахунок покупцеві. Повертає адресу сторінки оплати. */
export async function payCreate(
  workerUrl: string,
  input: {
    orderNum: string;
    items: PayLine[];
    promo?: string;
    shipping?: number;
    email?: string;
    phone?: string;
    meta?: MetaBrowserContext;
    lang?: Lang;
    /** Рахунки, які треба погасити: живими має лишатись рівно
     *  одне посилання на оплату. */
    previous?: string[];
    /** Підписаний Google токен покупця.
     *
     *  Ним воркер читає рівень лояльності — правами самого
     *  покупця, а не своїми. Це єдиний спосіб, у якому рівень
     *  неможливо підробити з браузера: у документ учасника пише
     *  лише адмінка, а токен підписує Google. Без токена знижки
     *  за рівнем у рахунку просто не буде — і покупець побачить
     *  у банку більшу суму, ніж у кошику. */
    idToken?: string;
    /** Чи застосовувати знижку за рівнем. Покупець вирішує сам. */
    loyalty?: boolean;
  }
): Promise<PayInvoice> {
  const r = await ask(workerUrl, {
    type: 'pay-create',
    idToken: input.idToken || '',
    loyalty: input.loyalty !== false,
    previousInvoiceIds: input.previous || [],
    orderNum: input.orderNum,
    items: input.items,
    promo: input.promo || '',
    shipping: input.shipping || 0,
    to: input.email || '',
    phone: input.phone || '',
    meta: input.meta || {},
    lang: input.lang || 'uk'
  });
  return {
    ok: r.ok === true,
    invoiceId: String(r.invoiceId || ''),
    pageUrl: String(r.pageUrl || ''),
    amount: Number(r.amount) || 0,
    error: String(r.error || ''),
    paidAlready: r.paidAlready === true
  };
}

/** Спитати банк, що з рахунком. */
export async function payStatus(workerUrl: string, invoiceId: string): Promise<PayStatus> {
  const r = await ask(workerUrl, { type: 'pay-status', invoiceId: invoiceId });
  return {
    ok: r.ok === true,
    state: (String(r.status || '') as PayState) || '',
    amount: Number(r.amount) || 0,
    why: String(r.failureReason || ''),
    at: String(r.at || ''),
    error: String(r.error || '')
  };
}

/** Чи оплачене ЗАМОВЛЕННЯ. Питання саме про замовлення, а не про
 *  рахунок: рахунків у нього буває кілька — з кошика, з листа, з
 *  кабінету, — і браузер памʼятає лише свій. */
export async function orderPaid(
  workerUrl: string,
  orderNum: string
): Promise<{ ok: boolean; paid: boolean; refunded: boolean; amount: number }> {
  const r = await ask(workerUrl, { type: 'pay-paid', orderNum });
  return {
    ok: r.ok === true,
    paid: r.paid === true,
    refunded: r.refunded === true,
    amount: Number(r.amount) || 0
  };
}

/** Повернути кошти. Без суми — повертається все. Тільки з адмінки. */
export async function payRefund(
  workerUrl: string,
  key: string,
  invoiceId: string,
  amount = 0
): Promise<{ ok: boolean; state: PayState; error: string }> {
  const r = await ask(workerUrl, { type: 'pay-refund', key, invoiceId, amount });
  return {
    ok: r.ok === true,
    state: (String(r.status || '') as PayState) || '',
    error: String(r.error || '')
  };
}

/** Виставити рахунок і надіслати листом. Тільки з адмінки. */
export async function payLink(
  workerUrl: string,
  key: string,
  input: {
    orderNum: string;
    items: PayLine[];
    promo?: string;
    shipping?: number;
    email: string;
    phone?: string;
    name?: string;
    lang?: Lang;
    /** Рахунок, який був до цього: воркер його погасить, щоб за
     *  замовлення не можна було заплатити двічі. */
    previousInvoiceId?: string;
  }
): Promise<PayInvoice & { mailed: boolean; mailError: string; paidAlready: boolean }> {
  const r = await ask(workerUrl, {
    type: 'pay-link',
    key,
    previousInvoiceId: input.previousInvoiceId || '',
    orderNum: input.orderNum,
    items: input.items,
    promo: input.promo || '',
    shipping: input.shipping || 0,
    to: input.email,
    phone: input.phone || '',
    name: input.name || '',
    lang: input.lang || 'uk'
  });
  const mail = (r.email ?? {}) as { ok?: boolean; error?: string };
  return {
    ok: r.ok === true,
    invoiceId: String(r.invoiceId || ''),
    pageUrl: String(r.pageUrl || ''),
    amount: Number(r.amount) || 0,
    error: String(r.error || ''),
    mailed: mail.ok === true,
    mailError: String(mail.error || ''),
    paidAlready: r.paidAlready === true
  };
}

/** Чек за оплатою. Банк віддає два документи: фіскальний чек
 *  (той, що в податковій) і квитанцію — те, що покупець звик
 *  називати чеком. Обидва приходять готовим PDF. */
export async function payReceipt(
  workerUrl: string,
  key: string,
  invoiceId: string
): Promise<{
  ok: boolean;
  fiscal: { id: string; taxUrl: string; file: string }[];
  receipt: string;
  error: string;
}> {
  const r = await ask(workerUrl, { type: 'pay-receipt', key, invoiceId });
  return {
    ok: r.ok === true,
    fiscal: (Array.isArray(r.fiscal) ? r.fiscal : []) as { id: string; taxUrl: string; file: string }[],
    receipt: String(r.receipt || ''),
    error: String(r.error || '')
  };
}

/** Надіслати чек покупцеві листом. Тільки з адмінки. */
export async function payReceiptSend(
  workerUrl: string,
  key: string,
  input: { invoiceId: string; email: string; orderNum: string; name?: string; lang?: Lang }
): Promise<{ ok: boolean; error: string }> {
  const r = await ask(workerUrl, {
    type: 'pay-receipt-send',
    key,
    invoiceId: input.invoiceId,
    to: input.email,
    orderNum: input.orderNum,
    name: input.name || '',
    lang: input.lang || 'uk'
  });
  return { ok: r.ok === true, error: String(r.error || '') };
}

/** Знайти оплату за номером замовлення. Рятунок на випадок, коли
 *  номер рахунку в замовленні не той: банк памʼятає всі платежі
 *  й знає номер замовлення в полі reference. */
export async function payFind(
  workerUrl: string,
  key: string,
  orderNum: string
): Promise<{
  ok: boolean;
  found: {
    invoiceId: string;
    status: PayState;
    amount: number;
    /** Скільки з цієї суми вже повернули. */
    refunded: number;
    at: string;
    card: string;
  }[];
  error: string;
}> {
  const r = await ask(workerUrl, { type: 'pay-find', key, orderNum });
  return {
    ok: r.ok === true,
    found: (Array.isArray(r.found) ? r.found : []) as {
      invoiceId: string;
      status: PayState;
      amount: number;
      refunded: number;
      at: string;
      card: string;
    }[],
    error: String(r.error || '')
  };
}

/** Гроші за всіма замовленнями — одним запитом. Ключ — номер
 *  замовлення; paid і refunded уже в гривнях. */
export interface PaySum {
  paid: number;
  refunded: number;
  /** Скільки окремих оплат лишилось неповерненими. */
  count: number;
  invoices: string[];
}

export async function payMap(
  workerUrl: string,
  key: string
): Promise<{ ok: boolean; map: Record<string, PaySum>; error: string }> {
  const r = await ask(workerUrl, { type: 'pay-map', key });
  return {
    ok: r.ok === true,
    map: (r.map ?? {}) as Record<string, PaySum>,
    error: String(r.error || '')
  };
}

/** Замовлення, за які заплатили двічі. Один запит на весь
 *  магазин: виписка приходить цілком, а групування за номером
 *  робиться вже в банку-помічнику. */
export async function payDoubles(
  workerUrl: string,
  key: string
): Promise<{
  ok: boolean;
  doubles: Record<string, { invoiceId: string; amount: number; at: string; card: string }[]>;
  error: string;
}> {
  const r = await ask(workerUrl, { type: 'pay-doubles', key });
  return {
    ok: r.ok === true,
    doubles: (r.doubles ?? {}) as Record<
      string,
      { invoiceId: string; amount: number; at: string; card: string }[]
    >,
    error: String(r.error || '')
  };
}

/** PDF приходить рядком у base64 — перетворюємо на файл, який
 *  можна відкрити у вкладці або зберегти. */
export function pdfUrl(base64: string): string {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

/* ---------- Як це називати людям ---------- */

/** Підпис стану — той самий і для покупця, і для менеджера. */
export function payLabel(state: PayState): string {
  switch (state) {
    case 'success':
      return 'Оплачено';
    case 'processing':
      return 'Банк обробляє';
    case 'hold':
      return 'Гроші заблоковано';
    case 'failure':
      return 'Оплата не пройшла';
    case 'reversed':
      return 'Кошти повернуто';
    case 'expired':
      return 'Строк рахунку минув';
    case 'created':
      return 'Чекає оплати';
    default:
      return 'Невідомо';
  }
}

/** Наскільки це терміново для менеджера: 0 — спокій, 2 — горить. */
export function payTone(state: PayState): 0 | 1 | 2 {
  if (state === 'success') return 0;
  if (state === 'failure' || state === 'expired') return 2;
  if (state === 'reversed') return 1;
  return 1; // created / processing — гроші ще не в магазині
}

/** Оплачено — єдина ознака, за якою можна відправляти товар. */
export function isPaid(state: PayState): boolean {
  return state === 'success';
}

/* ---------- Номер рахунку в браузері ----------
   Покупець повертається з банку на сторінку подяки, а номер
   рахунку в адресі не приходить. Тримаємо його в себе: сторінці
   подяки він потрібен рівно для того, щоб спитати банк. */

const KEY = 'reyter:pay';

export function rememberInvoice(orderNum: string, invoiceId: string) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>;
    all[orderNum] = invoiceId;
    // тримаємо останні двадцять: більше нікому не потрібно
    const keys = Object.keys(all).slice(-20);
    const trimmed: Record<string, string> = {};
    for (const k of keys) trimmed[k] = all[k];
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* приватне вікно — тоді просто не памʼятаємо */
  }
}

export function invoiceOf(orderNum: string): string {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>;
    return String(all[orderNum] || '');
  } catch {
    return '';
  }
}
