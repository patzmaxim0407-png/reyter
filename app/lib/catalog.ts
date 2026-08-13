/* ============================================================
   REYTER — правила каталогу
   ------------------------------------------------------------
   Чисті функції без DOM і без мережі: однакові на сервері й
   у браузері. Тут живе вся логіка, від якої залежить, що покупець
   бачить на картці: наявність, розміри, комплекти, кольори.

   Портовано з js/catalog.js один в один — поведінка має збігатися,
   поки старий сайт іще працює поруч.
   ============================================================ */

import type { Availability, Category, Color, Product, Stock } from './types';

export const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL'];
/** «Закінчується», коли лишилось стільки або менше. */
export const LOW_STOCK_AT = 2;

export type Catalogue = {
  products: Product[];
  stock: Stock;
  /** Потрібні лише там, де показуємо назву категорії (кошик,
   *  лист покупцеві). Розрахунки наявності без них обходяться. */
  categories?: Category[];
};

/** Назва категорії за id. Категорію могли видалити вже після
 *  того, як товар потрапив у кошик, — тоді просто нічого. */
export function catTitle(c: Catalogue, id?: string | null): string {
  if (!id) return '';
  return c.categories?.find((x) => x.id === id)?.title ?? '';
}

/** Каталог для кошика: він їде в браузер на кожній сторінці, тож
 *  тягне лише ті поля, які кошик і оформлення справді читають.
 *  Повний каталог утричі важчий, а описи, догляд і решта картинок
 *  там ні до чого.
 *
 *  Заховані товари лишаються: складник комплекту зазвичай саме
 *  захований, і без нього комплект у кошику розсипався б. */
export function cartCatalogue(
  products: Product[],
  stock: Stock,
  categories: Category[]
): Catalogue {
  return {
    stock,
    categories,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      nameEn: p.nameEn,
      price: p.price,
      category: p.category,
      categories: p.categories,
      set: p.set,
      hidden: p.hidden,
      sale: p.sale,
      volume: p.volume,
      sizes: p.sizes,
      status: p.status,
      lowStock: p.lowStock,
      images: p.images.slice(0, 1)
    }))
  };
}

export function getProduct(c: Catalogue, id: string): Product | null {
  return c.products.find((p) => p.id === id) ?? null;
}

export function visibleProducts(c: Catalogue): Product[] {
  return c.products.filter((p) => !p.hidden);
}

/** Товар може стояти в кількох категоріях одразу: наприклад
 *  Swimwear показується і в своїй категорії, і в «New drop».
 *  Поле category лишається головним. */
export function productCats(p: Product): string[] {
  const list = Array.isArray(p.categories) ? p.categories.filter(Boolean) : [];
  if (p.category && !list.includes(p.category)) list.unshift(p.category);
  return list;
}

export function inCategory(p: Product, catId: string): boolean {
  return productCats(p).includes(catId);
}

/** Чи має товар розмірну сітку (свічки й аромати її не мають). */
export function isSized(p: Product | null): boolean {
  return !!(p && !p.volume && p.sizes && p.sizes.length);
}

/* ============================================================
   КОМПЛЕКТИ
   Комплект — товар, зібраний з інших товарів каталогу.
   Власних залишків не має: скільки комплектів можна зібрати,
   рахується зі складників. Розміру «комплекту» теж не існує —
   покупець обирає розмір кожного складника окремо.
   ============================================================ */

export function isSet(p: Product | null): boolean {
  return !!(p && Array.isArray(p.set) && p.set.length);
}

/** Складники з каталогу.
 *  Схований складник ЛИШАЄТЬСЯ у комплекті: «сховати з сайту»
 *  означає «не продавати окремо», а не «вийняти з комплекту».
 *  Інакше покупець платив би за комплект, а отримував менше.
 *  Відкидаємо лише те, чого справді немає: видалений товар і
 *  складник, який сам став комплектом (це була б рекурсія). */
export function setParts(c: Catalogue, p: Product | null): Product[] {
  if (!isSet(p)) return [];
  return (p as Product).set!
    .map((id) => getProduct(c, id))
    .filter((x): x is Product => !!x && !isSet(x));
}

/** Комплект, з якого зник складник, зібрати неможливо. */
export function setBroken(c: Catalogue, p: Product): boolean {
  return isSet(p) && setParts(c, p).length !== (p.set as string[]).length;
}

/** Скільки штук товару в цьому розмірі. Без живих залишків
 *  орієнтуємось на статичні поля: точного числа там немає. */
export function stockQty(c: Catalogue, p: Product | null, size: string | null): number {
  if (!p) return 0;
  const s = c.stock?.[p.id];
  const sized = isSized(p);

  if (!s) {
    if (p.status === 'sold-out') return 0;
    if (!sized) return 99;
    return size && (p.sizes ?? []).includes(size) ? 99 : 0;
  }
  if (!sized) return Number(s.qty) || 0;
  return Number((s.sizes ?? {})[size ?? '']) || 0;
}

/** Скільки комплектів одного розміру можна зібрати: обмежує
 *  найдефіцитніший складник. */
export function setQty(c: Catalogue, p: Product, size: string | null): number {
  const parts = setParts(c, p);
  if (!parts.length) return 0;
  return (
    parts.reduce(
      (min, x) => Math.min(min, stockQty(c, x, isSized(x) ? size : null)),
      Infinity
    ) || 0
  );
}

function setAvailability(c: Catalogue, p: Product): Availability {
  const parts = setParts(c, p);

  // Складники зникли з каталогу — комплект не зібрати ні з чого.
  // Не можна вдавати звичайний товар: він показався б «у наявності».
  if (!parts.length) {
    return { live: false, isSet: true, soldOut: true, sizes: [], low: [], total: 0 };
  }

  const avs = parts.map((x) => availability(c, x));
  const soldOut = setBroken(c, p) || avs.some((a) => a.soldOut);

  /* Розміри, у яких комплект збирається «весь одного розміру» —
     для бейджів на картці. У самій картці товару покупець бачить
     сітку кожного складника окремо й може змішувати розміри.
     Якщо жоден складник не має сітки (свічка + дифузор), розмірів
     у комплекту немає зовсім — інакше бейдж «закінчується»
     перелічував би всі розміри, яких не існує. */
  const sized = parts.some(isSized);
  const sizes = sized
    ? ALL_SIZES.filter((s) => parts.every((x) => !isSized(x) || stockQty(c, x, s) > 0))
    : [];

  const low = sizes.filter((s) => setQty(c, p, s) <= LOW_STOCK_AT);
  const total = sized
    ? sizes.reduce((n, s) => n + setQty(c, p, s), 0)
    : setQty(c, p, null);

  return {
    live: avs.some((a) => a.live),
    isSet: true,
    soldOut,
    sizes: soldOut ? [] : sizes,
    low: soldOut ? [] : low,
    total
  };
}

/* ---------- Доступність товару ----------
   Якщо завантажено складські залишки — статус, розміри та
   «закінчується» рахуються з них. Інакше — зі статичних полів. */

export function availability(c: Catalogue, p: Product): Availability {
  if (isSet(p)) return setAvailability(c, p);

  const s = c.stock?.[p.id];

  if (s) {
    if (p.volume || !(p.sizes && p.sizes.length)) {
      const qty = Number(s.qty) || 0;
      return { live: true, soldOut: qty <= 0, sizes: [], low: [], total: qty };
    }
    const sz = s.sizes ?? {};
    const avail = Object.keys(sz).filter((k) => Number(sz[k]) > 0);
    const low = avail.filter((k) => Number(sz[k]) <= LOW_STOCK_AT);
    const total = Object.keys(sz).reduce((sum, k) => sum + (Number(sz[k]) || 0), 0);
    return { live: true, soldOut: total <= 0, sizes: avail, low, total };
  }

  return {
    live: false,
    soldOut: p.status === 'sold-out',
    sizes: p.sizes ?? [],
    low: p.lowStock ?? [],
    total: 0
  };
}

/* ---------- Кольори ----------
   Старий формат — просто масив відтінків, новий — обʼєкти
   {hex, id}, де id вказує на картку того самого товару в іншому
   кольорі. Читаємо обидва.

   Прив'язку до схованого товару відкидаємо: зразок вів би на
   картку, якої в каталозі немає, а сам відтінок означав би колір,
   який не купити. */
export function productColors(c: Catalogue, p: Product | null): Color[] {
  return ((p?.colors ?? []) as (string | { hex?: string; id?: string })[])
    .map((x) => (typeof x === 'string' ? { hex: x, id: '' } : { hex: x.hex ?? '', id: x.id ?? '' }))
    .filter((x) => {
      if (!x.hex) return false;
      if (!x.id) return true;
      const linked = getProduct(c, x.id);
      return !!linked && !linked.hidden;
    });
}

/* ---------- Гроші ---------- */

/* Форматувальник один на весь модуль. toLocaleString будує його
   наново на кожен виклик, а цін на сторінці каталогу — сотні:
   разом це третина мілісекунди процесора з десяти дозволених. */
const HRYVNIA = new Intl.NumberFormat('uk-UA');

export function fmt(n: number): string {
  return HRYVNIA.format(Number(n) || 0);
}

export function uah(n: number, lang: 'uk' | 'en' = 'uk'): string {
  return lang === 'en' ? `UAH ${fmt(n)}` : `${fmt(n)} грн`;
}

/* ---------- Налаштування магазину ----------
   Ті самі числа, що в data.js старого сайту. Живуть у коді, а не
   в базі: вони змінюються раз на рік, а зайвий запит на кожній
   сторінці коштував би дорожче. */

/** Від якої суми доставка по Україні безкоштовна, грн. */
export const FREE_DELIVERY_FROM = 1500;
