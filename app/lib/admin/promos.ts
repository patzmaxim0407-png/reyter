/* ============================================================
   REYTER — промокоди в адмінці
   ------------------------------------------------------------
   Портовано з js/admin.js (другий IIFE) один в один: список кодів,
   редактор і перевірки перед записом у колекцію promos.

   Сам рушій знижки тут не повторюється — його дає promo.ts, той
   самий, що рахує кошик покупця. Звідси лише те, що є тільки
   в адмінці: ярлик стану з фактичними замовленнями, підписи умов
   для картки, попередній перегляд на живому каталозі й правила,
   за якими код взагалі можна зберегти.

   Розмітки немає зовсім: старий модуль сам малював картки, сам
   збирав поля форми через document.getElementById і сам показував
   тости. Сюди переїхали лише рішення й тексти, які він показував.

   Стан модуль не тримає: список кодів, замовлення, каталог,
   поточний час і пошта адміна приходять аргументами (у старому
   коді це були promosCache, ordersCache, products(), todayISO()
   і R.fb.user). Кожна дія розділена надвоє — чистий план і тонкий
   запис; помилки запису не глушаться, бо адмінці треба відрізнити
   «немає прав» від «збережено».
   ============================================================ */

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore
} from 'firebase/firestore';

import { fmt } from '../catalog';
// параметр db у функціях запису зайнятий самим зʼєднанням
import { db as firestore } from '../firebase';
import { EMAIL_RE } from '../order';
import { promoCheck, promoNormalize } from '../promo';
import type { Promo, PromoItem, PromoResult, PromoScope, PromoType } from '../promo';
import type { Category, Product } from '../types';

/** Код — це id документа, тож окремого поля під нього в базі
 *  немає: воно дописується під час читання. */
export const PROMO_COL = 'promos';

/** Замовлення очима лічильника використань. Ширше про замовлення
 *  цей модуль знати не мусить, а панель замовлень ще не портована. */
export interface PromoOrder {
  promoCode?: string;
  status?: string;
}

/* ============================================================
   СПИСОК КОДІВ
   ============================================================ */

/** Порядок карток — за кодом. Сортуємо копію: масив належить
 *  викликачу. */
export function sortPromos(list: Promo[]): Promo[] {
  return list.slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

/** Підписка на колекцію promos. Повертає функцію відписки.
 *
 *  Підпискою, а не разовим запитом, — з тієї самої причини, що
 *  й чернетка каталогу: магазин ведуть удвох, і код, створений
 *  з телефона, має зʼявитись на ноутбуці сам. */
export function watchPromos(
  onChange: (list: Promo[]) => void,
  onError?: (e: unknown) => void
): () => void {
  const d = firestore();
  if (!d) {
    onChange([]);
    return () => {};
  }

  return onSnapshot(
    collection(d, PROMO_COL),
    (snap) => {
      onChange(sortPromos(snap.docs.map((x) => ({ code: x.id, ...x.data() }) as Promo)));
    },
    (e) => onError?.(e)
  );
}

/** Що показати замість списку, коли підписка впала. Права —
 *  найчастіша причина, і вона потребує іншої дії, ніж решта:
 *  не «оновіть правила», а «зайдіть іншим акаунтом». */
export function promosErrorText(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  return (
    'Не вдалося завантажити промокоди' +
    (code === 'permission-denied'
      ? ': немає прав.'
      : '. Перевірте, що правила Firestore оновлено (файл firebase/firestore.rules).')
  );
}

/* ============================================================
   СТАН КОДУ
   ============================================================ */

/* Скільки разів код використано. Два джерела мають збігатись:
   лічильник у самому промокоді (за ним працює перевірка
   в кошику) і фактичні замовлення. Беремо більше з двох —
   інакше адмінка показувала б «вичерпано» там, де кошик
   ще пускає, і навпаки. */
export function promoUsed(code: string, promos: Promo[], orders: PromoOrder[]): number {
  const p = promos.find((x) => x.code === code) ?? {};
  const byOrders = orders.filter((o) => o.promoCode === code && o.status !== 'cancelled').length;
  return Math.max(Number(p.usedCount) || 0, byOrders);
}

/** Клас бейджа на картці: 'is-soon' відрізняється від 'is-off'
 *  навмисно — код, який ще не почався, вимикати не треба. */
export type PromoStateClass = 'is-on' | 'is-off' | 'is-soon';

export interface PromoStateInfo {
  cls: PromoStateClass;
  label: string;
}

/* Дата за годинником адміна, а не за UTC. */
function todayISO(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate());
}

/** Ярлик стану для картки списку.
 *
 *  Порядок перевірок той самий, що в promoLive, але викликати її
 *  тут не можна: вона рахує день через toISOString(), тобто за
 *  UTC, і ввечері за Києвом код «завершився» б на добу пізніше,
 *  ніж показувала стара адмінка. Друга розбіжність — ліміт: тут
 *  він звіряється з promoUsed (лічильник АБО замовлення), а не
 *  з самим лише usedCount. */
export function promoState(
  p: Promo,
  promos: Promo[],
  orders: PromoOrder[],
  now: Date = new Date()
): PromoStateInfo {
  const today = todayISO(now);
  if (p.active === false) return { cls: 'is-off', label: 'Вимкнено' };
  if (p.startsAt && today < p.startsAt) return { cls: 'is-soon', label: 'Ще не почався' };
  if (p.endsAt && today > p.endsAt) return { cls: 'is-off', label: 'Завершився' };
  const limit = Number(p.usageLimit) || 0;
  if (limit > 0 && promoUsed(p.code ?? '', promos, orders) >= limit) {
    return { cls: 'is-off', label: 'Вичерпано' };
  }
  return { cls: 'is-on', label: 'Діє' };
}

/* ============================================================
   ПІДПИСИ ДЛЯ КАРТКИ
   ============================================================ */

/** На що поширюється код, одним рядком.
 *
 *  Не catTitle і не getProduct із catalog.ts: там зникла категорія
 *  дає порожній рядок, а адмін має побачити її id — інакше в умовах
 *  світилася б дірка замість причини, чому код ні на що не діє. */
export function promoScopeText(p: Promo, categories: Category[], products: Product[]): string {
  if (p.scope === 'categories') {
    const names = (p.categories || []).map((c) => {
      const cat = categories.find((x) => x.id === c);
      return cat ? cat.title : c;
    });
    return 'Категорії: ' + (names.join(', ') || '—');
  }
  if (p.scope === 'products') {
    const names = (p.products || []).map((id) => {
      const prod = products.find((x) => x.id === id);
      return prod ? prod.name : id;
    });
    return 'Товари: ' + (names.join(', ') || '—');
  }
  return 'Весь кошик';
}

/** «300 грн» або «10%».
 *
 *  Number(...) || 0 стоїть в обох гілках: fmt із catalog.ts, на
 *  відміну від адмінського, порожнє значення не прикриває, і код
 *  без суми показував би «NaN грн». */
export function promoValueText(p: Promo): string {
  return p.type === 'fixed'
    ? fmt(Number(p.value) || 0) + ' грн'
    : (Number(p.value) || 0) + '%';
}

/* ============================================================
   РЕДАКТОР
   ============================================================ */

/** Поля редактора так, як їх тримає форма: числа й дати —
 *  рядками, бо саме рядок лежить в input, і порожнє поле має
 *  давати 0, а не NaN. */
export interface PromoForm {
  code: string;
  type: PromoType;
  value: string;
  scope: PromoScope;
  /** Відмічені категорії; порядок задає сам список категорій. */
  categories: string[];
  /** Відмічені товари в порядку вибору — як робив pcPicked.
   *  Це окремий від пошуку набір: фільтр списку його не скидає. */
  products: string[];
  excludeSale: boolean;
  minTotal: string;
  startsAt: string;
  endsAt: string;
  email: string;
  usageLimit: string;
  active: boolean;
  note: string;
}

/** Порожній редактор і редактор наявного коду — те, що робив
 *  openPromoEditor зі значеннями полів. Сам код при редагуванні
 *  не міняється: це id документа. */
export function promoForm(p: Promo | null): PromoForm {
  const v = p ?? {};
  return {
    code: v.code || '',
    type: v.type || 'percent',
    value: v.value != null ? String(v.value) : '',
    scope: v.scope || 'all',
    categories: (v.categories || []).slice(),
    products: (v.products || []).slice(),
    excludeSale: !!v.excludeSale,
    minTotal: v.minTotal ? String(v.minTotal) : '',
    startsAt: v.startsAt || '',
    endsAt: v.endsAt || '',
    email: v.email || '',
    usageLimit: v.usageLimit ? String(v.usageLimit) : '',
    // код без поля active вважається увімкненим
    active: v.active !== false,
    note: v.note || ''
  };
}

/** Відмічені категорії в порядку самого списку категорій.
 *  Зниклі категорії відпадають: у старій адмінці їх просто не було
 *  серед галочок, і зберегти код із посиланням на видалену
 *  категорію було неможливо. */
export function pcSelectedCats(categories: Category[], picked: string[]): string[] {
  const set = new Set(picked);
  return categories.filter((c) => set.has(c.id)).map((c) => c.id);
}

/** Які набори галочок показувати під вибором дії коду.
 *  Перерахунок прикладу викликач робить сам — у старій адмінці
 *  pcSyncScope смикав pcPreview, бо обидва сиділи на тому ж DOM. */
export function pcSyncScope(scope: PromoScope): { cats: boolean; prods: boolean } {
  return { cats: scope === 'categories', prods: scope === 'products' };
}

/** Промокод, зібраний із полів редактора. */
export function pcCollect(form: PromoForm, categories: Category[]): Promo {
  const scope = form.scope;
  return {
    code: promoNormalize(form.code),
    type: form.type,
    value: Number(form.value) || 0,
    scope: scope,
    categories: scope === 'categories' ? pcSelectedCats(categories, form.categories) : [],
    products: scope === 'products' ? form.products.slice() : [],
    excludeSale: form.excludeSale,
    minTotal: Number(form.minTotal) || 0,
    startsAt: form.startsAt || '',
    endsAt: form.endsAt || '',
    email: form.email.trim().toLowerCase(),
    usageLimit: Number(form.usageLimit) || 0,
    active: form.active,
    note: form.note.trim()
  };
}

/* ---------- Живий приклад ---------- */

/** Скільки зекономить клієнт на типовому кошику. */
export interface PromoPreview {
  /** Артикули товарів-прикладів, у тому ж порядку. */
  items: string[];
  /** Сума прикладу, грн. */
  sum: number;
  ok: boolean;
  /** Знижка, грн; 0 — код не спрацював. */
  discount: number;
  /** До сплати, грн. */
  total: number;
  /** Причина відмови — текст для неї дає promoMessage: словник
   *  і мова живуть у того, хто малює. */
  result: PromoResult;
}

/**
 * Приклад рахується на живому каталозі-чернетці, тому числа
 * міняються разом із ним — саме цього й хотіли: адмін бачить, що
 * буде насправді, а не на вигаданих товарах.
 *
 * null — знижку ще не ввели: показувати приклад нема з чого.
 *
 * @param now       момент перевірки — інакше приклад не відтворити
 * @param userEmail пошта адміна. Персональний код у прикладі
 *        спрацює лише в акаунті власника — так само було й
 *        у старій адмінці, де promoCheck сам зазирав у R.fb.user.
 */
export function pcPreview(
  promo: Promo,
  products: Product[],
  now: Date = new Date(),
  userEmail: string = ''
): PromoPreview | null {
  if (!promo.value) return null;

  // беремо перші три видимі товари як приклад кошика
  const sample: PromoItem[] = products
    .filter((x) => !x.hidden)
    .slice(0, 3)
    .map((x) => ({ id: x.id, category: x.category, price: x.price, qty: 1, sale: !!x.sale }));

  /* usedCount обнуляємо: приклад показує, як код спрацює, а не
     чи лишились використання. */
  const res = promoCheck({ ...promo, usedCount: 0 }, sample, now, userEmail);
  const sum = sample.reduce((s, i) => s + i.price, 0);
  const discount = res.ok ? res.discount ?? 0 : 0;

  return {
    items: sample.map((i) => i.id),
    sum: sum,
    ok: res.ok,
    discount: discount,
    total: sum - discount,
    result: res
  };
}

/* ============================================================
   ЗБЕРЕЖЕННЯ
   ============================================================ */

/** Тіло документа promos/{КОД}. */
export type PromoDoc = Omit<Promo, 'code'> & {
  /** Пошта того, хто створив код. Дописується лише новому. */
  createdBy?: string;
};

export interface PromoSaveInput {
  /** Що зібрала форма — результат pcCollect. */
  promo: Promo;
  /** Усі коди з бази: за ними ловимо збіг. */
  promos: Promo[];
  /** Код картки, яку відкрили; null — новий промокод. */
  editingCode: string | null;
  /** Пошта адміна — лягає в createdBy нового коду. */
  userEmail?: string | null;
}

export interface PromoSavePlan {
  /** Id документа: сам код. */
  code: string;
  data: PromoDoc;
  /** true — код створюється вперше. */
  isNew: boolean;
}

export type PromoSaveResult = { ok: true; plan: PromoSavePlan } | { ok: false; message: string };

/** Текст, який стара адмінка показувала, коли запис не пройшов. */
export const SAVE_FAILED =
  'Не вдалося зберегти. Перевірте правила Firestore для колекції promos';

/** Що саме має лягти в базу і чи можна це робити.
 *  Порядок перевірок — той самий, що в адмінці: людина бачить
 *  першу незаповнену річ, а не останню. */
export function planPromoSave(input: PromoSaveInput): PromoSaveResult {
  const p = input.promo;
  const err = (message: string): PromoSaveResult => ({ ok: false, message });

  /* Код потрапляє в адресу листа й у правила бази, тож набір
     символів вузький навмисно. */
  if (!/^[A-Z0-9_-]{3,24}$/.test(p.code ?? '')) {
    return err('Код: 3–24 символи, лише латиниця, цифри, дефіс або підкреслення');
  }
  if (!p.value || p.value <= 0) return err('Вкажіть розмір знижки');
  if (p.type === 'percent' && p.value > 100) return err('Відсоток не може бути більшим за 100');
  if (p.scope === 'categories' && !(p.categories || []).length) {
    return err('Оберіть хоча б одну категорію');
  }
  if (p.scope === 'products' && !(p.products || []).length) {
    return err('Оберіть хоча б один товар');
  }
  if (p.startsAt && p.endsAt && p.startsAt > p.endsAt) {
    return err('Дата початку пізніша за дату завершення');
  }
  if (p.email && !EMAIL_RE.test(p.email)) return err('Некоректна пошта клієнта');

  /* Код — це id документа: збіг не «дублікат у списку», а
     мовчазний перезапис чужої знижки. */
  if (!input.editingCode && input.promos.some((x) => x.code === p.code)) {
    return err('Промокод ' + p.code + ' вже існує');
  }

  const data: Promo = { ...p };
  delete data.code;

  const isNew = !input.editingCode;
  if (isNew) {
    data.usedCount = 0;
  }

  return {
    ok: true,
    plan: {
      code: p.code ?? '',
      data: isNew ? { ...data, createdBy: input.userEmail || '' } : data,
      isNew: isNew
    }
  };
}

/** Запис плану. merge, а не перезапис: у документі можуть лежати
 *  поля, яких редактор не знає, — зокрема usedCount, який росте
 *  сам із браузера покупця, і created від першого збереження.
 *
 *  Час створення ставить сервер: годинник адміна може відставати,
 *  а на цей час спираються звіти. */
export async function savePromo(db: Firestore, plan: PromoSavePlan): Promise<void> {
  const data: Record<string, unknown> = { ...plan.data };
  if (plan.isNew) data.created = serverTimestamp();
  await setDoc(doc(db, PROMO_COL, plan.code), data, { merge: true });
}

/** Перемикач у картці. Нове значення рахується від наявного:
 *  код без поля active вважається увімкненим, тож перший дотик
 *  має його вимкнути. */
export async function togglePromo(db: Firestore, p: Promo): Promise<void> {
  await updateDoc(doc(db, PROMO_COL, p.code ?? ''), { active: p.active === false });
}

/** Видалення без сліду: історію використань тримають замовлення,
 *  і вона нікуди не дінеться. */
export async function deletePromo(db: Firestore, code: string): Promise<void> {
  await deleteDoc(doc(db, PROMO_COL, code));
}
