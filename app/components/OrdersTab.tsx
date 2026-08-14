'use client';

import { useEffect, useState } from 'react';
import { useLang } from './LangProvider';
import type { User } from 'firebase/auth';
import AuthPanel from './AuthPanel';
import OrderCard, { type OrderView } from './OrderCard';
import PayAgain from './PayAgain';
import TrackForm from './TrackForm';
import { useToast } from './Toasts';
import { copyText } from '@/lib/copy';
import { useCart } from './CartProvider';
import * as cart from '@/lib/cart';
import * as fb from '@/lib/firebase';
import { repeatOrder } from '@/lib/account';
import type { Catalogue } from '@/lib/catalog';
import type { OrderItem } from '@/lib/types';

/* ============================================================
   Історія замовлень
   ------------------------------------------------------------
   Три різні стани, і кожен показує різне:

   • увійшов — беремо з бази, зі статусом і крокоміром;
   • база не відповіла — показуємо локальну копію й кажемо про це
     прямо, а не вдаємо, що замовлень немає;
   • Firebase не відповів після входу — локальна копія браузера.

   Гостю показуємо лише вхід і форму відстеження. Локальна
   історія не доводить, кому належать замовлення на пристрої.
   ============================================================ */

export interface Row extends OrderView {
  items?: OrderItem[];
  message?: string;
  /** Чинний рахунок Monobank, як його бачить магазин. */
  payInvoiceId?: string;
}

export type OrdersMode = 'cloud' | 'local' | 'down';

export function toRow(o: Record<string, unknown>): Row {
  return {
    num: String(o.num ?? ''),
    date: String(o.date ?? ''),
    status: typeof o.status === 'string' ? o.status : 'new',
    total: Number(o.total) || 0,
    ttn: typeof o.ttn === 'string' ? o.ttn : '',
    items: Array.isArray(o.items) ? (o.items as OrderItem[]) : [],
    message: typeof o.message === 'string' ? o.message : '',
    /* Рахунок, який магазин вважає чинним. Саме його гасить нова
       спроба оплати — інакше посилання з листа лишалося б живим
       поруч із новим, і заплатити можна було б двічі. */
    payInvoiceId: typeof o.payInvoiceId === 'string' ? o.payInvoiceId : ''
  };
}

/* Один шлях копіювання на всі кнопки: підтверджуємо лише те,
   що справді сталося */
async function copy(
  text: string,
  toast: (m: string, k?: 'plain' | 'success') => void,
  t: (k: string) => string
) {
  const done = await copyText(text);
  toast(t(done ? 'cart.copied' : 'cart.copyFail'), done ? 'success' : 'plain');
}

const EmptyState = () => {
  const { t } = useLang();
  return (
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
};

export default function OrdersTab({
  c,
  user,
  online,
  rows,
  mode
}: {
  c: Catalogue;
  user: User | null | undefined;
  online: boolean;
  /* Список вантажить сторінка кабінету: шапка показує з нього
     підсумки, і другий запит до бази означав би зайві читання
     та два різні числа на одному екрані. */
  rows: Row[] | null;
  mode: OrdersMode;
}) {
  const { t, lang } = useLang();
  const toast = useToast();
  const { open } = useCart();

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

  /* Перевіряємо гостя раніше за rows: після виходу в стані ще
     мить можуть лежати хмарні замовлення, але показувати їх уже
     не можна. */
  if (user === null) {
    return (
      <>
        {online ? <AuthPanel /> : null}
        <TrackForm />
      </>
    );
  }

  if (rows === null) return <p className="account-note">{t('acc.loading')}</p>;

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
            pay={
              /* Показуємо на всіх станах: у «Новому» це кнопка
                 оплати, далі — відповідь на питання «що з моїми
                 грошима»: оплачено чи повернуто. Мовчати про це в
                 кабінеті не можна — саме заради цього туди й
                 заходять.

                 У скасованому кнопки немає: платити за скасоване
                 було б запрошенням до помилки. */
              o.items?.length ? (
                <PayAgain
                  num={o.num}
                  items={o.items.map((i) => ({ id: i.id, size: i.size ?? '', qty: Number(i.qty) || 1 }))}
                  invoiceId={o.payInvoiceId}
                  lang={lang}
                  small
                  closed={(o.status || 'new') === 'cancelled'}
                />
              ) : null
            }
            onRepeat={() => repeat(o)}
            onCopy={o.message ? () => void copy(o.message ?? '', toast, t) : undefined}
            onCopyTtn={() => void copy(o.ttn ?? '', toast, t)}
          />
        ))
      ) : (
        <EmptyState />
      )}

      {/* Порожньо в акаунті — можливо, замовляли гостем і на іншу
          пошту. Коли ж база просто не відповіла, шукати в ній
          нема сенсу: запит впаде так само. */}
      {!rows.length && mode === 'cloud' ? <TrackForm /> : null}

    </>
  );
}
