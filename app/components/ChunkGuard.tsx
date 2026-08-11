'use client';

import { useEffect } from 'react';

/* ============================================================
   Відновлення після викладки
   ------------------------------------------------------------
   Файли збірки мають імена з відбитком вмісту: після кожної
   викладки вони інші, а старі зникають. Сторінка, яку браузер
   зберіг до викладки, далі просить саме старі — і отримує 404.

   Наслідків два, і другий страшніший за перший.

   Перший: не завантажився шматок коду. Тоді Next вважає перехід
   початим, адреса міняється, а сторінка не приходить; з боку
   покупця це виглядає так, наче картка перестала відкриватись.

   Другий: не завантажився файл стилів. Усі правила сайту живуть
   в одному файлі, запасного шару немає, тож сторінка малюється
   голим HTML — Times із засічками, сині підкреслені посилання,
   картинки в натуральний зріст. Саме це й побачив власник.

   Полагодити це в межах вкладки не можна — потрібних файлів уже
   немає на сервері. Тому перечитуємо сторінку: коротке моргання
   замість мертвого сайту.

   Але спершу переконуємось, що біда саме ця: питаємо сервер про
   файл, якого браузер не дістав. Якщо мережі немає зовсім —
   перечитування не поможе, і смикати сторінку не можна: людина
   втратить своє місце ні за що.
   ============================================================ */

const КЛЮЧ = 'reyter:chunk-reload';
/** Скільки разів дозволено перечитувати за один сеанс. */
const СПРОБ = 2;
/** І не частіше, ніж раз на хвилину. */
const ПАУЗА = 60_000;

const ЦЕ_ЧАНК =
  /ChunkLoadError|Loading chunk|Failed to load chunk|error loading dynamically imported module|Importing a module script failed/i;

const свій = (url: string) => url.includes('/_next/static/');

type Спроби = { n: number; t: number };

function спроби(): Спроби {
  try {
    const raw = sessionStorage.getItem(КЛЮЧ);
    if (!raw) return { n: 0, t: 0 };
    // до цього тут лежала одиниця — стару мітку читаємо як одну спробу
    if (raw === '1') return { n: 1, t: 0 };
    const v = JSON.parse(raw) as Спроби;
    return { n: Number(v.n) || 0, t: Number(v.t) || 0 };
  } catch {
    return { n: 0, t: 0 };
  }
}

/* Перечитуємо не просто reload: документ лежить у приватному кеші
   браузера з дозволом на протермінованість, тож reload має право
   віддати рівно ту саму стару сторінку, від якої ми тікаємо.

   Перша спроба — оновити запис у кеші й перечитати ту саму адресу:
   тоді посилання лишається чистим. Друга — з міткою часу в запиті:
   такої адреси в кеші немає напевно. Третьої не буде: якщо не
   допомогло двічі, зациклити перечитування гірше за саму поломку. */
async function перечитати() {
  const було = спроби();
  if (було.n >= СПРОБ) return;
  if (було.t && Date.now() - було.t < ПАУЗА) return;

  const тепер = Date.now();
  try {
    sessionStorage.setItem(КЛЮЧ, JSON.stringify({ n: було.n + 1, t: тепер }));
  } catch {
    /* приватний режим без сховища — тоді просто пробуємо */
  }

  if (було.n === 0) {
    // оновлюємо копію документа в кеші браузера й перечитуємо адресу
    try {
      await fetch(location.href, { cache: 'reload', credentials: 'same-origin' });
    } catch {
      /* не вийшло — усе одно спробуємо перечитати */
    }
    location.replace(location.href);
    return;
  }

  const url = new URL(location.href);
  url.searchParams.set('r', String(тепер));
  location.replace(url.toString());
}

export default function ChunkGuard() {
  useEffect(() => {
    let зайнято = false;

    /* ---------- шматок коду не приїхав ---------- */
    const післяЧанка = async (текст: string) => {
      if (!ЦЕ_ЧАНК.test(текст) || зайнято) return;
      зайнято = true;

      /* Чи справді файли збірки зникли. Беремо будь-який СКРИПТ,
         який ця сторінка вже завантажила: якщо його більше немає —
         була викладка. Саме скрипт, а не будь-який файл із chunks:
         першим там завжди йде файл стилів, і питати треба не його. */
      const відомий = performance
        .getEntriesByType('resource')
        .map((r) => r.name)
        .find((n) => свій(n) && n.endsWith('.js'));
      if (відомий) {
        try {
          const res = await fetch(відомий, { cache: 'no-store' });
          if (res.ok) {
            // файл на місці — то була випадковість (обірвана мережа
            // в метро), і перечитувати сторінку не можна
            зайнято = false;
            return;
          }
        } catch {
          зайнято = false;
          return;
        }
      }
      await перечитати();
    };

    /* ---------- стилі не приїхали ---------- */
    const голаСторінка = async () => {
      if (зайнято) return;
      const link = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
      ).find((l) => свій(l.href));
      if (!link) return;

      /* Рахуємо ПРАВИЛА, а не аркуші: коли файл не приїхав, Chrome
         усе одно лишає порожній styleSheet, і styleSheets.length
         показує ту саму двійку, що й на справній сторінці. */
      const аркуш = Array.from(document.styleSheets).find((s) => s.href === link.href);
      let правил = 0;
      try {
        правил = аркуш?.cssRules.length ?? 0;
      } catch {
        return; // чужий домен — не наша справа
      }
      if (правил > 0) return;

      зайнято = true;
      try {
        // мережі немає — перечитування не поможе
        await fetch(link.href, { cache: 'no-store' });
      } catch {
        зайнято = false;
        return;
      }
      await перечитати();
    };

    /* Помилки завантаження файлів не спливають до window, тож
       слухаємо їх на перехопленні. І пізнаємо не за текстом —
       у такої помилки він порожній, — а за самим елементом. */
    const наПомилку = (event: Event) => {
      const ціль = event.target as HTMLElement | null;
      if (ціль instanceof HTMLLinkElement && свій(ціль.href)) return void голаСторінка();
      if (ціль instanceof HTMLScriptElement && свій(ціль.src)) return void післяЧанка('Loading chunk failed');
      const e = event as ErrorEvent;
      if (typeof e.message === 'string' && e.message) void післяЧанка(e.message);
    };
    const наВідмову = (event: PromiseRejectionEvent) => {
      const r = event.reason as { message?: string; name?: string } | undefined;
      void післяЧанка(String(r?.name ?? '') + ' ' + String(r?.message ?? event.reason ?? ''));
    };

    window.addEventListener('error', наПомилку, true);
    window.addEventListener('unhandledrejection', наВідмову);

    /* Перевіряємо й самі: помилку завантаження можна проґавити
       (вона трапляється до того, як цей код почав слухати), а от
       порожній аркуш стилів видно завжди. */
    const перевірка = setTimeout(() => void голаСторінка(), 800);

    /* Сторінка ожила — прибираємо з адреси мітку, якою ми обходили
       кеш при перечитуванні. Покупцеві її бачити ні до чого. */
    const прибрати = setTimeout(() => {
      if (!new URL(location.href).searchParams.has('r')) return;
      const url = new URL(location.href);
      url.searchParams.delete('r');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }, 1200);

    return () => {
      clearTimeout(перевірка);
      clearTimeout(прибрати);
      window.removeEventListener('error', наПомилку, true);
      window.removeEventListener('unhandledrejection', наВідмову);
    };
  }, []);

  return null;
}
