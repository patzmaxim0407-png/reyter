'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLang } from './LangProvider';
import { noteNavigation } from '@/lib/nav-depth';

/** Спільні мовні елементи оболонки. Мова лишається частиною URL,
 *  а атрибут html синхронізуємо так само, як це робив старий i18n.js. */
export default function ShopChrome() {
  const { lang, t } = useLang();
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  /* Оболонка переживає переходи між сторінками магазину, тож
     саме звідси видно, скільки їх уже було. */
  useEffect(() => {
    noteNavigation();
  }, [pathname]);

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
