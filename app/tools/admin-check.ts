/* ============================================================
   Перевірка логіки адмінки
   ------------------------------------------------------------
   Тут перевіряється те, що псує дані назавжди: збереження товару,
   перейменування артикулу, привʼязки кольорів і порівняння
   чернетки з опублікованим.

   Помилка в адмінці не потрапляє на вітрину тієї ж миті —
   покупець бачить знімок. Але зіпсований каталог не відкотиш,
   тож ціна тут вища, ніж на сайті.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/admin-check.ts
   ============================================================ */

import { readFileSync } from 'node:fs';
import {
  adminColors,
  lines,
  maxOrder,
  normalizeHex,
  packColors,
  planProductSave,
  applyProductSave,
  prodDocData,
  pickedSet,
  reorderCategories,
  slugify,
  syncColorLinks,
  checkCategoryDelete,
  countIn
} from '../lib/admin/draft.ts';
import { diffSummary, draftDiffers, fewNames, stableStr, checkScheduleTime } from '../lib/admin/publish.ts';
import type { Category, Product } from '../lib/types.ts';

let failed = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
}

const cats: Category[] = [
  { id: 'briefs', title: 'Бріфи', order: 10 },
  { id: 'tops', title: 'Майки', order: 20 }
];

const prod = (over: Partial<Product> & { id: string }): Product => ({
  name: 'Товар',
  price: 500,
  category: 'briefs',
  images: ['https://x/1.webp'],
  sizes: ['S', 'M'],
  ...over
});

/* ---------- Дрібниці ---------- */

ok('транслітерація дає латиницю', slugify('Бріфи «Щастя»', []) === 'brify-shchastia', slugify('Бріфи «Щастя»', []));
ok('зайнятий id отримує номер', slugify('Бріфи', [{ id: 'brify', title: 'x' }]) === 'brify-2',
   slugify('Бріфи', [{ id: 'brify', title: 'x' }]));
ok('назва з самих емодзі не дає порожній id', slugify('🔥🔥', []) === 'cat', slugify('🔥🔥', []));

ok('порожні рядки з textarea відкидаються',
   JSON.stringify(lines(' один \n\n  два  \n')) === '["один","два"]', JSON.stringify(lines(' один \n\n  два  \n')));

ok('крок порядку лишає місце для вставки', maxOrder([{ order: 10 }, { order: 30 }]) === 30);
ok('артикул не дублюється всередині документа', !('id' in prodDocData(prod({ id: 'A-1' }))));

/* Firestore не приймає undefined: одне таке поле відхиляє ВЕСЬ
   запис, тобто товар без старої ціни просто не зберігся б */
const doc = prodDocData({ ...prod({ id: 'A-1' }), oldPrice: undefined, set: undefined });
ok('порожні поля в документ не потрапляють',
   !Object.values(doc).includes(undefined as never),
   JSON.stringify(Object.keys(doc)));

ok('скорочений hex розгортається', normalizeHex('#0AF') === '#00aaff', normalizeHex('#0AF'));
ok('не-hex відкидається', normalizeHex('синій') === '');

/* ---------- Категорії ---------- */

ok('категорію з товарами видалити не можна',
   checkCategoryDelete([prod({ id: 'A-1', category: 'briefs' })], 'briefs').ok === false);
ok('порожню категорію видалити можна', checkCategoryDelete([], 'briefs').ok === true);
ok('лічильник рахує й додаткові категорії',
   countIn([prod({ id: 'A-1', category: 'tops', categories: ['briefs'] })], 'briefs') === 1);

const re = reorderCategories(cats, ['tops', 'briefs']);
ok('порядок категорій перераховується', re.ok === true && re.changed === true,
   re.ok && re.changed ? JSON.stringify(re.updates) : 'без змін');
const reSame = reorderCategories(cats, ['briefs', 'tops']);
ok('той самий порядок нічого не пише', reSame.ok === true && reSame.changed === false);
const reBad = reorderCategories(cats, ['briefs']);
ok('неповний перелік не зберігається', reBad.ok === false);

/* ---------- Перевірки перед збереженням ---------- */

const catalog: Product[] = [
  prod({ id: 'BR-001', name: 'Бріфи classic' }),
  prod({ id: 'BR-002', name: 'Бріфи classic білі' }),
  prod({ id: 'TP-001', name: 'Майка', category: 'tops' })
];

const base = { products: catalog, editingId: null as string | null, isSetOn: false, setRows: [] as string[] };

const noId = planProductSave({ ...base, product: prod({ id: '' }) });
ok('без артикулу не зберігається', !noId.ok && noId.field === 'id');

const noName = planProductSave({ ...base, product: { ...prod({ id: 'X-1' }), name: '' } });
ok('без назви не зберігається', !noName.ok && noName.field === 'name');

const noPrice = planProductSave({ ...base, product: { ...prod({ id: 'X-1' }), price: 0 } });
ok('без ціни не зберігається', !noPrice.ok && noPrice.field === 'price');

const noPhoto = planProductSave({ ...base, product: { ...prod({ id: 'X-1' }), images: [] } });
ok('без фото не зберігається', !noPhoto.ok && noPhoto.field === 'images');

/* Найнебезпечніше: артикул — це id документа. Збіг не «дублікат
   у списку», а мовчазний перезапис чужої картки. */
const dup = planProductSave({ ...base, product: prod({ id: 'BR-002' }) });
ok('новий товар не може зайняти чужий артикул', !dup.ok && dup.field === 'id',
   dup.ok ? '' : dup.message);

const sameId = planProductSave({ ...base, editingId: 'BR-001', product: prod({ id: 'BR-001', name: 'Нова назва' }) });
ok('свій артикул не вважається дублікатом', sameId.ok === true);

/* ---------- Комплекти ---------- */

/* Так само, як це робить редактор: у товар лягає pickedSet,
   а сирі рядки їдуть окремо */
const asEditor = (id: string, rows: string[]) => ({
  ...base,
  product: { ...prod({ id }), set: pickedSet(rows) },
  isSetOn: true,
  setRows: rows
});

const setSelf = planProductSave(asEditor('CM-1', ['CM-1', 'BR-001']));
ok('комплект не може містити сам себе', !setSelf.ok && setSelf.field === 'set',
   setSelf.ok ? '' : setSelf.message);

const setDup = planProductSave(asEditor('CM-1', ['BR-001', 'BR-001']));
ok('повтор у складі комплекту помічається', !setDup.ok && setDup.field === 'set',
   setDup.ok ? '' : setDup.message);

const setEmpty = planProductSave(asEditor('CM-1', []));
ok('порожній комплект не зберігається', !setEmpty.ok && setEmpty.field === 'set');

const setOk = planProductSave(asEditor('CM-1', ['BR-001', 'TP-001']));
ok('правильний комплект зберігається', setOk.ok === true,
   setOk.ok ? JSON.stringify(setOk.plan.product.set) : (setOk as { message: string }).message);

/* ---------- Перейменування артикулу ---------- */

const withSet: Product[] = [
  ...catalog,
  prod({ id: 'CM-1', name: 'Комплект', set: ['BR-001', 'TP-001'], sizes: [] })
];

const renamed = planProductSave({
  products: withSet,
  editingId: 'BR-001',
  isSetOn: false,
  setRows: [],
  product: prod({ id: 'BR-009', name: 'Бріфи classic' })
});
ok('перейменований артикул прибирає старий документ',
   renamed.ok === true && renamed.plan.removeId === 'BR-001',
   renamed.ok ? String(renamed.plan.removeId) : '');
ok('комплекти отримують новий артикул складника',
   renamed.ok === true && renamed.plan.setFixes['CM-1']?.includes('BR-009') === true,
   renamed.ok ? JSON.stringify(renamed.plan.setFixes) : '');

if (renamed.ok) {
  const next = applyProductSave(withSet, renamed.plan);
  ok('після збереження старого артикулу в каталозі немає',
     !next.some((x) => x.id === 'BR-001'));
  ok('комплект посилається на новий артикул',
     next.find((x) => x.id === 'CM-1')?.set?.includes('BR-009') === true,
     JSON.stringify(next.find((x) => x.id === 'CM-1')?.set));
}

/* ---------- Привʼязки кольорів ---------- */

/* Кольори звʼязують картки того самого товару в різних відтінках.
   Звʼязок має бути в ОБИДВА боки: інакше з другої картки не
   повернутись на першу, і покупець опиниться в глухому куті. */
const colorBase: Product[] = [
  prod({ id: 'BR-001', colors: [] }),
  prod({ id: 'BR-002', colors: [] })
];
const linked = syncColorLinks(
  colorBase,
  { ...prod({ id: 'BR-001' }), colors: [{ hex: '#000000', id: 'BR-002' }] },
  [],
  'BR-001'
);
ok('зворотна привʼязка кольору дописується',
   JSON.stringify(linked['BR-002'] ?? '').includes('BR-001'),
   JSON.stringify(linked));

ok('кольори читаються в обох форматах',
   adminColors({ colors: ['#fff', { hex: '#000', id: 'X' }] }).length === 2,
   JSON.stringify(adminColors({ colors: ['#fff', { hex: '#000', id: 'X' }] })));
ok('колір без відтінку відкидається', adminColors({ colors: [{ hex: '', id: 'X' }] }).length === 0);
ok('пакування зберігає привʼязку',
   JSON.stringify(packColors([{ hex: '#000000', id: 'BR-002' }])).includes('BR-002'),
   JSON.stringify(packColors([{ hex: '#000000', id: 'BR-002' }])));

/* ---------- Порівняння чернетки з опублікованим ---------- */

ok('порядок ключів не впливає на порівняння',
   stableStr({ b: 1, a: 2 }) === stableStr({ a: 2, b: 1 }));
ok('undefined і відсутнє поле — одне й те саме',
   stableStr({ a: 1, b: undefined }) === stableStr({ a: 1 }),
   stableStr({ a: 1, b: undefined }));

const draft = { categories: cats, products: catalog };
ok('без імпорту змін не буває', draftDiffers(draft, null, false) === false);
ok('перша публікація — це зміна', draftDiffers(draft, null, true) === true);
ok('однакові чернетка й публікація змін не дають',
   draftDiffers(draft, { categories: cats, products: catalog }, true) === false);

const changed = draftDiffers(
  draft,
  { categories: cats, products: [{ ...catalog[0], price: 999 }, catalog[1], catalog[2]] },
  true
);
ok('зміна ціни помічається', changed === true);

const sum = diffSummary(draft, { categories: cats, products: [catalog[0]] });
ok('підсумок називає нові товари', sum.some((l) => l.includes('нові товари')), sum.join(' | '));
ok('підсумок не порожній навіть без видимих змін',
   diffSummary(draft, { categories: cats, products: catalog }).length > 0,
   diffSummary(draft, { categories: cats, products: catalog }).join(' | '));
ok('перелік назв обрізається', fewNames(catalog).includes('…') || catalog.length <= 3,
   fewNames(catalog));

/* ---------- Час публікації ---------- */

const now = new Date('2026-08-10T12:00:00');
ok('порожній час не приймається', checkScheduleTime('', now).ok === false);
ok('минулий час не приймається', checkScheduleTime('2026-08-10T11:00', now).ok === false);
ok('майбутній час приймається', checkScheduleTime('2026-08-10T18:00', now).ok === true);
ok('«через мить» не приймається — поки діалог відкритий, воно стане минулим',
   checkScheduleTime('2026-08-10T12:00', now).ok === false);

/* ---------- Оболонка адмінки ----------
   Не логіка, а розмітка — але саме ці дві помилки коштували
   робочої адмінки, і жоден тест їх не ловив: без LangProvider
   падало ручне замовлення (пошук міста питає мову), а атрибут
   hidden на списку дій ховав «Опублікувати» на широкому екрані,
   де кнопки «⋯» немає взагалі. */

const layout = readFileSync(new URL('../app/(admin)/admin/layout.tsx', import.meta.url), 'utf8');
for (const provider of ['LangProvider', 'Toasts', 'AskProvider']) {
  ok(`оболонка адмінки дає ${provider}`, layout.includes('<' + provider + '>'));
}

const bar = readFileSync(new URL('../components/admin/AdminBar.tsx', import.meta.url), 'utf8');
ok('список дій не ховається атрибутом hidden', !/abar__drop"\s+hidden/.test(bar));
ok('меню «⋯» перемикає is-open на батькові', bar.includes("'abar__actions' + (open ? ' is-open' : '')"));

const shells = ['OrdersAdmin', 'PromosAdmin', 'StockAdmin'];
for (const name of shells) {
  const src = readFileSync(new URL(`../components/admin/${name}.tsx`, import.meta.url), 'utf8');
  ok(`${name} має кнопку публікації`, src.includes('<PublishControl'));
  ok(`${name} не лежить у розкладці каталогу`, !src.includes('className="admin-wrap'));
  ok(`${name} малює сторінку класами старої панелі`, src.includes('className="a-page"'));
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
process.exit(failed ? 1 : 0);
