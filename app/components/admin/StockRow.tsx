'use client';

import { fmt } from '@/lib/catalog';
import type { Product } from '@/lib/types';

/* Рядок складу. Розмітка й класи ті самі, що в старій панелі.

   Залишки не редагуються руками: базу вже задано, далі склад
   змінюють лише прихід, списання й замовлення. Так у журналі
   «Рух» лишається повна історія, а не мовчазні виправлення. */

export interface StockCell {
  label: string;
  qty: number | null;
  /** Розміру немає в картці товару — на складі він звідкись є. */
  stray?: boolean;
  hint?: string;
}

export interface RowState {
  cls: string;
  label: string;
}

export default function StockRow({
  p,
  state,
  cells,
  total,
  /** Комплект власних залишків не має: числа рахуються за
   *  складниками, і редагувати їх ніде. */
  parts
}: {
  p: Product;
  state: RowState;
  cells: StockCell[];
  total: number | null;
  parts?: Product[];
}) {
  const isSet = !!parts?.length;
  const num = (n: number | null) => (n === null ? '—' : String(n));

  return (
    <div className={'ao-stockrow' + (isSet ? ' ao-stockrow--set' : '') + ' ' + state.cls}>
      <img
        src={p.images?.[0] ?? ''}
        alt=""
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
        }}
      />

      <div className="ao-stockrow__info">
        <b>
          {p.name}
          {isSet ? <i className="ao-tag">комплект</i> : null}
          {p.hidden ? <i className="ao-tag">сховано з сайту</i> : null}
        </b>
        <span>
          {p.id} · {fmt(p.price)} грн
          {isSet ? ' · ' + parts!.map((x) => x.name).join(' + ') : ''} ·{' '}
          <em className="ao-state">{state.label}</em>
        </span>
      </div>

      <div className="ao-stockrow__qty">
        {cells.map((c, i) => (
          <span
            key={c.label + i}
            className={
              'ao-qty is-calc' +
              (c.qty !== null && c.qty < 0 ? ' is-neg' : '') +
              (c.qty === 0 ? ' is-zero' : '') +
              (c.stray ? ' is-stray' : '')
            }
            title={c.hint ?? (c.stray ? 'Цього розміру немає в картці товару' : undefined)}
          >
            <span>
              {c.label}
              {c.stray ? '*' : ''}
            </span>
            <b>{num(c.qty)}</b>
          </span>
        ))}
      </div>

      <div className="ao-stockrow__total">
        <b>{total === null ? '—' : fmt(total)}</b>
        <span>шт</span>
      </div>
    </div>
  );
}
