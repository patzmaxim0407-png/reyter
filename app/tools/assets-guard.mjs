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
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const КОРІНЬ = new URL('..', import.meta.url).pathname;
const ASSETS = join(КОРІНЬ, '.open-next/assets');
const СТАТИКА = join(ASSETS, 'new/_next/static');
const ІСТОРІЯ = join(КОРІНЬ, '.static-history');
/** Скільки попередніх збірок тримаємо живими.

   Дві — це мало. У день, коли викладок десяток, вкладка, відкрита
   вранці, до обіду вже просить файли, яких немає, і сайт
   перезавантажується просто під руками: натиснув на товар —
   оновлення, закрив картку — знову оновлення.

   Уся статика сайту важить близько мегабайта, тож вісім поколінь
   коштують копійки, зате вкладка доживає до кінця дня. */
const ПОКОЛІНЬ = 8;

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
if (!existsSync(СТАТИКА)) {
  console.log('· статики немає — переносити нічого');
  process.exit(0);
}

const файли = (корінь, префікс = '') =>
  readdirSync(join(корінь, префікс), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? файли(корінь, join(префікс, d.name)) : [join(префікс, d.name)]
  );

mkdirSync(ІСТОРІЯ, { recursive: true });

/* Спершу зберігаємо ЦЮ збірку — саму по собі, без чужих файлів:
   інакше історія росла б без кінця, накопичуючи все підряд. */
const свої = файли(СТАТИКА);
const мітка = String(Date.now());
cpSync(СТАТИКА, join(ІСТОРІЯ, мітка), { recursive: true });

const попередні = readdirSync(ІСТОРІЯ)
  .filter((d) => d !== мітка)
  .map((d) => ({ d, t: statSync(join(ІСТОРІЯ, d)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

let перенесено = 0;
for (const { d } of попередні.slice(0, ПОКОЛІНЬ)) {
  for (const f of файли(join(ІСТОРІЯ, d))) {
    const куди = join(СТАТИКА, f);
    if (existsSync(куди)) continue;
    mkdirSync(join(куди, '..'), { recursive: true });
    cpSync(join(ІСТОРІЯ, d, f), куди);
    перенесено += 1;
  }
}

// зайві покоління прибираємо, щоб каталог не ріс
for (const { d } of попередні.slice(ПОКОЛІНЬ)) rmSync(join(ІСТОРІЯ, d), { recursive: true, force: true });

console.log(
  '✓ статика: своїх файлів ' + свої.length + ', перенесено зі старих збірок ' + перенесено
);
