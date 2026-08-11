'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
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

  /* Новий стан кладемо лише тоді, коли він справді інший. Разом із
     useMemo нижче це рятує від зациклення: без них кожен рендер
     давав би новий обʼєкт, той запускав би ефект, ефект — новий
     рендер, і так без кінця. */
  const set = useCallback((next: Stock) => {
    setStock((prev) =>
      prev.soldOut === next.soldOut && prev.low === next.low ? prev : next
    );
  }, []);

  const value = useMemo(() => ({ stock, set }), [stock, set]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Для блоку вибору розмірів: повідомити, що саме зараз обрано. */
export function usePublishStock(next: Stock): void {
  const set = useContext(Ctx)?.set;
  const { soldOut, low } = next;
  // залежності — самі значення, а не обʼєкт: інакше ефект
  // спрацьовував би на кожен рендер
  useEffect(() => {
    set?.({ soldOut, low });
  }, [set, soldOut, low]);
}

export function StatusChip({ lang }: { lang: Lang }) {
  const ctx = useContext(Ctx);
  const { soldOut, low } = ctx?.stock ?? { soldOut: false, low: false };
  const kind = soldOut ? 'no' : low ? 'low' : 'ok';
  const key = soldOut ? 'p.soldOut' : low ? 'p.lowStock' : 'p.inStock';

  return <span className={'status-chip status-chip--' + kind}>{t(key, lang)}</span>;
}
