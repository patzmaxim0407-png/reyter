/* Звірка двох екранів на СПРАВЖНІХ замовленнях.

   «Архів і пошук» і «Аналітика» показують різну виручку, і поки
   різниця не розкладена по замовленнях — обидва числа однаково
   схожі на помилку. Цей інструмент рахує обома формулами з коду
   (не переписаними тут заново — саме тими, що малюють екрани) і
   доводить, з чого складається різниця.

   Дані бере з вивантаження бази: { orders, products, categories }.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/orders-audit.ts orders.json [30|7|90|365|all]
*/
import { readFileSync } from 'node:fs';
import { orderStats, orderDate, type AdminOrder } from '../lib/admin/orders.ts';
import { kpiOf, rangeOf, linesOf, type Span } from '../lib/admin/insights.ts';
import type { Catalogue, Product } from '../lib/catalog.ts';

const file = process.argv[2];
const span = (process.argv[3] || '30') as Span;
if (!file) {
  console.error('Вкажи файл вивантаження: tools/orders-audit.ts orders.json [30]');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, 'utf8'));
const list: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw.orders || [];
const products: Product[] = (Array.isArray(raw) ? [] : raw.products) || [];
const categories = (Array.isArray(raw) ? [] : raw.categories) || [];

/* У вивантаженні created — рядок ISO, а код чекає на Timestamp
   із .toDate(). Без цієї обгортки замовлення без поля date
   провалюються в 1970 і випадають із будь-якого періоду. */
const orders: AdminOrder[] = list.map((o) => {
  const created = o.created;
  return {
    ...o,
    created:
      typeof created === 'string' ? { toDate: () => new Date(created) } : created
  } as AdminOrder;
});

const c = { products, categories, stock: {} } as unknown as Catalogue;
const now = new Date();
const { from, to } = rangeOf(span, now);
const inRange = (o: AdminOrder) => {
  const t = orderDate(o).getTime();
  return t >= from.getTime() && t <= to.getTime();
};

const n = (v: unknown) => Math.round(Number(v) || 0);
const money = (v: number) => v.toLocaleString('uk-UA');
const day = (o: AdminOrder) => orderDate(o).toISOString().slice(0, 10);
const label = (o: AdminOrder) => '№' + String(o.num || o._id || '?');

/* ---------- Що взагалі завантажили ---------- */
const dated = orders.filter((o) => orderDate(o).getTime() > 0);
const times = dated.map((o) => orderDate(o).getTime()).sort((a, b) => a - b);
console.log('══ ДАНІ ══');
console.log('замовлень у файлі:', orders.length);
if (times.length) {
  console.log(
    'від', new Date(times[0]).toISOString().slice(0, 10),
    'до', new Date(times[times.length - 1]).toISOString().slice(0, 10)
  );
}
if (orders.length > dated.length) {
  console.log('⚠ без дати:', orders.length - dated.length, '— у жоден період не потраплять');
}
console.log('період звірки:', from.toISOString().slice(0, 10), '…', to.toISOString().slice(0, 10));

/* ---------- Обидва екрани, на однаковому наборі ---------- */
const scope = orders.filter(inRange);
const arch = orderStats(scope);
const kpi = kpiOf(orders, c, from, to);

console.log('\n══ АРХІВ І ПОШУК ══');
console.log('Замовлень (зі скасованими):', arch.count);
console.log('Виручка:', money(arch.revenue), 'грн');
console.log('Середній чек:', money(arch.avg), 'грн');
console.log('Одиниць товару:', arch.units);

console.log('\n══ АНАЛІТИКА ══');
console.log('Замовлень (лише «Виконано»):', kpi.orders);
console.log('Виручка:', money(kpi.revenue), 'грн');
console.log('Маржа:', money(kpi.margin), 'грн', '(покрито собівартістю ' + Math.round(kpi.covered * 100) + '%)');
console.log('Середній чек:', money(kpi.average), 'грн');
console.log('Знижок віддано:', money(kpi.discounts), 'грн');
console.log('Скасовано:', kpi.cancelled, '—', money(kpi.cancelledSum), 'грн');

/* ---------- З чого складається різниця ----------
   archiveВиручка = Σ total по нескасованих
                  = Σ total по виконаних + Σ total по тих, що в роботі
   Σ total по виконаних = Σ (товари − знижка) + Σ доставка
   analyticsВиручка     = Σ рядків товарів після знижки

   Отже різниця = «в роботі» + доставка виконаних + округлення
   рядків. Якщо тотожність не сходиться — у даних є щось третє,
   і саме воно варте уваги. */
const byId = new Map(products.map((p) => [String(p.id), p]));
const done = scope.filter((o) => o.status === 'done');
const flight = scope.filter((o) => o.status !== 'done' && o.status !== 'cancelled');

const flightSum = flight.reduce((s, o) => s + n(o.total), 0);
const shipSum = done.reduce((s, o) => s + Math.max(0, n(o.shipping)), 0);
const drift = done.reduce((s, o) => {
  const lines = linesOf(o, byId).reduce((x, l) => x + l.paid, 0);
  return s + (n(o.total) - Math.max(0, n(o.shipping)) - lines);
}, 0);

const gap = arch.revenue - kpi.revenue;
console.log('\n══ ЗВІРКА ══');
console.log('різниця у виручці:', money(gap), 'грн');
console.log('  у роботі, ще не «Виконано»:', flight.length, 'шт —', money(flightSum), 'грн');
console.log('  доставка у виконаних (архів її рахує, аналітика ні):', money(shipSum), 'грн');
console.log('  округлення рядків зі знижкою:', money(drift), 'грн');
const rest = gap - flightSum - shipSum - drift;
console.log(rest === 0 ? '  ✓ сходиться до копійки' : '  ✗ НЕ СХОДИТЬСЯ, лишок ' + money(rest) + ' грн');
console.log('різниця в кількості:', arch.count, '−', kpi.orders, '=', arch.count - kpi.orders,
  '(' + kpi.cancelled + ' скасованих + ' + flight.length + ' у роботі)');

if (flight.length) {
  console.log('\n── у роботі ──');
  for (const o of flight.sort((a, b) => orderDate(a).getTime() - orderDate(b).getTime())) {
    console.log(' ', day(o), label(o), String(o.status || 'new').padEnd(10), money(n(o.total)), 'грн');
  }
}

/* ---------- Чи сходиться кожне замовлення саме в собі ----------
   Тут ловиться те, чого не видно на жодному екрані: підсумок, що
   не дорівнює сумі позицій. Таке замовлення однаково перекошує
   обидва звіти, і виправляти його треба в базі, а не у формулі. */
console.log('\n══ ЦІЛІСНІСТЬ ЗАМОВЛЕНЬ (усіх у файлі) ══');
const broken: string[] = [];
for (const o of orders) {
  const items = Array.isArray(o.items) ? o.items : [];
  if (!items.length) {
    if (o.status !== 'cancelled') broken.push(`${day(o)} ${label(o)}: немає позицій, а total ${money(n(o.total))} грн`);
    continue;
  }
  const goods = items.reduce((s, i) => s + n(i.price) * n(i.qty), 0);
  const sub = o.subtotal === undefined ? goods : n(o.subtotal);
  const want = Math.max(0, sub - n(o.discount) + Math.max(0, n(o.shipping)));
  if (goods !== sub) broken.push(`${day(o)} ${label(o)}: позиції ${money(goods)} ≠ subtotal ${money(sub)}`);
  else if (Math.abs(want - n(o.total)) > 1) {
    broken.push(
      `${day(o)} ${label(o)}: ${money(sub)} − ${money(n(o.discount))} + ${money(Math.max(0, n(o.shipping)))} = ${money(want)} ≠ total ${money(n(o.total))}`
    );
  }
}
console.log(broken.length ? '✗ розбіжностей: ' + broken.length : '✓ усі підсумки сходяться');
broken.slice(0, 40).forEach((b) => console.log('  ', b));
if (broken.length > 40) console.log('   … і ще', broken.length - 40);

/* Доставка в total — окремо: поки вона нуль, різниця екранів
   тримається лише на статусах, і це важливо знати напевно. */
const paidShip = orders.filter((o) => Math.max(0, n(o.shipping)) > 0);
console.log('\nзамовлень із платною доставкою:', paidShip.length,
  paidShip.length ? '— на ' + money(paidShip.reduce((s, o) => s + n(o.shipping), 0)) + ' грн' : '');
paidShip.slice(0, 20).forEach((o) => console.log('  ', day(o), label(o), money(n(o.shipping)), 'грн'));

/* Собівартість: маржа без неї — не маржа, а виручка. */
const noCost = done.filter((o) => linesOf(o, byId).some((l) => l.cost === null));
console.log('\nвиконаних без собівартості хоч однієї позиції:', noCost.length, 'із', done.length);
