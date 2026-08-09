'use client';

import Link from 'next/link';
import CartButton from './CartButton';
import AccountButton from './AccountButton';
import { LangSwitch, useLang } from './LangProvider';

/* Шапка рендериться на сервері. У браузер їдуть лише дві кнопки
   праворуч — кошик і кабінет: обидві показують стан, якого сервер
   не знає. Навігація лишається звичайними посиланнями й працює
   без JavaScript. */
export default function SiteHeader() {
  const { t, lang } = useLang();
  // усі посилання лишаються в межах поточної мови
  const base = lang === 'en' ? '/en' : '';

  return (
    <header className="site-header" id="siteHeader">
      <div className="site-header__inner">
        <Link className="brand" href={base || '/'} aria-label={t('nav.top')}>
          <img
            src="https://reyter.men/assets/images/Logo1.png"
            alt="REYTER"
            width={1431}
            height={369}
          />
        </Link>

        <nav className="site-nav" aria-label="REYTER">
          <Link href={`${base}/#about`}>{t('nav.about')}</Link>
          <Link href={`${base}/#catalog`}>{t('nav.catalog')}</Link>
          <Link href={`${base}/#size-guide`}>{t('nav.size')}</Link>
          <Link href={`${base}/#delivery`}>{t('nav.delivery')}</Link>
          <Link href={`${base}/#contacts`}>{t('nav.contacts')}</Link>
        </nav>

        <LangSwitch />
        <AccountButton />
        <CartButton />
      </div>
    </header>
  );
}
