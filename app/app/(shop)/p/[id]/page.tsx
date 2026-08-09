import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import AddToCart from '@/components/AddToCart';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { availability, getProduct, productColors, uah } from '@/lib/catalog';

/* Значення має бути літералом: Next читає його статично,
   до виконання коду, тож імпортовану константу не бачить. */
export const revalidate = 60;

/* Сторінки всіх товарів будуються наперед — покупець отримує
   готовий HTML одразу, без очікування бази. Нові товари, яких на
   момент збірки ще не було, зрендеряться на першому запиті. */
export async function generateStaticParams() {
  const { products } = await loadCatalog();
  return products.filter((p) => !p.hidden).map((p) => ({ id: p.id }));
}

async function load(id: string) {
  const [catalog, stock] = await Promise.all([loadCatalog(), loadStock()]);
  const c = { products: catalog.products, stock };
  const p = getProduct(c, decodeURIComponent(id));
  return { c, p, categories: catalog.categories };
}

/* Заради цього все й затівалось: у товару зʼявляються власні
   заголовок, опис і картинка для соцмереж. Раніше все відкривалося
   модалкою на одній адресі, тож поділитися товаром було нічим. */
export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { p, categories } = await load(id);
  if (!p || p.hidden) return { title: 'Товар не знайдено' };

  const cat = categories.find((x) => x.id === p.category)?.title ?? '';
  const desc = [
    p.fabric ? `Тканина: ${p.fabric}.` : '',
    p.material ? `Склад: ${p.material}.` : '',
    `${uah(p.price)}. Доставка по Україні та за кордон.`
  ]
    .filter(Boolean)
    .join(' ');

  return {
    title: p.name,
    description: desc,
    alternates: { canonical: `/p/${p.id}` },
    openGraph: {
      title: `${p.name} — REYTER`,
      description: desc,
      url: `/p/${p.id}`,
      type: 'website',
      images: p.images[0] ? [{ url: p.images[0], alt: p.name }] : undefined
    },
    twitter: {
      card: 'summary_large_image',
      title: `${p.name} — REYTER`,
      description: desc,
      images: p.images[0] ? [p.images[0]] : undefined
    },
    other: cat ? { 'product:category': cat } : undefined
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { c, p, categories } = await load(id);

  // Схований товар не показуємо навіть за прямим посиланням:
  // у каталозі його немає, і вдавати звичайний товар — обман
  if (!p || p.hidden) notFound();

  const av = availability(c, p);
  const colors = productColors(c, p);
  const catTitle = categories.find((x) => x.id === p.category)?.title ?? '';

  /* Дані для пошукових систем. Наявність беремо з тих самих
     розрахунків, що й для покупця, — щоб у видачі не було
     «в наявності» на розпроданому товарі. */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: p.images,
    sku: p.id,
    category: catTitle,
    brand: { '@type': 'Brand', name: 'REYTER' },
    offers: {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: 'UAH',
      availability: av.soldOut
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
      url: `https://reyter.men/p/${p.id}`
    }
  };

  return (
    <article className="container product-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="crumbs" aria-label="Навігація">
        <Link href="/">Каталог</Link>
        {catTitle ? (
          <>
            {' / '}
            <Link href={`/#cat-${p.category}`}>{catTitle}</Link>
          </>
        ) : null}
      </nav>

      <div className="pmodal__scroll">
        <div className="pmodal__gallery">
          <div className="gal__main">
            <img src={p.images[0]} alt={p.name} />
          </div>
          {p.images.length > 1 ? (
            <div className="gal__thumbs">
              {p.images.map((src, i) => (
                <span className={'gthumb' + (i === 0 ? ' is-active' : '')} key={src}>
                  <img src={src} alt="" loading="lazy" />
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="pmodal__info">
          <p className="pinfo__category">{catTitle}</p>
          <h1 className="pinfo__name">{p.name}</h1>

          <div className="pinfo__meta">
            <span className={'status-chip status-chip--' + (av.soldOut ? 'no' : 'ok')}>
              {av.soldOut ? 'Продано' : 'В наявності'}
            </span>
            <span className="pinfo__article">Артикул: {p.id}</span>
          </div>

          <div className="pinfo__price">
            <span className="price__now">{uah(p.price)}</span>
            {p.oldPrice ? <del className="price__old">{uah(p.oldPrice)}</del> : null}
            {p.priceUsd ? <span className="price__usd">≈ {p.priceUsd} $</span> : null}
          </div>
          {p.saleNote ? <p className="pinfo__sale-note">{p.saleNote}</p> : null}

          {colors.length > 1 ? (
            <div className="pinfo__colors">
              <span className="pinfo__colors-title">Колір</span>
              <div className="swatches">
                {colors.map((col) => {
                  const target = col.id && col.id !== p.id ? col.id : null;
                  const swatch = (
                    <span
                      className={'swatch' + (col.id === p.id ? ' is-active' : '')}
                      style={{ ['--swatch' as string]: col.hex }}
                    />
                  );
                  return target ? (
                    <Link key={col.id || col.hex} href={`/p/${encodeURIComponent(target)}`}>
                      {swatch}
                    </Link>
                  ) : (
                    <span key={col.id || col.hex}>{swatch}</span>
                  );
                })}
              </div>
            </div>
          ) : null}

          <AddToCart c={c} p={p} />

          <div className="pinfo__desc">
            {p.fabric ? (
              <div>
                <b>Тканина:</b> {p.fabric}
              </div>
            ) : null}
            {p.material ? (
              <div>
                <b>Склад:</b> {p.material}
              </div>
            ) : null}
            {p.aroma ? (
              <div>
                <b>Аромат:</b> {p.aroma}
              </div>
            ) : null}
            {p.model ? (
              <div>
                <b>Параметри моделі:</b> {p.model}
              </div>
            ) : null}
            {(p.notes ?? []).map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>

          {(p.characteristics ?? []).length || (p.care ?? []).length ? (
            <div className="pinfo__extras">
              {(p.characteristics ?? []).length ? (
                <details className="acc">
                  <summary>Особливості</summary>
                  <ul>
                    {p.characteristics!.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {(p.care ?? []).length ? (
                <details className="acc">
                  <summary>Рекомендації щодо догляду</summary>
                  <ul>
                    {p.care!.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
