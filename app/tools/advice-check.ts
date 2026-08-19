/* Перевірка порад.

   Порада — це рішення власника, тож помилка тут дорожча за
   помилку в графіку. Перевіряється головне: що поради спираються
   на числа, що на порожніх даних вони мовчать, і що зверху
   опиняється найдорожча, а не найгучніша.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/advice-check.ts
*/
import {
  coverOf,
  marginShare,
  paceOf,
  tipsFor,
  unitMargin,
  type Context
} from '../lib/admin/advice.ts';
import type { Row } from '../lib/admin/insights.ts';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const row = (patch: Partial<Row> = {}): Row => ({
  id: 'A', name: 'Альфа', category: 'briefs',
  revenue: 6000, margin: 2400, qty: 10, orders: 8,
  price: 600, cost: 360, costed: 6000, share: 0.3,
  ...patch
});

const ctx = (patch: Partial<Context> = {}): Context => ({
  stock: 20, gone: [], sizes: 4, days: 30,
  catMargin: 0.4, catPrice: 600, catQty: 10,
  discount: 0.05, shopDiscount: 0.05,
  sale: false, quadrant: 'star',
  ...patch
});

console.log('\nЧИСЛА');
ok('темп — одиниці на день', paceOf(row(), 30) === 10 / 30);
ok('запас у днях', coverOf(row(), ctx({ stock: 20 })) === 60, String(coverOf(row(), ctx({ stock: 20 }))));
ok('без продажів запас не рахується', coverOf(row({ qty: 0 }), ctx()) === null);
ok('маржа з одиниці', unitMargin(row()) === 240, String(unitMargin(row())));
ok('без собівартості маржі з одиниці немає', unitMargin(row({ cost: null })) === null);

console.log('\nГРОШІ ТЕЧУТЬ ЗАРАЗ');
{
  /* Найдорожче з усього: беруть, а купити не можна. Ціна
     зволікання мусить бути НАЗВАНА, інакше це не порада. */
  const tips = tipsFor(row(), ctx({ stock: 0 }));
  ok('порожній склад при попиті — найтерміновіше', tips[0].kind === 'stockout' && tips[0].urgency === 2);
  ok('названо ціну місяця простою', tips[0].money === Math.round((10 / 30) * 30 * 240),
     String(tips[0].money));
  ok('у тексті є числа, а не настрій', /\d/.test(tips[0].what) && /\d/.test(tips[0].todo));
}
{
  const tips = tipsFor(row(), ctx({ stock: 2 }));
  ok('тонкий залишок помічено', tips.some((t) => t.kind === 'thin'));
  ok('і це не те саме, що порожньо', !tips.some((t) => t.kind === 'stockout'));
}
{
  /* Продажі за розмірами: 6 у S, 4 у M, і жодного в XS та XXL. */
  const real = { S: 6, M: 4 };

  const tips = tipsFor(row(), ctx({ gone: ['S', 'M'], sizeSold: real, sizes: 4 }));
  const sizes = tips.find((t) => t.kind === 'sizes')!;
  ok('розібрані ходові розміри названо поіменно', sizes.title.includes('S, M'));
  ok('порада спирається на продажі, а не на перелік',
     sizes.what.includes('10 з 10 проданих'), sizes.what);
  ok('уся демонстрація розібрана — це терміново', sizes.urgency === 2);

  /* Головне, заради чого це переписано. Товар продавався тільки
     в M, а порада твердила «саме S і L беруть найчастіше»:
     число було вигадане, а читалось як виміряне. */
  const lie = tipsFor(row(), ctx({ gone: ['S', 'L'], sizeSold: { M: 10 }, sizes: 3 }));
  ok('розмір без жодного продажу ходовим не називаємо',
     !lie.some((t) => t.kind === 'sizes'),
     lie.map((t) => t.title).join(' · ') || 'порад про розміри немає');

  /* Продається, але слабко: сказати про це можна, назвати
     ходовим — ні. */
  const weak = tipsFor(row(), ctx({ gone: ['L'], sizeSold: { M: 9, L: 1 }, sizes: 3 }));
  const soft = weak.find((t) => t.kind === 'sizes')!;
  ok('рідкісний розмір названо чесно', soft.title.startsWith('Немає розмірів, які беруть'), soft.title);
  ok('і терміновість менша', soft.urgency === 1);
  ok('гроші рахуються з частки, а не з усіх продажів',
     soft.money === Math.round((10 / 30) * 20 * 240 * 0.1), String(soft.money));

  /* Крайні розміри — не те саме. «Немає XS» у речі з одним
     продажем витісняло з екрана справжні проблеми. */
  ok('крайні розміри порадою не стають',
     !tipsFor(row(), ctx({ gone: ['XS', 'XXL'], sizeSold: real })).some((t) => t.kind === 'sizes'));
  ok('і на поодиноких продажах теж мовчимо',
     !tipsFor(row({ qty: 1 }), ctx({ gone: ['S', 'M'], sizeSold: real })).some((t) => t.kind === 'sizes'));

  /* Розміру в продажах не видно зовсім — старі замовлення. Тоді
     лишається загальне правило, і воно назветься здогадом. */
  const blind = tipsFor(row(), ctx({ gone: ['S', 'M'], sizeSold: {}, sizes: 4 }));
  const guess = blind.find((t) => t.kind === 'sizes')!;
  ok('без даних порада не вдає виміряну', guess.title.startsWith('Немає базових розмірів'), guess.title);
  ok('і прямо каже, що розміру в продажах не видно',
     guess.what.includes('у продажах розміру не видно'), guess.what);
  ok('здогад коштує менше за вимір', guess.money < sizes.money, `${guess.money} < ${sizes.money}`);
}

console.log('\nВАЖЕЛІ: ЦІНА Й СОБІВАРТІСТЬ');
{
  /* Маржа 20% проти 40% у категорії. Порада мусить назвати ОБИДВА
     важелі: ціну вгору й закупівлю вниз. Один із них у конкретній
     ситуації завжди неможливий, і власник знає, який саме. */
  const low = row({ margin: 1200, cost: 480, costed: 6000 });
  const m = tipsFor(low, ctx({ catMargin: 0.4 })).find((t) => t.kind === 'cost')!;
  ok('низька маржа помічена', !!m);
  ok('названо ціну, яка вирівняє', /800/.test(m.todo), m.todo);
  ok('названо й собівартість, яка вирівняє', /360/.test(m.todo));
  ok('на кону — більший із двох важелів', m.money === (800 - 600) * 10, String(m.money));
  ok('маржинальність рахується від покритої виручки',
     Math.round((marginShare(low) || 0) * 100) === 20);
}
{
  const tips = tipsFor(row(), ctx({ catMargin: 0.4 }));
  ok('нормальна маржа поради не породжує', !tips.some((t) => t.kind === 'cost'));
}

console.log('\nПІДНЯТИ ЦІНУ');
{
  /* Дешевший за категорію, попит вищий за середній, знижок
     немає, запас є — саме той випадок, коли ціна лишає гроші на
     столі. */
  const cheap = row({ price: 450, qty: 12 });
  const up = tipsFor(cheap, ctx({ catPrice: 600, catQty: 10 })).find((t) => t.kind === 'priceUp')!;
  ok('дешевий і ходовий — піднімати', !!up);
  ok('названо, до скільки', /600/.test(up.todo), up.todo);
  ok('і скільки це дасть', up.money === (600 - 450) * 12, String(up.money));

  /* А ось на слабкому попиті така порада коштувала б продажів. */
  ok('на слабкому попиті ціну не піднімаємо',
     !tipsFor(row({ price: 450, qty: 4 }), ctx({ catPrice: 600, catQty: 10 }))
       .some((t) => t.kind === 'priceUp'));
  ok('і при знижках теж',
     !tipsFor(cheap, ctx({ catPrice: 600, catQty: 10, discount: 0.2 }))
       .some((t) => t.kind === 'priceUp'));
}

console.log('\nЗНИЗИТИ ЦІНУ');
{
  const dear = row({ qty: 0, revenue: 0, margin: 0, costed: 0, price: 900 });
  const down = tipsFor(dear, ctx({ catPrice: 600, stock: 15 })).find((t) => t.kind === 'priceDown')!;
  ok('дорогий і нерухомий — пробувати нижче', !!down);
  ok('названо ціну для спроби', /600/.test(down.todo), down.todo);
  ok('і сказано, що це не збиток', /маржі з одиниці/.test(down.todo));
  ok('на кону — заморожені гроші', down.money === 15 * 360, String(down.money));
  ok('і другої поради про простій уже не буде',
     !tipsFor(dear, ctx({ catPrice: 600, stock: 15 })).some((t) => t.kind === 'idle'));
}

console.log('\nРЕКЛАМА');
{
  /* Реклама радиться не «щоб продавалось», а там, де одиниця
     приносить достатньо, щоб оплатити залучення — і порада
     називає МЕЖУ бюджету. */
  const quiet = row({ qty: 2, revenue: 1200, margin: 480, costed: 1200 });
  const ads = tipsFor(quiet, ctx({ stock: 30, catQty: 10, quadrant: 'question' }))
    .find((t) => t.kind === 'ads')!;
  ok('там, де маржа висока, а продажів мало — реклама', !!ads);
  ok('названо межу за один продаж', /120/.test(ads.todo), ads.todo);
  ok('і бюджет на залишок', /2 400|2400/.test(ads.todo.replace(/\u00a0/g, ' ')), ads.todo);
  ok('порожній склад реклами не потребує',
     !tipsFor(quiet, ctx({ stock: 2 })).some((t) => t.kind === 'ads'));
}
{
  const tips = tipsFor(row(), ctx({ discount: 0.25, shopDiscount: 0.05 }));
  const d = tips.find((t) => t.kind === 'discount')!;
  ok('знижка вища за магазинну помічена', !!d && d.title.includes('25%'));
  ok('названо, скільки віддано', d.money === Math.round(6000 * 0.25), String(d.money));

  const same = tipsFor(row(), ctx({ discount: 0.2, shopDiscount: 0.19 }));
  ok('знижка як у всіх — не новина', !same.some((t) => t.kind === 'discount'));
}

console.log('\nЛЕЖИТЬ');
{
  const tips = tipsFor(row({ qty: 0, revenue: 0, margin: 0, costed: 0 }), ctx({ stock: 30 }));
  const idle = tips.find((t) => t.kind === 'idle')!;
  ok('простій помічено', !!idle);
  ok('названо заморожені гроші', idle.money === 30 * 360, String(idle.money));
  ok('порожній склад без продажів мовчить',
     !tipsFor(row({ qty: 0 }), ctx({ stock: 0 })).some((t) => t.kind === 'idle'));
}

console.log('\nПРОГНОЗ');
{
  const f = tipsFor(row(), ctx({ stock: 20 })).find((t) => t.kind === 'forecast')!;
  ok('прогноз — це арифметика темпу, не пророцтво', !!f && /10 шт на місяць/.test(f.what), f?.what);
  ok('сказано, коли готувати наступну партію', /партію/.test(f.todo) || /темп стабільний/i.test(f.todo));
  ok('на поодиноких продажах прогнозу немає',
     !tipsFor(row({ qty: 1 }), ctx()).some((t) => t.kind === 'forecast'));
}

console.log('\nПОРЯДОК');
{
  /* Разом: і порожній склад, і низька маржа, і знижка. Зверху
     мусить бути те, що коштує найбільше, а не те, що знайшлось
     першим у коді. */
  const tips = tipsFor(
    row({ margin: 1200, cost: 480 }),
    ctx({ stock: 0, discount: 0.3, shopDiscount: 0.05, catMargin: 0.4 })
  );
  ok('важелі різні, а не один шість разів',
     new Set(tips.map((t) => t.kind)).size === tips.length, tips.map((t) => t.kind).join(','));
  ok('поради впорядковані терміновістю, далі грошима',
     tips[0].urgency >= tips[1].urgency);
  ok('кожна порада знає свою ціну', tips.every((t) => typeof t.money === 'number'));
}

console.log('\nМОВЧАННЯ');
{
  /* Товар, з яким усе гаразд: продається, запас є, маржа як у
     сусідів. Єдине, що доречно, — нагадування не дати йому
     закінчитись, і воно без терміновості. */
  const tips = tipsFor(row(), ctx());
  ok('здоровий товар не сипле тривогами', tips.every((t) => t.urgency === 0), String(tips.length));
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
