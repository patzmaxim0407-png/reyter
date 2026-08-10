'use client';

import Link from 'next/link';
import { useLang } from './LangProvider';

export default function SiteFooter() {
  const { t, lang } = useLang();
  const base = lang === 'en' ? '/en' : '';

  return (
    <footer className="site-footer">
      <div className="container">
        <p className="site-footer__slogan">{t('footer.slogan')}</p>
        <div className="site-footer__grid">
          <div className="site-footer__col">
            <img className="site-footer__logo" src="/new/assets/images/Logo1.png" alt="REYTER" loading="lazy" />
            <p>{t('footer.about')}</p>
            {/* Марка бренду, а не переклад: «Based in Ukraine»
                лишається англійською в обох мовах */}
            <p className="site-footer__based">Based in Ukraine</p>
            <address className="site-footer__addr">{t('footer.address')}</address>
          </div>
          <nav className="site-footer__col" aria-label="REYTER">
            <Link href={`${base}/#about`}>{t('nav.about')}</Link>
            <Link href={`${base}/#catalog`}>{t('nav.catalog')}</Link>
            <Link href={`${base}/#size-guide`}>{t('nav.size')}</Link>
            <Link href={`${base}/#delivery`}>{t('nav.delivery')}</Link>
          </nav>
          <div className="site-footer__col">
            <a href="/new/public-offer.pdf" target="_blank" rel="noopener">{t('footer.offer')}</a>
            <a href="/new/political.pdf" target="_blank" rel="noopener">{t('footer.policy')}</a>
          </div>
          <div className="site-footer__col site-footer__socials">
            <a href="https://www.tiktok.com/@reyter.ua5" target="_blank" rel="noopener" aria-label="TikTok"><i className="fab fa-tiktok" /></a>
            <a href="https://www.instagram.com/reyter.ua/" target="_blank" rel="noopener" aria-label="Instagram"><i className="fab fa-instagram" /></a>
            <a href="https://www.threads.com/@reyter.ua" target="_blank" rel="noopener" aria-label="Threads"><i className="fab fa-threads" /></a>
            <a href="https://twitter.com/reyter_ua" target="_blank" rel="noopener" aria-label="X"><i className="fab fa-x-twitter" /></a>
            <a href="https://wa.me/message/PB4QREH6QHZOB1" target="_blank" rel="noopener" aria-label="WhatsApp"><i className="fab fa-whatsapp" /></a>
            <a href="https://viber.me/380501794378" target="_blank" rel="noopener" aria-label="Viber"><i className="fab fa-viber" /></a>
            <a href="https://t.me/reyter_store" target="_blank" rel="noopener" aria-label="Telegram"><i className="fab fa-telegram" /></a>
          </div>
        </div>
        <div className="site-footer__bottom">
          <p>{t('footer.copy')}</p>
          <p>{t('footer.fop')}</p>
        </div>
      </div>
    </footer>
  );
}
