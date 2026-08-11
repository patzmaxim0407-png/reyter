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

console.log(провалів ? '\n✗ невдач: ' + провалів : '\n✓ усе зійшлося');
process.exit(провалів ? 1 : 0);
