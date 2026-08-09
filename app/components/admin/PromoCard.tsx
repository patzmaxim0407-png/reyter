'use client';

import { fmt } from '@/lib/catalog';

/* Картка промокоду в адмінці. Розмітка й класи ті самі, що
   в старій панелі. */

export interface AdminPromo {
  code: string;
  type?: string;
  value?: number;
  scope?: string;
  categories?: string[];
  products?: string[];
  excludeSale?: boolean;
  minTotal?: number;
  usageLimit?: number;
  usedCount?: number;
  startsAt?: string;
  endsAt?: string;
  active?: boolean;
  email?: string;
  note?: string;
}

export interface PromoView {
  /** is-on / is-off / is-soon — від них залежить колір картки. */
  cls: string;
  label: string;
  /** «300 грн» або «10%». */
  value: string;
  /** «на весь кошик», «на категорії: …». */
  scope: string;
  used: number;
}

export default function PromoCard({
  p,
  view,
  onEdit,
  onToggle,
  onCopy,
  onMail,
  onDelete
}: {
  p: AdminPromo;
  view: PromoView;
  onEdit(): void;
  onToggle(): void;
  onCopy(): void;
  onMail?(): void;
  onDelete(): void;
}) {
  const limit = Number(p.usageLimit) || 0;
  const period = [p.startsAt ? 'з ' + p.startsAt : '', p.endsAt ? 'до ' + p.endsAt : '']
    .filter(Boolean)
    .join(' ');

  return (
    <article className={'ao-card a-promo ' + view.cls}>
      <div className="ao-card__head">
        <b className="a-promo__code">{p.code}</b>
        <span className="a-promo__value">−{view.value}</span>
        <span
          className={
            'order-card__status ' +
            (view.cls === 'is-on' ? 'is-done' : view.cls === 'is-off' ? 'is-cancelled' : '')
          }
        >
          {view.label}
        </span>
        {/* Персональний код читає лише власник тієї пошти —
            правила бази не дають його стороннім */}
        {p.email ? <span className="a-promo__personal">персональний</span> : null}
        <span className="ao-card__date">{period}</span>
      </div>

      <div className="ao-card__customer">
        {p.email ? (
          <>
            ✉️ <b>{p.email}</b>
            <br />
          </>
        ) : null}
        {view.scope}
        {p.excludeSale ? ' · без SALE-товарів' : ''}
        {Number(p.minTotal) ? ` · від ${fmt(p.minTotal!)} грн` : ''}
        <br />
        <span className="ao-muted">
          Використано: <b>{view.used}</b>
          {limit ? ` із ${limit}` : ' (без ліміту)'}
          {p.note ? ' · ' + p.note : ''}
        </span>
      </div>

      <div className="ao-card__actions">
        <button className="btn btn--ghost btn--sm" type="button" onClick={onEdit}>
          Редагувати
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onToggle}>
          {p.active === false ? 'Увімкнути' : 'Вимкнути'}
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onCopy}>
          Скопіювати код
        </button>
        {p.email && onMail ? (
          <button className="btn btn--ghost btn--sm" type="button" onClick={onMail}>
            Надіслати на пошту
          </button>
        ) : null}
        <button className="btn btn--ghost btn--sm ao-danger" type="button" onClick={onDelete}>
          Видалити
        </button>
      </div>
    </article>
  );
}
