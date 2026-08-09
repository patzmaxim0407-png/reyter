import Link from 'next/link';

/* Шапка. Поки що без кошика й кабінету — вони приїдуть разом
   із клієнтським станом на наступному етапі; тут лише навігація,
   яка має працювати і без JavaScript. */
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
      </div>
    </header>
  );
}
