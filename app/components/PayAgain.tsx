'use client';

import { useEffect, useState } from 'react';
import { loadNotifySettings } from '@/lib/firebase';
import { invoiceOf, isPaid, orderPaid, payCreate, payStatus, rememberInvoice, type PayLine } from '@/lib/pay';
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
  small,
  closed
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
  /** Скасоване замовлення: стан оплати показуємо, а платити за
   *  нього не пропонуємо — це було б запрошенням до помилки. */
  closed?: boolean;
}) {
  const [state, setState] = useState<'check' | 'pay' | 'paid' | 'back' | 'busy'>('check');

  /* Стан оплати міняється не в цій вкладці: покупець платить у
     банку в сусідньому вікні, менеджер повертає кошти зі своєї
     адмінки. Тому перепитуємо самі — щохвилини, поки вкладка на
     очах, і одразу щойно людина до неї повернулась. Доти напис
     стояв той, який застали при відкритті сторінки. */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const again = () => {
      if (!document.hidden) setTick((n) => n + 1);
    };
    const t = setInterval(again, 60_000);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
    };
  }, []);

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

      /* Питаємо про замовлення, а не про рахунок: платити могли за
         посиланням, якого цей браузер ніколи не бачив. */
      const byOrder = await orderPaid(url, num);
      if (!alive) return;
      if (byOrder.ok && byOrder.paid) {
        setState('paid');
        return;
      }
      if (byOrder.ok && byOrder.refunded) {
        setState('back');
        return;
      }

      let returned = false;
      for (const one of list) {
        const r = await payStatus(url, one);
        if (!alive) return;
        if (r.ok && isPaid(r.state)) {
          setState('paid');
          return;
        }
        // повернення памʼятаємо, але шукаємо далі: за замовлення
        // могли платити двічі, і друга оплата може бути живою
        if (r.ok && r.state === 'reversed') returned = true;
      }
      setState(returned ? 'back' : 'pay');
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [num, invoiceId, tick]);

  /* Оплачено або повернуто — платити більше нема за що, але
     мовчати теж не можна: покупець приходить у кабінет саме щоб
     побачити, що з його грошима. */
  if (state === 'paid') {
    return <span className="paytag paytag--ok">✓ {t('pay.done', lang)}</span>;
  }
  if (state === 'back') {
    return <span className="paytag paytag--back">{t('pay.back', lang)}</span>;
  }

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

  // скасоване: гроші показали вище, кнопки тут бути не може
  if (closed) return null;

  if (small) return button;

  return (
    <div className="payagain">
      <b>{t('pay.pendingTitle', lang).replace('{n}', num)}</b>
      <span>{t('pay.pendingText', lang)}</span>
      {button}
    </div>
  );
}
