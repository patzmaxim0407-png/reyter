/* Дві дрібниці перед викладкою, від яких залежить, чи побачить
   покупець сайт після оновлення.

   ПЕРША: заголовки для файлів збірки. Cloudflare роздає їх із
   «max-age=0, must-revalidate» — тобто браузер копію не тримає й
   лізе в мережу за стилями на КОЖНЕ завантаження сторінки. Імена
   файлів і так містять відбиток вмісту, тому правильний заголовок
   тут — «immutable» на рік. Файл _headers wrangler читає лише з
   кореня каталогу assets, а public/ через basePath лягає в
   assets/new/ — звідти його ніхто не прочитає. Тому пишемо самі.

   ДРУГА: вкладка, відкрита ДО викладки. Її сторінка просить файли
   зі старими іменами, а нова викладка їх стирає — і людина
   отримує голий HTML замість сайту. Лік простий: несемо файли
   попередніх двох збірок у нову. Вони важать копійки (уся статика
   сайту — близько мегабайта), зате стара вкладка доживає до кінця
   без жодної 404.

   node tools/assets-guard.mjs
*/
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ASSETS = join(ROOT, '.open-next/assets');
const STATIC_DIR = join(ASSETS, 'new/_next/static');
const HISTORY_DIR = join(ROOT, '.static-history');
/** Скільки попередніх збірок тримаємо живими.

   Дві — це мало. У день, коли викладок десяток, вкладка, відкрита
   вранці, до обіду вже просить файли, яких немає, і сайт
   перезавантажується просто під руками: натиснув на товар —
   оновлення, закрив картку — знову оновлення.

   Уся статика сайту важить близько мегабайта, тож тридцять
   поколінь коштують копійки, зате вкладка доживає навіть той
   день, коли викладок було півтора десятка — а 14.08.2026 їх
   стільки й було. */
const GENERATIONS = 30;

if (!existsSync(ASSETS)) {
  console.error('✗ немає .open-next/assets — спершу збірка');
  process.exit(1);
}

/* ---------- 1. Заголовки ---------- */
writeFileSync(
  join(ASSETS, '_headers'),
  [
    '# Імена файлів містять відбиток вмісту, тож вміст за іменем',
    '# ніколи не міняється — тримати рік безпечно.',
    '/new/_next/static/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    ''
  ].join('\n')
);
console.log('✓ _headers: статика на рік, immutable');

/* ---------- 2. Файли попередніх збірок ---------- */
if (!existsSync(STATIC_DIR)) {
  console.log('· статики немає — переносити нічого');
  process.exit(0);
}

const walkFiles = (root, prefix = '') =>
  readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walkFiles(root, join(prefix, d.name)) : [join(prefix, d.name)]
  );

mkdirSync(HISTORY_DIR, { recursive: true });

/* Спершу зберігаємо ЦЮ збірку — саму по собі, без чужих файлів:
   інакше історія росла б без кінця, накопичуючи все підряд. */
const ours = walkFiles(STATIC_DIR);
const stamp = String(Date.now());
cpSync(STATIC_DIR, join(HISTORY_DIR, stamp), { recursive: true });

const previous = readdirSync(HISTORY_DIR)
  .filter((d) => d !== stamp)
  .map((d) => ({ d, t: statSync(join(HISTORY_DIR, d)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

let carried = 0;
for (const { d } of previous.slice(0, GENERATIONS)) {
  for (const f of walkFiles(join(HISTORY_DIR, d))) {
    const placeOf = join(STATIC_DIR, f);
    if (existsSync(placeOf)) continue;
    mkdirSync(join(placeOf, '..'), { recursive: true });
    cpSync(join(HISTORY_DIR, d, f), placeOf);
    carried += 1;
  }
}

// зайві покоління прибираємо, щоб каталог не ріс
for (const { d } of previous.slice(GENERATIONS)) rmSync(join(HISTORY_DIR, d), { recursive: true, force: true });

/* Мітка збірки в підсумковому рядку — щоб було з чим звірити
   те, що віддає живий сайт (tools/deploy-check.mjs питає в нього
   той самий BUILD_ID). Без неї покоління в історії — просто час,
   і яке з них зараз на сервері, сказати нічим. */
const buildId = existsSync(join(ASSETS, 'new/BUILD_ID'))
  ? readFileSync(join(ASSETS, 'new/BUILD_ID'), 'utf8').trim()
  : '';

console.log(
  '✓ статика: своїх файлів ' + ours.length + ', перенесено зі старих збірок ' + carried +
    (buildId ? ', збірка ' + buildId : '')
);
