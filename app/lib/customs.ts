/* ============================================================
   REYTER — дані для митної декларації
   ------------------------------------------------------------
   Посилка за кордон без декларації не їде. Перевізникові на
   кожну позицію потрібні чотири речі: код УКТЗЕД (він же HS),
   опис англійською, кількість і вага. Раніше менеджер збирав це
   в кабінеті вручну — на кожне замовлення, з нуля, і саме тут
   найлегше помилитись: не той код або занижена вартість
   обертаються переоцінкою на митниці.

   Тепер замовлення приносить готовий перелік. Коди не вигадані:
   узяті з класифікатора самої Нової Пошти 11.08.2026 —
   /dictionary/classifier?country-code=UA&keyword=…

   Ваги приблизні, і це чесно: у товарів у базі ваги немає. Вони
   з запасом, бо занижена вага на митниці дорожча за завищену, а
   тариф до 2 кг однаково плаский.
   ============================================================ */

import { getProduct, isSet, setParts, type Catalogue } from './catalog';
import type { CartLine } from './types';

interface Тип {
  /** Код УКТЗЕД (HS) — 8 цифр, як вимагає перевізник. */
  hs: string;
  /** Опис англійською: саме його читає митниця. */
  en: string;
  /** Опис українською — для накладної й для менеджера. */
  uk: string;
  /** Вага одиниці, кг. */
  вага: number;
}

/* Категорія → чим вона є для митниці. Перелік навмисно
   короткий: усе, чого тут немає, стає звичайною білизною —
   найближчим і найбезпечнішим описом для нашого асортименту. */
const ТИПИ: Record<string, Тип> = {
  briefs:  { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', вага: 0.08 },
  slips:   { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', вага: 0.08 },
  boxers:  { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', вага: 0.09 },
  jocks:   { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', вага: 0.07 },
  ribbed:  { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', вага: 0.08 },
  royal:   { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', вага: 0.08 },
  tanks:   { hs: '61091000', en: "Men's knitted cotton t-shirt", uk: 'Чоловіча трикотажна майка', вага: 0.13 },
  sorochky: { hs: '62052000', en: "Men's cotton shirt", uk: 'Чоловіча сорочка', вага: 0.25 },
  swim:    { hs: '62111100', en: "Men's swim shorts", uk: 'Чоловічі плавальні шорти', вага: 0.15 },
  'home-collection': { hs: '61079100', en: "Men's knitted homewear", uk: 'Чоловічий домашній одяг', вага: 0.35 }
};

const ТИПОВЕ: Тип = ТИПИ.briefs;

export interface CustomsItem {
  hs: string;
  en: string;
  uk: string;
  qty: number;
  /** Вага всієї позиції, кг. */
  weight: number;
  /** Вартість усієї позиції, грн. */
  cost: number;
}

function тип(c: Catalogue, id: string): Тип {
  const p = getProduct(c, id);
  return (p && ТИПИ[String(p.category)]) || ТИПОВЕ;
}

/** Перелік для декларації. Комплект розкладаємо на складові:
 *  митниця декларує речі, а не наші набори. */
export function customsItems(c: Catalogue, lines: CartLine[]): CustomsItem[] {
  const out = new Map<string, CustomsItem>();

  const додати = (t: Тип, qty: number, cost: number) => {
    const було = out.get(t.hs + '|' + t.en);
    if (було) {
      було.qty += qty;
      було.weight = Math.round((було.weight + t.вага * qty) * 1000) / 1000;
      було.cost += cost;
      return;
    }
    out.set(t.hs + '|' + t.en, {
      hs: t.hs,
      en: t.en,
      uk: t.uk,
      qty: qty,
      weight: Math.round(t.вага * qty * 1000) / 1000,
      cost: cost
    });
  };

  for (const line of lines) {
    const p = getProduct(c, line.id);
    if (!p) continue;
    const qty = Number(line.qty) || 1;

    if (isSet(p)) {
      /* Ціна комплекту не дорівнює сумі частин — розкидаємо її
         між ними порівну, інакше загальна вартість декларації
         розійдеться з тим, що покупець заплатив. */
      const частини = setParts(c, p);
      if (!частини.length) {
        додати(тип(c, p.id), qty, p.price * qty);
        continue;
      }
      const частка = Math.round((p.price * qty) / частини.length);
      частини.forEach((x, i) => {
        // копійки від ділення віддаємо першій позиції
        const ціна = i === 0 ? p.price * qty - частка * (частини.length - 1) : частка;
        додати(тип(c, x.id), qty, ціна);
      });
      continue;
    }

    додати(тип(c, p.id), qty, p.price * qty);
  }

  return [...out.values()];
}

/** Вага посилки, кг. Порожній кошик — мінімум, бо коробка теж
 *  щось важить. */
export function parcelWeight(c: Catalogue, lines: CartLine[]): number {
  const речі = customsItems(c, lines).reduce((s, x) => s + x.weight, 0);
  // + пакування
  return Math.max(0.3, Math.round((речі + 0.1) * 100) / 100);
}

/** Готовий блок для тексту замовлення. Порожній рядок — коли
 *  декларація не потрібна (доставка по Україні). */
export function customsBlock(c: Catalogue, lines: CartLine[]): string {
  const items = customsItems(c, lines);
  if (!items.length) return '';

  const рядки = items.map(
    (x) =>
      '   • ' + x.hs + ' · ' + x.en + ' (' + x.uk + ') — ' +
      x.qty + ' шт · ' + Math.round(x.weight * 1000) + ' г · ' + x.cost + ' грн'
  );
  const вага = items.reduce((s, x) => s + x.weight, 0);
  const сума = items.reduce((s, x) => s + x.cost, 0);

  return [
    '🧾 Для митної декларації:',
    ...рядки,
    '   Разом: ' + Math.round(вага * 1000) + ' г товару, ' + сума + ' грн; посилка ≈ ' +
      Math.round(parcelWeight(c, lines) * 1000) + ' г'
  ].join('\n');
}
