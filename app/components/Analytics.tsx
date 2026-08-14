import Script from 'next/script';
import MetaPixel from './MetaPixel';

/* ============================================================
   Лічильники: Google Analytics і Meta Pixel
   ------------------------------------------------------------
   Стоїть в оболонці МАГАЗИНУ, а не в спільній: раніше лічильник
   висів на всьому сайті разом з адмінкою, і робочий день
   менеджера потрапляв у статистику як відвідування крамниці.
   Десяток переглядів картки на день — це не покупці, а той, хто
   виписує накладні, і відрізнити їх у звіті вже неможливо.

   Два показники, а не один. G-HECJJF2HXF — новий потік для
   reyter.men; G-BWRC6C9CV8 лишається, бо в ньому вся попередня
   історія й на нього ж звітує старий сайт у корені домену. Один
   зайвий рядок — і жоден звіт не обривається посеред року.

   Переходи всередині сайту рахує сам GA: у потоці ввімкнено
   «розширену статистику», а вона слухає зміну адреси в історії
   браузера — саме так тут і відкривається картка товару.

   Локально не вантажимо взагалі: інакше кожен прогін перевірок
   у справжньому Chrome дописував би в статистику візити, яких
   не було. Те саме правило діє й для пікселя Meta — він поруч,
   у MetaPixel.tsx.
   ============================================================ */

const MAIN = 'G-HECJJF2HXF';
const OLD = 'G-BWRC6C9CV8';

export default function Analytics() {
  if (process.env.NODE_ENV !== 'production') return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${MAIN}`} strategy="afterInteractive" />
      <Script id="reyter-ga" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${MAIN}');gtag('config','${OLD}');`}
      </Script>
      <MetaPixel />
    </>
  );
}
