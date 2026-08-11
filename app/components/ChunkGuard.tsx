'use client';

import { useEffect } from 'react';

/* ============================================================
   Відновлення після викладки
   ------------------------------------------------------------
   Файли збірки мають імена з відбитком вмісту: після кожної
   викладки вони інші, а старі зникають. Вкладка, відкрита до
   викладки, далі просить саме старі — і отримує 404.

   Далі найгірше: Next вважає перехід початим, адреса міняється,
   а сторінка не завантажується. З боку покупця це виглядає так,
   наче картка перестала відкриватись, а наступне натискання
   стирає вміст.

   Полагодити це в межах вкладки не можна — потрібних файлів уже
   немає на сервері. Тому просто перечитуємо сторінку: покупець
   бачить коротке моргання замість мертвого сайту.

   Але спершу переконуємось, що біда саме ця: беремо файл, який
   сторінка вже завантажила, і питаємо його ще раз. Якщо сервер
   каже 404 — збірка змінилась, і перечитування допоможе. Якщо
   файл на місці, то помилка була випадкова (обірвана мережа в
   метро), і смикати сторінку не можна: людина втратить своє
   місце ні за що.

   І не більше одного разу за відвідування: якщо перечитування не
   допомогло, зациклити його було б гірше за саму поломку.
   ============================================================ */

const KEY = 'reyter:chunk-reload';

const ЦЕ_ЧАНК =
  /ChunkLoadError|Loading chunk|Failed to load chunk|error loading dynamically imported module|Importing a module script failed/i;

export default function ChunkGuard() {
  useEffect(() => {
    let вжеПеревіряли = false;

    const відновити = async (текст: string) => {
      if (!ЦЕ_ЧАНК.test(текст) || вжеПеревіряли) return;
      вжеПеревіряли = true;

      try {
        if (sessionStorage.getItem(KEY)) return;
      } catch {
        // приватний режим без сховища — тоді просто пробуємо раз
      }

      /* Чи справді файли збірки зникли. Беремо будь-який, який ця
         сторінка вже завантажила: якщо його більше немає — була
         викладка. */
      const свій = performance
        .getEntriesByType('resource')
        .map((r) => r.name)
        .find((n) => n.includes('/_next/static/chunks/'));
      if (свій) {
        try {
          const res = await fetch(свій, { method: 'GET', cache: 'no-store' });
          if (res.ok) return;
        } catch {
          // мережі немає — перечитування теж не допоможе
          return;
        }
      }

      try {
        sessionStorage.setItem(KEY, '1');
      } catch {
        /* нічого не вдієш */
      }
      location.reload();
    };

    const наПомилку = (event: ErrorEvent) =>
      void відновити(event.message || String((event.error as Error)?.message ?? ''));
    const наВідмову = (event: PromiseRejectionEvent) => {
      const r = event.reason as { message?: string; name?: string } | undefined;
      void відновити(String(r?.name ?? '') + ' ' + String(r?.message ?? event.reason ?? ''));
    };

    window.addEventListener('error', наПомилку);
    window.addEventListener('unhandledrejection', наВідмову);
    return () => {
      window.removeEventListener('error', наПомилку);
      window.removeEventListener('unhandledrejection', наВідмову);
    };
  }, []);

  return null;
}
