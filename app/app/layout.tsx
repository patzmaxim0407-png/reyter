import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter, Unbounded } from 'next/font/google';
import '../styles/base.css';
import '../styles/layout.css';
import '../styles/components.css';
import '../styles/modal.css';
import '../styles/app.css';
import Toasts from '@/components/Toasts';

const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter', display: 'swap' });
const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], weight: ['500', '600', '700'], variable: '--font-unbounded', display: 'swap' });

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
  keywords: ['чоловіча білизна', 'український бренд', 'чоловічі труси', 'чоловічі боксери', 'REYTER', 'mens underwear Ukraine'],
  authors: [{ name: 'REYTER' }],
  applicationName: 'REYTER',
  icons: { icon: '/favicon.ico', apple: '/assets/images/logo_4.webp' },
  openGraph: {
    type: 'website',
    siteName: 'REYTER',
    locale: 'uk_UA',
    title: 'REYTER — Чоловіча білизна від українського бренду',
    description: 'Стильна та комфортна чоловіча білизна REYTER. Доставка по Україні та за кордон.',
    url: '/',
    images: [{ url: '/assets/images/Jule2026/Head.webp', alt: 'REYTER' }]
  },
  twitter: { card: 'summary_large_image', title: 'REYTER — Чоловіча білизна', description: 'Стиль, комфорт і характер.', images: ['/assets/images/Jule2026/Head.webp'] },
  other: { 'geo.region': 'UA', 'geo.placename': 'Ukraine', 'mobile-web-app-capable': 'yes', 'apple-mobile-web-app-title': 'REYTER' },
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
    <html lang="uk" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.lang=location.pathname.startsWith('/new/en')?'en':'uk'" }} />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" />
      </head>
      <body className={`${inter.variable} ${unbounded.variable}`}>
        <Toasts>{children}</Toasts>
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-BWRC6C9CV8" strategy="afterInteractive" />
        <Script id="reyter-ga" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-BWRC6C9CV8');`}</Script>
      </body>
    </html>
  );
}
