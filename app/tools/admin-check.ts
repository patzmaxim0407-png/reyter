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

  const counts = orderStats([
    { _id: '1', num: 'a', status: 'shipped', total: 100 },
    { _id: '2', num: 'b', status: 'shipped', total: 100, ttn: '123' },
    { _id: '3', num: 'c', status: 'done', total: 100 },
    { _id: '4', num: 'd', status: 'new', total: 100 }
  ] as never);
  ok('лічильник «без ТТН» рахує лише ті, що в дорозі', counts.noTtn === 1, String(counts.noTtn));
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

  ok('виконане в чергу не потрапляє', nextTask(mkOrder({ status: 'done' }), null, now) === null);
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
      mkOrder({ _id: '4', status: 'confirmed', date: hoursAgo(2) })
    ],
    new Map(),
    now
  );
  ok('смуги в сталому порядку', q.map((x) => x.band.id).join(',') === BANDS.map((b) => b.id).join(','));
  ok('виконане в чергу не приїхало', q.every((s) => !s.rows.find((r) => r.order._id === '2')));
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

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
process.exit(failed ? 1 : 0);
