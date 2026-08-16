/* Перевірка випуску: розподіл витрат і відбиття.

   Помилка тут ставить ціну на весь сезон, тож перевіряються саме
   ті місця, де можна збрехати непомітно: спільні витрати між
   товарами різного тиражу, прямі витрати «за штуку», залишок від
   округлення й привʼязка продажів до партії.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/release-check.ts
*/
import {
  planOf,
  paybackOf,
  restocksFrom,
  totalUnits,
  unitsOf,
  type Release
} from '../lib/admin/release.ts';
import type { AdminOrder } from '../lib/admin/orders.ts';
import type { Catalogue } from '../lib/catalog.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const base: Release = {
  _id: 'R1',
  title: 'Осінь',
  at: '2026-08-01',
  split: 'units',
  items: [
    { productId: 'A', qty: 120 },
    { productId: 'B', qty: 80 },
    { productId: 'C', qty: 40 }
  ],
  lines: [
    { id: 'fa', title: 'Тканина А', sum: 24000, perUnit: false, for: 'A' },
    { id: 'fb', title: 'Тканина Б', sum: 16000, perUnit: false, for: 'B' },
    { id: 'fc', title: 'Тканина С', sum: 20000, perUnit: false, for: 'C' },
    { id: 'sh', title: 'Зйомка', sum: 12000, perUnit: false },
    { id: 'ad', title: 'Реклама', sum: 9000, perUnit: false, apart: true }
  ]
};

console.log('\nКІЛЬКОСТІ');
ok('одиниці рахуються з розмірів', unitsOf({ productId: 'X', sizes: { S: 3, M: 5 } }) === 8);
ok('або числом, коли сітки немає', unitsOf({ productId: 'X', qty: 7 }) === 7);
ok('разом по випуску', totalUnits(base.items) === 240, String(totalUnits(base.items)));

console.log('\nРОЗПОДІЛ ЗА ШТУКАМИ');
{
  const p = planOf(base);
  const a = p.shares.find((x) => x.productId === 'A')!;
  const cc = p.shares.find((x) => x.productId === 'C')!;

  // 12000 × 120/240 = 6000
  ok('спільне ділиться за тиражем', a.shared === 6000, String(a.shared));
  ok('пряме лягає на свій товар', a.direct === 24000, String(a.direct));
  ok('собівартість А', a.unit === Math.round(30000 / 120), String(a.unit));
  ok('малий тираж бере менше зйомки', cc.shared === 2000, String(cc.shared));

  /* Найважливіше: після округлень сума часток мусить дорівнювати
     тому, що витратили. Інакше випуск «не відбивається» на кілька
     гривень вічно. */
  const sum = p.shares.reduce((n, s) => n + s.goods, 0) + p.shares.reduce((n, s) => n + s.apart, 0);
  ok('ніщо не загубилось при діленні', sum === p.spend.total, sum + ' проти ' + p.spend.total);
  ok('реклама не в собівартості', p.shares.every((s) => s.apart > 0) && a.unit === 250);
}

console.log('\nРОЗПОДІЛ ЗА МОДЕЛЯМИ');
{
  const p = planOf({ ...base, split: 'models' });
  const a = p.shares.find((x) => x.productId === 'A')!;
  const cc = p.shares.find((x) => x.productId === 'C')!;
  ok('зйомка ділиться на позиції', a.shared === 4000 && cc.shared === 4000, a.shared + '/' + cc.shared);
  /* Саме тут річ малого тиражу й дорожчає — і це має бути видно
     числом, а не здогадкою. */
  ok('малий тираж стає дорожчим', cc.unit > a.unit, cc.unit + ' проти ' + a.unit);
  const sum = p.shares.reduce((n, s) => n + s.goods + s.apart, 0);
  ok('і тут нічого не загубилось', sum === p.spend.total, String(sum));
}

console.log('\nПРЯМА ВИТРАТА ЗА ШТУКУ');
{
  /* Пакування «за штуку», привʼязане до товару, мусить рахуватись
     від штук САМЕ ЦЬОГО товару, а не всього випуску. */
  const p = planOf({
    ...base,
    lines: [{ id: 'pk', title: 'Пакування А', sum: 10, perUnit: true, for: 'A' }]
  });
  const a = p.shares.find((x) => x.productId === 'A')!;
  const b = p.shares.find((x) => x.productId === 'B')!;
  ok('за штуку — від свого тиражу', a.direct === 1200, String(a.direct));
  ok('сусідній товар цього не платить', b.goods === 0, String(b.goods));
}

console.log('\nПРИХОДИ');
{
  const p = planOf(base);
  const drafts = restocksFrom(base, p);
  ok('прихід на кожен товар', drafts.length === 3, String(drafts.length));
  ok('із порахованою собівартістю', drafts[0].cost === 250, String(drafts[0].cost));
  ok('і з кількістю', drafts[0].qty === 120, String(drafts[0].qty));

  const sized = restocksFrom(
    { ...base, items: [{ productId: 'A', sizes: { S: 5, M: 7 } }] },
    planOf({ ...base, items: [{ productId: 'A', sizes: { S: 5, M: 7 } }] })
  );
  ok('розміри переносяться як є', JSON.stringify(sized[0].sizes) === '{"S":5,"M":7}');
}

console.log('\nВІДБИТТЯ');
{
  const c = {
    products: [
      { id: 'A', name: 'A', price: 900, category: 'x' },
      { id: 'B', name: 'B', price: 700, category: 'x' },
      { id: 'C', name: 'C', price: 1500, category: 'x' }
    ],
    stock: {},
    categories: [{ id: 'x', title: 'X' }]
  } as unknown as Catalogue;

  const p = planOf(base);
  const mk = (costs: Record<string, number>, qty: number): AdminOrder =>
    ({
      _id: 'o' + Math.random(), num: 'R', status: 'done', date: '2026-08-10T10:00:00Z',
      discount: 0, costs,
      items: [{ id: 'A', name: 'A', qty, price: 900, size: 'M' }]
    }) as never;

  const now = new Date('2026-08-31');
  const mine = mk({ A: 250 }, 2);
  const other = mk({ A: 190 }, 5); // стара партія — не наша

  const back = paybackOf(base, p, [mine, other], c, now);
  ok('рахуються лише одиниці цієї партії', back.sold === 2, String(back.sold));
  ok('і саме їхня виручка', back.back === 1800, String(back.back));
  ok('вкладене — разом із рекламою', back.spent === 81000, String(back.spent));

  /* Продане ДО випуску до нього не належить: партії тоді ще не
     існувало. */
  const early = { ...mk({ A: 250 }, 3), date: '2026-07-01T10:00:00Z' } as AdminOrder;
  ok('до дати випуску не рахуємо', paybackOf(base, p, [early], c, now).sold === 0);
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
