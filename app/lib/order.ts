/* ============================================================
   REYTER — складання замовлення
   ------------------------------------------------------------
   Чисті функції: з кошика й даних покупця роблять обʼєкт
   замовлення, який далі лягає в Firestore, у localStorage і
   в текст для Telegram.

   Ключове правило: у замовленні зберігаються НАЗВИ, а не лише
   артикули. Каталог живий — товар перейменують, категорію
   видалять, комплект переберуть, — а лист, повідомлення й картка
   в адмінці мусять показувати те, що покупець бачив на момент
   покупки.
   ============================================================ */

import { catTitle, getProduct, fmt, type Catalogue } from './catalog';
import { addressLine, type Address } from './address';
import type { CartLine, OrderItem, OrderPart } from './types';

export interface Confirm {
  method: 'call' | 'messenger' | 'none';
  messenger: string;
  phoneMode: 'main' | 'other';
  altPhone: string;
  telegram?: string;
}

export interface Customer extends Address {
  name: string;
  phone: string;
  email: string;
  comment?: string;
  confirm?: Confirm;
  /* Покупця записують у базу цілком, а поля йому дописували
     роками — закритий набір тут не витримав би першого ж
     нового поля в адмінці. */
  [key: string]: unknown;
}

export interface Order {
  num: string;
  date: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  promoCode: string;
  /** Вартість доставки, яка входить у суму замовлення. Нуль, коли
   *  покупець платить перевізникові сам при отриманні. */
  shipping: number;
  total: number;
  customer: Customer;
  message?: string;
  /** Скільки коштує доставка, коли її платить отримувач. Лише для
   *  тексту замовлення — у суму це не входить. */
  shippingNote?: string;
}

export const MESSENGERS = [
  { id: 'telegram', title: 'Telegram' },
  { id: 'whatsapp', title: 'WhatsApp' },
  { id: 'viber', title: 'Viber' }
] as const;

/* ---------- Номер ----------
   Дата плюс три випадкові цифри. Наскрізного лічильника немає
   навмисно: він потребував би запису в базу до створення
   замовлення, а колізія в межах одного дня практично неможлива
   й нічому не заважає — ключ документа все одно інший. */
export function orderNumber(now: Date, rand: number = Math.random()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    'R-' +
    String(now.getFullYear()).slice(2) +
    two(now.getMonth() + 1) +
    two(now.getDate()) +
    '-' +
    String(Math.floor(100 + rand * 900))
  );
}

/* ---------- Позиції ---------- */

export function orderItems(c: Catalogue, lines: CartLine[]): OrderItem[] {
  return lines.map((i) => {
    const p = getProduct(c, i.id)!;
    const item: OrderItem = {
      id: p.id,
      name: p.name,
      category: catTitle(c, p.category),
      size: i.size,
      qty: i.qty,
      price: p.price,
      volume: !!p.volume
    };
    if (i.parts?.length) {
      item.parts = i.parts.map<OrderPart>((x) => {
        const sp = getProduct(c, x.id);
        return {
          id: x.id,
          name: sp ? sp.name : x.id,
          category: sp ? catTitle(c, sp.category) : '',
          size: x.size || null,
          volume: !!sp?.volume
        };
      });
    }
    return item;
  });
}

/* ---------- Рядок підтвердження ----------
   Як саме зателефонувати покупцю: спосіб, номер і логін. Один
   рядок для листа, Telegram і адмінки. */
export function confirmLine(customer: Customer, t: (k: string) => string): string {
  const c = customer.confirm;
  if (!c) return '';

  /* Покупець може попросити не турбувати — і менеджер має це
     побачити першим рядком, а не здогадатись із порожнечі. */
  if (c.method === 'none') return t('co.noContact');

  const title = MESSENGERS.find((m) => m.id === c.messenger)?.title ?? '';
  const how = c.method === 'messenger' ? title || t('cart.byMessenger') : t('cart.byCall');

  const phone = c.phoneMode === 'other' && c.altPhone ? c.altPhone : customer.phone || '';
  const out = [how];
  if (phone) out.push(phone);
  if (c.telegram) out.push('@' + c.telegram);
  return out.join(' · ');
}

/* ---------- Текст для Telegram ----------
   Власник читає його з телефона, тому склад комплекту йде
   з відступом окремими рядками, а не в один рядок. */
export function buildMessage(order: Order, t: (k: string) => string): string {
  const lines: string[] = [];
  lines.push('🛍 Замовлення №' + order.num + ' — reyter.men');
  lines.push('');

  order.items.forEach((i, n) => {
    lines.push(n + 1 + '. ' + i.name + (i.category ? ' — ' + i.category : '') + ' (' + i.id + ')');
    lines.push(
      '   ' +
        (i.size ? (i.volume ? 'обʼєм ' : 'розмір ') + i.size + ' · ' : '') +
        i.qty +
        ' шт · ' +
        fmt(i.price * i.qty) +
        ' грн'
    );
    (i.parts || []).forEach((x) => {
      lines.push('      – ' + (x.category ? x.category + ' · ' : '') + x.name + (x.size ? ' · ' + x.size : ''));
    });
  });

  lines.push('');
  if (order.discount) {
    lines.push('Сума: ' + fmt(order.subtotal) + ' грн');
    lines.push('Промокод ' + order.promoCode + ': −' + fmt(order.discount) + ' грн');
  }
  if (order.shipping) lines.push('Доставка: ' + fmt(order.shipping) + ' грн');
  else if (order.shippingNote) lines.push('Доставка: ' + order.shippingNote);
  lines.push('Разом: ' + fmt(order.total) + ' грн');
  lines.push('');
  lines.push('👤 ' + order.customer.name);
  lines.push('📞 ' + order.customer.phone);

  const delivery = addressLine(order.customer);
  if (delivery) lines.push('🚚 ' + delivery);

  const confirm = confirmLine(order.customer, t);
  if (confirm) lines.push('☎️ Підтвердження: ' + confirm);
  if (order.customer.comment) lines.push('💬 ' + order.customer.comment);

  return lines.join('\n');
}

export function buildOrder(input: {
  c: Catalogue;
  lines: CartLine[];
  customer: Customer;
  subtotal: number;
  discount: number;
  promoCode: string;
  /** Доставка, яку покупець платить разом із замовленням. */
  shipping?: number;
  /** Довідковий рядок для тих, хто платить у відділенні. */
  shippingNote?: string;
  now: Date;
  t: (k: string) => string;
}): Order {
  const order: Order = {
    num: orderNumber(input.now),
    date: input.now.toISOString(),
    items: orderItems(input.c, input.lines),
    subtotal: input.subtotal,
    discount: input.discount,
    promoCode: input.promoCode,
    shipping: Math.max(0, Math.round(input.shipping ?? 0)),
    total: Math.max(0, input.subtotal - input.discount) + Math.max(0, Math.round(input.shipping ?? 0)),
    customer: input.customer
  };
  if (input.shippingNote) order.shippingNote = input.shippingNote;
  order.message = buildMessage(order, input.t);
  return order;
}

/* ---------- Перевірка полів ---------- */

export const PHONE_RE = /^[+\d][\d\s()-]{8,}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Пошта необовʼязкова, але якщо вписана — має бути схожою на
 *  пошту: без неї покупець просто не отримає підтвердження. */
export function checkCustomer(v: { name: string; phone: string; email: string }) {
  if (!v.name.trim()) return { field: 'name' as const, key: 'cart.fillNamePhone' };
  if (!PHONE_RE.test(v.phone.trim())) return { field: 'phone' as const, key: 'cart.fillNamePhone' };
  /* Пошта обовʼязкова: на неї йде підтвердження замовлення, лист
     «знову в наявності» і за нею ж покупець бачить свої замовлення
     в кабінеті. Без неї замовлення нікуди написати. */
  if (!EMAIL_RE.test(v.email.trim())) {
    return { field: 'email' as const, key: 'cart.checkEmail' };
  }
  return null;
}
