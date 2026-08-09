'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LANGS, storeLang, t as translate, tf as tField, tx as tText } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

/* ============================================================
   Мова
   ------------------------------------------------------------
   Мова — частина адреси, а не стан у памʼяті: /  — українська,
   /en — англійська. Так сторінка англійською має власне
   посилання, індексується окремо й приходить із сервера вже
   перекладеною — без миготіння й без розбіжності розмітки.

   Вибір усе одно памʼятаємо: наступного разу покупця зустріне
   та мова, якою він читав минулого.
   ============================================================ */

interface LangApi {
  lang: Lang;
  t(key: string): string;
  /** Поле каталогу з можливим ручним перекладом: name → nameEn. */
  tf<K extends string>(obj: Partial<Record<K | `${K}En`, string>> | null | undefined, field: K): string;
  /** Текст без ключа — назви товарів і розміри перекладає словник. */
  tx(text: string | null | undefined): string;
  /** Та сама сторінка іншою мовою. */
  hrefFor(next: Lang): string;
}

const Ctx = createContext<LangApi | null>(null);

export function useLang(): LangApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useLang поза LangProvider');
  return api;
}

/** Мова з адреси. Єдине джерело — інакше клієнт і сервер
 *  розійшлися б у першому ж кадрі. */
export function langFromPath(path: string): Lang {
  return path === '/en' || path.startsWith('/en/') ? 'en' : 'uk';
}

/** Той самий шлях іншою мовою. */
export function swapLang(path: string, next: Lang): string {
  const bare = path === '/en' ? '/' : path.startsWith('/en/') ? path.slice(3) : path;
  if (next === 'uk') return bare;
  return bare === '/' ? '/en' : '/en' + bare;
}

export default function LangProvider({ children }: { children: ReactNode }) {
  const path = usePathname() || '/';
  const lang = langFromPath(path);

  /* Запамʼятовуємо вибір, а не нав'язуємо його: адреса головніша.
     Інакше покупець, якому надіслали англійське посилання, побачив
     би українську — бо колись перемкнув мову в себе. */
  useEffect(() => {
    storeLang(lang);
  }, [lang]);

  const api = useMemo<LangApi>(
    () => ({
      lang,
      t: (key) => translate(key, lang),
      tf: (obj, field) => tField(obj, field, lang),
      tx: (text) => tText(text, lang),
      hrefFor: (next) => swapLang(path, next)
    }),
    [lang, path]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Перемикач у шапці. Розмітка й класи ті самі, що в index.html. */
export function LangSwitch() {
  const { lang, hrefFor } = useLang();
  const label: Record<Lang, string> = { uk: 'UA', en: 'EN' };

  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {LANGS.map((x) => (
        <Link
          key={x}
          className={'lang-btn' + (lang === x ? ' is-active' : '')}
          href={hrefFor(x)}
          hrefLang={x}
          // мова змінює всю сторінку — зайвий плавний перехід тут лише заважає
          scroll={false}
        >
          {label[x]}
        </Link>
      ))}
    </div>
  );
}
