'use client';

import { useState } from 'react';
import { addressLine } from '@/lib/address';
import { fmt, type Catalogue } from '@/lib/catalog';
import { NEXT_STEP, STATUSES, confirmText, itemCat, orderDate, statusInfo } from '@/lib/admin/orders';
import { підпис, стан, тривога, type Посилка } from '@/lib/admin/np';
import type { OrderItem } from '@/lib/types';

/* ============================================================
   Картка замовлення в адмінці
   ------------------------------------------------------------
   Розмітка й класи ті самі, що в старій панелі, тож admin.css
   підходить без правок.

   Картка нічого не робить сама: усі дії йдуть назовні колбеками.
   Так її можна показати й у списку, і в друкованій формі, і в
   тесті — без бази поруч.
   ============================================================ */

export interface AdminOrder {
  _id: string;
  num: string;
  date?: string;
  status?: string;
  total: number;
  discount?: number;
  shipping?: number;
  promoCode?: string;
  ttn?: string;
  /** Коли номер накладної пішов покупцеві листом. */
  ttnSentAt?: string;
  lang?: string;
  note?: string;
  email?: string;
  message?: string;
  stockApplied?: boolean;
  items?: OrderItem[];
  customer?: Record<string, unknown>;
  statusLog?: { status?: string; at?: string; by?: string }[];
  writeoff?: { title?: string; note?: string; by?: string };
  trackKey?: string;
}

export default function OrderCard({
  o,
  c: catalog,
  picked,
  onPick,
  onStatus,
  onEdit,
  onField,
  parcel,
  embedded,
  onSendTtn,
  onMakeTtn,
  onCopy,
  onPrint,
  onDelete
}: {
  o: AdminOrder;
  /** Каталог потрібен, щоб підставити категорію в старе
   *  замовлення, де її в позиції ще не зберігали. */
  c: Catalogue;
  picked?: boolean;
  onPick?(on: boolean): void;
  onStatus(next: string): void;
  onEdit?(): void;
  onField?(field: 'ttn' | 'note', value: string): void;
  onSendTtn?(): void;
  /** Створити накладну просто звідси, у кабінеті перевізника. */
  onMakeTtn?(): void;
  /** Що каже про посилку сам перевізник. */
  parcel?: Посилка;
  /** Картка стоїть під рядком черги, який уже сказав номер,
   *  імʼя, адресу й суму. Повторювати це вдруге — не «докладно»,
   *  а шум; та й розкривати вдруге те, що вже розкрито, нікому
   *  не хочеться. Тому в цьому режимі картка починається одразу
   *  з подробиць. */
  embedded?: boolean;
  onCopy?(): void;
  onPrint?(): void;
  onDelete?(): void;
}) {
  const [open, setOpen] = useState(!!embedded);
  const st = o.status || 'new';
  const c = o.customer ?? {};
  const next = NEXT_STEP[st as keyof typeof NEXT_STEP];
  const маєТТН = !!String(o.ttn || '').trim();
  /* Відправлено без накладної — найдорожча забудькуватість у
     цьому вікні: покупець уже чекає, а сказати йому нічого.

     А от виконаному замовленню номер уже ні до чого: посилку
     забрали, і червоний значок на ній — просто шум, який
     привчає не звертати уваги на червоні значки взагалі. */
  const потрібнаТТН = st === 'shipped' && !маєТТН;
  const рівень = parcel ? тривога(parcel) : 0;
  /* Перевізник каже «отримано», а в нас усе ще «Відправлено» —
     значить, замовлення можна закривати, і сказати про це має
     сама картка, а не пам'ять менеджера. */
  const можнаЗакрити = st === 'shipped' && parcel && стан(parcel.code) === 'отримано';

  /* Перевізник не веде журналу подій — його API віддає лише те,
     що з посилкою ЗАРАЗ, і кілька дат. Тому стрічку збираємо самі
     з того, що є: створено — обіцяли — забрали. Крок, до якого
     дійшло, підсвічений; майбутні стоять сірими. */
  const кроки = parcel
    ? [
        { title: 'Накладну створено', when: parcel.createdAt, done: !!parcel.createdAt, now: стан(parcel.code) === 'створено' },
        {
          title: стан(parcel.code) === 'чекає' ? 'У відділенні' : 'У дорозі',
          when: parcel.scheduled ? 'орієнтовно ' + parcel.scheduled : '',
          done: ['чекає', 'отримано'].includes(стан(parcel.code)),
          now: ['дорога', 'чекає'].includes(стан(parcel.code))
        },
        {
          title: 'Отримано',
          when: parcel.gotAt,
          done: стан(parcel.code) === 'отримано',
          now: стан(parcel.code) === 'отримано'
        }
      ]
    : [];

  const delivery = addressLine(c as never);
  const units = (o.items ?? []).reduce((n, i) => n + (Number(i.qty) || 0), 0);
  const goods = (o.items ?? []).reduce((n, i) => n + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const disc = Number(o.discount) || 0;
  const ship = Number(o.shipping) || 0;

  /* Той самий orderDate, що й у сортуванні списку: у найперших
     замовленнях часу в date немає, він лежить у created — і без
     цієї гілки картка показувала б порожню дату. */
  const d = orderDate(o as never);
  const dateFull = d.getTime()
    ? d.toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : '';

  const email = String(c.email ?? o.email ?? '');
  const phone = String(c.phone ?? '');
  const confirm = confirmText(c as never);

  return (
    <article className={'ao-card st-' + st + (open ? ' is-open' : '') + (embedded ? ' ao-card--in' : '')}>
      {embedded ? null : (
      <div className="ao-card__top">
        {onPick ? (
          <label className="ao-pick">
            <input type="checkbox" checked={!!picked} onChange={(e) => onPick(e.target.checked)} />
          </label>
        ) : null}

        <b className="ao-card__num">№{o.num}</b>

        <select
          className={'ao-status-select st-' + st}
          value={st}
          onChange={(e) => onStatus(e.target.value)}
        >
          {STATUSES.map((x) => (
            <option value={x.id} key={x.id}>
              {x.title}
            </option>
          ))}
        </select>

        {/* Що каже сам перевізник. Це не прикраса: «лежить
            пʼятий день» і «повертається» — саме ті дві новини,
            через які замовлення втрачають гроші. */}
        {parcel ? (
          <span
            className={'ao-tag ao-parcel' + (рівень === 2 ? ' ao-tag--warn' : рівень === 1 ? ' ao-parcel--wait' : '')}
            title={(parcel.status || '') + (parcel.place ? ' · ' + parcel.place : '')}
          >
            {підпис(parcel)}
          </span>
        ) : null}

        {/* Найпомітніша річ у картці — те, чого бракує. Червоний
            значок видно навіть у згорнутому списку, тож замовлення
            без накладної не загубиться серед решти. */}
        {потрібнаТТН ? (
          <span className="ao-tag ao-tag--warn" title="Відправлено без номера накладної">
            без ТТН
          </span>
        ) : маєТТН ? (
          <span className="ao-tag ao-tag--ttn" title={'ТТН ' + o.ttn}>
            ТТН {o.ttnSentAt ? '✓' : '·'}
          </span>
        ) : null}

        {/* Позначка про списання: без неї не видно, чи залишки
            вже зрушені, і легко списати той самий товар двічі */}
        {o.stockApplied ? (
          <span className="ao-tag" title="Товар списано зі складу">
            склад ✓
          </span>
        ) : null}

        <span className="ao-card__date">{dateFull}</span>
        <span className="ao-card__sum">{fmt(o.total)} грн</span>
      </div>
      )}

      <div className="ao-card__mid" hidden={embedded}>
        <div className="ao-card__customer">
          <b>{String(c.name ?? '—')}</b>
          {' · '}
          <a href={'tel:' + phone.replace(/\s/g, '')}>{phone || '—'}</a>
          {email ? (
            <>
              {' · '}
              <a href={'mailto:' + email}>{email}</a>
            </>
          ) : null}

          {delivery ? (
            <>
              <br />
              <span className="ao-muted">
                🚚 {delivery}
                {ship ? ` · ${fmt(ship)} грн` : ''}
              </span>
            </>
          ) : null}

          {disc ? (
            <>
              <br />
              <span className="ao-muted">
                🏷 Знижка {fmt(disc)} грн{o.promoCode ? ` · ${o.promoCode}` : ''}
              </span>
            </>
          ) : null}

          {confirm ? (
            <>
              <br />
              <span className="ao-muted">☎️ {confirm}</span>
            </>
          ) : null}

          {c.comment ? (
            <>
              <br />
              <span className="ao-muted">💬 {String(c.comment)}</span>
            </>
          ) : null}
        </div>

        <button className="ao-toggle" type="button" onClick={() => setOpen((v) => !v)}>
          {open ? 'Згорнути' : 'Деталі'} · {units} шт
        </button>
      </div>

      {open ? (
        <div className="ao-card__details">
          <div className="ao-card__items">
            {(o.items ?? []).map((i, n) => (
              <div className="ao-line" key={n}>
                <span>
                  {i.name}
                  {itemCat(catalog, i) ? <em className="ao-line__cat">{itemCat(catalog, i)}</em> : null}
                  {i.size ? (
                    <>
                      {' · '}
                      <b>{i.size}</b>
                    </>
                  ) : null}

                  {/* Склад комплекту: саме за цими розмірами
                      збирати замовлення */}
                  {(i.parts ?? []).length ? (
                    <span className="ao-line__parts">
                      {(i.parts ?? []).map((x, k) => (
                        <span key={k}>
                          {k ? <br /> : null}· {itemCat(catalog, x) ? itemCat(catalog, x) + ' · ' : ''}
                          {x.name || x.id}
                          {x.size ? (
                            <>
                              {' · '}
                              <b>{x.size}</b>
                            </>
                          ) : null}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                <span>
                  {i.qty} × {fmt(i.price)} = <b>{fmt(i.price * i.qty)} грн</b>
                </span>
              </div>
            ))}
          </div>

          {/* Товари, знижка й доставка окремими рядками — інакше
              з картки не видно, чому сума саме така */}
          <div className="ao-sums">
            <div className="ao-sumline">
              <span>Товари</span>
              <span>{fmt(goods)} грн</span>
            </div>
            {disc ? (
              <div className="ao-sumline is-off">
                <span>Знижка{o.promoCode ? <> · <b>{o.promoCode}</b></> : null}</span>
                <span>−{fmt(disc)} грн</span>
              </div>
            ) : null}
            {ship ? (
              <div className="ao-sumline">
                <span>Доставка</span>
                <span>{fmt(ship)} грн</span>
              </div>
            ) : null}
            <div className="ao-sumline is-total">
              <span>До сплати</span>
              <span>{fmt(o.total)} грн</span>
            </div>
          </div>

          {st !== 'done' && st !== 'cancelled' && onEdit ? (
            <button className="btn btn--ghost btn--sm ao-editorder" type="button" onClick={onEdit}>
              ✎ Редагувати замовлення
            </button>
          ) : null}

          {/* Дорога посилки словами перевізника. Менеджер
              найчастіше відкриває картку саме заради цього: де
              вона, коли обіцяють, чи вже забрали. */}
          {parcel ? (
            <div className={'ao-way u-' + рівень}>
              <div className="ao-way__now">
                <b>{підпис(parcel)}</b>
                {parcel.status && parcel.status !== підпис(parcel) ? (
                  <span>{parcel.status}</span>
                ) : null}
              </div>
              <ol className="ao-way__steps">
                {кроки.map((к) => (
                  <li key={к.title} className={к.done ? 'is-done' : к.now ? 'is-now' : ''}>
                    <b>{к.title}</b>
                    <span>{к.when || '—'}</span>
                  </li>
                ))}
              </ol>

              <dl className="ao-way__list">
                {parcel.city || parcel.place ? (
                  <div>
                    <dt>Куди</dt>
                    <dd>{[parcel.city, parcel.place].filter(Boolean).join(' · ')}</dd>
                  </div>
                ) : null}
                {parcel.scheduled ? (
                  <div>
                    <dt>Планова доставка</dt>
                    <dd>{parcel.scheduled}</dd>
                  </div>
                ) : null}
                {parcel.gotAt ? (
                  <div>
                    <dt>Забрали</dt>
                    <dd>{parcel.gotAt}</dd>
                  </div>
                ) : null}
                {parcel.createdAt ? (
                  <div>
                    <dt>Накладну створено</dt>
                    <dd>{parcel.createdAt}</dd>
                  </div>
                ) : null}
                {parcel.backMoney ? (
                  <div>
                    <dt>Післяплата</dt>
                    <dd>{parcel.backMoney} грн</dd>
                  </div>
                ) : null}
              </dl>
              <a
                className="ao-way__link"
                href={'https://novaposhta.ua/tracking/?cargo_number=' + encodeURIComponent(String(o.ttn || ''))}
                target="_blank"
                rel="noreferrer"
              >
                Відкрити в Новій Пошті →
              </a>
            </div>
          ) : null}

          {/* Вбудована картка шапки не має, а разом із нею
              зникав і перемикач статусу: лишались «наступний
              крок» та «Скасувати». Але життя не завжди йде
              вперед — замовлення повертають, відкочують, ставлять
              наново. Тому всі стани тут, і поточний видно. */}
          {embedded ? (
            <div className="ao-setst">
              <span className="ao-field__label">Статус</span>
              <div className="ao-setst__row">
                {STATUSES.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className={'aq-badge st-' + x.id + (x.id === st ? ' is-on' : '')}
                    onClick={() => x.id !== st && onStatus(x.id)}
                  >
                    {x.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="ao-card__grid">
            <label className={'ao-field ao-field--ttn' + (потрібнаТТН ? ' is-need' : '')}>
              <span>
                ТТН
                {o.ttnSentAt ? (
                  <em className="ao-ttn__sent" title={'Надіслано ' + o.ttnSentAt}>надіслано ✓</em>
                ) : null}
              </span>
              <input
                defaultValue={o.ttn ?? ''}
                placeholder="номер накладної"
                /* Пишемо по виходу з поля, а не на кожну літеру:
                   інакше кожен символ їхав би в базу окремим
                   записом, а список — перемальовувався б */
                onBlur={(e) => {
                  if (e.target.value !== (o.ttn ?? '')) onField?.('ttn', e.target.value);
                }}
              />
              {/* Створити накладну можна доти, доки її немає, —
                  і в архіві теж. Виконане замовлення часом
                  доводиться відправити ще раз: обмін, дослання
                  забутої речі, повторна спроба після повернення. */}
              {!маєТТН && onMakeTtn && st !== 'cancelled' ? (
                <button
                  className="btn btn--primary btn--sm ao-ttn__make"
                  type="button"
                  onClick={onMakeTtn}
                >
                  Створити накладну
                </button>
              ) : null}
              {маєТТН && onSendTtn ? (
                <button
                  className="btn btn--ghost btn--sm ao-ttn__send"
                  type="button"
                  onClick={onSendTtn}
                >
                  {o.ttnSentAt ? 'Надіслати ще раз' : 'Надіслати покупцеві'}
                </button>
              ) : null}
              {потрібнаТТН ? (
                <em className="ao-ttn__warn">
                  Посилка відправлена, а номера немає — покупець не знає, де вона.
                </em>
              ) : null}
            </label>
            <label className="ao-field">
              <span>Нотатка менеджера</span>
              <input
                defaultValue={o.note ?? ''}
                placeholder="напр.: передзвонити після 18:00"
                onBlur={(e) => {
                  if (e.target.value !== (o.note ?? '')) onField?.('note', e.target.value);
                }}
              />
            </label>
          </div>

          {/* Товар не повернули на склад — причина має бути видна
              прямо в картці, інакше через тиждень її вже не знайти */}
          {o.writeoff ? (
            <p className="ao-lost">
              Товар не повернувся на склад · <b>{o.writeoff.title}</b>
              {o.writeoff.note ? ' · ' + o.writeoff.note : ''}
            </p>
          ) : null}

          {/* Найновіше згори: читають саме останнє, а не перше */}
          {(o.statusLog ?? []).length ? (
            <div className="ao-history">
              {(o.statusLog ?? [])
                .slice()
                .reverse()
                .map((h, n) => (
                  <div key={n}>
                    <b>{statusInfo(h.status).title}</b>
                    <span>
                      {h.at
                        ? new Date(h.at).toLocaleString('uk-UA', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : ''}
                      {h.by ? ' · ' + h.by : ''}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="ao-note">Історія порожня — статус ще не змінювався.</p>
          )}
        </div>
      ) : null}

      {можнаЗакрити ? (
        <div className="ao-card__hint">
          <span>Перевізник каже: посилку отримано{parcel?.gotAt ? ' · ' + parcel.gotAt : ''}</span>
          <button className="btn btn--primary btn--sm" type="button" onClick={() => onStatus('done')}>
            Закрити замовлення
          </button>
        </div>
      ) : null}

      <div className="ao-card__actions">
        {next ? (
          <button className="btn btn--primary btn--sm" type="button" onClick={() => onStatus(next.id)}>
            {next.label}
          </button>
        ) : null}
        {st !== 'cancelled' && st !== 'done' ? (
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => onStatus('cancelled')}>
            Скасувати
          </button>
        ) : null}
        {onCopy ? (
          <button className="btn btn--ghost btn--sm" type="button" onClick={onCopy}>
            Скопіювати
          </button>
        ) : null}
        {onPrint ? (
          <button className="btn btn--ghost btn--sm" type="button" onClick={onPrint}>
            Друк
          </button>
        ) : null}
        {onDelete ? (
          <button className="btn btn--ghost btn--sm ao-danger" type="button" onClick={onDelete}>
            Видалити
          </button>
        ) : null}
      </div>
    </article>
  );
}
