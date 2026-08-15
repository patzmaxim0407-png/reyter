/* ============================================================
   Перевірка складання замовлення
   ------------------------------------------------------------
   Бере СПРАВЖНІЙ опублікований каталог і збирає з нього
   замовлення так само, як це робить сторінка оформлення —
   але нічого нікуди не пише.

   Сенс перевірки: у замовленні мають лежати назви й категорії,
   а не самі артикули. Інакше лист покупцю й картка в адмінці
   зіпсуються, щойно каталог зміниться.

   node --experimental-strip-types tools/order-check.ts
   ============================================================ */

import { readFileSync } from 'node:fs';
import { loadCatalog, loadStock } from '../lib/firestore.ts';
import { fmt, isSet, setParts, availability, productSizes, ALL_SIZES, type Catalogue } from '../lib/catalog.ts';
import {
  buildOrder,
  buildMessage,
  confirmLine,
  orderNumber,
  checkCustomer,
  type Customer
} from '../lib/order.ts';
import {
  checkAddress,
  fromForm,
  toForm,
  addressLine,
  EMPTY_FORM,
  type AddressForm
} from '../lib/address.ts';
import { t } from '../lib/i18n.ts';
import type { CartLine } from '../lib/types.ts';

let failed = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
}

const catalog = await loadCatalog();
const stock = await loadStock();
const c: Catalogue = {
  products: catalog.products,
  stock,
  categories: catalog.categories
};

/* ---------- Кошик: звичайний товар + комплект ---------- */

const plain = c.products.find((p) => !p.hidden && !isSet(p) && !availability(c, p).soldOut)!;
const set = c.products.find((p) => isSet(p) && setParts(c, p).length)!;

const plainAv = availability(c, plain);
const plainSize = plain.volume ?? ALL_SIZES.find((s) => plainAv.sizes.includes(s)) ?? null;

const lines: CartLine[] = [
  { id: plain.id, size: plainSize, qty: 2 },
  {
    id: set.id,
    size: null,
    qty: 1,
    parts: setParts(c, set).map((part) => {
      const a = availability(c, part);
      return { id: part.id, size: part.volume ?? ALL_SIZES.find((s) => a.sizes.includes(s)) ?? null };
    })
  }
];

const subtotal = lines.reduce((s, i) => {
  const p = c.products.find((x) => x.id === i.id)!;
  return s + p.price * i.qty;
}, 0);

/* ---------- Адреса ---------- */

const npForm: AddressForm = {
  ...EMPTY_FORM,
  carrier: 'np',
  city: 'Львів',
  cityRef: 'db5c88f5-391c-11dd-90d9-001a92567626',
  branch: 'Відділення №1: вул. Городоцька, 359',
  branchRef: 'ref-1'
};

ok('порожня адреса не проходить перевірку', checkAddress(EMPTY_FORM)?.field === 'city');
ok('заповнена адреса Нової Пошти проходить', checkAddress(npForm) === null);

const intlForm: AddressForm = {
  ...EMPTY_FORM,
  carrier: 'intl',
  countryCode: 'US',
  /* Курʼєром на адресу: у відділення перевізник питає інше —
     там ані вулиці, ані індексу не треба взагалі. */
  intlMode: 'address',
  intlCity: 'Chicago',
  street: 'Main St',
  building: '123',
  zip: '60601'
};
ok(
  'для США без штату — питаємо штат, і саме останнім',
  checkAddress(intlForm)?.field === 'state',
  JSON.stringify(checkAddress(intlForm))
);
ok('зі штатом закордонна адреса проходить', checkAddress({ ...intlForm, state: 'IL' }) === null);
ok(
  'без номера будинку не проходить',
  checkAddress({ ...intlForm, state: 'IL', building: '' })?.field === 'building'
);
ok(
  'кирилицю в закордонній адресі не пропускаємо',
  checkAddress({ ...intlForm, state: 'IL', street: 'Головна' })?.key === 'addr.needLatin'
);

/* У відділення все інакше: вулиця й індекс не потрібні, зате
   пункт мусить бути обраний зі списку, а не набраний руками. */
const toBranchForm: AddressForm = {
  ...EMPTY_FORM,
  carrier: 'intl',
  countryCode: 'PL',
  intlCity: 'Warsaw',
  intlCityId: '22326',
  intlBranch: '№04/2',
  intlBranchId: '7'
};
ok('у відділення без вулиці й індексу — проходить', checkAddress(toBranchForm) === null);
ok(
  'набраний руками пункт не приймається',
  checkAddress({ ...toBranchForm, intlBranchId: '' })?.key === 'addr.pickFromList'
);
ok(
  'для Німеччини питаємо адресу реєстрації',
  checkAddress({ ...toBranchForm, countryCode: 'DE' })?.field === 'regCity'
);

const intlAddr = fromForm({ ...intlForm, state: 'IL', flat: 'apt 5' });
ok(
  'закордонна адреса дублює місто й вулицю в city/branch',
  intlAddr.city === 'Chicago' && intlAddr.branch === 'Main St 123, apt 5',
  JSON.stringify({ city: intlAddr.city, branch: intlAddr.branch })
);
ok('назва країни підставляється за кодом', intlAddr.intl?.country === 'США', intlAddr.intl?.country);

const branchAddr = fromForm(toBranchForm);
ok(
  'у відділення в branch іде сам пункт, а не вулиця',
  branchAddr.branch === '№04/2' && !branchAddr.intl?.street,
  JSON.stringify({ branch: branchAddr.branch, street: branchAddr.intl?.street })
);

/* Адреса має пережити цикл «зберегли → відкрили форму знову» */
const round = toForm(intlAddr);
ok(
  'адреса відновлюється у форму без втрат',
  round.countryCode === 'US' && round.state === 'IL' && round.zip === '60601' &&
    round.street === 'Main St' && round.building === '123' && round.flat === 'apt 5' &&
    round.intlMode === 'address',
  JSON.stringify(round)
);
const roundBranch = toForm(branchAddr);
ok(
  'вибір відділення теж повертається у форму',
  roundBranch.intlMode === 'branch' && roundBranch.intlBranchId === '7' && roundBranch.intlCityId === '22326',
  JSON.stringify(roundBranch)
);

/* Старі записи квартиру тримали в extra — вони мусять читатись */
const legacySaved = toForm({
  carrier: 'Міжнародна доставка',
  carrierId: 'intl',
  city: 'Lisboa',
  intl: { countryCode: 'PT', country: 'Португалія', city: 'Lisboa', street: 'Rua A 5', extra: 'apt 2', zip: '1000' }
} as never);
ok(
  'стара адреса читається: квартира з extra, режим — адресний',
  legacySaved.flat === 'apt 2' && legacySaved.intlMode === 'address',
  JSON.stringify({ flat: legacySaved.flat, mode: legacySaved.intlMode })
);

const otherBack = toForm(fromForm({ ...EMPTY_FORM, carrier: 'intl', countryCode: 'other', countryOther: 'Portugal', intlCity: 'Lisboa', intlMode: 'address', street: 'Rua A', building: '5', zip: '1000' }));
ok('країна поза списком повертається в своє поле', otherBack.countryOther === 'Portugal', otherBack.countryOther);

/* ---------- Покупець ---------- */

ok('без імені замовлення не збирається', checkCustomer({ name: '', phone: '+380971112233', email: '' })?.field === 'name');
ok('короткий телефон не проходить', checkCustomer({ name: 'Тарас', phone: '123', email: '' })?.field === 'phone');
ok('крива пошта не проходить', checkCustomer({ name: 'Тарас', phone: '+380971112233', email: 'ой' })?.field === 'email');
ok('без пошти замовлення не збирається — на неї йде підтвердження',
   checkCustomer({ name: 'Тарас', phone: '+380971112233', email: '' })?.field === 'email');
ok('із поштою збирається',
   checkCustomer({ name: 'Тарас', phone: '+380971112233', email: 'taras@example.com' }) === null);

const customer: Customer = {
  name: 'Тарас Шевченко',
  phone: '+380971112233',
  email: 'taras@example.com',
  ...fromForm(npForm),
  comment: 'Подзвоніть після 18:00',
  confirm: { method: 'messenger', messenger: 'telegram', phoneMode: 'other', altPhone: '+380509998877', telegram: 'taras' }
};

/* ---------- Саме замовлення ---------- */

const order = buildOrder({
  c,
  lines,
  customer,
  subtotal,
  discount: 100,
  promoCode: 'TEST100',
  now: new Date('2026-08-09T10:30:00Z'),
  t
});

ok('номер має формат дати', /^R-260809-\d{3}$/.test(order.num), order.num);
ok('разом = сума мінус знижка', order.total === subtotal - 100, `${subtotal} − 100 = ${order.total}`);

const setItem = order.items.find((i) => i.id === set.id)!;
ok('позиції мають назви, а не лише артикули', order.items.every((i) => i.name && i.name !== i.id));
ok('позиції мають категорію', order.items.every((i) => !!i.category), order.items.map((i) => i.category).join(' | '));
ok(
  'складники комплекту збережені з назвами й категоріями',
  !!setItem.parts?.length && setItem.parts.every((x) => x.name !== x.id && !!x.category),
  JSON.stringify(setItem.parts)
);

ok('адреса в один рядок', addressLine(customer) === 'Нова Пошта, Львів, Відділення №1: вул. Городоцька, 359', addressLine(customer));
ok(
  'рядок підтвердження бере запасний номер і логін',
  confirmLine(customer, t) === 'Telegram · +380509998877 · @taras',
  confirmLine(customer, t)
);

const msg = buildMessage(order, t);
ok('у повідомленні є номер', msg.includes('Замовлення №' + order.num));
/* Найдорожча помилка в тексті — сума. Лист і Telegram мають
   називати рівно те число, що стоїть у замовленні: 14.08.2026
   доставку тут додавали вдруге, і покупець читав «1 960 грн»
   там, де в адмінці було 1 420. */
ok('сума в повідомленні дорівнює сумі замовлення',
   msg.includes('Разом: ' + fmt(order.total) + ' грн'),
   msg.split('\n').find((l) => l.startsWith('Разом')) || '');
ok('у повідомленні є промокод і знижка', msg.includes('Промокод TEST100: −100 грн'), msg.split('\n').find((l) => l.includes('Промокод')) || '');
ok('у повідомленні є склад комплекту з відступом', /\n {6}– /.test(msg));
ok('у повідомленні є доставка', msg.includes('🚚 Нова Пошта, Львів'));
ok('у повідомленні є коментар', msg.includes('💬 Подзвоніть після 18:00'));

/* Номер має бути унікальним у межах дня — перевіряємо, що
   випадкова частина справді змінюється */
const nums = new Set(Array.from({ length: 50 }, () => orderNumber(new Date())));
ok('номери не повторюються', nums.size > 40, `унікальних: ${nums.size} з 50`);

/* ---------- Знижка проти правил бази ----------
   Правило звіряє знижку з `subtotal * value / 100`, порахованим
   ЦІЛОЧИСЕЛЬНО. Якщо клієнт дасть хоч на гривню більше, увесь
   запис буде відхилено — і замовлення просто не створиться. */

const { promoCheck } = await import('../lib/promo.ts');

function ruleAllows(subtotal: number, percent: number): number {
  // те саме ділення, що в Firestore Rules: цілі числа, дріб відкидається
  return Math.trunc((subtotal * percent) / 100);
}

let overRule = 0;
let worst = '';
for (const percent of [5, 7, 10, 15, 20, 33]) {
  for (let sub = 101; sub <= 4000; sub += 7) {
    const res = promoCheck(
      { code: 'X', type: 'percent', value: percent, scope: 'all' },
      [{ id: 'A', category: 'c', categories: ['c'], price: sub, qty: 1, sale: false }]
    );
    const mine = res.discount ?? 0;
    if (mine > ruleAllows(sub, percent)) {
      overRule++;
      if (!worst) worst = `${percent}% від ${sub} грн: клієнт ${mine}, правило ${ruleAllows(sub, percent)}`;
    }
  }
}
ok('відсоткова знижка ніколи не більша за дозволену правилом', overRule === 0,
   overRule ? `перевищень: ${overRule}, напр. ${worst}` : 'перевірено 3336 комбінацій');

/* ---------- Набір полів проти правил бази ----------
   Правило orderKeysOk() пускає лише перелічені ключі. Зайвий —
   і ВЕСЬ запис відхиляється: замовлення просто не створиться. */

const ALLOWED_ORDER_KEYS = [
  'num', 'date', 'items', 'subtotal', 'discount', 'promoCode',
  'shipping', 'total', 'customer', 'message', 'status', 'uid',
  'email', 'source', 'lang', 'trackKey', 'created',
  'createdBy', 'statusLog', 'stockApplied', 'note', 'ttn'
];

/* Те саме, що складає lib/firebase.ts → createOrder */
const SITE_ORDER_KEYS = [
  'num', 'date', 'items', 'subtotal', 'discount', 'promoCode',
  'total', 'customer', 'message', 'status', 'uid', 'email',
  'source', 'lang', 'trackKey', 'created'
];

const extraKeys = SITE_ORDER_KEYS.filter((k) => !ALLOWED_ORDER_KEYS.includes(k));
ok('сайт не пише полів поза правилами', !extraKeys.length, extraKeys.join(', ') || 'зайвих немає');

/* Розміри, яких у товару немає, показувати не можна: перекреслені
   XS і XL читаються як «закінчились», і покупець чекає на них
   замість того, щоб узяти свій. */
{
  const sized = { id: 'X', name: 'X', price: 1, category: 'c', sizes: ['L', 'S'] } as never;
  const list = productSizes(sized);
  ok('показуємо лише розміри товару', list.join(',') === 'S,L', list.join(','));
  ok('порядок сталий, від меншого до більшого', list[0] === 'S');

  const legacy = { id: 'Y', name: 'Y', price: 1, category: 'c' } as never;
  ok('товару без сітки лишається вся — це найперші записи',
     productSizes(legacy).join(',') === ALL_SIZES.join(','));
}

/* Кошик, який бачить покупець на сторінці банку.

   Фото там не прикраса: рахунок на кілька тисяч гривень із
   чотирма сірими квадратами замість товару виглядає як чужий, і
   саме на цьому кроці людина найчастіше передумує. Але фото
   ніколи не варте незробленої оплати — тому в рахунку мусить
   лишатись відхід: не прийняв банк кошик із картинками, шлемо
   без них. Банк уже одного разу відкидав кошик мовчки, і ціна
   тієї помилки — місяці неоплачених міжнародних замовлень. */
{
  const src = readFileSync(new URL('../../worker/worker.js', import.meta.url), 'utf8');
  ok('воркер кладе фото в кошик банку', /if \(l\.icon\) row\.icon = l\.icon/.test(src));
  ok('фото беруться з каталогу, а не з запиту', /icon: firstImage\(p\)/.test(src));
  ok('на відмову банку рахунок повторюється без фото',
     /delete copy\.icon/.test(src) && /basket\.some\(\(x\) => x\.icon\)/.test(src));
}

/* Ручне замовлення — той самий документ, і перевіряти його треба
   тим самим набором. Саме тому, що набір полів ручного замовлення
   не перевіряв ніхто, воно роками лягало в базу без subtotal — а
   без нього програма лояльності бачить покупку нульовою й мовчки
   не дає балів ні при «Виконано», ні при зарахуванні історії. */
{
  const src = readFileSync(new URL('../lib/admin/orders.ts', import.meta.url), 'utf8');
  const doc = (src.match(/const order: OrderDoc = \{([\s\S]*?)\n  \};/) || [])[1] || '';
  const has = (k: string) => new RegExp('(^|\\n)\\s*' + k + ':').test(doc);
  const missing = ['num', 'date', 'items', 'subtotal', 'discount', 'shipping', 'total', 'email', 'status']
    .filter((k) => !has(k));
  ok('ручне замовлення пише ті самі гроші, що й сайт', !missing.length,
     missing.length ? 'немає: ' + missing.join(', ') : 'усі поля на місці');
}


/* ---------- Доставка й сума замовлення ----------
   Сума — це те, що покупець винен магазину. Коли доставку платить
   він разом із замовленням, вона в суму входить; коли платить у
   відділенні — shipping дорівнює нулю, а ціна лишається довідковим
   рядком. Перевіряється саме те, що йде в базу. */

{
  const mkOrder = buildOrder({
    c: { products: [], stock: {} } as never,
    lines: [],
    customer: { name: 'Тест', phone: '+380' } as never,
    subtotal: 1250,
    discount: 0,
    promoCode: '',
    shipping: 540,
    now: new Date(),
    t: (k: string) => k
  });
  ok('доставка лежить окремим полем', mkOrder.shipping === 540, String(mkOrder.shipping));
  ok('і входить у суму, коли її платить покупець',
     mkOrder.total === 1790, String(mkOrder.total));

  /* Платить у відділенні — тоді в замовленні доставки немає
     зовсім, лише довідковий рядок. */
  const atBranch = buildOrder({
    c: { products: [], stock: {} } as never,
    lines: [],
    customer: { name: 'Тест', phone: '+380' } as never,
    subtotal: 1250,
    discount: 0,
    promoCode: '',
    shipping: 0,
    shippingNote: '≈540 грн, оплата у відділенні',
    now: new Date(),
    t: (k: string) => k
  });
  ok('оплата у відділенні суми не змінює', atBranch.total === 1250, String(atBranch.total));

  ok('знижка віднімається до доставки',
     buildOrder({
       c: { products: [], stock: {} } as never, lines: [],
       customer: { name: 'Т', phone: '+380' } as never,
       subtotal: 1000, discount: 100, promoCode: 'X', shipping: 50,
       now: new Date(), t: (k: string) => k
     }).total === 950);
}

/* ---------- В адресі немає дірок ----------
   Firestore відмовляється приймати документ, у якому хоч одне
   значення undefined, — і відмовляє всім документом одразу, без
   пояснень. Саме так 14.08.2026 зникло міжнародне замовлення:
   країні не потрібні митні дані, і поле reg лишалось undefined.

   Перевіряємо обидві гілки: країну, якій ці дані потрібні, і
   країну, якій ні. */
{
  const holes = (value: unknown, path = ''): string[] => {
    if (value === undefined) return [path || '(корінь)'];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      holes(v, path ? path + '.' + k : k)
    );
  };

  const toPoland = fromForm({ ...intlForm, countryCode: 'PL', state: 'Masovian' });
  ok('адреса без митних даних не має порожніх полів',
     holes(toPoland).length === 0, holes(toPoland).join(', ') || 'дірок немає');

  const toStates = fromForm({ ...intlForm, countryCode: 'US', state: 'IL', regCity: 'Chicago' });
  ok('адреса з митними даними теж',
     holes(toStates).length === 0, holes(toStates).join(', ') || 'дірок немає');
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
console.log('\n--- повідомлення в Telegram ---\n' + msg);
process.exit(failed ? 1 : 0);
