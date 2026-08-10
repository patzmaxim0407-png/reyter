'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLang } from './LangProvider';
import { noteNavigation } from '@/lib/nav-depth';
import { lockScrollAhead } from '@/lib/scroll-lock';

/** Спільні мовні елементи оболонки. Мова лишається частиною URL,
 *  а атрибут html синхронізуємо так само, як це робив старий i18n.js. */
export default function ShopChrome() {
  const { lang, t } = useLang();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  /* Оболонка переживає переходи між сторінками магазину, тож
     саме звідси видно, скільки їх уже було. */
  useEffect(() => {
    noteNavigation();
  }, [pathname]);

  /* Картку підвантажуємо ще до кліку — щойно покупець торкнувся
     її пальцем або навів мишу. Між дотиком і кліком минає майже
     десята секунди, а між наведенням і кліком — набагато більше:
     цього досить, щоб картка відкрилась миттєво.

     Саме за наміром, а не наперед: у каталозі три десятки товарів,
     і тягнути їх усі одразу означало б кілька мегабайтів
     мобільного трафіку заради одного дотику. Кожну адресу
     гріємо один раз. */
  useEffect(() => {
    const warmed = new Set<string>();
    const warm = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const card = target?.closest?.('a.pcard') as HTMLAnchorElement | null;
      const href = card?.getAttribute('href');
      if (!href || warmed.has(href)) return;
      warmed.add(href);
      // router.prefetch чекає шлях без префікса — його додає Next
      router.prefetch(href.replace(/^\/new/, '') || '/');
    };

    document.addEventListener('pointerover', warm, { passive: true });
    document.addEventListener('touchstart', warm, { passive: true });
    return () => {
      document.removeEventListener('pointerover', warm);
      document.removeEventListener('touchstart', warm);
    };
  }, [router]);

  /* Картка товару відкривається накладкою поверх каталогу, тож
     фон замикаємо вже на натисканні — поки йде запит, сторінка
     має стояти там, де людина її лишила. Слухаємо в оболонці:
     карток у каталозі десятки, і вішати на кожну власний
     обробник ні до чого.

     Саме на спливанні, а не на перехопленні: Next записує в
     історію позицію сторінки, коли обробляє натискання, і якщо
     замкнути її раніше — запише нуль, а «назад» потім поверне
     каталог на початок. */
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.('a.pcard')) return;
      lockScrollAhead();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return (
    <>
      <a className="skip-link" href="#main-content">
        {t('nav.skip')}
      </a>
      <div className="marquee" aria-hidden="true">
        <div className="marquee__track">
          <span dangerouslySetInnerHTML={{ __html: t('marquee') }} />
          <span dangerouslySetInnerHTML={{ __html: t('marquee') }} />
        </div>
      </div>
    </>
  );
}
