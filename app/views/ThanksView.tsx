import Link from 'next/link';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export default function ThanksView({ num, mail, lang }: { num?: string; mail?: string; lang: Lang }) {
  const base = lang === 'en' ? '/en' : '';
  return <div className="container"><div className="order-done">
    <div className="order-done__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m4.5 12.5 5 5 10-11" /></svg></div>
    <h1>{t('cart.order', lang)}{num ? ` №${num} ` : ' '}{t('cart.doneTitle', lang)}</h1>
    <p>{t('cart.doneText', lang)}</p>
    {mail ? <p>{t('cart.doneMail', lang)} <b>{mail}</b> 📩</p> : null}
    <p className="order-done__track">{t('cart.trackNote', lang)}{' '}<Link href={`${base}/track${num ? `?num=${encodeURIComponent(num)}` : ''}`}>{t('trk.find', lang)}</Link></p>
    <Link className="btn btn--primary" href={`${base}/account?tab=orders`}>{t('cart.myOrders', lang)}</Link>
    <Link className="btn btn--ghost" href={`${base}/#catalog`}>{t('cart.keepShopping', lang)}</Link>
  </div></div>;
}
