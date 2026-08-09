'use client';

import { useEffect, useState } from 'react';
import {
  restockEditSizes,
  restockSized,
  todayISO,
  type Restock,
  type RestockEditInput
} from '@/lib/admin/stock';
import type { Product } from '@/lib/types';

/* Правка запланованого приходу.

   Оприбутковується саме та кількість, яку тут збережуть, — тому
   виправити її треба ДО оприбуткування. Без цієї форми лишалось
   би видалити прихід і створити новий, втративши дату й нотатку. */

export default function RestockEdit({
  r,
  p,
  onSave,
  onCancel,
  busy
}: {
  r: Restock;
  /** Товар із каталогу; null — його вже видалили. */
  p: Product | null;
  onSave(v: RestockEditInput): void;
  onCancel(): void;
  busy?: boolean;
}) {
  /* Дивимось спершу на сам документ, і лише потім на товар:
     сітку могли прибрати з картки вже після того, як прихід
     запланували. */
  const sized = restockSized(r, p);
  const sizes = restockEditSizes(r, p);

  const [expected, setExpected] = useState(r.expected || todayISO(new Date()));
  const [note, setNote] = useState(r.note || '');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [one, setOne] = useState(Number(r.qty) || 0);

  useEffect(() => {
    setQty({ ...(r.items ?? {}) });
    setOne(Number(r.qty) || 0);
    setExpected(r.expected || todayISO(new Date()));
    setNote(r.note || '');
  }, [r]);

  return (
    <form
      className="ao-restock-edit"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ expected, note, sizes: sized ? qty : null, qty: sized ? undefined : one });
      }}
    >
      <div className="ao-restock-form__row">
        <input
          type="date"
          title="Очікувана дата приходу"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
        />
        <input
          placeholder="Нотатка: постачальник, партія тощо"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="ao-restock-form__qty">
        {sized ? (
          sizes.map((sz) => (
            <label className="ao-qty" key={sz}>
              <span>{sz}</span>
              <input
                type="number"
                min="0"
                value={qty[sz] ?? 0}
                onChange={(e) =>
                  setQty((v) => ({ ...v, [sz]: Math.max(0, Number(e.target.value) || 0) }))
                }
              />
            </label>
          ))
        ) : (
          <label className="ao-qty">
            <span>шт</span>
            <input
              type="number"
              min="0"
              value={one}
              onChange={(e) => setOne(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        )}
      </div>

      <div className="ao-restock__actions">
        <button className="btn btn--primary btn--sm" type="submit" disabled={busy}>
          Зберегти
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel}>
          Скасувати
        </button>
      </div>
    </form>
  );
}
