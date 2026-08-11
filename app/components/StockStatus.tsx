'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

/* ============================================================
   Значок наявності
   ------------------------------------------------------------
   «В наявності», «Закінчується» чи «Продано» — залежить не від
   товару взагалі, а від РОЗМІРУ, який зараз обрано. Так було на
   попередньому сайті: обрав розмір, якого лишилось мало, — значок
   одразу став бурштиновим.

   Значок стоїть над ціною, а розміри — під нею, тож обидва в одній
   розмітці не сходяться. Звідси й ця маленька спільна памʼять:
   вибір розмірів кладе в неї стан, значок його читає.

   Початкове значення приходить із сервера: до першого дотику
   покупця значок має бути правильним уже в готовій розмітці.
   ============================================================ */

interface Stock {
  soldOut: boolean;
  /** Обраного розміру лишилось мало. */
  low: boolean;
}

const Ctx = createContext<{ stock: Stock; set(next: Stock): void } | null>(null);

export function StockProvider({
  soldOut,
  children
}: {
  soldOut: boolean;
  children: ReactNode;
}) {
  const [stock, setStock] = useState<Stock>({ soldOut, low: false });
  return <Ctx.Provider value={{ stock, set: setStock }}>{children}</Ctx.Provider>;
}

/** Для блоку вибору розмірів: повідомити, що саме зараз обрано. */
export function usePublishStock(next: Stock): void {
  const ctx = useContext(Ctx);
  const { soldOut, low } = next;
  useEffect(() => {
    ctx?.set({ soldOut, low });
  }, [ctx, soldOut, low]);
}

export function StatusChip({ lang }: { lang: Lang }) {
  const ctx = useContext(Ctx);
  const { soldOut, low } = ctx?.stock ?? { soldOut: false, low: false };
  const kind = soldOut ? 'no' : low ? 'low' : 'ok';
  const key = soldOut ? 'p.soldOut' : low ? 'p.lowStock' : 'p.inStock';

  return <span className={'status-chip status-chip--' + kind}>{t(key, lang)}</span>;
}
