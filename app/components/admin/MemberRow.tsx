'use client';

import { progressOf } from '@/lib/loyalty';
import { inClub, type MemberDoc } from '@/lib/admin/loyalty-db';

/* ============================================================
   Рядок учасника
   ------------------------------------------------------------
   Менеджер дивиться сюди з двох приводів: «хто це» і «скільки в
   нього». Тому пошта й рівень стоять першими, а решта —
   дрібним підписом.

   Термін показуємо лише тоді, коли він справді йде. Порожній
   рядок «до —» читався б як поломка, а насправді це означає, що
   годинник ще не запущено: людина не зробила жодного замовлення
   на цьому рівні, і втрачати їй нічого.
   ============================================================ */

export default function MemberRow({
  m,
  busy,
  onHistory,
  onAdjust,
  onClub
}: {
  m: MemberDoc;
  busy: boolean;
  onHistory(): void;
  onAdjust(): void;
  onClub(): void;
}) {
  const p = progressOf(m);
  const club = inClub(m);

  return (
    <div className={'loy-row-a' + (m.historyPending ? ' is-wait' : '')}>
      <div className="loy-row-a__who">
        <b>{m.who}</b>
        <span>
          {m.number}
          {m.instagram ? ' · @' + m.instagram : ''}
          {m.joinedAt ? ' · з ' + m.joinedAt : ''}
        </span>
      </div>

      <div className="loy-row-a__lvl">
        <b>
          {p.level} рівень
          {club ? (
            <i className="loy-row-a__club">{m.clubManual ? 'Friendly · руками' : 'Friendly'}</i>
          ) : null}
        </b>
        <span>−{p.percent}%</span>
      </div>

      <div className="loy-row-a__pts">
        <b>{m.points.toLocaleString('uk')}</b>
        <span>
          {p.to === null
            ? 'верхній рівень'
            : `до ${p.level + 1} рівня ${p.need.toLocaleString('uk')}`}
        </span>
      </div>

      <div className="loy-row-a__till">
        {p.deadline ? (
          <span>до {p.deadline}</span>
        ) : (
          <span className="is-quiet">відлік не почато</span>
        )}
      </div>

      <div className="loy-row-a__act">
        {m.historyPending ? (
          <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={onHistory}>
            {busy ? '…' : 'Зарахувати історію'}
          </button>
        ) : null}
        <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={onAdjust}>
          Правка балів
        </button>
        {/* Клуб можна дати й тому, чий рівень до нього не дійшов:
            моделі, другові магазину, гостю з іншого міста. */}
        <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={onClub}>
          {m.clubManual ? 'Забрати клуб' : 'Дати клуб'}
        </button>
      </div>
    </div>
  );
}
