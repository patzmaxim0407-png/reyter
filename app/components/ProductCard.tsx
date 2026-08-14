import Link from 'next/link';
import type { Catalogue } from '@/lib/catalog';
import { availability, productColors, uah } from '@/lib/catalog';
import { t, tf, tx } from '@/lib/i18n';
import type { Lang, Product } from '@/lib/types';

/* Картка товару. На відміну від старого сайту це посилання, а не
   кнопка з модалкою: у товару зʼявилась власна адреса, тож його
   можна надіслати, зберегти в закладки й проіндексувати. */
export default function ProductCard({
  c,
  p,
  eager = false,
  lang = 'uk'
}: {
  c: Catalogue;
  p: Product;
  eager?: boolean;
  lang?: Lang;
}) {
  /* Англійських назв у базі немає — їх складає словник tx().
     Тому мова потрібна вже на сервері: інакше картка приїхала б
     українською й перемалювалась уже в браузері. */
  const name = tf(p, 'name', lang);
  const av = availability(c, p);
  const colors = productColors(c, p);

  const cls = [
    'pcard',
    p.sale ? 'pcard--sale' : '',
    av.soldOut ? 'pcard--sold' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    /* scroll={false} — картка відкривається накладкою поверх
       каталогу, і сам каталог має лишитись там, де людина його
       гортала.

       prefetch={false} — за кожною карткою стоїть ціла сторінка
       з каталогом усередині, десь 130 КБ. Підвантажити їх усі
       наперед означало б злити кілька мегабайтів мобільного
       трафіку до першого дотику. */
    <Link
      className={cls}
      scroll={false}
      prefetch={false}
      href={(lang === 'en' ? '/en' : '') + `/p/${encodeURIComponent(p.id)}`}
    >
      <span className="pcard__media">
        <img
          src={p.images[0]}
          alt={name}
          /* Перші картки вантажимо одразу: поки їх зображення
             «ліниві», на початку каталогу видно порожні прямокутники */
          {...(eager
            ? { fetchPriority: 'high' as const, decoding: 'async' as const }
            : { loading: 'lazy' as const, decoding: 'async' as const })}
        />
        {p.images[1] ? (
          <img className="alt" src={p.images[1]} alt="" loading="lazy" decoding="async" />
        ) : null}

        {av.soldOut ? (
          <span className="pcard__badges">
            <span className="badge badge--sold">{t('p.soldOut', lang)}</span>
          </span>
        ) : p.sale ? (
          <span className="pcard__badges">
            <span className="badge badge--sale">Sale</span>
          </span>
        ) : null}

        {!av.soldOut && av.low.length ? (
          <span className="pcard__badges pcard__badges--low">
            <span className="badge badge--low">
              {t('p.lowStock', lang)} {av.low.map((x) => tx(x, lang)).join(', ')}
            </span>
          </span>
        ) : null}
      </span>

      <span className="pcard__body">
        <span className="pcard__title">
          {name}
          {colors.map((col, i) => (
            <span key={i} className="dot" style={{ backgroundColor: col.hex }} />
          ))}
        </span>

        <span className="pcard__price">
          <span className="price__now">{uah(p.price, lang)}</span>
          {p.oldPrice ? <del className="price__old">{uah(p.oldPrice, lang)}</del> : null}
          {p.priceUsd ? <span className="price__usd">≈ {p.priceUsd} $</span> : null}
        </span>

        {p.saleNote ? (
          <span className="pcard__salenote">{tf(p, 'saleNote', lang)}</span>
        ) : null}
      </span>
    </Link>
  );
}
