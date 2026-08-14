'use client';

import Tracker from './Tracker';
import { useLang } from './LangProvider';
import { statusInfo } from '@/lib/account';
import { uah } from '@/lib/catalog';
import type { OrderItem } from '@/lib/types';

/* Картка замовлення — одна на кабінет і на відстеження.
   Різниця лише в тому, скільки ми знаємо: у гостя, який шукає
   за номером, статус є, а кнопки «повторити» немає. */

export interface OrderView {
  num: string;
  date?: string;
  status?: string;
  total: number;
  ttn?: string;
  items?: OrderItem[];
  /** Готові рядки складу — так вони лежать у записі відстеження. */
  itemLines?: { name: string; size?: string; qty: number; parts?: string[] }[];
  where?: string;
}

function human(date: string | undefined, lang: string) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

export default function OrderCard({
  o,
  showStatus,
  onRepeat,
  onCopy,
  onCopyTtn,
  pay
}: {
  o: OrderView;
  /** Статус відомий лише для замовлень із бази: локальна копія
   *  в браузері про рух нічого не знає й показувала б «Нове»
   *  навіть на доставленому. */
  showStatus?: boolean;
  onRepeat?: () => void;
  onCopy?: () => void;
  onCopyTtn?: () => void;
  /** Кнопка оплати для замовлення, яке її ще чекає. */
  pay?: React.ReactNode;
}) {
  const { t, lang } = useLang();
  const st = o.status || 'new';
  const date = human(o.date, lang);

  const lines =
    o.itemLines ??
    (o.items || []).map((i) => ({
      name: i.name,
      size: i.size ?? undefined,
      qty: i.qty,
      parts: (i.parts || []).map(
        (x) => (x.category ? x.category + ' · ' : '') + (x.name || x.id) + (x.size ? ' · ' + x.size : '')
      )
    }));

  return (
    <article className="order-card">
      <div className="order-card__head">
        <span className="order-card__num">
          №{o.num}
          {showStatus ? (
            <span
              className={
                'order-card__status' +
                (st === 'done' ? ' is-done' : '') +
                (st === 'cancelled' ? ' is-cancelled' : '')
              }
            >
              {statusInfo(st, t).title}
            </span>
          ) : null}
        </span>
        {date ? <span className="order-card__date">{date}</span> : null}
      </div>

      {showStatus ? <Tracker status={st} /> : null}

      {showStatus && o.ttn ? (
        <div className="order-card__ttn">
          📦 {t('acc.ttn')}: <b>{o.ttn}</b>
          <button type="button" onClick={onCopyTtn}>
            {t('acc.copy')}
          </button>
        </div>
      ) : null}

      {lines.length ? (
        <div className="order-card__items">
          {lines.map((i, n) => (
            <div key={n}>
              {i.name}
              {i.size ? ' · ' + i.size : ''} × {i.qty}
              {i.parts?.length ? (
                <span className="order-card__parts">
                  {i.parts.map((x, k) => (
                    <span key={k}>
                      {k ? <br /> : null}
                      {x}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {o.where ? <div className="order-card__items">🚚 {o.where}</div> : null}

      <div className="order-card__total">
        {t('cart.total')}: {uah(o.total, lang)}
      </div>

      {onRepeat || onCopy || pay ? (
        <div className="order-card__actions">
          {/* Оплата — найперша дія: поки грошей немає, замовлення
              не рухається, і решта кнопок значення не мають. */}
          {pay}
          {onRepeat ? (
            <button className="btn btn--primary btn--sm" type="button" onClick={onRepeat}>
              {t('acc.repeat')}
            </button>
          ) : null}
          {onCopy ? (
            <button className="btn btn--ghost btn--sm" type="button" onClick={onCopy}>
              {t('acc.copy')}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
