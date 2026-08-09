export default function SiteFooter() {
  return (
    <footer className="site-footer" id="contacts">
      <div className="container">
        <p className="site-footer__slogan">Характер — це REYTER!</p>
        <p className="site-footer__links">
          <a href="https://www.instagram.com/reyter.ua/" target="_blank" rel="noopener">
            Instagram
          </a>
          {' · '}
          <a href="https://t.me/reyter_store" target="_blank" rel="noopener">
            Telegram
          </a>
          {' · '}
          <a href="https://wa.me/message/PB4QREH6QHZOB1" target="_blank" rel="noopener">
            WhatsApp
          </a>
        </p>
      </div>
    </footer>
  );
}
