'use client';

/* Рядок журналу руху. Розмітка й класи ті самі, що в старій панелі.

   У журнал потрапляє КОЖНА зміна залишків — прихід, продаж,
   повернення, списання. Саме тому склад не редагують руками:
   мовчазне виправлення не лишило б сліду, і за місяць уже не
   зрозуміти, куди подівся товар. */

export interface Move {
  productId?: string;
  productName?: string;
  size?: string | null;
  delta?: number;
  reason?: string;
  ref?: string;
  by?: string;
  ts?: unknown;
}

export const MOVE_TAGS: Record<string, { title: string; cls: string }> = {
  restock: { title: 'Прихід', cls: 'is-in' },
  order: { title: 'Замовлення', cls: 'is-out' },
  'order-cancel': { title: 'Повернення', cls: 'is-back' },
  'order-return': { title: 'Повернення від покупця', cls: 'is-back' },
  writeoff: { title: 'Списання', cls: 'is-out' },
  manual: { title: 'Коригування', cls: 'is-manual' }
};

export default function MoveRow({ m, date }: { m: Move; date: Date | null }) {
  const delta = Number(m.delta) || 0;
  const tag = MOVE_TAGS[m.reason ?? ''] ?? { title: m.reason || '—', cls: 'is-manual' };
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
