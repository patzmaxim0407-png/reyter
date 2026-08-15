'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { HISTORY_FROM, LEVELS, instagramLogin, instagramOk, progressOf } from '@/lib/loyalty';
import type { MemberDoc } from '@/lib/admin/loyalty-db';
import { loyaltyTerms } from '@/lib/loyalty-terms';
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
  /** undefined — ще читаємо базу; null — точно не учасник. */
  member: MemberDoc | null | undefined;
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
      <div className="loy">
        <Intro lang={lang} />
        <Ladder lang={lang} level={0} />
        <p className="loy__foot">{t('fc.guest', lang)}</p>
        <Terms lang={lang} />
      </div>
    );
  }

  /* Ще не знаємо, хто перед нами. Запрошення вступити тут
     показувати не можна: учасник побачив би пропозицію зробити
     те, що вже зробив. Тому мовчазне місце під картку — воно
     зникне за частку секунди. */
  if (member === undefined) {
    return (
      <div className="loy">
        <div className="loy-card loy-card--wait" aria-hidden="true">
          <span className="loy-card__lvl">&nbsp;</span>
          <span className="loy-card__off">&nbsp;</span>
          <span className="loy-card__pts">&nbsp;</span>
        </div>
        <Ladder lang={lang} level={0} />
      </div>
    );
  }

  /* Ще не вступив: пояснюємо в трьох рядках і показуємо драбину. */
  if (!member) {
    return (
      <div className="loy">
        <Intro lang={lang} />
        <Ladder lang={lang} level={0} />
        <p className="loy__foot">
          {t('fc.past', lang).replace('{date}', shortDay(HISTORY_FROM, lang))}
        </p>
        <button className="btn btn--primary loy__cta" type="button" disabled={busy} onClick={onJoin}>
          {busy ? t('fc.joining', lang) : t('fc.join', lang)}
        </button>
        <Terms lang={lang} />
      </div>
    );
  }

  const p = progressOf(member);
  const uk = lang !== 'en';

  return (
    <div className="loy">
      {/* Картка учасника: рівень, знижка й бали одним блоком —
          це те, заради чого людина сюди зайшла. */}
      <div className="loy-card">
        <span className="loy-card__lvl">
          {t('fc.level', lang)} {p.level}
          {p.friendly ? <i className="loy-card__club">Friendly</i> : null}
        </span>
        <span className="loy-card__off">−{p.percent}%</span>
        <span className="loy-card__pts">
          <b>{p.points.toLocaleString(uk ? 'uk' : 'en')}</b> {t('fc.points', lang)}
        </span>
      </div>

      {/* Смужка й одне число: скільки ще треба. Верхньому рівню
          рухатись нікуди, тож там інша розмова. */}
      {p.to === null ? (
        <p className="account-note">{t('fc.top', lang)}</p>
      ) : (
        <>
          <div className="loy__bar" role="presentation">
            <span style={{ width: Math.max(3, Math.round(p.ratio * 100)) + '%' }} />
          </div>
          <p className="loy__need">
            {t('fc.need', lang)
              .replace('{n}', p.need.toLocaleString(uk ? 'uk' : 'en'))
              .replace('{lvl}', String(p.level + 1))}
          </p>
          {p.deadline ? (
            <p className="account-note loy__till">
              {t('fc.till', lang).replace('{date}', dayText(p.deadline, lang))}
            </p>
          ) : (
            <p className="account-note loy__till">{t('fc.noClock', lang)}</p>
          )}
        </>
      )}

      <Ladder lang={lang} level={p.level} />

      {/* Клуб: рівень дозволив, лишилось назватися. */}
      {p.friendly ? (
        member.instagram ? (
          <div className="loy__member">
            <b>{t('fc.inClub', lang)}</b>
            <span>@{member.instagram}</span>
          </div>
        ) : (
          <div className="loy__join">
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

      <p className="loy__num">
        {t('fc.number', lang)}: <b>{member.number}</b>
      </p>

      {member.historyPending ? (
        <p className="account-note loy__pending">{t('fc.pending', lang)}</p>
      ) : null}

      <Terms lang={lang} />
    </div>
  );
}

/** Умови програми повністю.
 *
 *  Згорнуті, бо на екрані вони — довідник, а не текст, який
 *  читають щодня: людина відкриває саме той пункт, через який
 *  прийшла. Розгортання рідне, елементом details: воно працює
 *  без нашого коду, слухається клавіатури й зчитувача екрана, і
 *  його не зламає жодне оновлення.
 *
 *  Числа в тексті беруться з правил програми, а не набрані
 *  руками. Умови, які розійшлися з програмою, гірші за
 *  відсутні: за ними покупець рахує своє й має рацію. */
function Terms({ lang }: { lang: Lang }) {
  return (
    <section className="loy-terms">
      <h4>{t('fc.terms', lang)}</h4>
      {loyaltyTerms(lang).map((term) => (
        <details key={term.title} className="loy-term">
          <summary>{term.title}</summary>
          <div className="loy-term__body">
            {term.body.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {term.list ? (
              <ul className="loy-term__list">
                {term.list.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            {(term.after || []).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

/** Заголовок і одне речення про суть. Довгих умов тут немає:
 *  хто захоче подробиць, той спитає. */
function Intro({ lang }: { lang: Lang }) {
  return (
    <div className="loy__intro">
      <h3>{t('fc.title', lang)}</h3>
      <p>{t('fc.pitch', lang)}</p>
    </div>
  );
}

/** Драбина рівнів. Показуємо завжди: людині треба бачити не лише
 *  де вона, а й куди веде дорога — інакше сенсу накопичувати
 *  немає. */
function Ladder({ lang, level }: { lang: Lang; level: number }) {
  const uk = lang !== 'en';
  return (
    <ol className="loy-steps">
      {LEVELS.map((l) => (
        <li
          key={l.level}
          className={
            'loy-step' +
            (l.level === level ? ' is-now' : '') +
            (l.friendly ? ' is-club' : '') +
            (level && l.level < level ? ' is-done' : '')
          }
        >
          <span className="loy-step__no">{l.level}</span>
          <span className="loy-step__off">{l.percent}%</span>
          <span className="loy-step__pts">
            {l.from.toLocaleString(uk ? 'uk' : 'en')}
            {l.to === null ? '+' : '–' + l.to.toLocaleString(uk ? 'uk' : 'en')}
          </span>
          {l.friendly ? <span className="loy-step__club">Friendly</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** «07.08.2026» — коротко, бо це межа в дрібному рядку, а не
 *  подія, до якої треба готуватись. */
function shortDay(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'uk-UA');
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
