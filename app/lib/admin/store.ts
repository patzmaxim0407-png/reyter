/* ============================================================
   REYTER — чернетка каталогу в адмінці
   ------------------------------------------------------------
   Адмінка працює з чернеткою: колекції catalog_categories і
   catalog_products. Покупець їх не бачить — він читає
   зафіксований знімок published/catalog.

   Читаємо підпискою, а не разовим запитом: магазин ведуть удвох,
   і зміна, зроблена з телефона, має зʼявитись на ноутбуці сама.
   Це та сама причина, з якої в старій адмінці стояв onSnapshot.
   ============================================================ */

import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { Category, Product } from '../types';

export const CAT_COL = 'catalog_categories';
export const PROD_COL = 'catalog_products';

export interface Draft {
  categories: Category[];
  products: Product[];
  /** false — у базі ще нічого немає: адмінці треба запропонувати
   *  первинний імпорт, а не вдавати порожній каталог. */
  seeded: boolean;
}

export const EMPTY_DRAFT: Draft = { categories: [], products: [], seeded: false };

/** Підписка на чернетку. Повертає функцію відписки.
 *
 *  Обидві колекції приходять окремо й у різний час, тож стан
 *  збирається з двох половинок: інакше на кожен кадр одна з них
 *  була б порожня, і список товарів блимав би. */
export function watchDraft(
  onChange: (d: Draft) => void,
  onError?: (e: unknown) => void
): () => void {
  const d = db();
  if (!d) {
    onChange(EMPTY_DRAFT);
    return () => {};
  }

  let categories: Category[] = [];
  let products: Product[] = [];
  let gotCats = false;
  let gotProds = false;

  const push = () => {
    if (!gotCats || !gotProds) return;
    onChange({ categories, products, seeded: products.length > 0 });
  };

  const unsubCats = onSnapshot(
    query(collection(d, CAT_COL), orderBy('order')),
    (snap) => {
      categories = snap.docs.map((x) => ({ id: x.id, ...x.data() }) as Category);
      gotCats = true;
      push();
    },
    (e) => onError?.(e)
  );

  const unsubProds = onSnapshot(
    query(collection(d, PROD_COL), orderBy('order')),
    (snap) => {
      products = snap.docs.map((x) => ({ id: x.id, ...x.data() }) as Product);
      gotProds = true;
      push();
    },
    (e) => onError?.(e)
  );

  return () => {
    unsubCats();
    unsubProds();
  };
}
