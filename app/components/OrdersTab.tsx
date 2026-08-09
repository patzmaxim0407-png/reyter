'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from 'firebase/auth';
import AuthPanel from './AuthPanel';
import OrderCard, { type OrderView } from './OrderCard';
import TrackForm from './TrackForm';
import { useToast } from './Toasts';
import { copyText } from '@/lib/copy';
import { useCart } from './CartProvider';
import * as cart from '@/lib/cart';
import * as fb from '@/lib/firebase';
import { repeatOrder } from '@/lib/account';
import type { Catalogue } from '@/lib/catalog';
import { t } from '@/lib/i18n';
import type { OrderItem } from '@/lib/types';

/* ============================================================
   Історія замовлень
   ------------------------------------------------------------
   Три різні стани, і кожен показує різне:

   • увійшов — беремо з бази, зі статусом і крокоміром;
   • база не відповіла — показуємо локальну копію й кажемо про це
     прямо, а не вдаємо, що замовлень немає;
   • Firebase взагалі вимкнений — лише локальна копія браузера.

   Гостю показуємо вхід і форму відстеження: замовлення в нього
   є, просто ми не знаємо, які саме.
   ============================================================ */

interface Row extends OrderView {
  items?: OrderItem[];
  message?: string;
}

function toRow(o: Record<string, unknown>): Row {
  return {
    num: String(o.num ?? ''),
    date: String(o.date ?? ''),
    status: typeof o.status === 'string' ? o.status : 'new',
    total: Number(o.total) || 0,
    ttn: typeof o.ttn === 'string' ? o.ttn : '',
    items: Array.isArray(o.items) ? (o.items as OrderItem[]) : [],
    message: typeof o.message === 'string' ? o.message : ''
  };
}

/* Один шлях копіювання на всі кнопки: підтверджуємо лише те,
   що справді сталося */
async function copy(text: string, toast: (m: string, k?: 'plain' | 'success') => void) {
  const done = await copyText(text);
  toast(t(done ? 'cart.copied' : 'cart.copyFail'), done ? 'success' : 'plain');
}

const EmptyState = () => (
  <div className="empty-state">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3h8l3 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8l3-5Z" />
      <path d="M5 8h14" />
      <path d="M9.5 12a2.5 2.5 0 0 0 5 0" />
    </svg>
    <strong>{t('acc.noOrders')}</strong>
    {t('acc.noOrdersNote')}
  </div>
);

export default function OrdersTab({
  c,
  user,
  online
}: {
  c: Catalogue;
  user: User | null | undefined;
  online: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { open } = useCart();

  /* null — ще вантажимо; 'cloud' — дані з бази зі статусами;
     'local' — копія браузера; 'down' — база мовчить. */
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mode, setMode] = useState<'cloud' | 'local' | 'down'>('local');

  useEffect(() => {
    /* Гість бачить свою ж локальну історію — ту, що лежить у
       цьому браузері. На старому сайті ця гілка вмикалась лише
       коли CDN Firebase був заблокований; тепер SDK у бандлі й
       «не завантажитись» не може, тож без цього покупець, який
       щойно оформив замовлення гостем, побачив би форму входу
       замість власного замовлення. */
    if (!user) {
      setRows(cart.getOrders().map((o) => toRow(o as unknown as Record<string, unknown>)));
      setMode('local');
      return;
    }

    let alive = true;
    setRows(null);
    void fb.loadMyOrders(user.uid, user.email ?? '').then((cloud) => {
      if (!alive) return;
      if (cloud === null) {
        setRows(cart.getOrders().map((o) => toRow(o as unknown as Record<string, unknown>)));
        setMode('down');
        return;
      }
      setRows(cloud.map(toRow));
      setMode('cloud');
    });
    return () => {
      alive = false;
    };
  }, [user, online]);

  function repeat(o: Row) {
    const { lines, skipped } = repeatOrder(c, { items: o.items });
    if (!lines.length) {
      toast(t('acc.gone'));
      return;
    }
    /* cart.add кладе рівно одну штуку — кількість треба
       виставити окремо. В оригіналі це був цикл із qty викликів
       add; тут одна операція, і додається саме до того, що вже
       лежить у кошику, а не замість нього. */
    lines.forEach((l) =>
      cart.setQtyOf(c, l.id, l.size, l.parts, cart.qtyOf(c, l.id, l.size, l.parts) + l.qty)
    );
    /* Пропущені позиції називаємо вголос: мовчазний кошик
       на дві позиції замість чотирьох виглядає як помилка */
    if (skipped.length) toast(`${t('acc.repeat')}: ${lines.length}, ${t('acc.gone')} — ${skipped.length}`);
    open();
  }

  if (rows === null) return <p className="account-note">{t('acc.loading')}</p>;

  /* Гостю пропонуємо ще й увійти: у хмарі можуть лежати
     замовлення з інших пристроїв, яких у цьому браузері немає */
  if (online && user === null) {
    return (
      <>
        {rows.length ? (
          <>
            <p className="account-note">{t('acc.ordersLocalNote')}</p>
            {rows.map((o, i) => (
              <OrderCard key={o.num + i} o={o} onRepeat={() => repeat(o)} />
            ))}
          </>
        ) : null}
        <AuthPanel />
        <TrackForm />
      </>
    );
  }

  const note =
    mode === 'cloud' ? 'acc.ordersNote' : mode === 'down' ? 'acc.cloudDown' : 'acc.ordersLocalNote';

  return (
    <>
      {/* Примітку показуємо й на порожньому списку: «база не
          відповіла» і «замовлень немає» — різні речі, і мовчати
          про першу означає збрехати */}
      {rows.length || mode === 'down' ? <p className="account-note">{t(note)}</p> : null}

      {rows.length ? (
        rows.map((o, i) => (
          <OrderCard
            key={o.num + i}
            o={o}
            showStatus={mode === 'cloud'}
            onRepeat={() => repeat(o)}
            onCopy={o.message ? () => void copy(o.message ?? '', toast) : undefined}
            onCopyTtn={() => void copy(o.ttn ?? '', toast)}
          />
        ))
      ) : (
        <EmptyState />
      )}

      {/* Порожньо в акаунті — можливо, замовляли гостем і на іншу
          пошту. Коли ж база просто не відповіла, шукати в ній
          нема сенсу: запит впаде так само. */}
      {!rows.length && mode === 'cloud' ? <TrackForm /> : null}

      {mode === 'local' && rows.length ? (
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          style={{ width: '100%', marginTop: '.4rem' }}
          onClick={() => {
            if (!confirm(t('acc.clearConfirm'))) return;
            cart.saveOrders([]);
            setRows([]);
            router.refresh();
          }}
        >
          {t('acc.clear')}
        </button>
      ) : null}
    </>
  );
}
