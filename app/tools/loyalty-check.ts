/* Перевірка правил програми лояльності на числах з умови.

   Тут кожна помилка коштує грошей або довіри: занижений рівень —
   це знижка, якої покупець не отримав; завищений — знижка, якої
   магазин не обіцяв. Тому перевіряються не «типові» випадки, а
   саме межі: бал до порога, день до кінця року, повернення, яке
   зсуває рівень униз.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/loyalty-check.ts
*/
import {
  DEFAULT_RULES,
  LEVELS,
  NEW_MEMBER,
  credit,
  deadlineOf,
  discountFor,
  expire,
  floorOf,
  instagramLogin,
  instagramOk,
  isFriendly,
  levelOf,
  memberNumber,
  needMore,
  nextAt,
  percentOf,
  progressOf,
  refund,
  type LevelNo,
  type Member
} from '../lib/loyalty.ts';
import { paidForGoods, planStatusChange, type AdminOrder } from '../lib/admin/orders.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

/* ---------- Рівні за балами ---------- */
console.log('\nРІВНІ');
ok('нуль балів — перший рівень', levelOf(0) === 1);
ok('5999 — ще перший', levelOf(5999) === 1);
ok('6000 — уже другий', levelOf(6000) === 2);
ok('19999 — ще другий', levelOf(19999) === 2);
ok('20000 — третій', levelOf(20000) === 3);
ok('39999 — ще третій', levelOf(39999) === 3);
ok('40000 — четвертий', levelOf(40000) === 4);
ok('мільйон — теж четвертий', levelOf(1_000_000) === 4);
ok('мінус не ламає', levelOf(-500) === 1);

ok('ставки з умови', LEVELS.map((l) => l.percent).join('/') === '0/4/8/15',
   LEVELS.map((l) => l.percent).join('/'));
ok('клуб — з третього рівня', !isFriendly(1) && !isFriendly(2) && isFriendly(3) && isFriendly(4));
ok('пороги без дірок', LEVELS.every((l, i) => i === 0 || l.from === (LEVELS[i - 1].to ?? 0) + 1));

/* ---------- Нарахування ---------- */
console.log('\nБАЛИ');
{
  const m = credit(NEW_MEMBER, 1420, '2026-08-15');
  ok('замовлення дає бали за гривнями', m.points === 1420, String(m.points));
  ok('перше замовлення запускає рік', m.cycleStart === '2026-08-15', String(m.cycleStart));
  ok('рік рахується від нього', deadlineOf(m) === '2027-08-15', String(deadlineOf(m)));
  ok('до другого рівня лишилось', needMore(m) === 4580, String(needMore(m)));
}
{
  /* Копійки не дають балів: бал — це гривня. */
  const m = credit(NEW_MEMBER, 999.99, '2026-08-15');
  ok('копійки відкидаються вниз', m.points === 999, String(m.points));
}
{
  /* Річний годинник не має перезапускатись на кожному замовленні —
     інакше рік ніколи не скінчиться, і скидання не настане ніколи. */
  const a = credit(NEW_MEMBER, 1000, '2026-08-15');
  const b = credit(a, 1000, '2026-11-20');
  ok('друге замовлення не зсуває початок року', b.cycleStart === '2026-08-15', String(b.cycleStart));
}
{
  const m = credit(NEW_MEMBER, 6000, '2026-08-15');
  ok('рівно поріг піднімає рівень', m.level === 2, String(m.level));
  ok('після підйому годинник зупинено', m.cycleStart === null, String(m.cycleStart));
  ok('бали не обнуляються при підйомі', m.points === 6000, String(m.points));
}
{
  /* Одне велике замовлення може перестрибнути рівень. */
  const m = credit(NEW_MEMBER, 45000, '2026-08-15');
  ok('стрибок через рівні', m.level === 4, String(m.level));
  ok('верхній рівень без терміну', deadlineOf(m) === null);
  ok('верхньому рівню нема куди рости', needMore(m) === 0 && nextAt(4) === null);
}
{
  const m = credit({ points: 5999, level: 1, cycleStart: '2026-08-15' }, 1, '2026-09-01');
  ok('один бал вирішує рівень', m.level === 2 && m.points === 6000);
}

/* ---------- Річне вікно ---------- */
console.log('\nРІК');
{
  const m: Member = { points: 5999, level: 1, cycleStart: '2026-08-15' };
  ok('за день до кінця нічого не скидається',
     expire(m, '2027-08-14').points === 5999);
  const after = expire(m, '2027-08-15');
  ok('у день кінця бали скидаються до підлоги', after.points === 0, String(after.points));
  ok('рівень при цьому лишається', after.level === 1);
  ok('годинник зупинено до наступного замовлення', after.cycleStart === null);
}
{
  /* Найдорожчий випадок з умови: третій рівень, до четвертого
     не вистачило гривні — двадцять тисяч балів згорають. */
  const m: Member = { points: 39999, level: 3, cycleStart: '2026-08-15' };
  const after = expire(m, '2027-08-15');
  ok('третій рівень скидається до своєї підлоги', after.points === 20000, String(after.points));
  ok('рівень третій лишається', after.level === 3);
  ok('втрачено рівно надлишок', 39999 - after.points === 19999);
}
{
  const m: Member = { points: 45000, level: 4, cycleStart: '2026-08-15' };
  ok('четвертий рівень не скидається ніколи', expire(m, '2030-01-01').points === 45000);
}
{
  const m: Member = { points: 100, level: 1, cycleStart: null };
  ok('без замовлень рік не йде', expire(m, '2099-01-01').points === 100);
}
{
  /* Після скидання новий рік починає наступне замовлення. */
  const dead = expire({ points: 5999, level: 1, cycleStart: '2026-08-15' }, '2027-08-15');
  const again = credit(dead, 500, '2027-10-01');
  ok('новий рік від першого замовлення після скидання',
     again.cycleStart === '2027-10-01' && deadlineOf(again) === '2028-10-01');
}

/* ---------- Повернення ---------- */
console.log('\nПОВЕРНЕННЯ');
{
  const m: Member = { points: 7000, level: 2, cycleStart: '2026-08-15' };
  const after = refund(m, 1500);
  ok('бали знімаються', after.points === 5500, String(after.points));
  ok('рівень падає слідом за балами', after.level === 1, String(after.level));
  ok('цикл починається наново', after.cycleStart === null);
}
{
  /* Діра, заради якої рівень і падає: купити на сорок тисяч,
     узяти п'ятнадцять відсотків і повернути все. */
  const bought = credit(NEW_MEMBER, 40000, '2026-08-15');
  const back = refund(bought, 40000);
  ok('повне повернення забирає й рівень', back.level === 1 && back.points === 0,
     back.level + '/' + back.points);
}
{
  const m: Member = { points: 7000, level: 2, cycleStart: '2026-08-15' };
  const after = refund(m, 100);
  ok('дрібне повернення рівня не чіпає', after.level === 2 && after.cycleStart === '2026-08-15');
}
{
  ok('нижче нуля бали не йдуть', refund({ points: 100, level: 1, cycleStart: null }, 500).points === 0);
}

/* ---------- Знижка ---------- */
console.log('\nЗНИЖКА');
const lines = [
  { sum: 820, category: 'jocks' },
  { sum: 550, category: 'briefs' }
];
{
  const d = discountFor(1, lines, 0);
  ok('перший рівень знижки не дає', d.loyalty === 0);
}
{
  const d = discountFor(3, lines, 0);
  ok('третій рівень — вісім відсотків', d.loyalty === Math.round(1370 * 0.08), String(d.loyalty));
}
{
  const d = discountFor(3, lines, 0, DEFAULT_RULES, false);
  ok('покупець вимкнув — знижки немає', d.loyalty === 0);
}
{
  /* Сумується з промокодом: обидві від суми товарів. */
  const d = discountFor(4, lines, 200);
  ok('сумується з промокодом', d.total === 200 + Math.round(1370 * 0.15), String(d.total));
}
{
  /* Стеля зрізає саме лояльність, промокод лишається цілим. */
  const d = discountFor(4, lines, 380, { cap: 30, skipSale: false, skipCats: [] });
  ok('стеля спрацювала', d.capped);
  ok('промокод не зрізано', d.promo === 380, String(d.promo));
  ok('сумарно не більше стелі', d.total <= Math.floor(1370 * 0.3), d.total + ' із ' + Math.floor(1370 * 0.3));
}
{
  const d = discountFor(4, [{ sum: 1000, category: 'jocks', sale: true }], 0,
    { cap: 30, skipSale: true, skipCats: [] });
  ok('на SALE не діє, коли вимкнено', d.loyalty === 0);
}
{
  const d = discountFor(4, [
    { sum: 1000, category: 'jocks' },
    { sum: 1000, category: 'swim' }
  ], 0, { cap: 30, skipSale: false, skipCats: ['swim'] });
  ok('категорія-виняток не рахується', d.loyalty === 150, String(d.loyalty));
  ok('база знижки — лише дозволене', d.base === 1000, String(d.base));
}
{
  const d = discountFor(4, lines, 5000);
  ok('знижка не перевищує вартість товарів', d.total <= 1370, String(d.total));
}

/* ---------- Смужка прогресу ---------- */
console.log('\nПОКАЗ');
{
  const p = progressOf({ points: 3797, level: 1, cycleStart: '2026-08-15' });
  ok('приклад з умови: рівень і залишок', p.level === 1 && p.need === 2203, p.level + '/' + p.need);
  ok('смужка десь посередині', p.ratio > 0.6 && p.ratio < 0.7, p.ratio.toFixed(2));
  ok('термін показано', p.deadline === '2027-08-15', String(p.deadline));
}
{
  const p = progressOf({ points: 41000, level: 4, cycleStart: null });
  ok('верхній рівень — смужка повна', p.ratio === 1 && p.to === null);
  ok('верхній рівень у клубі', p.friendly && p.percent === 15);
}

/* ---------- Дрібниці ---------- */
console.log('\nДРІБНИЦІ');
ok('номер учасника читається вголос', /^FC-\d{8}$/.test(memberNumber('petro@ukr.net')), memberNumber('petro@ukr.net'));
ok('номер сталий', memberNumber('Petro@Ukr.net') === memberNumber('petro@ukr.net '));
ok('різні пошти — різні номери', memberNumber('a@b.c') !== memberNumber('d@e.f'));
ok('логін чиститься від адреси',
   instagramLogin('https://instagram.com/Reyter.UA/') === 'reyter.ua',
   instagramLogin('https://instagram.com/Reyter.UA/'));
ok('собачка не заважає', instagramLogin('  @Reyter_UA ') === 'reyter_ua', instagramLogin('  @Reyter_UA '));
ok('порожній логін не проходить', !instagramOk(''));
ok('пробіл усередині не проходить', !instagramOk('reyter ua'));
ok('звичайний логін проходить', instagramOk('reyter.ua'));

/* ---------- Числа з умови ---------- */
console.log('\nСКІЛЬКИ ТРЕБА ВИТРАТИТИ');
for (const l of LEVELS) {
  const up = nextAt(l.level as LevelNo);
  if (up === null) continue;
  const need = up - l.from;
  console.log(
    `  рівень ${l.level} → ${l.level + 1}: ${need.toLocaleString('uk')} балів` +
      ` · ${Math.round(need / 12).toLocaleString('uk')} грн/міс` +
      ` · ~${Math.ceil(need / 1400)} замовлень по 1400`
  );
}
console.log(
  '  вартість дороги до 4 рівня для магазину: ~' +
    Math.round(
      (20000 - 6000) / (1 - percentOf(2) / 100) - (20000 - 6000) +
      ((40000 - 20000) / (1 - percentOf(3) / 100) - (40000 - 20000))
    ).toLocaleString('uk') + ' грн знижок'
);

/* ---------- Нарахування за статусом замовлення ---------- */
console.log('\nСТАТУС ЗАМОВЛЕННЯ');
{
  const order = {
    _id: 'x', num: 'R-1', subtotal: 1500, discount: 100, shipping: 80, total: 1480,
    items: [], customer: {}, date: '2026-08-15', status: 'shipped'
  } as unknown as AdminOrder;
  const at = { now: new Date('2026-08-15'), by: 'me@reyter.men' };
  const noAsk = { putBack: true, lost: null } as never;

  ok('доставка балів не дає', paidForGoods(order) === 1400, String(paidForGoods(order)));

  const done = planStatusChange(order, 'done', noAsk, at);
  ok('«Виконано» нараховує', done.points.kind === 'credit', done.points.kind);
  ok('ознака ставиться', done.update.pointsApplied === true);

  const again = planStatusChange({ ...order, status: 'done', pointsApplied: true } as AdminOrder, 'done', noAsk, at);
  ok('удруге не нараховує', again.points.kind === 'none', again.points.kind);

  /* Найтонше місце: цей перехід лишається всередині CONSUMING,
     склад не рухається — а бали зніматись мусять. */
  const back = planStatusChange(
    { ...order, status: 'done', pointsApplied: true, stockApplied: true } as AdminOrder,
    'shipped', noAsk, at
  );
  ok('відкат «Виконано → Відправлено» знімає бали', back.points.kind === 'refund', back.points.kind);
  ok('склад при цьому не рухається', back.stock.kind === 'none', back.stock.kind);
  ok('ознака знімається', back.update.pointsApplied === false);

  const cancel = planStatusChange({ ...order, status: 'done', pointsApplied: true } as AdminOrder, 'cancelled', noAsk, at);
  ok('скасування теж знімає', cancel.points.kind === 'refund');

  const confirm = planStatusChange(order, 'confirmed', noAsk, at);
  ok('«Підтверджено» балів не дає', confirm.points.kind === 'none');

  /* Туди-сюди-туди не має подвоїти. */
  let m: Member = { points: 0, level: 1, cycleStart: null };
  m = credit(m, 1400, '2026-08-15');
  m = refund(m, 1400);
  m = credit(m, 1400, '2026-08-20');
  ok('виконано → відкат → виконано дає рівно одне нарахування', m.points === 1400, String(m.points));
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
