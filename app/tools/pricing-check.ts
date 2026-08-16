/* Перевірка калькулятора випуску.

   Помилка тут дорожча за будь-яку іншу в проєкті: за цим числом
   ставлять ціну на сезон. Тому перевіряються саме ті місця, де я
   міг збрехати сам собі — «за партію» проти «за штуку», реклама
   поза собівартістю, округлення до власного прайсу й межа, нижче
   якої випуск не відбивається.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/pricing-check.ts
*/
import {
  BANK_FEE,
  adviseOf,
  breakEven,
  ladderOf,
  leakOf,
  median,
  priceForEarn,
  shopMargin,
  spendOf,
  splitPrice,
  toLadder,
  type CostLine,
  type Leak
} from '../lib/admin/pricing.ts';
import type { AdminOrder } from '../lib/admin/orders.ts';
import type { Catalogue } from '../lib/catalog.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

/* ---------- Собівартість ---------- */
console.log('\nСОБІВАРТІСТЬ');
{
  const lines: CostLine[] = [
    { id: 'f', title: 'Тканина', sum: 18400, perUnit: false },
    { id: 's', title: 'Пошив', sum: 26000, perUnit: false },
    { id: 'p', title: 'Пакування', sum: 18, perUnit: true },
    { id: 'a', title: 'Реклама', sum: 9000, perUnit: false, apart: true }
  ];
  const s = spendOf(lines, 200);

  // 18400 + 26000 + 18×200 = 48 000
  ok('за партію й за штуку рахуються по-різному', s.goods === 48000, String(s.goods));
  ok('собівартість одиниці', s.unit === 240, String(s.unit));

  /* Реклама не в товарі — вона в місяці. Поклавши її в
     собівартість, магазин зробив би річ дорожчою назавжди через
     один невдалий таргет. */
  ok('реклама не входить у собівартість', s.apart === 9000 && s.unit === 240);
  ok('але вкладене рахується разом', s.total === 57000, String(s.total));

  ok('нуль одиниць не ділить на нуль', spendOf(lines, 0).unit === 0);
}

/* ---------- Що відкушують від ціни ---------- */
console.log('\nВІДКУСИЛИ');
{
  const leak: Leak = { discount: 0.07, fee: BANK_FEE, total: 0.07 + BANK_FEE, sample: 40 };
  const split = splitPrice(890, 240, leak);

  ok('знижка рахується від ціни', split.discount === 62, String(split.discount));
  /* Комісія — від того, що лишилось після знижки: банк бере
     відсоток із суми, яку справді провели. */
  ok('комісія — від суми після знижки', split.fee === Math.round((890 - 62) * BANK_FEE), String(split.fee));
  ok('дійшло до магазину', split.net === 890 - split.discount - split.fee, String(split.net));
  ok('заробіток — це те, що лишилось після собівартості',
     split.earn === split.net - 240, String(split.earn));
  ok('маржинальність від ціни', Math.round(split.margin * 100) === Math.round((split.earn / 890) * 100));

  /* Ціна нижче собівартості — це збиток, і він мусить бути видним
     мінусом, а не нулем. */
  const bad = splitPrice(200, 240, leak);
  ok('збиток показується мінусом', bad.earn < 0, String(bad.earn));
}

/* ---------- Коли відіб'ється ---------- */
console.log('\nВІДБИТИ');
{
  const leak: Leak = { discount: 0.1, fee: 0, total: 0.1, sample: 30 };
  const spend = spendOf(
    [{ id: 'a', title: 'усе', sum: 48000, perUnit: false }, { id: 'b', title: 'реклама', sum: 9000, perUnit: false, apart: true }],
    200
  );
  // з ціни 900 доходить 810; 57 000 ÷ 810 = 70.4 → 71
  ok('рахуємо від того, що доходить, а не від ціни',
     breakEven(900, spend, leak) === 71, String(breakEven(900, spend, leak)));
  ok('реклама теж має відбитись', breakEven(900, spend, leak) > Math.ceil(48000 / 810));
}

/* ---------- Зворотний хід ---------- */
console.log('\nНАВПАКИ');
{
  const leak: Leak = { discount: 0.1, fee: 0, total: 0.1, sample: 30 };
  const price = priceForEarn(500, 240, leak);
  const back = splitPrice(price, 240, leak);
  ok('ціна від бажаного заробітку', back.earn >= 500, `${price} → ${back.earn}`);
  ok('і не завищена більше ніж на копійки', back.earn <= 502, String(back.earn));
}

/* ---------- Ціновий ряд ---------- */
console.log('\nПРАЙС');
{
  const c = {
    products: [
      { id: 'A', name: 'A', price: 550, cost: 240, category: 'briefs' },
      { id: 'B', name: 'B', price: 690, cost: 300, category: 'briefs' },
      { id: 'C', name: 'C', price: 750, cost: 320, category: 'briefs' },
      { id: 'D', name: 'D', price: 880, category: 'swim' },
      { id: 'H', name: 'H', price: 990, hidden: true, category: 'briefs' }
    ],
    stock: {},
    categories: [{ id: 'briefs', title: 'Бріфи' }, { id: 'swim', title: 'Swimwear' }]
  } as unknown as Catalogue;

  const ladder = ladderOf(c, 'briefs');
  ok('ряд — це ваші ж ціни, за зростанням', ladder.join(',') === '550,690,750', ladder.join(','));
  ok('приховані товари в ряд не йдуть', !ladder.includes(990));

  /* Округлення вгору, а не до найближчого: вниз означало б
     опустити ціну під межу беззбитковості. */
  ok('округлення до свого порога', toLadder(700, ladder) === 750, String(toLadder(700, ladder)));
  ok('точне влучання лишається собою', toLadder(690, ladder) === 690);
  ok('за межею ряду — до півсотні', toLadder(823, ladder) === 850, String(toLadder(823, ladder)));

  const mine = shopMargin(c, 'briefs');
  ok('маржа магазину рахується за товарами з собівартістю', mine.known === 3, String(mine.known));
  ok('і це медіана', Math.round(mine.value * 100) === Math.round(((690 - 300) / 690) * 100),
     String(Math.round(mine.value * 100)));

  ok('медіана на парній кількості', median([10, 20, 30, 40]) === 25);
}

/* ---------- Три ціни ---------- */
console.log('\nТРИ ЦІНИ');
{
  const c = {
    products: [
      { id: 'A', name: 'A', price: 550, cost: 240, category: 'briefs' },
      { id: 'B', name: 'B', price: 690, cost: 300, category: 'briefs' },
      { id: 'C', name: 'C', price: 750, cost: 320, category: 'briefs' }
    ],
    stock: {},
    categories: [{ id: 'briefs', title: 'Бріфи' }]
  } as unknown as Catalogue;

  const leak: Leak = { discount: 0.07, fee: BANK_FEE, total: 0.07 + BANK_FEE, sample: 40 };
  const spend = spendOf([{ id: 'a', title: 'усе', sum: 48000, perUnit: false }], 200);
  const a = adviseOf(spend, 200, leak, c, 'briefs');

  ok('робоча ціна — за вашою маржею', a.basis === 'margin', a.basis);
  ok('усі три стоять у вашому прайсі',
     [a.floor, a.work, a.bold].every((x) => [550, 690, 750].includes(x) || x % 50 === 0),
     [a.floor, a.work, a.bold].join('/'));
  ok('порядок не порушується', a.floor <= a.work && a.work <= a.bold,
     [a.floor, a.work, a.bold].join(' ≤ '));

  /* Межа мусить рахуватись від реально проданої частини партії, а
     не від усієї: решта завжди лишається. */
  const all = adviseOf(spend, 200, leak, c, 'briefs', 1);
  ok('менша очікувана розпродажність піднімає межу', a.floor >= all.floor,
     `${a.floor} проти ${all.floor}`);

  /* Магазин без собівартості й без прайсу — тоді калькулятор має
     сказати, що взяв множник, а не вдавати знання. */
  const bare = { products: [], stock: {}, categories: [] } as unknown as Catalogue;
  ok('без даних чесно кажемо про множник',
     adviseOf(spend, 200, leak, bare, '').basis === 'markup');
}

/* ---------- Відсотки з реальних замовлень ---------- */
console.log('\nЗАМОВЛЕННЯ');
{
  const c = {
    products: [{ id: 'A', name: 'A', price: 1000, category: 'briefs' }],
    stock: {},
    categories: [{ id: 'briefs', title: 'Бріфи' }]
  } as unknown as Catalogue;

  const orders: AdminOrder[] = [
    {
      _id: '1', num: 'R-1', status: 'done', date: '2026-08-10T10:00:00Z', discount: 200,
      payInvoiceId: 'inv',
      items: [{ id: 'A', name: 'A', qty: 1, price: 1000, size: 'M' }]
    } as never,
    {
      _id: '2', num: 'R-2', status: 'done', date: '2026-08-11T10:00:00Z', discount: 0,
      items: [{ id: 'A', name: 'A', qty: 1, price: 1000, size: 'M' }]
    } as never
  ];

  const leak = leakOf(orders, c, 'briefs', new Date('2026-08-01'), new Date('2026-08-31'));
  ok('середня знижка — з реальних замовлень',
     Math.round(leak.discount * 100) === 10, String(Math.round(leak.discount * 100)));
  ok('комісія — лише на тій частці, що платить карткою',
     Math.abs(leak.fee - BANK_FEE / 2) < 0.0001, String(leak.fee));
  ok('видно, на скількох замовленнях це пораховано', leak.sample === 2);

  const none = leakOf([], c, 'briefs', new Date('2026-08-01'), new Date('2026-08-31'));
  ok('без замовлень знижки не вигадуємо', none.discount === 0 && none.sample === 0);
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
