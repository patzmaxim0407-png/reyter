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

interface Kind {
  /** Код УКТЗЕД (HS) — 8 цифр, як вимагає перевізник. */
  hs: string;
  /** Опис англійською: саме його читає митниця. */
  en: string;
  /** Опис українською — для накладної й для менеджера. */
  uk: string;
  /** Вага одиниці, кг. */
  weight: number;
}

/* Категорія → чим вона є для митниці. Перелік навмисно
   короткий: усе, чого тут немає, стає звичайною білизною —
   найближчим і найбезпечнішим описом для нашого асортименту. */
const KINDS: Record<string, Kind> = {
  briefs:  { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', weight: 0.08 },
  slips:   { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', weight: 0.08 },
  boxers:  { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', weight: 0.09 },
  jocks:   { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', weight: 0.07 },
  ribbed:  { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', weight: 0.08 },
  royal:   { hs: '61079100', en: "Men's knitted cotton underwear", uk: 'Чоловіча трикотажна білизна', weight: 0.08 },
  tanks:   { hs: '61091000', en: "Men's knitted cotton t-shirt", uk: 'Чоловіча трикотажна майка', weight: 0.13 },
  sorochky: { hs: '62052000', en: "Men's cotton shirt", uk: 'Чоловіча сорочка', weight: 0.25 },
  swim:    { hs: '62111100', en: "Men's swim shorts", uk: 'Чоловічі плавальні шорти', weight: 0.15 },
  'home-collection': { hs: '61079100', en: "Men's knitted homewear", uk: 'Чоловічий домашній одяг', weight: 0.35 }
};

const DEFAULT_KIND: Kind = KINDS.briefs;

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

function kind(c: Catalogue, id: string): Kind {
  const p = getProduct(c, id);
  return (p && KINDS[String(p.category)]) || DEFAULT_KIND;
}

/** Перелік для декларації. Комплект розкладаємо на складові:
 *  митниця декларує речі, а не наші набори. */
export function customsItems(c: Catalogue, lines: CartLine[]): CustomsItem[] {
  const out = new Map<string, CustomsItem>();

  const add = (t: Kind, qty: number, cost: number) => {
    const prev = out.get(t.hs + '|' + t.en);
    if (prev) {
      prev.qty += qty;
      prev.weight = Math.round((prev.weight + t.weight * qty) * 1000) / 1000;
      prev.cost += cost;
      return;
    }
    out.set(t.hs + '|' + t.en, {
      hs: t.hs,
      en: t.en,
      uk: t.uk,
      qty: qty,
      weight: Math.round(t.weight * qty * 1000) / 1000,
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
      const parts = setParts(c, p);
      if (!parts.length) {
        add(kind(c, p.id), qty, p.price * qty);
        continue;
      }
      const share = Math.round((p.price * qty) / parts.length);
      parts.forEach((x, i) => {
        // копійки від ділення віддаємо першій позиції
        const price = i === 0 ? p.price * qty - share * (parts.length - 1) : share;
        add(kind(c, x.id), qty, price);
      });
      continue;
    }

    add(kind(c, p.id), qty, p.price * qty);
  }

  return [...out.values()];
}

/** Вага посилки, кг. Порожній кошик — мінімум, бо коробка теж
 *  щось важить. */
export function parcelWeight(c: Catalogue, lines: CartLine[]): number {
  const goodsKg = customsItems(c, lines).reduce((s, x) => s + x.weight, 0);
  // + пакування
  return Math.max(0.3, Math.round((goodsKg + 0.1) * 100) / 100);
}

/** Готовий блок для тексту замовлення. Порожній рядок — коли
 *  декларація не потрібна (доставка по Україні). */
export function customsBlock(c: Catalogue, lines: CartLine[]): string {
  const items = customsItems(c, lines);
  if (!items.length) return '';

  const rows = items.map(
    (x) =>
      '   • ' + x.hs + ' · ' + x.en + ' (' + x.uk + ') — ' +
      x.qty + ' шт · ' + Math.round(x.weight * 1000) + ' г · ' + x.cost + ' грн'
  );
  const weightText = items.reduce((s, x) => s + x.weight, 0);
  const sum = items.reduce((s, x) => s + x.cost, 0);

  return [
    '🧾 Для митної декларації:',
    ...rows,
    '   Разом: ' + Math.round(weightText * 1000) + ' г товару, ' + sum + ' грн; посилка ≈ ' +
      Math.round(parcelWeight(c, lines) * 1000) + ' г'
  ].join('\n');
}
