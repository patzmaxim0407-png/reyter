'use client';

import { fmt } from '@/lib/catalog';

/* ============================================================
   Рядок замовлення
   ------------------------------------------------------------
   Один і той самий у черзі й в архіві — навмисно. Менеджер
   переходить між екранами десятки разів на день, і якщо
   замовлення виглядає там і там по-різному, очі щоразу
   пристосовуються наново.

   У рядку рівно те, що потрібно для рішення: хто, куди, скільки
   й одна прикмета стану. Усе інше — під ним, за дотиком.
   ============================================================ */

export default function OrderRow({
  num,
  name,
  place,
  meta,
  sum,
  tone = 0,
  action,
  picked,
  onPick,
  open,
  onToggle
}: {
  num: string;
  name: string;
  place: string;
  /** Чому воно тут: «чекає 3 год», «лежить 5 дн.», «Виконано». */
  meta: string;
  sum: number;
  /** 0 — спокій, 1 — увага, 2 — горить. */
  tone?: 0 | 1 | 2;
  action?: { label: string; onClick(): void };
  picked?: boolean;
  onPick?(on: boolean): void;
  open?: boolean;
  onToggle(): void;
}) {
  return (
    <div className={'aq-row u-' + tone + (open ? ' is-open' : '')}>
      {onPick ? (
        <label className="aq-row__pick" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={!!picked} onChange={(e) => onPick(e.target.checked)} />
        </label>
      ) : null}

      <button className="aq-row__main" type="button" onClick={onToggle} aria-expanded={!!open}>
        <span className="aq-row__who">
          <b>{name || '—'}</b>
          <em>№{num}</em>
        </span>
        <span className="aq-row__where" title={place}>
          {place || '—'}
        </span>
        <span className="aq-row__why">{meta}</span>
        <span className="aq-row__sum">{fmt(sum || 0)} грн</span>
        <span className="aq-row__chev" aria-hidden="true">
          {open ? '⌃' : '⌄'}
        </span>
      </button>

      {action ? (
        <button
          className="btn btn--primary btn--sm aq-row__act"
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
