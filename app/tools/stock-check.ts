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
  planWriteoff,
  restockOverdue,
  restockTotal,
  setStockRow,
  sizeQty,
  stockRow,
  stockShortage,
  stockUnits,
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
ok(
  'комплект обмежує найдефіцитніший складник',
  setRow.total === 7,
  `total=${setRow.total} (BR-001: 7, TP-001: 8)`
);
ok('у комплекту немає власного документа', !hasInvDoc(s, 'CM-001'));
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
ok('відправлене — списує', consumesStock('shipped'));
ok('виконане — списує', consumesStock('done'));
ok('скасоване — не списує', !consumesStock('cancelled'));
ok('перелік списувальних статусів', CONSUMING.length === 3, CONSUMING.join(', '));

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

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
process.exit(failed ? 1 : 0);
