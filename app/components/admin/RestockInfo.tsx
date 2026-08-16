'use client';

import { shortDate, stamp, toDate } from '@/lib/dates';
import { restockOverdue, restockTotal, type Restock } from '@/lib/admin/stock';

/* ============================================================
   Опис приходу в картці
   ------------------------------------------------------------
   Кількості показуємо пігулками, а не рядком «M: 5, L: 4»: так
   видно і розміри, і скільки саме чого, не вчитуючись.

   Для оприбуткованого головне — коли його справді прийняли.
   Планова дата лишається поруч, якщо відрізняється: видно, на
   скільки постачальник спізнився.

   Розмітка й класи ті самі, що в restockCardHTML старої панелі.
   ============================================================ */

export default function RestockInfo({ r, now = new Date() }: { r: Restock; now?: Date }) {
  const done = r.status === 'received';
  const overdue = restockOverdue(r, now);
  const total = restockTotal(r);

  const pills = r.items
    ? Object.keys(r.items)
        .filter((k) => (r.items as Record<string, number>)[k] > 0)
        .map((k) => [k, (r.items as Record<string, number>)[k]] as const)
    : r.qty
      ? ([['шт', r.qty]] as (readonly [string, number])[])
      : [];

  const expected = r.expected ? shortDate(toDate(r.expected), now) : '';
  const gotAt = stamp(toDate(r.receivedAt), now);

  return (
    <div className="ao-restock__info">
      <b>
        {r.productName || r.productId}
        {total ? <span className="ao-restock__total">{total} шт</span> : null}
      </b>

      <span className="ao-restock__pills">
        {pills.map(([size, n]) => (
          <i key={size}>
            <b>{size}</b>
            {n}
          </i>
        ))}
        {/* Ціна партії — тут же, поруч із кількостями: коли
            приходів кілька, саме за нею їх і розрізняють. */}
        {r.cost ? <u>{r.cost} грн/шт</u> : null}
        {r.note ? <u>{r.note}</u> : null}
      </span>

      <span className="ao-restock__date">
        {done ? (
          <>
            <b>✓ оприбутковано</b>
            {gotAt ? ' ' + gotAt : ''}
            {r.receivedBy ? ' · ' + String(r.receivedBy).split('@')[0] : ''}
            {/* Планову дату називаємо лише тоді, коли прийняли
                не того дня: інакше вона просто повторює сказане */}
            {expected && gotAt && !gotAt.startsWith(expected) ? (
              <em> планувався на {expected}</em>
            ) : null}
          </>
        ) : (
          (overdue ? '⚠ очікувався ' : 'очікується ') + (expected || '—')
        )}
      </span>
    </div>
  );
}
