import type { Metadata, Viewport } from 'next';
import '../styles/base.css';
import '../styles/layout.css';
import '../styles/components.css';
import '../styles/modal.css';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import CartProvider from '@/components/CartProvider';
import Toasts from '@/components/Toasts';
import CartDrawer from '@/components/CartDrawer';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { cartCatalogue } from '@/lib/catalog';

/* Метадані сторінки-оболонки. Конкретний товар доповнює їх
   своїми — див. generateMetadata у app/p/[id]/page.tsx. */
export const metadata: Metadata = {
  metadataBase: new URL('https://reyter.men'),
  title: {
    default: 'REYTER — Чоловіча білизна українського бренду',
    template: '%s — REYTER'
  },
  description:
    'Купити чоловічу білизну онлайн від українського бренду REYTER. ' +
    'Стильна та комфортна білизна. Доставка по Україні та за кордон.',
  openGraph: {
    type: 'website',
    siteName: 'REYTER',
    locale: 'uk_UA'
  },
  robots: { index: true, follow: true }
};

export const viewport: Viewport = {
  themeColor: '#014AAD',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /* Кошик має знати ціни й склад комплектів на кожній сторінці,
     тож каталог їде в браузер разом із розміткою. Обрізаний:
     описи, догляд і решта картинок кошику ні до чого, а важить
     повний утричі більше. */
  const [catalog, stock] = await Promise.all([loadCatalog(), loadStock()]);
  const c = cartCatalogue(catalog.products, stock, catalog.categories);

  return (
    <html lang="uk">
      <body>
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

        <Toasts>
          <CartProvider c={c}>
            <SiteHeader />
            <main id="top">{children}</main>
            <SiteFooter />
            <CartDrawer />
          </CartProvider>
        </Toasts>
      </body>
    </html>
  );
}
