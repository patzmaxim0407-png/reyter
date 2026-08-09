'use client';

import { moveTag, type Move } from '@/lib/admin/stock';

/* Рядок журналу руху. Розмітка й класи ті самі, що в старій панелі.

   У журнал потрапляє КОЖНА зміна залишків — прихід, продаж,
   повернення, списання. Саме тому склад не редагують руками:
   мовчазне виправлення не лишило б сліду, і за місяць уже не
   зрозуміти, куди подівся товар. */

/* Тип і мітки живуть у lib/admin/stock.ts — там, де рух
   записується. Копія тут розійшлася б із оригіналом на першій
   же новій причині. */
export type { Move };

export default function MoveRow({ m, date }: { m: Move; date: Date | null }) {
  const delta = Number(m.delta) || 0;
  const tag = moveTag(m);
  // від пошти лишаємо частину до @: у рядку журналу вона лише заважає
  const who = String(m.by ?? '').split('@')[0];

  return (
    <div className="ao-move">
      <span className={'ao-move__delta ' + (delta >= 0 ? 'is-plus' : 'is-minus')}>
        {delta > 0 ? '+' : ''}
        {delta}
      </span>

      <div className="ao-move__info">
        <b>
          {m.productName || m.productId}
          {m.size ? <i className="ao-move__size">{m.size}</i> : null}
        </b>
        <span>
          <i className={'ao-move__tag ' + tag.cls}>{tag.title}</i>
          {m.ref ? <i className="ao-move__ref">{m.ref}</i> : null}
          {who ? (
            <i className="ao-move__who" title={String(m.by ?? '')}>
              {who}
            </i>
          ) : null}
        </span>
      </div>

      <span className="ao-move__date">
        {date ? date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) : ''}
      </span>
    </div>
  );
}
