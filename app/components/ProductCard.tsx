import Link from 'next/link';
import type { Catalogue } from '@/lib/catalog';
import { availability, productColors, uah } from '@/lib/catalog';
import type { Product } from '@/lib/types';

/* Картка товару. На відміну від старого сайту це посилання, а не
   кнопка з модалкою: у товару зʼявилась власна адреса, тож його
   можна надіслати, зберегти в закладки й проіндексувати. */
export default function ProductCard({
  c,
  p,
  eager = false
}: {
  c: Catalogue;
  p: Product;
  eager?: boolean;
}) {
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
    <Link className={cls} href={`/p/${encodeURIComponent(p.id)}`} prefetch={false}>
      <span className="pcard__media">
        <img
          src={p.images[0]}
          alt={p.name}
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
            <span className="badge badge--sold">Продано</span>
          </span>
        ) : p.sale ? (
          <span className="pcard__badges">
            <span className="badge badge--sale">Sale</span>
          </span>
        ) : null}

        {!av.soldOut && av.low.length ? (
          <span className="pcard__badges pcard__badges--low">
            <span className="badge badge--low">Закінчується {av.low.join(', ')}</span>
          </span>
        ) : null}
      </span>

      <span className="pcard__body">
        <span className="pcard__title">
          {p.name}
          {colors.map((col, i) => (
            <span key={i} className="dot" style={{ backgroundColor: col.hex }} />
          ))}
        </span>

        <span className="pcard__price">
          <span className="price__now">{uah(p.price)}</span>
          {p.oldPrice ? <del className="price__old">{uah(p.oldPrice)}</del> : null}
          {p.priceUsd ? <span className="price__usd">≈ {p.priceUsd} $</span> : null}
        </span>

        {p.saleNote ? <span className="pcard__salenote">{p.saleNote}</span> : null}
      </span>
    </Link>
  );
}
