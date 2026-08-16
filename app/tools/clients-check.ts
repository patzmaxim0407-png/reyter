/* ============================================================
   REYTER — перевірка зведення клієнтів
   ------------------------------------------------------------
   Запуск:
     node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/clients-check.ts

   Тут перевіряється те, що помиляється МОВЧКИ: людина, розбита
   надвоє через регістр пошти; сегмент, який поставили не тому;
   середнє замість медіани в ритмі покупок. Жодна з цих помилок
   не падає — вона просто показує власникові неправду.
   ============================================================ */

import {
  COLD,
  FRESH,
  WARM,
  buildClients,
  findClients,
  middle,
  richLine,
  segmentOf,
  sortClients,
  statsOfClients,
  type Client
} from '../lib/admin/clients.ts';
import type { MemberDoc } from '../lib/admin/loyalty-db.ts';

let failed = 0;
function ok(what: string, pass: boolean, got = '') {
  if (pass) console.log('✓ ' + what + (got ? ' — ' + got : ''));
  else {
    failed += 1;
    console.log('✗ ' + what + (got ? ' — ' + got : ''));
  }
}

const NOW = new Date('2026-08-16T12:00:00Z');
const DAY = 86_400_000;

/** Дата за N днів до «зараз» — так у тестах видно намір, а не
 *  довільний рядок. */
function ago(n: number): string {
  return new Date(NOW.getTime() - n * DAY).toISOString();
}

const CAT = {
  products: [
    { id: 'A', name: 'Бріфи classic', price: 550, category: 'briefs' },
    { id: 'B', name: 'Сліпи Menthol', price: 690, category: 'slips' }
  ],
  categories: [
    { id: 'briefs', title: 'Бріфи' },
    { id: 'slips', title: 'Сліпи' }
  ]
} as never;

type Line = { id: string; name?: string; size?: string; qty: number; price: number };

function order(
  who: string,
  when: string,
  lines: Line[],
  extra: Record<string, unknown> = {}
): never {
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  return {
    _id: who + when + Math.round(subtotal),
    num: 'R-' + when.slice(2, 10).replace(/-/g, ''),
    date: when,
    status: 'done',
    email: who,
    subtotal,
    items: lines,
    customer: {
      email: who,
      name: 'Тест',
      phone: '+380991112233',
      city: 'м. Київ',
      carrier: 'Нова Пошта',
      branch: 'Відділення №4'
    },
    ...extra
  } as never;
}

function member(who: string, extra: Partial<MemberDoc> = {}): MemberDoc {
  return {
    who,
    number: 'FC-1',
    instagram: '',
    friendlyAt: '',
    joinedAt: '2026-01-01',
    level: 1,
    points: 0,
    since: '2026-01-01',
    ...extra
  } as MemberDoc;
}

console.log('\nЗВЕДЕННЯ ЛЮДИНИ');
{
  /* Та сама людина в трьох написаннях пошти. Доти вона була б
     трьома різними клієнтами, і жоден із них не виглядав би
     постійним. */
  const orders = [
    order('Petro@Gmail.com', ago(10), [{ id: 'A', qty: 1, price: 550, size: 'M' }]),
    order('petro@gmail.com', ago(60), [{ id: 'A', qty: 2, price: 550, size: 'M' }]),
    order('PETRO@GMAIL.COM', ago(200), [{ id: 'B', qty: 1, price: 690, size: 'L' }])
  ];
  const list = buildClients(orders, [], CAT, NOW);
  ok('регістр пошти не роздвоює людину', list.length === 1, String(list.length));
  ok('усі покупки зійшлись', list[0].bought === 3, String(list[0].bought));
  ok('витрачене без доставки', list[0].spent === 550 + 1100 + 690, String(list[0].spent));
  ok('одиниць порахвано', list[0].units === 4, String(list[0].units));
  ok('улюблена категорія — Бріфи', list[0].cats[0].name === 'Бріфи', list[0].cats[0].name);
  ok('улюблений розмір — M', list[0].sizes[0].size === 'M', list[0].sizes[0].size);

  /* Розмірна карта — найкорисніше в картці: менеджер у трубці
     більше не змушує людину згадувати свій розмір. «M» у трусах і
     «M» у майках — різні факти, тому карта саме в розрізі
     категорій. */
  const fit = list[0].fits.find((f) => f.category === 'Бріфи');
  ok('у бріфах розмір M', !!fit && fit.size === 'M', fit ? fit.size : 'немає');
  ok('видно, чи це правило', !!fit && fit.of === 3 && fit.all === 3, fit ? fit.of + ' із ' + fit.all : '');
  const other = list[0].fits.find((f) => f.category === 'Сліпи');
  ok('в іншій категорії свій розмір', !!other && other.size === 'L', other ? other.size : 'немає');

  /* Куди возимо. Поле називається branch — я спершу написав
     warehouse навмання, і рядок був порожній у всіх до одного.
     Місто йде через cityOf, тож «м.» відпадає само. */
  ok('місто без «м.»', list[0].city === 'Київ', list[0].city);
  ok('відділення на місці', list[0].place === 'Відділення №4', list[0].place);
}

{
  /* Учасник програми без жодної покупки — теж клієнт. Саме таких
     найлегше не помітити: у списку замовлень їх немає за
     визначенням. */
  const list = buildClients([], [member('quiet@x.ua')], CAT, NOW);
  ok('учасник без покупок у списку є', list.length === 1);
  ok('і він саме «без покупок»', list[0].segment === 'member', list[0].segment);
  ok('нуль покупок — нуль витрат', list[0].spent === 0 && list[0].bought === 0);
  ok('пошта взялась із документа учасника', list[0].email === 'quiet@x.ua', list[0].email);
}

{
  /* Покупець, який ще й учасник, лишається однією людиною. */
  const orders = [order('both@x.ua', ago(5), [{ id: 'A', qty: 1, price: 550 }])];
  const list = buildClients(orders, [member('both@x.ua', { points: 550, level: 1 })], CAT, NOW);
  ok('покупець і учасник — одна людина', list.length === 1);
  ok('картка знає про програму', !!list[0].member && list[0].member.points === 550);
}

console.log('\nЩО РАХУЄТЬСЯ');
{
  /* Скасоване й нове замовлення грошей не принесли. Рахувати їх
     у витрачене означало б показувати суму, якої власник не
     бачив. */
  const orders = [
    order('mix@x.ua', ago(5), [{ id: 'A', qty: 1, price: 550 }]),
    order('mix@x.ua', ago(6), [{ id: 'A', qty: 1, price: 550 }], { status: 'cancelled' }),
    order('mix@x.ua', ago(7), [{ id: 'A', qty: 1, price: 550 }], { status: 'new' })
  ];
  const c = buildClients(orders, [], CAT, NOW)[0];
  ok('у витрачене йде лише виконане', c.spent === 550, String(c.spent));
  ok('покупкою рахується лише виконане', c.bought === 1, String(c.bought));
  ok('скасоване видно окремо', c.dropped === 1, String(c.dropped));
  ok('але в історії лишаються всі три', c.orders.length === 3, String(c.orders.length));
}

{
  /* Знижка не зникає: за нею видно, чи людина взагалі купує без
     акцій. */
  const orders = [
    order('off@x.ua', ago(5), [{ id: 'A', qty: 2, price: 550 }], {
      discount: 100,
      promoCode: 'LETO'
    })
  ];
  const c = buildClients(orders, [], CAT, NOW)[0];
  ok('витрачене — за вирахуванням знижки', c.spent === 1000, String(c.spent));
  ok('знижку видно окремо', c.saved === 100, String(c.saved));
  ok('промокод запамʼятався', c.promos.join() === 'LETO', c.promos.join());
}

console.log('\nРИТМ ПОКУПОК');
{
  ok('медіана з непарного', middle([10, 100, 20]) === 20, String(middle([10, 100, 20])));
  ok('медіана з парного', middle([10, 20, 30, 40]) === 25, String(middle([10, 20, 30, 40])));
  ok('порожній список не ламає медіану', middle([]) === 0);

  /* Три покупки з рівним кроком у 30 днів і одна давня-давня.
     Середнє сказало б «раз на пів року» — і наступного листа
     людина дочекалась би вже після того, як пішла до інших. */
  const orders = [
    order('gap@x.ua', ago(0), [{ id: 'A', qty: 1, price: 550 }]),
    order('gap@x.ua', ago(30), [{ id: 'A', qty: 1, price: 550 }]),
    order('gap@x.ua', ago(60), [{ id: 'A', qty: 1, price: 550 }]),
    order('gap@x.ua', ago(500), [{ id: 'A', qty: 1, price: 550 }])
  ];
  const c = buildClients(orders, [], CAT, NOW)[0];
  ok('звичний проміжок — медіана, а не середнє', c.gap === 30, String(c.gap));
  ok('одна покупка ритму не дає', buildClients(
    [order('one@x.ua', ago(3), [{ id: 'A', qty: 1, price: 550 }])], [], CAT, NOW
  )[0].gap === null);
  /* Наступної покупки чекаємо через звичний проміжок ПІСЛЯ
     останньої, а не «десь тепер»: остання була сьогодні, отже
     писати варто десь за місяць. */
  ok('видно, коли чекати знову',
     !!c.due && Math.abs(c.due.getTime() - (NOW.getTime() + 30 * DAY)) < 2 * DAY,
     c.due ? c.due.toISOString().slice(0, 10) : 'немає');
}

console.log('\nСЕГМЕНТИ');
{
  const base = {
    bought: 1, spent: 1000, quiet: 10
  } as unknown as Omit<Client, 'segment'>;

  const at = (bought: number, spent: number, quiet: number) =>
    segmentOf({ ...base, bought, spent, quiet } as Omit<Client, 'segment'>, 5000);

  ok('без покупок — «без покупок»', at(0, 0, 0) === 'member');
  ok('перша покупка щойно — «новенький»', at(1, 800, FRESH - 1) === 'new');
  ok('одна покупка й тиша — «купили раз»', at(1, 800, FRESH + 1) === 'once');
  ok('дві покупки — «постійний»', at(2, 900, 20) === 'repeat');
  ok('три покупки й багато грошей — «найцінніший»', at(3, 9000, 20) === 'vip');
  /* Три покупки, але грошей менше за поріг — це постійний
     клієнт, а не найцінніший. Інакше «найцінніші» перестали б
     означати цінність. */
  ok('три дешеві покупки — ще не найцінніший', at(3, 900, 20) === 'repeat');
  ok('давно мовчить — «засинає»', at(3, 9000, WARM + 1) === 'sleep');
  ok('мовчить дуже давно — «втрачений»', at(3, 9000, COLD + 1) === 'lost');
  /* Мовчання перебиває все: писати найціннішому клієнтові, який
     не заходив рік, треба інакше, ніж тому, хто був учора. */
  ok('мовчання перебиває цінність', at(9, 90000, COLD + 1) === 'lost');
}

{
  /* Поріг «найцінніших» — верхня чверть самого магазину, а не
     стала в гривнях. */
  ok('малій вибірці поріг не вигадується', richLine([100, 200]) === Infinity);
  ok('поріг — верхня чверть', richLine([100, 200, 300, 400, 500, 600, 700, 800]) === 700,
     String(richLine([100, 200, 300, 400, 500, 600, 700, 800])));
  /* Нулі — це ті, хто ще нічого не купив. Якби вони входили в
     поріг, він поповз би вниз рівно тоді, коли в програму
     вступає багато нових людей: «найцінніших» ставало б більше
     від того, що прийшли ті, хто не заплатив ані копійки. */
  ok('нулі в поріг не входять', richLine([0, 0, 100, 200, 300, 400]) === 400,
     String(richLine([0, 0, 100, 200, 300, 400])));
  ok('поріг лишає нагорі саме чверть',
     [100, 200, 300, 400, 500, 600, 700, 800].filter((n) => n >= 700).length === 2);
}

console.log('\nПОШУК І ПОРЯДОК');
{
  const orders = [
    order('petro@x.ua', ago(3), [{ id: 'A', qty: 1, price: 550 }]),
    order('anna@x.ua', ago(100), [{ id: 'B', qty: 5, price: 690 }])
  ];
  const list = buildClients(orders, [member('vip@x.ua', { number: 'FC-777', instagram: 'reyter' })], CAT, NOW);

  ok('пошук за поштою', findClients(list, 'petro').length === 1);
  ok('пошук за номером учасника', findClients(list, 'fc-777').length === 1);
  ok('пошук за Instagram із собачкою', findClients(list, '@reyter').length === 1);
  ok('пошук за телефоном', findClients(list, '0991112233').length === 2, String(findClients(list, '0991112233').length));
  ok('пошук за номером замовлення', findClients(list, 'R-2608').length >= 1);
  ok('порожній запит нічого не відсіює', findClients(list, '  ').length === 3);

  ok('за витраченим — найбільший згори',
     sortClients(list, 'spent')[0].email === 'anna@x.ua', sortClients(list, 'spent')[0].email);
  ok('за останньою покупкою — найсвіжіший згори',
     sortClients(list, 'recent')[0].email === 'petro@x.ua');
  /* «Найдовше мовчать» — про тих, хто купував. Учасник без
     покупок мовчання не має, і сортування не має ставити його
     першим. */
  ok('той, хто не купував, не очолює «найдовше мовчать»',
     sortClients(list, 'quiet')[0].email === 'anna@x.ua', sortClients(list, 'quiet')[0].email);
}

console.log('\nПІДСУМКИ');
{
  const orders = [
    order('one@x.ua', ago(3), [{ id: 'A', qty: 1, price: 550 }]),
    order('two@x.ua', ago(5), [{ id: 'A', qty: 1, price: 550 }]),
    order('two@x.ua', ago(40), [{ id: 'A', qty: 1, price: 550 }])
  ];
  const st = statsOfClients(buildClients(orders, [member('nobuy@x.ua')], CAT, NOW));
  ok('людей усього', st.people === 3, String(st.people));
  ok('із них покупців', st.buyers === 2, String(st.buyers));
  ok('повернувся один', st.again === 1, String(st.again));
  ok('частка тих, хто повертається', Math.round(st.loyal * 100) === 50, String(Math.round(st.loyal * 100)));
  ok('скільки приносить покупець', st.ltv === Math.round(1650 / 2), String(st.ltv));
  ok('кому можна написати', st.reachable === 3, String(st.reachable));
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
