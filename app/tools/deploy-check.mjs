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

import { existsSync, readdirSync, readFileSync } from 'node:fs';

const LOCAL = '.open-next/assets/_next/static/chunks';
/* Мітка збірки. Next пише її в BUILD_ID і кладе поруч зі
   статикою, тож живий сайт віддає її звичайним файлом. Це
   найчесніша відповідь на питання «яка збірка зараз на сервері»:
   мітка нова на КОЖНУ збірку, і підробити її нічим. */
const BUILD_ID = '.open-next/assets/BUILD_ID';
const SITES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['https://reyter.men/', 'https://admin.reyter.men/orders'];

if (!existsSync(LOCAL)) {
  console.error('✗ Немає ' + LOCAL + ' — спершу `npm run cf:build`');
  process.exit(1);
}

/* Імена стилів як мітка не годяться: assets-guard навмисно
   зливає в цю саму теку статику восьми попередніх збірок, щоб
   вкладка, відкрита до викладки, не отримала 404. Тому «мій
   файл» тут — це й файл позаминулої збірки теж, і стара сторінка
   пройшла б перевірку. Мітка одна й незамінна — BUILD_ID. */
const mine = new Set(readdirSync(LOCAL).filter((f) => f.endsWith('.css')));
const myBuild = existsSync(BUILD_ID) ? readFileSync(BUILD_ID, 'utf8').trim() : '';
if (!myBuild) {
  console.error('✗ Немає ' + BUILD_ID + ' — спершу `npm run cf:build`');
  process.exit(1);
}

let bad = 0;
const ok = (cond, text, extra = '') => {
  if (!cond) bad++;
  console.log((cond ? '✓ ' : '✗ ') + text + (extra ? ' — ' + extra : ''));
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* Нова версія воркера розкочується краями мережі не миттєво, тож
   мітку перепитуємо, а не питаємо раз. Рядок запиту обовʼязковий:
   без нього відповідь приходить із кеша Cloudflare. */
async function liveBuild(origin) {
  let last = '';
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(origin + '/BUILD_ID?cb=' + i + '-' + process.pid, {
        headers: { 'cache-control': 'no-cache' }
      });
      last = r.ok ? (await r.text()).trim() : 'відповідь ' + r.status;
      if (last === myBuild) return last;
    } catch (e) {
      last = 'немає звʼязку';
    }
    await pause(3000);
  }
  return last;
}

/* Запасна адреса воркера — та сама, що в базі?
   ------------------------------------------------------------
   У lib/firebase.ts лежить адреса воркера на випадок, коли
   settings/public не прочитався: без неї один невдалий запит
   лишає замовлення без оплати й без сповіщення (так сталося
   31.08.2026 з R-260831-566).

   Запасний варіант, який розійшовся з дійсністю, гірший за його
   відсутність: він мовчки поведе оплату в нікуди. Тому питаємо
   живу базу — читати settings/public дозволено всім, ключів там
   немає. */
{
  const src = readFileSync(new URL('../lib/firebase.ts', import.meta.url), 'utf8');
  const mineUrl = (src.match(/WORKER_FALLBACK\s*=\s*'([^']+)'/) || [])[1] || '';
  const DB = 'https://firestore.googleapis.com/v1/projects/reyter-18d2c/databases/(default)/documents/settings/public';
  const KEY = (src.match(/apiKey:\s*'([^']+)'/) || [])[1] || '';
  let liveUrl = '';
  try {
    const r = await fetch(DB + '?key=' + KEY);
    const j = await r.json();
    liveUrl = ((j.fields || {}).workerUrl || {}).stringValue || '';
  } catch (e) {
    liveUrl = 'база не відповіла';
  }
  const same = !!mineUrl && mineUrl.replace(/\/+$/, '') === liveUrl.replace(/\/+$/, '');
  ok(same, 'запасна адреса воркера збігається з тією, що в базі',
     same ? mineUrl : 'у коді ' + (mineUrl || '—') + ', у базі ' + (liveUrl || '—'));
}

for (const site of SITES) {
  const origin = new URL(site).origin;

  /* Перша перевірка й головна: чи ЦЯ збірка на сервері. Саме її
     бракувало 12.08.2026, коли двічі поспіль поїхала стара. */
  const live = await liveBuild(origin);
  ok(live === myBuild, origin + ' — саме ця збірка', live === myBuild ? myBuild : 'на сервері ' + live + ', у нас ' + myBuild);
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

  /* Одна вдала відповідь ще нічого не доводить.
     26.08.2026 сайт віддавав 1102 приблизно на половині
     переглядів — воркер не вкладався в межу процесорного часу
     безкоштовного тарифу (10 мс), і кожна сторінка була
     підкиданням монетки. Ця перевірка мовчала: вона питала
     сторінку РАЗ, і рівно цей раз щоразу випадав вдалим.
     П'ять викладок поспіль сказали «доїхала» над зламаним
     магазином.

     Тому питаємо кілька разів поспіль і дивимось не на «чи
     відповіло», а на «чи відповідає завжди». Рядок запиту не
     додаємо навмисно: покупець приходить на голу адресу, і
     міряти треба саме її. */
  const TRIES = 6;
  const codes = [];
  for (let i = 0; i < TRIES; i++) {
    try {
      const r = await fetch(site, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
      codes.push(r.status);
    } catch (e) {
      codes.push(0);
    }
    await pause(700);
  }
  const fell = codes.filter((c) => c !== 200);
  ok(
    fell.length === 0,
    site + ' відповідає стабільно',
    fell.length
      ? fell.length + ' з ' + TRIES + ' спроб дали ' + [...new Set(fell)].join('/') +
        ' — найімовірніше воркер не вклався в межу процесорного часу (Cloudflare 1102).' +
        ' Це тариф Workers, а не код: точну причину видно в `npx wrangler tail reyter-site --format json`,' +
        ' поле outcome.'
      : 'усі ' + TRIES + ' спроби по 200'
  );

  /* Частина посилань лежить у потоці RSC, а там лапки екрановані —
     звідти й хвіст «\» наприкінці шляху. Прибираємо, інакше
     перевірка сама собі вигадує неіснуючий файл. */
  const refs = [
    ...new Set(
      [...html.matchAll(/\/_next\/static\/[^"'\s)]+/g)].map((m) => m[0].replace(/\\+$/, ''))
    )
  ];
  ok(refs.length > 0, 'сторінка посилається на файли збірки', 'посилань: ' + refs.length);

  /* Друге питання: сторінку зібрано з тих самих файлів. Мітка
     вище каже лише про статику; воркер міг лишитись старим — тоді
     він і віддасть HTML попередньої збірки. */
  const css = refs.filter((r) => r.endsWith('.css')).map((r) => r.split('/').pop());
  ok(css.length > 0 && css.every((f) => mine.has(f)),
     'стилі сторінки — з нашої збірки',
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
