/* ============================================================
   REYTER — відстеження замовлення без акаунта
   ------------------------------------------------------------
   Покупець, який оформив замовлення гостем, теж має бачити його
   статус. Читати колекцію orders гостю не можна — там адреси й
   телефони всіх покупців. Тому поряд лежить окрема колекція
   tracking з мінімумом даних (статус, дати, ТТН), а ідентифікатор
   документа — відбиток від номера замовлення і телефону. Знайти
   запис може лише той, хто знає обидва: перебрати номери (їх
   формат передбачуваний) недостатньо.

   Портовано з js/track.js один в один. Відмінності вимушені й не
   змістовні: Firestore викликається модульним SDK замість compat,
   а замість R.fb.enabled береться db() — null означає те саме, що
   вимкнений Firebase. Алгоритм ключа не змінено жодним символом:
   інші числа означали б інший документ, і покупці втратили б
   доступ до вже створених замовлень.
   ============================================================ */

import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { OrderItem, OrderStatus } from './types';

/* ---------- Документ tracking/{key} ---------- */

export interface TrackLogEntry {
  status: string;
  at: string;
}

export interface TrackItem {
  name: string;
  size: string;
  qty: number;
  /** Склад комплекту готовими рядками — покупець має впізнати
   *  свої розміри, а розбирати їх тут більше нікому. */
  parts?: string[];
}

export interface TrackDoc {
  num: string;
  date: string;
  status: OrderStatus;
  total: number;
  items: TrackItem[];
  /** Порожній, поки замовлення не відправили. */
  ttn: string;
  carrier: string;
  city: string;
  /** Історія статусів без імен адміністраторів. */
  log: TrackLogEntry[];
}

/* ---------- Замовлення на вході ----------
   Описане настільки, наскільки його читає цей модуль: сюди
   потрапляє і щойно складене замовлення з кошика, і документ
   з адмінки, у якого полів значно більше. */

export interface TrackCustomer {
  phone?: string;
  carrier?: string;
  city?: string;
  /** Спадок часів, коли закордонна адреса лежала плоскими
   *  полями, а не у вкладеному intl. Старі замовлення інакше
   *  показували б місто порожнім. */
  intlCity?: string;
}

/** Запис історії в самому замовленні. Крім статусу й часу в ньому
 *  є ще `by` — пошта адміністратора; у tracking вона не йде. */
export interface OrderLogEntry {
  status?: string;
  at?: string;
  by?: string;
}

export interface TrackSource {
  num?: string;
  date?: string;
  status?: OrderStatus;
  total?: number;
  items?: readonly OrderItem[];
  ttn?: string;
  statusLog?: readonly OrderLogEntry[];
  customer?: TrackCustomer;
  /** Ключ, порахований при оформленні й збережений у замовленні. */
  trackKey?: string;
}

export type TrackFailReason = 'offline' | 'no_num' | 'no_phone' | 'not_found';

export type TrackResult =
  | { ok: true; order: TrackDoc }
  | { ok: false; reason: TrackFailReason };

/* ---------- Ключ ---------- */

/* Телефон покупець пише як завгодно: +380…, 380…, 0…
   Беремо останні 9 цифр — це та частина, що не змінюється */
export function phoneTail(phone?: string | null): string {
  return String(phone || '')
    .replace(/\D/g, '')
    .slice(-9);
}

/* Ключ документа = відбиток «номер + телефон».
   SHA-256 є в кожному сучасному браузері, але лише на
   захищеному зʼєднанні; на http (локальний перегляд файлу)
   crypto.subtle недоступний — тоді відкочуємось на просту
   згортку. Для http-режиму це все одно лише розробка. */
export async function trackKey(num?: string | null, phone?: string | null): Promise<string> {
  const raw = String(num || '').trim().toUpperCase() + '|' + phoneTail(phone);
  /* Роздільник є завжди, тож порожнім raw не буває — перевірка
     насправді відсіює закороткий ввід. Лишаємо як в оригіналі:
     від довжини залежить, які пари взагалі мають ключ. */
  if (!raw || raw.length < 4) return '';

  const subtle: SubtleCrypto | undefined =
    typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto.subtle;

  if (subtle) {
    try {
      const buf = await subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 40);
    } catch {
      /* нижче резервний варіант */
    }
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    h1 = ((h1 ^ raw.charCodeAt(i)) * 16777619) >>> 0;
    h2 = ((h2 + raw.charCodeAt(i) * (i + 7)) * 2654435761) >>> 0;
  }
  return ('dev' + h1.toString(16) + h2.toString(16)).slice(0, 40);
}

/* ---------- Документ ---------- */

/* Публічна частина замовлення. Свідомо без імені, телефону,
   пошти й точної адреси: документ читає будь-хто з ключем.
   Назви товарів не таємниця — вони і так є в каталозі, зате
   покупець одразу впізнає своє замовлення. */
export function trackData(order: TrackSource): TrackDoc {
  const c = order.customer || {};
  const log: TrackLogEntry[] = (order.statusLog || [])
    .map((e) => ({ status: String(e.status || ''), at: String(e.at || '') }))
    .slice(-12);

  return {
    num: String(order.num || ''),
    date: String(order.date || ''),
    status: order.status || 'new',
    total: Number(order.total) || 0,
    items: (order.items || []).slice(0, 50).map((i) => {
      const out: TrackItem = {
        name: String(i.name || ''),
        size: String(i.size || ''),
        qty: Number(i.qty) || 1
      };
      // комплект: покупець має впізнати свої розміри
      if (i.parts && i.parts.length) {
        out.parts = i.parts
          .slice(0, 10)
          .map(
            (x) =>
              (x.category ? x.category + ' · ' : '') +
              String(x.name || x.id || '') +
              (x.size ? ' · ' + x.size : '')
          );
      }
      return out;
    }),
    ttn: order.ttn || '',
    carrier: c.carrier || '',
    city: c.city || c.intlCity || '',
    log: log.length ? log : [{ status: order.status || 'new', at: order.date || '' }]
  };
}

/* ---------- Запис ---------- */

/* Створення запису при оформленні. Помилка тут не має валити
   саме замовлення — воно вже в базі, відстеження вторинне. */
export async function trackCreate(order: TrackSource): Promise<string> {
  const d = db();
  if (!d) return '';
  const c = order.customer || {};
  const key = await trackKey(order.num, c.phone);
  if (!key) return '';
  try {
    await setDoc(doc(d, 'tracking', key), trackData(order));
    return key;
  } catch {
    return '';
  }
}

/* Оновлення статусу / ТТН з адмінки. Ключ лежить у самому
   замовленні: телефон могли відредагувати, і рахувати його
   заново означало б писати в чужий документ. */
export async function trackUpdate(
  order: TrackSource,
  patch?: Partial<TrackDoc> | null
): Promise<boolean> {
  const d = db();
  if (!d) return false;
  const key = order.trackKey || (await trackKey(order.num, (order.customer || {}).phone));
  if (!key) return false;
  try {
    await setDoc(doc(d, 'tracking', key), { ...trackData(order), ...(patch || {}) }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

export async function trackDelete(key?: string | null): Promise<void> {
  /* Ключ перевіряємо ПЕРШИМ, як в оригіналі: db() ліниво піднімає
     SDK, і виклик із порожнім ключем не має цього робити. */
  if (!key) return;
  const d = db();
  if (!d) return;
  try {
    await deleteDoc(doc(d, 'tracking', key));
  } catch {
    /* не критично */
  }
}

/* ---------- Пошук для покупця ---------- */

export async function trackFind(num?: string | null, phone?: string | null): Promise<TrackResult> {
  const d = db();
  if (!d) return { ok: false, reason: 'offline' };

  const clean = String(num || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!clean) return { ok: false, reason: 'no_num' };
  if (phoneTail(phone).length < 9) return { ok: false, reason: 'no_phone' };

  const key = await trackKey(clean, phone);
  try {
    const snap = await getDoc(doc(d, 'tracking', key));
    if (!snap.exists()) return { ok: false, reason: 'not_found' };
    return { ok: true, order: snap.data() as TrackDoc };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}
