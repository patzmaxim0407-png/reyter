/* ============================================================
   REYTER — що робити з товаром
   ------------------------------------------------------------
   Матриця каже, ДЕ товар стоїть. Цей файл каже, ЩО З ЦИМ РОБИТИ —
   і каже числами, а не настроєм.

   ПРАВИЛО, ЯКОГО ТУТ ДОТРИМАНО СКРІЗЬ: жодна порада не існує без
   числа, з якого вона випливає. «Просувати активніше» — це не
   порада, це знизування плечима. «Закінчився сьомого числа, а
   брали по дві штуки на тиждень — місяць простою коштує 1 800
   грн маржі» — порада, бо з неї видно і причину, і ціну
   зволікання.

   І ДРУГЕ ПРАВИЛО: на трьох продажах висновків не буває. Там, де
   даних замало, поради або немає зовсім, або вона так і каже.
   Впевнений тон на випадкових числах — найдорожча помилка
   аналітики: за ним закуплять товар.

   ЧОМУ ПОРАДИ ВПОРЯДКОВАНІ ГРОШИМА. Власник не читає двадцять
   пунктів. Він читає три. Тому кожна порада знає, скільки грошей
   на кону, і зверху опиняється не найтривожніша, а найдорожча.
   ============================================================ */

import type { Quadrant, Row } from './insights';

export type TipKind =
  | 'stockout'
  | 'thin'
  | 'sizes'
  | 'margin'
  | 'discount'
  | 'idle'
  | 'star'
  | 'question'
  | 'price';

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
  /** Скільки всього розмірів у товару. */
  sizes: number;
  /** Днів у періоді, за який рахували продажі. */
  days: number;
  /** Медіанна маржинальність категорії, 0–1. Нуль — невідома. */
  catMargin: number;
  /** Медіанна ціна категорії. */
  catPrice: number;
  /** Середня знижка саме на цей товар, 0–1. */
  discount: number;
  /** І по магазину загалом — щоб було з чим порівняти. */
  shopDiscount: number;
  /** Товар позначено SALE. */
  sale: boolean;
  /** Де він стоїть у матриці. */
  quadrant: Quadrant;
}

/** Скільки одиниць на день. Нуль днів не буває, але хай. */
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

const day = (n: number) => (n === 1 ? 'день' : n < 5 ? 'дні' : 'днів');
const piece = (n: number) => (n === 1 ? 'штуку' : n < 5 ? 'штуки' : 'штук');
const uah = (n: number) => Math.round(n).toLocaleString('uk');

/** Поради для одного товару — від найдорожчої до найдрібнішої. */
export function tipsFor(row: Row, ctx: Context): Tip[] {
  const tips: Tip[] = [];
  const pace = paceOf(row, ctx.days);
  const perUnit = unitMargin(row);
  const cover = coverOf(row, ctx);

  /* ---------- Гроші течуть зараз ---------- */

  /* Найдорожче з усього: товар беруть, а купити його не можна.
     Ціна зволікання рахується прямо — темп × маржа × місяць. */
  if (row.qty > 0 && ctx.stock === 0) {
    const lost = perUnit ? Math.round(pace * 30 * perUnit) : 0;
    tips.push({
      kind: 'stockout',
      urgency: 2,
      title: 'Закінчився, а його беруть',
      what:
        `за період продано ${row.qty} ${piece(row.qty)}` +
        (pace >= 0.1 ? ` — це ${(pace * 7).toFixed(1)} шт на тиждень` : '') +
        ', на складі порожньо',
      todo: lost
        ? `Замовити партію. Місяць без нього коштує близько ${uah(lost)} грн маржі.`
        : 'Замовити партію: попит є, товару немає.',
      money: lost
    });
  } else if (row.qty > 0 && cover !== null && cover <= 14) {
    /* Двох тижнів мало на пошив: поки шитимуть, полиця спорожніє. */
    const lost = perUnit ? Math.round(pace * 30 * perUnit) : 0;
    tips.push({
      kind: 'thin',
      urgency: cover <= 7 ? 2 : 1,
      title: 'Залишку на ' + cover + ' ' + day(cover),
      what: `на складі ${ctx.stock} шт, беруть ${(pace * 7).toFixed(1)} шт на тиждень`,
      todo:
        'Запускати пошив зараз, а не коли закінчиться: партія робиться довше, ніж лежить залишок.' +
        (lost ? ` Простій коштуватиме ${uah(lost)} грн маржі на місяць.` : ''),
      money: Math.round(lost * 0.5)
    });
  }

  /* Ходові розміри розібрали. Товар ніби є, а купити нема чого:
     саме S і M забирають першими. */
  if (row.qty > 0 && ctx.gone.length && ctx.sizes > 0 && ctx.gone.length < ctx.sizes) {
    tips.push({
      kind: 'sizes',
      urgency: ctx.gone.length >= Math.ceil(ctx.sizes / 2) ? 2 : 1,
      title: 'Немає розмірів: ' + ctx.gone.join(', '),
      what: `лишилось ${ctx.sizes - ctx.gone.length} з ${ctx.sizes} розмірів`,
      todo:
        'Дошити саме ці розміри. Товар у видачі виглядає наявним, а половина покупців бачить,' +
        ' що їхнього немає, і йде.',
      money: perUnit ? Math.round(pace * 15 * perUnit) : 0
    });
  }

  /* ---------- Скільки він заробляє ---------- */

  /* Маржинальність нижча за сусідів по категорії. Головне тут —
     назвати ЦІНУ, яка це виправляє, а не сам факт. */
  if (row.cost !== null && row.qty > 0 && ctx.catMargin > 0.05 && row.costed > 0) {
    const mine = row.margin / row.costed;
    if (mine < ctx.catMargin - 0.06) {
      const fair = Math.ceil(row.cost / Math.max(0.1, 1 - ctx.catMargin));
      const gain = Math.round((fair - row.price) * row.qty);
      tips.push({
        kind: 'margin',
        urgency: 1,
        title: 'Заробляє менше за сусідів',
        what:
          `${Math.round(mine * 100)}% проти ${Math.round(ctx.catMargin * 100)}% у категорії` +
          ` — при собівартості ${uah(row.cost)} грн`,
        todo:
          fair > row.price
            ? `Ціна ${uah(fair)} грн вирівняла б його з категорією` +
              (gain > 0 ? ` — це ${uah(gain)} грн на тому ж обсязі.` : '.') +
              ' Або дешевша закупівля в наступній партії.'
            : 'Перевірити закупівлю: ціна вже на рівні категорії, різницю робить собівартість.',
        money: Math.max(0, gain)
      });
    }
  }

  /* Знижка з'їдає заробіток. Сама по собі вона не зло — злом її
     робить те, що її не помічають. */
  if (row.qty > 0 && ctx.discount > 0.12 && ctx.discount > ctx.shopDiscount + 0.05) {
    const eaten = Math.round(row.revenue * ctx.discount);
    tips.push({
      kind: 'discount',
      urgency: 1,
      title: 'Знижка забирає ' + Math.round(ctx.discount * 100) + '%',
      what:
        `по магазину середня ${Math.round(ctx.shopDiscount * 100)}%` +
        (eaten ? `, на цьому товарі віддано близько ${uah(eaten)} грн` : ''),
      todo: ctx.sale
        ? 'Він на SALE. Варто перевірити, чи тримає знижка продажі — чи їх тримає сам товар.'
        : 'Подивитись, чи не б’ють по ньому промокоди щоразу: знижка має бути рішенням, а не звичкою.',
      money: eaten
    });
  }

  /* ---------- Лежить ---------- */

  if (row.qty === 0 && ctx.stock > 0) {
    const frozen = row.cost !== null ? Math.round(ctx.stock * row.cost) : 0;
    tips.push({
      kind: 'idle',
      urgency: frozen > 5000 ? 1 : 0,
      title: 'Жодного продажу за період',
      what:
        `на складі ${ctx.stock} шт` +
        (frozen ? `, у них заморожено ${uah(frozen)} грн` : ''),
      todo:
        'Три робочі варіанти: у комплект із ходовим, у розсилку з приводом, або на розпродаж —' +
        ' місце на полиці коштує дорожче за знижку.',
      money: frozen
    });
  }

  /* ---------- Що робити з тим, що вже добре ---------- */

  if (ctx.quadrant === 'star' && row.qty >= 3) {
    tips.push({
      kind: 'star',
      urgency: 0,
      title: 'Зірка',
      what:
        `${row.qty} ${piece(row.qty)} і ${uah(row.margin)} грн маржі` +
        (cover !== null ? `, залишку на ${cover} ${day(cover)}` : ''),
      todo:
        'Найдешевший спосіб заробити більше — не дати йому закінчитись і показувати першим.' +
        ' Нового товару це коштує втричі дорожче.',
      money: 0
    });
  }

  /* Висока маржа, мало продажів. Це не «поганий товар» — це
     товар, якого не бачать, і саме тут найбільший запас росту. */
  if (ctx.quadrant === 'question' && perUnit) {
    tips.push({
      kind: 'question',
      urgency: 1,
      title: 'Заробляє добре, а беруть мало',
      what: `${uah(perUnit)} грн з одиниці — більше за середнє, але лише ${row.qty} ${piece(row.qty)}`,
      todo:
        'Спробувати показати: перші ряди в категорії, окремий пост, добірка «до нього пасує».' +
        ' Тут зростання дешевше, ніж деінде: маржа вже висока.',
      money: perUnit * Math.max(1, row.qty)
    });
  }

  /* Ціна нижча за категорію, а попит є. Найтихіша з усіх втрат. */
  if (row.qty >= 3 && ctx.catPrice > 0 && row.price > 0 && row.price < ctx.catPrice * 0.85) {
    const gain = Math.round((ctx.catPrice - row.price) * row.qty);
    tips.push({
      kind: 'price',
      urgency: 0,
      title: 'Дешевший за категорію, а беруть',
      what: `${uah(row.price)} грн проти ${uah(ctx.catPrice)} грн медіани — і ${row.qty} ${piece(row.qty)} продано`,
      todo: `Попит витримає більше. ${uah(gain)} грн лишились на столі на тому ж обсязі.`,
      money: gain
    });
  }

  return tips.sort((a, b) => b.urgency - a.urgency || b.money - a.money);
}
