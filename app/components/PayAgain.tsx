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
  invoiceId,
  lang,
  small
}: {
  num: string;
  /** Що саме оплачується. Цін тут немає — їх бере воркер. */
  items: PayLine[];
  promo?: string;
  shipping?: number;
  email?: string;
  /** Рахунок, який магазин вважає чинним (з бази). Може
   *  відрізнятися від того, що памʼятає браузер: менеджер міг
   *  виставити новий і надіслати листом. */
  invoiceId?: string;
  lang: Lang;
  /** У списку замовлень кнопка менша й без пояснень. */
  small?: boolean;
}) {
  const [state, setState] = useState<'check' | 'pay' | 'paid' | 'busy'>('check');

  useEffect(() => {
    let alive = true;
    void (async () => {
      /* Дивимось обидва: той, що памʼятає браузер, і той, що
         магазин вважає чинним. Оплачений хоч один — платити
         більше нема за що. */
      const list = [...new Set([invoiceId || '', invoiceOf(num)].filter(Boolean))];
      if (!list.length) {
        if (alive) setState('pay');
        return;
      }
      const settings = (await loadNotifySettings()) as { workerUrl?: string } | null;
      const url = String(settings?.workerUrl || '');
      for (const one of list) {
        const r = await payStatus(url, one);
        if (!alive) return;
        if (r.ok && isPaid(r.state)) {
          setState('paid');
          return;
        }
      }
      setState('pay');
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

    /* Спершу пробуємо чинний рахунок: якщо він ще чекає на
       оплату, нового не треба — і другого живого посилання теж.
       Порядок важливий: спершу той, що магазин надіслав листом. */
    const list = [...new Set([invoiceId || '', invoiceOf(num)].filter(Boolean))];
    for (const one of list) {
      const was = await payStatus(where, one);
      if (was.ok && (was.state === 'created' || was.state === 'processing')) {
        window.location.assign('https://pay.monobank.ua/' + one);
        return;
      }
    }

    /* Виставляємо новий — і разом із ним гасимо всі, які знаємо:
       посилання з листа інакше лишилося б робочим, і за замовлення
       можна було б заплатити двічі. */
    const bill = await payCreate(where, {
      orderNum: num, items, promo, shipping, email, lang, previous: list
    });
    if (bill.ok && bill.pageUrl) {
      rememberInvoice(num, bill.invoiceId);
      window.location.assign(bill.pageUrl);
      return;
    }

    /* Банк відмовив, бо замовлення вже оплачене. Це не помилка —
       це саме те, заради чого перевірка й стоїть. Прибираємо
       кнопку, щоб людина не тиснула її вдруге. */
    if (bill.paidAlready) {
      setState('paid');
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
