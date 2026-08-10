'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import CartButton from './CartButton';
import AccountButton from './AccountButton';
import { LangSwitch, useLang } from './LangProvider';

/* Шапка рендериться на сервері. У браузер їдуть лише дві кнопки
   праворуч — кошик і кабінет: обидві показують стан, якого сервер
   не знає. Навігація лишається звичайними посиланнями й працює
   без JavaScript. */
export default function SiteHeader() {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  // усі посилання лишаються в межах поточної мови
  const base = lang === 'en' ? '/en' : '';

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 8);
        frame = 0;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <header
      ref={headerRef}
      className={'site-header' + (scrolled ? ' is-scrolled' : '')}
      id="siteHeader"
    >
      <div className="site-header__inner">
        <Link className="brand" href={base || '/'} aria-label={t('nav.top')}>
          <img
            src="/new/assets/images/Logo1.png"
            alt="REYTER"
            width={1431}
            height={369}
          />
        </Link>

        <p className="drop-pill" dangerouslySetInnerHTML={{ __html: t('nav.drop') }} />

        <nav
          className={'site-nav' + (open ? ' is-open' : '')}
          id="siteNav"
          aria-label="REYTER"
          onClick={() => setOpen(false)}
        >
          <Link href={`${base}/#about`}>{t('nav.about')}</Link>
          <Link href={`${base}/#catalog`}>{t('nav.catalog')}</Link>
          <Link href={`${base}/#size-guide`}>{t('nav.size')}</Link>
          <Link href={`${base}/#delivery`}>{t('nav.delivery')}</Link>
          <Link href={`${base}/#contacts`}>{t('nav.contacts')}</Link>
          <div className="site-nav__socials">
            <a href="https://www.tiktok.com/@reyter.ua5" target="_blank" rel="noopener" aria-label="TikTok"><i className="fab fa-tiktok" /></a>
            <a href="https://www.instagram.com/reyter.ua/" target="_blank" rel="noopener" aria-label="Instagram"><i className="fab fa-instagram" /></a>
            <a href="https://www.threads.com/@reyter.ua" target="_blank" rel="noopener" aria-label="Threads"><i className="fab fa-threads" /></a>
            <a href="https://twitter.com/reyter_ua" target="_blank" rel="noopener" aria-label="X"><i className="fab fa-x-twitter" /></a>
            <a href="https://wa.me/message/PB4QREH6QHZOB1" target="_blank" rel="noopener" aria-label="WhatsApp"><i className="fab fa-whatsapp" /></a>
            <a href="https://viber.me/380501794378" target="_blank" rel="noopener" aria-label="Viber"><i className="fab fa-viber" /></a>
            <a href="https://t.me/reyter_store" target="_blank" rel="noopener" aria-label="Telegram"><i className="fab fa-telegram" /></a>
          </div>
        </nav>

        <div className="header-actions">
          <LangSwitch />
          <AccountButton />
          <CartButton />
          <button
            className={'burger' + (open ? ' is-open' : '')}
            id="burgerBtn"
            type="button"
            aria-label={t('nav.menu')}
            aria-expanded={open}
            aria-controls="siteNav"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <span /><span /><span />
          </button>
        </div>
      </div>
    </header>
  );
}
