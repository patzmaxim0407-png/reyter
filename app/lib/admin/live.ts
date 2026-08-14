/* ============================================================
   REYTER — живі дані адмінки
   ------------------------------------------------------------
   Замовлення, залишки й промокоди приходять підпискою: магазин
   ведуть удвох, і нове замовлення має зʼявитись на екрані саме
   тоді, коли воно прийшло, а не коли хтось оновить сторінку.

   Прихід і рух читаються разово: вони змінюються рідко, і
   тримати на них постійне зʼєднання ні до чого.

   Помилку сюди не глушимо, а віддаємо викликачу: «немає прав» і
   «немає інтернету» — різні проблеми, і показати їх треба різно.
   ============================================================ */

import {
  collection,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query
} from 'firebase/firestore';
import { db } from '../firebase';

export const ORDERS_COL = 'orders';
export const INVENTORY_COL = 'inventory';
export const RESTOCKS_COL = 'restocks';
export const MOVES_COL = 'stock_moves';
export const PROMOS_COL = 'promos';

/** Скільки останніх замовлень тримаємо. Більше в адмінці не
 *  переглядають руками — для старих є пошук і вивантаження. */
export const ORDERS_LIMIT = 500;
/** Журнал руху: 400 записів це приблизно квартал роботи. */
export const MOVES_LIMIT = 400;
export const RESTOCKS_LIMIT = 100;

export type Doc = Record<string, unknown> & { _id: string };

export interface LiveError {
  /** true — правила бази не пускають; решта причин технічні. */
  denied: boolean;
  text: string;
}

function toError(e: unknown): LiveError {
  const code = (e as { code?: string })?.code ?? '';
  const denied = code === 'permission-denied';
  return {
    denied,
    text: denied
      ? 'Немає прав на читання — увійдіть акаунтом адміністратора.'
      : 'Не вдалося завантажити. Перевірте правила Firestore (файл firebase/firestore.rules).'
  };
}

function watch(
  q: ReturnType<typeof query>,
  onData: (docs: Doc[]) => void,
  onError?: (e: LiveError) => void
): () => void {
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((x) => ({ _id: x.id, ...(x.data() as object) }) as Doc)),
    (e) => onError?.(toError(e))
  );
}

/** Замовлення, найновіші згори.
 *
 *  onNew викликається лише для тих, яких не було в попередньому
 *  кадрі, і НЕ на першому: інакше при кожному відкритті адмінки
 *  висипалось би пʼятсот повідомлень «нове замовлення». */
export function watchOrders(
  onData: (orders: Doc[]) => void,
  onNew?: (order: Doc) => void,
  onError?: (e: LiveError) => void
): () => void {
  const d = db();
  if (!d) {
    onData([]);
    return () => {};
  }

  let known: Set<string> | null = null;

  return watch(
    query(collection(d, ORDERS_COL), orderBy('created', 'desc'), fsLimit(ORDERS_LIMIT)),
    (docs) => {
      if (known && onNew) docs.forEach((o) => (known!.has(o._id) ? null : onNew(o)));
      known = new Set(docs.map((o) => o._id));
      onData(docs);
    },
    onError
  );
}

/** Залишки: id документа — артикул товару. */
export function watchInventory(
  onData: (inv: Record<string, unknown>) => void,
  onError?: (e: LiveError) => void
): () => void {
  const d = db();
  if (!d) {
    onData({});
    return () => {};
  }
  return watch(
    query(collection(d, INVENTORY_COL)),
    (docs) => {
      const out: Record<string, unknown> = {};
      docs.forEach((x) => {
        const { _id, ...rest } = x;
        out[_id] = rest;
      });
      onData(out);
    },
    onError
  );
}

export function watchPromos(
  onData: (promos: Doc[]) => void,
  onError?: (e: LiveError) => void
): () => void {
  const d = db();
  if (!d) {
    onData([]);
    return () => {};
  }
  return watch(query(collection(d, PROMOS_COL)), onData, onError);
}

/* null — прочитати не вдалося. Саме null, а не порожній список:
   «приходів немає» і «база не відповіла» — різні речі, і друге не
   має стирати з екрана те, що вже прочитано. */
async function readOnce(
  path: string,
  field: string,
  dir: 'asc' | 'desc',
  max: number
): Promise<Doc[] | null> {
  const d = db();
  if (!d) return [];
  try {
    const snap = await getDocs(query(collection(d, path), orderBy(field, dir), fsLimit(max)));
    return snap.docs.map((x) => ({ _id: x.id, ...(x.data() as object) }) as Doc);
  } catch {
    return null;
  }
}

/** Приходи — за очікуваною датою: спершу ті, на які чекають. */
export const loadRestocks = () => readOnce(RESTOCKS_COL, 'expected', 'asc', RESTOCKS_LIMIT);

/** Журнал руху — найновіше згори. */
export const loadMoves = () => readOnce(MOVES_COL, 'ts', 'desc', MOVES_LIMIT);
