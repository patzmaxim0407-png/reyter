/* ============================================================
   Розбіжність розмітки (гідратація)
   ------------------------------------------------------------
   Сервер малює сторінку, не бачачи ні кошика, ні збережених
   замовлень — вони лежать у сховищі браузера. Якщо компонент
   читає це сховище просто під час малювання, перший кадр у
   браузері виходить іншим, ніж прийшов із сервера, і React
   перемальовує все дерево заново: сторінка блимає, а в консолі
   лежить помилка, якої на сервері не видно.

   Саме так сталося 14.08.2026 з панеллю «замовлення чекає на
   оплату». Тому перевіряємо всі три сторінки, які читають
   сховище.

   node tools/hydra-e2e.mjs [адреса]
   ============================================================ */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

const PROFILE = '/tmp/reyter-hydra-' + process.pid;
const BASE = process.argv[2] || 'http://localhost:3000';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + PROFILE, '--no-first-run', 'about:blank']);
await wait(2500);
const port = readFileSync(PROFILE + '/DevToolsActivePort', 'utf8').split(/\r?\n/)[0].trim();
const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let id = 0; let bad = 0; const pending = new Map(); const said = [];
ws.addEventListener('message', (raw) => {
  const m = JSON.parse(raw.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
    const text = m.method === 'Runtime.exceptionThrown'
      ? (m.params.exceptionDetails.exception?.description || '')
      : (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (/hydrat|#418|#419|#423|did not match/i.test(text)) said.push(text.slice(0, 700));
  }
});
const send = (method, params = {}) => new Promise((r) => { const my = ++id; pending.set(my, r); ws.send(JSON.stringify({ id: my, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }))?.result?.result?.value;

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

for (const [name, path, prep] of [
  ['порожній кошик', '/checkout', `localStorage.setItem('reyter:orders', JSON.stringify([{num:'R-TEST-1',items:[{id:'SW-002',size:'M',qty:1}],total:880,customer:{email:'a@b.c'}}])); localStorage.removeItem('reyter:cart')`],
  ['кабінет', '/account?tab=orders', ''],
  ['подяка', '/thanks?num=R-TEST-1', '']
]) {
  said.length = 0;
  await send('Page.navigate', { url: BASE + '/' });
  await wait(2500);
  if (prep) await ev(prep);
  await send('Page.navigate', { url: BASE + path });
  await wait(5000);
  console.log((said.length ? '✗ ' : '✓ ') + name + (said.length ? '\n   ' + said[0].split('\n')[0] : ''));
  if (said.length) { bad += 1; console.log('   ' + (said[0].split('\n').slice(1, 5).join('\n   '))); }
}

console.log(bad ? '\nрозбіжностей: ' + bad : '\nусе зійшлося');
ws.close(); chrome.kill('SIGKILL');
process.exit(bad ? 1 : 0);
