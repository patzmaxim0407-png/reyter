/* Картка товару: відкриття, прокрутка, закриття.

   Найпомітніша поломка тут не в даних, а в поведінці: якщо
   сторінка під карткою стрибає на початок, покупець після
   закриття шукає, де він був. Тому міряємо не «модалка є»,
   а де саме лишився каталог.

   node tools/modal-e2e.mjs http://localhost:3000/new
*/
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

const PROFILE = '/tmp/reyter-modal-' + process.pid + '-' + Date.now();
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

/* SLOW=1 — повільна мережа. Саме тут ламалось те, чого не видно
   на своїй машині: поки йде запит, сторінка встигає зрушити. */
if (process.env.SLOW) {
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', {
    offline: false, latency: 600, downloadThroughput: 400_000, uploadThroughput: 400_000
  });
}

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
  await wait(1400);
};

/* Скільки сторінка «проїхала»: під відкритою карткою body
   зафіксований, тож window.scrollY бреше. Питаємо натомість,
   де опинився перший заголовок каталогу. */
const anchorTop = () =>
  ev(`Math.round(document.querySelector('.category__title')?.getBoundingClientRect().top ?? NaN)`);

/* ---------- Відкриття з каталогу ---------- */

await go(BASE + '/');
await ev(`window.scrollTo(0, 1800)`);
await wait(700);

await ev(`window.__firstImg = document.querySelector('.pgrid .pcard__media img')`);
const beforeY = await ev(`Math.round(window.scrollY)`);
let beforeTop = await anchorTop();
ok('каталог прокручено', beforeY > 800, 'y=' + beforeY);

/* Беремо товар із родиною кольорів: на першій-ліпшій картці
   ані зразків, ані розпроданих розмірів може не бути. */
const cardHref = await ev(`(() => {
  const links = [...document.querySelectorAll('.pgrid a[href*="/p/"]')];
  const family = links.find((a) => a.getAttribute('href').includes('WW-001'));
  return (family || links[0]).getAttribute('href');
})()`);
await ev(
  `document.querySelector('.pgrid a[href="' + ${JSON.stringify(cardHref)} + '"]').click()`
);
await wait(1500);

ok('картка відкрилась', await ev(`!!document.querySelector('.pmodal.is-open')`));

/* Каталог має лишитись тим самим — не перемальованим. Перевіряємо
   по самому вузлу <img>: якщо сторінка перемалювалась, картинки
   створюються заново й на очах блимають. */
ok('каталог не перемалювався', await ev(`window.__firstImg === document.querySelector('.pgrid .pcard__media img')`));
ok('адреса стала адресою товару', (await ev(`location.pathname`)).includes('/p/'),
   await ev(`location.pathname`));
ok('сторінку не перезавантажило',
   await ev(`performance.getEntriesByType('navigation').length === 1
     && !!document.querySelector('.pmodal')`));

const openTop = await anchorTop();
ok('каталог під карткою лишився на місці', Math.abs(openTop - beforeTop) <= 4,
   `було ${beforeTop}, стало ${openTop}`);
ok('фон зафіксовано, а не просто прихована прокрутка',
   await ev(`document.body.classList.contains('no-scroll')`));

/* ---------- Вміст картки ---------- */

ok('назва товару', await ev(`!!document.querySelector('#pmName')?.textContent.trim()`));
ok('галерея', await ev(`!!document.querySelector('.pmodal__gallery .gal__main img')`));
ok('ціна', await ev(`!!document.querySelector('.pinfo__price .price__now')`));
ok('кнопка «в кошик» з іконками',
   await ev(`!!document.querySelector('.btn--order .ico-cart') && !!document.querySelector('.btn--order .ico-check')`));
ok('примітки', await ev(`document.querySelectorAll('.pinfo__notes .note-card').length === 3`));

const outPill = await ev(`(() => {
  const b = document.querySelector('.size-pill__alert');
  if (!b) return null;
  const s = getComputedStyle(b);
  return { w: Math.round(b.getBoundingClientRect().width), border: s.borderStyle, line: s.textDecorationLine };
})()`);
if (outPill) {
  ok('розпроданий розмір виглядає як пілюля', outPill.w >= 52 && outPill.border !== 'none',
     JSON.stringify(outPill));
  ok('розпроданий розмір перекреслений', outPill.line.includes('line-through'), outPill.line);
} else {
  console.log('· розпроданих розмірів у цьому товарі немає');
}

/* ---------- Розміри ----------
   Пілюлі мають бути однакові. Дві причини робили їх різними:
   розпроданий розмір — це кнопка, яку флекс розтягував на висоту
   рядка, а в пілюлі «закінчується» крапка ставала другим рядком
   сітки. Обрана пілюля трохи більша навмисно — так було завжди. */

const pills = await ev(`(() => {
  const items = [...document.querySelectorAll('.sizes > *')];
  if (!items.length) return null;
  const boxes = items.map((el) => {
    const inner = el.tagName === 'SPAN' ? el.querySelector('label') : el;
    const r = inner.getBoundingClientRect();
    return { text: inner.textContent.trim(), h: Math.round(r.height), picked: !!el.querySelector('input:checked') };
  });
  const plain = boxes.filter((b) => !b.picked).map((b) => b.h);
  return { boxes, spread: Math.max(...plain) - Math.min(...plain) };
})()`);
if (pills) {
  ok('пілюлі розмірів однакової висоти', pills.spread === 0,
     pills.boxes.map((b) => b.text + ':' + b.h).join(' '));
} else {
  console.log('· у цього товару немає розмірної сітки');
}

/* ---------- Стягування мишею ----------
   Картка стала шторкою й на компʼютері, смужку на ній видно —
   отже, за неї мають тягнути. Дотиком це працювало давно, мишею
   не працювало зовсім. */

await go(BASE + '/p/WW-001');
const bar = await ev(`(() => {
  const e = document.querySelector('.pmodal__handle');
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
    cursor: getComputedStyle(e).cursor };
})()`);
if (bar) {
  ok('курсор каже, що смужку можна тягнути', bar.cursor === 'grab', bar.cursor);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bar.x, y: bar.y, button: 'left', clickCount: 1 });
  for (const dy of [40, 100, 170]) {
    await wait(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bar.x, y: bar.y + dy, button: 'left' });
  }
  const moving = await ev(`getComputedStyle(document.querySelector('.pmodal__panel')).transform`);
  ok('панель їде за курсором', /matrix\(1, 0, 0, 1, 0, 1\d\d/.test(moving), moving);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bar.x, y: bar.y + 170, button: 'left', clickCount: 1 });
  await wait(1800);
  ok('після стягування картка закрилась', !(await ev(`!!document.querySelector('.pmodal')`)),
     await ev('location.pathname'));
}
await go(BASE + '/');

/* ---------- Значок наявності ----------
   Він показує не «чи є товар взагалі», а чи є ОБРАНИЙ розмір:
   обрав той, якого лишилось мало — значок став «Закінчується».
   Так було на попередньому сайті. */

await go(BASE + '/p/SWBK-001');
const chip = () =>
  ev(`(() => {
    const s = document.querySelector('.status-chip');
    return s ? s.className + '|' + s.textContent : '';
  })()`);

ok('значок є', (await chip()).includes('status-chip'));
ok('нема рядка «залишилось мало» під кнопкою',
   !(await ev(`[...document.querySelectorAll('.pinfo__sale-note')].some((x) => /алишилось мало/.test(x.textContent))`)));

const plain = await ev(`(() => {
  const el = [...document.querySelectorAll('.sizes .size-pill:not(.size-pill--low) input')][0];
  if (!el) return '';
  el.click();
  return el.value;
})()`);
if (plain) {
  await wait(400);
  ok('на звичайному розмірі — «В наявності»', (await chip()).includes('--ok'), await chip());
}

const few = await ev(`(() => {
  const el = document.querySelector('.sizes .size-pill--low input');
  if (!el) return '';
  el.click();
  return el.value;
})()`);
if (few) {
  await wait(400);
  ok('на розмірі, якого мало — «Закінчується»', (await chip()).includes('--low'), await chip());
} else {
  console.log('· у цього товару немає розміру, якого мало');
}

await go(BASE + '/p/SW-003');
ok('у розпроданого товару — «Продано»', (await chip()).includes('--no'), await chip());

/* Перевірка значка водила нас окремими сторінками, тож повертаємо
   те, з чого починали: прокручений каталог і відкриту поверх нього
   картку товару з родиною кольорів. Далі йдуть саме ті перевірки,
   яким потрібен каталог ПІД карткою. */
await go(BASE + '/');
await ev(`window.scrollTo(0, 1800)`);
await wait(700);
await ev(`window.__firstImg = document.querySelector('.pgrid .pcard__media img')`);
beforeTop = await anchorTop();
await ev(
  `document.querySelector('.pgrid a[href="' + ${JSON.stringify(cardHref)} + '"]').click()`
);
await wait(1500);
ok('картка знову open — є що перевіряти далі', await ev(`!!document.querySelector('.pmodal.is-open')`));

/* ---------- Кольори ----------
   Зразок має бути кружком 38 px, а не крапкою: колись він був
   вкладений у посилання й через це стискався до нуля. */

const swatches = await ev(`(() => {
  const list = [...document.querySelectorAll('.swatches .swatch')];
  if (!list.length) return null;
  const box = list[0].getBoundingClientRect();
  return {
    n: list.length,
    w: Math.round(box.width),
    active: document.querySelectorAll('.swatch.is-active').length,
    links: document.querySelectorAll('a.swatch').length
  };
})()`);
if (swatches) {
  ok('зразки кольору повного розміру', swatches.w >= 34, JSON.stringify(swatches));
  ok('поточний колір позначено рівно один раз', swatches.active === 1, JSON.stringify(swatches));
  ok('решта кольорів — посилання', swatches.links === swatches.n - 1, JSON.stringify(swatches));

  /* Перехід між кольорами міняє адресу, але не має ані закривати
     картку, ані зрушувати каталог під нею. І не має програвати
     появу заново: для покупця це одна картка, у якій змінився
     вміст, а не «закрилась і відкрилась інша». */
  const wasName = await ev(`document.querySelector('#pmName').textContent`);
  await ev(`document.querySelector('a.swatch').click()`);
  await wait(1500);
  ok('зміна кольору не програє появу заново',
     (await ev(`getComputedStyle(document.querySelector('.pmodal__panel')).opacity`)) === '1');
  ok('картка при зміні кольору лишається одна',
     (await ev(`document.querySelectorAll('.pmodal').length`)) === 1);
  ok('колір перемкнувся', (await ev(`document.querySelector('#pmName')?.textContent`)) !== wasName,
     await ev(`document.querySelector('#pmName')?.textContent`));
  ok('картка лишилась відкритою', await ev(`!!document.querySelector('.pmodal.is-open')`));
  ok('каталог не зрушив і при зміні кольору', Math.abs((await anchorTop()) - beforeTop) <= 4,
     `було ${beforeTop}, стало ${await anchorTop()}`);
  ok('блокування не загубилось', await ev(`document.body.classList.contains('no-scroll')`));
} else {
  console.log('· у цього товару немає інших кольорів');
}

/* ---------- Закриття ---------- */

ok('перед закриттям картка на місці', await ev(`!!document.querySelector('.pmodal__close')`));
await ev(`document.querySelector('.pmodal__close')?.click()`);
await wait(1600);

ok('картка закрилась', await ev(`!document.querySelector('.pmodal')`));
ok('після закриття каталог теж не перемалювався',
   await ev(`window.__firstImg === document.querySelector('.pgrid .pcard__media img')`));
const home = new URL(BASE).pathname.replace(/\/$/, '') || '/';
ok('повернулись у каталог', (await ev(`location.pathname`)).replace(/\/$/, '') === home,
   await ev(`location.pathname`));
const afterY = await ev(`Math.round(window.scrollY)`);
ok('каталог відкрився там само, де його лишили', Math.abs(afterY - beforeY) <= 40,
   `було ${beforeY}, стало ${afterY}`);
ok('прокрутку розблоковано', await ev(`!document.body.classList.contains('no-scroll') && !document.body.style.top`));

/* ---------- Пряме посилання ---------- */

await go(new URL(cardHref, BASE).href);
ok('за прямим посиланням картка теж open', await ev(`!!document.querySelector('.pmodal.is-open')`));
await ev(`document.querySelector('.pmodal__close').click()`);
await wait(1600);
ok('закриття прямого посилання веде на головну, а не з сайту',
   (await ev(`location.pathname`)).replace(/\/$/, '') === home, await ev(`location.href`));

/* Прямий вхід і одразу зміна кольору: заміщення кроку не має
   рахуватись за перехід, інакше «закрити» вивело б із сайту */
await go(new URL(cardHref, BASE).href);
if (await ev(`!!document.querySelector('a.swatch')`)) {
  await ev(`document.querySelector('a.swatch').click()`);
  await wait(1500);
  await ev(`document.querySelector('.pmodal__close').click()`);
  await wait(1600);
  ok('прямий вхід зі зміною кольору теж веде на головну',
     (await ev(`location.pathname`)).replace(/\/$/, '') === home, await ev(`location.href`));
}

/* ---------- Найгірший шлях ----------
   Відкрити картку → розгорнути фото на весь екран → закрити.
   Саме після цього на сторінці лишалась невидима модалка: вона
   на весь екран і глушила будь-яке натискання, а сторінка
   лишалась замкненою. */

await go(BASE + '/');
await ev(`document.querySelector('.pgrid a[href*="/p/"]').click()`);
await wait(1500);
await ev(`document.querySelector('.gal__image-button')?.click()`);
await wait(800);
ok('фото розгортається на весь екран', await ev(`!!document.querySelector('.lightbox.is-open')`));

await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
await wait(700);
ok('перший Escape закриває лише фото',
   (await ev(`!document.querySelector('.lightbox.is-open')`)) &&
   (await ev(`!!document.querySelector('.pmodal.is-open')`)));

await ev(`document.querySelector('.pmodal__close').click()`);
await wait(1800);
ok('після закриття модалки в розмітці не лишилось',
   await ev(`!document.querySelector('.pmodal')`));
ok('після закриття сторінка приймає натискання', await ev(`(() => {
  const a = document.querySelector('.pgrid a[href*="/p/"]');
  a.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = a.getBoundingClientRect();
  const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  return !!(at && at.closest('a.pcard'));
})()`));

/* ---------- Повторне натискання ----------
   Натискання на товар, який уже відкритий, не має нічого ламати.
   Перехід на ту саму адресу спорожняв main: каталог зникав зовсім,
   а на телефоні до картки каталогу можна дотягнутись і при
   відкритій шторці. */

await go(BASE + '/');
await ev(`document.querySelector('.pgrid a[href*="/p/"]').click()`);
await wait(1800);
await ev(`document.querySelector('.pgrid a[href*="/p/"]').click()`);
await wait(2000);
const again = await ev(`({
  cards: document.querySelectorAll('.pgrid .pcard').length,
  open: !!document.querySelector('.pmodal.is-open')
})`);
ok('повторне натискання на відкритий товар нічого не ламає',
   again.cards > 0 && again.open, JSON.stringify(again));

await ev(`(() => {
  const a = [...document.querySelectorAll('.pgrid a[href*="/p/"]')]
    .find((x) => x.getAttribute('href') !== location.pathname);
  a?.click();
})()`);
await wait(2000);
const other = await ev(`({
  cards: document.querySelectorAll('.pgrid .pcard').length,
  open: !!document.querySelector('.pmodal.is-open')
})`);
ok('перехід на інший товар при відкритій картці теж',
   other.cards > 0 && other.open, JSON.stringify(other));
await ev(`document.querySelector('.pmodal__close')?.click()`);
await wait(1800);

/* ---------- Поява ----------
   Картка має виїжджати, а не зʼявлятися ривком. Вузол, вставлений
   одразу з класом is-open, переходити не має від чого. */

await go(BASE + '/');
const onMove = await ev(`(async () => {
  const frames = [];
  const t0 = performance.now();
  const tick = () => {
    const p = document.querySelector('.pmodal__panel');
    if (p) frames.push(getComputedStyle(p).opacity);
    if (performance.now() - t0 < 600) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  document.querySelector('.pgrid a[href*="/p/"]').click();
  await new Promise((r) => setTimeout(r, 800));
  return { first: frames[0] ?? '', shades: new Set(frames).size };
})()`);
ok('картка виїжджає, а не зʼявляється ривком', onMove.shades > 3, JSON.stringify(onMove));

/* ---------- Фото на весь екран ----------
   Натискання повз знімок закриває перегляд, по знімку — збільшує. */

await ev(`document.querySelector('.gal__image-button')?.click()`);
await wait(800);
await ev(`document.querySelector('.lightbox__stage img')?.click()`);
await wait(500);
ok('натискання по знімку збільшує', await ev(`!!document.querySelector('.lightbox__stage img.is-zoomed')`));
ok('перегляд при цьому не закрився', await ev(`!!document.querySelector('.lightbox.is-open')`));
await ev(`document.querySelector('.lightbox__stage')?.click()`);
await wait(700);
ok('натискання повз знімок закриває перегляд', !(await ev(`!!document.querySelector('.lightbox')`)));
ok('картка товару лишилась відкритою', await ev(`!!document.querySelector('.pmodal.is-open')`));
await ev(`document.querySelector('.pmodal__close')?.click()`);
await wait(1800);

/* ---------- Дотик ----------
   На картці наведення показує друге фото. На телефоні «наведення»
   це перший тап — і картка відкривалася лише з другого разу. */

const hoverSwap = await ev(`(() => {
  const rules = [...document.styleSheets].flatMap((sheet) => {
    try { return [...sheet.cssRules]; } catch { return []; }
  });
  return rules.some((r) => r.conditionText === '(hover: none)' || r.media?.mediaText === '(hover: none)');
})()`);
ok('на дотикових екранах наведення вимкнено', hoverSwap);

console.log('\n' + (bad ? `не зійшлося: ${bad}` : 'усе зійшлося'));
console.log('Помилки в консолі: ' + (errors.length ? '\n' + errors.join('\n') : 'немає'));

ws.close();
chrome.kill();
process.exit(bad ? 1 : 0);
