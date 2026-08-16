/* Перевірка порад.

   Порада — це рішення власника, тож помилка тут дорожча за
   помилку в графіку. Перевіряється головне: що поради спираються
   на числа, що на порожніх даних вони мовчать, і що зверху
   опиняється найдорожча, а не найгучніша.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/advice-check.ts
*/
import { coverOf, paceOf, tipsFor, unitMargin, type Context } from '../lib/admin/advice.ts';
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
  catMargin: 0.4, catPrice: 600, discount: 0.05, shopDiscount: 0.05,
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
  const tips = tipsFor(row(), ctx({ gone: ['S', 'M'] }));
  const sizes = tips.find((t) => t.kind === 'sizes')!;
  ok('розібрані розміри названо поіменно', sizes.title.includes('S, M'));
  ok('половина сітки — це вже терміново', sizes.urgency === 2);
}

console.log('\nСКІЛЬКИ ЗАРОБЛЯЄ');
{
  /* Маржа 20% проти 40% у категорії. Порада мусить назвати ціну,
     яка це виправляє, а не просто констатувати. */
  const low = row({ margin: 1200, cost: 480, costed: 6000 });
  const tips = tipsFor(low, ctx({ catMargin: 0.4 }));
  const m = tips.find((t) => t.kind === 'margin')!;
  ok('низька маржа помічена', !!m);
  ok('названо ціну, яка вирівняє', /800/.test(m.todo), m.todo);
  ok('і скільки це дасть', m.money === (800 - 600) * 10, String(m.money));
}
{
  /* Маржа на рівні категорії — мовчимо. Порада «усе гаразд» це
     шум, за яким перестають читати решту. */
  const tips = tipsFor(row(), ctx({ catMargin: 0.4 }));
  ok('нормальна маржа поради не породжує', !tips.some((t) => t.kind === 'margin'));
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

console.log('\nПОРЯДОК');
{
  /* Разом: і порожній склад, і низька маржа, і знижка. Зверху
     мусить бути те, що коштує найбільше, а не те, що знайшлось
     першим у коді. */
  const tips = tipsFor(
    row({ margin: 1200, cost: 480 }),
    ctx({ stock: 0, discount: 0.3, shopDiscount: 0.05, catMargin: 0.4 })
  );
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
  ok('здоровий товар не сипле порадами', tips.every((t) => t.urgency === 0), String(tips.length));
}

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
