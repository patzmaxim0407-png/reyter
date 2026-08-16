/* ============================================================
   REYTER — клієнти магазину
   ------------------------------------------------------------
   Клієнт — це людина, а не рядок у таблиці замовлень. У базі її
   сліди розкидані двома купами: замовлення в orders і документ
   учасника в loyalty. Тут вони зводяться в одне.

   ЧОМУ ЦЕ ОКРЕМИЙ ФАЙЛ. Замовлення відповідають на питання «що
   ми продали», аналітика — «скільки заробили». Питання «хто в
   нас купує і що з ним робити далі» не мало де жити взагалі:
   щоб дізнатись, чи людина брала щось раніше, доводилось шукати
   її пошту в архіві руками.

   ЗА ЧИМ ЗВОДИМО. За поштою малими літерами — так само, як це
   робить програма лояльності. Пошту звіряє вхід, а телефон той
   самий покупець пише то з +38, то без, то через дефіси. Якщо
   пошти немає зовсім (буває в найстаріших замовленнях), беремо
   девʼять останніх цифр телефону: це гірший ключ, але краще за
   викинуту людину.

   ЧОГО ТУТ НЕМАЄ НАВМИСНО. Ніяких запитів у базу: сюди приходять
   уже прочитані масиви. Через це весь файл — чисті функції, і їх
   можна перевірити тестом, не піднімаючи Firestore.
   ============================================================ */

import { cityOf, dateOf, keyOfBuyer } from './insights';
import { addressLine } from '../address';
import { paidGoods, type MemberDoc } from './loyalty-db';
import { itemCat, type AdminOrder } from './orders';
import type { Catalogue } from '../catalog';

/** Що людина зараз для магазину. Один клієнт — один стан: два
 *  ярлики на одній людині ніхто читати не буде. */
export type Segment =
  /** Вступив у програму, але не купив ще нічого. */
  | 'member'
  /** Перша покупка щойно — його ще памʼятають. */
  | 'new'
  /** Купив один раз і замовк. Найбільша купа грошей, що лежить
   *  на дорозі: людина вже довіряє, але звички ще немає. */
  | 'once'
  /** Купує вдруге й далі. */
  | 'repeat'
  /** Купує часто й багато. */
  | 'vip'
  /** Давно не заходив, але ще не втрачений. */
  | 'sleep'
  /** Не купує так довго, що звичайний лист його вже не поверне. */
  | 'lost';

export interface SegmentInfo {
  id: Segment;
  title: string;
  /** Що це за люди — одним рядком, для підказки в адмінці. */
  hint: string;
  /** Що з ними робити. Порожньо там, де робити нічого не треба. */
  todo: string;
}

export const SEGMENTS: SegmentInfo[] = [
  {
    id: 'vip',
    title: 'Найцінніші',
    hint: 'три покупки й більше, витрачають більше за решту',
    todo: 'їм першим показувати новинки й закриті випуски'
  },
  {
    id: 'repeat',
    title: 'Постійні',
    hint: 'купували вже не раз і не зникали',
    todo: 'опора магазину — не набридати, але й не забувати'
  },
  {
    id: 'new',
    title: 'Новенькі',
    hint: 'перша покупка зовсім недавно',
    todo: 'найкращий час для другої: спитати, чи все підійшло'
  },
  {
    id: 'once',
    title: 'Купили раз',
    hint: 'одна покупка, і відтоді тиша',
    todo: 'найбільша купа грошей на дорозі — довіра вже є, звички ще немає'
  },
  {
    id: 'sleep',
    title: 'Засинають',
    hint: 'купували, але давно не заходили',
    todo: 'привід написати ще є — далі буде пізно'
  },
  {
    id: 'lost',
    title: 'Втрачені',
    hint: 'не купують так довго, що звичайний лист уже не поверне',
    todo: 'лише як частина великої акції — окремо писати не варто'
  },
  {
    id: 'member',
    title: 'Без покупок',
    hint: 'вступили в програму, але не купили нічого',
    todo: 'знають про нас і чекають приводу'
  }
];

/** Межі в днях. Числа не з підручника, а з того, як живе магазин
 *  білизни: її купують не щотижня, і мовчання два місяці ще
 *  нічого не означає. */
export const FRESH = 45;
export const WARM = 150;
export const COLD = 300;

/** Який розмір людина бере в цій категорії. */
export interface Fit {
  category: string;
  size: string;
  /** Скільки разів саме цей розмір. */
  of: number;
  /** Скільки всього одиниць у категорії — щоб було видно, чи це
   *  правило, чи випадковість. */
  all: number;
}

export interface Bought {
  id: string;
  name: string;
  /** Назва категорії так, як її бачив покупець. */
  category: string;
  qty: number;
  /** Сума ДО знижки — лише щоб упорядкувати однаково часті
   *  товари. Показувати її не можна: витрачене рахується після
   *  знижки, і два числа поруч не зійшлися б. */
  sum: number;
}

export interface Client {
  /** Пошта малими літерами; у безпоштових — хвіст телефону. */
  key: string;
  email: string;
  name: string;
  phone: string;
  /** Куди возимо найчастіше. */
  city: string;
  /** Останнє відділення чи адреса — щоб не питати вдруге. */
  place: string;
  /** Документ програми лояльності, якщо людина в ній є. */
  member: MemberDoc | null;

  /** Усі знайдені замовлення, найновіші згори. */
  orders: AdminOrder[];
  /** Скільки з них виконано — саме вони і є покупки. */
  bought: number;
  /** Скільки скасовано: висока частка означає розмову, а не лист. */
  dropped: number;
  /** Витрачено на товари, без доставки. */
  spent: number;
  units: number;
  /** Середній чек за виконаними. */
  avg: number;
  /** Скільки знижок отримав — і чи взагалі купує без них. */
  saved: number;

  first: Date | null;
  last: Date | null;
  /** Днів від останньої покупки. null — не купував нічого. */
  quiet: number | null;
  /** Звичний проміжок між покупками, днів. null — покупка одна. */
  gap: number | null;
  /** Коли за звичкою мав би прийти знову. */
  due: Date | null;

  /** Що бере — за кількістю одиниць, найчастіше згори. */
  favourites: Bought[];
  /** Категорії за кількістю одиниць. */
  cats: Bought[];
  /** Розміри, які замовляв: найчастіший згори. */
  sizes: { size: string; qty: number }[];
  /** Розмірна карта: який розмір людина бере в кожній категорії.
   *
   *  Найкорисніше, що взагалі є в цій картці. Розмір лежить у
   *  кожній позиції кожного замовлення, але як факт ПРО ЛЮДИНУ
   *  ним не користувався ніхто: менеджер у трубці змушував
   *  покупця згадувати, який у нього розмір. Тепер видно
   *  «Бріфи: M у 6 із 7» — і питання не виникає.
   *
   *  Заразом це єдиний спосіб зробити розсилку, якої немає ні в
   *  кого: не «новинки», а «ваш розмір знову в наявності». */
  fits: Fit[];
  /** Промокоди, якими користувався. */
  promos: string[];
  /** Звідки прийшов уперше. */
  channel: string;

  segment: Segment;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Пошта клієнта в тому вигляді, у якому її показують людині. */
function mailOf(o: AdminOrder): string {
  return String(o.email || o.customer?.email || '').trim().toLowerCase();
}

/** Ключ учасника — та сама пошта малими літерами, тож зводиться
 *  з ключем замовлення без жодних перетворень. */
function memberKey(m: MemberDoc): string {
  return String(m.who || '').trim().toLowerCase();
}

const DAY = 86_400_000;

function days(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY));
}

/** Медіана — а не середнє.
 *
 *  Одна покупка через півтора року зсуває середнє так, що
 *  «звичний проміжок» перестає означати хоч щось. Медіана на це
 *  не ведеться. */
export function middle(list: number[]): number {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Скільки треба витратити, щоб вважатись найціннішим.
 *
 *  Не стала в гривнях, а верхня чверть самого магазину: у крамниці
 *  з середнім чеком у 700 грн і в тій, де він 7 000, «багато»
 *  означає різне. Поріг рахується від тих, хто купував.
 *
 *  Мінімум у дві покупки — щоб один дорогий подарунок не робив
 *  людину постійним клієнтом. */
export function richLine(spends: number[]): number {
  const paying = spends.filter((n) => n > 0).sort((a, b) => a - b);
  if (paying.length < 4) return Infinity;
  return paying[Math.floor(paying.length * 0.75)];
}

/** Куди людина потрапляє. Порядок перевірок і є визначенням:
 *  спершу найцінніші, далі за свіжістю. */
export function segmentOf(c: Omit<Client, 'segment'>, rich: number): Segment {
  if (!c.bought) return 'member';
  const quiet = c.quiet ?? 0;

  if (quiet > COLD) return 'lost';
  if (quiet > WARM) return 'sleep';
  if (c.bought >= 3 && c.spent >= rich) return 'vip';
  if (c.bought >= 2) return 'repeat';
  return quiet <= FRESH ? 'new' : 'once';
}

/** Зібрати клієнтів із замовлень і учасників програми.
 *
 *  Учасник без жодного замовлення — теж клієнт: він лишив пошту,
 *  погодився на програму і чекає приводу. Саме таких найлегше не
 *  помітити, бо в списку замовлень їх немає за визначенням. */
export function buildClients(
  orders: AdminOrder[],
  members: MemberDoc[],
  c: Catalogue,
  now: Date = new Date()
): Client[] {
  const byKey = new Map<string, AdminOrder[]>();

  for (const o of orders) {
    const key = keyOfBuyer(o);
    if (!key) continue;
    const box = byKey.get(key);
    if (box) box.push(o);
    else byKey.set(key, [o]);
  }

  const seen = new Map<string, MemberDoc>();
  for (const m of members) {
    const key = memberKey(m);
    if (key) seen.set(key, m);
  }

  const keys = new Set<string>([...byKey.keys(), ...seen.keys()]);
  const raw: Omit<Client, 'segment'>[] = [];

  for (const key of keys) {
    const mine = (byKey.get(key) || []).slice().sort((a, b) => dateOf(b).getTime() - dateOf(a).getTime());
    const member = seen.get(key) || null;
    raw.push(profileOf(key, mine, member, c, now));
  }

  const rich = richLine(raw.map((r) => r.spent));
  return raw
    .map((r) => ({ ...r, segment: segmentOf(r, rich) }))
    .sort((a, b) => b.spent - a.spent || (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));
}

function profileOf(
  key: string,
  mine: AdminOrder[],
  member: MemberDoc | null,
  c: Catalogue,
  now: Date
): Omit<Client, 'segment'> {
  /* Виконані — і тільки вони. Скасоване замовлення грошей не
     принесло, а нове ще може не дійти: рахувати їх у витрачене
     означало б показувати власникові суму, якої він не бачив. */
  const done = mine.filter((o) => o.status === 'done');

  const spent = done.reduce((n, o) => n + paidGoods(o), 0);
  const units = done.reduce((n, o) => n + (o.items || []).reduce((k: number, i) => k + num(i.qty), 0), 0);
  const saved = done.reduce((n, o) => n + Math.max(0, Math.round(num(o.discount))), 0);

  const when = done.map((o) => dateOf(o)).filter((d) => d.getTime() > 0).sort((a, b) => a.getTime() - b.getTime());
  const first = when[0] ?? null;
  const last = when[when.length - 1] ?? null;

  /* Звичний проміжок — медіана відстаней між сусідніми покупками.
     З однієї покупки його не буває: одна точка нічого не каже
     про ритм. */
  const gaps: number[] = [];
  for (let i = 1; i < when.length; i++) gaps.push(days(when[i - 1], when[i]));
  const gap = gaps.length ? middle(gaps) : null;

  const goods = new Map<string, Bought>();
  const cats = new Map<string, Bought>();
  const sizes = new Map<string, number>();
  /* Розміри в розрізі категорій: «M» у трусах і «M» у майках —
     різні факти про ту саму людину. */
  const fits = new Map<string, Map<string, number>>();

  for (const o of done) {
    for (const i of o.items || []) {
      const qty = num(i.qty);
      const sum = num(i.price) * qty;
      const title = itemCat(c, i);

      const g = goods.get(i.id) || { id: i.id, name: i.name || i.id, category: title, qty: 0, sum: 0 };
      g.qty += qty;
      g.sum += sum;
      goods.set(i.id, g);

      const k = cats.get(title) || { id: title, name: title, category: title, qty: 0, sum: 0 };
      k.qty += qty;
      k.sum += sum;
      cats.set(title, k);

      const size = String(i.size || '').trim();
      if (size) {
        sizes.set(size, (sizes.get(size) || 0) + qty);
        const box = fits.get(title) || new Map<string, number>();
        box.set(size, (box.get(size) || 0) + qty);
        fits.set(title, box);
      }
    }
  }

  const byQty = (a: Bought, b: Bought) => b.qty - a.qty || b.sum - a.sum;

  /* Місто й відділення беремо з ОСТАННЬОГО замовлення, а не з
     найчастішого: люди переїжджають, і возити треба туди, куди
     возили востаннє.

     Місто — через cityOf: воно саме прибирає «м.» і знає, що
     закордонне замовлення міста в звичному полі не має. Адресу —
     через addressLine, бо поле називається branch, а не
     warehouse: я спершу написав навмання, і «куди возимо» було
     порожнім у всіх до одного. */
  const latest = mine[0];
  const city = latest ? cityOf(latest) : '';
  const place =
    String(latest?.customer?.branch || '').trim() ||
    (latest ? addressLine(latest.customer) : '');

  const promos = [...new Set(done.map((o) => String(o.promoCode || '').trim()).filter(Boolean))];

  /* Канал — за ПЕРШИМ замовленням: питання «звідки ця людина
     взялась» має одну відповідь, і вона в її першій покупці. */
  const oldest = mine[mine.length - 1];
  const from = (oldest?.customer as { from?: { first?: { channel?: string } } } | undefined)?.from;
  const channel = String(from?.first?.channel || '');

  const mail = mine.map(mailOf).find(Boolean) || (member ? memberKey(member) : '');
  const name = String(latest?.customer?.name || '').trim();
  const phone = String(latest?.customer?.phone || '').trim();

  return {
    key,
    email: mail,
    name,
    phone,
    city,
    place,
    member,
    orders: mine,
    bought: done.length,
    dropped: mine.filter((o) => o.status === 'cancelled').length,
    spent: Math.round(spent),
    units,
    avg: done.length ? Math.round(spent / done.length) : 0,
    saved: Math.round(saved),
    first,
    last,
    quiet: last ? days(last, now) : null,
    gap,
    due: last && gap ? new Date(last.getTime() + gap * DAY) : null,
    favourites: [...goods.values()].sort(byQty),
    cats: [...cats.values()].sort(byQty),
    sizes: [...sizes.entries()].map(([size, qty]) => ({ size, qty })).sort((a, b) => b.qty - a.qty),
    fits: [...fits.entries()]
      .map(([category, box]) => {
        const rows = [...box.entries()].sort((a, b) => b[1] - a[1]);
        const all = rows.reduce((n, r) => n + r[1], 0);
        return { category, size: rows[0][0], of: rows[0][1], all };
      })
      .sort((a, b) => b.all - a.all),
    promos,
    channel
  };
}

/** Пошук по списку: пошта, імʼя, телефон, номер учасника,
 *  Instagram, місто. Так, як менеджер памʼятає людину. */
export function findClients(list: Client[], query: string): Client[] {
  const q = String(query || '').trim().toLowerCase().replace(/^@+/, '');
  if (!q) return list;
  const digits = q.replace(/\D/g, '');
  return list.filter((x) => {
    if (x.email.includes(q)) return true;
    if (x.name.toLowerCase().includes(q)) return true;
    if (x.city.toLowerCase().includes(q)) return true;
    if (digits.length >= 4 && x.phone.replace(/\D/g, '').includes(digits)) return true;
    const m = x.member;
    if (m && String(m.number || '').toLowerCase().includes(q)) return true;
    if (m && String(m.instagram || '').toLowerCase().includes(q)) return true;
    return x.orders.some((o) => String(o.num || '').toLowerCase().includes(q));
  });
}

export type ClientSort = 'spent' | 'recent' | 'often' | 'quiet' | 'new';

export function sortClients(list: Client[], how: ClientSort): Client[] {
  const at = (d: Date | null) => (d ? d.getTime() : 0);
  const copy = [...list];
  if (how === 'recent') return copy.sort((a, b) => at(b.last) - at(a.last));
  if (how === 'often') return copy.sort((a, b) => b.bought - a.bought || b.spent - a.spent);
  /* «Найдовше мовчать» — лише про тих, хто взагалі купував: у
     решти мовчання не означає нічого. */
  if (how === 'quiet') {
    return copy.sort((a, b) => (b.quiet ?? -1) - (a.quiet ?? -1));
  }
  if (how === 'new') return copy.sort((a, b) => at(b.first) - at(a.first));
  return copy.sort((a, b) => b.spent - a.spent);
}

export interface ClientStats {
  people: number;
  buyers: number;
  /** Скільки з покупців повернулись хоч раз. */
  again: number;
  /** Частка тих, хто повернувся, 0–1. */
  loyal: number;
  spent: number;
  /** Скільки в середньому приносить один покупець за весь час. */
  ltv: number;
  bySegment: Record<Segment, number>;
  /** Кому взагалі можна написати: є пошта. */
  reachable: number;
}

export function statsOfClients(list: Client[]): ClientStats {
  const bySegment = {
    member: 0, new: 0, once: 0, repeat: 0, vip: 0, sleep: 0, lost: 0
  } as Record<Segment, number>;

  let buyers = 0;
  let again = 0;
  let spent = 0;
  let reachable = 0;

  for (const x of list) {
    bySegment[x.segment] += 1;
    if (x.bought) buyers += 1;
    if (x.bought >= 2) again += 1;
    spent += x.spent;
    if (x.email) reachable += 1;
  }

  return {
    people: list.length,
    buyers,
    again,
    loyal: buyers ? again / buyers : 0,
    spent,
    ltv: buyers ? Math.round(spent / buyers) : 0,
    bySegment,
    reachable
  };
}


/* ============================================================
   ДОБІР ЗА ПРОГРАМОЮ ЛОЯЛЬНОСТІ
   ------------------------------------------------------------
   Другий, незалежний від стану, зріз. «Постійні» і «третій
   рівень» — різні питання про ту саму людину, і зводити їх в
   один перелік означало б показувати сімнадцять кнопок замість
   восьми.
   ============================================================ */

export type Loyal = 'any' | 'in' | 'out' | 'club' | '1' | '2' | '3' | '4';

export const LOYALS: { id: Loyal; title: string; hint: string }[] = [
  { id: 'any', title: 'Байдуже', hint: 'і учасники, і ні' },
  { id: 'in', title: 'У програмі', hint: 'усі учасники, будь-якого рівня' },
  { id: 'club', title: 'Friendly Club', hint: 'ті, кому відкрито закриті випуски' },
  { id: '1', title: '1 рівень', hint: 'учасники першого рівня' },
  { id: '2', title: '2 рівень', hint: 'учасники другого рівня' },
  { id: '3', title: '3 рівень', hint: 'учасники третього рівня' },
  { id: '4', title: '4 рівень', hint: 'учасники четвертого рівня' },
  { id: 'out', title: 'Не в програмі', hint: 'купували, але не вступили' }
];

export function byLoyal(list: Client[], how: Loyal, inClub: (m: MemberDoc) => boolean): Client[] {
  if (how === 'any') return list;
  if (how === 'out') return list.filter((x) => !x.member);
  if (how === 'in') return list.filter((x) => !!x.member);
  if (how === 'club') return list.filter((x) => !!x.member && inClub(x.member));
  const lvl = Number(how);
  return list.filter((x) => !!x.member && Number(x.member.level) === lvl);
}
