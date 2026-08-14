/* ============================================================
   Чи повна збірка
   ------------------------------------------------------------
   Turbopack час від часу випускає сторінку, яка посилається на
   файл, котрого не створила. Виглядає це так: у браузері
   ChunkLoadError і 404 на /_next/static/chunks/…, сторінка або
   не оживає зовсім, або втрачає половину поведінки. На око з
   консолі розробника цього не видно — збірка «успішна».

   Тому перед викладкою звіряємо: кожен файл, на який посилається
   готова сторінка, має існувати серед викладених.

   node tools/check-chunks.mjs [тека]
   За замовчуванням перевіряє .open-next/assets — саме те, що їде
   в Cloudflare.
   ============================================================ */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.argv[2] || '.open-next/assets';
const PAGES = '.next/server/app';

if (!existsSync(ROOT)) {
  console.error(`Немає теки ${ROOT} — спершу зберіть проєкт`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/* Готові сторінки й потоки RSC: саме там лежать посилання на
   файли, які браузер піде забирати. */
const pages = existsSync(PAGES)
  ? walk(PAGES).filter((f) => f.endsWith('.html') || f.endsWith('.rsc'))
  : [];

if (!pages.length) {
  console.error(`Немає зібраних сторінок у ${PAGES}`);
  process.exit(1);
}

const assets = new Set(walk(ROOT).map((f) => relative(ROOT, f)));

const missing = new Map(); // файл → сторінки, які його просять
for (const page of pages) {
  const text = readFileSync(page, 'utf8');
  for (const m of text.matchAll(/_next\/static\/[\w./-]+\.(?:js|css)/g)) {
    if (assets.has(m[0])) continue;
    if (!missing.has(m[0])) missing.set(m[0], []);
    const list = missing.get(m[0]);
    if (list.length < 3) list.push(relative(PAGES, page));
  }
}

if (!missing.size) {
  console.log(`✓ збірка повна: усі файли, на які посилаються ${pages.length} сторінок, на місці`);
  process.exit(0);
}

console.error('✗ збірка неповна — є посилання на файли, яких немає:\n');
for (const [asset, where] of missing) {
  console.error(`  ${asset}`);
  console.error(`     просять: ${where.join(', ')}`);
}
console.error('\nЦе відома примха Turbopack. Зберіть заново: rm -rf .next && npm run cf:build');
process.exit(1);
