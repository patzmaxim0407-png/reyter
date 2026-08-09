/* ============================================================
   REYTER — чернетка каталогу
   ------------------------------------------------------------
   Портовано з js/admin.js (перший модуль) один в один: правила,
   за якими адмінка міняє чернетку — колекції catalog_categories
   і catalog_products.

   Чернетку сайт не читає: покупець бачить знімок published/catalog,
   тож помилка тут не потрапляє на вітрину тієї ж миті. Але дані
   вона псує назавжди — саме тому всі перевірки перед записом
   збережені повністю й у тому самому порядку.

   Розмітки тут немає зовсім: старий модуль сам збирав товар із
   полів форми, сам малював список і сам показував тости. Сюди
   переїхали лише рішення — що вважати дублікатом, що саме лягає
   в документ, які ще картки треба поправити разом із цією.

   Стан модуль не тримає: список товарів, категорій і саме
   зʼєднання з Firestore приходять аргументами (у старому коді це
   були state і R.fb.db). Кожна операція розділена надвоє —
   чистий план і тонкий запис; помилки запису не глушаться, бо
   адмінці треба відрізнити «немає прав» від «збережено».
   ============================================================ */

import {
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore
} from 'firebase/firestore';

import { inCategory, isSet, productCats } from '../catalog';
import type { Category, Color, ColorRaw, Product } from '../types';
import { CAT_COL, PROD_COL } from './store';

/* Категорії товару й ознака комплекту рахуються тут точно так
   само, як на сайті, — це та сама пара функцій, а не її копія.
   Розійтись їм не можна: за prodCats адмінка розкладає товари по
   списку, а сайт — по вітрині. */
export { inCategory as inCat, isSet as isSetProduct, productCats as prodCats } from '../catalog';

/* Назви колекцій живуть там, де чернетку читають (store.ts):
   писати й читати вони мусять один і той самий каталог. */
export { CAT_COL, PROD_COL } from './store';

/** Результат перевірки перед записом. field вказує на поле форми,
 *  біля якого має зʼявитись пояснення. */
export type CheckField = 'id' | 'name' | 'price' | 'category' | 'images' | 'set';

export interface CheckFail {
  ok: false;
  field: CheckField;
  message: string;
}

export type Check = { ok: true } | CheckFail;

function fail(field: CheckField, message: string): CheckFail {
  return { ok: false, field, message };
}

/* ============================================================
   ДРІБНИЦІ
   ============================================================ */

/** Документ товару в catalog_products. */
export type ProductDoc = Omit<Product, 'id'>;

/** Артикул — це id документа, а не поле в ньому. Другий примірник
 *  усередині розійшовся б із першим після перейменування.
 *
 *  Порожні поля не пишемо зовсім. У старій адмінці це робив
 *  collectForm («if (oldPrice) p.oldPrice = …»), тож undefined
 *  у товарі не бувало ніколи. Тут форма віддає обʼєкт цілком, і
 *  без цього фільтра Firestore відхилив би весь запис: undefined
 *  він не приймає, і товар без старої ціни просто не зберігся б. */
export function prodDocData(p: Product): ProductDoc {
  const data: ProductDoc & { id?: string } = { ...p };
  delete data.id;
  (Object.keys(data) as (keyof typeof data)[]).forEach((k) => {
    if (data[k] === undefined) delete data[k];
  });
  return data;
}

/** Новий елемент стає в кінець: порядок задають кроком 10, щоб
 *  між сусідів можна було вставити ще один, не перенумеровуючи
 *  весь список. */
export function maxOrder(list: { order?: number }[]): number {
  return list.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0);
}

/* id категорії потрапляє в адресу сторінки і в поле category
   кожного товару, тож із назви лишається сама латиниця. Таблиця
   ручна, бо це українська транслітерація, а не транскрипція:
   «щ» має стати shch, а «ь» — зникнути зовсім. */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh',
  з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia'
};

export function slugify(name: string, categories: Category[]): string {
  let slug = String(name)
    .toLowerCase()
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) slug = 'cat';

  /* Назва з самих емодзі чи ієрогліфів дає порожній slug, а дві
     різні назви — однаковий. Зайнятий id мовчки перезаписав би
     чужу категорію, тож дописуємо номер. */
  let unique = slug;
  let n = 2;
  while (categories.some((c) => c.id === unique)) unique = slug + '-' + n++;
  return unique;
}

/** Багаторядкові поля редактора (склад, догляд, характеристики)
 *  набирають у textarea, де зайві пробіли й порожні рядки
 *  неминучі, — а в каталог має піти чистий список пунктів. */
export function lines(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ============================================================
   КАТЕГОРІЇ
   ============================================================ */

/** Скільки товарів числиться в категорії — разом із тими, для
 *  кого вона додаткова. */
export function countIn(products: Product[], catId: string): number {
  return products.filter((p) => inCategory(p, catId)).length;
}

export function newCategory(categories: Category[], name: string): Category {
  return { id: slugify(name, categories), title: name, order: maxOrder(categories) + 10 };
}

/** Створює категорію в чернетці й повертає її — викликач додає
 *  результат до свого списку. У документ ідуть лише title і
 *  order: англійська назва в адмінці не заповнюється. */
export async function addCategory(
  db: Firestore,
  categories: Category[],
  name: string
): Promise<Category> {
  const cat = newCategory(categories, name);
  await setDoc(doc(db, CAT_COL, cat.id), { title: cat.title, order: cat.order });
  return cat;
}

export async function renameCategory(db: Firestore, id: string, name: string): Promise<void> {
  await updateDoc(doc(db, CAT_COL, id), { title: name });
}

/** Видаляти можна лише порожню категорію. Товарів видалення не
 *  чіпає зовсім — і саме тому воно заборонене: у картках лишилось
 *  би посилання в нікуди, товар випав би з усіх списків і
 *  знайшовся б хіба що серед «Без категорії». Спершу переносимо. */
export function checkCategoryDelete(products: Product[], catId: string): Check {
  if (countIn(products, catId)) {
    return fail('category', 'Спершу перенесіть або видаліть товари з цієї категорії');
  }
  return { ok: true };
}

/* Якщо видалили саме ту категорію, що була відкрита, вибір
   повертає на «Всі товари» вже викликач: у старому коді це робив
   сам deleteCategory, бо currentCat лежав у тому ж замиканні. */
export async function deleteCategory(db: Firestore, id: string): Promise<void> {
  await deleteDoc(doc(db, CAT_COL, id));
}

export interface CategoryOrder {
  id: string;
  order: number;
}

export type ReorderPlan =
  /** Перелік id розійшовся зі списком категорій — нічого не
   *  зберігаємо, викликач малює список заново як був. */
  | { ok: false }
  | { ok: true; changed: false }
  | { ok: true; changed: true; categories: Category[]; updates: CategoryOrder[] };

/** Новий порядок категорій за переліком id.
 *  У базу йдуть лише ті, у кого order справді змінився: решта
 *  документів не має зайвий раз оновлюватись. */
export function reorderCategories(categories: Category[], ids: string[]): ReorderPlan {
  // «Всі товари» — псевдопункт списку, категорії йому не існує
  const wanted = ids.filter((id) => id && id !== 'all');

  const byId: Record<string, Category> = {};
  categories.forEach((c) => {
    byId[c.id] = c;
  });
  const next = wanted.map((id) => byId[id]).filter(Boolean);

  if (next.length !== categories.length) return { ok: false };
  if (!next.some((c, i) => categories[i] !== c)) return { ok: true, changed: false };

  const updates: CategoryOrder[] = [];
  const ordered = next.map((c, i) => {
    const order = i * 10;
    if (c.order !== order) updates.push({ id: c.id, order });
    return { ...c, order };
  });

  return { ok: true, changed: true, categories: ordered, updates };
}

/** Зберігає новий порядок і повертає впорядкований список.
 *  null — перелік не збігся зі станом: порядок не зберігали. */
export async function persistCatOrder(
  db: Firestore,
  categories: Category[],
  ids: string[]
): Promise<Category[] | null> {
  const plan = reorderCategories(categories, ids);
  if (!plan.ok) return null;
  if (!plan.changed) return categories;

  const batch = writeBatch(db);
  plan.updates.forEach((u) => batch.update(doc(db, CAT_COL, u.id), { order: u.order }));
  await batch.commit();
  return plan.categories;
}

/* ============================================================
   КОЛЬОРИ
   ============================================================ */

/** Кольори картки у двох форматах одразу: старий — просто
 *  відтінок, новий — {hex, id} з привʼязкою до картки того самого
 *  товару в цьому кольорі.
 *
 *  На відміну від productColors на сайті, схована привʼязка тут
 *  ЛИШАЄТЬСЯ: адмін має бачити й правити те, що справді записано
 *  в базі, інакше збереження мовчки стерло б звʼязок. */
export function adminColors(p: { colors?: ColorRaw[] } | null | undefined): Color[] {
  return ((p && p.colors) || [])
    .map((c) =>
      typeof c === 'string' ? { hex: c, id: '' } : { hex: c.hex || '', id: c.id || '' }
    )
    .filter((c) => c.hex);
}

/** input[type=color] приймає лише #rrggbb — скорочену форму
 *  розгортаємо, решту відкидаємо: інакше поле мовчки покаже
 *  чорний замість того, що ввели. */
export function normalizeHex(v: string | null | undefined): string {
  const h = String(v || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(h)) return h.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(h)) {
    return ('#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]).toLowerCase();
  }
  return '';
}

/** Колір без привʼязки лягає в базу простим рядком — так документ
 *  не роздувається обʼєктами там, де вони нічого не додають. */
export function packColors(list: Color[]): ColorRaw[] {
  return list.map((c) => (c.id ? { hex: c.hex, id: c.id } : c.hex));
}

/* ---------- Взаємні привʼязки кольорів ----------
   Додали на «чорному» колір із привʼязкою до «білого» — «білий»
   сам отримує зворотну привʼязку до «чорного» (і до решти
   кольорів родини). Прибрали привʼязку — зворотна теж знімається.
   Кожен товар родини показує повний набір кольорів, налаштований
   лише на одній картці.

   Без цього перемикач кольорів працював би в один бік: з «чорного»
   на «білий» перейти можна, а назад — ні. */

/** Що треба дописати іншим карткам після збереження цієї:
 *  артикул → його новий список кольорів.
 *
 *  Жоден товар зі списку при цьому не змінюється: правки лягають
 *  на обʼєкти, які adminColors щоразу створює наново. */
export function syncColorLinks(
  products: Product[],
  p: Product,
  oldColors: Color[],
  oldId: string
): Record<string, Color[]> {
  const updates: Record<string, Color[]> = {};

  const colorsOf = (t: Product): Color[] => updates[t.id] || adminColors(t);

  /* Артикул перейменували — чужі привʼязки вказують на картку,
     якої вже не буде. Полагодити їх треба до того, як старий
     документ зникне. */
  if (oldId && oldId !== p.id) {
    products.forEach((t) => {
      if (t.id === p.id) return;
      const colors = colorsOf(t);
      if (colors.some((c) => c.id === oldId)) {
        updates[t.id] = colors.map((c) => (c.id === oldId ? { hex: c.hex, id: p.id } : c));
      }
    });
  }

  const mine = adminColors(p);
  const links = mine.filter((c) => c.id && c.id !== p.id);
  const own = mine.find((c) => !c.id || c.id === p.id) ?? mine[0];
  const ownHex = own?.hex || '#014aad';

  // родина: сам товар + усі, до кого він привʼязаний
  const family: Color[] = [{ id: p.id, hex: ownHex }].concat(
    links.map((c) => ({ id: c.id, hex: c.hex }))
  );

  family.slice(1).forEach((m) => {
    const target = products.find((x) => x.id === m.id);
    if (!target) return;
    let colors = colorsOf(target).slice();
    let touched = false;

    // власний колір цільового товару, якщо його ще немає
    if (!colors.some((c) => !c.id || c.id === target.id)) {
      colors = [{ hex: m.hex, id: '' }].concat(colors);
      touched = true;
    }

    family.forEach((o) => {
      if (o.id === target.id) return;
      const hit = colors.find((c) => c.id === o.id);
      if (hit) {
        if (hit.hex !== o.hex) {
          hit.hex = o.hex;
          touched = true;
        }
      } else {
        colors = colors.concat([{ hex: o.hex, id: o.id }]);
        touched = true;
      }
    });

    if (touched) updates[target.id] = colors;
  });

  // привʼязку зняли — знімаємо і зворотну
  (oldColors || [])
    .filter((c) => c.id && c.id !== p.id)
    .filter((c) => !links.some((l) => l.id === c.id))
    .forEach((c) => {
      const target = products.find((x) => x.id === c.id);
      if (!target) return;
      const colors = colorsOf(target).filter((x) => x.id !== p.id && x.id !== oldId);
      if (colors.length !== colorsOf(target).length) {
        updates[target.id] = colors;
      }
    });

  return updates;
}

/* ============================================================
   КОМПЛЕКТИ
   ------------------------------------------------------------
   Комплект — товар, зібраний з інших товарів каталогу. Власних
   розмірів і залишків він не має: покупець обирає розмір кожного
   складника, а кількість комплектів рахується за найдефіцитнішим
   із них.
   ============================================================ */

/** Комплекти, у які входить цей товар. Видалити його або самого
 *  зробити комплектом не можна, не поламавши їх. */
export function setsWith(products: Product[], pid: string): Product[] {
  return products.filter((x) => Array.isArray(x.set) && x.set.includes(pid));
}

/** Склад комплекту з рядків редактора. Порожні рядки — щойно
 *  додані й ще не заповнені; повтори зливаємо, бо той самий товар
 *  двічі в комплекті нічого не означає. */
export function pickedSet(ids: string[]): string[] {
  return ids.filter(Boolean).filter((id, n, list) => list.indexOf(id) === n);
}

/* ============================================================
   ЗБЕРЕЖЕННЯ ТОВАРУ
   ============================================================ */

export interface ProductSaveInput {
  /** Товар, зібраний із форми. order проставляє сам план. */
  product: Product;
  /** Каталог-чернетка на момент збереження. */
  products: Product[];
  /** Артикул картки, яку відкрили; null — новий товар. */
  editingId: string | null;
  /** Стан галочки «комплект»: саме вона, а не наявність set,
   *  вмикає перевірки складу. */
  isSetOn: boolean;
  /** Артикули складників так, як їх обрали в рядках, — із
   *  повторами. Повтор видно лише за різницею з product.set:
   *  pickedSet його вже склеїв, і комплект мовчки вийшов би
   *  коротшим, ніж задумали. */
  setRows: string[];
}

export interface ProductSavePlan {
  /** Товар із проставленим order — саме він стає в списку. */
  product: Product;
  /** Тіло документа catalog_products/<id>. */
  docData: ProductDoc;
  /** Документ, який треба прибрати: артикул перейменували. */
  removeId: string | null;
  /** Артикул картки, яку заміняємо; null — товар новий. */
  replaceId: string | null;
  /** Комплекти, у складі яких треба замінити старий артикул. */
  setFixes: Record<string, string[]>;
  /** Картки, яким дописуємо зворотні привʼязки кольорів. */
  colorUpdates: Record<string, ColorRaw[]>;
}

export type ProductSaveResult = { ok: true; plan: ProductSavePlan } | CheckFail;

/** Що саме має лягти в базу і чи можна це робити.
 *  Порядок перевірок — той самий, що в адмінці: людина бачить
 *  першу незаповнену річ, а не останню. */
export function planProductSave(input: ProductSaveInput): ProductSaveResult {
  const { product: p, products, editingId, isSetOn, setRows } = input;

  if (!p.id) return fail('id', 'Вкажіть артикул');
  if (!p.name) return fail('name', 'Вкажіть назву');
  if (!p.price) return fail('price', 'Вкажіть ціну');
  if (!p.category) return fail('category', 'Створіть категорію');
  if (!p.images.length) return fail('images', 'Додайте хоча б одне фото');

  /* Артикул — це id документа: збіг не «дублікат у списку», а
     мовчазний перезапис чужої картки. */
  const clash = products.find((x) => x.id === p.id && x.id !== editingId);
  if (clash) return fail('id', 'Артикул ' + p.id + ' вже використовується');

  if (isSetOn) {
    /* Комплект без складників на сайті виглядав би як товар без
       розмірів — краще не дати зберегти, ніж отримати таке
       в каталозі. */
    if (!p.set || p.set.length < 2) {
      return fail('set', 'У комплекті має бути щонайменше два товари');
    }
    if (setRows.filter(Boolean).length > p.set.length) {
      return fail('set', 'Один і той самий товар доданий у комплект двічі');
    }
    const bad = p.set.filter((id) => {
      const x = products.find((y) => y.id === id);
      return !x || isSet(x);
    });
    if (bad.length) {
      return fail('set', 'Складник ' + bad[0] + ' не знайдено або він сам є комплектом');
    }
    if (p.set.includes(p.id)) return fail('set', 'Комплект не може містити сам себе');

    /* Зворотна рекурсія: товар, який уже входить у чийсь комплект,
       не можна робити комплектом — вийшов би комплект у комплекті,
       а такий склад ні зібрати, ні порахувати. */
    const parents = setsWith(products, editingId || p.id);
    if (parents.length) {
      return fail(
        'set',
        'Цей товар входить у комплект «' + parents[0].name + '» — спершу приберіть його звідти'
      );
    }
  }

  const existing = editingId ? products.find((x) => x.id === editingId) ?? null : null;

  const saved: Product = {
    ...p,
    order: existing ? Number(existing.order) || 0 : maxOrder(products) + 10
  };

  const sideUpdates = syncColorLinks(
    products,
    saved,
    existing ? adminColors(existing) : [],
    existing && editingId ? editingId : ''
  );
  const colorUpdates: Record<string, ColorRaw[]> = {};
  Object.keys(sideUpdates).forEach((id) => {
    colorUpdates[id] = packColors(sideUpdates[id]);
  });

  /* Артикул змінили — переносимо посилання на нього в комплектах
     інших товарів, інакше ті комплекти мовчки розваляться. */
  const setFixes: Record<string, string[]> = {};
  const renamed = !!existing && editingId !== p.id;
  if (renamed && editingId) {
    setsWith(products, editingId).forEach((x) => {
      setFixes[x.id] = (x.set ?? []).map((id) => (id === editingId ? p.id : id));
    });
  }

  return {
    ok: true,
    plan: {
      product: saved,
      docData: prodDocData(saved),
      removeId: renamed ? editingId : null,
      replaceId: existing ? editingId : null,
      setFixes,
      colorUpdates
    }
  };
}

/** Каталог-чернетка після збереження. Товар стає на місце того,
 *  який редагували (навіть якщо артикул змінився), а сусідні
 *  картки отримують полагоджені привʼязки. */
export function applyProductSave(products: Product[], plan: ProductSavePlan): Product[] {
  const list = products.slice();
  const idx = plan.replaceId ? list.findIndex((x) => x.id === plan.replaceId) : -1;
  if (idx >= 0) list[idx] = plan.product;
  else list.push(plan.product);

  return list.map((p) => {
    const colors = plan.colorUpdates[p.id];
    const set = plan.setFixes[p.id];
    if (!colors && !set) return p;
    return { ...p, ...(colors ? { colors } : {}), ...(set ? { set } : {}) };
  });
}

/** Запис плану в чернетку. Порядок операцій у пакеті важливий:
 *  спершу зникає стара картка перейменованого товару, потім
 *  комплекти вказують на новий артикул, і лише тоді зʼявляється
 *  сам товар — інакше видалення затерло б щойно записане.
 *
 *  Помилку не глушимо: «немає прав» адмінка має показати, а не
 *  вдати, що зберегла. */
export async function saveProduct(db: Firestore, plan: ProductSavePlan): Promise<void> {
  const batch = writeBatch(db);

  if (plan.removeId) batch.delete(doc(db, PROD_COL, plan.removeId));
  Object.keys(plan.setFixes).forEach((id) => {
    batch.update(doc(db, PROD_COL, id), { set: plan.setFixes[id] });
  });
  batch.set(doc(db, PROD_COL, plan.product.id), plan.docData);
  Object.keys(plan.colorUpdates).forEach((id) => {
    batch.update(doc(db, PROD_COL, id), { colors: plan.colorUpdates[id] });
  });

  await batch.commit();
}
