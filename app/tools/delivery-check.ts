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

let failed = 0;
const ok = (cond: boolean, title: string, mode?: string) => {
  if (!cond) failed += 1;
  console.log((cond ? '✓' : '✗') + ' ' + title + (mode ? ' — ' + mode : ''));
};

/* ---------- Поріг безкоштовної ---------- */

const makeCatalog = (...prices: { price: number; category: string; qty: number }[]) => {
  const c = {
    products: prices.map((x, i) => ({
      id: 'p' + i,
      name: 'товар',
      price: x.price,
      category: x.category,
      images: [],
      sizes: ['M']
    })),
    stock: {}
  } as unknown as Catalogue;
  const lines = prices.map((x, i) => ({ id: 'p' + i, size: 'M', qty: x.qty })) as CartLine[];
  return { c, lines };
};

const white = makeCatalog({ price: 800, category: 'briefs', qty: 2 });
const sumWhite = underwearSum(white.c, white.lines);
ok(sumWhite === 1600, 'білизна рахується', String(sumWhite));
ok(freeReached(sumWhite), 'від 1500 грн білизни — безкоштовно');

const swim = makeCatalog({ price: 880, category: 'swim', qty: 2 });
ok(
  underwearSum(swim.c, swim.lines) === 1760,
  'плавки зараховуються в поріг',
  String(underwearSum(swim.c, swim.lines))
);
ok(freeReached(underwearSum(swim.c, swim.lines)), 'і дають безкоштовну доставку');

const mixed = makeCatalog(
  { price: 800, category: 'briefs', qty: 1 },
  { price: 2000, category: 'home-collection', qty: 1 }
);
const sumMixed = underwearSum(mixed.c, mixed.lines);
ok(sumMixed === 800, 'домашній одяг у поріг не зараховується', String(sumMixed));
ok(!freeReached(sumMixed), 'і поріг не спрацьовує при дорогому кошику');
ok(freeLeft(sumMixed) === 700, 'скільки лишилось добрати', String(freeLeft(sumMixed)));

/* ---------- Нова Пошта ---------- */


const LVIV = 'db5c88f5-391c-11dd-90d9-001a92567626';

const np = await quote({ carrier: 'np', cityRef: LVIV, declared: 500 });
ok(!np.unknown && np.cost > 0, 'Нова Пошта відповіла ціною', JSON.stringify(np));
ok(!np.estimate, 'і це жива ціна, а не таблиця');
ok(np.cost >= 60 && np.cost <= 200, 'ціна в межах здорового глузду', np.cost + ' грн');

const postomat = await quote({ carrier: 'np', cityRef: LVIV, postomat: true, declared: 500 });
ok(postomat.cost > 0, 'для поштомата теж рахується', postomat.cost + ' грн');

const pricey = await quote({ carrier: 'np', cityRef: LVIV, declared: 3000 });
ok(pricey.cost > np.cost, 'дорожча оголошена вартість дорожча в доставці',
   `500 грн → ${np.cost}, 3000 грн → ${pricey.cost}`);

const noCity = await quote({ carrier: 'np', declared: 500 });
ok(noCity.unknown, 'без міста нічого не вигадуємо');

const freeCase = await quote({ carrier: 'np', cityRef: LVIV, declared: 1600, free: true });
ok(freeCase.free && freeCase.cost === 0, 'поріг перебиває розрахунок');

/* ---------- Міжнародна ---------- */

for (const [country, city, cap] of [
  ['PL', 'Warsaw', 1200],
  ['DE', 'Berlin', 1600]
] as const) {
  const q = await quote({ carrier: 'intl', country: country, city: city, declared: 2000 });
  ok(!q.unknown && q.cost > 0, `Nova Post порахувала ${city}`, JSON.stringify(q));
  ok(!q.estimate, `і для ${city} це жива ціна`);
  ok(q.cost > 300 && q.cost < cap, `ціна на ${city} в межах глузду`, q.cost + ' грн');
}

/* Кирилиця в довіднику перевізника не шукається — і тоді ми маємо
   не мовчати, а показати нижню межу з приміткою «орієнтовно». */
const inCyrillic = await quote({ carrier: 'intl', country: 'PL', city: 'Варшава', declared: 2000 });
ok(inCyrillic.cost > 0, 'місто кирилицею не лишає покупця без числа', JSON.stringify(inCyrillic));
ok(!inCyrillic.unknown, 'і його не лишає без відповіді', JSON.stringify(inCyrillic));

const noCountry = await quote({ carrier: 'intl', declared: 2000 });
ok(noCountry.unknown, 'без країни нічого не вигадуємо');

const noFreeIntl = await quote({ carrier: 'intl', country: 'PL', city: 'Warsaw', declared: 2000, free: true });
ok(!noFreeIntl.free && noFreeIntl.cost > 0, 'безкоштовна доставка за кордон не поширюється');


/* ---------- Довідники Nova Post для міжнародної ---------- */

import { branchAvailable, intlDivisions, intlSettlements, isLatin, regRequired, stateRequired } from '../lib/address.ts';

const cities = await intlSettlements('PL', 'Warsaw');
ok(cities.length > 0, 'довідник міст відповідає', cities[0]?.label);

const points = cities[0] ? await intlDivisions('PL', cities[0].id) : [];
ok(points.length > 0, 'у Варшаві є пункти Nova Post', 'знайдено ' + points.length);
/* Найпідступніша помилка тут — фільтр міста, який довідник тихо
   ігнорує: відповідь виглядає правильною, просто пункти чужі. */
const foreign = cities[0] ? await intlDivisions('PL', String(Number(cities[0].id) + 100000)) : [];
ok(
  points.map((x) => x.id).join() !== foreign.map((x) => x.id).join(),
  'пункти справді фільтруються за містом',
  'Варшава ' + (points[0]?.label || '') + ' проти ' + (foreign[0]?.label || 'порожньо')
);
ok(
  points.some((x) => x.type === 'Postomat' || x.type === 'PUDO' || x.type === 'PostBranch'),
  'пункти мають зрозумілий тип',
  [...new Set(points.map((x) => x.type))].join(', ')
);

/* Пошук у полі відділення має справді звужувати список, а не
   вдавати: довідник параметр search ігнорує. */
const byNumber = cities[0] ? await intlDivisions('PL', cities[0].id, '04/2') : [];
ok(byNumber.length > 0 && byNumber.length < points.length,
   'пошук за номером звужує список', 'знайдено ' + byNumber.length);
/* Беремо вулицю з тих пунктів, що вже приїхали: шукати те, чого
   у вікні немає, — перевіряти не пошук, а щасливий випадок. */
const streetLine = (points[0]?.label.split(': ')[1] || '').split(' ')[0];
const byStreet = cities[0] && streetLine ? await intlDivisions('PL', cities[0].id, streetLine) : [];
ok(
  byStreet.length > 0 && byStreet.every((x) => x.label.toLowerCase().includes(streetLine.toLowerCase())),
  'пошук за вулицею відсіює зайве',
  '«' + streetLine + '» → ' + byStreet.length + ' із ' + points.length
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

const typedIn = { ...EMPTY_FORM, carrier: 'intl' as const, countryCode: 'PL', intlCity: 'Warsaw', intlBranch: 'Mars' };
ok(checkAddress(typedIn)?.key === 'addr.pickFromList', 'набране руками місто не приймається',
   JSON.stringify(checkAddress(typedIn)));
const picked = { ...typedIn, intlCityId: '22326', intlBranchId: '7', intlBranch: '№04/2' };
ok(checkAddress(picked) === null, 'обране зі списку приймається');

const byAddress0 = { ...EMPTY_FORM, carrier: 'intl' as const, countryCode: 'US', intlMode: 'address' as const,
  intlCity: 'Chicago', street: 'Main', building: '12', zip: '60601' };
ok(checkAddress(byAddress0)?.field === 'state', 'у США без штату не пускаємо');
ok(checkAddress({ ...byAddress0, state: 'IL' }) === null, 'зі штатом — усе гаразд');

const germany = { ...EMPTY_FORM, carrier: 'intl' as const, countryCode: 'DE', intlMode: 'address' as const,
  intlCity: 'Berlin', street: 'Alexanderplatz', building: '1', zip: '10178' };
ok(checkAddress(germany)?.field === 'regCity', 'для Німеччини питаємо адресу реєстрації');

const notLatin = { ...byAddress0, state: 'IL', street: 'Головна' };
ok(checkAddress(notLatin)?.key === 'addr.needLatin', 'кирилицю в адресі не пропускаємо');

/* Ціна з довідниковим містом і різними способами отримання */
const toBranch = await quote({ carrier: 'intl', country: 'PL', cityId: cities[0]?.id, intlType: 'branch', declared: 2000 });
const byAddress = await quote({ carrier: 'intl', country: 'PL', cityId: cities[0]?.id, intlType: 'address', declared: 2000 });
ok(toBranch.cost > 0 && !toBranch.estimate, 'ціна у відділення', toBranch.cost + ' грн');
ok(byAddress.cost > 0 && !byAddress.estimate, 'ціна курʼєром на адресу', byAddress.cost + ' грн');


/* ---------- Митна декларація ---------- */

import { customsBlock, customsItems, parcelWeight } from '../lib/customs.ts';

const customsCart = makeCatalog(
  { price: 800, category: 'briefs', qty: 2 },
  { price: 600, category: 'tanks', qty: 1 },
  { price: 900, category: 'swim', qty: 1 }
);
const items = customsItems(customsCart.c, customsCart.lines);
ok(items.length === 3, 'позиції декларації розкладені за типами', items.map((x) => x.hs).join(', '));
ok(items.every((x) => /^\d{8}$/.test(x.hs)), 'коди УКТЗЕД восьмизначні', items.map((x) => x.hs).join(', '));
ok(items.every((x) => /^[\x20-\x7E]+$/.test(x.en)), 'опис англійською — латиницею', items[0]?.en);
ok(
  items.reduce((s, x) => s + x.cost, 0) === 800 * 2 + 600 + 900,
  'сума декларації дорівнює сумі кошика',
  String(items.reduce((s, x) => s + x.cost, 0))
);
ok(items.every((x) => x.weight > 0), 'у кожної позиції є вага', items.map((x) => x.weight).join('/'));

const parcelKg = parcelWeight(customsCart.c, customsCart.lines);
ok(parcelKg > 0.3 && parcelKg < 2, 'вага посилки в межах глузду', parcelKg + ' кг');

const text = customsBlock(customsCart.c, customsCart.lines);
ok(text.includes('61079100') && text.includes('Разом'), 'блок для менеджера зібрано');
ok(customsBlock(customsCart.c, []) === '', 'на порожньому кошику декларації немає');

/* Ціна має рахуватись від справжньої ваги, а не від вигаданої */
const light = await quote({ carrier: 'intl', country: 'PL', cityId: cities[0]?.id, declared: 2000, weight: 0.3 });
const heavy = await quote({ carrier: 'intl', country: 'PL', cityId: cities[0]?.id, declared: 2000, weight: 4 });
ok(heavy.cost > light.cost, 'важча посилка дорожча', `0,3 кг → ${light.cost}, 4 кг → ${heavy.cost}`);

console.log(failed ? '\n✗ невдач: ' + failed : '\n✓ усе зійшлося');
process.exit(failed ? 1 : 0);
