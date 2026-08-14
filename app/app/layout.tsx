import type { Metadata, Viewport } from 'next';
import { Inter, Unbounded } from 'next/font/google';
import '../styles/base.css';
import '../styles/layout.css';
import '../styles/components.css';
import '../styles/modal.css';
import '../styles/app.css';
import Toasts from '@/components/Toasts';

const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter', display: 'swap' });
const unbounded = Unbounded({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '600', '700'],
  variable: '--font-unbounded',
  display: 'swap'
});

/* Спільна оболонка на все: <html>, стилі й черга повідомлень.
   Шапку, підвал і кошик додає оболонка магазину — адмінці вони
   ні до чого, і тягнути туди каталог покупця означало б віддавати
   зайві дані. */

export const metadata: Metadata = {
  metadataBase: new URL('https://reyter.men'),
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
  /* Значок вкладки й іконку для домашнього екрана Next бере з
     самих файлів: app/favicon.ico і app/apple-icon.png. Руками їх
     тут не оголошуємо — виходило по два <link rel="icon"> на ту
     саму адресу, і браузер мусив обирати між ними сам.

     Обидва — біла «R» із логотипа на фірмовому синьому. Вкладка
     показує значок завширшки шістнадцять пікселів: увесь напис
     «REYTER» у ньому перетворюється на пляму, а літера читається. */
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
    /* Змінні шрифтів мусять бути на <html>, а не на <body>:
       --font-body оголошено в :root, і підстановка var(--font-inter)
       рахується саме там. З <body> вона порожня, шрифт злітає
       на Times, і весь макет виглядає чужим. */
    <html lang="uk" className={`${inter.variable} ${unbounded.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.lang=location.pathname.startsWith('/en')?'en':'uk'" }} />
        {/* Запасний шар на випадок, коли єдиний файл стилів не
            доїхав: після викладки браузер може тримати сторінку
            попередньої збірки, а вона просить файл, якого вже
            немає. Без цих кількох рядків виходить голий HTML —
            Times із засічками й картинки в натуральний зріст.

            @layer навмисно: правила в шарі поступаються будь-яким
            звичайним, тож коли справжні стилі на місці, цей блок
            не важить нічого. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              '@layer reyter-fallback{body{margin:0;background:#FCF8F0;color:#171B26;font-family:var(--font-inter),-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6}img,svg,video{display:block;max-width:100%;height:auto}a{color:inherit;text-decoration:none}button{font:inherit}}'
          }}
        />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" />
      </head>
      <body>
        {/* Лічильник переїхав в оболонку магазину: адмінці він
            ні до чого, а її відвідування псували статистику. */}
        <Toasts>{children}</Toasts>
      </body>
    </html>
  );
}
