import type { Metadata, Viewport } from 'next';
import '../styles/base.css';
import '../styles/layout.css';
import '../styles/components.css';
import '../styles/modal.css';
import '../styles/app.css';
import Toasts from '@/components/Toasts';

/* Спільна оболонка на все: <html>, стилі й черга повідомлень.
   Шапку, підвал і кошик додає оболонка магазину — адмінці вони
   ні до чого, і тягнути туди каталог покупця означало б віддавати
   зайві дані. */

export const metadata: Metadata = {
  metadataBase: new URL('https://reyter.men/new'),
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <Toasts>{children}</Toasts>
      </body>
    </html>
  );
}
