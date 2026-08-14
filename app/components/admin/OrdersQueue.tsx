'use client';

import { useState } from 'react';
import OrderCard from './OrderCard';
import OrderRow from './OrderRow';
import {
  BANDS,
  queue,
  type AdminOrder,
  type Band,
  type ParcelHint,
  type Task
} from '@/lib/admin/orders';
import type { Catalogue } from '@/lib/catalog';
import { shortLabel, alarm, parcelState, type Parcel } from '@/lib/admin/np';
import { payLabel, payTone, type PayStatus } from '@/lib/pay';

/* ============================================================
   Черга справ
   ------------------------------------------------------------
   Список замовлень відповідав на питання «які в мене
   замовлення». Питання менеджера інше: «що зробити просто
   зараз». Тому тут не статуси, а дії — підтвердити, зібрати,
   вписати номер, розібратися з тим, що застрягло, закрити
   отримане.

   Виконані сюди не потрапляють узагалі: їхнє місце в архіві,
   а не перед очима щодня.

   Смуги стоять у сталому порядку й не зникають порожніми —
   гаснуть. Інакше екран перестрибував би щоразу, коли остання
   справа в смузі закінчилась, і рука щоразу шукала б наново.

   Рядок навмисно вузький: у ньому те, що потрібно для рішення —
   хто, куди, скільки, скільки чекає, — і одна кнопка дієсловом.
   Усе інше відкривається дотиком у той самий картці, що й у
   старому списку: розмітка вже написана й перевірена.
   ============================================================ */

export default function OrdersQueue({
  orders,
  c,
  parcels,
  payOf,
  onPayLink,
  onPayBack,
  onReceipt,
  onSendReceipt,
  payTwice,
  onRefundDouble,
  onFindPay,
  onStatus,
  onEdit,
  onField,
  onSendTtn,
  onMakeTtn,
  onDropTtn,
  onCopy,
  onPrint,
  onDelete
}: {
  orders: AdminOrder[];
  c: Catalogue;
  parcels: Map<string, Parcel>;
  /** Що каже банк про оплату цього замовлення. */
  payOf?(o: AdminOrder): PayStatus | undefined;
  onPayLink?(o: AdminOrder): void;
  onPayBack?(o: AdminOrder, paid: number): void;
  onReceipt?(o: AdminOrder): void;
  onSendReceipt?(o: AdminOrder): void;
  /** Скільки успішних оплат за цим замовленням. Більше однієї —
   *  з покупця взяли двічі, і це треба виправити першим. */
  payTwice?(o: AdminOrder): number;
  onRefundDouble?(o: AdminOrder): void;
  onFindPay?(o: AdminOrder): void;
  onStatus(o: AdminOrder, next: string): void | Promise<void>;
  onEdit?(o: AdminOrder): void;
  onField?(o: AdminOrder, field: 'ttn' | 'note', value: string): void;
  onSendTtn?(o: AdminOrder): void;
  onMakeTtn?(o: AdminOrder): void;
  onDropTtn?(o: AdminOrder): void;
  onCopy?(o: AdminOrder): void;
  onPrint?(o: AdminOrder): void;
  onDelete?(o: AdminOrder): void;
}) {
  const [open, setOpen] = useState('');
  /* Поки запис іде, кнопку блокуємо. Два кліки по «Підтвердити»
     означають два списання того самого товару зі складу — і
     полагодити це потім можна лише руками. */
  const [sending, setSending] = useState('');
  const bands = queue(orders, parcels as unknown as Map<string, ParcelHint>);
  const todo = bands
    .filter((s) => s.band.id !== 'transit')
    .reduce((n, s) => n + s.rows.length, 0);

  if (!todo && !bands.find((s) => s.band.id === 'transit')?.rows.length) {
    return (
      <div className="aq-empty">
        <b>✓</b>
        <span>Усе зроблено</span>
        <em>Нових замовлень немає, посилки в дорозі — теж.</em>
      </div>
    );
  }

  const withWork = bands.filter((s) => s.rows.length);
  const empty = bands.filter((s) => !s.rows.length);

  return (
    <div className="aq">
      {withWork.map(({ band, rows }) => (
        <section key={band.id} className={'aq-band aq-band--' + band.id}>
          <h3 className="aq-band__head">
            <span className="aq-band__title">{band.title}</span>
            <i>{rows.length}</i>
          </h3>

          {/* Значка статусу в рядку черги немає навмисно: смуга
              вже однозначно його задає — у «Підтвердити» всі
              «Нові», у «Зібрати» всі «Підтверджені». Двадцять
              однакових значків поспіль крали б увагу в того, що
              справді несе новину, — стану посилки. */}
          {rows.map(({ order, task }) => (
            <div
              key={order._id}
              className={
                'aq-item st-' +
                (order.status || 'new') +
                ' u-' +
                task.urgency +
                (open === order._id ? ' is-open' : '')
              }
            >
              <OrderRow
                num={order.num || ''}
                name={String((order.customer as Record<string, unknown>)?.name ?? '')}
                place={placeOf(order)}
                parcel={(() => {
                  if (order.pickup) return { text: 'Самовиніс', tone: 0 as const };
                  const parcel = parcels.get(String(order.ttn || '').replace(/\D/g, ''));
                  return parcel
                    ? { text: shortLabel(parcel), tone: alarm(parcel), state: parcelState(parcel.code) }
                    : undefined;
                })()}
                pay={(() => {
                  const r = payOf?.(order);
                  return r ? { text: payLabel(r.state), tone: payTone(r.state) } : undefined;
                })()}
                meta={task.why}
                sum={order.total || 0}
                tone={task.urgency}
                open={open === order._id}
                onToggle={() => setOpen(open === order._id ? '' : order._id)}
                action={
                  band.action
                    ? {
                        label: sending === order._id ? 'Хвилинку…' : band.action,
                        busy: sending === order._id,
                        onClick: async () => {
                          if (sending) return;
                          setSending(order._id);
                          try {
                            await runBandAction(order, band, onStatus, () => setOpen(order._id));
                          } finally {
                            setSending('');
                          }
                        }
                      }
                    : undefined
                }
              />

              {open === order._id ? (
                <div className="aq-details">
                  <OrderCard
                    o={order as never}
                    c={c}
                    embedded
                    parcel={parcels.get(String(order.ttn || '').trim())}
                    pay={payOf ? payOf(order) : undefined}
                    onPayLink={onPayLink ? () => onPayLink(order) : undefined}
                    onPayBack={
                      onPayBack
                        ? () => onPayBack(order, payOf?.(order)?.amount ?? order.total ?? 0)
                        : undefined
                    }
                    onReceipt={onReceipt ? () => onReceipt(order) : undefined}
                    onSendReceipt={onSendReceipt ? () => onSendReceipt(order) : undefined}
                    payTwice={payTwice ? payTwice(order) : 0}
                    onRefundDouble={onRefundDouble ? () => onRefundDouble(order) : undefined}
                    onFindPay={onFindPay ? () => onFindPay(order) : undefined}
                    onStatus={(next) => onStatus(order, next)}
                    onEdit={onEdit ? () => onEdit(order) : undefined}
                    onField={onField ? (f, v) => onField(order, f, v) : undefined}
                    onSendTtn={onSendTtn ? () => onSendTtn(order) : undefined}
                    onMakeTtn={onMakeTtn ? () => onMakeTtn(order) : undefined}
                    onDropTtn={onDropTtn ? () => onDropTtn(order) : undefined}
                    onCopy={onCopy ? () => onCopy(order) : undefined}
                    onPrint={onPrint ? () => onPrint(order) : undefined}
                    onDelete={onDelete ? () => onDelete(order) : undefined}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ))}

      {/* Порожні смуги — одним рядком унизу, а не сімома
          заголовками вгорі. Знати, що ці справи існують і зараз
          їх немає, корисно; читати сім порожніх підписів щоразу —
          ні. */}
      {empty.length ? (
        <p className="aq-none">
          Порожньо: {empty.map((s) => s.band.title.toLowerCase()).join(' · ')}
        </p>
      ) : null}
    </div>
  );
}

/* Головна кнопка смуги. Там, де дія — це просто наступний статус,
   робимо його одразу. Там, де потрібні руки (вписати номер,
   розібратися з поверненням), відкриваємо картку: рішення там
   не одне, і вгадувати його за менеджера не можна. */
async function runBandAction(
  o: AdminOrder,
  band: Band,
  onStatus: (o: AdminOrder, next: string) => void | Promise<void>,
  expand: () => void
) {
  if (band.id === 'confirm') return onStatus(o, 'confirmed');
  if (band.id === 'pack') return onStatus(o, 'shipped');
  if (band.id === 'close') return onStatus(o, 'done');
  expand();
}

/** Куди їде — одним рядком. */
function placeOf(o: AdminOrder): string {
  const c = (o.customer ?? {}) as Record<string, unknown>;
  return [c.city, c.branch].filter(Boolean).join(', ');
}
