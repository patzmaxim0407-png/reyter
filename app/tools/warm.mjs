/* ============================================================
   Прогрів після викладки
   ------------------------------------------------------------
   Кожна нова збірка — це новий номер збірки, а разом із ним
   порожнє сховище готових сторінок. Перший, хто відкриє сторінку
   товару, чекає, поки воркер збере її з нуля: каталог, картка,
   два читання Firestore.

   Одному такому запиту це вдається. Кільком одночасно — уже ні:
   воркер упирається в межу ресурсів і Cloudflare віддає власну
   сторінку помилки 1102. Саме її й побачив власник 13.08.2026,
   клацнувши товар із телефона.

   Тому після викладки обходимо сайт самі — повільно, по одній
   сторінці, доки ніхто не заважає. Далі кожен запит потрапляє
   вже в готове.

   node tools/warm.mjs [адреса]
   ============================================================ */

const BASE = (process.argv[2] || 'https://reyter.men/new').replace(/\/+$/, '');
/* По одному запиту за раз і з паузою. Паралельні рендери — це
   саме те, від чого ми тут і рятуємось: 14.08.2026 прогрів у два
   потоки поклав сайт на кілька хвилин. */
const PAUSE = 1000;
/* Три невдачі поспіль — воркер уже задихається, і продовжувати
   означає добивати його. */
const GIVE_UP = 3;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function grab(url, headers = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers, redirect: 'follow' });
    // тіло треба дочитати: інакше рендер на тому боці може обірватись
    await res.arrayBuffer();
    return { ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: String(e).slice(0, 40), ms: Date.now() - started };
  }
}

/* Адреси беремо з мапи сайту — вона перелічує рівно те, що
   покупець може відкрити, і зростає разом із каталогом. */
const map = await (await fetch(BASE + '/sitemap.xml')).text();
/* Мапа перелічує ще й якорі категорій (/#cat-briefs) — це та
   сама головна сторінка, і гріти її тринадцять разів ні до чого. */
const pages = [...new Set([...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].split('#')[0]))];

if (!pages.length) {
  console.error('✗ Мапа сайту порожня — прогрівати нічого');
  process.exit(1);
}

let cold = 0;
let failed = 0;
const slow = [];

let inARow = 0;
for (const page of pages) {
  const r = await grab(page);
  await wait(PAUSE);

  if (!r.ok) {
    failed += 1;
    inARow += 1;
    console.log('✗ ' + page + ' — ' + r.status);
    if (inARow >= GIVE_UP) {
      console.log('  зупиняюсь: воркер не встигає, доганяти його запитами марно');
      break;
    }
    continue;
  }
  inARow = 0;
  if (r.ms > 400) cold += 1;
  if (r.ms > 1200) slow.push(page + ' (' + r.ms + ' мс)');
}

console.log(
  (failed ? '✗' : '✓') + ' прогріто сторінок: ' + pages.length +
    ', зібрано наново ' + cold + ', невдач ' + failed
);
if (slow.length) console.log('  найдовші: ' + slow.slice(0, 5).join(', '));

/* Невдача під час прогріву — не привід валити викладку: сторінка
   лишилась старою, але живою. Кажемо про це й закінчуємо добром,
   інакше `npm run cf:ship` червонів би через дрібницю. */
process.exit(0);
