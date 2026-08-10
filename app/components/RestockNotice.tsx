'use client';

import { useEffect, useState } from 'react';
import { fetchEta, subscribeStockAlert } from '@/lib/firebase';
import { etaDateText } from '@/lib/dates';
import { t, tx } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export default function RestockNotice({
  productId,
  productName,
  size,
  lang,
  etaOf
}: {
  productId: string;
  productName: string;
  size: string | null;
  lang: Lang;
  /* Чию дату показуємо, якщо це не сам товар. У комплекту своїх
     приходів немає — дата є в складника, якого бракує, і назвати
     його треба вголос: «Майка menthol: очікується 15 серпня». */
  etaOf?: { id: string; name: string } | null;
}) {
  const [eta, setEta] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'bad' | 'fail'>('idle');

  const etaId = etaOf?.id ?? productId;

  useEffect(() => {
    let active = true;
    fetchEta(etaId).then((value) => {
      if (!active) return;
      setEta((size ? value?.sizes?.[size] : null) ?? value?.any ?? null);
    });
    return () => { active = false; };
  }, [etaId, size]);

  /* Дата йде з бази як '2026-08-15' — покупцеві її показуємо
     словами, як це робив старий etaDateText. */
  const prefix = etaOf && etaOf.id !== productId ? etaOf.name + ': ' : '';
  const message = eta
    ? t(size ? 'eta.expectedSize' : 'eta.expected', lang)
        .replace('{size}', tx(size, lang))
        .replace('{date}', etaDateText(eta, lang))
    : t(size ? 'eta.noDate' : 'eta.noDateAll', lang);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return setState('bad');
    setState('sending');
    const ok = await subscribeStockAlert({ productId, productName, size, email: clean, lang });
    setState(ok ? 'done' : 'fail');
  }

  return <div className="pinfo__eta" role="status">
    <p className="pinfo__eta-text">{prefix + message}</p>
    {state === 'done' ? <p className="pinfo__eta-done">{t('eta.done', lang).replace('{email}', email.trim())}</p> : <form className="pinfo__eta-form" onSubmit={submit} noValidate>
      <input type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setState('idle'); }} placeholder={t('eta.emailPh', lang)} aria-label={t('eta.emailPh', lang)} />
      <button className="btn btn--ghost btn--sm" type="submit" disabled={state === 'sending'}>{t('eta.notify', lang)}</button>
    </form>}
    {state === 'bad' || state === 'fail' ? <p className="form-error">{t(state === 'bad' ? 'eta.badEmail' : 'eta.fail', lang)}</p> : null}
  </div>;
}
