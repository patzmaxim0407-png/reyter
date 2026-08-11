'use client';

import { useState } from 'react';
import { addressLine } from '@/lib/address';
import { fmt, type Catalogue } from '@/lib/catalog';
import { NEXT_STEP, STATUSES, confirmText, itemCat, orderDate, statusInfo } from '@/lib/admin/orders';
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
  onSendTtn,
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
  onCopy?(): void;
  onPrint?(): void;
  onDelete?(): void;
}) {
  const [open, setOpen] = useState(false);
  const st = o.status || 'new';
  const c = o.customer ?? {};
  const next = NEXT_STEP[st as keyof typeof NEXT_STEP];
  const маєТТН = !!String(o.ttn || '').trim();
  /* Відправлено без накладної — найдорожча забудькуватість у
     цьому вікні: покупець уже чекає, а сказати йому нічого. */
  const потрібнаТТН = (st === 'shipped' || st === 'done') && !маєТТН;

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
    <article className={'ao-card st-' + st + (open ? ' is-open' : '')}>
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

      <div className="ao-card__mid">
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
