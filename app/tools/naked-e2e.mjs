/* Гола сторінка: що буде, коли файл стилів не доїде.

   Після викладки браузер може тримати сторінку попередньої
   збірки, а вона просить файл, якого вже немає. Усі правила сайту
   живуть в одному файлі, тож одна невдача роздягає сторінку
   повністю — Times із засічками, сині підкреслені посилання,
   картинки в натуральний зріст. Саме це й побачив власник.

   Тут перевіряється троє: запасний шар стилів тримає сторінку
   читабельною; сторож помічає голизну й перечитує сторінку сам;
   і — не менш важливе — при обірваній мережі він НЕ смикає
   сторінку, бо перечитування тоді нічого не дасть.

   node tools/naked-e2e.mjs http://localhost:3400
*/
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

const BASE = (process.argv[2] || 'http://localhost:3400').replace(/\/+$/, '');

let failed = 0;
const ok = (cond, title, mode) => {
  if (!cond) failed += 1;
  console.log((cond ? '✓' : '✗') + ' ' + title + (mode ? ' — ' + mode : ''));
};

async function browser() {
  const PROFILE = '/tmp/reyter-naked-' + process.pid + '-' + Date.now();
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
  const listeners = [];
  ws.addEventListener('message', (raw) => {
    const m = JSON.parse(raw.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) {
      for (const f of listeners) f(m);
    }
  });
  const send = (method, params = {}) => {
    const my = ++id;
    ws.send(JSON.stringify({ id: my, method, params }));
    return new Promise((r) => pending.set(my, r));
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value;
  };
  const on = (f) => listeners.push(f);
  const stop = () => {
    ws.close();
    chrome.kill('SIGKILL');
  };
  return { send, ev, on, stop: stop };
}

/** Стан сторінки: скільки правил приїхало і як вона виглядає. */
const PROBE = `(() => {
  const link = [...document.querySelectorAll('link[rel="stylesheet"]')].find(l => l.href.includes('/_next/static/'));
  const sheet = link && [...document.styleSheets].find(s => s.href === link.href);
  let rules = -1;
  try { rules = sheet ? sheet.cssRules.length : 0 } catch { rules = -2 }
  const a = document.querySelector('a');
  const img = [...document.images].sort((x,y) => y.clientHeight - x.clientHeight)[0];
  return {
    rules,
    bg: getComputedStyle(document.body).backgroundColor,
    font: getComputedStyle(document.body).fontFamily.slice(0, 22),
    linkColor: a ? getComputedStyle(a).color : '',
    underline: a ? getComputedStyle(a).textDecorationLine : '',
    tallest: img ? img.clientHeight : 0,
    navs: performance.getEntriesByType('navigation').length,
    mark: (() => { try { return sessionStorage.getItem('reyter:chunk-reload') } catch { return null } })(),
    url: location.pathname + location.search
  };
})()`;

/* ---------- 1. Файл стилів зник: сторінка має встати сама ---------- */
{
  const b = await browser();
  await b.send('Page.enable');
  await b.send('Runtime.enable');
  await b.send('Network.enable');
  await b.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/_next/static/*.css', requestStage: 'Request' }]
  });

  /* Вбиваємо стилі на перших ДВОХ запитах: перший — сам тег
     <link>, другий — перевірка сторожа, який питає сервер, чи
     файл справді зник. У житті зниклий файл віддає 404 обом; якщо
     вбити лише перший, сторож побачить, що файл на місці, і —
     правильно — нічого не робитиме.

     Далі пропускаємо: перечитування має дати нормальну сторінку. */
  let killed = 0;
  b.on(async (m) => {
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId } = m.params;
    if (killed < 2) {
      killed += 1;
      await b.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 404,
        responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from('<!DOCTYPE html><html><body>404</body></html>').toString('base64')
      });
      return;
    }
    await b.send('Fetch.continueRequest', { requestId });
  });

  await b.send('Page.navigate', { url: BASE });
  /* Міряємо рано: сторож помічає голизну вже за 800 мс, і якщо
     чекати довше — побачиш не хворобу, а видужання. */
  await wait(400);
  const naked = await b.ev(PROBE);

  ok(naked.rules === 0, 'стилі справді не приїхали', 'правил ' + naked.rules);
  ok(
    naked.bg === 'rgb(252, 248, 240)',
    'запасний шар тримає тло',
    naked.bg
  );
  ok(naked.underline === 'none', 'посилання не сині з підкресленням', naked.underline + ' ' + naked.linkColor);
  ok(naked.tallest < 2000, 'картинки не роздуваються на весь екран', naked.tallest + 'px');

  // сторож перечитує сторінку — чекаємо
  let alive = null;
  for (let i = 0; i < 40; i += 1) {
    await wait(400);
    alive = await b.ev(PROBE);
    if (alive && alive.rules > 0) break;
  }
  ok(alive?.rules > 0, 'сторінка сама вбралась після перечитування', 'правил ' + alive?.rules);
  ok(alive?.font?.startsWith('Inter'), 'шрифт повернувся', alive?.font);
  ok(/"n":1/.test(alive?.mark ?? ''), 'це саме сторож перечитав сторінку', alive?.mark ?? 'мітки немає');

  await wait(1500);
  const clean = await b.ev(PROBE);
  ok(!clean.url.includes('r='), 'мітка обходу кеша прибрана з адреси', clean.url);

  b.stop();
}

/* ---------- 2. Мережа лягла: сторінку смикати не можна ---------- */
{
  const b = await browser();
  await b.send('Page.enable');
  await b.send('Runtime.enable');
  await b.send('Network.enable');
  await b.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/_next/static/*.css', requestStage: 'Request' }]
  });

  // усі запити по стилях обриваємо, наче зникла мережа
  b.on(async (m) => {
    if (m.method !== 'Fetch.requestPaused') return;
    await b.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'ConnectionFailed' });
  });

  await b.send('Page.navigate', { url: BASE });
  await wait(6000);
  const parcelState = await b.ev(PROBE);
  ok(parcelState.rules <= 0, 'стилі не приїхали (як і задумано)', 'правил ' + parcelState.rules);
  ok(parcelState.navs === 1 && !parcelState.mark, 'сторінку не смикнуло при мертвій мережі', 'завантажень ' + parcelState.navs + ', мітка ' + parcelState.mark);
  ok(parcelState.bg === 'rgb(252, 248, 240)', 'і вона все одно читабельна', parcelState.bg);

  b.stop();
}


/* ---------- 3. Стилі просто повільні: сторінку не смикати ----------
   Найдорожча помилка сторожа з усіх можливих: перечитати цілком
   здорову сторінку лише тому, що браузер не встиг розібрати
   стилі. Для покупця це виглядає як самовільне перезавантаження
   при кожному відкритті картки товару. */
{
  const b = await browser();
  await b.send('Page.enable');
  await b.send('Runtime.enable');
  await b.send('Network.enable');
  await b.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/_next/static/*.css', requestStage: 'Request' }]
  });

  // стилі приходять, але з великою затримкою
  b.on(async (m) => {
    if (m.method !== 'Fetch.requestPaused') return;
    await wait(4000);
    await b.send('Fetch.continueRequest', { requestId: m.params.requestId });
  });

  await b.send('Page.navigate', { url: BASE });
  await wait(12000);
  const parcelState = await b.ev(PROBE);
  ok(parcelState.rules > 0, 'повільні стилі врешті приїхали', 'правил ' + parcelState.rules);
  ok(parcelState.navs === 1 && !parcelState.mark, 'і сторінку через це не перечитали',
     'завантажень ' + parcelState.navs + ', мітка ' + parcelState.mark);

  b.stop();
}

console.log(failed ? '\n✗ невдач: ' + failed : '\n✓ усе зійшлося');
process.exit(failed ? 1 : 0);
