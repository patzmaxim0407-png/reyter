/* Перевірка підрахунків аналітики.

   Звіт, який помилився, гірший за відсутній: за ним закуплять
   товар. Тому тут перевіряються не «типові» випадки, а рівно ті,
   де я міг збрехати сам собі: знижка, розкидана по рядках;
   товари без собівартості; медіана на парній кількості; порожній
   період.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/insights-check.ts
*/
import {
  bcgOf,
  byCategory,
  cityOf,
  grainFor,
  growth,
  keyOfBuyer,
  kpiOf,
  linesOf,
  median,
  previous,
  rangeOf,
  rowsOf,
  seriesOf,
  sliceBy
} from '../lib/admin/insights.ts';
import type { AdminOrder } from '../lib/admin/orders.ts';
import type { Catalogue } from '../lib/catalog.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const c = {
  products: [
    { id: 'A', name: 'Альфа', price: 1000, cost: 400, category: 'briefs' },
    { id: 'B', name: 'Бета', price: 500, cost: 300, category: 'briefs' },
    // собівартості немає навмисно: саме такі й ламали підрахунок
    { id: 'C', name: 'Гама', price: 800, category: 'tanks' }
  ],
  stock: {},
  categories: [
    { id: 'briefs', title: 'Бріфи' },
    { id: 'tanks', title: 'Майки' }
  ]
} as unknown as Catalogue;

const mk = (o: Partial<AdminOrder>): AdminOrder =>
  ({ _id: String(o.num || Math.random()), status: 'done', ...o }) as AdminOrder;

const orders: AdminOrder[] = [
  mk({
    num: 'R-1', date: '2026-08-10T10:00:00Z', status: 'done', discount: 0, total: 1500,
    email: 'petro@ukr.net',
    items: [
      { id: 'A', name: 'Альфа', qty: 1, price: 1000, size: 'M' },
      { id: 'B', name: 'Бета', qty: 1, price: 500, size: 'L' }
    ] as never
  }),
  mk({
    num: 'R-2', date: '2026-08-12T10:00:00Z', status: 'done', discount: 300, total: 1700,
    email: 'PETRO@ukr.net',
    items: [
      { id: 'A', name: 'Альфа', qty: 2, price: 1000, size: 'M' }
    ] as never
  }),
  mk({
    num: 'R-3', date: '2026-08-13T10:00:00Z', status: 'done', discount: 0, total: 800,
    email: 'ivan@ukr.net',
    items: [{ id: 'C', name: 'Гама', qty: 1, price: 800, size: 'S' }] as never
  }),
  // не виконане — у виручку не входить
  mk({
    num: 'R-4', date: '2026-08-13T11:00:00Z', status: 'shipped', discount: 0, total: 5000,
    items: [{ id: 'A', name: 'Альфа', qty: 5, price: 1000, size: 'M' }] as never
  }),
  mk({
    num: 'R-5', date: '2026-08-14T10:00:00Z', status: 'cancelled', total: 900,
    items: [{ id: 'B', name: 'Бета', qty: 1, price: 500, size: 'L' }] as never
  })
];

const from = new Date('2026-08-01T00:00:00Z');
const to = new Date('2026-08-31T23:59:59Z');

/* ---------- Рядки й знижка ---------- */
console.log('\nРЯДКИ');
{
  const byId = new Map(c.products.map((p) => [p.id, p]));
  const lines = linesOf(orders[1], byId as never);
  ok('знижка зменшує рядок', lines[0].paid === 1700, String(lines[0].paid));

  const mixed = linesOf(orders[0], byId as never);
  ok('знижку розкидано пропорційно, без знижки — повна ціна',
     mixed[0].paid === 1000 && mixed[1].paid === 500);
  ok('собівартість береться з каталогу', mixed[0].cost === 400 && mixed[1].cost === 300);
}
{
  /* Товар без собівартості не має вигадувати нуль: нуль означав
     би стовідсоткову маржу, і саме він виглядав би найкращим
     товаром магазину. */
  const byId = new Map(c.products.map((p) => [p.id, p]));
  ok('без собівартості — null, а не нуль', linesOf(orders[2], byId as never)[0].cost === null);
}

/* Заморожена собівартість сильніша за каталог: інакше правка
   ціни закупівлі переписувала б звіти за минулі місяці. */
{
  const byId = new Map(c.products.map((p) => [p.id, p]));
  const frozen = { ...orders[0], costs: { A: 900 } } as AdminOrder;
  const lines = linesOf(frozen, byId as never);
  ok('береться собівартість із замовлення, а не з картки', lines[0].cost === 900, String(lines[0].cost));
  ok('товар без заморозки бере поточну', lines[1].cost === 300, String(lines[1].cost));

  const k = kpiOf([frozen], c, from, to);
  // (1000−900) + (500−300)
  ok('маржа рахується замороженою ціною', k.margin === 300, String(k.margin));
}

/* ---------- Підсумки ---------- */
console.log('\nПІДСУМКИ');
{
  const k = kpiOf(orders, c, from, to);
  // 1500 + 1700 + 800
  ok('виручка тільки з виконаних', k.revenue === 4000, String(k.revenue));
  ok('невиконане не рахується', k.orders === 3, String(k.orders));
  /* Маржа: (1000−400) + (500−300) + (1700 − 2×400) = 600+200+900 */
  ok('маржа лише за товарами з собівартістю', k.margin === 1700, String(k.margin));
  ok('покриття видно окремо', Math.round(k.covered * 100) === 80, String(Math.round(k.covered * 100)));
  ok('середній чек', k.average === Math.round(4000 / 3), String(k.average));
  ok('знижки підсумовано', k.discounts === 300, String(k.discounts));
  ok('скасовані рахуються окремо', k.cancelled === 1 && k.cancelledSum === 900);
  ok('покупці — за поштою, регістр не роздвоює', k.buyers === 2, String(k.buyers));
  ok('повторні покупці видно', k.repeat === 1, String(k.repeat));
}
{
  const empty = kpiOf([], c, from, to);
  ok('порожній період не ділить на нуль', empty.average === 0 && empty.covered === 0);
}

/* ---------- Товари ---------- */
console.log('\nТОВАРИ');
{
  const rows = rowsOf(orders, c, from, to);
  const a = rows.find((r) => r.id === 'A')!;
  ok('товар зібрано з різних замовлень', a.qty === 3 && a.orders === 2, a.qty + '/' + a.orders);
  ok('виручка товару після знижки', a.revenue === 2700, String(a.revenue));
  ok('частки в сумі дають одиницю',
     Math.abs(rows.reduce((s, r) => s + r.share, 0) - 1) < 0.001);

  const cats = byCategory(rows, new Map([['briefs', 'Бріфи'], ['tanks', 'Майки']]));
  ok('категорії названо словами', cats[0].name === 'Бріфи', cats[0].name);
  ok('категорії підсумовано', cats.reduce((s, r) => s + r.revenue, 0) === 4000);
}

/* ---------- Матриця ---------- */
console.log('\nМАТРИЦЯ');
{
  const rows = rowsOf(orders, c, from, to);
  const b = bcgOf(rows);
  ok('вісь — маржа, коли собівартість є', b.axis === 'margin', b.axis);
  ok('усі товари потрапили в чверті',
     Object.values(b.counts).reduce((s, n) => s + n, 0) === b.points.length);
  ok('межі — медіани, а не середні', b.midY === median(rows.map((r) => r.qty)));

  const noCost = bcgOf(rows.map((r) => ({ ...r, cost: null, margin: 0 })));
  ok('без жодної собівартості вісь чесно стає ціною', noCost.axis === 'price');
}
{
  ok('медіана на парній кількості', median([10, 20, 30, 40]) === 25, String(median([10, 20, 30, 40])));
  ok('медіана на непарній', median([5, 1, 9]) === 5, String(median([5, 1, 9])));
  ok('порожній перелік не ламає', median([]) === 0);
}

/* ---------- Час ---------- */
console.log('\nЧАС');
{
  const line = seriesOf(orders, c, new Date('2026-08-10T00:00:00'), new Date('2026-08-13T23:59:59'), 'day');
  ok('порожні дні не пропускаються', line.length === 4, String(line.length));
  ok('день без продажів — нуль, а не діра', line.some((p) => p.revenue === 0));
  ok('сума ряду дорівнює виручці', line.reduce((s, p) => s + p.revenue, 0) === 4000,
     String(line.reduce((s, p) => s + p.revenue, 0)));
}
{
  const now = new Date('2026-08-16T12:00:00');
  const r = rangeOf('7', now);
  ok('тиждень — це сім днів разом із сьогодні',
     Math.round((r.to.getTime() - r.from.getTime()) / 86_400_000) === 7);
  const back = previous('7', now)!;
  ok('попередній період не перетинається з поточним', back.to.getTime() < r.from.getTime());
  ok('для «увесь час» порівнювати нема з чим', previous('all', now) === null);
  ok('зростання рахується у відсотках', growth(150, 100) === 50);
  ok('із нуля зростання не буває', growth(150, 0) === null);
  ok('довгий період міряємо не днями', grainFor('365', orders) === 'month');
}

/* ---------- Розрізи ---------- */
console.log('\nРОЗРІЗИ');
{
  const list = sliceBy(orders, from, to, (o) => String(o.email || ''));
  ok('частки в розрізі дають одиницю',
     Math.abs(list.reduce((s, x) => s + x.share, 0) - 1) < 0.001);
  ok('місто чиститься від «м.»',
     cityOf({ customer: { city: 'м. Львів' } } as never) === 'Львів');
  ok('покупець без пошти впізнається телефоном',
     keyOfBuyer({ customer: { phone: '+38 (097) 111-22-33' } } as never) === '971112233');
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
