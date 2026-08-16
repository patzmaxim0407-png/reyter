/* Перевірка правил програми лояльності на числах з умови.

   Тут кожна помилка коштує грошей або довіри: занижений рівень —
   це знижка, якої покупець не отримав; завищений — знижка, якої
   магазин не обіцяв. Тому перевіряються не «типові» випадки, а
   саме межі: бал до порога, день до кінця року, повернення, яке
   зсуває рівень униз.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/loyalty-check.ts
*/
import { daysLeft, initials, niceDay } from '../lib/admin/loyalty-db.ts';
import {
  DEFAULT_RULES,
  LEVELS,
  NEW_MEMBER,
  makeLevels,
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
import {
  findMembers,
  orderDay,
  pastOrdersOf,
  planHistory,
  planHistoryDone,
  clubPending,
  inClub,
  statsOf,
  type MemberDoc
} from '../lib/admin/loyalty-db.ts';
import { readFileSync } from 'node:fs';

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

/* ---------- Межа зарахування історії ---------- */
console.log('\nІСТОРІЯ ПРИ ВСТУПІ');
{
  const m = { ...NEW_MEMBER, who: 'a@b.c', number: 'FC-1', instagram: '', friendlyAt: '', joinedAt: '2026-08-15' };
  const past = [
    { num: 'R-1', paid: 5000, at: '2026-07-01' },  // задавнене
    { num: 'R-2', paid: 3000, at: '2026-08-08' },  // за день до межі
    { num: 'R-3', paid: 2000, at: '2026-08-09' },  // рівно межа
    { num: 'R-4', paid: 1500, at: '2026-09-01' }
  ];
  const plan = planHistory(m as never, past, 'me@reyter.men');
  ok('до межі не рахується', plan?.member.points === 3500, String(plan?.member.points));
  ok('день межі рахується', (plan?.move.note || '').includes('2'), plan?.move.note || '');
  ok('годинник історією не запускається', plan?.member.cycleStart === null);
  ok('рівень порахований', plan?.member.level === 1);

  const old = planHistory(m as never, [{ num: 'R-0', paid: 9000, at: '2026-01-01' }], 'me');
  ok('сама лише давня історія нічого не дає', old === null);
}

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

/* ---------- Екран в адмінці ---------- */
console.log('\nАДМІНКА');
{
  const m = { ...NEW_MEMBER, who: 'petro@ukr.net', number: 'FC-1', instagram: '',
              friendlyAt: '', joinedAt: '2026-08-20', historyPending: true } as never;
  const orders = [
    { email: 'petro@ukr.net', status: 'done', num: 'R-1', date: '2026-08-10T10:00:00Z', subtotal: 2000, discount: 200 },
    { email: 'PETRO@ukr.net', status: 'done', num: 'R-2', date: '2026-08-12T10:00:00Z', subtotal: 1000, discount: 0 },
    { email: 'petro@ukr.net', status: 'cancelled', num: 'R-3', date: '2026-08-13T10:00:00Z', subtotal: 5000, discount: 0 },
    { email: 'petro@ukr.net', status: 'shipped', num: 'R-4', date: '2026-08-14T10:00:00Z', subtotal: 5000, discount: 0 },
    { email: 'petro@ukr.net', status: 'done', num: 'R-5', date: '2026-08-01T10:00:00Z', subtotal: 9000, discount: 0 },
    { email: 'inshyi@ukr.net', status: 'done', num: 'R-6', date: '2026-08-12T10:00:00Z', subtotal: 7000, discount: 0 }
  ];
  const past = pastOrdersOf('petro@ukr.net', orders);
  ok('чужі замовлення не рахуються', past.every((o) => o.num !== 'R-6'));
  ok('регістр пошти не розділяє людину надвоє', past.some((o) => o.num === 'R-2'));
  ok('лише виконані', !past.some((o) => o.num === 'R-3' || o.num === 'R-4'));
  ok('доставка не рахується, знижка віднімається', past[0].paid === 1800, String(past[0].paid));

  const { plan, scan } = planHistoryDone(m, orders, 'me@reyter.men');
  ok('зараховано тільки те, що після межі', plan!.member.points === 2800, String(plan!.member.points));
  ok('прапорець знято', plan!.member.historyPending === false);
  ok('номери зарахованих записано', (plan!.member.historyNums || []).join(',') === 'R-1,R-2',
     (plan!.member.historyNums || []).join(','));
  ok('розбір бачить відкинуте за межею', scan.early === 1, String(scan.early));
  ok('і чуже не рахує своїм', scan.mine === 5, String(scan.mine));

  /* Повторний прохід — після того, як причину нуля виправили.
     Ті самі замовлення вдруге зарахуватись не можуть. */
  const twice = planHistoryDone(plan!.member as never, orders, 'me@reyter.men');
  ok('перерахунок не подвоює бали', twice.plan === null || twice.plan.move.points === 0,
     String(twice.plan?.move.points));

  /* Учасник без жодного виконаного замовлення інакше лишався б у
     черзі назавжди й щоразу муляв би менеджерові очі. */
  const none = planHistoryDone(m, [], 'me@reyter.men');
  ok('порожня історія теж знімає прапорець', none.plan!.member.historyPending === false);
  ok('і лишає слід у журналі', (none.plan!.move.note || '').length > 0, none.plan!.move.note || '');
  ok('балів при цьому не додає', none.plan!.member.points === 0);

  /* ЧОТИРИ РІЗНІ ПРИЧИНИ НУЛЯ. Доки журнал на всі писав
     «минулих замовлень не знайшлось», відрізнити їх було нічим —
     і саме цей запис знищував єдиний доказ. */
  const only = (o: Record<string, unknown>) => planHistoryDone(m, [o] as never, 'x').plan!.move.note || '';
  ok('нуль через межу названо межею',
     /поза межею/.test(only({ email: 'petro@ukr.net', status: 'done', num: 'A', date: '2026-08-01T10:00:00Z', subtotal: 900 })),
     only({ email: 'petro@ukr.net', status: 'done', num: 'A', date: '2026-08-01T10:00:00Z', subtotal: 900 }));
  ok('нуль через статус названо статусом',
     /жодного виконаного/.test(only({ email: 'petro@ukr.net', status: 'shipped', num: 'B', date: '2026-08-12T10:00:00Z', subtotal: 900 })));
  ok('нуль через пошту названо відсутністю замовлень',
     /немає/.test(only({ email: 'hto@ukr.net', status: 'done', num: 'C', date: '2026-08-12T10:00:00Z', subtotal: 900 })));

  /* Замовлення є, виконане, свіже — а сума нульова. Це вже
     несправність даних, і прапорець тут знімати НЕ можна:
     інакше другої спроби не буде ніколи. */
  const broken = planHistoryDone(m, [
    { email: 'petro@ukr.net', status: 'done', num: 'D', date: '2026-08-12T10:00:00Z' }
  ] as never, 'x');
  ok('замовлення без суми лишає учасника в черзі', broken.plan === null);
  ok('і це видно окремим числом', broken.scan.empty === 1, String(broken.scan.empty));

  /* Ручне замовлення довго не мало поля subtotal — і всі такі
     покупки програма бачила нульовими. */
  const manual = planHistoryDone(m, [
    { email: 'petro@ukr.net', status: 'done', num: 'E', date: '2026-08-12T10:00:00Z',
      items: [{ price: 1200, qty: 2 }], discount: 400 }
  ] as never, 'x');
  ok('ручне замовлення рахується за товарами', manual.plan!.move.points === 2000,
     String(manual.plan?.move.points));

  /* Доставка балів не дає — тому запасним шляхом ніколи не може
     стати total: у ньому сидить вартість доставки. */
  const ship = planHistoryDone(m, [
    { email: 'petro@ukr.net', status: 'done', num: 'F', date: '2026-08-12T10:00:00Z',
      items: [{ price: 500, qty: 1 }], shipping: 90, total: 590 }
  ] as never, 'x');
  ok('доставка в бали не потрапляє', ship.plan!.move.points === 500, String(ship.plan?.move.points));

  /* Замовлення, зроблене вже після вступу, бали отримало
     звичайним шляхом. Історія його не чіпає — інакше та сама
     покупка нарахувалася б двічі. */
  const after = planHistoryDone(m, [
    { email: 'petro@ukr.net', status: 'done', num: 'G', date: '2026-08-25T10:00:00Z',
      subtotal: 1000, pointsApplied: true }
  ] as never, 'x');
  ok('нараховане на «Виконано» історія не рахує вдруге', after.scan.already === 1, String(after.scan.already));
  ok('і каже про це прямо', /уже нараховано/.test(after.plan!.move.note || ''), after.plan!.move.note || '');

  /* А от до вступу така позначка нічого не означала: покупця в
     програмі не було, отримувати бали не було кому. */
  const before = planHistoryDone(m, [
    { email: 'petro@ukr.net', status: 'done', num: 'H', date: '2026-08-12T10:00:00Z',
      subtotal: 1000, pointsApplied: true }
  ] as never, 'x');
  ok('до вступу позначка не відбирає балів', before.plan!.move.points === 1000,
     String(before.plan?.move.points));

  /* Межа — це київський день, а не зріз ISO по Гринвічу.
     Замовлення 9 серпня о 01:30 ночі за Києвом зроблене восьмого
     за UTC, і покупець такого пояснення не прийме. */
  ok('ніч на 9 серпня за Києвом уже в програмі', orderDay('2026-08-08T22:30:00Z') === '2026-08-09',
     orderDay('2026-08-08T22:30:00Z'));
  ok('день без дати не вигадується', orderDay('') === '');
}
{
  const mk = (points: number, insta: string, pending = false) => ({
    ...NEW_MEMBER, points, level: levelOf(points), who: points + '@x.c', number: 'FC',
    instagram: insta, friendlyAt: '', joinedAt: '', historyPending: pending
  }) as never;
  const list = [mk(100, ''), mk(7000, ''), mk(25000, 'petro'), mk(25000, ''), mk(50000, 'ivan', true)];
  const st = statsOf(list, [
    { loyaltyOff: 120, status: 'done' },
    { loyaltyOff: 80, status: 'done' },
    {}
  ]);
  ok('учасників порахвано', st.members === 5);
  ok('за рівнями', st.byLevel.join('/') === '1/1/2/1', st.byLevel.join('/'));
  /* У клубі всі, кому дозволив рівень: логін на доступ не
     впливає. А от нагадати про нього варто саме тим, хто його не
     лишив, — це окреме число. */
  ok('у клубі всі, кому дозволив рівень', st.inClub === 3, String(st.inClub));
  ok('і видно, скільки з них без Instagram', st.noInsta === 1, String(st.noInsta));
  ok('черга на історію видна', st.pending === 1);
  ok('віддано знижок', st.given === 200, String(st.given));

  /* Віддано — те, що доїхало до покупця. Скасоване замовлення й
     те, за яке не заплатили, знижки не віддали: рахувати їх
     означало б завищити число, яке дивляться саме тоді, коли
     вирішують, чи не зависока верхня ставка. */
  const mixed = statsOf(list, [
    { loyaltyOff: 500, status: 'done' },
    { loyaltyOff: 400, status: 'cancelled' },
    { loyaltyOff: 300, status: 'new' },
    { loyaltyOff: 200, status: 'confirmed' },
    { loyaltyOff: 100 }
  ]);
  ok('скасоване замовлення знижки не віддало', mixed.given === 500, String(mixed.given));

  ok('пошук за поштою', findMembers(list, '7000@').length === 1);
  ok('пошук за Instagram із собачкою', findMembers(list, '@petro').length === 1);
  ok('порожній запит нічого не ховає', findMembers(list, '  ').length === 5);
}

/* ---------- Драбину задає магазин ---------- */
console.log('\nДРАБИНА З НАЛАШТУВАНЬ');
{
  const mine = [
    { from: 0, percent: 0, friendly: false },
    { from: 3000, percent: 5, friendly: false },
    { from: 10000, percent: 10, friendly: true },
    { from: 25000, percent: 20, friendly: true }
  ];
  const L = makeLevels(mine);
  ok('пороги свої', L.map((l) => l.from).join('/') === '0/3000/10000/25000', L.map((l) => l.from).join('/'));
  ok('верхні межі порахувались самі', L.map((l) => l.to).join('/') === '2999/9999/24999/', L.map((l) => l.to).join('/'));
  ok('рівень за новими порогами', levelOf(3000, L) === 2 && levelOf(2999, L) === 1);
  ok('відсоток за новою драбиною', percentOf(4, L) === 20, String(percentOf(4, L)));
  ok('клуб там, де поставили', isFriendly(2, L) === false && isFriendly(3, L) === true);

  const m = credit({ points: 0, level: 1, cycleStart: null }, 3000, '2026-08-15', L);
  ok('нарахування знає нову драбину', m.level === 2, String(m.level));

  /* Зламану драбину не беремо взагалі: рівень, у який не можна
     ввійти, зупинив би підйом назавжди. */
  const broken = makeLevels([
    { from: 0, percent: 0, friendly: false },
    { from: 9000, percent: 5, friendly: false },
    { from: 5000, percent: 10, friendly: true },
    { from: 25000, percent: 20, friendly: true }
  ]);
  ok('пороги, що не зростають, відкидаються', broken[1].from === 6000, String(broken[1].from));

  const short = makeLevels([{ from: 0, percent: 0, friendly: false }] as never);
  ok('неповна драбина відкидається', short.length === 4);
  ok('порожня теж', makeLevels(null).length === 4);
  ok('відсоток понад межу зрізається',
     makeLevels([
       { from: 0, percent: 0, friendly: false },
       { from: 100, percent: 999, friendly: false },
       { from: 200, percent: 8, friendly: true },
       { from: 300, percent: 15, friendly: true }
     ])[1].percent === 90);

  /* Знижка бере драбину з тих самих налаштувань, що й стеля. */
  const d = discountFor(4, [{ sum: 1000, category: 'x' }], 0, { ...DEFAULT_RULES, levels: mine });
  ok('знижка рахується за драбиною магазину', d.loyalty === 200, String(d.loyalty));
}

/* ---------- Клуб і закриті товари ---------- */
console.log('\nКЛУБ');
{
  const mk = (o: Partial<MemberDoc>) => ({
    ...NEW_MEMBER, who: 'a@b.c', number: 'FC', instagram: '', friendlyAt: '', joinedAt: '', ...o
  }) as MemberDoc;

  /* Клуб відкриває сам рівень. Instagram — не ключ: його просять
     уже в учасника, щоб знати, кого відмічати. Поки він був
     умовою, людина заслуговувала клуб покупками й лишалась за
     порогом через незаповнене поле. */
  ok('третій рівень — уже в клубі, без жодного логіна', inClub(mk({ level: 3, points: 20000 })));
  ok('третій рівень з Instagram — так само в клубі', inClub(mk({ level: 3, points: 20000, instagram: 'petro' })));
  ok('перший рівень з Instagram — не в клубі', !inClub(mk({ level: 1, instagram: 'petro' })));

  /* Клуб руками не питає ні рівня, ні Instagram: це запрошення
     від власника, а не зароблений щабель. */
  ok('клуб руками діє з першого рівня', inClub(mk({ level: 1, clubManual: true })));
  ok('і без Instagram теж', inClub(mk({ level: 1, clubManual: true, instagram: '' })));

  /* І назад: забране руками сильніше за рівень. Інакше «Забрати
     клуб» у третьорівневого не робило б рівно нічого — кнопку
     натиснуто, а закриті товари на місці. */
  ok('клуб забрано руками — рівень не повертає',
     !inClub(mk({ level: 3, points: 20000, instagram: 'petro', clubManual: false })));
  ok('забрано й у четвертого теж',
     !inClub(mk({ level: 4, points: 90000, instagram: 'petro', clubManual: false })));
  ok('відсутній запис — вирішує рівень',
     inClub(mk({ level: 3, points: 20000, instagram: 'petro' })));

  ok('«у клубі, але без логіна» видно окремо',
     clubPending(mk({ level: 3, points: 20000 })) && !clubPending(mk({ level: 3, instagram: 'x' })));
  ok('кому дали руками — теж просимо логін', clubPending(mk({ level: 1, clubManual: true })));
  ok('забраний руками ні про що не просить', !clubPending(mk({ level: 3, clubManual: false })));

  /* Драбину задає магазин — клуб може відчинятися й з другого. */
  const early = makeLevels([
    { from: 0, percent: 0, friendly: false },
    { from: 1000, percent: 5, friendly: true },
    { from: 5000, percent: 10, friendly: true },
    { from: 9000, percent: 15, friendly: true }
  ]);
  ok('клуб там, де його поставили в драбині',
     inClub(mk({ level: 2, points: 1000, instagram: 'petro' }), early));
}

/* ---------- Кошик і воркер мусять збігтися ----------
   Найдорожча розбіжність з усіх: покупець бачить у кошику одну
   суму, а банк просить іншу. Тому драбину у воркері звіряємо
   з нашою просто текстом його ж файла. */
console.log('\nВОРКЕР');
{
  const src = readFileSync(new URL('../../worker/worker.js', import.meta.url), 'utf8');
  const m = src.match(/const LOYALTY = \[([^\]]+)\]/);
  const inWorker = (m ? m[1] : '').split(',').map((x) => Number(x.trim()));
  const ours = [0, ...LEVELS.map((l) => l.percent)];
  ok('запасні ставки у воркері ті самі', JSON.stringify(inWorker) === JSON.stringify(ours),
     JSON.stringify(inWorker) + ' проти ' + JSON.stringify(ours));
  ok('воркер бере драбину з налаштувань', /function percentFrom/.test(src) && /rules\.levels/.test(src));
  ok('воркер читає закритий каталог токеном покупця',
     /published\/friendly', idToken/.test(src));
  ok('воркер читає рівень токеном покупця', /Authorization: 'Bearer ' \+ idToken/.test(src));
  ok('пошта береться з токена, а не з полів запиту', /function emailFromToken/.test(src));
  ok('стеля зрізає саме лояльність', /ceiling - off/.test(src));
}

/* Правила бази — остання межа закритих товарів, і вони мусять
   казати те саме, що застосунок. Правило, м'якше за екран, тихо
   відчиняє двері, показані замкненими; суворіше — ховає товари в
   того, кому їх щойно обіцяли. Звіряємо текстом: виконати
   правила звідси нічим. */
console.log('\nПРАВИЛА БАЗИ');
{
  const src = readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8');
  ok('закритий каталог виведений з-під загального дозволу',
     /allow read: if docId != 'friendly'/.test(src));
  ok('у закритий каталог пускає лише клуб',
     /match \/published\/friendly \{\s*\n\s*allow read: if isAdmin\(\) \|\| inFriendlyClub\(\)/.test(src));
  ok('забране руками зачиняє двері',
     /function clubBanned/.test(src) && /&& !clubBanned\(\)/.test(src));
  ok('рівня досить — логін у правилах не питається',
     !/function clubByLevel\(\)[\s\S]{0,300}?'instagram' in m/.test(src));
}

/* ============================================================
   ДРІБНИЦІ СПИСКУ УЧАСНИКІВ
   ------------------------------------------------------------
   Дата, зіпсута на місяць, у списку людей помітна не одразу —
   тому вона тут.
   ============================================================ */
{
  ok('дата вступу читається як дата', niceDay('2026-08-15') === '15 серп. 2026', niceDay('2026-08-15'));
  ok('перший день місяця без нуля спереду', niceDay('2026-01-05') === '5 січ. 2026', niceDay('2026-01-05'));
  ok('грудень не виходить за межі переліку', niceDay('2026-12-31') === '31 груд. 2026', niceDay('2026-12-31'));
  /* Порожнє й перекручене віддаємо як є: вигадана дата гірша за
     видимий безлад — її ніхто не піде перевіряти. */
  ok('чужий формат лишається собою', niceDay('колись') === 'колись');
  ok('порожня дата не малює нічого', niceDay('') === '');

  ok('ініціали з крапки в пошті', initials('vadym.pavlina@gmail.com') === 'VP', initials('vadym.pavlina@gmail.com'));
  ok('ініціали з підкреслення', initials('anna_b@ukr.net') === 'AB');
  ok('одне слово — дві перші літери', initials('kosmov@gmail.com') === 'KO');
  ok('порожня пошта не ламає кружечок', initials('') === '?');

  const now = new Date('2026-08-16T12:00:00Z');
  ok('термін попереду рахується в днях', daysLeft('2026-09-15', now) === 30, String(daysLeft('2026-09-15', now)));
  ok('сьогоднішній термін — це нуль днів', daysLeft('2026-08-16', now) === 0, String(daysLeft('2026-08-16', now)));
  ok('минулий термін відʼємний', (daysLeft('2026-08-01', now) ?? 0) < 0);
  ok('без терміну немає й числа', daysLeft(null, now) === null);
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
