import ProductCard from '@/components/ProductCard';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { inCategory, visibleProducts } from '@/lib/catalog';

/* Каталог рендериться на сервері й перечитується раз на хвилину.
   Так публікація з адмінки доходить до покупця швидко, але база
   не отримує запит на кожен перегляд сторінки. */
/* Значення має бути літералом: Next читає його статично,
   до виконання коду, тож імпортовану константу не бачить. */
export const revalidate = 60;

export default async function Home() {
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
            <h1 className="hero__title">Характер — це REYTER</h1>
            <p className="hero__subtitle">
              REYTER — чоловіча білизна українського виробництва. Комфорт,
              впевненість і власний стиль — з першого дотику тканини.
            </p>
            <div className="hero__actions">
              <a className="btn btn--primary" href="#catalog">
                Дивитися позиції
              </a>
            </div>
          </div>
        </div>
      </section>

      <nav className="cat-chips" aria-label="Категорії">
        {sections.map(({ cat }) => (
          <a key={cat.id} className="chip" href={`#cat-${cat.id}`}>
            {cat.title}
          </a>
        ))}
      </nav>

      <section className="catalog" id="catalog">
        <div className="container">
          {sections.map(({ cat, items }) => (
            <section className="category" id={`cat-${cat.id}`} key={cat.id}>
              <header className="category__head">
                <h2 className="category__title">{cat.title}</h2>
                <span className="category__count">{items.length}</span>
                <span className="category__rule" />
              </header>

              <div className="pgrid">
                {items.map((p) => {
                  const eager = eagerLeft-- > 0;
                  return <ProductCard key={p.id} c={c} p={p} eager={eager} />;
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}
