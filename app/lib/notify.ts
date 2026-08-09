/* ============================================================
   REYTER — сповіщення про замовлення
   ------------------------------------------------------------
   Замовлення йде в Cloudflare Worker, а вже він розсилає:
   Telegram власнику й лист-підтвердження покупцю. Ключ Resend
   і токен бота лежать у воркері, тож із коду сайту їх не видно.

   Старий сайт мав ще два резервні шляхи — FormSubmit для листа
   й прямий Bot API для Telegram. Вони працювали, поки токен
   лишався в базі. Токен звідти прибрано, тож резерв не спрацював
   би все одно, і сюди він не перенесений.

   Помилка тут нічого не ламає: замовлення вже в базі, і власник
   побачить його в адмінці навіть без повідомлення.
   ============================================================ */

import { addressLine } from './address';
import { uah } from './catalog';
import { confirmLine, type Order } from './order';
import type { Lang } from './types';

export interface NotifySettings {
  workerUrl?: string;
}

/** Адресу могли зберегти без https:// — інакше браузер вважав би
 *  її відносним шляхом на самому сайті. */
export function normalizeUrl(u?: string | null): string {
  const s = String(u || '')
    .trim()
    .replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

export interface NotifyResult {
  email: { ok: boolean; error: string };
  telegram: { ok: boolean; sent: number; total: number; error: string };
}

function workerBody(order: Order, lang: Lang, t: (k: string) => string) {
  const c = order.customer;
  return {
    type: 'order',
    silent: false,
    to: c.email || '',
    name: c.name || '',
    phone: c.phone || '',
    orderNum: order.num,
    items: order.items.map((i) => ({
      name: i.name,
      category: i.category || '',
      size: i.size || '',
      qty: i.qty,
      sum: uah(i.price * i.qty, lang),
      // склад комплекту з розмірами: покупець має бачити, що саме
      // він замовив, а магазин — що складати
      parts: (i.parts || []).map(
        (x) => (x.category ? x.category + ' · ' : '') + (x.name || x.id) + (x.size ? ' · ' + x.size : '')
      )
    })),
    total: uah(order.total, lang),
    subtotal: uah(order.subtotal, lang),
    discount: order.discount ? uah(order.discount, lang) : '',
    // Доставку рахує магазин уже після підтвердження — на цьому
    // етапі її ще немає, і поле лишається порожнім
    shipping: '',
    promoCode: order.promoCode || '',
    delivery: addressLine(c),
    comment: c.comment || '',
    confirm: confirmLine(c, t),
    source: 'Сайт',
    lang: lang
  };
}

export async function orderPlaced(
  settings: NotifySettings | null,
  order: Order,
  lang: Lang,
  t: (k: string) => string
): Promise<NotifyResult> {
  const out: NotifyResult = {
    email: { ok: false, error: order.customer.email ? '' : 'Покупець не вказав email' },
    telegram: { ok: false, sent: 0, total: 0, error: '' }
  };

  const url = normalizeUrl(settings?.workerUrl);
  if (!url) {
    out.telegram.error = 'не вказано адресу Worker у налаштуваннях';
    return out;
  }

  let data: Record<string, unknown> = {};
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workerBody(order, lang, t))
    });
    data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && !data.error) data.error = 'воркер відповів кодом ' + res.status;
  } catch {
    out.telegram.error = 'не вдалося звʼязатися з воркером';
    return out;
  }

  const email = (data.email ?? {}) as { ok?: boolean; error?: string };
  const tg = (data.telegram ?? {}) as { ok?: boolean; sent?: number; total?: number; error?: string };

  out.email = { ok: !!email.ok, error: email.error || String(data.error || '') };
  out.telegram = {
    ok: !!tg.ok,
    sent: tg.sent || 0,
    total: tg.total || 0,
    error: tg.error || String(data.error || '')
  };
  return out;
}

/* ---------- Лист із персональним промокодом ----------
   Персональний код видають конкретній людині, і надіслати його
   має магазин, а не сам покупець. Лист іде тим самим воркером,
   що й підтвердження замовлення. */

export interface PromoLetter {
  to: string;
  code: string;
  /** «300 грн» або «10%» — уже готовий рядок. */
  value: string;
  /** Умови людською мовою. */
  terms: string;
}

export async function sendPromoLetter(
  settings: NotifySettings | null,
  letter: PromoLetter,
  lang: Lang = 'uk'
): Promise<{ ok: boolean; error: string }> {
  if (!letter.to) return { ok: false, error: 'У коду немає пошти отримувача' };

  const url = normalizeUrl(settings?.workerUrl);
  if (!url) return { ok: false, error: 'не вказано адресу Worker у налаштуваннях' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'promo', ...letter, lang })
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (data.ok) return { ok: true, error: '' };
    return {
      ok: false,
      error: String(data.error ?? '') || 'воркер відповів кодом ' + res.status
    };
  } catch {
    return { ok: false, error: 'не вдалося звʼязатися з воркером' };
  }
}

/* ---------- Лист «товар знову в наявності» ----------
   Покупець підписався на розмір, якого не було, і чекає. Лист
   іде тим самим воркером; помилку тут ковтаємо — прихід через
   неї скасовувати безглуздо. */

export interface BackInStockMail {
  to: string;
  product: string;
  size: string;
  image: string;
  url: string;
  lang: string;
}

export async function sendBackInStock(
  settings: NotifySettings | null,
  mail: BackInStockMail
): Promise<boolean> {
  const url = normalizeUrl(settings?.workerUrl);
  if (!url || !mail.to) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'back-in-stock', ...mail })
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return !!data.ok;
  } catch {
    return false;
  }
}
