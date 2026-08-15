'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { LEVELS, instagramLogin, instagramOk, progressOf } from '@/lib/loyalty';
import type { MemberDoc } from '@/lib/admin/loyalty-db';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

/* ============================================================
   Кабінет: програма лояльності і Friendly Club
   ------------------------------------------------------------
   Три стани, і кожен показує рівно те, що людині зараз потрібно.

   ГІСТЬ або ще не вступив — коротко, що це таке, скільки дає
   кожен рівень, і кнопка «Вступити». Довгих умов тут немає:
   хто захоче подробиць, той спитає.

   УЧАСНИК — свій рівень, смужка до наступного, скільки лишилось
   і до якого числа. Це головний екран, і він мусить відповідати
   на одне питання з першого погляду: скільки ще треба.

   ТРЕТІЙ РІВЕНЬ І ВИЩЕ — плюс запрошення в клуб: вписати
   Instagram. Доти рівень уже дає свої вісім відсотків, а от
   закриті товари відчиняються саме після цього кроку.
   ============================================================ */

export default function FriendlyTab({
  user,
  member,
  lang,
  busy,
  onJoin,
  onInstagram
}: {
  user: User | null;
  /** null — ще не вступив. */
  member: MemberDoc | null;
  lang: Lang;
  busy: boolean;
  onJoin(): void;
  onInstagram(login: string): void;
}) {
  const [login, setLogin] = useState('');
  const [bad, setBad] = useState('');

  /* Гостю показуємо не форму входу, а те, заради чого входити:
     що дає програма й скільки дає кожен рівень. Форма входу без
     пояснення — це питання без причини. */
  if (!user) {
    return (
      <div className="fclub">
        <h3 className="fclub__title">{t('fc.title', lang)}</h3>
        <p className="account-note">{t('fc.pitch', lang)}</p>
        <Ladder lang={lang} level={0} />
        <p className="account-note">{t('fc.guest', lang)}</p>
      </div>
    );
  }

  /* Ще не вступив: пояснюємо в трьох рядках і показуємо драбину. */
  if (!member) {
    return (
      <div className="fclub">
        <h3 className="fclub__title">{t('fc.title', lang)}</h3>
        <p className="account-note">{t('fc.pitch', lang)}</p>
        <Ladder lang={lang} level={0} />
        <p className="account-note fclub__past">{t('fc.past', lang)}</p>
        <button className="btn btn--primary" type="button" disabled={busy} onClick={onJoin}>
          {busy ? t('fc.joining', lang) : t('fc.join', lang)}
        </button>
      </div>
    );
  }

  const p = progressOf(member);
  const uk = lang !== 'en';

  return (
    <div className="fclub">
      <div className="fclub__head">
        <span className="fclub__level">
          {t('fc.level', lang)} {p.level}
          {p.friendly ? <i className="fclub__mark">Friendly</i> : null}
        </span>
        <span className="fclub__percent">−{p.percent}%</span>
      </div>

      <div className="fclub__points">
        <b>{p.points.toLocaleString(uk ? 'uk' : 'en')}</b>
        <span>{t('fc.points', lang)}</span>
      </div>

      {/* Смужка й одне число: скільки ще треба. Верхньому рівню
          рухатись нікуди, тож там інша розмова. */}
      {p.to === null ? (
        <p className="account-note">{t('fc.top', lang)}</p>
      ) : (
        <>
          <div className="fclub__bar" role="presentation">
            <span style={{ width: Math.round(p.ratio * 100) + '%' }} />
          </div>
          <p className="fclub__need">
            {t('fc.need', lang)
              .replace('{n}', p.need.toLocaleString(uk ? 'uk' : 'en'))
              .replace('{lvl}', String(p.level + 1))}
          </p>
          {p.deadline ? (
            <p className="account-note fclub__till">
              {t('fc.till', lang).replace('{date}', dayText(p.deadline, lang))}
            </p>
          ) : (
            <p className="account-note fclub__till">{t('fc.noClock', lang)}</p>
          )}
        </>
      )}

      <Ladder lang={lang} level={p.level} />

      {/* Клуб: рівень дозволив, лишилось назватися. */}
      {p.friendly ? (
        member.instagram ? (
          <div className="fclub__inclub">
            <b>{t('fc.inClub', lang)}</b>
            <span>@{member.instagram}</span>
          </div>
        ) : (
          <div className="fclub__join">
            <p>{t('fc.needInsta', lang)}</p>
            <div className="field">
              <label htmlFor="fcInsta">{t('fc.insta', lang)}</label>
              <input
                id="fcInsta"
                value={login}
                autoComplete="off"
                placeholder="reyter.ua"
                onChange={(e) => {
                  setLogin(e.target.value);
                  setBad('');
                }}
              />
              {bad ? <p className="field__err">{bad}</p> : null}
            </div>
            <button
              className="btn btn--primary"
              type="button"
              disabled={busy}
              onClick={() => {
                const clean = instagramLogin(login);
                if (!instagramOk(clean)) return setBad(t('fc.instaBad', lang));
                onInstagram(clean);
              }}
            >
              {busy ? t('fc.joining', lang) : t('fc.openClub', lang)}
            </button>
          </div>
        )
      ) : null}

      <p className="fclub__num">
        {t('fc.number', lang)}: <b>{member.number}</b>
      </p>

      {member.historyPending ? (
        <p className="account-note fclub__pending">{t('fc.pending', lang)}</p>
      ) : null}
    </div>
  );
}

/** Драбина рівнів. Показуємо завжди: людині треба бачити не лише
 *  де вона, а й куди веде дорога — інакше сенсу накопичувати
 *  немає. */
function Ladder({ lang, level }: { lang: Lang; level: number }) {
  const uk = lang !== 'en';
  return (
    <ul className="fclub__ladder">
      {LEVELS.map((l) => (
        <li key={l.level} className={l.level === level ? 'is-now' : ''}>
          <span className="fclub__ladder-lvl">
            {t('fc.level', lang)} {l.level}
            {l.friendly ? <i>Friendly</i> : null}
          </span>
          <span className="fclub__ladder-pts">
            {l.from.toLocaleString(uk ? 'uk' : 'en')}
            {l.to === null ? '+' : '–' + l.to.toLocaleString(uk ? 'uk' : 'en')}
          </span>
          <span className="fclub__ladder-off">{l.percent ? '−' + l.percent + '%' : '—'}</span>
        </li>
      ))}
    </ul>
  );
}

/** «до 15 серпня 2027». Дата словами: рядок 2027-08-15 людина
 *  читає повільніше, ніж треба. */
function dayText(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}
