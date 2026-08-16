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
  query,
  where
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
/** Черга приходів: скільки незакритих тримаємо. Їх завжди
 *  одиниці — сотня тут із величезним запасом. */
export const RESTOCKS_LIMIT = 100;
/** І скільки останніх оприбуткованих показуємо поруч. */
export const RECEIVED_LIMIT = 40;

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

/** Учасники програми лояльності. Перелік дозволено лише адміну —
 *  за ним видно пошти всіх покупців разом із сумами, які вони
 *  витратили. */
export function watchMembers(
  onData: (members: Doc[]) => void,
  onError?: (e: LiveError) => void
): () => void {
  const d = db();
  if (!d) {
    onData([]);
    return () => {};
  }
  return watch(query(collection(d, 'loyalty')), onData, onError);
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

/** Приходи.
 *
 *  Раніше це був один запит: orderBy('expected','asc') limit(100).
 *  Тобто СТО НАЙДАВНІШИХ — а оприбутковані приходи з колекції не
 *  видаляються, лише міняють статус. Щойно їх набралося б понад
 *  сто, нові приходи у вибірку не потрапляли б узагалі: блок
 *  «Очікуються» показав би «немає», лічильник збрехав би, а
 *  кнопка «Оприбуткувати» просто зникла б. Мовчки.
 *
 *  Тому запити тепер два й кожен по своє.
 *
 *  Черга — рівністю за статусом, без orderBy: рівність не
 *  потребує складеного покажчика, а таких документів завжди
 *  одиниці, тож упорядкувати їх дешевше в себе. Складений
 *  покажчик тут був би гіршим рішенням: його треба заводити
 *  руками в консолі, і до того дня запит просто не працював би.
 *
 *  Оприбутковані — за часом оприбуткування, найсвіжіші згори.
 *  Саме за ним, а не за очікуваною датою: «останні оприбутковані»
 *  означає «які щойно завели на склад», а не «які найпізніше
 *  обіцяли». */
export async function loadRestocks(): Promise<Doc[] | null> {
  const d = db();
  if (!d) return [];
  try {
    const [queue, done] = await Promise.all([
      getDocs(query(collection(d, RESTOCKS_COL), where('status', '==', 'pending'), fsLimit(RESTOCKS_LIMIT))),
      getDocs(query(collection(d, RESTOCKS_COL), orderBy('receivedAt', 'desc'), fsLimit(RECEIVED_LIMIT)))
    ]);

    const rows = new Map<string, Doc>();
    for (const x of [...queue.docs, ...done.docs]) {
      rows.set(x.id, { _id: x.id, ...(x.data() as object) } as Doc);
    }

    /* Порядок той самий, що й був: за очікуваною датою, спершу
       найближчі. На нього спирається і черга, і «останні
       оприбутковані». */
    return [...rows.values()].sort((a, b) =>
      String(a.expected || '').localeCompare(String(b.expected || ''))
    );
  } catch {
    return null;
  }
}

/** Журнал руху — найновіше згори. */
export const loadMoves = () => readOnce(MOVES_COL, 'ts', 'desc', MOVES_LIMIT);
