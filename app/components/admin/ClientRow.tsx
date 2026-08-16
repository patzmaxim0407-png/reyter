'use client';

import { useState } from 'react';
import { SEGMENTS, type Client } from '@/lib/admin/clients';
import { daysLeft, initials, niceDay } from '@/lib/admin/loyalty-db';
import { progressOf } from '@/lib/loyalty';

/* ============================================================
   Рядок клієнта
   ------------------------------------------------------------
   Згорнутий — це відповідь на «хто це і скільки він нам вартий».
   Розгорнутий — на «що з ним робити далі».

   Взірцем узято рядок замовлення, а не рядок учасника програми:
   тут теж треба розкривати подробиці, і людина вже знає, що
   стрілка праворуч означає «є що подивитись».

   ЧОГО ТУТ НЕМАЄ. Жодного показника, який нема на що замінити
   дією. «Днів від останньої покупки» лишилось, бо за ним пишуть
   листа; «середня кількість позицій у чеку» — прибрано, бо з
   нього не випливає нічого.
   ============================================================ */

const TITLES = new Map(SEGMENTS.map((s) => [s.id, s.title]));

function money(n: number): string {
  return Math.round(n).toLocaleString('uk');
}

/** «92 дні тому» — саме так це питання і звучить у голові. */
function ago(days: number | null): string {
  if (days === null) return 'не купував';
  if (days === 0) return 'сьогодні';
  if (days === 1) return 'учора';
  if (days < 31) return days + ' дн. тому';
  const months = Math.round(days / 30);
  if (months < 12) return months + ' міс. тому';
  const years = Math.floor(days / 365);
  return years === 1 ? 'рік тому' : years + ' р. тому';
}

function dayText(d: Date | null): string {
  if (!d) return '';
  return niceDay(d.toISOString().slice(0, 10));
}

export default function ClientRow({
  x,
  onWrite
}: {
  x: Client;
  /** Написати цій людині окремим листом — з її картки. */
  onWrite?(c: Client): void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const m = x.member;
  const p = m ? progressOf(m) : null;

  function copy(text: string, what: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(what);
        setTimeout(() => setCopied(''), 1200);
      })
      .catch(() => {});
  }

  /* Прострочене замовлення грошей не принесло, але сказати про
     це треба лише тоді, коли таке справді трапляється часто:
     одне скасування з десяти — не характеристика людини. */
  const flaky = x.dropped > 0 && x.dropped >= x.bought;
  /* Час писати: людина мовчить довше за власну звичку. */
  const late = x.due ? x.due.getTime() < Date.now() : false;

  return (
    <div className={'aq-item cl-' + x.segment + (open ? ' is-open' : '')}>
      <button
        className="aq-row__main cl-row"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cl-row__who">
          <span className={'loy-ava lvl-' + (p ? p.level : 1)} aria-hidden="true">
            {initials(x.email || x.name || '?')}
          </span>
          <span className="cl-row__id">
            <b>{x.name || x.email || 'без імені'}</b>
            <span>{x.email || x.phone || '—'}</span>
          </span>
        </span>

        <span className="cl-row__seg">
          <i className={'cl-tag cl-' + x.segment}>{TITLES.get(x.segment)}</i>
          {m ? <i className="cl-tag is-lvl">{p!.level} рівень</i> : null}
        </span>

        <span className="cl-row__money">
          <b>{money(x.spent)} грн</b>
          <span>{x.bought ? x.bought + ' пок. · сер. ' + money(x.avg) : 'покупок немає'}</span>
        </span>

        <span className="cl-row__when">
          <b className={late ? 'is-late' : ''}>{ago(x.quiet)}</b>
          <span>{x.gap ? 'бере раз на ' + x.gap + ' дн.' : x.city || ''}</span>
        </span>

        <span className="aq-row__chev" aria-hidden="true">
          ›
        </span>
      </button>

      {open ? (
        <div className="aq-details">
          <div className="cl-card">
            {/* ---------- Що робити ----------
                Найперше й найголовніше: заради цього екран і
                існує. Порада залежить від стану людини, а не від
                загального правила. */}
            <p className="cl-todo">
              {SEGMENTS.find((s) => s.id === x.segment)?.todo}
              {late && x.due ? ` · за звичкою мав купити ще ${dayText(x.due)}` : ''}
            </p>

            <div className="cl-grid">
              {/* ---------- Зв'язок ---------- */}
              <section className="cl-box">
                <h5>Звʼязок</h5>
                <dl className="cl-facts">
                  {x.email ? (
                    <>
                      <dt>Пошта</dt>
                      <dd>
                        <button
                          type="button"
                          className={'cl-copy' + (copied === 'mail' ? ' is-copied' : '')}
                          onClick={() => copy(x.email, 'mail')}
                        >
                          {copied === 'mail' ? 'скопійовано ✓' : x.email}
                        </button>
                      </dd>
                    </>
                  ) : null}
                  {x.phone ? (
                    <>
                      <dt>Телефон</dt>
                      <dd>
                        <a href={'tel:' + x.phone.replace(/\s/g, '')}>{x.phone}</a>
                      </dd>
                    </>
                  ) : null}
                  {m?.instagram ? (
                    <>
                      <dt>Instagram</dt>
                      <dd>
                        <button
                          type="button"
                          className={'cl-copy' + (copied === 'insta' ? ' is-copied' : '')}
                          onClick={() => copy('@' + String(m.instagram).replace(/^@+/, ''), 'insta')}
                        >
                          {copied === 'insta' ? 'скопійовано ✓' : '@' + String(m.instagram).replace(/^@+/, '')}
                        </button>
                      </dd>
                    </>
                  ) : null}
                  {x.place ? (
                    <>
                      <dt>Возимо</dt>
                      <dd>
                        {x.city}
                        {x.place ? ' · ' + x.place : ''}
                      </dd>
                    </>
                  ) : null}
                  {x.channel ? (
                    <>
                      <dt>Звідки прийшов</dt>
                      <dd>{x.channel}</dd>
                    </>
                  ) : null}
                </dl>
              </section>

              {/* ---------- Розмірна карта ----------
                  Найчастіше питання в трубці — «а який у мене був
                  розмір?». Досі на нього не відповідав ніхто. */}
              {x.fits.length ? (
                <section className="cl-box">
                  <h5>Розміри</h5>
                  <ul className="cl-fits">
                    {x.fits.slice(0, 6).map((f) => (
                      <li key={f.category}>
                        <span>{f.category}</span>
                        <b>{f.size}</b>
                        {/* «3 із 7» чесніше за просто «M»: видно,
                            це правило чи один випадок. */}
                        <i>{f.of === f.all ? 'завжди' : f.of + ' із ' + f.all}</i>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* ---------- Гроші ---------- */}
              <section className="cl-box">
                <h5>Гроші</h5>
                <dl className="cl-facts">
                  <dt>Витратив усього</dt>
                  <dd>
                    <b>{money(x.spent)} грн</b> за {x.units} шт
                  </dd>
                  <dt>Середній чек</dt>
                  <dd>{money(x.avg)} грн</dd>
                  {x.saved ? (
                    <>
                      <dt>Отримав знижок</dt>
                      <dd>
                        {money(x.saved)} грн
                        {x.spent ? ` · ${Math.round((x.saved / (x.spent + x.saved)) * 100)}% від покупок` : ''}
                      </dd>
                    </>
                  ) : null}
                  {x.promos.length ? (
                    <>
                      <dt>Промокоди</dt>
                      <dd>{x.promos.join(', ')}</dd>
                    </>
                  ) : null}
                  {x.first ? (
                    <>
                      <dt>Перша покупка</dt>
                      <dd>{dayText(x.first)}</dd>
                    </>
                  ) : null}
                  {flaky ? (
                    <>
                      <dt>Скасовано</dt>
                      <dd className="is-warn">{x.dropped} — з такими краще говорити, а не писати</dd>
                    </>
                  ) : null}
                </dl>
              </section>

              {/* ---------- Програма лояльності ---------- */}
              {m && p ? (
                <section className="cl-box">
                  <h5>Програма</h5>
                  <dl className="cl-facts">
                    <dt>Рівень</dt>
                    <dd>
                      {p.level} · знижка −{p.percent}%
                    </dd>
                    <dt>Балів</dt>
                    <dd>
                      {m.points.toLocaleString('uk')}
                      {p.to === null ? ' · верхній рівень' : ` · до ${p.level + 1} ще ${p.need.toLocaleString('uk')}`}
                    </dd>
                    {p.deadline ? (
                      <>
                        <dt>Згорають</dt>
                        <dd className={(daysLeft(p.deadline) ?? 999) <= 30 ? 'is-warn' : ''}>
                          {niceDay(p.deadline)}
                        </dd>
                      </>
                    ) : null}
                    <dt>Номер</dt>
                    <dd>{m.number}</dd>
                  </dl>
                </section>
              ) : null}

              {/* ---------- Що бере ---------- */}
              {x.favourites.length ? (
                <section className="cl-box">
                  <h5>Що бере</h5>
                  <ul className="cl-top">
                    {x.favourites.slice(0, 5).map((g) => (
                      <li key={g.id}>
                        <span>{g.name}</span>
                        <i>{g.category}</i>
                        <b>{g.qty} шт</b>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            {/* ---------- Історія ----------
                Повністю, а не «останні три»: саме давня покупка й
                буває тим, заради чого сюди зайшли. */}
            {x.orders.length ? (
              <section className="cl-box cl-box--wide">
                <h5>Покупки</h5>
                <ul className="cl-orders">
                  {x.orders.map((o) => (
                    <li key={o._id} className={'st-' + (o.status || 'new')}>
                      <span className="cl-orders__num">№{o.num}</span>
                      <span className="cl-orders__day">{dayText(new Date(o.date || 0))}</span>
                      <span className="cl-orders__what">
                        {(o.items || []).map((i) => i.name + (i.size ? ' · ' + i.size : '')).join(', ')}
                      </span>
                      <span className="cl-orders__sum">{money(Number(o.total) || 0)} грн</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {onWrite && x.email ? (
              <div className="cl-acts">
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => onWrite(x)}>
                  ✉ Написати цій людині
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
