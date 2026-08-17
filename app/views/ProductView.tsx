import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import AddToCart from '@/components/AddToCart';
import ProductGallery from '@/components/ProductGallery';
import { StatusChip, StockProvider } from '@/components/StockStatus';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { NOTES, availability, freeFromOf, getProduct, productColors, uah, withFree } from '@/lib/catalog';
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
  const c = { products: catalog.products, stock, freeFrom: catalog.freeFrom };
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

export default async function ProductView({
  id,
  lang,
  modal = false
}: {
  id: string;
  lang: Lang;
  modal?: boolean;
}) {
  const { c, p, categories } = await load(id);

  // Схований товар не показуємо навіть за прямим посиланням:
  // у каталозі його немає, і вдавати звичайний товар — обман
  if (!p || p.hidden) notFound();

  const av = availability(c, p);
  /* Поріг безкоштовної доставки — той самий, за яким рахує кошик
     і виписується накладна. */
  const freeFrom = freeFromOf(c);

  /* Зразки кольорів. Самі по собі кольори нічого не перемикають —
     їх і так видно на фото; блок має сенс лише тоді, коли є куди
     перейти. Тому беремо ті, що ведуть на інший товар, і додаємо
     до них поточний — інакше повернутись до нього не вийде.

     Порядок — як у каталозі, а не «поточний перший»: інакше
     зразки мінялися б місцями після кожного перемикання. */
  const family = productColors(c, p).filter((x) => x.id && x.id !== p.id);
  const own = productColors(c, p).find((x) => !x.id || x.id === p.id);
  const swatches = (family.length
    ? [{ hex: own?.hex ?? productColors(c, p)[0]?.hex ?? '', id: p.id }, ...family]
    : []
  ).sort((a, b) => c.products.findIndex((x) => x.id === a.id) - c.products.findIndex((x) => x.id === b.id));
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
      url: `https://reyter.men${base}/p/${p.id}`
    }
  };

  return (
    <article className={modal ? 'product-modal-content' : 'container product-page'}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {!modal ? <nav className="crumbs" aria-label={t('nav.catalog', lang)}>
        <Link href={base || '/'}>{t('nav.catalog', lang)}</Link>
        {catTitle ? (
          <>
            {' / '}
            <Link href={`${base}/#cat-${p.category}`}>{catTitle}</Link>
          </>
        ) : null}
      </nav> : null}

      <div className="pmodal__scroll">
        <ProductGallery images={p.images} alt={name} lang={lang} />

        {/* Значок наявності стоїть над ціною, а розміри — під нею.
            Спільна памʼять їх звʼязує: обрали розмір, якого мало —
            значок став «Закінчується». */}
        <StockProvider soldOut={av.soldOut}>
        <div className="pmodal__info">
          <p className="pinfo__category">{catTitle}</p>
          <h1 className="pinfo__name" id="pmName">{name}</h1>

          <div className="pinfo__meta">
            <StatusChip lang={lang} />
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

          {swatches.length ? (
            <div className="pinfo__colors">
              <span className="pinfo__colors-title">{t('p.color', lang)}</span>
              <div className="swatches">
                {swatches.map((col) => {
                  const target = col.id === p.id ? p : getProduct(c, col.id);
                  const active = col.id === p.id;
                  const soldOut = target ? availability(c, target).soldOut : false;
                  const title = target ? tf(target, 'name', lang) : '';
                  const cls =
                    'swatch' + (active ? ' is-active' : '') + (soldOut ? ' is-sold' : '');
                  const style = { ['--swatch' as string]: col.hex };

                  /* Поточний колір — не посилання: вести звідси
                     нікуди, а вигляд той самий */
                  return active ? (
                    <span
                      key={col.id}
                      className={cls}
                      style={style}
                      aria-current="true"
                      title={`${title} — ${t('p.thisColor', lang)}`}
                    />
                  ) : (
                    <Link
                      key={col.id}
                      className={cls}
                      style={style}
                      scroll={false}
                      /* Колір заміщає крок, а не додає: інакше
                         «закрити» відмотувало б кольори по
                         одному замість повернення в каталог */
                      replace
                      href={`${base}/p/${encodeURIComponent(col.id)}`}
                      title={title}
                      aria-label={title}
                    />
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

          {/* Три примітки, спільні для магазину. Товар може
              прибрати зайві: «доставка БІЛИЗНИ безкоштовна» на
              свічці читається як обіцянка, якої ніхто не давав.

              Прибрані, а не дозволені: товар без цього поля
              показує всі три, як і показував. */}
          <div className="pinfo__notes">
            {NOTES.filter((n) => !p.noteOff?.includes(n.id)).map((n) => (
              <div
                key={n.id}
                className="note-card"
                dangerouslySetInnerHTML={{ __html: withFree(t(n.key, lang), freeFrom) }}
              />
            ))}
          </div>
        </div>
        </StockProvider>
      </div>
    </article>
  );
}
