/* ============================================================
   Чи доїхала викладка
   ------------------------------------------------------------
   «Deployed» у консолі wrangler ще нічого не означає для покупця.
   Між зібраною текою й тим, що бачить браузер, стоять два шари,
   і кожен уміє віддати старе: сховище сторінок воркера (звідти
   HTML) і кеш Cloudflare (звідти файли).

   Тому після викладки питаємо в самого сайту:
   • чи посилається жива сторінка на файли З ЦІЄЇ збірки;
   • чи всі ці файли справді лежать на сервері.

   Перше ловить старий HTML, друге — «голу» сторінку й
   ChunkLoadError у покупця.

   node tools/deploy-check.mjs [адреса…]
   ============================================================ */

import { existsSync, readdirSync } from 'node:fs';

const LOCAL = '.open-next/assets/new/_next/static/chunks';
const SITES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['https://reyter.men/new/', 'https://admin.reyter.men/new/admin'];

if (!existsSync(LOCAL)) {
  console.error('✗ Немає ' + LOCAL + ' — спершу `npm run cf:build`');
  process.exit(1);
}

/* Стилі — найкраща мітка збірки: файл один на весь сайт, ім'я
   містить відбиток вмісту, і сторінка тягне його завжди. */
const mine = new Set(readdirSync(LOCAL).filter((f) => f.endsWith('.css')));
if (!mine.size) {
  console.error('✗ У збірці немає жодного файла стилів — щось не так із самою збіркою');
  process.exit(1);
}

let bad = 0;
const ok = (cond, text, extra = '') => {
  if (!cond) bad++;
  console.log((cond ? '✓ ' : '✗ ') + text + (extra ? ' — ' + extra : ''));
};

for (const site of SITES) {
  const origin = new URL(site).origin;
  let html = '';
  try {
    const res = await fetch(site, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
    html = await res.text();
    ok(res.ok, site + ' відповідає', String(res.status));
    if (!res.ok) continue;
  } catch (e) {
    ok(false, site + ' не відповідає', String(e));
    continue;
  }

  /* Частина посилань лежить у потоці RSC, а там лапки екрановані —
     звідти й хвіст «\» наприкінці шляху. Прибираємо, інакше
     перевірка сама собі вигадує неіснуючий файл. */
  const refs = [
    ...new Set(
      [...html.matchAll(/\/new\/_next\/static\/[^"'\s)]+/g)].map((m) => m[0].replace(/\\+$/, ''))
    )
  ];
  ok(refs.length > 0, 'сторінка посилається на файли збірки', 'посилань: ' + refs.length);

  /* Головне питання: HTML із ЦІЄЇ збірки чи зі сховища, де лежить
     учорашній? Порівнюємо за стилями. */
  const css = refs.filter((r) => r.endsWith('.css')).map((r) => r.split('/').pop());
  const fresh = css.filter((f) => mine.has(f));
  ok(css.length > 0 && fresh.length === css.length,
     'HTML саме з цієї збірки',
     css.map((f) => (mine.has(f) ? f : f + ' ← чужий')).join(', ') || 'стилів у сторінці немає');

  /* І чи всі файли на місці: старий HTML на нових файлах — це
     «гола» сторінка й ChunkLoadError у покупця. */
  /* Одразу після викладки файл ще розповзається краями мережі:
     перша спроба цілком може дати 404, а за секунду вже 200.
     Тому питаємо кілька разів — і аж тоді кажемо «немає». */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = async (url) => {
    for (let i = 0; i < 6; i++) {
      try {
        const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
        if (r.ok) return '';
        if (i === 5) return String(r.status);
      } catch (e) {
        if (i === 5) return 'немає звʼязку';
      }
      await wait(3000);
    }
    return '?';
  };

  const missing = [];
  await Promise.all(
    refs.map(async (path) => {
      const why = await alive(origin + path);
      if (why) missing.push(path + ' (' + why + ')');
    })
  );
  ok(missing.length === 0, 'усі файли сторінки на сервері', missing.slice(0, 5).join(', ') || 'перевірено ' + refs.length);
}

console.log(bad ? '\nвикладка НЕ доїхала: ' + bad : '\nвикладка доїхала ✓');
process.exit(bad ? 1 : 0);
