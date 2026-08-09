'use client';

import { useMemo, useState } from 'react';
import Combobox from '../Combobox';
import type { Product } from '@/lib/types';

/* ============================================================
   Прихід і списання
   ------------------------------------------------------------
   Одна форма на дві дії — вони відрізняються лише напрямком і
   тим, що прихід спершу стає в чергу очікування, а списання
   забирає товар одразу.

   Розмітка й класи ті самі, що в старій панелі.
   ============================================================ */

export interface WriteoffReason {
  id: string;
  title: string;
}

export interface SizeCell {
  size: string;
  /** Скільки зараз на складі; null — документа залишків немає. */
  have: number | null;
}

export interface RestockSubmit {
  mode: 'in' | 'off';
  productId: string;
  /** Кількості за розмірами; ключ '' — товар без сітки. */
  qty: Record<string, number>;
  /** Прихід: очікувана дата. */
  expected: string;
  /** Списання: причина. */
  reason: string;
  note: string;
}

export default function RestockForm({
  products,
  reasons,
  today,
  sizesOf,
  onSubmit,
  busy
}: {
  products: Product[];
  reasons: WriteoffReason[];
  today: string;
  /** Розміри товару разом із поточними залишками. Порожній
   *  масив — товар без сітки, кількість одна. */
  sizesOf(p: Product): SizeCell[];
  onSubmit(v: RestockSubmit): void;
  busy?: boolean;
}) {
  const [mode, setMode] = useState<'in' | 'off'>('in');
  const [pid, setPid] = useState('');
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [expected, setExpected] = useState(today);
  const [reason, setReason] = useState(reasons[0]?.id ?? 'lost');
  const [note, setNote] = useState('');

  const off = mode === 'off';
  const selected = products.find((p) => p.id === pid) ?? null;
  const cells = useMemo(() => (selected ? sizesOf(selected) : []), [selected, sizesOf]);

  function reset() {
    setQty({});
    setNote('');
  }

  return (
    <form
      className={'ao-restock-form' + (off ? ' is-writeoff' : '')}
      onSubmit={(e) => {
        e.preventDefault();
        if (!selected) return;
        onSubmit({ mode, productId: selected.id, qty, expected, reason, note: note.trim() });
        reset();
      }}
    >
      <div className="ao-restock-form__head">
        <div className="ao-chips">
          <button
            type="button"
            className={'ao-chip' + (!off ? ' is-active' : '')}
            onClick={() => setMode('in')}
          >
            ↓ Прихід
          </button>
          <button
            type="button"
            className={'ao-chip' + (off ? ' is-active' : '')}
            onClick={() => setMode('off')}
          >
            ↑ Списання
          </button>
        </div>
      </div>

      <p className="ao-note">
        {off
          ? 'Товар зникає зі складу одразу. Причина потрапляє в журнал руху — потім видно, скільки втрачено на браку, а скільки просто загубилось.'
          : 'Прихід стає в чергу очікування. Коли товар фізично приїде — натисніть «Оприбуткувати», і залишки зростуть.'}
      </p>

      <div className="ao-restock-form__row">
        <Combobox
          id="rstProduct"
          label=""
          value={search}
          placeholder="товар — назва або артикул"
          empty="Нічого не знайдено"
          minChars={0}
          openOnFocus
          search={async (q) => {
            const s = q.trim().toLowerCase();
            return products
              .filter((p) => !s || (p.name + ' ' + p.id).toLowerCase().includes(s))
              .slice(0, 40)
              .map((p) => ({ ref: p.id, text: p.name, value: p.name, note: p.id }));
          }}
          onType={(v) => {
            setSearch(v);
            setPid('');
            setQty({});
          }}
          onPick={(it) => {
            setSearch(it.value);
            setPid(it.ref);
            setQty({});
          }}
        />

        {off ? (
          <select
            title="Причина списання"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {reasons.map((r) => (
              <option value={r.id} key={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="date"
            title="Очікувана дата приходу"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        )}
      </div>

      <div className="ao-restock-form__qty">
        {!selected ? (
          <p className="ao-note">Оберіть товар, щоб вказати кількість.</p>
        ) : cells.length ? (
          cells.map((c) => (
            <label
              className={'ao-qty' + (off && c.have === 0 ? ' is-zero' : '')}
              key={c.size || 'one'}
            >
              <span>
                {c.size || 'шт'}
                {c.have === null ? '' : ' · ' + c.have}
              </span>
              <input
                type="number"
                min="0"
                /* Списати більше, ніж лежить на складі, не можна:
                   мінус у залишках потім нічим не пояснити */
                max={off && c.have !== null ? Math.max(0, c.have) : undefined}
                value={qty[c.size] ?? 0}
                onChange={(e) =>
                  setQty((v) => ({ ...v, [c.size]: Math.max(0, Number(e.target.value) || 0) }))
                }
              />
            </label>
          ))
        ) : null}
      </div>

      <input
        placeholder={
          off
            ? 'Нотатка: що саме сталося (необовʼязково)'
            : 'Нотатка: постачальник, партія тощо (необовʼязково)'
        }
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <button
        className={'btn ' + (off ? 'btn--danger' : 'btn--primary') + ' btn--sm'}
        type="submit"
        disabled={busy || !selected}
      >
        {off ? 'Списати зі складу' : 'Додати прихід'}
      </button>
    </form>
  );
}
