/* ============================================================
   REYTER — що робити з товаром
   ------------------------------------------------------------
   Матриця каже, ДЕ товар стоїть. Цей файл каже, ЩО З ЦИМ РОБИТИ.

   ТРИ ПРАВИЛА, ЯКИХ ТУТ ДОТРИМАНО.

   Перше: жодна порада не існує без числа, з якого вона випливає.
   «Просувати активніше» — це знизування плечима. «Маржа з одиниці
   293 грн, на складі 40 шт: реклама окупиться, якщо приведе 12
   продажів» — порада, бо з неї видно і дію, і межу бюджету.

   Друге: важелі різні. У магазину їх рівно чотири — ціна,
   собівартість, показ і наявність, — і порада мусить називати
   конкретний, а не найзручніший. Шість однакових «дошити» на
   екрані означають не шість проблем, а одне сліпе правило.

   Третє: на трьох продажах висновків не буває. Де даних замало,
   порада або мовчить, або так і каже. Впевнений тон на випадкових
   числах — найдорожча помилка аналітики: за ним закуплять товар.

   ЧОМУ ПОРАДИ ВПОРЯДКОВАНІ ГРОШИМА. Власник читає три пункти, не
   двадцять. Тому кожна знає, скільки грошей на кону, і зверху
   опиняється не найтривожніша, а найдорожча.
   ============================================================ */

import type { Quadrant, Row } from './insights';

export type TipKind =
  | 'stockout'
  | 'thin'
  | 'sizes'
  | 'cost'
  | 'priceUp'
  | 'priceDown'
  | 'ads'
  | 'discount'
  | 'idle'
  | 'engine'
  | 'forecast';

export interface Tip {
  kind: TipKind;
  /** 0 — до відома, 1 — варто глянути, 2 — гроші течуть зараз. */
  urgency: 0 | 1 | 2;
  title: string;
  /** Що відбувається — з числами. */
  what: string;
  /** Що зробити. */
  todo: string;
  /** Скільки грошей на кону: за цим поради й впорядковуються. */
  money: number;
}

export interface Context {
  /** Скільки одиниць лежить на складі просто зараз. */
  stock: number;
  /** Розміри, яких немає, з тих, що товар узагалі має. */
  gone: string[];
  /** Скільки штук кожного розміру продали за період саме цього
   *  товару. Порожньо — розмірів у продажах не видно, і казати,
   *  який із них ходовий, нема з чого. */
  sizeSold?: Record<string, number>;
  /** Скільки всього розмірів у товару. */
  sizes: number;
  /** Днів у періоді, за який рахували продажі. */
  days: number;
  /** Медіанна маржинальність категорії, 0–1. Нуль — невідома. */
  catMargin: number;
  /** Медіанна ціна категорії. */
  catPrice: number;
  /** Скільки штук за період продає СЕРЕДНІЙ товар категорії —
   *  щоб «мало» й «багато» мали з чим порівнюватись. */
  catQty: number;
  /** Середня знижка саме на цей товар, 0–1. */
  discount: number;
  /** І по магазину загалом — щоб було з чим порівняти. */
  shopDiscount: number;
  /** Товар позначено SALE. */
  sale: boolean;
  /** Де він стоїть у матриці. */
  quadrant: Quadrant;
}

/** Скільки одиниць на день. */
export function paceOf(row: Row, days: number): number {
  return days > 0 ? row.qty / days : 0;
}

/** На скільки днів вистачить залишку за поточним темпом.
 *  null — темпу немає, і ділити нема на що. */
export function coverOf(row: Row, ctx: Context): number | null {
  const pace = paceOf(row, ctx.days);
  return pace > 0 ? Math.round(ctx.stock / pace) : null;
}

/** Маржа з одиниці. Собівартості немає — немає й числа. */
export function unitMargin(row: Row): number | null {
  return row.cost === null || !row.qty ? null : Math.round(row.margin / row.qty);
}

/** Маржинальність товару, 0–1. null — рахувати нема з чого. */
export function marginShare(row: Row): number | null {
  return row.cost === null || row.costed <= 0 ? null : row.margin / row.costed;
}

const day = (n: number) => (n === 1 ? 'день' : n < 5 ? 'дні' : 'днів');
const piece = (n: number) => (n === 1 ? 'штуку' : n < 5 ? 'штуки' : 'штук');
const uah = (n: number) => Math.round(n).toLocaleString('uk');

/** Розміри, які беруть найчастіше В СЕРЕДНЬОМУ ПО МАГАЗИНУ.
 *
 *  Це запасний шлях і більше нічого. Довго він був основним: тип
 *  твердив «саме S і L беруть найчастіше» про товар, у якого цих
 *  розмірів ніхто жодного разу не купив, — і власник читав
 *  вигадане число як виміряне. Тепер ходовим вважається той
 *  розмір, який справді купували саме в цьому товарі, а цей
 *  перелік лишається тільки для випадку, коли в продажах розміру
 *  не видно зовсім (старі замовлення, безрозмірний товар). */
const CORE = ['S', 'M', 'L'];

export function tipsFor(row: Row, ctx: Context): Tip[] {
  const tips: Tip[] = [];
  const pace = paceOf(row, ctx.days);
  const perUnit = unitMargin(row);
  const cover = coverOf(row, ctx);
  const mine = marginShare(row);
  const monthly = perUnit ? Math.round(pace * 30 * perUnit) : 0;

  /* Наскільки взагалі можна довіряти висновкам про цей товар.
     Один продаж — це подія, а не тенденція. */
  const solid = row.qty >= 3;

  /* ============================================================
     НАЯВНІСТЬ — гроші течуть просто зараз
     ============================================================ */

  if (row.qty > 0 && ctx.stock === 0) {
    tips.push({
      kind: 'stockout',
      urgency: 2,
      title: 'Скінчився, а його беруть',
      what:
        `продано ${row.qty} ${piece(row.qty)} за ${ctx.days} ${day(ctx.days)}` +
        (pace >= 0.05 ? ` — ${(pace * 30).toFixed(1)} шт на місяць` : '') +
        ', на складі нуль',
      todo: monthly
        ? `Запустити партію. Кожен місяць без нього коштує близько ${uah(monthly)} грн маржі.`
        : 'Запустити партію: попит є, товару немає.',
      money: monthly
    });
  } else if (row.qty > 0 && cover !== null && cover <= 21) {
    tips.push({
      kind: 'thin',
      urgency: cover <= 10 ? 2 : 1,
      title: `Залишку на ${cover} ${day(cover)}`,
      what: `${ctx.stock} шт на складі, темп ${(pace * 30).toFixed(1)} шт на місяць`,
      todo:
        'Запускати пошив зараз: партія робиться довше, ніж лежить цей залишок.' +
        (monthly ? ` Порожня полиця коштуватиме ${uah(monthly)} грн на місяць.` : ''),
      money: Math.round(monthly * 0.6)
    });
  }

  /* Розміри. Порада має сенс лише тоді, коли товар справді
     беруть і бракує саме тих розмірів, які беруть: «немає XS» у
     речі з одним продажем — не проблема, а шум, який витісняє
     важливе.

     Що саме «беруть» — питання до продажів цього товару, а не до
     сталого переліку. Розмір, якого не купили жодного разу, не
     стає ходовим від того, що він зветься S. */
  if (solid && ctx.gone.length && ctx.sizes > 0 && ctx.gone.length < ctx.sizes) {
    const sold = ctx.sizeSold || {};
    const measured = Object.values(sold).reduce((n, x) => n + x, 0);
    const missSold = ctx.gone
      .filter((s) => (sold[s] || 0) > 0)
      .sort((a, b) => (sold[b] || 0) - (sold[a] || 0));

    /* Ходовий — той, що продається не гірше за рівну частку. При
       трьох розмірах це третина: розмір із половиною продажів
       ходовий, розмір із однією штукою з дванадцяти — ні. */
    const core = missSold.filter((s) => (sold[s] || 0) / measured >= 1 / ctx.sizes);
    const named = core.length ? core : missSold;
    const lost = named.reduce((n, s) => n + (sold[s] || 0), 0);
    const share = measured > 0 ? lost / measured : 0;

    const todo =
      'Дошити ці розміри окремо, не чекаючи всієї партії. У видачі товар наявний,' +
      ' і покупець дізнається про брак уже на картці — після цього він іде, а не чекає.';

    if (measured > 0 && named.length) {
      tips.push({
        kind: 'sizes',
        urgency: share >= 0.4 ? 2 : 1,
        title:
          (core.length ? 'Немає ходових розмірів: ' : 'Немає розмірів, які беруть: ') +
          named.join(', '),
        what:
          `лишилось ${ctx.sizes - ctx.gone.length} з ${ctx.sizes}` +
          ` — на ${named.join(' і ')} припало ${lost} з ${measured} проданих`,
        todo,
        money: perUnit ? Math.round(pace * 20 * perUnit * share) : 0
      });
    } else if (!measured) {
      /* Продажі є, а розміру в них не видно: старі замовлення без
         поля або товар, який колись продавали поштучно. Тут
         лишається загальне правило магазину — і сказати про це
         треба прямо, бо це здогад, а не вимір. Через це й гроші
         вдвічі менші: здогад не має стояти в переліку вище за
         пораду, яку порахували. */
      const core0 = ctx.gone.filter((s) => CORE.includes(s));
      if (core0.length) {
        tips.push({
          kind: 'sizes',
          urgency: 1,
          title: `Немає базових розмірів: ${core0.join(', ')}`,
          what:
            `лишилось ${ctx.sizes - ctx.gone.length} з ${ctx.sizes}` +
            ' — у продажах розміру не видно, але без ' +
            core0.join(' і ') +
            ' зазвичай не беруть',
          todo,
          money: perUnit ? Math.round(pace * 10 * perUnit) : 0
        });
      }
    }
  }

  /* ============================================================
     ГРОШІ — ціна й собівартість
     ============================================================ */

  /* Заробляє менше за сусідів. Важелів тут ДВА, і назвати треба
     обидва: ціна вгору або закупівля вниз. Один із них завжди
     неможливий у конкретній ситуації, і власник знає, який. */
  if (mine !== null && row.cost !== null && solid && ctx.catMargin > 0.05) {
    if (mine < ctx.catMargin - 0.06) {
      const fairPrice = Math.ceil(row.cost / Math.max(0.1, 1 - ctx.catMargin));
      const fairCost = Math.floor(row.price * (1 - ctx.catMargin));
      const byPrice = Math.round((fairPrice - row.price) * row.qty);
      const byCost = Math.round((row.cost - fairCost) * row.qty);
      tips.push({
        kind: 'cost',
        urgency: 1,
        title: `Маржа ${Math.round(mine * 100)}% проти ${Math.round(ctx.catMargin * 100)}% у категорії`,
        what: `ціна ${uah(row.price)} при собівартості ${uah(row.cost)} — на кожній речі ви лишаєте менше, ніж на сусідніх`,
        todo:
          `Два важелі. Ціна ${uah(fairPrice)} грн вирівняла б його з категорією` +
          (byPrice > 0 ? ` (+${uah(byPrice)} грн на тому ж обсязі)` : '') +
          `. Або собівартість ${uah(fairCost)} грн у наступній партії` +
          (byCost > 0 ? ` — це ті самі ${uah(byCost)} грн, але без ризику для попиту` : '') +
          '.',
        money: Math.max(byPrice, byCost, 0)
      });
    }
  }

  /* Ціну можна підняти. Умови жорсткі навмисно: попит вищий за
     середній по категорії, запас є, знижок майже немає. Порада
     «підніміть ціну» на товарі, який ледве продається, коштує
     магазину продажів. */
  if (
    solid &&
    ctx.catPrice > 0 &&
    row.price > 0 &&
    row.price < ctx.catPrice * 0.9 &&
    ctx.catQty > 0 &&
    row.qty >= ctx.catQty &&
    ctx.discount < 0.1 &&
    ctx.stock > 0
  ) {
    const to = Math.round(ctx.catPrice);
    const gain = Math.round((to - row.price) * row.qty);
    tips.push({
      kind: 'priceUp',
      urgency: 1,
      title: 'Дешевший за категорію — і його розбирають',
      what:
        `${uah(row.price)} грн проти ${uah(ctx.catPrice)} грн медіани, ` +
        `продано ${row.qty} при середніх ${ctx.catQty} по категорії`,
      todo:
        `Попит витримає ${uah(to)} грн. На тому самому обсязі це ${uah(gain)} грн,` +
        ' і перевіряється це за два тижні: не пішло — повернути ціну назад.',
      money: Math.max(0, gain)
    });
  }

  /* Ціну варто знизити. Ознака: лежить, дорожчий за категорію,
     запас великий. Це не «зробіть знижку» — це «ціна і є
     причина», і різниця названа числом. */
  if (row.qty === 0 && ctx.stock > 0 && ctx.catPrice > 0 && row.price > ctx.catPrice * 1.1) {
    const frozen = row.cost !== null ? Math.round(ctx.stock * row.cost) : 0;
    const to = Math.round(ctx.catPrice);
    tips.push({
      kind: 'priceDown',
      urgency: 1,
      title: 'Дорожчий за категорію — і не продається',
      what:
        `${uah(row.price)} грн проти ${uah(ctx.catPrice)} грн медіани, ` +
        `жодного продажу за ${ctx.days} ${day(ctx.days)}, на складі ${ctx.stock} шт`,
      todo:
        `Ціна тут найімовірніша причина. Спробувати ${uah(to)} грн на два тижні` +
        (row.cost !== null && to > row.cost
          ? ` — це ще ${uah(to - row.cost)} грн маржі з одиниці, тобто не збиток, а менший заробіток`
          : '') +
        '. Не рушить — тоді справа не в ціні, а в показі.',
      money: frozen
    });
  }

  /* ============================================================
     ПОКАЗ — реклама там, де вона окупиться
     ============================================================ */

  /* Реклама має сенс не «щоб продавалось», а там, де одиниця
     приносить достатньо, щоб оплатити залучення. Тому порада
     називає МЕЖУ БЮДЖЕТУ: більше за неї витрачати нема з чого. */
  if (perUnit && perUnit > 0 && ctx.stock >= 5 && row.qty < Math.max(2, ctx.catQty)) {
    /* Половину маржі віддаємо на залучення — решта лишається
       магазину. Це не закон, а обережна межа: за нею реклама
       перестає бути інвестицією й стає витратою. */
    const perSale = Math.floor(perUnit * 0.5);
    const canSell = Math.min(ctx.stock, 20);
    const budget = perSale * canSell;
    tips.push({
      kind: 'ads',
      urgency: ctx.quadrant === 'question' ? 1 : 0,
      title: 'Заробляє добре, а бачать його мало',
      what:
        `${uah(perUnit)} грн маржі з одиниці, на складі ${ctx.stock} шт, ` +
        `продано ${row.qty} за період`,
      todo:
        `Реклама тут окупна: до ${uah(perSale)} грн за продаж — і ви ще в плюсі.` +
        ` Розпродати залишок означає бюджет близько ${uah(budget)} грн.` +
        ' Дешевше за рекламу — поставити його першим у категорії й у добірку «до нього пасує».',
      money: Math.round(ctx.stock * perUnit * 0.5)
    });
  }

  /* Локомотив: його беруть у складі багатьох замовлень. Такий
     товар заробляє не лише собою — він приводить кошик. */
  if (row.orders >= 3 && row.orders >= row.qty * 0.8 && ctx.catQty > 0 && row.qty >= ctx.catQty) {
    tips.push({
      kind: 'engine',
      urgency: 0,
      title: 'Приводить замовлення',
      what: `у ${row.orders} замовленнях із ${row.qty} проданих штук — його беруть як перший вибір`,
      todo:
        'Тримати на видноті й не давати закінчуватись: такі товари заробляють не лише собою,' +
        ' а й тим, що з ними кладуть у кошик.',
      money: 0
    });
  }

  /* ============================================================
     ЗНИЖКА
     ============================================================ */

  if (row.qty > 0 && ctx.discount > 0.12 && ctx.discount > ctx.shopDiscount + 0.05) {
    const eaten = Math.round(row.revenue * ctx.discount);
    const works = ctx.catQty > 0 && row.qty >= ctx.catQty;
    tips.push({
      kind: 'discount',
      urgency: works ? 0 : 1,
      title: `Знижка забирає ${Math.round(ctx.discount * 100)}%`,
      what:
        `по магазину середня ${Math.round(ctx.shopDiscount * 100)}%, тут віддано ${uah(eaten)} грн` +
        (works ? ' — зате обсяг вищий за середній' : ' — і обсяг це не підняло'),
      todo: works
        ? 'Знижка працює: тримає обсяг. Але варто перевірити, чи не піде він так само без неї —' +
          ' два тижні без SALE це покажуть.'
        : 'Знижка не купує обсягу — вона просто зменшує заробіток. Прибрати її й дивитись:' +
          ' якщо продажі не впадуть, ви щойно знайшли гроші на порожньому місці.',
      money: eaten
    });
  }

  /* ============================================================
     ЛЕЖИТЬ
     ============================================================ */

  if (row.qty === 0 && ctx.stock > 0 && !tips.some((t) => t.kind === 'priceDown')) {
    const frozen = row.cost !== null ? Math.round(ctx.stock * row.cost) : 0;
    tips.push({
      kind: 'idle',
      urgency: frozen > 5000 ? 1 : 0,
      title: `Жодного продажу за ${ctx.days} ${day(ctx.days)}`,
      what: `на складі ${ctx.stock} шт` + (frozen ? `, у них заморожено ${uah(frozen)} грн` : ''),
      todo:
        'Перевірити по черзі: чи його видно в категорії, чи не бракує ходових розмірів,' +
        ' чи не завелика ціна. Якщо все на місці — у комплект із ходовим товаром' +
        ' або на розпродаж: місце на полиці коштує дорожче за знижку.',
      money: frozen
    });
  }

  /* ============================================================
     ПРОГНОЗ
     ============================================================ */

  /* Не пророцтво, а проста арифметика темпу — і саме так вона й
     названа. Лінія тренду на семи продажах була б вигадкою. */
  if (solid && perUnit && pace > 0) {
    const inMonth = Math.round(pace * 30);
    const willEarn = Math.round(inMonth * perUnit);
    const runsOut = ctx.stock > 0 ? Math.round(ctx.stock / pace) : 0;
    tips.push({
      kind: 'forecast',
      urgency: 0,
      title: 'За поточним темпом',
      what:
        `${inMonth} шт на місяць — це ${uah(willEarn)} грн маржі` +
        (runsOut ? `, залишку вистачить на ${runsOut} ${day(runsOut)}` : ''),
      todo:
        runsOut && runsOut < 45
          ? `Наступну партію варто мати готовою через ${Math.max(1, runsOut - 21)} ${day(Math.max(1, runsOut - 21))}.`
          : 'Темп стабільний — тут нічого робити не треба, і це теж відповідь.',
      money: 0
    });
  }

  return tips.sort((a, b) => b.urgency - a.urgency || b.money - a.money);
}
