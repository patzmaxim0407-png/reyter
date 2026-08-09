import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import CartProvider from '@/components/CartProvider';
import LangProvider from '@/components/LangProvider';
import CartDrawer from '@/components/CartDrawer';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { cartCatalogue } from '@/lib/catalog';

/* Оболонка магазину: усе, що бачить покупець. */

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  /* Кошик має знати ціни й склад комплектів на кожній сторінці,
     тож каталог їде в браузер разом із розміткою. Обрізаний:
     описи, догляд і решта картинок кошику ні до чого, а важить
     повний утричі більше. */
  const [catalog, stock] = await Promise.all([loadCatalog(), loadStock()]);
  const c = cartCatalogue(catalog.products, stock, catalog.categories);

  return (
    <>
      <a className="skip-link" href="#catalog">
        Перейти до каталогу
      </a>

      {/* Рухомий рядок над шапкою */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee__track">
          <span>Безкоштовна доставка по Україні від 1500 грн ✦ Міжнародна доставка ✦</span>
          <span>Безкоштовна доставка по Україні від 1500 грн ✦ Міжнародна доставка ✦</span>
        </div>
      </div>

      <LangProvider>
        <CartProvider c={c}>
          <SiteHeader />
          <main id="top">{children}</main>
          <SiteFooter />
          <CartDrawer />
        </CartProvider>
      </LangProvider>
    </>
  );
}
