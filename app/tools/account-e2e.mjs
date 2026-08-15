/* Прогін кабінету й відстеження в справжньому Chrome:
   вкладки, вхід, адресна книга, історія замовлень, пошук за номером.

   node tools/account-e2e.mjs http://localhost:3000
*/
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

/* Свій профіль і свій порт на кожен прогін: інакше скрипт
   під'єднується до Chrome попереднього запуску — з його даними
   в localStorage, і тести «падають» на чужому стані. */
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
/* У headless вікно не активне, і події фокуса не летять узагалі */
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
  await wait(1200); // гідратація + перший відгук Firebase
};

/* ---------- Кабінет гостя ---------- */

await go(BASE + '/account');
ok('кабінет відкривається', await ev('!!document.querySelector(".account")'));

const tabs = await ev(`[...document.querySelectorAll('.account__tab')].map(x => x.querySelector('.account__tab-label').textContent)`);
ok('чотири вкладки', tabs.length === 4, tabs.join(' | '));
ok('Friendly Club — остання, після замовлень', tabs[3] === 'Friendly Club', tabs[3]);

ok('гостю показано вхід', await ev('!!document.querySelector(".auth-google")'));
ok('є вхід поштою', await ev('!!document.getElementById("auEmail") && !!document.getElementById("auPass")'));

/* Порожня форма входу лається, а не мовчить */
await ev(`document.querySelector('.form-grid button[type=submit]').click()`);
await wait(400);
ok('порожній вхід дає повідомлення', await ev('!!document.querySelector(".toast")'),
   await ev('document.querySelector(".toast")?.textContent || ""'));

/* ---------- Вкладка замовлень ---------- */

await go(BASE + '/account?tab=orders');
ok('вкладка замовлень активна',
   (await ev(`document.querySelector('.account__tab[aria-selected=true] .account__tab-label')?.textContent`)) === tabs[2],
   await ev(`document.querySelector('.account__tab[aria-selected=true] .account__tab-label')?.textContent`));
ok('гостю дано форму відстеження', await ev('!!document.getElementById("trkNum")'));
ok('гостю дано вхід поруч', await ev('!!document.querySelector(".auth-google")'));

/* ---------- Локальна історія ---------- */

await ev(`localStorage.setItem('reyter:orders', JSON.stringify([{
  num: 'R-260808-799', date: '2026-08-08T10:00:00.000Z', total: 1250, status: 'new',
  message: 'текст замовлення',
  items: [{ id: 'CME-003', name: 'Комплект menthol', category: 'Комплекти', size: null, qty: 3, price: 1250,
            parts: [{ id: 'ME-001', name: 'Menthol', category: 'Сліпи', size: 'S' },
                    { id: 'MME-002', name: 'Майка menthol', category: 'Майки', size: 'S' }] }]
}]))`);

/* Гість бачить свою локальну історію, а нижче — вхід і пошук
   за номером: у хмарі можуть лежати замовлення з інших пристроїв */
await go(BASE + '/account?tab=orders');
await wait(1500);
const local = await ev(`(() => ({
  cards: document.querySelectorAll('.order-card').length,
  num: document.querySelector('.order-card__num')?.textContent || '',
  parts: document.querySelector('.order-card__parts')?.textContent || '',
  total: document.querySelector('.order-card__total')?.textContent || '',
  tracker: !!document.querySelector('.tracker')
}))()`);
/* Гостю локальну історію НЕ показуємо — і це навмисно.

   Раніше показували: людина, яка щойно оформила замовлення без
   акаунта, інакше бачила б форму входу замість власної покупки.
   15.08.2026 правило змінили на протилежне, і причина вагоміша:
   локальна історія не є підтвердженням особи. На спільному
   комп'ютері вона могла належати іншому, і кабінет показував би
   чуже ім'я, товари й суму кожному, хто його відкриє.

   Замість неї гість отримує пошук за номером і телефоном — те,
   що знає лише власник замовлення.

   САМ ПОВТОР ЗАМОВЛЕННЯ тут більше не перевіряється: без входу
   картки немає, а увійти в прогоні нема як. Логіка повтору
   покрита модульно в tools/account-check.ts — і склад комплекту,
   і кількість, і зниклий товар. */
ok('локальна історія гостю не показується', local.cards === 0, JSON.stringify(local));
ok('замість неї — пошук за номером і вхід',
   await ev('!!document.querySelector(".auth-google") && !!document.getElementById("trkNum")'));
ok('чужа сума на спільному пристрої не світиться', !/1\s250/u.test(local.total), local.total);

/* ---------- Відстеження ---------- */

await go(BASE + '/track');
ok('сторінка відстеження є', await ev('!!document.getElementById("trkNum")'));

const setVal = (elId, val) => `(() => {
  const el = document.getElementById('${elId}');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`;

/* Порожній номер */
await ev(`document.querySelector('#trkNum').closest('form').requestSubmit()`);
await wait(800);
ok('без номера — підказка', /номер|number/i.test(await ev(`document.querySelector('.account-note--warn')?.textContent || ''`)),
   await ev(`document.querySelector('.account-note--warn')?.textContent || ''`));

/* Номер є, телефон закороткий */
await ev(setVal('trkNum', 'R-260808-799'));
await ev(setVal('trkPhone', '123'));
await ev(`document.querySelector('#trkNum').closest('form').requestSubmit()`);
await wait(900);
ok('закороткий телефон — підказка',
   !!(await ev(`document.querySelector('.account-note--warn')?.textContent`)),
   await ev(`document.querySelector('.account-note--warn')?.textContent || ''`));

/* Повний, але вигаданий — має бути «не знайдено», а не помилка */
await ev(setVal('trkPhone', '+380971112233'));
await ev(`document.querySelector('#trkNum').closest('form').requestSubmit()`);
await wait(2500);
const notFound = await ev(`document.querySelector('.account-note--warn')?.textContent || ''`);
ok('вигаданий номер — «не знайдено»', !!notFound && !/Помилка|Error/i.test(notFound), notFound);

/* ---------- Профіль і адресна книга ---------- */

await go(BASE + '/account');
/* Без входу профіль ховається за формою — перевіряємо локальний
   режим, підмінивши стан на «Firebase недоступний» неможливо,
   тож перевіряємо саме те, що доступне гостю. */
ok('форма входу лишається на профілі', await ev('!!document.querySelector(".auth-google")'));

console.log('\n' + (bad ? `не зійшлося: ${bad}` : 'усе зійшлося'));
console.log('Помилки в консолі: ' + (errors.length ? '\n' + errors.join('\n') : 'немає'));

ws.close();
chrome.kill();
process.exit(bad ? 1 : 0);
