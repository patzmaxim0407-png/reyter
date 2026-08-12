/* Прогін кошика в справжньому Chrome через CDP:
   картка товару → додати → бейдж → панель → оформлення. */
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

/* Свій профіль і свій порт на кожен прогін: інакше скрипт
   під'єднується до Chrome попереднього запуску — з його кошиком
   у localStorage, і тести «падають» на чужих даних. */
const PROFILE = '/tmp/reyter-test-' + process.pid + '-' + Date.now();

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
/* Магазин може стояти не в корені (зараз це /new), тож усі
   очікування шляхів рахуються від нього, а не від '/'. */
const PREFIX = new URL(BASE).pathname.replace(/\/+$/, '');
const at = (path) => PREFIX + path;
const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=0',
  '--user-data-dir=' + PROFILE,
  '--no-first-run',
  'about:blank'
]);
await wait(2500);

const port = readFileSync(PROFILE + '/DevToolsActivePort', 'utf8').split(/\r?\n/)[0].trim();
const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
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
function send(method, params = {}) {
  const my = ++id;
  ws.send(JSON.stringify({ id: my, method, params }));
  return new Promise((r) => pending.set(my, r));
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function go(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) {
    await wait(200);
    const ready = await evalJs('document.readyState === "complete"');
    if (ready) break;
  }
  await wait(700); // гідратація
}

await send('Page.enable');
await send('Runtime.enable');
/* У headless вікно не активне, і події фокуса не летять узагалі —
   без цього поле відділення не відкрилося б навіть у справному коді */
await send('Emulation.setFocusEmulationEnabled', { enabled: true });

const errors = [];
ws.addEventListener('message', (raw) => {
  const m = JSON.parse(raw.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || 'exception');
  }
});

const out = [];
const ok = (name, cond, extra = '') => {
  const line = `${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`;
  out.push(line);
  console.log(line);
};

/* --- 1. Каталог: бейдж кошика порожній --- */
await go(BASE + '/');
ok('каталог відкривається', await evalJs('!!document.querySelector(".pgrid .pcard")'));
ok(
  'бейдж кошика схований на порожньому кошику',
  await evalJs('!!document.querySelector(".cart-count[hidden]")')
);

/* --- 2. Знаходимо комплект --- */
const setId = await evalJs(`(async () => {
  const r = await fetch('${BASE}/');
  return null;
})()`);

/* Беремо перший товар з каталогу */
const firstHref = await evalJs(
  'document.querySelector(".pgrid a[href*=\\"/p/\\"]")?.getAttribute("href")'
);
ok('картка веде на власну сторінку', !!firstHref, firstHref || '');

/* --- 3. Сторінка товару: додаємо в кошик --- */
await go(new URL(firstHref, BASE).href);
ok('є блок розмірів або кнопка', await evalJs('!!document.querySelector(".btn--order")'));

const sizeInfo = await evalJs(`(() => {
  const pills = [...document.querySelectorAll('.size-pill input:not([disabled])')];
  if (pills.length) pills[0].click();
  return { pills: pills.length, picked: pills[0]?.value || '' };
})()`);
await wait(200);
ok('розмір обирається', sizeInfo.pills > 0, `доступних: ${sizeInfo.pills}, обрано: ${sizeInfo.picked}`);

await evalJs('document.querySelector(".btn--order")?.click()');
await wait(600);

const badge = await evalJs(`(() => {
  const b = document.querySelector('.cart-count');
  return { text: b?.textContent, hidden: b?.hasAttribute('hidden') };
})()`);
ok('бейдж показує 1', badge.text === '1' && !badge.hidden, JSON.stringify(badge));

/* --- 4. Кошик переживає перезавантаження --- */
await go(BASE + '/');
const badge2 = await evalJs('document.querySelector(".cart-count")?.textContent');
ok('кошик переживає перезавантаження', badge2 === '1', `бейдж: ${badge2}`);

/* --- 5. Панель кошика --- */
await evalJs(`[...document.querySelectorAll('.hbtn')].at(-1)?.click()`);
await wait(400);
const drawer = await evalJs(`(() => {
  const d = document.querySelector('.drawer');
  const item = document.querySelector('.cart-item');
  return {
    open: d?.classList.contains('is-open'),
    name: document.querySelector('.cart-item__name')?.textContent || '',
    meta: document.querySelector('.cart-item__meta')?.textContent || '',
    total: document.querySelector('.cart-total__sum')?.textContent || '',
    checkout: !!document.querySelector('.drawer__foot a[href$="/checkout"]')
  };
})()`);
ok('панель відкрилась', drawer.open);
ok('позиція має назву', !!drawer.name, drawer.name);
ok('позиція має категорію й артикул', /·/.test(drawer.meta), drawer.meta);
ok('сума порахована', /грн/.test(drawer.total), drawer.total);
ok('є перехід на оформлення', drawer.checkout);

/* --- 6. Кількість --- */
await evalJs(`document.querySelectorAll('.cart-item .qty button')[1]?.click()`);
await wait(400);
const qty = await evalJs('document.querySelector(".cart-item .qty span")?.textContent');
ok('кількість збільшується', qty === '2', `qty: ${qty}`);

/* --- 7. Оформлення --- */
await go(BASE + '/checkout');
const co = await evalJs(`(() => ({
  items: document.querySelectorAll('.checkout-summary > div').length,
  promo: !!document.querySelector('.promo input'),
  carrier: !!document.getElementById('coCarrier'),
  city: !!document.getElementById('coCity'),
  branchDisabled: document.getElementById('coBranch')?.disabled,
  confirm: !!document.querySelector('.co-confirm'),
  submit: !!document.querySelector('.btn--order')
}))()`);
ok('позиції в підсумку', co.items > 0, `рядків: ${co.items}`);
ok('поле промокоду є', co.promo);
ok('перевізник є', co.carrier);
ok('поле міста є', co.city);
ok('відділення заблоковане без міста', co.branchDisabled === true);
ok('блок підтвердження є', co.confirm);
ok('кнопка відправки є', co.submit);

/* --- 8. Валідація: порожня форма не проходить --- */
await evalJs('document.querySelector(".btn--order")?.click()');
await wait(500);
const err = await evalJs(`(() => ({
  text: document.querySelector('.promo__hint.is-err')?.textContent || '',
  invalid: !!document.querySelector('.is-invalid')
}))()`);
ok('порожня форма не відправляється', !!err.text, err.text);

/* Пошта обовʼязкова: на неї йде підтвердження замовлення. Раніше
   без неї замовлення проходило, і написати покупцеві не було куди. */
await evalJs(`(() => {
  const set = (id, v) => {
    const el = document.getElementById(id);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('coName', 'Тарас Шевченко');
  set('coPhone', '+380971112233');
  set('coEmail', '');
})()`);
await wait(300);
await evalJs('document.querySelector(".btn--order")?.click()');
await wait(500);
const noMail = await evalJs(`(() => ({
  text: document.querySelector('.promo__hint.is-err')?.textContent || '',
  onEmail: document.getElementById('coEmail')?.classList.contains('is-invalid')
}))()`);
ok('без пошти замовлення не проходить', noMail.onEmail === true, noMail.text);

/* --- 9. Нова Пошта: пошук міста --- */
await evalJs(`(() => {
  const el = document.getElementById('coCity');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'Львів');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await wait(2500);
const np = await evalJs(`(() => ({
  opts: document.querySelectorAll('.acombo__opt').length,
  first: document.querySelector('.acombo__opt span')?.textContent || '',
  msg: document.querySelector('.acombo__msg')?.textContent || ''
}))()`);
ok('Нова Пошта відповідає', np.opts > 0, `варіантів: ${np.opts}, перший: ${np.first}${np.msg ? ' / ' + np.msg : ''}`);

if (np.opts > 0) {
  await evalJs(`(() => {
    const li = document.querySelector('.acombo__opt');
    li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  })()`);
  await wait(500);
  const picked = await evalJs(`(() => ({
    city: document.getElementById('coCity')?.value,
    branchOn: !document.getElementById('coBranch')?.disabled
  }))()`);
  ok('місто обирається', !!picked.city, picked.city);
  ok('відділення розблокувалось', picked.branchOn);

  await evalJs(`document.getElementById('coBranch').focus()`);
  await wait(3000);
  // рахуємо ЛИШЕ список відділення: список міста лишається в DOM схованим
  const wh = await evalJs(`(() => {
    const box = document.getElementById('coBranch').closest('.acombo');
    const list = box.querySelector('.acombo__list');
    return {
      hidden: list.hidden,
      opts: box.querySelectorAll('.acombo__opt').length,
      first: box.querySelector('.acombo__opt span')?.textContent || '',
      note: box.querySelector('.acombo__opt i')?.textContent || '',
      msg: box.querySelector('.acombo__msg')?.textContent || ''
    };
  })()`);
  ok('відділення підтягнулись', wh.opts > 0 && !wh.hidden,
     `${wh.opts}, напр.: ${wh.first}${wh.note ? ' [' + wh.note + ']' : ''}${wh.msg ? ' / ' + wh.msg : ''}`);

  // вибір відділення має лягти в поле
  if (wh.opts > 0) {
    await evalJs(`(() => {
      const box = document.getElementById('coBranch').closest('.acombo');
      box.querySelector('.acombo__opt').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    })()`);
    await wait(400);
    const b = await evalJs(`document.getElementById('coBranch').value`);
    ok('відділення обирається', !!b, b);

    // зміна міста має скинути відділення
    await evalJs(`(() => {
      const el = document.getElementById('coCity');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'Київ');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await wait(2500);
    await evalJs(`(() => {
      const box = document.getElementById('coCity').closest('.acombo');
      box.querySelector('.acombo__opt')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    })()`);
    await wait(500);
    const after = await evalJs(`(() => ({
      city: document.getElementById('coCity').value,
      branch: document.getElementById('coBranch').value
    }))()`);
    ok('зміна міста скидає відділення', after.branch === '', `місто: ${after.city}, відділення: "${after.branch}"`);

    /* Пішли з поля, не дочекавшись відповіді. Запізніла відповідь
       не має розкривати список сама: інакше над уже заповненою
       адресою висне підказка, і закрити її нема кому — саме так
       вилазило «Не вдалося звʼязатися з Новою Поштою». */
    await evalJs(`(() => {
      const el = document.getElementById('coCity');
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'Львівщ');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('coName').focus();
    })()`);
    await wait(2500);
    const late = await evalJs(`(() => {
      const box = document.getElementById('coCity').closest('.acombo');
      return {
        hidden: box.querySelector('.acombo__list').hidden,
        msg: box.querySelector('.acombo__msg')?.textContent || ''
      };
    })()`);
    ok('запізніла відповідь не розкриває список сама',
       late.hidden && !late.msg,
       late.msg || 'список закритий');

    /* А коли перевізник таки не відповів — сказати про це треба
       один раз і замовкнути. Обриваємо запити до нього й дивимось,
       чи гасне рядок сам. */
    await send('Fetch.enable', {
      patterns: [{ urlPattern: '*novaposhta.ua*', requestStage: 'Request' }]
    });
    const cut = (raw) => {
      const m = JSON.parse(raw.data);
      if (m.method !== 'Fetch.requestPaused') return;
      void send('Fetch.failRequest', {
        requestId: m.params.requestId,
        errorReason: 'ConnectionFailed'
      });
    };
    ws.addEventListener('message', cut);

    await evalJs(`(() => {
      const el = document.getElementById('coCity');
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'Тернопіль');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await wait(1200);
    const said = await evalJs(
      `document.getElementById('coCity').closest('.acombo').querySelector('.acombo__msg')?.textContent || ''`
    );
    ok('перевізник мовчить — покупцеві про це кажуть', /не вдалося/i.test(said), said || 'нічого не написали');

    await wait(1800);
    const gone = await evalJs(
      `document.getElementById('coCity').closest('.acombo').querySelector('.acombo__msg')?.textContent || ''`
    );
    ok('і за дві секунди рядок гасне сам', !gone, gone || 'зник');

    ws.removeEventListener('message', cut);
    await send('Fetch.disable');
  }
}

/* --- 7б. Поріг безкоштовної доставки в кошику --- */
await evalJs(`[...document.querySelectorAll('.hbtn')].at(-1)?.click()`);
await wait(400);
const ship = await evalJs(`(() => {
  const box = document.querySelector('.free-ship');
  return { text: box?.textContent || '', width: box?.querySelector('.free-ship__fill')?.style.width || '' };
})()`);
ok('поріг безкоштовної доставки показано', !!ship.text && !!ship.width,
   ship.text.slice(0, 60) + ' [' + ship.width + ']');
await evalJs(`document.querySelector('.drawer__close')?.click()`);
await wait(300);

/* --- 7в. Вибір збереженої адреси --- */
await evalJs(`localStorage.setItem('reyter:profile', JSON.stringify({
  name: 'Тарас', phone: '+380971112233',
  addresses: [
    { id: 'a1', label: 'Дім', carrier: 'Нова Пошта', carrierId: 'np', city: 'Львів', cityRef: 'r1', branch: 'Відділення №1', branchRef: 'w1' },
    { id: 'a2', label: 'Робота', carrier: 'Нова Пошта', carrierId: 'np', city: 'Київ', cityRef: 'r2', branch: 'Відділення №7', branchRef: 'w2' }
  ],
  defaultAddressId: 'a2'
}))`);
await go(BASE + '/checkout');
const saved = await evalJs(`(() => ({
  cards: document.querySelectorAll('.addrpick__item').length,
  on: document.querySelector('.addrpick__item.is-on b')?.textContent || '',
  formHidden: !!document.querySelector('.addrpick__edit')
}))()`);
ok('збережені адреси показані', saved.cards === 3, JSON.stringify(saved));
ok('обрана саме основна адреса', saved.on === 'Робота', saved.on);
ok('форма адреси згорнута під карткою', saved.formHidden);

await evalJs(`[...document.querySelectorAll('.addrpick__item')].find(x => x.textContent.includes('Дім'))?.click()`);
await wait(400);
ok('перемикання адреси підставляє її поля',
   (await evalJs(`document.getElementById('coCity')?.value`)) === 'Львів',
   await evalJs(`document.getElementById('coCity')?.value`));

/* --- 8б. Промокод перераховується при зміні кошика --- */
await evalJs(`localStorage.setItem('reyter:promo', 'НЕМАЄ-ТАКОГО')`);
await go(BASE + '/checkout');
await wait(1800);
ok('неіснуючий код зі сховища не малює знижку',
   !(await evalJs(`!!document.querySelector('.promo--on')`)) &&
   !(await evalJs(`!!document.querySelector('.checkout-summary .is-off')`)),
   'бейджа немає');


/* --- 10. Мова --- */

await go(BASE + '/');
ok('перемикач мови є', await evalJs('!!document.querySelector(".lang-switch")'));
ok('українська активна',
   (await evalJs(`document.querySelector('.lang-btn.is-active')?.textContent`)) === 'UA');

await evalJs(`[...document.querySelectorAll('.lang-btn')].find(x => x.textContent === 'EN')?.click()`);
await wait(1500);
ok('перемикач веде на /en',
   (await evalJs('location.pathname')) === at('/en'), await evalJs('location.pathname'));
ok('заголовок англійською',
   /Character/.test(await evalJs('document.querySelector(".hero__title")?.textContent || ""')),
   await evalJs('document.querySelector(".hero__title")?.textContent || ""'));
ok('ціни у форматі UAH',
   /UAH/.test(await evalJs('document.querySelector(".price__now")?.textContent || ""')),
   await evalJs('document.querySelector(".price__now")?.textContent || ""'));

/* Товар відкривається в тій самій мові */
const enHref = await evalJs('document.querySelector(".pgrid a[href]")?.getAttribute("href")');
ok('картка веде в межах мови', String(enHref).startsWith(at('/en/p/')), String(enHref));

await go(new URL(enHref, BASE).href);
ok('сторінка товару англійською',
   /SKU|Size|Add to cart/i.test(await evalJs('document.body.textContent')),
   (await evalJs('document.body.textContent')).slice(0, 0) || '');
ok('назад на українську веде на /p/',
   (await evalJs(`[...document.querySelectorAll('.lang-btn')].find(x => x.textContent === 'UA')?.getAttribute('href')`))?.startsWith(at('/p/')),
   await evalJs(`[...document.querySelectorAll('.lang-btn')].find(x => x.textContent === 'UA')?.getAttribute('href')`));


/* --- 11. Вартість доставки ---
   Найдорожча помилка тут не в розмітці, а в арифметиці: покупець
   обирає, платити доставку разом із замовленням чи у відділенні,
   і сума «Разом» мусить іти за цим вибором копійка в копійку. */

await go(BASE + '/');
const productId = await evalJs(`(() => {
  const a = document.querySelector('.pgrid a[href*="/p/"]');
  return a ? a.getAttribute('href').split('/p/')[1] : '';
})()`);
await evalJs(`localStorage.setItem('reyter:cart', JSON.stringify([{ id: ${JSON.stringify('')} + decodeURIComponent(${JSON.stringify(productId)}), size: 'M', qty: 1 }]))`);
/* Місто зі СПРАВЖНІМ ідентифікатором Нової Пошти — інакше
   перевізникові нема за чим рахувати. Львів. */
await evalJs(`localStorage.setItem('reyter:profile', JSON.stringify({
  name: 'Тарас', phone: '+380971112233',
  addresses: [{ id: 'd1', label: 'Дім', carrier: 'Нова Пошта', carrierId: 'np',
    city: 'Львів', cityRef: 'db5c88f5-391c-11dd-90d9-001a92567626',
    branch: 'Відділення №1', branchRef: 'w1' }],
  defaultAddressId: 'd1'
}))`);
await go(BASE + '/checkout');

let row = null;
for (let i = 0; i < 20; i += 1) {
  await wait(500);
  row = await evalJs(`(() => {
    const el = document.querySelector('.checkout-ship');
    if (!el) return null;
    const сума = document.querySelector('.checkout-summary .sum span:last-child')?.textContent || '';
    return {
      text: el.textContent || '',
      hint: !!el.querySelector('.checkout-ship__hint'),
      pay: document.querySelectorAll('.ship-pay input').length,
      total: сума
    };
  })()`);
  if (row && !row.hint && /\d/.test(row.text)) break;
}

ok('рядок доставки є', !!row, JSON.stringify(row));
ok('перевізник назвав ціну', !!row && /\d/.test(row.text) && !row.hint, row?.text);
ok('є вибір, хто платить за доставку', row?.pay === 2, 'перемикачів: ' + row?.pay);

const toNumber = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;
const shipping = toNumber(row?.text);
const totalBefore = toNumber(row?.total);

await evalJs(`[...document.querySelectorAll('.ship-pay input')][1]?.click()`);
await wait(600);
const totalAfter = toNumber(await evalJs(`document.querySelector('.checkout-summary .sum span:last-child')?.textContent || ''`));
ok('оплата разом із замовленням додає доставку в суму',
   totalAfter === totalBefore + shipping,
   `${totalBefore} + ${shipping} = ${totalAfter}`);

await evalJs(`[...document.querySelectorAll('.ship-pay input')][0]?.click()`);
await wait(600);
const totalBack = toNumber(await evalJs(`document.querySelector('.checkout-summary .sum span:last-child')?.textContent || ''`));
ok('оплата у відділенні суму не чіпає', totalBack === totalBefore, `${totalBack} проти ${totalBefore}`);


/* --- 12. Не турбувати ---
   Хто не хоче дзвінків і повідомлень, ставить галочку — і решта
   питань зникає разом із нею. */

const before = await evalJs(`(() => ({
  skip: !!document.querySelector('.co-confirm__skip input'),
  parts: [...document.querySelectorAll('.co-confirm__part')].filter(x => !x.hidden).length
}))()`);
ok('галочка «не звʼязуватись» є', before.skip);
ok('поки її не поставили — питання на місці', before.parts >= 2, 'видимих блоків: ' + before.parts);

await evalJs(`document.querySelector('.co-confirm__skip input')?.click()`);
await wait(500);
const after = await evalJs(`(() => ({
  parts: [...document.querySelectorAll('.co-confirm__part')].filter(x => !x.hidden).length,
  note: document.querySelector('.pinfo__order-note')?.textContent || ''
}))()`);
ok('після галочки питання зникають', after.parts === 0, 'видимих блоків: ' + after.parts);
ok('і підпис під кнопкою вже не обіцяє дзвінка',
   /лист/i.test(after.note), after.note);

await evalJs(`document.querySelector('.co-confirm__skip input')?.click()`);
await wait(500);
ok('галочку зняли — питання повернулись',
   (await evalJs(`[...document.querySelectorAll('.co-confirm__part')].filter(x => !x.hidden).length`)) >= 2);


/* --- 13. Поетапний вибір адреси ---
   Форма міжнародної доставки має розкриватись кроками: доти,
   доки немає країни, питати місто нема сенсу, а вулицю з
   індексом — тим паче. */

await evalJs(`localStorage.removeItem('reyter:profile')`);
await go(BASE + '/checkout');

const visible = async () => evalJs(`(() => {
  const shown = (s) => { const x = document.querySelector(s); if (!x) return false;
    return !!(x.offsetParent || x.getClientRects().length); };
  return { city: shown('#coIntlCity'), mode: shown('.intl-mode'), point: shown('#coIntlBranch'),
           street: shown('#coStreet'), zip: shown('#coZip'), npBranch: shown('#coBranch') };
})()`);

const setField = (id, val) => evalJs(`(() => { const el=document.getElementById('${id}');
  const proto = el.tagName==='SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true})); return true; })()`);

const start = await visible();
ok('поки міста немає — відділення Нової Пошти не питаємо', !start.npBranch, JSON.stringify(start));

await setField('coCarrier', 'intl');
await wait(800);
const step1 = await visible();
ok('на початку міжнародної видно лише країну',
   !step1.city && !step1.mode && !step1.street && !step1.zip, JSON.stringify(step1));

const pickOption = (id) => evalJs(`document.getElementById('${id}').closest('.acombo').querySelector('.acombo__opt')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
const options = (id) => evalJs(`(() => { const b=document.getElementById('${id}').closest('.acombo');
  return [...b.querySelectorAll('.acombo__opt span')].slice(0,3).map(x=>x.textContent); })()`);

await setField('coCountry', 'Пол');
await wait(900);
const countries = await options('coCountry');
ok('країна знаходиться за першими літерами', countries.includes('Польща'), JSON.stringify(countries));

/* Картку кроку колись обрізало по заокругленню — і разом із нею
   всі випадайки: список був у розмітці, але його не було видно. */
const dropdown = await evalJs(`(() => {
  const box = document.getElementById('coCountry').closest('.acombo');
  const ul = box.querySelector('.acombo__list');
  const card = box.closest('.cosec');
  const r = ul.getBoundingClientRect();
  return { visible: r.height > 40, clipped: getComputedStyle(card).overflow !== 'visible' };
})()`);
ok('випадайку видно, а картка кроку її не обрізає',
   dropdown.visible && !dropdown.clipped, JSON.stringify(dropdown));
await pickOption('coCountry');
await wait(900);
const step2 = await visible();
ok('після країни зʼявляється місто', step2.city && !step2.mode && !step2.street, JSON.stringify(step2));

await setField('coIntlCity', 'Wars');
await wait(3000);
ok('місто знаходиться за початком назви',
   (await options('coIntlCity'))[0]?.startsWith('Warsaw'), JSON.stringify(await options('coIntlCity')));
await pickOption('coIntlCity');
await wait(2000);
const step3 = await visible();
ok('після міста — вибір способу й пункт',
   step3.mode && step3.point && !step3.street && !step3.zip, JSON.stringify(step3));
ok('місто прийшло латиницею',
   /^[\x20-\x7E]+$/.test(await evalJs(`document.getElementById('coIntlCity')?.value || ''`)),
   await evalJs(`document.getElementById('coIntlCity')?.value`));

await evalJs(`[...document.querySelectorAll('.intl-mode input')][1]?.click()`);
await wait(700);
const step4 = await visible();
ok('курʼєром на адресу — зʼявляються вулиця й індекс',
   step4.street && step4.zip && !step4.point, JSON.stringify(step4));

ok('область підставилась із міста, а не питається',
   /voivodeship|Masovian/i.test(await evalJs(`document.getElementById('coState')?.value || ''`)),
   await evalJs(`document.getElementById('coState')?.value`));

await setField('coStreet', 'Marsza');
await wait(3000);
const streets = await options('coStreet');
ok('вулиця знаходиться за частиною назви', streets.length > 0, JSON.stringify(streets));
ok('і всі вулиці — саме цього міста',
   streets.every((x) => /Marsza/i.test(x)), JSON.stringify(streets));

console.log('\nПомилки в консолі: ' + (errors.length ? '\n' + errors.join('\n') : 'немає'));

ws.close();
chrome.kill();
process.exit(0);
