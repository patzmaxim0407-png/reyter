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

const KEY = 'reyter:chunk-reload';
/** Скільки разів дозволено перечитувати за один сеанс. */
const MAX_TRIES = 2;
/** І не частіше, ніж раз на хвилину. */
const PAUSE = 60_000;

const CHUNK_RE =
  /ChunkLoadError|Loading chunk|Failed to load chunk|error loading dynamically imported module|Importing a module script failed/i;

const isOurs = (url: string) => url.includes('/_next/static/');

type Tries = { n: number; t: number };

function tries(): Tries {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { n: 0, t: 0 };
    // до цього тут лежала одиниця — стару мітку читаємо як одну спробу
    if (raw === '1') return { n: 1, t: 0 };
    const v = JSON.parse(raw) as Tries;
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
async function reloadPage() {
  const prev = tries();
  if (prev.n >= MAX_TRIES) return;
  if (prev.t && Date.now() - prev.t < PAUSE) return;

  const now = Date.now();
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ n: prev.n + 1, t: now }));
  } catch {
    /* приватний режим без сховища — тоді просто пробуємо */
  }

  if (prev.n === 0) {
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
  url.searchParams.set('r', String(now));
  location.replace(url.toString());
}

export default function ChunkGuard() {
  useEffect(() => {
    let busy = false;

    /* ---------- шматок коду не приїхав ---------- */
    const onChunkError = async (text: string) => {
      if (!CHUNK_RE.test(text) || busy) return;
      busy = true;

      /* Чи справді файли збірки зникли. Беремо будь-який СКРИПТ,
         який ця сторінка вже завантажила: якщо його більше немає —
         була викладка. Саме скрипт, а не будь-який файл із chunks:
         першим там завжди йде файл стилів, і питати треба не його. */
      const known = performance
        .getEntriesByType('resource')
        .map((r) => r.name)
        .find((n) => isOurs(n) && n.endsWith('.js'));
      if (known) {
        try {
          const res = await fetch(known, { cache: 'no-store' });
          if (res.ok) {
            // файл на місці — то була випадковість (обірвана мережа
            // в метро), і перечитувати сторінку не можна
            busy = false;
            return;
          }
        } catch {
          busy = false;
          return;
        }
      }
      await reloadPage();
    };

    /* ---------- стилі не приїхали ---------- */
    const checkStyles = async () => {
      if (busy) return;
      const link = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
      ).find((l) => isOurs(l.href));
      if (!link) return;

      /* Рахуємо ПРАВИЛА, а не аркуші: коли файл не приїхав, Chrome
         усе одно лишає порожній styleSheet, і styleSheets.length
         показує ту саму двійку, що й на справній сторінці. */
      const sheet = Array.from(document.styleSheets).find((s) => s.href === link.href);
      let rules = 0;
      try {
        rules = sheet?.cssRules.length ?? 0;
      } catch {
        return; // чужий домен — не наша справа
      }
      if (rules > 0) return;

      /* Порожній аркуш ще не означає біду: на повільній мережі
         браузер міг просто не встигнути його розібрати. Тому
         питаємо сервер — і перечитуємо сторінку ЛИШЕ тоді, коли
         файла справді немає.

         Доти тут стояло просто «спитали й перечитали», і сторінка
         оновлювалась сама на кожному повільному завантаженні: у
         покупця це виглядало як перезавантаження при відкритті
         картки товару й при її закритті. */
      busy = true;
      try {
        const res = await fetch(link.href, { cache: 'no-store' });
        if (res.ok) {
          // файл на місці — стилі ось-ось застосуються самі
          busy = false;
          return;
        }
      } catch {
        // мережі немає — перечитування не поможе
        busy = false;
        return;
      }
      await reloadPage();
    };

    /* Помилки завантаження файлів не спливають до window, тож
       слухаємо їх на перехопленні. І пізнаємо не за текстом —
       у такої помилки він порожній, — а за самим елементом. */
    const onError = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLLinkElement && isOurs(target.href)) return void checkStyles();
      if (target instanceof HTMLScriptElement && isOurs(target.src)) return void onChunkError('Loading chunk failed');
      const e = event as ErrorEvent;
      if (typeof e.message === 'string' && e.message) void onChunkError(e.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const r = event.reason as { message?: string; name?: string } | undefined;
      void onChunkError(String(r?.name ?? '') + ' ' + String(r?.message ?? event.reason ?? ''));
    };

    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection);

    /* Перевіряємо й самі: помилку завантаження можна проґавити
       (вона трапляється до того, як цей код почав слухати), а от
       порожній аркуш стилів видно завжди.

       Але чекаємо, доки сторінка ДОВАНТАЖИТЬСЯ, і ще півтори
       секунди понад те. Раніше тут стояли голі 800 мс від
       монтування — на повільній мережі стилі просто не встигали,
       і сторож перечитував цілком здорову сторінку. */
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      timer = setTimeout(() => void checkStyles(), 1500);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    /* Сторінка ожила — прибираємо з адреси мітку, якою ми обходили
       кеш при перечитуванні. Покупцеві її бачити ні до чого. */
    const cleanup = setTimeout(() => {
      if (!new URL(location.href).searchParams.has('r')) return;
      const url = new URL(location.href);
      url.searchParams.delete('r');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }, 1200);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('load', start);
      clearTimeout(cleanup);
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
