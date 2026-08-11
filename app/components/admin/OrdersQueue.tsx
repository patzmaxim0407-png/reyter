'use client';

import { useState } from 'react';
import OrderCard from './OrderCard';
import OrderRow from './OrderRow';
import {
  BANDS,
  queue,
  statusInfo,
  type AdminOrder,
  type Band,
  type ParcelHint,
  type Task
} from '@/lib/admin/orders';
import type { Catalogue } from '@/lib/catalog';
import { підпис, тривога, type Посилка } from '@/lib/admin/np';

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
  parcels: Map<string, Посилка>;
  onStatus(o: AdminOrder, next: string): void;
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
  const смуги = queue(orders, parcels as unknown as Map<string, ParcelHint>);
  const справ = смуги
    .filter((s) => s.band.id !== 'transit')
    .reduce((n, s) => n + s.rows.length, 0);

  if (!справ && !смуги.find((s) => s.band.id === 'transit')?.rows.length) {
    return (
      <div className="aq-empty">
        <b>✓</b>
        <span>Усе зроблено</span>
        <em>Нових замовлень немає, посилки в дорозі — теж.</em>
      </div>
    );
  }

  return (
    <div className="aq">
      {смуги.map(({ band, rows }) => (
        <section key={band.id} className={'aq-band' + (rows.length ? '' : ' is-empty')}>
          <h3 className="aq-band__head">
            <span className="aq-band__icon" aria-hidden="true">
              {band.icon}
            </span>
            {band.title}
            <i>{rows.length}</i>
          </h3>

          {rows.map(({ order, task }) => (
            <div key={order._id} className={'aq-item u-' + task.urgency + (open === order._id ? ' is-open' : '')}>
              <OrderRow
                num={order.num || ''}
                name={String((order.customer as Record<string, unknown>)?.name ?? '')}
                place={куди(order)}
                badge={{
                  id: order.status || 'new',
                  title: statusInfo(order.status || 'new').title
                }}
                parcel={(() => {
                  if (order.pickup) return { text: 'Самовиніс', tone: 0 as const };
                  const п = parcels.get(String(order.ttn || '').trim());
                  return п ? { text: підпис(п), tone: тривога(п) } : undefined;
                })()}
                meta={task.why}
                sum={order.total || 0}
                tone={task.urgency}
                open={open === order._id}
                onToggle={() => setOpen(open === order._id ? '' : order._id)}
                action={
                  band.action
                    ? { label: band.action, onClick: () => дія(order, band, onStatus, () => setOpen(order._id)) }
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
    </div>
  );
}

/* Головна кнопка смуги. Там, де дія — це просто наступний статус,
   робимо його одразу. Там, де потрібні руки (вписати номер,
   розібратися з поверненням), відкриваємо картку: рішення там
   не одне, і вгадувати його за менеджера не можна. */
function дія(
  o: AdminOrder,
  band: Band,
  onStatus: (o: AdminOrder, next: string) => void,
  розкрити: () => void
) {
  if (band.id === 'confirm') return onStatus(o, 'confirmed');
  if (band.id === 'pack') return onStatus(o, 'shipped');
  if (band.id === 'close') return onStatus(o, 'done');
  розкрити();
}

/** Куди їде — одним рядком. */
function куди(o: AdminOrder): string {
  const c = (o.customer ?? {}) as Record<string, unknown>;
  return [c.city, c.branch].filter(Boolean).join(', ');
}
