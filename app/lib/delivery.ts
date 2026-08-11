/* ============================================================
   REYTER — вартість доставки
   ------------------------------------------------------------
   Два перевізники, дві різні системи, спільне правило: покупець
   має побачити число ще до того, як натисне «Підтвердити».

   • Нова Пошта по Україні — метод getDocumentPrice того самого
     API, з якого сайт уже бере міста й відділення. Ключ не
     потрібен: розрахунок відкритий так само, як адресні методи.
     Перевірено 11.08.2026: Київ→Львів, 0,5 кг, оголошена 500 —
     90 грн, копійка в копійку з опублікованим прайсом.

   • Nova Post за кордон — окрема система: старе API міжнародку
     рахувати не вміє взагалі, параметр країни воно мовчки
     ігнорує. Рахуємо тим самим відкритим калькулятором, що
     працює на сайті перевізника. Перевірено того ж дня:
     Київ→Варшава 540 грн, Київ→Берлін 860 грн.

   Обидва запити можуть не відповісти — мережа, ліміт, зміна на
   боці перевізника. Тому під кожним лежить таблиця тарифів, і
   рядок доставки не зникає ніколи: він просто стає «орієнтовно».

   ЩО ВАЖЛИВО ЗНАТИ ПРО ЦІНИ. По Україні тариф до 2 кг плаский —
   0,1 кг і 2 кг коштують однаково, тож похибка у вазі нам не
   шкодить. За кордоном навпаки: ціну робить обʼєм, а не вага.
   Ті самі 0,5 кг у коробці 20×30×10 см до Німеччини — 860 грн,
   а в коробці 40×60×30 см — уже 2550. Звідси й точні розміри
   пакунка нижче: змінювати їх наосліп не можна.
   ============================================================ */

import type { CarrierId } from './address';
import { FREE_DELIVERY_FROM, getProduct, type Catalogue } from './catalog';
import type { CartLine } from './types';

/* ---------- Сталі магазину ---------- */

/** Місто, з якого REYTER відправляє (Київ). */
const ВІДПРАВНИК_NP = '8d5a980d-391c-11dd-90d9-001a92567626';
/** Він же в довіднику міжнародного калькулятора. */
const ВІДПРАВНИК_INTL = 118064;

/** Пакунок: мала коробка, вага з запасом. */
const ПАКУНОК = { вага: 0.5, довжина: 30, ширина: 20, висота: 10 };

/* Категорії, на які поширюється безкоштовна доставка. Обіцянка в
   рухомому рядку — «на білизну по Україні», тож домашній одяг,
   сорочки й пляжне сюди не входять. Список навмисно в коді, а не
   в базі: він міняється разом із асортиментом, і мовчазна зміна
   тут коштувала б грошей. */
const БІЛИЗНА = ['boxers', 'briefs', 'slips', 'jocks', 'ribbed', 'royal', 'sets', 'tanks'];

/* ---------- Що показуємо ---------- */

export interface Quote {
  /** Скільки коштує доставка, грн. */
  cost: number;
  /** Спрацював поріг безкоштовної. */
  free: boolean;
  /** Рахували таблицею, а не в перевізника, — число приблизне. */
  estimate: boolean;
  /** Перевізник ще не знає, куди везти: бракує міста чи країни. */
  unknown: boolean;
}

const НЕВІДОМО: Quote = { cost: 0, free: false, estimate: false, unknown: true };

/* Позиції приходять аргументом, а не читаються з кошика: той
   живе в сховищі браузера, і модуль, який туди лізе, неможливо
   ні перевірити, ні порахувати на сервері. */

/** Сума позицій, на які діє безкоштовна доставка. */
export function underwearSum(c: Catalogue, lines: CartLine[]): number {
  return lines.reduce((s, i) => {
    const p = getProduct(c, i.id);
    if (!p || !БІЛИЗНА.includes(String(p.category))) return s;
    return s + p.price * i.qty;
  }, 0);
}

/** Чи дотягнув кошик до безкоштовної доставки по Україні. */
export function freeReached(sum: number): boolean {
  return sum >= FREE_DELIVERY_FROM;
}

/** Скільки ще додати білизни до безкоштовної доставки. */
export function freeLeft(sum: number): number {
  return Math.max(0, FREE_DELIVERY_FROM - sum);
}

/* ---------- Нова Пошта, Україна ---------- */

const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';

/* Тариф на випадок, коли перевізник не відповів. Числа з
   опублікованої сітки, чинної з 13.04.2026: мала посилка до 2 кг —
   90 грн, поштомат дорожчий на 10, страхування 0,5% від суми
   понад 500. Село дорожче ще на 30, але чи село це — з боку
   сайту не видно, тому не вгадуємо: краще показати менше й
   написати «орієнтовно», ніж вигадати надбавку. */
function таблицяNP(оголошена: number, поштомат: boolean): number {
  const база = 90 + (поштомат ? 10 : 0);
  const страхування = оголошена > 500 ? Math.round((оголошена - 500) * 0.005) : 0;
  return база + страхування;
}

async function цінаNP(cityRef: string, оголошена: number, поштомат: boolean): Promise<number | null> {
  try {
    const res = await fetch(NP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: '',
        modelName: 'InternetDocument',
        calledMethod: 'getDocumentPrice',
        methodProperties: {
          CitySender: ВІДПРАВНИК_NP,
          CityRecipient: cityRef,
          Weight: String(ПАКУНОК.вага),
          ServiceType: поштомат ? 'WarehousePostomat' : 'WarehouseWarehouse',
          Cost: String(Math.max(300, Math.round(оголошена))),
          CargoType: 'Parcel',
          SeatsAmount: '1'
        }
      })
    });
    const json = (await res.json()) as { success?: boolean; data?: { Cost?: number }[] };
    const cost = json?.data?.[0]?.Cost;
    return json.success && typeof cost === 'number' && cost > 0 ? cost : null;
  } catch {
    return null;
  }
}

/* ---------- Nova Post, за кордон ---------- */

const NP_INTL = 'https://api.novapost.com/ui/site/v.1.0';

/* Нижні межі з офіційної сторінки тарифів — на випадок, коли
   калькулятор мовчить. Це саме «від», тому поруч завжди має
   стояти слово «орієнтовно». */
const ЄВРОПА = ['PL','DE','CZ','SK','HU','RO','BG','AT','IT','ES','PT','FR','NL','BE','LU','DK','SE','NO','FI','EE','LV','LT','IE','GB','CH','GR','HR','SI','RS','MD','ME','MK','AL','BA','IS','CY','MT'];
function таблицяIntl(country: string): number {
  if (ЄВРОПА.includes(country)) return 385;
  if (country === 'CN' || country === 'HK') return 2035;
  return 2145;
}

/** Місто в довіднику перевізника. Шукає латинкою, тож кирилиця
 *  тут не спрацює — і це не поламка, а межа їхнього довідника. */
async function містоIntl(country: string, name: string): Promise<number | null> {
  try {
    const url = `${NP_INTL}/settlements?countryCode=${encodeURIComponent(country)}&search=${encodeURIComponent(name)}&limit=1`;
    const json = (await (await fetch(url)).json()) as { items?: { id?: number }[] };
    return json?.items?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function цінаIntl(country: string, settlementId: number, оголошена: number): Promise<number | null> {
  try {
    const res = await fetch(`${NP_INTL}/shipments/delivery-calculations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { countryCode: 'UA', settlementId: ВІДПРАВНИК_INTL, deliveryType: 'branch' },
        recipient: { countryCode: country, settlementId, deliveryType: 'branch' },
        parcels: [
          {
            cargoCategory: 'parcel',
            insuranceCost: Math.max(300, Math.round(оголошена)),
            // калькулятор чекає грами й міліметри
            actualWeight: Math.round(ПАКУНОК.вага * 1000),
            length: ПАКУНОК.довжина * 10,
            width: ПАКУНОК.ширина * 10,
            height: ПАКУНОК.висота * 10
          }
        ]
      })
    });
    const json = (await res.json()) as { services?: { cost?: number }[] };
    if (!Array.isArray(json?.services) || !json.services.length) return null;
    /* Сума всіх послуг, а не лише перевезення: до ціни окремим
       рядком додається надбавка, яку відділення однаково візьме. */
    const сума = json.services.reduce((s, x) => s + (Number(x.cost) || 0), 0);
    return сума > 0 ? Math.round(сума) : null;
  } catch {
    return null;
  }
}

/* ---------- Головне ---------- */

/* Ті самі питання повторюються на кожну зміну форми, а перевізник
   не любить, коли його смикають на кожну літеру. Памʼять живе до
   перезавантаження сторінки — тарифи за цей час не міняються. */
const памʼять = new Map<string, Quote>();

export interface QuoteInput {
  carrier: CarrierId;
  /** Нова Пошта: ідентифікатор міста з підказки. */
  cityRef?: string;
  /** Обрано поштомат, а не відділення. */
  postomat?: boolean;
  /** Міжнародна: ISO-код країни й місто, як його написав покупець. */
  country?: string;
  city?: string;
  /** Оголошена вартість — від неї залежить страхування. */
  declared: number;
  /** Кошик дотягнув до безкоштовної доставки по Україні. */
  free?: boolean;
}

export async function quote(input: QuoteInput): Promise<Quote> {
  const { carrier, declared } = input;

  if (carrier === 'np') {
    // Поріг діє лише по Україні — так написано і в обіцянці на сайті
    if (input.free) return { cost: 0, free: true, estimate: false, unknown: false };
    if (!input.cityRef) return НЕВІДОМО;

    const ключ = `np:${input.cityRef}:${input.postomat ? 1 : 0}:${Math.round(declared)}`;
    const було = памʼять.get(ключ);
    if (було) return було;

    const жива = await цінаNP(input.cityRef, declared, !!input.postomat);
    const q: Quote = жива
      ? { cost: жива, free: false, estimate: false, unknown: false }
      : { cost: таблицяNP(declared, !!input.postomat), free: false, estimate: true, unknown: false };
    памʼять.set(ключ, q);
    return q;
  }

  const country = String(input.country || '').toUpperCase();
  if (!country || country === 'OTHER') return НЕВІДОМО;

  const ключ = `intl:${country}:${(input.city || '').toLowerCase()}:${Math.round(declared)}`;
  const було = памʼять.get(ключ);
  if (було) return було;
  return await міжнародна(ключ, country, input.city || '', declared);
}

async function міжнародна(ключ: string, country: string, city: string, declared: number): Promise<Quote> {
  const id = city ? await містоIntl(country, city) : null;
  const жива = id ? await цінаIntl(country, id, declared) : null;
  const q: Quote = жива
    ? { cost: жива, free: false, estimate: false, unknown: false }
    : { cost: таблицяIntl(country), free: false, estimate: true, unknown: false };
  памʼять.set(ключ, q);
  return q;
}
