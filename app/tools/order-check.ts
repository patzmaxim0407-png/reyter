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
import { freeShipOf, payerOf } from '../lib/admin/orders.ts';
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

/* Безкоштовна доставка й хто платить перевізникові.

   Для покупця це «доставка 0 грн», для магазину — рахунок від
   перевізника. Саме тут і губилось: у замовленні shipping нуль,
   тож накладна за звичкою виписувалась на отримувача, і людина
   платила за те, що їй пообіцяли безкоштовно. */
{
  const mk = (items: object[], shipping = 0) =>
    ({ _id: 'x', num: 'R', total: 0, shipping, items } as never);

  /* У замовленні лежить НАЗВА категорії — «Бріфи», а не «briefs»:
     саме її бачив покупець у листі. Тому поріг рахується не за
     тим, що записано в позиції, а за каталогом: шукаємо товар за
     артикулом і беремо його справжню категорію. Без цього поріг
     не спрацьовував ніколи. */
  const cat = {
    products: [{ id: 'A', name: 'A', price: 900, category: 'briefs' }],
    categories: [{ id: 'briefs', title: 'Бріфи' }, { id: 'home-collection', title: 'Home Collection' }]
  } as never;

  const titled = mk([{ id: 'A', category: 'Бріфи', price: 900, qty: 2 }]);
  ok('категорія береться з каталогу за артикулом', freeShipOf(titled, cat).reached === true);
  /* Товар могли прибрати з каталогу — тоді перекладаємо назву
     назад у код за переліком категорій. */
  const gone = mk([{ id: 'ZZZ', category: 'Бріфи', price: 900, qty: 2 }]);
  ok('зниклий товар упізнається за назвою категорії', freeShipOf(gone, cat).reached === true);
  /* Не набрали порога — доставку платить отримувач у відділенні,
     і картка мусить сказати, скількох гривень забракло: менеджер
     ще на звʼязку з покупцем. */
  const short = freeShipOf(mk([{ id: 'A', category: 'Бріфи', price: 620, qty: 2 }]), cat);
  ok('нижче порога — не безкоштовно', short.reached === false);
  ok('видно, скільки бракує до безкоштовної', short.need === 260 && short.sum === 1240);

  ok('чужа назва порога не набирає',
     freeShipOf(mk([{ id: 'ZZZ', category: 'Home Collection', price: 9000, qty: 1 }]), cat).reached === false);

  const big = mk([{ id: 'A', category: 'briefs', price: 900, qty: 2 }]);
  const small = mk([{ id: 'A', category: 'briefs', price: 550, qty: 1 }]);
  const candles = mk([{ id: 'C', category: 'home-collection', price: 3000, qty: 1 }]);

  ok('поріг рахується сумою білизни', freeShipOf(big).reached === true);
  ok('і не дотягує там, де мало', freeShipOf(small).reached === false);
  ok('видно, скільки не вистачило', freeShipOf(small).need === 950, String(freeShipOf(small).need));
  /* Свічки на три тисячі безкоштовної доставки не дають: поріг
     саме по білизні, і кошик із дифузора його не набирає. */
  ok('інші категорії поріг не набирають', freeShipOf(candles).reached === false);

  ok('оплачене замовлення понад поріг — платимо ми',
     payerOf(big, true) === 'Sender');
  /* Неоплачене — ще ні: обіцянка діє при повній передоплаті. */
  ok('неоплачене — платить отримувач', payerOf(big, false) === 'Recipient');
  ok('нижче порога — теж отримувач', payerOf(small, true) === 'Recipient');
  /* А якщо доставку вже оплатили в замовленні, то платимо ми
     незалежно від суми: ці гроші вже в нас. */
  ok('оплачена доставка в сумі — платимо ми',
     payerOf(mk([{ id: 'A', category: 'briefs', price: 300, qty: 1 }], 137), false) === 'Sender');
}

/* Промокод і програма лояльності.

   Два обмеження, яких раніше не було, і обидва — про гроші.

   Рівні: у четвертого рівня вже свої пʼятнадцять відсотків, і код
   зверху віддає чверть ціни тому, хто й так купує.

   Ліміт на людину: публічний код без загального ліміту вигорає за
   годину, а з лімітом дістається першим десятьом. Обмеження на
   одного покупця лишає код живим для всіх. */
{
  const goods = [{ id: 'A', price: 1000, qty: 1 }];
  const base = { code: 'X', type: 'percent' as const, value: 10, scope: 'all' as const };

  const at = (promo: object, who?: { level?: number; used?: number }) =>
    promoCheck(promo as never, goods as never, null, 'petro@ukr.net', who);

  ok('без обмежень код діє на всіх', at(base).ok && at(base, { level: 4 }).ok);

  const forNew = { ...base, levels: [1, 2] };
  ok('код для перших рівнів діє на другому', at(forNew, { level: 2 }).ok);
  ok('і не діє на четвертому', at(forNew, { level: 4 }).reason === 'wrong_level');
  /* Гість рівня не має. Виключати його разом із четвертим було б
     помилкою: він якраз той, кого код і має привести. */
  ok('гостю код для нових не заборонено', at(forNew, { level: 0 }).ok);

  const members = { ...base, guests: false };
  ok('код лише для учасників гостю не дається',
     at(members, { level: 0 }).reason === 'members_only');
  ok('а учаснику — так', at(members, { level: 1 }).ok);

  const once = { ...base, perUser: 1 };
  ok('перший раз спрацьовує', at(once, { level: 1, used: 0 }).ok);
  ok('другий — уже ні', at(once, { level: 1, used: 1 }).reason === 'used_up');
  /* Різниця з «вичерпано» не косметична: код живий, вичерпала
     його саме ця людина. Сказати «код більше не діє» було б
     неправдою, і покупець переказав би її друзям. */
  ok('це не те саме, що загальне вичерпання',
     at(once, { level: 1, used: 1 }).reason !== 'exhausted');
  ok('і скільки саме дозволено — сказано',
     at(once, { level: 1, used: 1 }).perUser === 1);

  ok('старий код без нових полів працює як працював',
     at({ code: 'OLD', value: 10 }, { level: 3, used: 5 }).ok);
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
