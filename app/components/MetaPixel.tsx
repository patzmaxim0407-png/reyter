'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';

/* ============================================================
   Meta Pixel
   ------------------------------------------------------------
   Лічильник Facebook та Instagram: за ним Meta бачить, скільки
   людей із реклами дійшло до сайту, і на кого показувати її далі.

   Стоїть в оболонці МАГАЗИНУ, а не в спільній — з тієї ж
   причини, що й Google Analytics: інакше робочий день менеджера
   в адмінці лічився б як відвідування крамниці.

   ДВА ВИКЛИКИ, А НЕ ОДИН. Meta дає базовий код, у якому
   PageView надсилається один раз — при завантаженні сторінки.
   Для звичайного сайту цього досить, але наш магазин сторінок не
   перезавантажує: натискання на товар лише міняє адресу, а
   розмітку домальовує браузер. Із самим базовим кодом Meta
   побачила б рівно один перегляд на весь візит, хоч би скільки
   карток людина відкрила, — і реклама навчалася б на неправді.

   Тому переходи всередині сайту дораховуємо самі, стежачи за
   адресою. Google Analytics цього не потребує: у його потоці
   ввімкнено «розширену статистику», і він слухає історію
   браузера сам.

   Локально не вантажимо взагалі: інакше кожен прогін перевірок
   у справжньому Chrome дописував би Meta візити, яких не було.
   ============================================================ */

const PIXEL = '1564358352080564';

export default function MetaPixel() {
  const path = usePathname();
  /* Перший перегляд надсилає сам базовий код. Без цього
     запобіжника вхід на сайт рахувався б двічі. */
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const fbq = (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq;
    fbq?.('track', 'PageView');
  }, [path]);

  return (
    <>
      <Script id="reyter-meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL}');
fbq('track', 'PageView');
var q=window.__reyterMetaQueue||[];
for(var i=0;i<q.length;i++)fbq.apply(null,q[i]);
window.__reyterMetaQueue=[];`}
      </Script>

      {/* Для тих, у кого вимкнено JavaScript. Meta просить саме
          картинку: інакше такий відвідувач не порахується зовсім. */}
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
