'use client';

import { useEffect, useState } from 'react';
import { loadNotifySettings } from '@/lib/firebase';
import { invoiceOf, payStatus, type PayState } from '@/lib/pay';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

/* ============================================================
   Чим скінчилась оплата
   ------------------------------------------------------------
   Покупець повертається з банку сюди, і перше, що він хоче
   знати, — пройшли гроші чи ні. Банк на цей момент може ще
   думати, тому питаємо кілька разів поспіль, а не один.

   Стан не зберігається в нас ніде: питаємо банк, показуємо
   відповідь. Підробити тут нічого — та й нема чого: сторінка
   лише розповідає, а рішення про відправку ухвалює менеджер,
   дивлячись на той самий стан у себе.
   ============================================================ */

/* Скільки разів перепитати, поки банк «обробляє». Сім спроб по
   дві секунди — це чотирнадцять секунд очікування; довше людину
   тримати на місці нечесно. */
const TRIES = 7;
const PAUSE = 2000;

export default function PayResult({ num, lang }: { num?: string; lang: Lang }) {
  const [state, setState] = useState<PayState | 'wait' | 'none'>('wait');
  const [why, setWhy] = useState('');
  const [sum, setSum] = useState(0);

  useEffect(() => {
    const invoice = num ? invoiceOf(num) : '';
    if (!invoice) {
      setState('none');
      return;
    }

    let alive = true;
    let tries = 0;

    const check = async () => {
      const settings = (await loadNotifySettings()) as { workerUrl?: string } | null;
      const r = await payStatus(String(settings?.workerUrl || ''), invoice);
      if (!alive) return;

      if (r.ok) {
        setSum(r.amount);
        setWhy(r.why);
        setState(r.state);
        // банк ще думає — перепитаємо
        const pending = r.state === 'created' || r.state === 'processing';
        if (pending && ++tries < TRIES) setTimeout(check, PAUSE);
        return;
      }
      if (++tries < TRIES) setTimeout(check, PAUSE);
      else setState('none');
    };

    void check();
    return () => {
      alive = false;
    };
  }, [num]);

  if (state === 'none') return null;

  if (state === 'wait' || state === 'created' || state === 'processing') {
    return (
      <p className="paybox paybox--wait">
        <span className="paybox__dot" aria-hidden="true" />
        {t('pay.waiting', lang)}
      </p>
    );
  }

  if (state === 'success') {
    return (
      <p className="paybox paybox--ok">
        ✓ {t('pay.done', lang)}
        {sum ? <b> · {sum} {lang === 'en' ? 'UAH' : 'грн'}</b> : null}
      </p>
    );
  }

  if (state === 'reversed') {
    return <p className="paybox paybox--warn">{t('pay.back', lang)}</p>;
  }

  /* failure, expired і все інше — гроші не пройшли. Кажемо прямо
     й одразу пояснюємо, що робити далі: посилання на оплату
     надішле менеджер, замовлення нікуди не зникло. */
  return (
    <p className="paybox paybox--fail">
      <b>{t('pay.failed', lang)}</b>
      {why ? <span className="paybox__why">{why}</span> : null}
      <span>{t('pay.failedNext', lang)}</span>
    </p>
  );
}
