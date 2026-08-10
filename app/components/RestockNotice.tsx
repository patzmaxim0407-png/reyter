'use client';

import { useEffect, useState } from 'react';
import { fetchEta, subscribeStockAlert } from '@/lib/firebase';
import { t, tx } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export default function RestockNotice({ productId, productName, size, lang }: { productId: string; productName: string; size: string | null; lang: Lang }) {
  const [eta, setEta] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'bad' | 'fail'>('idle');

  useEffect(() => {
    let active = true;
    fetchEta(productId).then((value) => {
      if (!active) return;
      setEta((size ? value?.sizes?.[size] : null) ?? value?.any ?? null);
    });
    return () => { active = false; };
  }, [productId, size]);

  const message = eta
    ? t(size ? 'eta.expectedSize' : 'eta.expected', lang).replace('{size}', tx(size, lang)).replace('{date}', eta)
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
    <p className="pinfo__eta-text">{message}</p>
    {state === 'done' ? <p className="pinfo__eta-done">{t('eta.done', lang).replace('{email}', email.trim())}</p> : <form className="pinfo__eta-form" onSubmit={submit} noValidate>
      <input type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setState('idle'); }} placeholder={t('eta.emailPh', lang)} aria-label={t('eta.emailPh', lang)} />
      <button className="btn btn--ghost btn--sm" type="submit" disabled={state === 'sending'}>{t('eta.notify', lang)}</button>
    </form>}
    {state === 'bad' || state === 'fail' ? <p className="form-error">{t(state === 'bad' ? 'eta.badEmail' : 'eta.fail', lang)}</p> : null}
  </div>;
}
