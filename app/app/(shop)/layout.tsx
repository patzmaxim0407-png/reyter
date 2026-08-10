import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import CartProvider from '@/components/CartProvider';
import LangProvider from '@/components/LangProvider';
import CartDrawer from '@/components/CartDrawer';
import ShopChrome from '@/components/ShopChrome';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { cartCatalogue } from '@/lib/catalog';

/* Оболонка магазину: усе, що бачить покупець. */

export default async function ShopLayout({
  children,
  productModal
}: {
  children: React.ReactNode;
  /* Картка товару, відкрита поверх каталогу. Порожня, доки
     покупець нікуди не натиснув. */
  productModal: React.ReactNode;
}) {
  /* Кошик має знати ціни й склад комплектів на кожній сторінці,
     тож каталог їде в браузер разом із розміткою. Обрізаний:
     описи, догляд і решта картинок кошику ні до чого, а важить
     повний утричі більше. */
  const [catalog, stock] = await Promise.all([loadCatalog(), loadStock()]);
  const c = cartCatalogue(catalog.products, stock, catalog.categories);

  return (
    <LangProvider>
      <ShopChrome />
        <CartProvider c={c}>
          <SiteHeader />
          <main id="main-content">{children}</main>
          <SiteFooter />
          {productModal}
          <CartDrawer />
        </CartProvider>
    </LangProvider>
  );
}
