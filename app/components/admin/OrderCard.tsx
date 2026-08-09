'use client';

import { useState } from 'react';
import { addressLine } from '@/lib/address';
import { fmt } from '@/lib/catalog';
import { ORDER_STATUSES, statusInfo } from '@/lib/account';
import { t } from '@/lib/i18n';
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
  note?: string;
  email?: string;
  message?: string;
  stockApplied?: boolean;
  items?: OrderItem[];
  customer?: Record<string, unknown>;
  statusLog?: { status?: string; at?: string; by?: string }[];
}

/** Наступний крок за поточним статусом. Кнопка одна, і вона
 *  веде туди, куди замовлення йде в девʼяти випадках із десяти. */
const NEXT_STEP: Record<string, { id: string; label: string }> = {
  new: { id: 'confirmed', label: 'Підтвердити' },
  confirmed: { id: 'shipped', label: 'Відправити' },
  shipped: { id: 'done', label: 'Виконано' }
};

function itemCat(i: { category?: string }): string {
  return i.category ?? '';
}

function confirmText(c: Record<string, unknown>): string {
  const conf = c.confirm as
    | { method?: string; messenger?: string; phoneMode?: string; altPhone?: string; telegram?: string }
    | undefined;
  if (!conf) return '';
  const name = { telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber' }[conf.messenger ?? ''] ?? '';
  const how = conf.method === 'messenger' ? name || t('cart.byMessenger') : t('cart.byCall');
  const phone = conf.phoneMode === 'other' && conf.altPhone ? conf.altPhone : String(c.phone ?? '');
  const out = [how];
  if (phone) out.push(phone);
  if (conf.telegram) out.push('@' + conf.telegram);
  return out.join(' · ');
}

export default function OrderCard({
  o,
  picked,
  onPick,
  onStatus,
  onEdit,
  onField,
  onCopy,
  onPrint,
  onDelete
}: {
  o: AdminOrder;
  picked?: boolean;
  onPick?(on: boolean): void;
  onStatus(next: string): void;
  onEdit?(): void;
  onField?(field: 'ttn' | 'note', value: string): void;
  onCopy?(): void;
  onPrint?(): void;
  onDelete?(): void;
}) {
  const [open, setOpen] = useState(false);
  const st = o.status || 'new';
  const c = o.customer ?? {};
  const next = NEXT_STEP[st];

  const delivery = addressLine(c as never);
  const units = (o.items ?? []).reduce((n, i) => n + (Number(i.qty) || 0), 0);
  const goods = (o.items ?? []).reduce((n, i) => n + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const disc = Number(o.discount) || 0;
  const ship = Number(o.shipping) || 0;

  const d = o.date ? new Date(o.date) : null;
  const dateFull =
    d && d.getTime()
      ? d.toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
      : '';

  const email = String(c.email ?? o.email ?? '');
  const phone = String(c.phone ?? '');
  const confirm = confirmText(c);

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
          {ORDER_STATUSES.map((id) => (
            <option value={id} key={id}>
              {statusInfo(id, t).title}
            </option>
          ))}
        </select>

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
                  {itemCat(i) ? <em className="ao-line__cat">{itemCat(i)}</em> : null}
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
                          {k ? <br /> : null}· {itemCat(x) ? itemCat(x) + ' · ' : ''}
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
            <label className="ao-field">
              <span>ТТН</span>
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

          <div className="ao-card__hist">
            <span className="ao-field__label">Історія статусів</span>
            <div className="ao-hist">
              {(o.statusLog ?? []).map((h, n) => (
                <div key={n}>
                  {statusInfo(h.status, t).title}
                  {h.at ? ' · ' + new Date(h.at).toLocaleString('uk-UA') : ''}
                  {h.by ? ' · ' + h.by : ''}
                </div>
              ))}
            </div>
          </div>
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
