import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import AddToCart from '@/components/AddToCart';
import ProductGallery from '@/components/ProductGallery';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { availability, getProduct, productColors, uah } from '@/lib/catalog';
import { t, tf, tx } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

/* Товар той самий для обох мов — різні лише підписи й назва,
   яку складає словник tx(). Тому мова приходить аргументом,
   а маршрути /p/… і /en/p/… передають різні значення. */

export async function productParams() {
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
export async function productMetadata(id: string, lang: Lang): Promise<Metadata> {
  const { p, categories } = await load(id);
  if (!p || p.hidden) return { title: t('p.notFound', lang) };

  const name = tf(p, 'name', lang);
  const cat = tf(categories.find((x) => x.id === p.category), 'title', lang);
  const desc = [
    p.fabric ? `${t('p.fabric', lang)}: ${tx(p.fabric, lang)}.` : '',
    p.material ? `${t('p.material', lang)}: ${tx(p.material, lang)}.` : '',
    `${uah(p.price, lang)}. ${t('p.metaDelivery', lang)}`
  ]
    .filter(Boolean)
    .join(' ');

  const path = (lang === 'en' ? '/en' : '') + `/p/${p.id}`;

  return {
    title: name,
    description: desc,
    /* Обидві мови вказують одна на одну: пошуковик має знати,
       що це та сама сторінка, а не дубль */
    alternates: {
      canonical: path,
      languages: { uk: `/p/${p.id}`, en: `/en/p/${p.id}` }
    },
    openGraph: {
      title: `${name} — REYTER`,
      description: desc,
      url: path,
      type: 'website',
      images: p.images[0] ? [{ url: p.images[0], alt: name }] : undefined
    },
    twitter: {
      card: 'summary_large_image',
      title: `${name} — REYTER`,
      description: desc,
      images: p.images[0] ? [p.images[0]] : undefined
    },
    other: cat ? { 'product:category': cat } : undefined
  };
}

export default async function ProductView({ id, lang }: { id: string; lang: Lang }) {
  const { c, p, categories } = await load(id);

  // Схований товар не показуємо навіть за прямим посиланням:
  // у каталозі його немає, і вдавати звичайний товар — обман
  if (!p || p.hidden) notFound();

  const av = availability(c, p);
  const colors = productColors(c, p);
  const name = tf(p, 'name', lang);
  const catTitle = tf(categories.find((x) => x.id === p.category), 'title', lang);
  const base = lang === 'en' ? '/en' : '';

  /* Дані для пошукових систем. Наявність беремо з тих самих
     розрахунків, що й для покупця, — щоб у видачі не було
     «в наявності» на розпроданому товарі. */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: name,
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
      url: `https://reyter.men/new${base}/p/${p.id}`
    }
  };

  return (
    <article className="container product-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="crumbs" aria-label={t('nav.catalog', lang)}>
        <Link href={base || '/'}>{t('nav.catalog', lang)}</Link>
        {catTitle ? (
          <>
            {' / '}
            <Link href={`${base}/#cat-${p.category}`}>{catTitle}</Link>
          </>
        ) : null}
      </nav>

      <div className="pmodal__scroll">
        <ProductGallery images={p.images} alt={name} lang={lang} />

        <div className="pmodal__info">
          <p className="pinfo__category">{catTitle}</p>
          <h1 className="pinfo__name">{name}</h1>

          <div className="pinfo__meta">
            <span className={'status-chip status-chip--' + (av.soldOut ? 'no' : 'ok')}>
              {t(av.soldOut ? 'p.soldOut' : 'p.inStock', lang)}
            </span>
            <span className="pinfo__article">
              {t('p.article', lang)}: {p.id}
            </span>
          </div>

          <div className="pinfo__price">
            <span className="price__now">{uah(p.price, lang)}</span>
            {p.oldPrice ? <del className="price__old">{uah(p.oldPrice, lang)}</del> : null}
            {p.priceUsd ? <span className="price__usd">≈ {p.priceUsd} $</span> : null}
          </div>
          {p.saleNote ? (
            <p className="pinfo__sale-note">{tf(p, 'saleNote', lang)}</p>
          ) : null}

          {colors.length > 1 ? (
            <div className="pinfo__colors">
              <span className="pinfo__colors-title">{t('p.color', lang)}</span>
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
                    <Link key={col.id || col.hex} href={`${base}/p/${encodeURIComponent(target)}`}>
                      {swatch}
                    </Link>
                  ) : (
                    <span key={col.id || col.hex}>{swatch}</span>
                  );
                })}
              </div>
            </div>
          ) : null}

          <AddToCart c={c} p={p} lang={lang} />

          <div className="pinfo__desc">
            {p.fabric ? (
              <div>
                <b>{t('p.fabric', lang)}:</b> {tx(p.fabric, lang)}
              </div>
            ) : null}
            {p.material ? (
              <div>
                <b>{t('p.material', lang)}:</b> {tx(p.material, lang)}
              </div>
            ) : null}
            {p.aroma ? (
              <div>
                <b>{t('p.aroma', lang)}:</b> {tx(p.aroma, lang)}
              </div>
            ) : null}
            {p.model ? (
              <div>
                <b>{t('p.model', lang)}:</b> {tx(p.model, lang)}
              </div>
            ) : null}
            {(p.notes ?? []).map((n) => (
              <div key={n}>{tx(n, lang)}</div>
            ))}
          </div>

          {(p.characteristics ?? []).length || (p.care ?? []).length ? (
            <div className="pinfo__extras">
              {(p.characteristics ?? []).length ? (
                <details className="acc">
                  <summary>{t('p.features', lang)}</summary>
                  <ul>
                    {p.characteristics!.map((x) => (
                      <li key={x}>{tx(x, lang)}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {(p.care ?? []).length ? (
                <details className="acc">
                  <summary>{t('p.care', lang)}</summary>
                  <ul>
                    {p.care!.map((x) => (
                      <li key={x}>{tx(x, lang)}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}

          <div className="pinfo__notes">
            <div className="note-card" dangerouslySetInnerHTML={{ __html: t('p.note1', lang) }} />
            <div className="note-card" dangerouslySetInnerHTML={{ __html: t('p.note2', lang) }} />
            <div className="note-card" dangerouslySetInnerHTML={{ __html: t('p.note3', lang) }} />
          </div>
        </div>
      </div>
    </article>
  );
}
