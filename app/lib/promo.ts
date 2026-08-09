/* ============================================================
   REYTER — промокоди
   ------------------------------------------------------------
   Пошук, перевірка умов і розрахунок знижки. Один і той самий
   рушій використовують кошик (клієнт) і адмінка (попередній
   перегляд правил).

   Портовано з js/promo.js один в один — поведінка має збігатися,
   поки старий сайт іще працює поруч.

   Чого тут навмисно НЕМАЄ: promoFetch, promoMine і promoConsume.
   Вони ходять у Firestore і живуть окремо, разом із Firebase SDK,
   бо цей модуль має лишатися чистим і працювати й на сервері.

   Замість глобалів (window.REYTER) усе, що залежить від мови,
   каталогу чи сховища, передається параметром.
   ============================================================ */

import type { Lang } from './types';
import { uah } from './catalog';

const KEY = 'reyter:promo';

/* ---------- Документ промокоду ----------
   Лежить у Firestore як promos/{КОД}: id документа і є самим
   кодом, тож окремого поля під нього в базі немає — воно
   дописується під час читання.

   Майже все необовʼязкове: коди створювались роками, і старі
   документи не мають нових полів. */

export type PromoType = 'percent' | 'fixed';
export type PromoScope = 'all' | 'categories' | 'products';

export interface Promo {
  /** Сам код (id документа), дописаний під час читання. */
  code?: string;
  /** Відсоток або сума в грн. */
  type?: PromoType;
  /** Число знижки. */
  value?: number;
  scope?: PromoScope;
  /** Масив id категорій (для scope = 'categories'). */
  categories?: string[];
  /** Масив артикулів (для scope = 'products'). */
  products?: string[];
  /** true → не діє на товари, що вже зі знижкою. */
  excludeSale?: boolean;
  /** Мінімальна сума кошика, грн. */
  minTotal?: number;
  /** 'РРРР-ММ-ДД' — діє з (включно). */
  startsAt?: string;
  /** 'РРРР-ММ-ДД' — діє до (включно). */
  endsAt?: string;
  /** Скільки разів можна використати всього (0 — без ліміту). */
  usageLimit?: number;
  /** Скільки разів уже використано. */
  usedCount?: number;
  /** Вимикач без видалення. */
  active?: boolean;
  /** Службовий коментар для адміна. */
  note?: string;

  /** Пошта власника персонального коду. У шапці оригіналу цього
   *  поля немає, але рушій на нього спирається: код з email
   *  працює лише в акаунті тієї самої пошти. */
  email?: string;
}

/* ---------- Позиція кошика для перевірки ----------
   Свій вузький тип, а не CartLine чи OrderItem: рушію потрібні
   лише ціна, кількість, категорії та ознака SALE, і нічого з
   цього набору в кошику немає в готовому вигляді. */

export interface PromoItem {
  id: string;
  category?: string;
  categories?: string[];
  price: number;
  qty: number;
  sale?: boolean;
}

/* ---------- Результат перевірки ---------- */

export type PromoReason =
  | 'ok'
  | 'not_found'
  | 'inactive'
  | 'not_yours'
  | 'not_started'
  | 'expired'
  | 'exhausted'
  | 'min_total'
  | 'no_items';

export interface PromoResult {
  ok: boolean;
  reason: PromoReason;
  /** Далі — поля, які додаються лише під конкретну причину:
   *  саме їх підставляє promoMessage у текст для покупця. */
  discount?: number;
  eligibleTotal?: number;
  eligibleCount?: number;
  /** true — знижка діє не на весь кошик. */
  partial?: boolean;
  /** not_yours: чия це пошта. */
  email?: string;
  /** not_started / expired: 'РРРР-ММ-ДД'. */
  date?: string;
  /** min_total: скільки ще треба докласти і з якої суми діє код. */
  need?: number;
  minTotal?: number;
  /** no_items: чому саме не підійшло. */
  scope?: PromoScope;
}

/* ---------- Переклади ----------
   Модуль не знає ні про i18n, ні про поточну мову: t(key) і мову
   передає той, хто малює текст. Так рушій лишається придатним і
   для сервера, і для адмінки. */

export type Translate = (key: string) => string;

export interface PromoText {
  t: Translate;
  /** Мова для сум і дат. */
  lang?: Lang;
  /** Назва категорії за id. Порожній рядок означає «категорії
   *  такої вже немає»: promoTerms її мовчки пропускає, а
   *  promoMessage показує сам id, щоб не лишити порожнє місце. */
  categoryTitle?: (id: string) => string;
  /** Назва товару за артикулом; без резолвера показуємо артикул. */
  productName?: (id: string) => string;
  /** true — авторизація доступна, але покупець не увійшов.
   *  Тоді «не знайдено» може означати чужий персональний код. */
  guest?: boolean;
}

/* ---------- Дати ----------
   Дата без часової зони читається в поясі покупця — і це
   навмисно: «діє до 10-го» має закінчуватись опівночі на його
   годиннику, а не на сервері. */

function startOfDay(iso: string): Date | null {
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(iso: string): Date | null {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 1); // кінцевий день включно
  return d;
}

/* ---------- Нормалізація коду ---------- */

/** Приймає що завгодно: код приходить і з поля вводу, і зі
 *  сховища, де міг лежати старий обʼєкт. */
export function promoNormalize(code: unknown): string {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/* ---------- Позиції, на які поширюється промокод ---------- */

/* Товар може стояти в кількох категоріях — досить збігу з однією.
   Не productCats() з catalog.ts: там інший тип і відкидаються
   порожні значення, а тут список іде як є. */
function itemCats(it: PromoItem): string[] {
  const list = Array.isArray(it.categories) ? it.categories.slice() : [];
  if (it.category && !list.includes(it.category)) list.unshift(it.category);
  return list;
}

function eligible(promo: Promo, items: PromoItem[]): PromoItem[] {
  return items.filter((it) => {
    if (promo.excludeSale && it.sale) return false;
    if (promo.scope === 'categories') {
      const want = promo.categories || [];
      return itemCats(it).some((c) => want.includes(c));
    }
    if (promo.scope === 'products') {
      return (promo.products || []).includes(it.id);
    }
    return true;
  });
}

/* Number(...) || 0 лишається навіть при числових типах: у кошик
   ціна й кількість потрапляють з бази, і NaN там цілком можливий. */
function sumOf(items: PromoItem[]): number {
  return items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
}

/* ---------- Перевірка ---------- */

/**
 * @param promo   документ промокоду; null/undefined → 'not_found'
 * @param now     момент перевірки (за замовчуванням — зараз)
 * @param userEmail пошта поточного акаунта — замість R.fb.user.email.
 *        Гість дає порожній рядок, який не збігається з жодною
 *        поштою, тож персональний код йому не спрацює.
 */
export function promoCheck(
  promo: Promo | null | undefined,
  items: PromoItem[],
  now?: Date | null,
  userEmail?: string | null
): PromoResult {
  const subtotal = sumOf(items);
  const time = now || new Date();

  if (!promo) return { ok: false, reason: 'not_found' };
  if (promo.active === false) return { ok: false, reason: 'inactive' };

  // Персональний код працює лише в акаунті тієї самої пошти
  if (promo.email) {
    const me = (userEmail || '').toLowerCase();
    if (me !== String(promo.email).toLowerCase()) {
      return { ok: false, reason: 'not_yours', email: promo.email };
    }
  }

  if (promo.startsAt) {
    const from = startOfDay(promo.startsAt);
    if (from && time < from) {
      return { ok: false, reason: 'not_started', date: promo.startsAt };
    }
  }

  if (promo.endsAt) {
    const to = endOfDay(promo.endsAt);
    if (to && time >= to) {
      return { ok: false, reason: 'expired', date: promo.endsAt };
    }
  }

  const limit = Number(promo.usageLimit) || 0;
  if (limit > 0 && (Number(promo.usedCount) || 0) >= limit) {
    return { ok: false, reason: 'exhausted' };
  }

  const min = Number(promo.minTotal) || 0;
  if (min > 0 && subtotal < min) {
    return { ok: false, reason: 'min_total', need: min - subtotal, minTotal: min };
  }

  const items2 = eligible(promo, items);
  const eligibleTotal = sumOf(items2);

  if (!items2.length || eligibleTotal <= 0) {
    return { ok: false, reason: 'no_items', scope: promo.scope };
  }

  /* Усе, що не 'fixed' — відсоток, зокрема й порожній type:
     так у базі лежать найперші коди, створені до появи поля. */
  let discount = promo.type === 'fixed'
    ? Math.min(Number(promo.value) || 0, eligibleTotal)
    : Math.round(eligibleTotal * (Number(promo.value) || 0) / 100);

  // Знижка ніколи не більша за весь кошик, навіть якщо fixed-код
  // виписали з запасом
  discount = Math.max(0, Math.min(Math.round(discount), subtotal));

  if (discount <= 0) return { ok: false, reason: 'no_items', scope: promo.scope };

  return {
    ok: true,
    reason: 'ok',
    discount: discount,
    eligibleTotal: eligibleTotal,
    eligibleCount: items2.length,
    partial: items2.length < items.length
  };
}

/* ---------- Короткий опис умов — для кабінету й адмінки ---------- */

export function promoTerms(p: Promo, deps: PromoText): string {
  const { t, lang = 'uk', categoryTitle } = deps;
  const money = (n: number) => uah(n, lang);
  const parts: string[] = [];

  if (p.scope === 'categories') {
    const names = (p.categories || [])
      .map((c) => (categoryTitle ? categoryTitle(c) : c))
      .filter(Boolean);
    if (names.length) parts.push(t('promo.onCats').replace('{cats}', names.join(', ')));
  } else if (p.scope === 'products') {
    parts.push(t('promo.onProducts').replace('{n}', String((p.products || []).length)));
  } else {
    parts.push(t('promo.onAll'));
  }

  if (Number(p.minTotal)) parts.push(t('promo.fromSum').replace('{sum}', money(Number(p.minTotal))));
  if (p.excludeSale) parts.push(t('promo.noSale'));
  if (p.endsAt) parts.push(t('promo.till').replace('{date}', promoDate(p.endsAt, lang)));

  return parts.join(' · ');
}

/* ---------- Чи діє промокод зараз (без прив'язки до кошика) ---------- */

/* Порівнюємо рядки 'РРРР-ММ-ДД', а не дати: тут потрібен лише
   ярлик стану, і плутати його з розрахунком знижки не варто.
   Побічний ефект: toISOString() дає UTC, тож увечері за Києвом
   ярлик перемикається на добу пізніше, ніж promoCheck. */
export function promoLive(
  p: Promo,
  t: Translate,
  now: Date = new Date()
): { ok: boolean; label: string } {
  const today = now.toISOString().slice(0, 10);
  if (p.active === false) return { ok: false, label: t('promo.stOff') };
  if (p.startsAt && today < p.startsAt) return { ok: false, label: t('promo.stSoon') };
  if (p.endsAt && today > p.endsAt) return { ok: false, label: t('promo.stExpired') };
  const limit = Number(p.usageLimit) || 0;
  if (limit > 0 && (Number(p.usedCount) || 0) >= limit) {
    return { ok: false, label: t('promo.stUsed') };
  }
  return { ok: true, label: t('promo.stLive') };
}

/* ---------- Збереження застосованого коду ---------- */

/** Рівно те, що рушію треба від localStorage. Модуль має
 *  запускатись і на сервері, тому сховище приходить ззовні. */
export interface PromoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage браузера або null на сервері. Звернення до самої
 *  властивості теж може кинути виняток — у приватному режимі. */
export function browserStorage(): PromoStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/* Зберігаємо ЛИШЕ код: умови завжди перечитуються з бази,
   інакше підроблений обʼєкт у сховищі давав би будь-яку знижку,
   а вимкнений адміном код продовжував би діяти. */
export function promoSavedCode(store: PromoStorage | null = browserStorage()): string {
  if (!store) return '';
  try {
    const raw = store.getItem(KEY);
    if (!raw) return '';
    // сумісність зі старим форматом, де лежав цілий обʼєкт
    const val: unknown = raw.charAt(0) === '{'
      ? ((JSON.parse(raw) as { code?: unknown } | null) || {}).code
      : raw;
    return promoNormalize(val);
  } catch {
    return '';
  }
}

export function promoSaveCode(
  code: string | null | undefined,
  store: PromoStorage | null = browserStorage()
): void {
  if (!store) return;
  try {
    if (code) store.setItem(KEY, promoNormalize(code));
    else store.removeItem(KEY);
  } catch { /* приватний режим */ }
}

/* ---------- Текст для покупця ---------- */

export function promoMessage(res: PromoResult, promo: Promo | null | undefined, deps: PromoText): string {
  const { t, lang = 'uk', categoryTitle, productName, guest = false } = deps;
  const money = (n: number) => uah(n, lang);
  // Порожню назву замінюємо артикулом/id: краще незрозумілий
  // код, ніж дірка в реченні
  const catName = (id: string) => (categoryTitle ? categoryTitle(id) || id : id);
  const prodName = (id: string) => (productName ? productName(id) || id : id);

  switch (res.reason) {
    case 'ok': {
      let msg = t('promo.ok').replace('{sum}', money(res.discount ?? 0));
      if (res.partial) msg += ' ' + t('promo.partial');
      return msg;
    }
    case 'not_found':
      // Персональні коди недоступні для читання чужим акаунтам,
      // тому «не знайдено» може означати саме це
      return guest ? t('promo.notFoundGuest') : t('promo.notFound');
    case 'not_yours':  return t('promo.notYours').replace('{email}', res.email || '');
    case 'inactive':   return t('promo.inactive');
    case 'not_started':
      return t('promo.notStarted').replace('{date}', promoDate(res.date ?? '', lang));
    case 'expired':
      return t('promo.expired').replace('{date}', promoDate(res.date ?? '', lang));
    case 'exhausted':  return t('promo.exhausted');
    case 'min_total':
      return t('promo.minTotal')
        .replace('{min}', money(res.minTotal ?? 0))
        .replace('{need}', money(res.need ?? 0));
    case 'no_items': {
      if (promo && promo.scope === 'categories') {
        const names = (promo.categories || []).map(catName).filter(Boolean).join(', ');
        return t('promo.noItemsCats').replace('{cats}', names);
      }
      if (promo && promo.scope === 'products') {
        const names = (promo.products || []).map(prodName).join(', ');
        return t('promo.noItemsProducts').replace('{products}', names);
      }
      if (promo && promo.excludeSale) return t('promo.noItemsSale');
      return t('promo.noItems');
    }
    default: return t('promo.notFound');
  }
}

export function promoDate(iso: string, lang: Lang = 'uk'): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'uk-UA', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}
