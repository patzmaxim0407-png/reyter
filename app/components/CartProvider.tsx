'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react';
import * as cart from '@/lib/cart';
import { getProduct, type Catalogue } from '@/lib/catalog';
import type { CartLine, CartPart, Product } from '@/lib/types';

/* ============================================================
   Кошик у React
   ------------------------------------------------------------
   Стан живе не тут, а в lib/cart.ts — у localStorage. Компонент
   лише підписується на нього через useSyncExternalStore: так
   кошик лишається доступним із будь-якого коду (зокрема не-React),
   а React бачить кожну зміну.

   Каталог приходить із сервера й далі не змінюється, тож він
   осідає тут один раз, і компоненти більше його не передають.
   ============================================================ */

export interface CartLineView extends CartLine {
  p: Product;
  idx: number;
  sum: number;
}

interface CartApi {
  c: Catalogue;
  lines: CartLineView[];
  count: number;
  subtotal: number;
  ready: boolean;

  add(id: string, size?: string | null, parts?: CartPart[] | null): void;
  qtyOf(id: string, size?: string | null, parts?: CartPart[] | null): number;
  setQtyOf(id: string, size: string | null | undefined, parts: CartPart[] | null | undefined, qty: number): void;
  setQty(idx: number, qty: number): void;
  remove(idx: number): void;
  clear(): void;

  isOpen: boolean;
  open(): void;
  close(): void;
}

const Ctx = createContext<CartApi | null>(null);

export function useCart(): CartApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart поза CartProvider');
  return ctx;
}

/* Сервер віддає порожній кошик, бо localStorage там немає.
   Той самий масив, а не новий щоразу, — інакше React вважав би,
   що стан змінюється на кожному рендері. */
const EMPTY: CartLine[] = [];

export default function CartProvider({ c, children }: { c: Catalogue; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);

  const raw = useSyncExternalStore(cart.subscribe, cart.snapshot, () => EMPTY);

  /* Перший рендер у браузері мусить збігтися з серверним, інакше
     React лається на розбіжність розмітки. Тому до гідратації
     кошик показується порожнім — і одразу після неї наповнюється. */
  const ready = raw !== EMPTY;

  const lines = useMemo<CartLineView[]>(() => {
    if (!ready) return [];
    // items() звіряє сховище з каталогом: викидає зниклі товари
    // й комплекти зі старим складом
    return cart.items(c).map((i, idx) => {
      const p = getProduct(c, i.id) as Product;
      return { ...i, p, idx, sum: p.price * i.qty };
    });
  }, [c, raw, ready]);

  const count = useMemo(() => lines.reduce((s, i) => s + i.qty, 0), [lines]);
  const subtotal = useMemo(() => lines.reduce((s, i) => s + i.sum, 0), [lines]);

  const api = useMemo<CartApi>(
    () => ({
      c,
      lines,
      count,
      subtotal,
      ready,
      add: (id, size, parts) => cart.add(c, id, size, parts),
      qtyOf: (id, size, parts) => (ready ? cart.qtyOf(c, id, size, parts) : 0),
      setQtyOf: (id, size, parts, qty) => {
        cart.setQtyOf(c, id, size, parts, qty);
      },
      setQty: (idx, qty) => cart.setQty(c, idx, qty),
      remove: (idx) => cart.remove(c, idx),
      clear: () => cart.clear(),
      isOpen,
      open: () => setOpen(true),
      close: () => setOpen(false)
    }),
    [c, lines, count, subtotal, ready, isOpen]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
