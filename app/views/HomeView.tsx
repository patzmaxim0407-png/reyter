import ProductCard from '@/components/ProductCard';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { inCategory, visibleProducts } from '@/lib/catalog';
import { t, tf } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

/* Каталог однаковий для обох мов — різні лише підписи. Тому
   сторінка приймає мову аргументом, а маршрути /  і /en просто
   передають різні значення. */

export default async function HomeView({ lang }: { lang: Lang }) {
  const [catalog, stock] = await Promise.all([loadCatalog(), loadStock()]);
  const c = { products: catalog.products, stock };
  const shown = visibleProducts(c);

  /* Порожні категорії не показуємо: стрічка чипів має вести
     туди, де справді щось є */
  const sections = catalog.categories
    .map((cat) => ({ cat, items: shown.filter((p) => inCategory(p, cat.id)) }))
    .filter((s) => s.items.length);

  let eagerLeft = 8;

  return (
    <>
      <section className="hero" id="about">
        <div className="container hero__grid">
          <div className="hero__content">
            {/* Заголовок і підзаголовок містять розмітку —
                у словнику вони лежать разом із нею */}
            <h1
              className="hero__title"
              dangerouslySetInnerHTML={{ __html: t('hero.title', lang) }}
            />
            <p
              className="hero__subtitle"
              dangerouslySetInnerHTML={{ __html: t('hero.subtitle', lang) }}
            />
            <div className="hero__actions">
              <a className="btn btn--primary" href="#catalog">
                {t('hero.cta1', lang)}
              </a>
            </div>
          </div>
        </div>
      </section>

      <nav className="cat-chips" aria-label={t('nav.catalog', lang)}>
        {sections.map(({ cat }) => (
          <a key={cat.id} className="chip" href={`#cat-${cat.id}`}>
            {tf(cat, 'title', lang)}
          </a>
        ))}
      </nav>

      <section className="catalog" id="catalog">
        <div className="container">
          {sections.map(({ cat, items }) => (
            <section className="category" id={`cat-${cat.id}`} key={cat.id}>
              <header className="category__head">
                <h2 className="category__title">{tf(cat, 'title', lang)}</h2>
                <span className="category__count">{items.length}</span>
                <span className="category__rule" />
              </header>

              <div className="pgrid">
                {items.map((p) => {
                  const eager = eagerLeft-- > 0;
                  return <ProductCard key={p.id} c={c} p={p} eager={eager} lang={lang} />;
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}
