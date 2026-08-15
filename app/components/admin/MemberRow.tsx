'use client';

import { progressOf } from '@/lib/loyalty';
import { clubSource, inClub, type MemberDoc } from '@/lib/admin/loyalty-db';

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
  const src = clubSource(m);

  return (
    <div className={'loy-row-a' + (m.historyPending ? ' is-wait' : '')}>
      <div className="loy-row-a__who">
        <b>{m.who}</b>
        <span>
          {m.number}
          {m.instagram ? ' · @' + m.instagram : ''}
          {m.joinedAt ? ' · з ' + m.joinedAt : ''}
          {src === 'hand' ? ' · клуб руками' : ''}
          {src === 'banned' ? ' · клуб забрано' : ''}
        </span>
      </div>

      <div className="loy-row-a__lvl">
        <b>
          {p.level} рівень
          {/* Саме «Friendly» й нічого більше: довший підпис
              переносився на другий рядок і розпирав усю комірку.
              Те, що клуб дали руками, видно в рядку під поштою. */}
          {club ? <i className="loy-row-a__club">Friendly</i> : null}
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
        {/* Кнопка лишається й після зарахування — саме її
            зникнення й ховало причину нуля: порахували в нуль,
            прапорець зняли, і спробувати ще раз стало нічим.
            Тепер це «перерахувати»: ті самі замовлення вдруге не
            зарахуються, бо їхні номери лежать в учасника. */}
        <button
          className={'btn btn--sm ' + (m.historyPending ? 'btn--primary' : 'btn--ghost')}
          type="button"
          disabled={busy}
          onClick={onHistory}
        >
          {busy ? '…' : m.historyPending ? 'Зарахувати історію' : 'Перерахувати історію'}
        </button>
        <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={onAdjust}>
          Правка балів
        </button>
        {/* Клуб можна дати й тому, чий рівень до нього не дійшов:
            моделі, другові магазину, гостю з іншого міста. І так
            само забрати в того, кому рівень його дав, — тому
            напис іде за тим, чи людина в клубі ЗАРАЗ, а не за
            тим, чи є ручний запис. */}
        <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={onClub}>
          {club ? 'Забрати клуб' : 'Дати клуб'}
        </button>
      </div>
    </div>
  );
}
