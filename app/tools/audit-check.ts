/* ============================================================
   REYTER — перевірка звірки складу
   ------------------------------------------------------------
   Запуск:
     node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/audit-check.ts

   Звірка — інструмент, яким шукають помилки. Якщо помиляється
   вона сама, шкода подвійна: або ганяє власника по складу за
   тим, чого немає, або мовчить там, де товар справді зник.
   ============================================================ */

import { checkOrders, reconcile } from '../lib/admin/audit.ts';
import type { Move, StockState } from '../lib/admin/stock.ts';

let failed = 0;
function ok(what: string, pass: boolean, got = '') {
  if (pass) console.log('✓ ' + what + (got ? ' — ' + got : ''));
  else {
    failed += 1;
    console.log('✗ ' + what + (got ? ' — ' + got : ''));
  }
}

const T0 = new Date('2026-08-01T10:00:00Z').getTime();
const at = (min: number) => ({ toDate: () => new Date(T0 + min * 60_000) });

function move(
  productId: string,
  size: string | null,
  delta: number,
  reason: string,
  min: number,
  ref = ''
): Move {
  return { productId, productName: productId, size, delta, reason, ref, ts: at(min) };
}

const prod = (id: string, sizes: string[] = []) =>
  ({ id, name: id, price: 100, category: 'c', sizes }) as never;

console.log('\nЗВІРКА З ЖУРНАЛОМ');
{
  /* Товар, який завели вже при журналі: прихід 10, продали 3.
     На полиці має бути 7 — і журнал це підтверджує. */
  const s: StockState = {
    products: [prod('A-001', ['S', 'M'])],
    inv: { 'A-001': { sizes: { S: 4, M: 3 } } }
  };
  const moves = [
    move('A-001', 'S', 6, 'restock', 0),
    move('A-001', 'M', 4, 'restock', 0),
    move('A-001', 'S', -2, 'order', 10, 'R-1'),
    move('A-001', 'M', -1, 'order', 10, 'R-1')
  ];
  const r = reconcile(s, moves);
  ok('усе сходиться', r.rows[0].diff === 0, String(r.rows[0].diff));
  ok('журнал знає початок', r.rows[0].covered === true);
  ok('поламаних немає', r.broken.length === 0);
  ok('порахвано як «зійшлось»', r.ok === 1);
}

{
  /* Те саме, але на полиці на два менше, ніж каже журнал. Товар
     кудись подівся — і саме це звірка має показати. */
  const s: StockState = {
    products: [prod('A-001', ['S', 'M'])],
    inv: { 'A-001': { sizes: { S: 2, M: 3 } } }
  };
  const moves = [
    move('A-001', 'S', 6, 'restock', 0),
    move('A-001', 'M', 4, 'restock', 0),
    move('A-001', 'S', -2, 'order', 10, 'R-1'),
    move('A-001', 'M', -1, 'order', 10, 'R-1')
  ];
  const r = reconcile(s, moves);
  ok('нестача видна', r.rows[0].diff === -2, String(r.rows[0].diff));
  ok('товар у списку поламаних', r.broken.length === 1);
  /* І видно, у якому саме розмірі: у сумі мінус два й плюс два
     взаємно ховаються. */
  const size = r.rows[0].bySize.find((x) => x.size === 'S');
  ok('видно, де саме розійшлось', !!size && size.diff === -2, size ? String(size.diff) : 'немає');
}

{
  /* Товар, залишок якого колись проставили руками в картці: у
     журналі його початку немає, перший рух — продаж. Різниця
     буде завжди, і це НЕ поломка. Плутати ці два випадки не
     можна: за одним треба йти на склад, за іншим — ні. */
  const s: StockState = {
    products: [prod('B-001', ['S'])],
    inv: { 'B-001': { sizes: { S: 5 } } }
  };
  const moves = [move('B-001', 'S', -1, 'order', 10, 'R-2')];
  const r = reconcile(s, moves);
  ok('початку немає — не поламане', r.broken.length === 0);
  ok('а віднесене до неповних', r.partial.length === 1);
  ok('різниця — це те, що було до журналу', r.rows[0].diff === 6, String(r.rows[0].diff));
}

{
  /* Коригування вгору теж починає історію: саме ним заводять
     залишок, коли товар уже лежить на полиці. */
  const s: StockState = { products: [prod('C-001')], inv: { 'C-001': { qty: 3 } } };
  const r = reconcile(s, [move('C-001', null, 3, 'manual', 0)]);
  ok('коригування вгору відкриває історію', r.rows[0].covered === true);
  ok('і числа сходяться', r.rows[0].diff === 0);
}

{
  /* Комплект власних штук не має — звіряти в ньому нічого, і
     потрапити в звірку він не повинен: інакше кожен комплект
     вічно значився б розбіжністю. */
  const s: StockState = {
    products: [
      prod('D-001', ['S']),
      { id: 'SET-1', name: 'SET-1', price: 200, category: 'c', sizes: [], set: ['D-001'] } as never
    ],
    inv: { 'D-001': { sizes: { S: 1 } }, 'SET-1': { qty: 5 } }
  };
  const r = reconcile(s, [move('D-001', 'S', 1, 'restock', 0)]);
  ok('комплект у звірку не потрапляє', r.rows.length === 1 && r.rows[0].id === 'D-001');
}

{
  /* Рух на товар, якого вже немає в каталозі. Мовчки викидати
     його не можна: це слід від того, що колись продавали. */
  const s: StockState = { products: [prod('E-001')], inv: { 'E-001': { qty: 1 } } };
  const r = reconcile(s, [move('E-001', null, 1, 'restock', 0), move('GONE', null, -9, 'order', 5)]);
  ok('рух на зниклий товар порахвано окремо', r.orphans === 1, String(r.orphans));
  ok('і на числа живого товару він не вплинув', r.rows[0].diff === 0);
}

{
  /* Журнал прочитано не цілком — тоді «покриття» не можна
     стверджувати ні для кого: перший рух у вибірці може бути не
     першим насправді. */
  const s: StockState = { products: [prod('F-001')], inv: { 'F-001': { qty: 10 } } };
  const r = reconcile(s, [move('F-001', null, 10, 'restock', 0)], false);
  ok('на обрізаному журналі покриття не стверджується', r.rows[0].covered === false);
  ok('і поламаних не вигадується', r.broken.length === 0);
}

console.log('\nЗАМОВЛЕННЯ ПРОТИ ЖУРНАЛУ');
{
  const moves = [
    move('A-001', 'M', -2, 'order', 10, 'R-100'),
    move('A-001', 'M', -1, 'order', 10, 'R-200')
  ];
  const orders = [
    { num: 'R-100', status: 'done', items: [{ id: 'A-001', qty: 2 }] },
    { num: 'R-200', status: 'confirmed', items: [{ id: 'A-001', qty: 1 }] }
  ];
  ok('правильні замовлення не потрапляють у звіт', checkOrders(orders, moves).length === 0);
}

{
  /* Статус перемикали туди-сюди: товар списали й повернули, а
     замовлення лишилось виконаним. Полиця показує штуки, яких
     насправді немає, — і жодного натяку про це ніде не було. */
  const moves = [
    move('A-001', 'M', -2, 'order', 10, 'R-300'),
    move('A-001', 'M', 2, 'order-cancel', 11, 'R-300')
  ];
  const orders = [{ num: 'R-300', status: 'done', items: [{ id: 'A-001', qty: 2 }] }];
  const bad = checkOrders(orders, moves);
  ok('списання, яке відкотилось, помічене', bad.length === 1);
  ok('видно, скількох штук бракує', bad[0].diff === 2, String(bad[0].diff));
}

{
  /* Нове й скасоване замовлення складу не чіпають — питати з
     них нічого. */
  const orders = [
    { num: 'R-400', status: 'new', items: [{ id: 'A-001', qty: 5 }] },
    { num: 'R-500', status: 'cancelled', items: [{ id: 'A-001', qty: 5 }] }
  ];
  ok('нове й скасоване не звіряються', checkOrders(orders, []).length === 0);
}

{
  /* Повернення від покупця — законне: воно зменшує нетто
     списання, і замовлення справді має менше штук на складі. */
  const moves = [
    move('A-001', 'M', -3, 'order', 10, 'R-600'),
    move('A-001', 'M', 1, 'order-return', 20, 'R-600')
  ];
  const orders = [{ num: 'R-600', status: 'done', items: [{ id: 'A-001', qty: 3 }] }];
  const bad = checkOrders(orders, moves);
  ok('повернення від покупця видно як різницю', bad.length === 1 && bad[0].diff === 1,
     bad.length ? String(bad[0].diff) : 'немає');
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
