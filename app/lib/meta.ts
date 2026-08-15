/* ============================================================
   REYTER — події Meta Pixel
   ------------------------------------------------------------
   Базовий код пікселя підвантажується після гідратації, а
   клієнтський компонент може встигнути повідомити про товар або
   checkout раніше. Тому події не губимо: до появи fbq тримаємо
   їх у короткій черзі, яку потім спорожнює MetaPixel.

   У подіях немає імені, телефону чи пошти — лише артикули,
   кількість і сума покупки.
   ============================================================ */

export type MetaEvent = 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Purchase';
export type MetaParams = Record<string, unknown>;

type MetaOptions = { eventID: string };
type MetaCall = ['track', MetaEvent, MetaParams, MetaOptions?];
type Fbq = (
  command: 'track',
  event: MetaEvent,
  params: MetaParams,
  options?: MetaOptions
) => void;

declare global {
  interface Window {
    fbq?: Fbq;
    __reyterMetaQueue?: MetaCall[];
  }
}

export interface MetaLine {
  id: string;
  quantity: number;
  item_price: number;
}

export interface MetaBrowserContext {
  fbp?: string;
  fbc?: string;
}

/** Ідентифікатори, які Meta сама залишає у браузері. Передаємо
 *  їх платіжному Worker разом зі створенням рахунку, щоб після
 *  банківського webhook серверна Purchase знайшла ту саму
 *  людину й дедуплікувалась із браузерною подією. */
export function metaBrowserContext(): MetaBrowserContext {
  if (typeof window === 'undefined') return {};

  const cookies = typeof document === 'undefined' ? '' : document.cookie;
  const cookie = (name: string) => {
    const row = cookies
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${name}=`));
    if (!row) return '';
    try {
      return decodeURIComponent(row.slice(name.length + 1));
    } catch {
      return row.slice(name.length + 1);
    }
  };

  const fbp = cookie('_fbp');
  let fbc = cookie('_fbc');
  try {
    const fbclid = new URL(window.location.href).searchParams.get('fbclid');
    if (!fbc && fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;
  } catch {
    /* У тестовому або обмеженому браузері location може бути
       недоступним. Cookie _fbc/_fbp однаково лишаються корисні. */
  }

  return {
    ...(fbp ? { fbp } : {}),
    ...(fbc ? { fbc } : {})
  };
}

/** Спільний формат товарів для кошика, checkout і покупки. */
export function metaCartParams(lines: MetaLine[], value: number): MetaParams {
  return {
    content_ids: lines.map((line) => line.id),
    contents: lines,
    content_type: 'product',
    num_items: lines.reduce((sum, line) => sum + line.quantity, 0),
    value: Math.max(0, Number(value) || 0),
    currency: 'UAH'
  };
}

/** Дані одного товару — однакові для перегляду й додавання. */
export function metaProductParams(
  product: { id: string; name: string; price: number; category?: string },
  quantity = 1
): MetaParams {
  return {
    ...metaCartParams(
      [{ id: product.id, quantity, item_price: Number(product.price) || 0 }],
      (Number(product.price) || 0) * quantity
    ),
    content_name: product.name,
    ...(product.category ? { content_category: product.category } : {})
  };
}

/** Надіслати стандартну браузерну подію або поставити її в чергу
 *  до моменту, коли базовий код створить window.fbq. */
export function trackMeta(event: MetaEvent, params: MetaParams, eventID = ''): boolean {
  if (typeof window === 'undefined') return false;

  if (window.fbq) {
    if (eventID) window.fbq('track', event, params, { eventID });
    else window.fbq('track', event, params);
    return true;
  }

  const call: MetaCall = eventID
    ? ['track', event, params, { eventID }]
    : ['track', event, params];
  (window.__reyterMetaQueue ??= []).push(call);
  return true;
}

/** Purchase не можна рахувати повторно після кожного оновлення
 *  сторінки подяки. Ключ зберігаємо лише після того, як подію
 *  передано fbq або його черзі. */
export function trackMetaOnce(
  key: string,
  event: MetaEvent,
  params: MetaParams,
  eventID = ''
): boolean {
  if (typeof window === 'undefined') return false;
  const storageKey = `reyter:meta:${key}`;

  try {
    if (window.localStorage.getItem(storageKey)) return false;
  } catch {
    /* У приватному режимі дедуплікація житиме лише в Meta за
       eventID; сама подія однаково має піти. */
  }

  if (!trackMeta(event, params, eventID)) return false;
  try {
    window.localStorage.setItem(storageKey, new Date().toISOString());
  } catch {
    /* localStorage може бути вимкнено політикою браузера. */
  }
  return true;
}
