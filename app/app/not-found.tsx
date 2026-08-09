import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
      <h1 className="hero__title">Такої сторінки немає</h1>
      <p className="hero__subtitle">
        Можливо, товар зняли з продажу або в адресі є помилка.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <Link className="btn btn--primary" href="/">
          До каталогу
        </Link>
      </p>
    </section>
  );
}
