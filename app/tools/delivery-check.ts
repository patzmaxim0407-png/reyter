/* ============================================================
   Перевірка розрахунку доставки
   ------------------------------------------------------------
   Тут ходимо в живі API обох перевізників — інакше сенсу немає:
   помилка в назві параметра чи в одиницях виміру не видно на
   вигляд, вона видно лише сумою, яка не збігається з касою.

   Опорні числа заміряні вручну 11.08.2026 і звірені з
   опублікованими прайсами:
     Київ → Львів, 0,5 кг, оголошена 500     — 90 грн
     Київ → Варшава, коробка 20×30×10        — 540 грн
     Київ → Берлін, та сама коробка          — 860 грн

   Якщо перевізник змінить тарифи, ці числа поїдуть — і це не
   поламка, а новина. Тому перевіряємо не рівність копійка в
   копійку, а що число живе, додатне й у межах здорового глузду.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/delivery-check.ts
   ============================================================ */

import { freeLeft, freeReached, quote, underwearSum } from '../lib/delivery.ts';
import type { CartLine } from '../lib/types.ts';
import type { Catalogue } from '../lib/catalog.ts';

let провалів = 0;
const ok = (умова: boolean, назва: string, як?: string) => {
  if (!умова) провалів += 1;
  console.log((умова ? '✓' : '✗') + ' ' + назва + (як ? ' — ' + як : ''));
};

/* ---------- Поріг безкоштовної ---------- */

const каталог = (...ціни: { price: number; category: string; qty: number }[]) => {
  const c = {
    products: ціни.map((x, i) => ({
      id: 'p' + i,
      name: 'товар',
      price: x.price,
      category: x.category,
      images: [],
      sizes: ['M']
    })),
    stock: {}
  } as unknown as Catalogue;
  const lines = ціни.map((x, i) => ({ id: 'p' + i, size: 'M', qty: x.qty })) as CartLine[];
  return { c, lines };
};

const біле = каталог({ price: 800, category: 'briefs', qty: 2 });
const сумаБілого = underwearSum(біле.c, біле.lines);
ok(сумаБілого === 1600, 'білизна рахується', String(сумаБілого));
ok(freeReached(сумаБілого), 'від 1500 грн білизни — безкоштовно');

const плавки = каталог({ price: 880, category: 'swim', qty: 2 });
ok(
  underwearSum(плавки.c, плавки.lines) === 1760,
  'плавки зараховуються в поріг',
  String(underwearSum(плавки.c, плавки.lines))
);
ok(freeReached(underwearSum(плавки.c, плавки.lines)), 'і дають безкоштовну доставку');

const змішане = каталог(
  { price: 800, category: 'briefs', qty: 1 },
  { price: 2000, category: 'home-collection', qty: 1 }
);
const сумаЗмішаного = underwearSum(змішане.c, змішане.lines);
ok(сумаЗмішаного === 800, 'домашній одяг у поріг не зараховується', String(сумаЗмішаного));
ok(!freeReached(сумаЗмішаного), 'і поріг не спрацьовує при дорогому кошику');
ok(freeLeft(сумаЗмішаного) === 700, 'скільки лишилось добрати', String(freeLeft(сумаЗмішаного)));

/* ---------- Нова Пошта ---------- */


const ЛЬВІВ = 'db5c88f5-391c-11dd-90d9-001a92567626';

const np = await quote({ carrier: 'np', cityRef: ЛЬВІВ, declared: 500 });
ok(!np.unknown && np.cost > 0, 'Нова Пошта відповіла ціною', JSON.stringify(np));
ok(!np.estimate, 'і це жива ціна, а не таблиця');
ok(np.cost >= 60 && np.cost <= 200, 'ціна в межах здорового глузду', np.cost + ' грн');

const поштомат = await quote({ carrier: 'np', cityRef: ЛЬВІВ, postomat: true, declared: 500 });
ok(поштомат.cost > 0, 'для поштомата теж рахується', поштомат.cost + ' грн');

const дороге = await quote({ carrier: 'np', cityRef: ЛЬВІВ, declared: 3000 });
ok(дороге.cost > np.cost, 'дорожча оголошена вартість дорожча в доставці',
   `500 грн → ${np.cost}, 3000 грн → ${дороге.cost}`);

const безМіста = await quote({ carrier: 'np', declared: 500 });
ok(безМіста.unknown, 'без міста нічого не вигадуємо');

const безкоштовно = await quote({ carrier: 'np', cityRef: ЛЬВІВ, declared: 1600, free: true });
ok(безкоштовно.free && безкоштовно.cost === 0, 'поріг перебиває розрахунок');

/* ---------- Міжнародна ---------- */

for (const [країна, місто, стеля] of [
  ['PL', 'Warsaw', 1200],
  ['DE', 'Berlin', 1600]
] as const) {
  const q = await quote({ carrier: 'intl', country: країна, city: місто, declared: 2000 });
  ok(!q.unknown && q.cost > 0, `Nova Post порахувала ${місто}`, JSON.stringify(q));
  ok(!q.estimate, `і для ${місто} це жива ціна`);
  ok(q.cost > 300 && q.cost < стеля, `ціна на ${місто} в межах глузду`, q.cost + ' грн');
}

/* Кирилиця в довіднику перевізника не шукається — і тоді ми маємо
   не мовчати, а показати нижню межу з приміткою «орієнтовно». */
const кирилицею = await quote({ carrier: 'intl', country: 'PL', city: 'Варшава', declared: 2000 });
ok(кирилицею.cost > 0, 'місто кирилицею не лишає покупця без числа', JSON.stringify(кирилицею));
ok(!кирилицею.unknown, 'і його не лишає без відповіді', JSON.stringify(кирилицею));

const безКраїни = await quote({ carrier: 'intl', declared: 2000 });
ok(безКраїни.unknown, 'без країни нічого не вигадуємо');

const порігНеДіє = await quote({ carrier: 'intl', country: 'PL', city: 'Warsaw', declared: 2000, free: true });
ok(!порігНеДіє.free && порігНеДіє.cost > 0, 'безкоштовна доставка за кордон не поширюється');


/* ---------- Довідники Nova Post для міжнародної ---------- */

import { branchAvailable, intlDivisions, intlSettlements, isLatin, regRequired, stateRequired } from '../lib/address.ts';

const міста = await intlSettlements('PL', 'Warsaw');
ok(міста.length > 0, 'довідник міст відповідає', міста[0]?.label);

const пункти = міста[0] ? await intlDivisions('PL', міста[0].id) : [];
ok(пункти.length > 0, 'у Варшаві є пункти Nova Post', 'знайдено ' + пункти.length);
/* Найпідступніша помилка тут — фільтр міста, який довідник тихо
   ігнорує: відповідь виглядає правильною, просто пункти чужі. */
const чужі = міста[0] ? await intlDivisions('PL', String(Number(міста[0].id) + 100000)) : [];
ok(
  пункти.map((x) => x.id).join() !== чужі.map((x) => x.id).join(),
  'пункти справді фільтруються за містом',
  'Варшава ' + (пункти[0]?.label || '') + ' проти ' + (чужі[0]?.label || 'порожньо')
);
ok(
  пункти.some((x) => x.type === 'Postomat' || x.type === 'PUDO' || x.type === 'PostBranch'),
  'пункти мають зрозумілий тип',
  [...new Set(пункти.map((x) => x.type))].join(', ')
);

/* Пошук у полі відділення має справді звужувати список, а не
   вдавати: довідник параметр search ігнорує. */
const заНомером = міста[0] ? await intlDivisions('PL', міста[0].id, '04/2') : [];
ok(заНомером.length > 0 && заНомером.length < пункти.length,
   'пошук за номером звужує список', 'знайдено ' + заНомером.length);
/* Беремо вулицю з тих пунктів, що вже приїхали: шукати те, чого
   у вікні немає, — перевіряти не пошук, а щасливий випадок. */
const вулиця = (пункти[0]?.label.split(': ')[1] || '').split(' ')[0];
const заВулицею = міста[0] && вулиця ? await intlDivisions('PL', міста[0].id, вулиця) : [];
ok(
  заВулицею.length > 0 && заВулицею.every((x) => x.label.toLowerCase().includes(вулиця.toLowerCase())),
  'пошук за вулицею відсіює зайве',
  '«' + вулиця + '» → ' + заВулицею.length + ' із ' + пункти.length
);

ok(branchAvailable('PL') && branchAvailable('DE'), 'у Польщі й Німеччині є куди приїхати');
ok(!branchAvailable('JP') && !branchAvailable('AU'), 'у Японії й Австралії — лише курʼєр');
ok(stateRequired('US') && stateRequired('IE') && stateRequired('CA'), 'штат питаємо там, де його вимагають');
ok(!stateRequired('AU'), 'і не питаємо там, де не вимагають');
ok(regRequired('DE') && regRequired('SK') && regRequired('HU') && regRequired('FR'),
   'адресу реєстрації питаємо для DE, SK, HU, FR');
ok(!regRequired('PL'), 'і не питаємо для Польщі');
ok(isLatin('Marszalkowska 12') && !isLatin('Маршалковська'), 'кирилицю в адресі впізнаємо');

/* Перевірка форми: у відділення без вибору зі списку не пускаємо */
import { EMPTY_FORM, checkAddress } from '../lib/address.ts';

const набрав = { ...EMPTY_FORM, carrier: 'intl' as const, countryCode: 'PL', intlCity: 'Warsaw', intlBranch: 'Mars' };
ok(checkAddress(набрав)?.key === 'addr.pickFromList', 'набране руками місто не приймається',
   JSON.stringify(checkAddress(набрав)));
const обрав = { ...набрав, intlCityId: '22326', intlBranchId: '7', intlBranch: '№04/2' };
ok(checkAddress(обрав) === null, 'обране зі списку приймається');

const адресою0 = { ...EMPTY_FORM, carrier: 'intl' as const, countryCode: 'US', intlMode: 'address' as const,
  intlCity: 'Chicago', street: 'Main', building: '12', zip: '60601' };
ok(checkAddress(адресою0)?.field === 'state', 'у США без штату не пускаємо');
ok(checkAddress({ ...адресою0, state: 'IL' }) === null, 'зі штатом — усе гаразд');

const німеччина = { ...EMPTY_FORM, carrier: 'intl' as const, countryCode: 'DE', intlMode: 'address' as const,
  intlCity: 'Berlin', street: 'Alexanderplatz', building: '1', zip: '10178' };
ok(checkAddress(німеччина)?.field === 'regCity', 'для Німеччини питаємо адресу реєстрації');

const неЛатиниця = { ...адресою0, state: 'IL', street: 'Головна' };
ok(checkAddress(неЛатиниця)?.key === 'addr.needLatin', 'кирилицю в адресі не пропускаємо');

/* Ціна з довідниковим містом і різними способами отримання */
const відділення = await quote({ carrier: 'intl', country: 'PL', cityId: міста[0]?.id, intlType: 'branch', declared: 2000 });
const адресою = await quote({ carrier: 'intl', country: 'PL', cityId: міста[0]?.id, intlType: 'address', declared: 2000 });
ok(відділення.cost > 0 && !відділення.estimate, 'ціна у відділення', відділення.cost + ' грн');
ok(адресою.cost > 0 && !адресою.estimate, 'ціна курʼєром на адресу', адресою.cost + ' грн');


/* ---------- Митна декларація ---------- */

import { customsBlock, customsItems, parcelWeight } from '../lib/customs.ts';

const мит = каталог(
  { price: 800, category: 'briefs', qty: 2 },
  { price: 600, category: 'tanks', qty: 1 },
  { price: 900, category: 'swim', qty: 1 }
);
const позиції = customsItems(мит.c, мит.lines);
ok(позиції.length === 3, 'позиції декларації розкладені за типами', позиції.map((x) => x.hs).join(', '));
ok(позиції.every((x) => /^\d{8}$/.test(x.hs)), 'коди УКТЗЕД восьмизначні', позиції.map((x) => x.hs).join(', '));
ok(позиції.every((x) => /^[\x20-\x7E]+$/.test(x.en)), 'опис англійською — латиницею', позиції[0]?.en);
ok(
  позиції.reduce((s, x) => s + x.cost, 0) === 800 * 2 + 600 + 900,
  'сума декларації дорівнює сумі кошика',
  String(позиції.reduce((s, x) => s + x.cost, 0))
);
ok(позиції.every((x) => x.weight > 0), 'у кожної позиції є вага', позиції.map((x) => x.weight).join('/'));

const вагаПосилки = parcelWeight(мит.c, мит.lines);
ok(вагаПосилки > 0.3 && вагаПосилки < 2, 'вага посилки в межах глузду', вагаПосилки + ' кг');

const текст = customsBlock(мит.c, мит.lines);
ok(текст.includes('61079100') && текст.includes('Разом'), 'блок для менеджера зібрано');
ok(customsBlock(мит.c, []) === '', 'на порожньому кошику декларації немає');

/* Ціна має рахуватись від справжньої ваги, а не від вигаданої */
const легка = await quote({ carrier: 'intl', country: 'PL', cityId: міста[0]?.id, declared: 2000, weight: 0.3 });
const важка = await quote({ carrier: 'intl', country: 'PL', cityId: міста[0]?.id, declared: 2000, weight: 4 });
ok(важка.cost > легка.cost, 'важча посилка дорожча', `0,3 кг → ${легка.cost}, 4 кг → ${важка.cost}`);

console.log(провалів ? '\n✗ невдач: ' + провалів : '\n✓ усе зійшлося');
process.exit(провалів ? 1 : 0);
