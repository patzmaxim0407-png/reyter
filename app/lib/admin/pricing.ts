/* ============================================================
   REYTER — калькулятор випуску: собівартість і ціна
   ------------------------------------------------------------
   Власник рахує так: рахунки за пошив, чеки за тканину, вартість
   зйомки, пакування — усе разом, поділити на кількість, і це
   собівартість. Від неї ставиться ціна. Тут те саме, тільки
   числами, які не треба тримати в голові.

   ЧОМУ НЕ «СОБІВАРТІСТЬ ×3». З ціни, яку ставлять на сайті, до
   магазину доходить не вся ціна: знижка лояльності, промокод,
   комісія банку, безкоштовна доставка. Множник цього не бачить —
   і саме тому наприкінці сезону виходить менше, ніж рахували.
   Тому головне число тут не ціна, а СКІЛЬКИ З НЕЇ ЗАЛИШИТЬСЯ.

   ЗВІДКИ БЕРУТЬСЯ ВІДСОТКИ. Не з голови: середня знижка — з
   реальних замовлень цієї ж категорії, частка оплат карткою — з
   них же, ціновий ряд — із власного прайсу магазину. Де даних
   замало, функція каже це прямо окремим полем, а не підставляє
   красиве число мовчки.

   ПРО РЕКЛАМУ. Її краще не класти в собівартість: вона не в
   товарі, вона в місяці. Один невдалий таргет інакше зробить річ
   дорожчою назавжди. Тому вона рахується окремим казаном — його
   видно в «скільки штук треба продати, щоб вийти в нуль».
   ============================================================ */

import type { AdminOrder } from './orders';
import type { Catalogue } from '../catalog';
import { linesOf, soldOrders } from './insights';
import type { Product } from '../types';

/** Рядок витрат випуску. */
export interface CostLine {
  id: string;
  title: string;
  /** Скільки грошей. */
  sum: number;
  /** true — сума вказана ЗА ОДИНИЦЮ, а не за всю партію.
   *  Пакування зручніше рахувати штучно, тканину — партією. */
  perUnit: boolean;
  /** Реклама й усе, що не в товарі: у собівартість не входить,
   *  але відбити його теж треба. */
  apart?: boolean;
  /** Артикул, якщо витрата ПРЯМА — тканина саме на бріфи.
   *  Порожньо — витрата спільна на весь випуск і ділиться між
   *  товарами. */
  for?: string;
}

export interface Spend {
  /** Що лягло в товар: ділиться на кількість. */
  goods: number;
  /** Що відбивається окремо — реклама запуску й таке інше. */
  apart: number;
  /** Разом вкладено. */
  total: number;
  /** Собівартість однієї одиниці. */
  unit: number;
}

export function spendOf(lines: CostLine[], units: number): Spend {
  const n = Math.max(0, Math.round(units));
  let goods = 0;
  let apart = 0;

  for (const l of lines) {
    const sum = Math.max(0, Math.round(Number(l.sum) || 0));
    if (!sum) continue;
    const total = l.perUnit ? sum * n : sum;
    if (l.apart) apart += total;
    else goods += total;
  }

  return { goods, apart, total: goods + apart, unit: n ? Math.round(goods / n) : 0 };
}

/* ============================================================
   ЩО ВІДКУШУЮТЬ ВІД ЦІНИ
   ============================================================ */

export interface Leak {
  /** Частка ціни, яка йде знижками, 0–1. */
  discount: number;
  /** Комісія банку на тій частці замовлень, які платять карткою. */
  fee: number;
  /** Разом, 0–1. */
  total: number;
  /** На скількох замовленнях це пораховано. Мало — довіряти рано. */
  sample: number;
}

/** Комісія еквайрингу. Число з договору; тримаємо тут, щоб не
 *  вигадувати його в трьох місцях. */
export const BANK_FEE = 0.014;

/** Скільки з ціни не доходить до магазину — за реальними
 *  замовленнями, а не за припущенням.
 *
 *  Категорія звужує вибірку: знижки в бріфах і в комплектах різні,
 *  і середнє по магазину тут ввело б в оману. Замало даних —
 *  беремо все, що є, і кажемо про це числом sample. */
export function leakOf(
  orders: AdminOrder[],
  c: Catalogue,
  category: string,
  from: Date,
  to: Date
): Leak {
  const byId = new Map((c.products || []).map((p) => [String(p.id), p]));
  const sold = soldOrders(orders, from, to);

  let gross = 0;
  let paid = 0;
  let card = 0;
  let seen = 0;

  for (const o of sold) {
    const lines = linesOf(o, byId);
    const mine = category ? lines.filter((l) => l.category === category) : lines;
    if (!mine.length) continue;

    seen += 1;
    if (o.payInvoiceId) card += 1;

    for (const l of mine) {
      const p = byId.get(l.id);
      gross += Math.round(Number(p?.price) || 0) * l.qty;
      paid += l.paid;
    }
  }

  /* Знижку рахуємо від ПОВНОЇ ціни каталогу, а не від суми
     замовлення: саме її ми й ставимо на сайті, і саме від неї
     потім відкушують. */
  const discount = gross > 0 ? Math.max(0, Math.min(0.9, 1 - paid / gross)) : 0;
  const fee = seen > 0 ? BANK_FEE * (card / seen) : BANK_FEE;
  return { discount, fee, total: Math.min(0.95, discount + fee), sample: seen };
}

/* ============================================================
   РОЗКЛАД ЦІНИ
   ============================================================ */

export interface Split {
  price: number;
  /** Скільки з'їдять знижки. */
  discount: number;
  /** Комісія банку. */
  fee: number;
  /** Скільки дійшло до магазину. */
  net: number;
  cost: number;
  /** Скільки лишилось магазину з однієї речі. */
  earn: number;
  /** Маржинальність від ціни, 0–1. */
  margin: number;
}

export function splitPrice(price: number, cost: number, leak: Leak): Split {
  const p = Math.max(0, Math.round(price));
  const discount = Math.round(p * leak.discount);
  const fee = Math.round((p - discount) * leak.fee);
  const net = Math.max(0, p - discount - fee);
  const earn = net - Math.max(0, Math.round(cost));
  return {
    price: p,
    discount,
    fee,
    net,
    cost: Math.max(0, Math.round(cost)),
    earn,
    margin: p > 0 ? earn / p : 0
  };
}

/** Скільки штук треба продати, щоб вийти в нуль: повернути й
 *  товар, і те, що відбивається окремо. */
export function breakEven(price: number, spend: Spend, leak: Leak): number {
  const net = Math.max(1, Math.round(price * (1 - leak.total)));
  return Math.ceil(spend.total / net);
}

/** Зворотний хід: яку ціну ставити, щоб мати з речі задане
 *  число. Саме так про це й думають — «хочу пʼятсот із трусів». */
export function priceForEarn(earn: number, cost: number, leak: Leak): number {
  const want = Math.max(0, Math.round(earn)) + Math.max(0, Math.round(cost));
  const keep = Math.max(0.05, 1 - leak.total);
  return Math.ceil(want / keep);
}

/* ============================================================
   ЦІНОВИЙ РЯД МАГАЗИНУ
   ============================================================ */

/** Ціни, які вже стоять у прайсі, — від меншої до більшої.
 *  Це і є пороги, до яких варто округляти: 550, 690, 750, 880 —
 *  числа, до яких покупець магазину вже звик. */
export function ladderOf(c: Catalogue, category = ''): number[] {
  const list = (c.products || [])
    .filter((p) => !p.hidden && (!category || p.category === category))
    .map((p) => Math.round(Number(p.price) || 0))
    .filter((n) => n > 0);
  return [...new Set(list)].sort((a, b) => a - b);
}

/** Округлити до власного порога — найближчого НЕ МЕНШОГО.
 *  Менший округлив би ціну вниз під межу беззбитковості, а це
 *  саме те, чого калькулятор має не допускати.
 *
 *  Ряд скінчився — округлюємо до півсотні: так виглядає решта
 *  прайсу, і випадкове число на кшталт 873 у ньому чуже. */
export function toLadder(price: number, ladder: number[]): number {
  const p = Math.max(0, Math.ceil(price));
  const hit = ladder.find((x) => x >= p);
  return hit ?? Math.ceil(p / 50) * 50;
}

/* ============================================================
   ТРИ ЦІНИ
   ============================================================ */

export interface Advice {
  /** Нижче цієї ціни випуск не відбивається. */
  floor: number;
  /** За тим, як магазин уже заробляє в цій категорії. */
  work: number;
  /** Верхня межа того, що прайс уже витримує. */
  bold: number;
  /** Звідки взялась робоча ціна — щоб їй можна було вірити. */
  basis: 'margin' | 'prices' | 'markup';
  /** Скільки товарів категорії з відомою собівартістю. */
  known: number;
}

/** Медіана — не середнє: одна дорога річ інакше тягне весь ряд
 *  угору, і «як у нас прийнято» перестає бути правдою. */
export function median(list: number[]): number {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Скільки магазин лишає собі в цій категорії — за товарами, у
 *  яких собівартість уже вписана. */
export function shopMargin(c: Catalogue, category: string): { value: number; known: number } {
  const rows = (c.products || []).filter(
    (p) =>
      !p.hidden &&
      (!category || p.category === category) &&
      Number(p.price) > 0 &&
      Number(p.cost) > 0 &&
      Number(p.cost) < Number(p.price)
  );
  /* Частку не заокруглюємо: median() працює з грошима й тому
     округлює, а тут навіть пів відсотка зсувають ціну на десятки
     гривень. Беремо середину ряду як є. */
  const shares = rows
    .map((p: Product) => (Number(p.price) - Number(p.cost)) / Number(p.price))
    .sort((a, b) => a - b);
  const mid = Math.floor(shares.length / 2);
  const value = !shares.length
    ? 0
    : shares.length % 2
      ? shares[mid]
      : (shares[mid - 1] + shares[mid]) / 2;
  return { value, known: rows.length };
}

/** Скільки партії справді продається до кінця сезону. Решта йде
 *  на SALE або лежить, і закладати сто відсотків означає ставити
 *  ціну, за якої випуск не відбивається ніколи. */
export const SELL_THROUGH = 0.8;

export function adviseOf(
  spend: Spend,
  units: number,
  leak: Leak,
  c: Catalogue,
  category: string,
  sellThrough = SELL_THROUGH
): Advice {
  const ladder = ladderOf(c, category);
  const keep = Math.max(0.05, 1 - leak.total);

  /* Межа: за скільки треба продати, щоб повернути ВСЕ вкладене,
     продавши лише ту частину партії, яка реально розходиться. */
  const sellable = Math.max(1, Math.round(Math.max(1, units) * sellThrough));
  const floor = toLadder(spend.total / sellable / keep, ladder);

  /* Робоча ціна — за трьома джерелами, у порядку довіри.
     Перше: як магазин уже заробляє в цій категорії. Друге: що
     покупець уже платить за схожу річ. І лише третє — множник,
     і тоді про це треба сказати вголос. */
  const mine = shopMargin(c, category);
  const prices = ladderOf(c, category);

  let work: number;
  let basis: Advice['basis'];

  if (mine.known >= 3 && mine.value > 0.05) {
    basis = 'margin';
    work = toLadder(spend.unit / Math.max(0.05, 1 - mine.value) / keep, ladder);
  } else if (prices.length >= 3) {
    basis = 'prices';
    work = toLadder(median(prices), ladder);
  } else {
    basis = 'markup';
    work = toLadder((spend.unit * 3) / keep, ladder);
  }

  /* Смілива: найдорожче, що вже стоїть у цій категорії. Ряд
     порожній — беремо чверть понад робочу. */
  const bold = prices.length ? toLadder(prices[prices.length - 1], ladder) : toLadder(work * 1.25, ladder);

  return {
    floor,
    work: Math.max(work, floor),
    bold: Math.max(bold, work),
    basis,
    known: mine.known
  };
}
