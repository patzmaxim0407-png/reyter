'use client';

import { useEffect, useState } from 'react';
import { loadNotifySettings } from '@/lib/firebase';
import { invoiceOf, isPaid, payCreate, payStatus, rememberInvoice, type PayLine } from '@/lib/pay';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

/* ============================================================
   Оплатити ще раз
   ------------------------------------------------------------
   Оплата зривається частіше, ніж здається: не пройшла картка,
   закінчився строк рахунку, людина просто передумала й повернулась
   назад. Досі це був глухий кут — кошик уже порожній, а замовлення
   висить неоплаченим, і зробити з ним нічого не можна.

   Тепер кнопка є скрізь, де покупець може про це згадати: на
   сторінці оформлення, куди він повертається кнопкою «назад», і
   в кабінеті, у списку своїх замовлень.

   Рахунок, який ще живий, відкриваємо той самий: у Monobank
   адреса сторінки оплати — це просто його номер. Виставляти
   новий, поки чинний старий, означало б залишити два живі
   посилання, а за ними можна заплатити двічі.
   ============================================================ */

export default function PayAgain({
  num,
  items,
  promo,
  shipping,
  email,
  lang,
  small
}: {
  num: string;
  /** Що саме оплачується. Цін тут немає — їх бере воркер. */
  items: PayLine[];
  promo?: string;
  shipping?: number;
  email?: string;
  lang: Lang;
  /** У списку замовлень кнопка менша й без пояснень. */
  small?: boolean;
}) {
  const [state, setState] = useState<'check' | 'pay' | 'paid' | 'busy'>('check');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const invoice = invoiceOf(num);
      if (!invoice) {
        if (alive) setState('pay');
        return;
      }
      const settings = (await loadNotifySettings()) as { workerUrl?: string } | null;
      const r = await payStatus(String(settings?.workerUrl || ''), invoice);
      if (!alive) return;
      setState(r.ok && isPaid(r.state) ? 'paid' : 'pay');
    })();
    return () => {
      alive = false;
    };
  }, [num]);

  if (state === 'paid') return null;

  const go = async () => {
    setState('busy');
    const settings = (await loadNotifySettings()) as { workerUrl?: string } | null;
    const where = String(settings?.workerUrl || '');

    /* Спершу пробуємо той самий рахунок: якщо він ще чекає на
       оплату, нового не треба — і другого живого посилання теж. */
    const invoice = invoiceOf(num);
    if (invoice) {
      const was = await payStatus(where, invoice);
      if (was.ok && (was.state === 'created' || was.state === 'processing')) {
        window.location.assign('https://pay.monobank.ua/' + invoice);
        return;
      }
    }

    const bill = await payCreate(where, { orderNum: num, items, promo, shipping, email, lang });
    if (bill.ok && bill.pageUrl) {
      rememberInvoice(num, bill.invoiceId);
      window.location.assign(bill.pageUrl);
      return;
    }
    setState('pay');
  };

  const button = (
    <button
      className={'btn btn--primary' + (small ? ' btn--sm' : '')}
      type="button"
      disabled={state === 'busy' || state === 'check'}
      onClick={() => void go()}
    >
      {state === 'busy' ? t('pay.opening', lang) : t('pay.again', lang)}
    </button>
  );

  if (small) return button;

  return (
    <div className="payagain">
      <b>{t('pay.pendingTitle', lang).replace('{n}', num)}</b>
      <span>{t('pay.pendingText', lang)}</span>
      {button}
    </div>
  );
}
