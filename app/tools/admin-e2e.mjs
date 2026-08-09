/* Прогін адмінки в справжньому Chrome.

   Головне, що тут перевіряється: адмінка НЕ віддає нічого тому,
   хто не увійшов. Ні розмітки каталогу, ні даних у розмітці
   сервера — інакше чернетку можна було б прочитати, просто
   відкривши сторінку.

   node tools/admin-e2e.mjs http://localhost:3000
*/
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

const PROFILE = '/tmp/reyter-test-' + process.pid + '-' + Date.now();
const BASE = process.argv[2] || 'http://localhost:3000';

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
  await wait(1500); // гідратація + перша відповідь Firebase
};

/* ---------- Гейт ---------- */

await go(BASE + '/admin');
ok('адмінка відкривається', await ev('!!document.querySelector(".a-gate-screen")'));
ok(
  'гостю показано вхід, а не каталог',
  (await ev('!!document.querySelector(".a-gate-screen")')) &&
    !(await ev('!!document.querySelector(".admin-wrap")'))
);
ok('є кнопка входу', await ev(`!!document.body.textContent.includes('Увійти через Google')`));

/* Найважливіше: у розмітці, яку віддає сервер, не має бути
   нічого з чернетки — ні товарів, ні категорій */
const html = await (await fetch(BASE + '/admin')).text();
ok('сервер не віддає вміст каталогу', !/catalog_products|a-item__name|productList/.test(html));
ok('адмінка закрита від пошуковиків', /noindex/.test(html), (html.match(/noindex[^"]*/) || [''])[0]);

/* Кожен розділ так само закритий: гість не має побачити ні
   замовлень, ні залишків, ні промокодів */
for (const path of ['/admin/orders', '/admin/stock', '/admin/promos']) {
  await go(BASE + path);
  ok(`${path} — гостю показано вхід`,
     (await ev('!!document.querySelector(".a-gate-screen")')) &&
       !(await ev('!!document.querySelector(".ao-card, .ao-stockrow, .a-promo")')));

  const body = await (await fetch(BASE + path)).text();
  ok(`${path} — сервер не віддає даних`,
     !/ao-card|ao-stockrow|a-promo__code|"orders"/.test(body));
}

await go(BASE + '/admin');

/* ---------- Стилі адмінки підключені ---------- */

ok(
  'стилі адмінки підвантажені',
  await ev(`[...document.styleSheets].some(s => {
    try { return [...s.cssRules].some(r => (r.selectorText || '').includes('.a-gate-screen')); }
    catch { return false; }
  })`)
);

/* ---------- Магазин лишився цілим ---------- */

await go(BASE + '/');
ok('каталог покупця працює', await ev('!!document.querySelector(".pgrid .pcard")'));
ok('шапка магазину на місці', await ev('!!document.querySelector(".site-header")'));
ok('адмінської шапки в магазині немає', !(await ev('!!document.querySelector(".abar")')));

await go(BASE + '/account');
ok('кабінет працює', await ev('!!document.querySelector(".account-page")'));

console.log('\n' + (bad ? `не зійшлося: ${bad}` : 'усе зійшлося'));
console.log('Помилки в консолі: ' + (errors.length ? '\n' + errors.join('\n') : 'немає'));

ws.close();
chrome.kill();
process.exit(bad ? 1 : 0);
