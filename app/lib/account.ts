/* ============================================================
   REYTER — кабінет покупця
   ------------------------------------------------------------
   Портовано з js/account.js: сюди перебрались лише дані й
   правила. Вхід і хмарний профіль лишились у firebase.ts,
   історія й профіль — у cart.ts, адресна книга — в address.ts,
   а розмітку малює React, тож із неї не потрапило нічого.

   Що тут є:
   • життєвий цикл замовлення — список статусів і крокомір;
   • повторення замовлення — що можна повернути в кошик;
   • картка персонального промокоду — числа й підпис стану.

   Замість глобалів (window.REYTER) каталог, переклад і мова
   приходять параметрами — модуль має працювати й на сервері.
   ============================================================ */

import { getProduct, isSet, setParts, uah, type Catalogue } from './catalog';
import { promoLive, promoTerms, type Promo, type PromoText, type Translate } from './promo';
import type { CartLine, CartPart, OrderItem, OrderStatus } from './types';

/* ============================================================
   СТАТУСИ ЗАМОВЛЕННЯ
   ============================================================ */

/* Порядок статусів. В оригіналі перелік лежав у R.config
   (data.js) разом із підписами, але кабінет ті підписи не читав:
   і назву, і пояснення він щоразу брав з i18n за ключем
   'st.' + id, щоб трекер говорив мовою покупця. Тому сюди
   переїхали самі id — усе інше дає t(). */
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'new',
  'confirmed',
  'shipped',
  'done',
  'cancelled'
];

export interface StatusInfo {
  id: OrderStatus;
  title: string;
  /** Пояснення для покупця. У 'cancelled' такого ключа в словнику
   *  немає — t() поверне сам ключ, але це нікуди не потрапляє:
   *  у скасованого замовлення свій текст (див. trackerHint). */
  hint: string;
}

export function statusList(t: Translate): StatusInfo[] {
  return ORDER_STATUSES.map((id) => ({
    id: id,
    title: t('st.' + id),
    hint: t('st.' + id + 'Hint')
  }));
}

/** Статус приходить із хмари, де полем може виявитись будь-що
 *  (або нічого) — незнайоме показуємо як перший крок. */
export function statusInfo(id: string | null | undefined, t: Translate): StatusInfo {
  const list = statusList(t);
  return list.find((s) => s.id === id) ?? list[0];
}

/* ============================================================
   КРОКОМІР ДОСТАВКИ
   ------------------------------------------------------------
   Те саме, що малював trackerHTML, але без розмітки: звідси йдуть
   самі кроки та їхній стан.
   ============================================================ */

export interface TrackerStep {
  id: OrderStatus;
  title: string;
  /** Крок уже позаду. */
  done: boolean;
  /** Замовлення зараз саме тут. */
  current: boolean;
}

/* Скасування не є кроком шляху: воно може статись на будь-якому
   з них, тож у крокомірі його немає взагалі. */
function pathSteps(t: Translate): StatusInfo[] {
  return statusList(t).filter((s) => s.id !== 'cancelled');
}

function currentIndex(steps: StatusInfo[], status: string | null | undefined): number {
  const i = steps.findIndex((s) => s.id === status);
  return i < 0 ? 0 : i;
}

/** Кроки доставки з поточним положенням замовлення.
 *  Порожній масив — замовлення скасоване: шлях обірвався, і
 *  показувати пройдені кроки було б неправдою. */
export function trackerSteps(status: string | null | undefined, t: Translate): TrackerStep[] {
  if (status === 'cancelled') return [];

  const steps = pathSteps(t);
  const idx = currentIndex(steps, status);
  return steps.map((s, i) => ({
    id: s.id,
    title: s.title,
    done: i < idx,
    current: i === idx
  }));
}

/** Рядок під крокоміром: чого чекати на поточному кроці.
 *  У скасованого замовлення кроків немає, тож підказка заміняє
 *  собою весь крокомір — як і в старому кабінеті. */
export function trackerHint(status: string | null | undefined, t: Translate): string {
  if (status === 'cancelled') return t('st.cancelledFull');

  const steps = pathSteps(t);
  return steps[currentIndex(steps, status)].hint;
}

/* ============================================================
   ПОВТОРЕННЯ ЗАМОВЛЕННЯ
   ============================================================ */

/** Що потрібно від замовлення, щоб його повторити. Order із
 *  cart.ts підходить цілком; тип тут ширший навмисно — у кабінет
 *  замовлення приходять і з хмари, де items може не доїхати, і в
 *  оригіналі це прикривало `order.items || []`. */
export interface RepeatSource {
  items?: OrderItem[] | null;
}

/** Чому позицію не вдалося повернути в кошик. */
export type RepeatSkipReason =
  /** Товару більше немає в каталозі. */
  | 'missing'
  /** Комплект відтоді перебрали — складники вже інші. */
  | 'set_changed'
  /** Товар перестав бути комплектом. */
  | 'not_set';

export interface RepeatSkip {
  item: OrderItem;
  reason: RepeatSkipReason;
}

export interface RepeatResult {
  /** Що ДОДАТИ до кошика, а не яким кошик має стати: позиції,
   *  які там уже є, кошик складе сам. */
  lines: CartLine[];
  skipped: RepeatSkip[];
}

export function repeatOrder(c: Catalogue, order: RepeatSource): RepeatResult {
  const lines: CartLine[] = [];
  const skipped: RepeatSkip[] = [];

  (order.items || []).forEach((i) => {
    const p = getProduct(c, i.id);
    if (!p) {
      skipped.push({ item: i, reason: 'missing' });
      return;
    }

    const parts: CartPart[] = (i.parts || []).map((x) => ({ id: x.id, size: x.size || null }));

    /* Комплект повторюємо з тими самими розмірами складників.
       Якщо склад комплекту з того часу змінили, така позиція
       в кошику не втримається — краще чесно її пропустити,
       ніж відрапортувати успіх і відкрити порожній кошик. */
    if (isSet(p)) {
      const want = setParts(c, p).map((x) => x.id).sort().join(',');
      const have = parts.map((x) => x.id).sort().join(',');
      if (!want || want !== have) {
        skipped.push({ item: i, reason: 'set_changed' });
        return;
      }
    } else if (parts.length) {
      skipped.push({ item: i, reason: 'not_set' });
      return;
    }

    /* В оригіналі позицію додавали qty разів поспіль — cart.add
       кількості не приймає. Тут це одна позиція з тією самою
       кількістю: результат для кошика той самий, а порахувати
       вдале й невдале можна до першого запису. */
    const line: CartLine = { id: i.id, size: i.size || null, qty: i.qty };
    if (parts.length) line.parts = parts;
    lines.push(line);
  });

  return { lines: lines, skipped: skipped };
}

/* ============================================================
   ПЕРСОНАЛЬНІ ЗНИЖКИ
   ------------------------------------------------------------
   Числа й підписи для картки промокоду в кабінеті. Стан коду
   рахує promoLive, умови — promoTerms: той самий рушій, що й
   у кошику та адмінці.
   ============================================================ */

export interface PromoCardDeps extends PromoText {
  /** Момент, на який рахується стан, — як у promoLive. */
  now?: Date;
}

export interface PromoCard {
  code: string;
  /** «−300 грн» або «−10%». */
  value: string;
  /** Умови одним рядком. */
  terms: string;
  /** Підпис стану: діє / скоро / вичерпано… */
  label: string;
  /** false — код зараз не діє: картка гасне, а «Застосувати»
   *  й «Скопіювати» не показуємо взагалі. */
  ok: boolean;
}

export function promoCard(p: Promo, deps: PromoCardDeps): PromoCard {
  const live = promoLive(p, deps.t, deps.now);

  /* Дві гілки рахують число по-різному, і це не помилка порту:
     у fixed немає || 0, тож код без суми показує «−NaN грн».
     Лишаємо як було — поки старий кабінет працює поруч, вони
     мають збігатися до символу. */
  const value =
    p.type === 'fixed'
      ? '−' + uah(Number(p.value), deps.lang ?? 'uk')
      : '−' + (Number(p.value) || 0) + '%';

  return {
    code: p.code ?? '',
    value: value,
    terms: promoTerms(p, deps),
    label: live.label,
    ok: live.ok
  };
}

/** Порядок карток у кабінеті: спершу ті, що згорають раніше.
 *  Коди без строку йдуть на початок — порожній рядок менший за
 *  будь-яку дату.
 *
 *  В оригіналі це сортування стояло всередині promoMine, тобто
 *  біля самого запиту; firebase.ts віддає документи як є, тож
 *  правило живе тут. Сортуємо копію: масив належить викликачу. */
export function sortMyPromos(list: Promo[]): Promo[] {
  return list
    .slice()
    .sort((a, b) => String(a.endsAt || '').localeCompare(String(b.endsAt || '')));
}
