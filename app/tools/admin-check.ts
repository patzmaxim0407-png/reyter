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

import { readFileSync, readdirSync } from 'node:fs';
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
import {
  diffSummary,
  draftDiffers,
  fewNames,
  splitFriendly,
  splitKeepsAll,
  stableStr,
  checkScheduleTime
} from '../lib/admin/publish.ts';
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

const categoryList = readFileSync(
  new URL('../components/admin/CategoryList.tsx', import.meta.url),
  'utf8'
);
ok(
  'ручка категорії має повний pointer-drag цикл',
  categoryList.includes('onPointerDown') &&
    categoryList.includes('onPointerMove') &&
    categoryList.includes('onPointerUp') &&
    categoryList.includes('onPointerCancel')
);
ok(
  'перетягування має видиму ціль і клавіатурну альтернативу',
  categoryList.includes('is-drop-target') &&
    categoryList.includes("e.key === 'ArrowUp'") &&
    categoryList.includes("e.key === 'ArrowDown'")
);
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
/* Розподіл на відкрите й закрите мусить бути повний: товар,
   що не потрапив нікуди, назавжди лишається «неопублікованим». */
ok('розподіл нічого не губить',
   splitKeepsAll({ categories: cats, products: catalog, seeded: true } as never));
ok('і коли товар і прихований, і клубний',
   splitKeepsAll({
     categories: cats,
     products: [...catalog, { ...catalog[0], id: 'X-1', hidden: true, friendly: true }],
     seeded: true
   } as never));

/* Собівартість — комерційна таємниця, а опублікований каталог
   читає весь світ. Одне зайве поле тут коштує дорожче за будь-яку
   помилку в розрахунках: його побачить і конкурент, і покупець. */
{
  const withCost = {
    categories: cats,
    products: [
      { ...catalog[0], id: 'CST-1', cost: 250 },
      { ...catalog[0], id: 'CST-2', cost: 300, friendly: true }
    ],
    seeded: true
  } as never;
  const split = splitFriendly(withCost);
  const leaks = [...split.open.products, ...split.closed.products].filter(
    (p: { cost?: number }) => p.cost !== undefined
  );
  ok('собівартість не потрапляє в опублікований каталог', !leaks.length,
     leaks.map((p: { id: string }) => p.id).join(', ') || 'жодного поля');
  ok('і в закритий документ клубу теж', !split.closed.products.some((p: { cost?: number }) => p.cost !== undefined));
  ok('решта полів товару лишається', split.open.products[0].price === catalog[0].price);
}

/* Закриті товари клубу лежать окремим документом і при складанні
   опиняються в кінці переліку. Порівняння «рядок у рядок» через
   це бачило б різницю завжди, і кнопка «Опублікувати» світилася б
   вічно: опублікуєш, оновиш сторінку — а вона знову горить. */
/* Собівартість живе лише в чернетці, і публікація її зрізає.
   Якби порівняння її враховувало, кнопка «Опублікувати» горіла б
   вічно — рівно так, як колись через закриті товари клубу. */
ok('зміна собівартості не вимагає публікації',
   draftDiffers(
     { categories: cats, products: catalog.map((p, i) => (i === 0 ? { ...p, cost: 777 } : p)) },
     { categories: cats, products: catalog },
     true
   ) === false);

ok('порядок товарів не вважається зміною',
   draftDiffers(draft, { categories: cats, products: [...catalog].reverse() }, true) === false);
ok('а от справжня зміна помічається',
   draftDiffers(draft, { categories: cats, products: catalog.slice(1) }, true) === true);

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

/* ---------- Класи без стилів ----------
   Найтихіша поломка адмінки: компонент вигадує власну назву
   класу, стилі про неї не знають, і блок показується голим. Так
   свого часу лишились без оформлення рядки ручного замовлення,
   форма правки приходу й вибір товарів у промокоді.

   Перевіряємо всі класи, які згадують компоненти адмінки, проти
   всіх наших стилів. Службові is-* пропускаємо: це стани, вони
   завжди пишуться в парі з базовим класом. */

const STYLES = ['admin.css', 'components.css', 'base.css', 'layout.css', 'modal.css', 'app.css']
  .map((f) => readFileSync(new URL('../styles/' + f, import.meta.url), 'utf8'))
  .join('\n');
const described = new Set([...STYLES.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

/* Клас є в старій розмітці, але власного правила не має —
   він там був так само. */
const KNOWN_BARE = new Set(['a-pub__when', 'acombo', 'ao-stockrow--set']);

const adminFiles = readdirSync(new URL('../components/admin/', import.meta.url))
  .filter((f) => f.endsWith('.tsx'));

for (const file of adminFiles) {
  const src = readFileSync(new URL('../components/admin/' + file, import.meta.url), 'utf8');
  const names = new Set<string>();

  for (const m of src.matchAll(/className="([^"]*)"/g)) {
    m[1].split(/\s+/).forEach((c) => c && names.add(c));
  }
  for (const m of src.matchAll(/className=\{([^}]*)\}/g)) {
    /* Прибираємо те, що класами не є: аргументи викликів
       (invalid('price')) і порівняння (tab === 'notify'). */
    const expr = m[1]
      .replace(/[a-zA-Z_$][\w$.]*\([^()]*\)/g, '')
      .replace(/[=!]==\s*'[^']*'/g, '');
    for (const lit of expr.matchAll(/'([^']*)'/g)) {
      lit[1].split(/\s+/).forEach((c) => c && names.add(c));
    }
  }

  const orphans = [...names].filter(
    (c) =>
      // назви класів у проєкті складені: a-item, ao-restock__date
      /[-_]/.test(c) &&
      !c.endsWith('-') &&
      !c.startsWith('is-') &&
      !KNOWN_BARE.has(c) &&
      !described.has(c)
  );
  ok(`${file}: усі класи описані в стилях`, orphans.length === 0, orphans.join(', '));
}

/* ---------- Накладна веде статус ----------
   Три речі, які легко розібрати назад під час наступної правки,
   і жодна з них не впаде в типах: статус зʼявляється сам, назад
   кнопка не пускає, а трекер підхоплює його з «Підготовки». */
{
  const card = readFileSync(new URL('../components/admin/OrderCard.tsx', import.meta.url), 'utf8');
  ok('картка гасить замкнені статуси, а не мовчить',
     card.includes('statusLock(') && card.includes('disabled={!!lock}'));

  const oa = readFileSync(new URL('../components/admin/OrdersAdmin.tsx', import.meta.url), 'utf8');
  ok('накладна сама переводить у «Підготовку»', oa.includes("applyStatus(o, 'packing'"));
  ok('створена накладна не стрибає одразу у «Відправлено»',
     oa.includes("await onStatus(fresh, 'packing')") && !oa.includes("onStatus(fresh, 'shipped')"));
  ok('трекер підхоплює замовлення і з «Підготовки»',
     oa.includes("now !== 'confirmed' && now !== 'packing'"));
}

/* ---------- Прихід ----------
   Розділ, який користувач просив перенести повністю. */

const stock = readFileSync(new URL('../components/admin/StockAdmin.tsx', import.meta.url), 'utf8');
const rform = readFileSync(new URL('../components/admin/RestockForm.tsx', import.meta.url), 'utf8');
const redit = readFileSync(new URL('../components/admin/RestockEdit.tsx', import.meta.url), 'utf8');
const rinfo = readFileSync(new URL('../components/admin/RestockInfo.tsx', import.meta.url), 'utf8');

ok('оприбуткований прихід має клас is-received', stock.includes('ao-restock is-received'));
ok('вибір товару в приході — з чіпом', rform.includes('<ProductChip'));
ok('поле вибору тримає ширину рядка', rform.includes('a-nopick a-rstpick'));
ok('форма правки лишається карткою списку', redit.includes('ao-restock ao-restock--edit'));
ok('у формі правки видно, який прихід редагують', redit.includes('ao-restock__info'));
ok('кількості показані пігулками', rinfo.includes('ao-restock__pills'));
ok('дата приходу — окремим рядком', rinfo.includes('ao-restock__date'));
ok('дати показані словами, а не ISO', rinfo.includes('shortDate') && rinfo.includes('stamp'));


/* ---------- Накладна: щоб менеджер не забув ----------
   Найдорожча забудькуватість у вікні замовлень — відправити
   посилку й не вписати номер. Покупець уже чекає, а сказати йому
   нічого: досі статус мінявся мовчки. */

{
  const { applyStatus, orderStats } = await import('../lib/admin/orders.ts');

  const order = {
    _id: 'x1', num: 'R-1', status: 'confirmed', total: 700,
    items: [{ id: 'p1', name: 'товар', size: 'M', qty: 1, price: 700 }],
    customer: { name: 'Тарас', phone: '+380', email: 'a@b.c' }
  } as never;

  const dialogs = (ttn: string | null) => ({
    confirmAsk: async () => true,
    ask: async () => 'ok' as const,
    askWriteoff: async () => null,
    askText: async () => ttn
  });
  const deps = { db: null as never, c: { products: [], stock: {} } as never, now: new Date(), by: 'a@b.c' };

  const nothing = await applyStatus(order, 'shipped', { ...deps, ask: dialogs('') as never });
  ok('без номера у «Відправлено» не пускає', nothing.ok === false && nothing.reason === 'no-ttn');

  const cancelled = await applyStatus(order, 'shipped', { ...deps, ask: dialogs(null) as never });
  ok('закрив діалог — статус не змінився', cancelled.ok === false && cancelled.reason === 'cancelled');

  const bulkCase = await applyStatus(order, 'shipped', { ...deps, ask: dialogs('123') as never, silent: true });
  ok('масова зміна такі замовлення пропускає', bulkCase.ok === false && bulkCase.reason === 'no-ttn');

  const withTtn = await applyStatus(
    { ...(order as object), ttn: '20450000000000' } as never,
    'shipped',
    { ...deps, ask: dialogs(null) as never }
  );
  ok('замовлення з номером про нього не перепитують', withTtn.reason !== 'no-ttn' && withTtn.reason !== 'cancelled');

  /* Замок — не прикраса кнопки, а перевірка в самому записі:
     статус міняють ще й гуртом, і з черги. Одна відмова на
     всіх — інакше три однакові перевірки розійдуться. */
  const back = await applyStatus(
    { ...(order as object), status: 'packing', ttn: '20450000000000' } as never,
    'confirmed',
    { ...deps, ask: dialogs(null) as never }
  );
  ok('накладна є — запис не пускає назад у «Підтверджено»',
     back.ok === false && back.reason === 'locked', String(back.toast?.text || ''));

  const backFromCarrier = await applyStatus(
    { ...(order as object), status: 'shipped', ttn: '20450000000000' } as never,
    'packing',
    { ...deps, ask: dialogs(null) as never, carrier: { code: '5' } }
  );
  ok('перевізник узяв — запис не пускає в «Підготовку»',
     backFromCarrier.ok === false && backFromCarrier.reason === 'locked');

  const counts = orderStats([
    { _id: '1', num: 'a', status: 'shipped', total: 100 },
    { _id: '2', num: 'b', status: 'shipped', total: 100, ttn: '123' },
    { _id: '3', num: 'c', status: 'done', total: 100 },
    { _id: '4', num: 'd', status: 'new', total: 100 }
  ] as never);
  ok('лічильник «без ТТН» рахує лише ті, що в дорозі', counts.noTtn === 1, String(counts.noTtn));
}


/* ---------- Підсумок замовлення сходиться ----------
   Перевірка, яка кричить на здорові замовлення, гірша за
   відсутню: на неї перестають дивитись, і разом із фальшивими
   тривогами повз проходить справжня. Тому тут насамперед ті
   випадки, де вона мовчати МУСИТЬ, — з доставкою в сумі. */

{
  const { orderMismatch } = await import('../lib/admin/orders.ts');

  const mk = (o: Record<string, unknown>) =>
    orderMismatch({
      items: [{ id: 'p1', name: 'товар', qty: 1, price: Number(o.subtotal) || 0 }],
      ...o
    } as never);

  /* Нова Пошта, покупець платить доставку разом із замовленням. */
  ok('доставка в сумі — не розбіжність',
     mk({ subtotal: 1400, discount: 0, shipping: 137, total: 1537 }) === '',
     mk({ subtotal: 1400, discount: 0, shipping: 137, total: 1537 }));

  /* Міжнародна: доставку платить відправник, тож вона в сумі
     завжди, і числа тут набагато більші. */
  ok('міжнародна доставка — не розбіжність',
     mk({ subtotal: 4280, discount: 0, shipping: 1460, total: 5740 }) === '');

  ok('знижка без доставки — не розбіжність',
     mk({ subtotal: 2190, discount: 219, shipping: 0, total: 1971 }) === '');

  ok('знижка й доставка разом — не розбіжність',
     mk({ subtotal: 880, discount: 85, shipping: 75, total: 870 }) === '');

  // гривня — це округлення відсоткової знижки, а не помилка
  ok('гривня різниці мовчить',
     mk({ subtotal: 1000, discount: 333, shipping: 0, total: 668 }) === '');

  /* Знижка більша за суму: buildOrder зрізає підсумок нулем, і
     перевірка мусить зрізати так само, інакше вона свариться на
     власну ж формулу. */
  ok('підсумок, зрізаний нулем, мовчить',
     mk({ subtotal: 500, discount: 900, shipping: 0, total: 0 }) === '');

  /* Стара форма запису: до 14.08.2026 доставка в total не
     входила. Такі замовлення лежать у базі досі, і сварка на них
     була б фальшивою тривогою на рівному місці. */
  ok('доставка поза сумою — стара форма, не розбіжність',
     mk({ subtotal: 2190, discount: 0, shipping: 540, total: 2190 }) === '',
     mk({ subtotal: 2190, discount: 0, shipping: 540, total: 2190 }));

  ok('стара форма зі знижкою теж мовчить',
     mk({ subtotal: 2190, discount: 219, shipping: 540, total: 1971 }) === '');

  /* А тепер те, заради чого вона взагалі є. */
  ok('підроблений підсумок ловиться',
     mk({ subtotal: 1000, discount: 0, shipping: 0, total: 900 }) !== '');

  ok('сума, що не збігається з жодною формою, ловиться',
     mk({ subtotal: 1000, discount: 0, shipping: 100, total: 1234 }) !== '');

  /* Тисячі fmt розділяє НЕРОЗРИВНИМ пробілом. Порівнювати текст
     зі звичайним — це шукати те, чого там ніколи не буде, і саме
     на цьому обидві перевірки нижче спершу й упали. Зводимо будь-
     який пробіл до одного вигляду, а не переносимо невидимий
     символ у код тесту. */
  const said = (s: string) => s.replace(/\s+/g, ' ');
  const has = (s: string, ...parts: string[]) => parts.every((x) => said(s).includes(x));

  const wrongItems = orderMismatch({
    items: [{ id: 'p1', name: 'товар', qty: 2, price: 500 }],
    subtotal: 900, discount: 0, shipping: 0, total: 900
  } as never);
  ok('позиції, що не дають вказану суму, ловляться', has(wrongItems, '1 000', '900'), wrongItems);

  /* Текст мусить називати числа: інакше менеджер однаково піде
     звіряти картку з базою руками. */
  const gap = mk({ subtotal: 1000, discount: 0, shipping: 100, total: 1234 });
  ok('у тексті видно, що саме розійшлося', has(gap, '1 100', '1 234'), gap);
}


/* ---------- Одне замовлення — одне списання ----------
   Два адміністратори можуть натиснути «Підтвердити» одночасно.
   Другий має перечитати stockApplied у транзакції й побачити,
   що перший уже списав товар. */

{
  const { planStatusChange } = await import('../lib/admin/orders.ts');
  const base = {
    _id: 'race', num: 'R-RACE', status: 'new',
    items: [{ id: 'p', name: 'Товар', size: 'M', qty: 1, price: 700 }]
  } as never;
  const at = { now: new Date('2026-08-15T12:00:00Z'), by: 'admin@example.com' };
  const answer = { putBack: true, lost: null };
  const first = planStatusChange(base, 'confirmed', answer, at);
  const afterFirst = planStatusChange(
    { ...(base as object), status: 'confirmed', stockApplied: true } as never,
    'shipped',
    answer,
    at
  );
  ok('перша зміна списує товар', first.stock.kind === 'consume');
  ok('свіжий stockApplied не списує вдруге', afterFirst.stock.kind === 'none');

  const logic = readFileSync(new URL('../lib/admin/orders.ts', import.meta.url), 'utf8');
  ok(
    'статус перечитується всередині Firestore-транзакції',
    logic.includes('runTransaction(deps.db') && logic.includes('transaction.get(ref)')
  );

  const screen = readFileSync(new URL('../components/admin/OrdersAdmin.tsx', import.meta.url), 'utf8');
  ok(
    'активне списання не можна видалити',
    screen.includes('fresh.stockApplied || consumesStock(fresh.status)') &&
      screen.includes("throw new Error('stock-active')")
  );
}


/* ---------- Трекер Нової Пошти ---------- */

{
  const { parcelState, label, alarm, trackAll } = await import('../lib/admin/np.ts');

  ok('код 9 — отримано', parcelState('9') === 'received');
  ok('код 7 — лежить у відділенні', parcelState('7') === 'waiting');
  ok('код 3 — номера немає', parcelState('3') === 'missing');
  /* 106 — «Одержано і створено накладну зворотної доставки»:
     посилку забрали, назад їдуть гроші за післяплатою. Читати це
     як повернення означало б ніколи не закривати такі
     замовлення. */
  ok('код 106 — посилку забрали, назад ідуть гроші', parcelState('106') === 'received');
  ok('код 2 — накладну видалено в кабінеті', parcelState('2') === 'missing');
  ok('незнайомий код не вигадуємо — вважаємо, що в дорозі', parcelState('777') === 'moving');

  const waiting = { ttn: '1', code: '7', status: '', gotAt: '', waiting: 5, place: '', backMoney: 0 };
  ok('пʼятий день у відділенні — тривога', alarm(waiting) === 2, String(alarm(waiting)));
  ok('третій день — увага', alarm({ ...waiting, waiting: 3 }) === 1);
  ok('перший день — спокій', alarm({ ...waiting, waiting: 1 }) === 0);
  ok('повертається — завжди тривога', alarm({ ...waiting, code: '102', waiting: 0 }) === 2);
  ok('підпис каже дні, а не код', label(waiting) === 'У відділенні 5 дн.', label(waiting));

  /* Живий запит на СПРАВЖНЮ накладну: вигаданий номер дає код
     «не знайдено» і мовчить про решту полів, тож на ньому не
     видно ні дат, ні відділення — тобто нічого з того, що
     насправді читає менеджер. */
  const live = await trackAll([{ ttn: '20451507134336', phone: '' }]);
  const parcel = live.get('20451507134336');
  ok('перевізник відповідає без ключа', live.size === 1, 'посилок у відповіді: ' + live.size);
  ok('справжня накладна читається', !!parcel && !!parcel.code, JSON.stringify(parcel));
  ok('відділення видно', !!parcel?.place, parcel?.place);
  ok('дати перевізника розбираються', !!parcel && !Number.isNaN(parcel.waiting), String(parcel?.waiting));
  ok('порожні номери не питаємо', (await trackAll([{ ttn: '', phone: '' }])).size === 0);
}


/* ---------- Черга справ ---------- */

{
  const { nextTask, queue, BANDS } = await import('../lib/admin/orders.ts');
  const now = new Date('2026-08-11T12:00:00');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

  const mkOrder = (o: Record<string, unknown>) =>
    ({ _id: 'x', num: 'R-1', total: 700, date: hoursAgo(1), ...o }) as never;

  ok('виконане без суперечності в чергу не потрапляє', nextTask(mkOrder({ status: 'done' }), null, now) === null);
  ok(
    'виконане й справді отримане в чергу не потрапляє',
    nextTask(mkOrder({ status: 'done', ttn: '1' }), { code: '9' }, now) === null
  );
  const closedTooSoon = nextTask(
    mkOrder({ status: 'done', ttn: '1' }),
    { code: '7', waiting: 2 },
    now
  );
  ok(
    'виконане, яке ще у відділенні, повертається в чергу помилок',
    closedTooSoon?.band === 'back' && closedTooSoon.urgency === 2,
    JSON.stringify(closedTooSoon)
  );
  ok('скасоване теж', nextTask(mkOrder({ status: 'cancelled' }), null, now) === null);
  ok('нове — підтвердити', nextTask(mkOrder({ status: 'new' }), null, now)?.band === 'confirm');
  ok(
    'нове, що висить пів дня, — терміново',
    nextTask(mkOrder({ status: 'new', date: hoursAgo(13) }), null, now)?.urgency === 2
  );
  ok('підтверджене — зібрати', nextTask(mkOrder({ status: 'confirmed' }), null, now)?.band === 'pack');
  ok(
    'відправлене без номера — окрема смуга',
    nextTask(mkOrder({ status: 'shipped' }), null, now)?.band === 'ttn'
  );
  ok(
    'отримане — пропонуємо закрити',
    nextTask(mkOrder({ status: 'shipped', ttn: '1' }), { code: '9' }, now)?.band === 'close'
  );
  ok(
    'повертається — у смугу помилок',
    nextTask(mkOrder({ status: 'shipped', ttn: '1' }), { code: '102' }, now)?.band === 'back'
  );
  ok(
    'лежить два дні — ще не привід турбувати',
    nextTask(mkOrder({ status: 'shipped', ttn: '1' }), { code: '7', waiting: 2 }, now)?.band === 'transit'
  );
  const waiting5 = nextTask(mkOrder({ status: 'shipped', ttn: '1' }), { code: '7', waiting: 5 }, now);
  ok('лежить пʼятий день — смуга «лежить», і горить', waiting5?.band === 'waiting' && waiting5?.urgency === 2);

  const q = queue(
    [
      mkOrder({ _id: '1', status: 'new' }),
      mkOrder({ _id: '2', status: 'done' }),
      mkOrder({ _id: '3', status: 'confirmed', date: hoursAgo(50) }),
      mkOrder({ _id: '4', status: 'confirmed', date: hoursAgo(2) }),
      mkOrder({ _id: '5', status: 'done', ttn: '5' })
    ],
    new Map([['5', { code: '7', waiting: 2 }]]),
    now
  );
  ok('смуги в сталому порядку', q.map((x) => x.band.id).join(',') === BANDS.map((b) => b.id).join(','));
  ok('виконане в чергу не приїхало', q.every((s) => !s.rows.find((r) => r.order._id === '2')));
  ok(
    'помилково виконане приїхало у смугу помилок',
    q.find((x) => x.band.id === 'back')?.rows.some((r) => r.order._id === '5') === true
  );
  const pack = q.find((x) => x.band.id === 'pack');
  ok('усередині смуги найтерміновіше зверху', pack?.rows[0]?.order._id === '3', pack?.rows.map((r) => r.order._id).join(','));
}


/* ---------- Статус за трекером ---------- */

{
  const { statusFromTracker } = await import('../lib/admin/np.ts');
  const parcel = (code: string) =>
    ({ ttn: '1', code, status: '', gotAt: '', waiting: 0, place: '', backMoney: 0,
       scheduled: '', city: '', createdAt: '' });

  ok('забрали — «Виконано»', statusFromTracker(parcel('9')) === 'done');
  ok('їде — «Відправлено»', statusFromTracker(parcel('5')) === 'shipped');
  ok('лежить у відділенні — теж «Відправлено»', statusFromTracker(parcel('7')) === 'shipped');
  ok('повертається — статус не чіпаємо', statusFromTracker(parcel('102')) === null);
  ok('номера немає — статус не чіпаємо', statusFromTracker(parcel('3')) === null);
  ok('накладна лише створена — ще не «Відправлено»', statusFromTracker(parcel('1')) === null);
}


/* ---------- «Виконано» без сліду доставки ---------- */

{
  const { applyStatus } = await import('../lib/admin/orders.ts');
  const mkOrder = (o: Record<string, unknown>) =>
    ({ _id: 'x', num: 'R-9', total: 700, status: 'shipped',
       items: [{ id: 'p', name: 'т', size: 'M', qty: 1, price: 700 }],
       customer: { name: 'Т', phone: '+380' }, ...o }) as never;
  const dialogs = (answer: 'ok' | 'alt' | null, ttn: string | null = null) => ({
    confirmAsk: async () => true,
    ask: async () => answer,
    askWriteoff: async () => null,
    askText: async () => ttn
  });
  const deps = { db: null as never, c: { products: [], stock: {} } as never, now: new Date(), by: 'a@b.c' };

  const silent = await applyStatus(mkOrder({}), 'done', { ...deps, ask: dialogs('ok') as never, silent: true });
  ok('пакетом не закриваємо без накладної', silent.ok === false && silent.reason === 'no-ttn');

  const cancelled = await applyStatus(mkOrder({}), 'done', { ...deps, ask: dialogs(null) as never });
  ok('закрив діалог — статус лишився', cancelled.reason === 'cancelled');

  const noNumber = await applyStatus(mkOrder({}), 'done', { ...deps, ask: dialogs('ok', '') as never });
  ok('порожній номер не приймається', noNumber.ok === false && noNumber.reason === 'no-ttn');

  const pickup = await applyStatus(mkOrder({ pickup: true }), 'done', { ...deps, ask: dialogs(null) as never });
  ok('позначене самовинесенням закривається без питань', pickup.reason !== 'no-ttn' && pickup.reason !== 'cancelled');

  const withTtn = await applyStatus(mkOrder({ ttn: '20450000000000' }), 'done', { ...deps, ask: dialogs(null) as never });
  ok('із накладною теж не перепитуємо', withTtn.reason !== 'no-ttn' && withTtn.reason !== 'cancelled');

  const { nextTask } = await import('../lib/admin/orders.ts');
  const task = nextTask(mkOrder({ pickup: true, date: new Date().toISOString() }), null, new Date());
  ok('самовиніс має власну смугу, а не «Отримано»', task?.band === 'pickup', task?.band);
}


/* ---------- Вибір кольору взагалі можливий ----------
   Список кольорів висить окремою панеллю, поза кнопкою, яка його
   відкрила. Поки сторож «натиснули повз» не знав про панель,
   вона зникала на mousedown — і клік по пункту вже не мав куди
   приземлитись: жоден колір не привʼязувався. Перевірено в
   браузері 13.08.2026 — до правки не працювало, після правки
   працює. */

{
  const text = readFileSync(new URL('../components/admin/ColorPicker.tsx', import.meta.url), 'utf8');
  ok('панель вибору кольору не закривається під власним кліком',
     text.includes('panel.current?.contains(where)'), 'panel.current?.contains');
}

/* ---------- Черга показує тільки роботу ---------- */

{
  const text = readFileSync(new URL('../components/admin/OrdersQueue.tsx', import.meta.url), 'utf8');
  ok('порожні смуги не малюються заголовками', text.includes('withWork.map'), 'withWork.map');
  ok('а перелічені одним рядком унизу', text.includes('aq-none'));
  ok('емодзі в заголовках смуг не малюються', !text.includes('band.icon'));
}

/* ---------- Відкрита форма не має скидатись сама ---------- */

/* Каталог, замовлення й промокоди приходять живою підпискою, і
   кожен її кадр створює НОВІ обʼєкти. Доки вони стояли в
   залежностях ефекту, будь-яка чужа зміна переписувала відкриту
   форму заново й затирала все набране.

   Найчастіше під це потрапляла собівартість: її вписують
   останньою, і вона встигала прожити найменше — виглядало це так,
   наче поле взагалі не приймає числа.

   Тому ефект має стежити за ІДЕНТИФІКАТОРОМ, а не за обʼєктом. */
{
  const editor = readFileSync(new URL('../components/admin/ProductEditor.tsx', import.meta.url), 'utf8');
  ok('картка товару стежить за артикулом', editor.includes('[open, product?.id]'));
  ok('а не за обʼєктом товару', !editor.includes('[open, product, categories]'));

  const manual = readFileSync(new URL('../components/admin/ManualOrder.tsx', import.meta.url), 'utf8');
  ok('ручне замовлення стежить за номером', manual.includes('[open, order?._id]'));

  const promo = readFileSync(new URL('../components/admin/PromoEditor.tsx', import.meta.url), 'utf8');
  ok('редактор промокоду стежить за кодом', promo.includes('[open, promo?.code]'));
}

/* ---------- Собівартість не правиться руками ---------- */

/* Вона живе партіями: прийшло десять пар по 300, потім пʼять по
   330 — і кожен наступний продаж бере ціну своєї партії. Число в
   картці лише вершина цієї черги.

   Правка руками нічого не міняла в самих партіях, зате тихо
   розходилась із ними: звіт рахував одне, черга собівартості —
   інше, і зрозуміти, котре правда, було вже нічим. Тому міняється
   вона там, де змінюється насправді: у приході або в калькуляторі
   випуску. */
{
  const editor = readFileSync(new URL('../components/admin/ProductEditor.tsx', import.meta.url), 'utf8');
  ok('у картці товару собівартість не вводять', !editor.includes('id="fCost"'));
  ok('і не міняють жодним іншим полем', !editor.includes("set('cost'"));
  ok('але видно її й маржу', editor.includes('a-cost'));

  const restock = readFileSync(new URL('../components/admin/RestockForm.tsx', import.meta.url), 'utf8');
  ok('прихід собівартість задає', restock.includes('Собівартість, грн'));
}

/* ---------- Зразок листа — той самий лист ---------- */

/* Розмітку зразка збирає воркер, тим самим кодом, що й надсилає.
   Другого шаблону в адмінці немає навмисно: два розійшлись би
   тихо, і зразок почав би показувати не те, що надходить людям, —
   а помітили б це вже з отриманого листа. */
{
  const box = readFileSync(new URL('../components/admin/Broadcast.tsx', import.meta.url), 'utf8');
  ok('зразок питають у воркера', box.includes('previewLetter'));
  ok('свого шаблону листа в адмінці немає', !box.includes('<table role="presentation"'));
  ok('показуємо в окремому вікні', box.includes('srcDoc'));
  /* Усередині лише розмітка листа — виконувати там нічого не
     треба, тож пісочниця порожня. */
  ok('і без виконання скриптів', box.includes('sandbox=""'));
}

/* ---------- Примітки в картці товару ---------- */

/* Спільні для магазину, поки товар не має власних. Власні
   потрібні там, де спільні брешуть: «доставка БІЛИЗНИ безкоштовна»
   на свічці читається як обіцянка, якої ніхто не давав. */
{
  const editor = readFileSync(new URL('../components/admin/ProductEditor.tsx', import.meta.url), 'utf8');
  ok('примітки вмикаються галочками', editor.includes('NOTES.map'));
  /* Прибрані, а не дозволені: товар без цього поля показує всі
     три, як і показував. Список дозволених лишив би всі старі
     товари взагалі без приміток — мовчки. */
  ok('порожньо в документ не пишеться', editor.includes('noteOff.length ? noteOff : undefined'));

  const view = readFileSync(new URL('../views/ProductView.tsx', import.meta.url), 'utf8');
  ok('товар ховає лише вимкнені', view.includes('!p.noteOff?.includes(n.id)'));
  /* Поріг підставляється в текст: інакше картка обіцяла б одне
     число, а кошик рахував за іншим. */
  ok('поріг підставляється в примітку', view.includes('withFree(t(n.key, lang), freeFrom)'));

  const settings = readFileSync(new URL('../components/admin/SettingsDialog.tsx', import.meta.url), 'utf8');
  ok('поріг задається в налаштуваннях', settings.includes('id="stFreeFrom"'));
}

/* ---------- Поріг згадується всюди однаково ---------- */

/* Число живе в одному місці, а згадується в багатьох: рядок, що
   біжить угорі, обіцянка на головній, примітка в картці товару,
   смужка в кошику. Доти воно було вписане в кожен із них окремо —
   і змінивши налаштування, магазин обіцяв би трьома різними
   числами водночас. */
{
  const i18n = readFileSync(new URL('../lib/i18n.ts', import.meta.url), 'utf8');
  const hard = i18n
    .split('\n')
    .filter((line) => /1500/.test(line) && /(грн|UAH)/.test(line));
  ok('у текстах магазину числа не вписано', hard.length === 0, hard.join(' | ').slice(0, 160));
  ok('рядок згори підставляє поріг', /'marquee':[^\n]*\{free\}/.test(i18n));
  ok('обіцянка на головній теж', /'hero\.trust1':[^\n]*\{free\}/.test(i18n));

  const chrome = readFileSync(new URL('../components/ShopChrome.tsx', import.meta.url), 'utf8');
  ok('рядок згори підставляє його насправді', chrome.includes('withFree(t('));

  const home = readFileSync(new URL('../views/HomeView.tsx', import.meta.url), 'utf8');
  ok('і головна теж', home.includes('withFree(t('));

  /* Резервна копія існує, щоб із неї можна було відновитись.
     Законсервувати в ній старе число з коду означало б
     відновитися не в той магазин. */
  const pub = readFileSync(new URL('../components/admin/PublishDialog.tsx', import.meta.url), 'utf8');
  ok('резервна копія бере поріг із налаштувань', pub.includes('freeDeliveryFrom: freeFrom'));

  /* Адмінка мусить рахувати від того самого числа, що й сайт.
     Доти вона його не знала зовсім і мовчки падала на запасне з
     коду: у налаштуваннях 1599, а картка замовлення писала
     «бракує 260» — тобто від 1500. */
  const orders = readFileSync(new URL('../components/admin/OrdersAdmin.tsx', import.meta.url), 'utf8');
  ok('картка замовлення знає поріг магазину', orders.includes('freeFrom: Math.round(Number(settings.freeFrom)'));
  /* І історію теж: замовлення, оформлені до появи заморожування,
     свого числа не мають, а показати їм сьогоднішнє означало б
     збрехати саме там, де людина шукає правду. */
  ok('і його історію', orders.includes('freeLog:'));

  /* Поріг заморожується в мить оформлення — усередині customer, а
     не окремим полем: правила бази перелічують дозволені поля
     замовлення й публікуються руками, тож нове поле верхнього
     рівня спинило б живий сайт МОВЧКИ. */
  const co = readFileSync(new URL('../components/CheckoutForm.tsx', import.meta.url), 'utf8');
  ok('поріг заморожується в замовленні', co.includes('freeFrom: freeFromOf(c)'));
  const rules = readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8');
  ok('і не став новим полем верхнього рівня', !/'freeFrom'/.test(rules));
}

/* ---------- Історія порога ---------- */

/* Журнал потрібен не для звітності, а щоб було чим відповісти на
   питання «чому в цьому замовленні інше число». */
{
  const st = readFileSync(new URL('../lib/admin/settings.ts', import.meta.url), 'utf8');
  ok('зміни порога записуються', st.includes('function pushFreeLog'));
  /* Збереження налаштувань буває щодня, а зміна порога — раз на
     рік. Писати в журнал кожне натискання «Зберегти» означало б
     засипати його однаковими рядками. */
  ok('однакове значення в журнал не пишеться', st.includes('if (from === to) return null'));
  /* Запис читається як «з цієї миті діє стільки». Попереднє
     значення не зберігаємо: це просто наступний рядок нижче, а
     другий запис того самого факту розійшовся б із першим, щойно
     хтось допише минуле заднім числом. */
  ok('попереднє значення вдруге не зберігається',
     !/interface FreeFromEntry[\s\S]{0,400}?\bwas\b/.test(st));
  /* Дописаний заднім числом запис має стати на своє місце, а не
     зверху: інакше список читався б як «спершу 1599, потім
     1500». */
  ok('журнал упорядковується за датою', st.includes('function sortFreeLog'));
  ok('минуле можна дописати', st.includes('function addFreeLog'));
  ok('помилковий запис можна прибрати', st.includes('function dropFreeLog'));
  /* Історія лежить у службовому документі: покупцеві список
     того, як магазин рухав поріг, віддавати ні до чого. */
  ok('у публічну копію історія не йде',
     /batch\.set\(doc\(db, SETTINGS_COL, 'public'\), data, \{ merge: true \}\)/.test(st));
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
process.exit(failed ? 1 : 0);
