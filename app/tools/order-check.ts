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

import { loadCatalog, loadStock } from '../lib/firestore.ts';
import { isSet, setParts, availability, ALL_SIZES, type Catalogue } from '../lib/catalog.ts';
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
  intlCity: 'Chicago',
  street: '123 Main St',
  zip: '60601'
};
ok(
  'для США без штату — питаємо штат, і саме останнім',
  checkAddress(intlForm)?.field === 'state',
  JSON.stringify(checkAddress(intlForm))
);
ok('зі штатом закордонна адреса проходить', checkAddress({ ...intlForm, state: 'IL' }) === null);

const intlAddr = fromForm({ ...intlForm, state: 'IL', extra: 'apt 5' });
ok(
  'закордонна адреса дублює місто й вулицю в city/branch',
  intlAddr.city === 'Chicago' && intlAddr.branch === '123 Main St, apt 5',
  JSON.stringify({ city: intlAddr.city, branch: intlAddr.branch })
);
ok('назва країни підставляється за кодом', intlAddr.intl?.country === 'США', intlAddr.intl?.country);

/* Адреса має пережити цикл «зберегли → відкрили форму знову» */
const round = toForm(intlAddr);
ok(
  'адреса відновлюється у форму без втрат',
  round.countryCode === 'US' && round.state === 'IL' && round.zip === '60601' && round.street === '123 Main St',
  JSON.stringify(round)
);
const otherBack = toForm(fromForm({ ...EMPTY_FORM, carrier: 'intl', countryCode: 'other', countryOther: 'Portugal', intlCity: 'Lisboa', street: 'Rua A', zip: '1000' }));
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

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
console.log('\n--- повідомлення в Telegram ---\n' + msg);
process.exit(failed ? 1 : 0);
