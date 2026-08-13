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
    lang?: Lang;
  }
): Promise<PayInvoice> {
  const r = await ask(workerUrl, {
    type: 'pay-create',
    orderNum: input.orderNum,
    items: input.items,
    promo: input.promo || '',
    shipping: input.shipping || 0,
    to: input.email || '',
    lang: input.lang || 'uk'
  });
  return {
    ok: r.ok === true,
    invoiceId: String(r.invoiceId || ''),
    pageUrl: String(r.pageUrl || ''),
    amount: Number(r.amount) || 0,
    error: String(r.error || '')
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
    name?: string;
    lang?: Lang;
  }
): Promise<PayInvoice & { mailed: boolean; mailError: string }> {
  const r = await ask(workerUrl, {
    type: 'pay-link',
    key,
    orderNum: input.orderNum,
    items: input.items,
    promo: input.promo || '',
    shipping: input.shipping || 0,
    to: input.email,
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
    mailError: String(mail.error || '')
  };
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
