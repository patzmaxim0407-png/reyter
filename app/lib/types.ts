/* ============================================================
   REYTER — предметна модель
   ------------------------------------------------------------
   Ті самі поля, що й у Firestore. Типи описують реальні дані,
   а не бажані: майже все необовʼязкове, бо каталог наповнювався
   роками й старі картки не мають нових полів.
   ============================================================ */

export type Lang = 'uk' | 'en';

export interface Category {
  id: string;
  title: string;
  titleEn?: string;
  order?: number;
}

/** Колір товару. Старий формат — просто рядок з відтінком,
 *  новий — обʼєкт, де id вказує на картку того самого товару
 *  в іншому кольорі. */
export type ColorRaw = string | { hex?: string; id?: string };
export interface Color {
  hex: string;
  id: string;
}

export interface Product {
  id: string;
  name: string;
  nameEn?: string;
  price: number;
  oldPrice?: number;
  priceUsd?: number;
  /** Собівартість одиниці, грн. Потрібна лише для аналітики:
   *  без неї маржі не буває, а виручка сама по собі каже мало —
   *  товар може продаватись найкраще й приносити найменше.
   *
   *  У ВІДКРИТИЙ КАТАЛОГ НЕ ПОТРАПЛЯЄ НІКОЛИ. Опублікований
   *  документ читає весь світ, і собівартість у ньому — це
   *  подарунок конкурентові й привід для розмови покупцеві. Її
   *  зрізає publishNow, і це не косметика, а умова існування
   *  самого поля. */
  cost?: number;

  /** Головна категорія. За нею рахуються склад і статистика. */
  category: string;
  /** Додаткові категорії: товар може стояти в кількох одразу. */
  categories?: string[];

  status?: 'in-stock' | 'sold-out';
  sizes?: string[];
  lowStock?: string[];
  /** Обʼєм замість розмірів — для свічок і дифузорів. */
  volume?: string;

  /** Артикули складників, якщо товар — комплект. */
  set?: string[];

  sale?: boolean;
  saleNote?: string;
  saleNoteEn?: string;
  hidden?: boolean;
  /** ДОСТУП. Тільки для Friendly Club: у відкритому каталозі
   *  товару немає зовсім, він публікується в закритий документ,
   *  і сторонній його не бачить і не купить. */
  friendly?: boolean;
  /** ПОЗНАЧКА. Товар відкритий усім, але помічений як Friendly —
   *  «це з клубної добірки». Доступу не обмежує нічим.
   *
   *  Розділено навмисно: позначка й доступ — різні рішення.
   *  Буває товар, який хочеться показати всім саме з цією
   *  позначкою, як натяк, чого коштує вступити. */
  friendlyMark?: boolean;

  colors?: ColorRaw[];
  images: string[];

  fabric?: string;
  material?: string;
  aroma?: string;
  model?: string;
  notes?: string[];
  /** Які з трьох приміток під кнопкою «Додати в кошик» ПРИХОВАТИ.
   *
   *  Саме «приховати», а не «показати»: список відсутній —
   *  показуємо всі три, і всі товари, заведені до появи цього
   *  поля, поводяться так само, як поводились. Список дозволених
   *  зробив би навпаки: старі товари лишились би взагалі без
   *  приміток, мовчки.
   *
   *  Потрібне це там, де спільна примітка не про цей товар:
   *  «доставка БІЛИЗНИ безкоштовна» на свічці читається як
   *  обіцянка, якої ніхто не давав. */
  noteOff?: NoteId[];
  characteristics?: string[];
  care?: string[];

  order?: number;
}

/** Примітки під кнопкою «Додати в кошик». Три на весь магазин:
 *  доставка, поріг безкоштовної, міжнародні замовлення. */
export type NoteId = 'np' | 'free' | 'intl';

export interface Catalog {
  categories: Category[];
  products: Product[];
  /** Час запланованої публікації, якщо вона ще не набрала чинності. */
  nextAt?: number | null;
  /** Поріг безкоштовної доставки, грн — з налаштувань магазину. */
  freeFrom?: number;
}

/** Залишки: або по розмірах, або поштучно (товари без сітки). */
export interface StockEntry {
  sizes?: Record<string, number>;
  qty?: number;
}
export type Stock = Record<string, StockEntry>;

/** Доступність, порахована з залишків або зі статичних полів. */
export interface Availability {
  /** true — числа взяті з живих залишків, а не з картки товару. */
  live: boolean;
  soldOut: boolean;
  /** Розміри, які можна купити. */
  sizes: string[];
  /** Розміри, яких лишилось мало. */
  low: string[];
  total: number;
  /** true — це комплект, і числа порахован0 за складниками. */
  isSet?: boolean;
}

/* ---------- Кошик і замовлення ---------- */

/** Складник комплекту в позиції кошика. */
export interface CartPart {
  id: string;
  size: string | null;
}

export interface CartLine {
  id: string;
  size: string | null;
  qty: number;
  /** Лише для комплектів: обраний розмір кожного складника. */
  parts?: CartPart[];
}

/** Складник у збереженому замовленні — з назвою й категорією,
 *  щоб лист і адмінка не залежали від поточного каталогу. */
export interface OrderPart extends CartPart {
  name: string;
  category?: string;
  volume?: boolean;
}

export interface OrderItem {
  id: string;
  name: string;
  category?: string;
  size: string | null;
  qty: number;
  price: number;
  volume?: boolean;
  parts?: OrderPart[];
}

export type OrderStatus = 'new' | 'confirmed' | 'shipped' | 'done' | 'cancelled';
