/* ============================================================
   REYTER — дати для людини
   ------------------------------------------------------------
   «2026-08-20» ніхто не читає з першого разу. Порт shortDate,
   stamp і etaDateText зі старого сайту: адмінка й вітрина
   показують дати однаково, бо це одні й ті самі дати.

   Рік дописуємо лише коли він не поточний: у списку приходів на
   найближчі тижні «2026» повторюється в кожному рядку й лише
   заважає.
   ============================================================ */

import type { Lang } from './types';

const LOCALE: Record<Lang, string> = { uk: 'uk-UA', en: 'en-GB' };

/** «20 серпня», «20 серпня 2027». Порожній рядок, якщо дати немає
 *  або вона зіпсована — вигадувати «Invalid Date» на екрані не
 *  можна. */
export function shortDate(d: Date | null | undefined, now: Date, lang: Lang = 'uk'): string {
  if (!d || isNaN(d.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(LOCALE[lang], opts);
}

/** Те саме з часом: «20 серпня, 14:30». */
export function stamp(d: Date | null | undefined, now: Date, lang: Lang = 'uk'): string {
  const day = shortDate(d, now, lang);
  if (!day || !d) return '';
  return (
    day + ', ' + d.toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' })
  );
}

/** Дата з документа: рядок 'РРРР-ММ-ДД' або мітка Firestore. */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === 'string') {
    // без часу рядок читається як UTC і ввечері зсувається на добу
    const d = new Date(value.length === 10 ? value + 'T00:00:00' : value);
    return isNaN(d.getTime()) ? null : d;
  }
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === 'function') {
    const d = ts.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value as string | number);
  return isNaN(d.getTime()) ? null : d;
}

/** Дата приходу для вітрини: «15 серпня». Якщо розібрати не
 *  вдалося — віддаємо як є, щоб покупець бачив хоч щось. */
export function etaDateText(iso: string, lang: Lang = 'uk', now: Date = new Date()): string {
  return shortDate(toDate(iso), now, lang) || iso;
}
