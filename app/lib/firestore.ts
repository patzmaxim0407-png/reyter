/* ============================================================
   REYTER — читання Firestore із сервера, без SDK
   ------------------------------------------------------------
   Опублікований каталог і залишки правила бази дозволяють читати
   будь-кому (див. firestore.rules). Тому серверу не потрібні ні
   ключі, ні Firebase Admin SDK — вистачає звичайного REST.

   Це важливо: Admin SDK тягне за собою Node-only залежності й
   службовий акаунт, а так сторінки рендеряться будь-де, зокрема
   на Cloudflare.

   REST повертає значення в типізованій обгортці
   ({stringValue}, {integerValue}, {mapValue}…) — decode() розгортає
   її назад у звичайний JavaScript.
   ============================================================ */

import type { Catalog, Category, Product, Stock } from './types';

const PROJECT = process.env.NEXT_PUBLIC_FB_PROJECT ?? 'reyter-18d2c';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

/** Скільки секунд сторінка живе між перечитуваннями каталогу.
 *  Публікація з адмінки має зʼявлятися швидко, але не ціною
 *  запиту в базу на кожен перегляд. */
export const CATALOG_TTL = 60;

type Value = Record<string, unknown>;

function decode(v: Value): unknown {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue as string;
  if ('booleanValue' in v) return v.booleanValue as boolean;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return new Date(v.timestampValue as string).getTime();
  if ('arrayValue' in v) {
    const arr = (v.arrayValue as { values?: Value[] }).values ?? [];
    return arr.map(decode);
  }
  if ('mapValue' in v) {
    return decodeFields((v.mapValue as { fields?: Record<string, Value> }).fields ?? {});
  }
  return null;
}

function decodeFields(fields: Record<string, Value>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) out[key] = decode(fields[key]);
  return out;
}

async function getDoc(path: string, revalidate: number): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${BASE}/${path}`, { next: { revalidate } });
  if (!res.ok) return null;
  const json = (await res.json()) as { fields?: Record<string, Value> };
  return json.fields ? decodeFields(json.fields) : null;
}

async function listDocs(collection: string, revalidate: number) {
  const res = await fetch(`${BASE}/${collection}?pageSize=300`, { next: { revalidate } });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    documents?: { name: string; fields?: Record<string, Value> }[];
  };
  return (json.documents ?? []).map((d) => ({
    id: d.name.split('/').pop() as string,
    data: d.fields ? decodeFields(d.fields) : {}
  }));
}

/* ---------- Каталог ----------
   Сайт показує ОПУБЛІКОВАНУ версію: зміни в адмінці лежать у
   чернетці, поки їх не опублікують. Запланована публікація живе
   в published/next і вмикається сама, щойно настає її час. */

export async function loadCatalog(revalidate = CATALOG_TTL): Promise<Catalog> {
  const [next, current] = await Promise.all([
    getDoc('published/next', revalidate),
    getDoc('published/catalog', revalidate)
  ]);

  const publishAt = Number(next?.publishAt ?? 0);
  const due = !!next && publishAt > 0 && publishAt <= Date.now();
  const snap = due ? next : current;

  const products = (snap?.products as Product[] | undefined) ?? [];
  const categories = (snap?.categories as Category[] | undefined) ?? [];

  return {
    products,
    categories: categories
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    nextAt: !due && publishAt > 0 ? publishAt : null
  };
}

/* ---------- Залишки ----------
   Живуть окремо від каталогу й змінюються значно частіше:
   кожне підтверджене замовлення зменшує їх. Тому й TTL коротший. */

export async function loadStock(revalidate = 30): Promise<Stock> {
  const docs = await listDocs('inventory', revalidate);
  const out: Stock = {};
  for (const d of docs) {
    out[d.id] = {
      sizes: (d.data.sizes as Record<string, number> | undefined) ?? undefined,
      qty: typeof d.data.qty === 'number' ? d.data.qty : undefined
    };
  }
  return out;
}

/** Очікувані дати приходу: адмінка публікує лише «коли зʼявиться»,
 *  без кількостей — це вже комерційна інформація. */
export async function loadRestockEta(productId: string, revalidate = 300) {
  const d = await getDoc(`restock_eta/${productId}`, revalidate);
  if (!d) return null;
  return {
    any: (d.any as string) ?? '',
    sizes: (d.sizes as Record<string, string>) ?? {}
  };
}
