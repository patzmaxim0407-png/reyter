import Link from 'next/link';
import CartButton from './CartButton';

/* Шапка рендериться на сервері — інтерактивна в ній лише кнопка
   кошика, і саме вона одна їде в браузер. Навігація лишається
   звичайними посиланнями й працює без JavaScript. */
export default function SiteHeader() {
  return (
    <header className="site-header" id="siteHeader">
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label="На головну">
          <img
            src="https://reyter.men/assets/images/Logo1.png"
            alt="REYTER"
            width={1431}
            height={369}
          />
        </Link>

        <nav className="site-nav" aria-label="REYTER">
          <Link href="/#about">Про нас</Link>
          <Link href="/#catalog">Позиції</Link>
          <Link href="/#size-guide">Розмірна сітка</Link>
          <Link href="/#delivery">Доставка</Link>
          <Link href="/#contacts">Соц мережі</Link>
        </nav>

        <CartButton />
      </div>
    </header>
  );
}
