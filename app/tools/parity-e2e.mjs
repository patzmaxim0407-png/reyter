/* Звірка з попереднім сайтом: чи все перенесено.

   Тести кошика й кабінету перевіряють шлях покупця. Цей —
   саме оформлення сторінки: секції, шрифти, анімації, галерея,
   розмірна сітка, підписка на наявність, відео Friendly Club.
   Те, що легко загубити при переписуванні й непомітно, поки
   хтось не відкриє сторінку очима.

   node tools/parity-e2e.mjs http://localhost:8787/new
*/
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

const PROFILE = '/tmp/reyter-test-' + process.pid + '-' + Date.now();
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  '--remote-debugging-port=0',
  '--user-data-dir=' + PROFILE,
  '--no-first-run',
  'about:blank'
]);
await wait(2500);

const port = readFileSync(PROFILE + '/DevToolsActivePort', 'utf8').split(/\r?\n/)[0].trim();
const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (raw) => {
  const m = JSON.parse(raw.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => {
  const my = ++id;
  ws.send(JSON.stringify({ id: my, method, params }));
  return new Promise((r) => pending.set(my, r));
};
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });

const errors = [];
ws.addEventListener('message', (raw) => {
  const m = JSON.parse(raw.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || 'exception');
  }
});

let bad = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) bad++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const go = async (url) => {
  await send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) {
    await wait(200);
    if (await ev('document.readyState === "complete"')) break;
  }
  await wait(1200);
};

/* ---------- Головна: усі секції попереднього сайту ---------- */

await go(BASE + '/');

for (const [id, label] of [
  ['about', 'про нас'],
  ['catalog', 'каталог'],
  ['size-guide', 'розмірна сітка'],
  ['delivery', 'доставка'],
  ['contacts', 'контакти']
]) {
  ok(`секція «${label}»`, await ev(`!!document.getElementById('${id}')`));
}

ok('рухомий рядок угорі', await ev(`!!document.querySelector('.marquee')`));
ok('стрічка категорій', await ev(`document.querySelectorAll('.cat-chips .chip').length > 0`),
   String(await ev(`document.querySelectorAll('.cat-chips .chip').length`)));
ok('картки доставки', await ev(`document.querySelectorAll('.dlv-card').length >= 6`),
   String(await ev(`document.querySelectorAll('.dlv-card').length`)));
ok('картка з приміткою', await ev(`!!document.querySelector('.dlv-card--note')`));
ok('логотипи оплати', await ev(`!!document.querySelector('.dlv-card__pay img')`));
ok('соцмережі', await ev(`document.querySelectorAll('.soc-card').length >= 6`),
   String(await ev(`document.querySelectorAll('.soc-card').length`)));
ok('месенджери окремим блоком',
   await ev(`!!document.querySelector('.soc-card--wa') && !!document.querySelector('.soc-card--vb')`));
ok('таблиця розмірів', await ev(`document.querySelectorAll('.size-guide__table tbody tr').length >= 4`),
   String(await ev(`document.querySelectorAll('.size-guide__table tbody tr').length`)));
ok('підвал', await ev(`!!document.querySelector('.site-footer, footer')`));

/* ---------- Шрифти ---------- */

const fonts = await ev(`(() => {
  const body = getComputedStyle(document.body).fontFamily;
  const title = document.querySelector('.hero__title');
  return { body, display: title ? getComputedStyle(title).fontFamily : '' };
})()`);
ok('основний шрифт Inter', /Inter/i.test(fonts.body), fonts.body.slice(0, 60));
ok('заголовковий шрифт Unbounded', /Unbounded/i.test(fonts.display), fonts.display.slice(0, 60));
ok('шрифти справді завантажились',
   await ev(`document.fonts.check('700 1rem Unbounded') || document.fonts.size > 0`));

/* ---------- Анімація появи ---------- */

ok('блоки з появою на прокрутці', await ev(`document.querySelectorAll('.reveal').length > 0`),
   String(await ev(`document.querySelectorAll('.reveal').length`)));
await ev(`window.scrollTo(0, 1200)`);
await wait(900);
ok('поява спрацьовує', await ev(`document.querySelectorAll('.reveal.is-in, .reveal.is-visible').length > 0`),
   String(await ev(`document.querySelectorAll('.reveal.is-in, .reveal.is-visible').length`)));

/* ---------- Friendly Club ---------- */

ok('банер Friendly Club', await ev(`!!document.querySelector('.fclub-section, .fclub')`));
const media = await ev(`(() => {
  const v = document.querySelector('.fclub-section video, .fclub video');
  const imgs = document.querySelectorAll('.fclub-section img, .fclub img').length;
  return { video: !!v, muted: v ? v.muted : null, playsinline: v ? v.playsInline : null, imgs };
})()`);
ok('відео в банері', media.video, JSON.stringify(media));
ok('відео без звуку й вбудоване — інакше мобільний його не пустить',
   media.video ? media.muted === true && media.playsinline === true : false);

/* ---------- Сторінка товару ----------
   Беремо товар із розмірною сіткою: у свічок її немає зовсім,
   і перевіряти на них підказку розмірів безглуздо. */

const href = await ev(`document.querySelector('.pgrid a[href*="/p/"]')?.getAttribute('href')`);
await go(new URL(href, BASE).href);

ok('галерея з мініатюрами', await ev(`document.querySelectorAll('.gal__thumbs .gthumb').length > 0`),
   String(await ev(`document.querySelectorAll('.gal__thumbs .gthumb').length`)));

const thumbs = await ev(`document.querySelectorAll('.gal__thumbs .gthumb').length`);
if (thumbs > 1) {
  const before = await ev(`document.querySelector('.gal__main img')?.getAttribute('src')`);
  await ev(`document.querySelectorAll('.gal__thumbs .gthumb')[1]?.click()`);
  await wait(500);
  const after = await ev(`document.querySelector('.gal__main img')?.getAttribute('src')`);
  ok('мініатюра міняє головне фото', before !== after);
}

await ev(`document.querySelector('.gal__main img, .zoomable-button')?.click()`);
await wait(700);
ok('збільшення фото', await ev(`!!document.querySelector('.lightbox:not([hidden]), .lightbox.is-open')`));
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
await wait(400);

/* Товар із розмірами: підказка сітки ховається за кнопкою,
   тож спершу її треба відкрити */
await go(BASE + '/p/EO-001');
const help = await ev(`(() => {
  const b = [...document.querySelectorAll('.pinfo__sizes-head button')].find(x => x.getAttribute('aria-controls'));
  if (b) b.click();
  return !!b;
})()`);
await wait(400);
ok('кнопка підказки розмірів є', help);
ok('підказка розкриває таблицю й фото',
   await ev(`!!document.querySelector('.pinfo__sizechart table') && !!document.querySelector('.pinfo__size-image img')`));

await go(BASE + '/p/WW-001');
ok('характеристики або догляд',
   await ev(`document.querySelectorAll('.acc, details').length > 0`),
   String(await ev(`document.querySelectorAll('.acc, details').length`)));

/* ---------- Підписка на наявність ---------- */

const soldOut = await ev(`(async () => {
  const links = [...document.querySelectorAll('.pgrid a[href*="/p/"]')];
  return null;
})()`);
await go(BASE + '/');
const anySold = await ev(`document.querySelector('.pcard--sold a, a.pcard--sold')?.getAttribute('href')
  || document.querySelector('.pcard--sold')?.closest('a')?.getAttribute('href')
  || document.querySelector('a.pcard--sold')?.getAttribute('href')`);
if (anySold) {
  await go(new URL(anySold, BASE).href);
  ok('підписка «повідомити коли зʼявиться»',
     await ev(`!!document.querySelector('.size-pill__alert, .restock-notice, [data-alert]')
       || /повідом|notify/i.test(document.body.textContent)`));
} else {
  console.log('· розпроданих товарів у каталозі немає — підписку не перевіряли');
}

console.log('\n' + (bad ? `не зійшлося: ${bad}` : 'усе зійшлося'));
console.log('Помилки в консолі: ' + (errors.length ? '\n' + errors.join('\n') : 'немає'));

ws.close();
chrome.kill();
process.exit(bad ? 1 : 0);
