'use client';

import { useState } from 'react';
import { progressOf } from '@/lib/loyalty';
import { clubSource, daysLeft, inClub, initials, niceDay, type MemberDoc } from '@/lib/admin/loyalty-db';

/* ============================================================
   Рядок учасника
   ------------------------------------------------------------
   Менеджер дивиться сюди з двох приводів: «хто це» і «скільки в
   нього». Тому пошта й рівень стоять першими, а решта —
   дрібним підписом.

   Кнопки «Перерахувати історію» тут більше немає. Зарахування
   минулих замовлень іде саме — прохід по черзі запускається при
   кожному відкритті адмінки, — тож кнопка на кожному рядку
   пропонувала зробити те, що вже зроблено. Лишилась вона рівно
   там, де автомат чесно здався: коли замовлення знайшлись, а
   сума в них нульова. Це єдиний випадок, у якому потрібна
   людина, і тепер кнопка означає саме його.

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
  const [copied, setCopied] = useState(false);

  const left = daysLeft(p.deadline);
  const burning = left !== null && left <= 30;

  /* Instagram — єдине, що звідси переносять кудись іще: щоб
     знайти людину в соцмережах, логін треба вставити в пошук.
     Виділяти його мишею з рядка дрібного тексту незручно, тож
     клік копіює. */
  function copyInsta() {
    const login = '@' + String(m.instagram || '').replace(/^@+/, '');
    void navigator.clipboard
      ?.writeText(login)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  }

  return (
    <div
      className={
        'loy-row-a' +
        (m.historyPending ? ' is-wait' : '') +
        (m.historyStuck ? ' is-stuck' : '')
      }
    >
      <div className="loy-row-a__who">
        <span className={'loy-ava lvl-' + p.level} aria-hidden="true">
          {initials(m.who)}
        </span>
        <span className="loy-row-a__id">
          <b>{m.who}</b>
          <span className="loy-row-a__meta">
            <span className="loy-tag">{m.number}</span>
            {m.instagram ? (
              <button
                type="button"
                className={'loy-tag loy-tag--insta' + (copied ? ' is-copied' : '')}
                title="Скопіювати логін Instagram"
                onClick={copyInsta}
              >
                {copied ? 'скопійовано ✓' : '@' + String(m.instagram).replace(/^@+/, '')}
              </button>
            ) : null}
            {m.joinedAt ? <span className="loy-tag is-quiet">з {niceDay(m.joinedAt)}</span> : null}
            {src === 'hand' ? <span className="loy-tag is-hand">клуб руками</span> : null}
            {src === 'banned' ? <span className="loy-tag is-ban">клуб забрано</span> : null}
            {/* Замовлення знайшлись, а сума нульова. Мовчати про це
                не можна: автоматичний прохід таку людину більше не
                візьме, і без цього рядка вона просто загубилась би. */}
            {m.historyStuck ? <span className="loy-tag is-stuck">історія потребує перевірки</span> : null}
            {m.historyPending && !m.historyStuck ? (
              <span className="loy-tag is-wait">історію зарахуємо самі</span>
            ) : null}
          </span>
        </span>
      </div>

      <div className="loy-row-a__lvl">
        <b>
          <span className={'loy-lvl lvl-' + p.level}>{p.level} рівень</span>
          {/* Саме «Friendly» й нічого більше: довший підпис
              переносився на другий рядок і розпирав усю комірку.
              Те, що клуб дали руками, видно в рядку під поштою. */}
          {club ? <i className="loy-row-a__club">Friendly</i> : null}
        </b>
        <span>знижка −{p.percent}%</span>
      </div>

      {/* Бали й «скільки лишилось» були двома незвʼязаними числами:
          щоб зрозуміти, чи людина близько до наступного рівня,
          доводилось віднімати в голові. Смужка каже це одразу. */}
      <div className="loy-row-a__pts">
        <b>{m.points.toLocaleString('uk')}</b>
        <span className="loy-bar" aria-hidden="true">
          <i style={{ width: Math.round(p.ratio * 100) + '%' }} className={'lvl-' + p.level} />
        </span>
        <span>
          {p.to === null
            ? 'верхній рівень'
            : `до ${p.level + 1} рівня ще ${p.need.toLocaleString('uk')}`}
        </span>
      </div>

      <div className="loy-row-a__till">
        {p.deadline ? (
          <>
            <b className={burning ? 'is-burning' : ''}>{niceDay(p.deadline)}</b>
            <span>
              {left !== null && left >= 0
                ? left === 0
                  ? 'згорають сьогодні'
                  : `лишилось ${left} дн.`
                : 'термін минув'}
            </span>
          </>
        ) : (
          <span className="is-quiet">відлік не почато</span>
        )}
      </div>

      <div className="loy-row-a__act">
        {/* Автомат здався саме на цій людині — тут людська рука
            справді потрібна. У решті випадків історія зараховується
            без жодного натискання, тому й кнопки немає. */}
        {m.historyStuck ? (
          <button
            className="btn btn--sm btn--ghost"
            type="button"
            disabled={busy}
            title="Замовлення знайшлись, але сума в них нульова — перевірте їх і спробуйте ще раз"
            onClick={onHistory}
          >
            {busy ? '…' : 'Перевірити історію'}
          </button>
        ) : null}
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
