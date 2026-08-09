/* Порівняння старої логіки (js/catalog.js) і нової (lib/catalog.ts)
   на справжньому опублікованому каталозі. */
import { availability, productColors, isSet, setParts, setQty, ALL_SIZES } from '../lib/catalog.ts';
import type { Product, Stock } from '../lib/types.ts';

const P = 'reyter-18d2c';
const B = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;

function dec(v: any): any {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(dec);
  if ('mapValue' in v) return fields(v.mapValue.fields ?? {});
  return null;
}
const fields = (f: any) => Object.fromEntries(Object.keys(f).map((k) => [k, dec(f[k])]));

const cat = fields((await (await fetch(`${B}/published/catalog`)).json()).fields);
const inv = await (await fetch(`${B}/inventory?pageSize=300`)).json();
const stock: Stock = {};
for (const d of inv.documents ?? []) {
  const id = d.name.split('/').pop();
  const f = fields(d.fields ?? {});
  stock[id] = { sizes: f.sizes, qty: f.qty };
}
const products = cat.products as Product[];
console.log(`каталог: ${products.length} товарів, залишки на ${Object.keys(stock).length} позицій`);

/* ---- стара логіка: вантажимо js/catalog.js у фейковий window ---- */
const src = await (await import('node:fs/promises')).readFile(new URL('../../new/js/catalog.js', import.meta.url), 'utf8');
const R: any = {
  products, stock,
  config: { allSizes: ALL_SIZES },
  categories: cat.categories,
  esc: (s: any) => String(s ?? ''),
  t: (k: string) => k, tf: (o: any, f: string) => o?.[f], tx: (s: any) => s,
  lang: () => 'uk', fmt: (n: number) => String(n)
};
(globalThis as any).window = { REYTER: R };
(globalThis as any).document = { querySelectorAll: () => [], getElementById: () => null };
new Function(src)();
/* catalog.js при завантаженні робить R.stock = null — тож дані
   підставляємо ПІСЛЯ, інакше стара логіка рахує зі статичних полів */
R.stock = stock;
R.products = products;
R.config = { allSizes: ALL_SIZES };

/* ---- порівняння ---- */
let same = 0; const diffs: string[] = [];
const C = { products, stock };

for (const p of products) {
  const a = R.availability(p);
  const b = availability(C, p);
  const key = (x: any) => JSON.stringify({
    soldOut: !!x.soldOut, sizes: [...(x.sizes ?? [])].sort(),
    low: [...(x.low ?? [])].sort(), total: x.total ?? 0, isSet: !!x.isSet
  });
  if (key(a) === key(b)) same++;
  else diffs.push(`${p.id} (${p.name})\n    стара: ${key(a)}\n    нова:  ${key(b)}`);

  const ca = JSON.stringify(R.productColors(p));
  const cb = JSON.stringify(productColors(C, p));
  if (ca !== cb) diffs.push(`${p.id} КОЛЬОРИ\n    стара: ${ca}\n    нова:  ${cb}`);
}

console.log(`\nнаявність збігається: ${same}/${products.length}`);
const sets = products.filter((p) => isSet(p));
console.log(`комплектів: ${sets.length}`);
for (const s of sets) {
  console.log(`  ${s.id}: складників ${setParts(C, s).length}, ` +
    ALL_SIZES.map((z) => z + ':' + setQty(C, s, z)).join(' '));
}
console.log(diffs.length ? '\nРОЗБІЖНОСТІ:\n' + diffs.join('\n') : '\nрозбіжностей немає ✓');
