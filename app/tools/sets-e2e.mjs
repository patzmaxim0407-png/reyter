/* Комплект: сітка розмірів на кожен складник, ключ позиції, кошик */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

/* Свій профіль і свій порт на кожен прогін: інакше скрипт
   під'єднується до Chrome попереднього запуску — з його кошиком
   у localStorage, і тести «падають» на чужих даних. */
const PROFILE = '/tmp/reyter-test-' + process.pid + '-' + Date.now();
const BASE = process.argv[2] || 'http://localhost:3000';
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--remote-debugging-port=0','--user-data-dir=' + PROFILE,'--no-first-run','about:blank']);
await wait(2500);
const port = readFileSync(PROFILE + '/DevToolsActivePort', 'utf8').split(/\r?\n/)[0].trim();
const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id=0; const pending=new Map();
ws.addEventListener('message', (raw) =>{const m=JSON.parse(raw.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
const send=(method,params={})=>{const my=++id;ws.send(JSON.stringify({id:my,method,params}));return new Promise(r=>pending.set(my,r));};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});
  if(r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setFocusEmulationEnabled',{enabled:true});
const errors=[];
ws.addEventListener('message', (raw) =>{const m=JSON.parse(raw.data);
  if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description||'exception');});
const ok=(n,c,e='')=>console.log(`${c?'✓':'✗'} ${n}${e?' — '+e:''}`);
const go=async u=>{await send('Page.navigate',{url:u});
  for(let i=0;i<60;i++){await wait(200); if(await ev('document.readyState==="complete"')) break;}
  await wait(900);};

await go(BASE+'/');
await ev(`localStorage.clear()`);
await go(BASE + '/p/CME-003');

const grid = await ev(`(() => ({
  parts: document.querySelectorAll('.setpart').length,
  heads: [...document.querySelectorAll('.setpart__head b')].map(x=>x.textContent),
  grids: [...document.querySelectorAll('.setpart .sizes')].map(g=>({
    total: g.querySelectorAll('.size-pill').length,
    free: g.querySelectorAll('.size-pill input:not([disabled])').length
  }))
}))()`);
ok('складники показані', grid.parts === 2, `${grid.parts}: ${grid.heads.join(' + ')}`);
ok('у кожного своя сітка', grid.grids.every(g=>g.total>0), JSON.stringify(grid.grids));

/* Як і на старому сайті, перший доступний розмір уже обрано —
   і це має бути саме перша пілюля в сітці, а не довільна */
const pre = await ev(`[...document.querySelectorAll('.setpart')].map(p => {
  const first = p.querySelector('.size-pill input:not([disabled])');
  const checked = p.querySelector('.size-pill input:checked');
  return { first: first?.value || '', checked: checked?.value || '' };
})`);
ok('обрано перший доступний розмір сітки',
   pre.every(x => x.first && x.first === x.checked),
   pre.map(x => `${x.first}→${x.checked}`).join(', '));

/* Обираємо інші розміри на кожен складник */
const picked = await ev(`(() => {
  const out = [];
  document.querySelectorAll('.setpart').forEach(p => {
    const free = [...p.querySelectorAll('.size-pill input:not([disabled])')];
    const pick = free[free.length - 1];   // навмисно НЕ перший
    if (pick) { pick.click(); out.push(pick.value); }
  });
  return out;
})()`);
await wait(400);
ok('розміри складників обираються', picked.length === 2, picked.join(' + '));

await ev(`document.querySelector('.btn--order').click()`);
await wait(700);
ok('комплект у кошику', (await ev(`document.querySelector('.cart-count')?.textContent`)) === '1');

/* Ключ позиції: інша комбінація розмірів — окрема позиція */
const raw = await ev(`localStorage.getItem('reyter:cart')`);
const line = JSON.parse(raw)[0];
ok('позиція зберігає склад', Array.isArray(line.parts) && line.parts.length === 2, JSON.stringify(line));
ok('у кошик лягли САМЕ обрані розміри',
   line.parts.map(x=>x.size).join(',') === picked.join(','),
   `обрано ${picked.join(',')} → збережено ${line.parts.map(x=>x.size).join(',')}`);

/* Панель кошика показує категорії складників */
await ev(`[...document.querySelectorAll('.hbtn')].at(-1).click()`);
await wait(500);
const parts = await ev(`[...document.querySelectorAll('.cart-item__parts li')].map(x=>x.textContent)`);
ok('у кошику видно склад із категоріями', parts.length === 2 && parts.every(p=>p.includes('·')), parts.join(' | '));

console.log('\nПомилки в консолі: ' + (errors.length ? errors.join('\n') : 'немає'));
ws.close(); chrome.kill(); process.exit(0);
