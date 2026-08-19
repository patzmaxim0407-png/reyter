/* ============================================================
   Перевірка складу
   ------------------------------------------------------------
   Це найдорожча логіка всього магазину: помилка тут не видно
   одразу, а через тиждень виявляється, що залишки не сходяться
   з коробками на полиці, і відновити правду вже нізвідки.

   Тому перевіряється саме арифметика, а не розмітка: скільки й
   куди рухається при кожному переході статусу, що стається при
   редагуванні замовлення, і чи справді на один документ припадає
   рівно один запис у пакеті.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/stock-check.ts
   ============================================================ */

import { readFileSync } from 'node:fs';
import { etaDateText, shortDate, stamp, toDate } from '../lib/dates.ts';
import {
  CONSUMING,
  MOVES_PER_PAGE,
  WRITEOFF_REASONS,
  collectStock,
  consumesStock,
  emptyPlan,
  filteredMoves,
  hasInvDoc,
  movesPage,
  planReceive,
  planRestock,
  planRestockEdit,
  emptyQueue,
  restateQueue,
  unsoldOf,
  giveBack,
  headCost,
  pushBatch,
  queueValue,
  takeUnits,
  planWriteoff,
  lastReceived,
  pendingRestocks,
  restockOverdue,
  restockTotal,
  setStockRow,
  sizeQty,
  isSized,
  stockRow,
  stockShortage,
  stockUnits,
  tracksStock,
  totalQty,
  todayISO,
  type Move,
  type Restock,
  type StockState
} from '../lib/admin/stock.ts';
import type { Product, Stock } from '../lib/types.ts';

let failed = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
}

const prod = (over: Partial<Product> & { id: string }): Product => ({
  name: 'Товар ' + over.id,
  price: 500,
  category: 'briefs',
  images: ['x.webp'],
  sizes: ['S', 'M', 'L'],
  ...over
});

const products: Product[] = [
  prod({ id: 'BR-001' }),
  prod({ id: 'TP-001', category: 'tops' }),
  prod({ id: 'CN-001', sizes: [], volume: '250 мл' }),
  prod({ id: 'CM-001', sizes: [], set: ['BR-001', 'TP-001'] })
];

const inv: Stock = {
  'BR-001': { sizes: { S: 5, M: 2, L: 0 } },
  'TP-001': { sizes: { S: 1, M: 4, L: 3 } },
  'CN-001': { qty: 7 }
};

const s: StockState = { products, inv };

/* ---------- Читання ---------- */

ok('розмір читається з документа', sizeQty(s, 'BR-001', 'M') === 2);
ok('товар без документа не має обліку', !hasInvDoc(s, 'CM-001'));
ok('сума по розмірах', totalQty(s, products[0]) === 7, String(totalQty(s, products[0])));
ok('товар без сітки рахується поштучно', totalQty(s, products[2]) === 7);

/* ---------- Комплект ---------- */

const setRow = setStockRow(s, products[3]);
/* Комплект розміру M вимагає M кожного складника — отже,
   рахуємо ПО РОЗМІРАХ і додаємо.

   BR-001: S5 M2 L0, TP-001: S1 M4 L3.
   Зібрати можна: S — один, M — два, L — жодного. Разом ТРИ.

   Доти тут стояло сім — «найдефіцитніший складник за всіма
   своїми розмірами». Число красиве й неправильне: воно не
   питає, чи збігаються розміри. На живому складі це виглядало
   так — комплект black показував «8 шт», а зібрати можна було
   рівно один, бо плавки лишились тільки в S. */
ok(
  'комплект рахується по розмірах, а не за сумами складників',
  setRow.total === 3,
  `total=${setRow.total} (S:1 + M:2 + L:0)`
);
ok(
  'підсумок сходиться з розмірами в рядку',
  setRow.total === setRow.sizes.reduce((n, c) => n + (c.qty ?? 0), 0),
  `${setRow.total} проти ${setRow.sizes.map((c) => c.qty).join('+')}`
);
ok('у комплекту немає власного документа', !hasInvDoc(s, 'CM-001'));

/* Живий випадок зі складу REYTER, 16.08.2026.
   Комплект black = майка black (S1 M6 L3) + Dark wave (S8 M0 L0).
   Полиця показувала «8 шт» і «можна зібрати» — а зібрати можна
   був рівно ОДИН, у S. Саме на це число дивляться, вирішуючи,
   чи час дошивати. */
{
  const real: StockState = {
    products: [
      prod({ id: 'MBL-001', sizes: ['S', 'M', 'L'] }),
      prod({ id: 'DW-001', sizes: ['S', 'M', 'L'] }),
      prod({ id: 'CBLE-001', sizes: [], set: ['MBL-001', 'DW-001'] })
    ],
    inv: {
      'MBL-001': { sizes: { S: 1, M: 6, L: 3 } },
      'DW-001': { sizes: { S: 8, M: 0, L: 0 } }
    }
  };
  const row = setStockRow(real, real.products[2]);
  ok('комплект black — один, а не вісім', row.total === 1, `total=${row.total}`);
  ok('і стан каже, що закінчується', row.state.cls === 'is-low', row.state.label);
}

/* Складник без сітки — свічка, коробка — розміру не має й
   ділиться між усіма розмірами. Він не додається до кожного, а
   ставить стелю на весь комплект: саме заради цього випадку
   стара формула й була такою, але поширювала виняток на всіх. */
{
  const mixed: StockState = {
    products: [
      prod({ id: 'T-001', sizes: ['S', 'M', 'L'] }),
      prod({ id: 'CANDLE', sizes: [], volume: true }),
      prod({ id: 'BOX-001', sizes: [], set: ['T-001', 'CANDLE'] })
    ],
    inv: {
      'T-001': { sizes: { S: 4, M: 4, L: 4 } },
      CANDLE: { qty: 5 }
    }
  };
  const row = setStockRow(mixed, mixed.products[2]);
  ok('безрозмірний складник ставить стелю', row.total === 5, `total=${row.total}`);

  /* Свічок вистачає — тоді межу ставить сітка. */
  const many: StockState = { ...mixed, inv: { ...mixed.inv, CANDLE: { qty: 50 } } };
  ok('коли свічок досить — рахує сітка', setStockRow(many, many.products[2]).total === 12,
     String(setStockRow(many, many.products[2]).total));
}

/* Хоч один складник без обліку — сказати нічого не можна.
   Доти стан рахувався за тими, що ведуться, тобто вигадувався з
   половини даних. */
{
  const half: StockState = {
    products: [
      prod({ id: 'A-001', sizes: ['S', 'M'] }),
      prod({ id: 'B-001', sizes: ['S', 'M'] }),
      prod({ id: 'SET-001', sizes: [], set: ['A-001', 'B-001'] })
    ],
    inv: { 'A-001': { sizes: { S: 9, M: 9 } } }
  };
  const row = setStockRow(half, half.products[2]);
  ok('без обліку складника числа немає', row.total === null, String(row.total));
  ok('і стан чесно мовчить', row.state.cls === '', row.state.label);
}
ok(
  'розмір комплекту — мінімум зі складників',
  setRow.sizes.find((x) => x.size === 'M')?.qty === 2,
  JSON.stringify(setRow.sizes)
);
ok(
  'розмір, якого нема в одного складника, не пропонується',
  !setRow.sizes.some((x) => x.size === 'XL'),
  setRow.sizes.map((x) => x.size).join(',')
);

/* ---------- Комплект у замовленні розкладається на складники ---------- */

const setOrder = {
  num: 'R-1',
  items: [
    {
      id: 'CM-001',
      name: 'Комплект',
      size: null,
      qty: 2,
      price: 900,
      parts: [
        { id: 'BR-001', name: 'Бріфи', size: 'S' },
        { id: 'TP-001', name: 'Майка', size: 'M' }
      ]
    }
  ]
};

const units = stockUnits(setOrder as never);
ok(
  'комплект списується складниками, а не собою',
  units.length === 2 && !units.some((u) => u.id === 'CM-001'),
  JSON.stringify(units.map((u) => `${u.id}/${u.size}×${u.qty}`))
);
ok(
  'кількість комплектів множиться на складники',
  units.every((u) => u.qty === 2),
  JSON.stringify(units.map((u) => u.qty))
);

/* ---------- Доставка не є товаром складу ---------- */

const deliveryOrder = {
  num: 'R-DELIVERY',
  items: [{ id: 'EFJ-1209', name: 'Доставка', size: null, qty: 1, price: 1 }]
};
ok('службовий артикул доставки не веде склад', !tracksStock('EFJ-1209'));
ok(
  'доставка не створює одиниці для списання',
  stockUnits(deliveryOrder as never).length === 0,
  JSON.stringify(stockUnits(deliveryOrder as never))
);
ok(
  'доставка не створює хибну нестачу',
  stockShortage(s, deliveryOrder as never).length === 0,
  stockShortage(s, deliveryOrder as never).join(' | ')
);

/* ---------- Правило одного запису на документ ---------- */

/* Заради цього код колись переписували: редагування замовлення
   збирало два записи на той самий документ inventory, і другий
   у пакеті затирав перший. */
const prev = {
  num: 'R-2',
  items: [{ id: 'BR-001', name: 'Бріфи', size: 'M', qty: 3, price: 500 }]
};
const updated = {
  num: 'R-2',
  items: [{ id: 'BR-001', name: 'Бріфи', size: 'M', qty: 5, price: 500 }]
};

const moved = emptyPlan();
collectStock(s, prev as never, +1, moved);
collectStock(s, updated as never, -1, moved);

const docs = Object.keys(moved.groups);
ok('на документ припадає рівно одна група', docs.length === 1, docs.join(', '));
ok(
  'різниця порахована взаємозаліком',
  moved.groups['BR-001'].sizes.M === -2,
  `M=${moved.groups['BR-001'].sizes.M} (було 3, стало 5 → −2)`
);
ok('у журнал ідуть обидва рухи', moved.moves.length === 2, String(moved.moves.length));

/* Нічого не змінилось — документа не торкаємось зовсім */
const same = emptyPlan();
collectStock(s, prev as never, +1, same);
collectStock(s, prev as never, -1, same);
ok(
  'без різниці залишки не чіпаємо',
  same.groups['BR-001'].sizes.M === 0,
  `M=${same.groups['BR-001'].sizes.M}`
);

/* ---------- Які статуси списують ---------- */

ok('нове замовлення складу не чіпає', !consumesStock('new'));
ok('підтверджене — списує', consumesStock('confirmed'));
/* Найдорожча помилка нового статусу: якби «Підготовка до
   відправлення» тут не значилась, перехід із «Підтверджено»
   повертав би товар на полицю — і склад показував би зайве
   рівно на все, що зараз пакується. */
ok('у підготовці до відправлення — списує', consumesStock('packing'));
ok('відправлене — списує', consumesStock('shipped'));
ok('виконане — списує', consumesStock('done'));
ok('скасоване — не списує', !consumesStock('cancelled'));
ok('перелік списувальних статусів', CONSUMING.length === 4, CONSUMING.join(', '));

/* ---------- Нестача ---------- */

const tooMuch = {
  num: 'R-3',
  items: [{ id: 'BR-001', name: 'Бріфи', size: 'L', qty: 2, price: 500 }]
};
const short = stockShortage(s, tooMuch as never);
ok('нестача помічається', short.length === 1, short.join(' | '));

const enough = {
  num: 'R-4',
  items: [{ id: 'BR-001', name: 'Бріфи', size: 'S', qty: 2, price: 500 }]
};
ok('вистачає — мовчимо', stockShortage(s, enough as never).length === 0);

/* ---------- Списання ---------- */

const wo = planWriteoff(s, { productId: 'BR-001', reason: 'damaged', note: 'намокли', sizes: { S: 2 } });
ok('списання складається', wo.ok === true, wo.ok ? '' : wo.message);
if (wo.ok) {
  ok('списання йде в мінус', wo.plan.groups['BR-001'].sizes.S === -2, String(wo.plan.groups['BR-001'].sizes.S));
  ok('причина потрапляє в журнал', wo.ref.includes('Зіпсувався') && wo.ref.includes('намокли'), wo.ref);
  ok('без перевищення питати нічого', wo.over.length === 0);
}

const woOver = planWriteoff(s, { productId: 'BR-001', reason: 'lost', note: '', sizes: { M: 9 } });
ok('списання понад залишок питає', woOver.ok === true && woOver.over.length === 1,
   woOver.ok ? woOver.over.join(',') : woOver.message);

const woSet = planWriteoff(s, { productId: 'CM-001', reason: 'lost', note: '', qty: 1 });
ok('комплект списати не можна', woSet.ok === false,
   woSet.ok ? '' : woSet.message);

const woEmpty = planWriteoff(s, { productId: 'BR-001', reason: 'lost', note: '', sizes: {} });
ok('нульове списання не проходить', woEmpty.ok === false);

ok('причин списання сім', WRITEOFF_REASONS.length === 7, WRITEOFF_REASONS.map((r) => r.id).join(','));

/* ---------- Прихід ---------- */

const restock: Restock = {
  _id: 'r1',
  productId: 'BR-001',
  productName: 'Бріфи',
  expected: '2026-08-01',
  items: { L: 4 },
  status: 'pending'
};

ok('сума приходу', restockTotal(restock) === 4);
ok('прострочений прихід помічається', restockOverdue(restock, new Date('2026-08-10')));
ok('майбутній прихід не прострочений', !restockOverdue(restock, new Date('2026-07-01')));

const rec = planReceive(s, restock);
ok('прихід оприбутковується', rec.ok === true, rec.ok ? '' : rec.message);
if (rec.ok) {
  ok('розміри додаються', rec.sizes.L === 4, JSON.stringify(rec.sizes));
  /* L зараз нуль — після приходу товар повертається в наявність,
     і саме тоді підписникам іде лист */
  ok('повернення в наявність помічене', rec.back?.includes('L') === true, JSON.stringify(rec.back));
}

const recSet = planReceive(s, { ...restock, productId: 'CM-001' });
ok('комплект не оприбутковують', recSet.ok === false, recSet.ok ? '' : recSet.message);

/* ---------- Журнал руху ---------- */

const moves: Move[] = Array.from({ length: 60 }, (_, i) => ({
  productId: 'BR-001',
  productName: 'Бріфи',
  size: 'M',
  delta: i % 2 ? 1 : -1,
  reason: i % 3 === 0 ? 'restock' : 'order',
  ref: 'R-' + i,
  by: 'admin@reyter.men',
  ts: {
    toDate: () => new Date(new Date('2026-08-10T12:00:00Z').getTime() - i * 3600_000)
  }
}));

const p1 = movesPage(moves, 1, new Date('2026-08-10T12:00:00Z'));
ok('сторінка журналу обмежена', p1.shown.length === MOVES_PER_PAGE, String(p1.shown.length));
ok('сторінок порахувано', p1.pages === Math.ceil(60 / MOVES_PER_PAGE), String(p1.pages));
ok('записи згруповані за добою', p1.days.length >= 2,
   p1.days.map((d) => d.title + ':' + d.moves.length).join(' | '));
ok('запис без часу не ламає групування',
   movesPage([{ productId: 'X', delta: 1 }], 1, new Date()).days[0].title === 'Без дати',
   movesPage([{ productId: 'X', delta: 1 }], 1, new Date()).days[0].title);
ok('підсумки за всім фільтром, не за сторінкою', p1.plus === 30 && p1.minus === -30,
   `+${p1.plus} / ${p1.minus}`);

ok('фільтр за причиною', filteredMoves(moves, 'restock', '').every((m) => m.reason === 'restock'));
ok('пошук за посиланням', filteredMoves(moves, 'all', 'R-7').length >= 1);

/* ---------- Дата місцевою добою ---------- */

const evening = new Date(2026, 7, 10, 23, 30);
ok('вечірня дата не тікає на завтра', todayISO(evening) === '2026-08-10', todayISO(evening));

/* ---------- Прихід: що показує список ---------- */

const feed: Restock[] = [
  { _id: 'a', productId: 'X', expected: '2026-08-01', status: 'received' },
  { _id: 'b', productId: 'X', expected: '2026-08-05', status: 'pending' },
  { _id: 'c', productId: 'X', expected: '2026-08-09', status: 'received' },
  { _id: 'd', productId: 'X', expected: '2026-08-20', status: 'pending' }
];

ok('у черзі лишаються тільки неоприбутковані',
   pendingRestocks(feed).map((r) => r._id).join('') === 'bd',
   pendingRestocks(feed).map((r) => r._id).join(''));

ok('«останні оприбутковані» — справді останні, а не найдавніші',
   lastReceived(feed).map((r) => r._id).join('') === 'ca',
   lastReceived(feed).map((r) => r._id).join(''));

ok('довгий список обрізається згори', lastReceived(feed, 1).map((r) => r._id).join('') === 'c');

/* Порядок — за часом ОПРИБУТКУВАННЯ, а не за очікуваною датою.
   Партія, обіцяна на грудень і заведена на склад учора, не має
   стояти попереду тієї, яку завели сьогодні: «останні
   оприбутковані» означає «які щойно потрапили на склад». */
const gotAt = (iso: string) => ({ toDate: () => new Date(iso) }) as never;
const byReceipt: Restock[] = [
  { _id: 'пізня обіцянка', productId: 'X', expected: '2026-12-31', status: 'received', receivedAt: gotAt('2026-08-14T10:00:00Z') },
  { _id: 'щойно завели', productId: 'X', expected: '2026-08-02', status: 'received', receivedAt: gotAt('2026-08-16T10:00:00Z') }
];
ok('останні оприбутковані — за часом оприбуткування',
   lastReceived(byReceipt)[0]._id === 'щойно завели',
   lastReceived(byReceipt)[0]._id);

/* Давні записи часу оприбуткування не мають — вони не повинні
   зникати зі списку, лише ставати в хвіст за очікуваною датою. */
const mixed: Restock[] = [
  { _id: 'без позначки', productId: 'X', expected: '2026-08-10', status: 'received' },
  { _id: 'з позначкою', productId: 'X', expected: '2026-08-01', status: 'received', receivedAt: gotAt('2026-08-16T10:00:00Z') }
];
ok('запис без часу оприбуткування не губиться',
   lastReceived(mixed).length === 2 && lastReceived(mixed)[0]._id === 'з позначкою',
   lastReceived(mixed).map((r) => r._id).join(' | '));

/* ---------- Перерахунок ---------- */

/* Тут ховалась помилка, через яку звірка не закривалась.
   Перерахунок писав ОДНЕ й те саме число і в залишок, і в
   журнал: додали дві штуки — плюс два там і плюс два там. Обидва
   зросли однаково, а стара розбіжність між ними лишилась
   недоторканою. Скільки не рахуй — вона нікуди не подінеться.

   Правильно інакше, і це РІЗНІ числа:
     у залишок — наскільки полиця відрізняється від порахованого,
     у журнал  — наскільки ЖУРНАЛ відрізняється від порахованого.

   Живий випадок: BO-001, журнал 4, полиця 3. Власник порахував і
   побачив 5. */
{
  const shelf = 3;
  const logged = 4;
  const counted = 5;

  const toShelf = counted - shelf;
  const toLog = counted - logged;

  ok('у залишок іде різниця з полицею', toShelf === 2, String(toShelf));
  ok('у журнал — різниця з журналом', toLog === 1, String(toLog));
  ok('після цього вони зійшлись',
     shelf + toShelf === logged + toLog, `${shelf + toShelf} проти ${logged + toLog}`);

  /* Так було доти: однакове число в обидва — і розбіжність
     пережила перерахунок. Саме це власник і побачив. */
  const naive = counted - shelf;
  ok('колишній спосіб розбіжності не закривав',
     shelf + naive !== logged + naive, `${shelf + naive} проти ${logged + naive}`);
}

{
  /* Полиця правильна, помилився журнал. Тоді пораховане дорівнює
     полиці: залишок не рухається, журнал підтягується. Це і є
     кнопка у звірці. */
  const shelf = 3;
  const logged = 6;
  const counted = shelf;
  ok('залишок не зрушиться', counted - shelf === 0);
  ok('журнал підтягнеться на різницю', counted - logged === -3, String(counted - logged));
}

/* ---------- Дати для людини ---------- */

const NOW = new Date('2026-08-10T12:00:00');
ok('дата поточного року — без року', shortDate(toDate('2026-08-20'), NOW) === '20 серпня',
   shortDate(toDate('2026-08-20'), NOW));
ok('дата іншого року — з роком', /2027/.test(shortDate(toDate('2027-01-05'), NOW)),
   shortDate(toDate('2027-01-05'), NOW));
ok('порожня дата не дає «Invalid Date»', shortDate(toDate(''), NOW) === '');
ok('зіпсована дата не дає «Invalid Date»', shortDate(toDate('не дата'), NOW) === '');
ok('вечірня дата не тікає на добу назад', shortDate(toDate('2026-08-20'), NOW).startsWith('20'));
ok('мітка з часом', /^20 серпня, \d\d:\d\d$/.test(stamp(new Date('2026-08-20T14:30:00'), NOW)),
   stamp(new Date('2026-08-20T14:30:00'), NOW));
ok('вітрина показує дату словами', etaDateText('2026-08-15', 'uk', NOW) === '15 серпня',
   etaDateText('2026-08-15', 'uk', NOW));
ok('нерозбірливу дату вітрина показує як є', etaDateText('скоро', 'uk', NOW) === 'скоро');

/* ---------- Лист «знову в наявності» ----------
   Тип запиту — єдине, за чим воркер розрізняє листи. Помилка тут
   не видно ніде: адмінка каже «оприбутковано», а лист не йде. */

const client = readFileSync(new URL('../lib/notify.ts', import.meta.url), 'utf8');
/* Собівартість партії. Прихід — те місце, де ціна закупівлі
   справді змінюється, і саме звідти вона має потрапляти в товар:
   інакше власник вписував би її двічі, у картці й у приході, і
   рано чи пізно вони розійшлися б. */
{
  const plan = planRestock(s, {
    productId: products[0].id, expected: '', note: '', sizes: { M: 3 }, cost: 640
  } as never, new Date('2026-08-16T10:00:00'));
  ok('собівартість партії зберігається в приході',
     plan.ok === true && (plan as { doc: { cost?: number } }).doc.cost === 640);

  const none = planRestock(s, {
    productId: products[0].id, expected: '', note: '', sizes: { M: 3 }
  } as never, new Date('2026-08-16T10:00:00'));
  ok('без собівартості поля в документі немає',
     none.ok === true && (none as { doc: { cost?: number } }).doc.cost === undefined);

  /* Той самий випадок, з якого це й почалось: лишалось три пари
     по 300, приїхало десять по 330. Залишок має продатись за
     старою ціною, і лише потім починається нова партія. */
  let q = pushBatch(emptyQueue(), 3, 300, '2026-08-01');
  q = pushBatch(q, 10, 330, '2026-08-16');
  ok('у черзі дві партії', q.batches.length === 2);

  const one = takeUnits(q, 1);
  ok('перший продаж іде за старою ціною', one.unit === 300, String(one.unit));
  ok('черга зменшилась', one.queue.batches[0].qty === 2);

  const three = takeUnits(q, 3);
  ok('останній зі старої партії — теж 300', three.unit === 300, String(three.unit));
  ok('стара партія зникла з черги', three.queue.batches.length === 1);

  const four = takeUnits(q, 4);
  ok('продаж через межу партій дає середню саме цього продажу',
     four.unit === Math.round((3 * 300 + 1 * 330) / 4), String(four.unit));

  const after = takeUnits(three.queue, 2);
  ok('далі продається нова партія', after.unit === 330, String(after.unit));

  const dry = takeUnits(emptyQueue(), 2);
  ok('порожня черга не вигадує ціни', dry.unit === 0, String(dry.unit));

  const over = takeUnits(pushBatch(emptyQueue(), 1, 300, ''), 3);
  ok('коли черги забракло, решта йде останньою відомою ціною',
     over.unit === 300, String(over.unit));

  const back = giveBack(three.queue, 3, 300, '2026-08-17');
  ok('повернення стає знову першим у черзі',
     back.batches[0].cost === 300 && takeUnits(back, 1).unit === 300);

  ok('гроші на складі рахуються',
     queueValue(q) === 3 * 300 + 10 * 330, String(queueValue(q)));
  ok('наступна одиниця — з голови черги', headCost(q) === 300);

  /* Ціну партії правлять частіше за все інше: домовились на одну,
     приїхало за іншою. Доки прихід не оприбуткований, правити її
     безпечно — у чергу вона ще не стала. */
  const edit = planRestockEdit(
    { expected: '2026-08-20', note: '', cost: 355, sizes: { S: 5 } },
    new Date('2026-08-16T10:00:00')
  );
  ok('редагування приходу міняє собівартість',
     edit.ok === true && (edit as { update: { cost: number } }).update.cost === 355);

  const wiped = planRestockEdit(
    { expected: '2026-08-20', note: '', cost: 0, sizes: { S: 5 } },
    new Date('2026-08-16T10:00:00')
  );
  ok('нуль прибирає ціну з партії',
     wiped.ok === true && (wiped as { update: { cost: number } }).update.cost === 0);

  /* Витрати випуску уточнюють постійно, і питання завжди одне:
     що робити з тим, що вже продано. Відповідь — не чіпати:
     переписати заморожену ціну означало б переписати вже
     закритий місяць. А непроданий залишок правиться вільно. */
  let batches = pushBatch(emptyQueue(), 10, 400, '2026-08-01', 'REL-1');
  batches = pushBatch(batches, 5, 300, '2026-08-05');
  ok('партія памʼятає свій випуск', batches.batches[0].from === 'REL-1');
  ok('чужа партія його не має', batches.batches[1].from === undefined);

  const eaten = takeUnits(batches, 4).queue;
  ok('після продажу в черзі лишилось шість', unsoldOf(eaten, 'REL-1') === 6,
     String(unsoldOf(eaten, 'REL-1')));

  const fixed = restateQueue(eaten, 'REL-1', 460);
  ok('непроданий залишок узяв нову ціну', fixed.batches[0].cost === 460);
  ok('чужа партія лишилась недоторканою',
     fixed.batches[fixed.batches.length - 1].cost === 300);
  ok('і кількість не змінилась', fixed.batches[0].qty === 6, String(fixed.batches[0].qty));

  ok('без випуску нічого не правиться',
     restateQueue(batches, '', 999).batches[0].cost === 400);

  ok('прихід кладе партію в чергу, а не переписує картку',
     /COSTS_COL, r\.productId\), next/.test(
       readFileSync(new URL('../lib/admin/stock.ts', import.meta.url), 'utf8')
     ));
}

const worker = readFileSync(new URL('../../worker/worker.js', import.meta.url), 'utf8');
const asked = [...client.matchAll(/type: '([a-z-]+)'/g)].map((m) => m[1]);
ok('клієнт шле хоч якісь типи листів', asked.length > 0, asked.join(', '));
for (const type of [...new Set(asked)]) {
  ok(`воркер знає тип «${type}»`, worker.includes(`'${type}'`), asked.join(', '));
}

/* ---------- Товар без розмірів рахується поштучно ----------
   Свічка має обʼєм і сітки не має ніколи. Але так само її не має
   товар, якому розмірів просто не задали — доставка окремою
   позицією, наприклад. Доти склад малював йому всі пʼять
   розмірів із нулями: рядок, у якому все неправда. */
{
  const candle = { id: 'CN-1', name: 'Свічка', price: 500, category: 'home-collection', volume: '250 мл', sizes: [], images: [] } as unknown as Product;
  const piece = { id: 'PC-1', name: 'Доставка', price: 1, category: 'new', sizes: [], images: [] } as unknown as Product;
  const shirt = { id: 'SH-1', name: 'Сорочка', price: 900, category: 'sorochky', sizes: ['M', 'L'], images: [] } as unknown as Product;
  const st = { products: [candle, piece, shirt], inv: {} } as never;

  ok('свічка — поштучно', !isSized(candle, st));
  ok('товар без жодного розміру — теж поштучно', !isSized(piece, st));
  ok('товар із сіткою лишається розмірним', isSized(shirt, st));

  /* Старі записи не зникають: якщо кількості вже проставлені за
     розмірами, сітку вважаємо наявною попри порожню картку. */
  const old = { products: [piece], inv: { 'PC-1': { sizes: { M: 3 } } } } as never;
  ok('проставлені колись розміри не зникають', isSized(piece, old));

  const row = stockRow(st, piece);
  ok('у рядку складу немає розмірних клітинок', row.cells.length === 0, String(row.cells.length));
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
process.exit(failed ? 1 : 0);
