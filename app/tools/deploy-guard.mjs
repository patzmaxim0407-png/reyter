/* ============================================================
   Чи не застаріла збірка
   ------------------------------------------------------------
   Викладка на Cloudflare бере ГОТОВУ теку .open-next. Команда
   `wrangler deploy` її не перезбирає — просто вивантажує те, що
   лежить. Тож якщо забути `npm run cf:build`, на сервер поїде
   вчорашній сайт, і виглядатиме це найгірше з можливого: викладка
   пройшла успішно, версія змінилась, а в браузері нічого нового.
   Саме так і сталося 12.08.2026 — двічі поспіль.

   Тому перед вивантаженням звіряємо час: якщо хоч один файл
   вихідного коду молодший за зібраний воркер, збірка застаріла.

   node tools/deploy-guard.mjs
   ============================================================ */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WORKER = '.open-next/worker.js';

/* Той самий сторож підвішений у wrangler.jsonc як build.command —
   wrangler виконує його перед КОЖНОЮ своєю командою, тож повз
   нього не пройде жодна викладка, хоч якою командою її почали.

   Але wrangler тим самим гачком починає й `dev`, а там свіжа
   збірка ні до чого: людина саме її й переписує просто зараз.
   Тому дивимось, яку команду він виконує. Змінної немає (сторожа
   покликали руками) — перевіряємо, це найбезпечніше. */
if (process.argv.includes('--if-deploy')) {
  const cmd = String(process.env.WRANGLER_COMMAND || '');
  if (cmd === 'dev' || cmd === 'types' || cmd === 'versions secret' || cmd === 'secret') {
    console.log('· ' + cmd + ': свіжість збірки не перевіряємо');
    process.exit(0);
  }
}

/* Тільки те, з чого справді збирається сайт. Тека tools сюди не
   входить навмисно: перевірки не потрапляють у збірку, і правка
   перевірки не робить збірку застарілою. */
const WATCH = ['app', 'components', 'lib', 'styles', 'public', 'next.config.ts', 'package.json'];
const SKIP = new Set(['node_modules', '.next', '.open-next', '.git']);

if (!existsSync(WORKER)) {
  console.error('✗ Немає ' + WORKER + ' — спершу `npm run cf:build`');
  process.exit(1);
}

const built = statSync(WORKER).mtimeMs;
let newest = { time: 0, file: '' };

function walk(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (SKIP.has(name)) continue;
      walk(join(path, name));
    }
    return;
  }
  if (st.mtimeMs > newest.time) newest = { time: st.mtimeMs, file: path };
}

for (const path of WATCH) if (existsSync(path)) walk(path);

const hhmm = (ms) => new Date(ms).toLocaleTimeString('uk-UA');

if (newest.time > built) {
  console.error('✗ Збірка застаріла: ' + newest.file + ' змінено о ' + hhmm(newest.time) +
    ', а воркер зібрано о ' + hhmm(built));
  console.error('  Виконайте `npm run cf:build` — і аж тоді викладайте.');
  process.exit(1);
}

console.log('✓ збірка свіжа: воркер від ' + hhmm(built) + ', найновіший вихідний файл — ' + hhmm(newest.time));
