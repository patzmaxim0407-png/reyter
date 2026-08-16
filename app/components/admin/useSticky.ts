'use client';

import { useEffect, useRef } from 'react';

/* ============================================================
   Висота липкого пояса — у змінну CSS
   ------------------------------------------------------------
   Поясів на сторінці буває два: вкладки й добори під ними.
   Другий мусить стати рівно під першим, а для цього треба знати
   висоту першого.

   МІРЯЄМО, а не вписуємо числом. На вузькому екрані вкладки
   переносяться на другий рядок, у складі їх чотири, у клієнтів
   три — вгадане число обернулось би або щілиною, або смугою, що
   заїжджає під сусідню. ResizeObserver ловить і те, і те, і
   зміну шрифта в браузері теж.
   ============================================================ */

export function useStickyHeight<T extends HTMLElement>(cssVar: string) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const seen = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        cssVar,
        Math.round(box.getBoundingClientRect().height) + 'px'
      );
    });
    seen.observe(box);
    return () => seen.disconnect();
  }, [cssVar]);

  return ref;
}
