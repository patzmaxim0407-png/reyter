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

   Один раз на хвилину: якщо перечитування не допомогло, зациклити
   його було б гірше за саму поломку.
   ============================================================ */

const KEY = 'reyter:chunk-reload';
const ЗАТИШШЯ = 60_000;

const ЦЕ_ЧАНК =
  /ChunkLoadError|Loading chunk|Failed to load chunk|error loading dynamically imported module|Importing a module script failed/i;

export default function ChunkGuard() {
  useEffect(() => {
    const відновити = (текст: string) => {
      if (!ЦЕ_ЧАНК.test(текст)) return;
      let востаннє = 0;
      try {
        востаннє = Number(sessionStorage.getItem(KEY)) || 0;
      } catch {
        // приватний режим без сховища — тоді просто пробуємо раз
      }
      if (Date.now() - востаннє < ЗАТИШШЯ) return;
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* нічого не вдієш */
      }
      location.reload();
    };

    const наПомилку = (event: ErrorEvent) =>
      відновити(event.message || String((event.error as Error)?.message ?? ''));
    const наВідмову = (event: PromiseRejectionEvent) => {
      const r = event.reason as { message?: string; name?: string } | undefined;
      відновити(String(r?.name ?? '') + ' ' + String(r?.message ?? event.reason ?? ''));
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
