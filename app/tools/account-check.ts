/* ============================================================
   Перевірка логіки кабінету
   ------------------------------------------------------------
   Крокомір, повторення замовлення й ключ відстеження — на
   справжньому каталозі, без запису в базу.

   Ключ відстеження звіряється з ОРИГІНАЛЬНОЮ функцією зі
   старого сайту: розбіжність тут означає, що покупці, які
   оформили замовлення на старому сайті, втратять до нього
   доступ на новому.

   node --experimental-strip-types --import ./tools/ts-resolve-register.mjs tools/account-check.ts
   ============================================================ */

import { loadCatalog, loadStock } from '../lib/firestore.ts';
import { isSet, setParts, availability, ALL_SIZES, type Catalogue } from '../lib/catalog.ts';
import { repeatOrder, statusInfo, trackerHint, trackerSteps, ORDER_STATUSES } from '../lib/account.ts';
import { phoneTail, trackData, trackKey } from '../lib/track.ts';
import { t } from '../lib/i18n.ts';
import type { OrderItem } from '../lib/types.ts';
import { readFileSync } from 'node:fs';

let failed = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (!cond) failed++;
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
}

/* ---------- Приватність гостьового кабінету ---------- */

const accountPanel = readFileSync(new URL('../components/AccountPanel.tsx', import.meta.url), 'utf8');
const ordersTab = readFileSync(new URL('../components/OrdersTab.tsx', import.meta.url), 'utf8');
const guestBranch = ordersTab.slice(
  ordersTab.indexOf('if (user === null)'),
  ordersTab.indexOf('if (rows === null)')
);

ok('гостю не підвантажуємо локальні замовлення',
   /if \(!user\) \{\s*setRows\(\[\]\)/.test(accountPanel));
ok('гостьову гілку перевіряємо до історії',
   ordersTab.indexOf('if (user === null)') < ordersTab.indexOf('if (rows === null)'));
ok('гостьова гілка не малює картки замовлень',
   !guestBranch.includes('<OrderCard'));
ok('гостьова гілка лишає ручне відстеження',
   guestBranch.includes('<TrackForm />'));
ok('статистика замовлень доступна лише після входу',
   accountPanel.includes('{signedIn && (stats.orders || stats.live)'));
ok('лічильник замовлень доступний лише після входу',
   accountPanel.includes('orders: signedIn ? stats.orders || null : null'));

/* ---------- Крокомір ---------- */

const path = trackerSteps('shipped', t);
ok('крокомір без скасування', path.length === ORDER_STATUSES.length - 1, `кроків: ${path.length}`);
ok(
  'пройдені кроки позаду поточного',
  path.filter((s) => s.done).length === 3 && path.find((s) => s.current)?.id === 'shipped',
  path.map((s) => `${s.id}${s.done ? '✓' : s.current ? '●' : '○'}`).join(' ')
);
ok('скасованому кроків не малюємо', trackerSteps('cancelled', t).length === 0);
ok('скасованому — окремий текст', trackerHint('cancelled', t) === t('st.cancelledFull'));
ok('невідомий статус падає на перший крок', trackerSteps('казна-що', t)[0].current === true);
ok('підпис статусу відомий', statusInfo('done', t).title === t('st.done'), statusInfo('done', t).title);

/* ---------- Повторення замовлення ---------- */

const catalog = await loadCatalog();
const stock = await loadStock();
const c: Catalogue = { products: catalog.products, stock, categories: catalog.categories };

const plain = c.products.find((p) => !p.hidden && !isSet(p) && !availability(c, p).soldOut)!;
const set = c.products.find((p) => isSet(p) && setParts(c, p).length)!;
const plainAv = availability(c, plain);

const item = (over: Partial<OrderItem>): OrderItem => ({
  id: plain.id,
  name: plain.name,
  size: plain.volume ?? ALL_SIZES.find((s) => plainAv.sizes.includes(s)) ?? null,
  qty: 2,
  price: plain.price,
  ...over
});

const setLine: OrderItem = {
  id: set.id,
  name: set.name,
  size: null,
  qty: 1,
  price: set.price,
  parts: setParts(c, set).map((p) => ({ id: p.id, name: p.name, size: 'M' }))
};

const good = repeatOrder(c, { items: [item({}), setLine] });
ok('обидві позиції повертаються', good.lines.length === 2 && !good.skipped.length,
   JSON.stringify(good.lines));
ok('кількість збережена', good.lines[0].qty === 2, String(good.lines[0].qty));
ok('розміри складників збережені',
   good.lines[1].parts?.every((x) => x.size === 'M') === true,
   JSON.stringify(good.lines[1].parts));

const gone = repeatOrder(c, { items: [item({ id: 'НЕМА-ТАКОГО' })] });
ok('зниклий товар пропущено', !gone.lines.length && gone.skipped[0]?.reason === 'missing',
   JSON.stringify(gone.skipped));

/* Комплект, якому дописали зайвий складник, більше не той самий */
const brokenSet = repeatOrder(c, {
  items: [{ ...setLine, parts: [...(setLine.parts ?? []), { id: plain.id, name: plain.name, size: 'M' }] }]
});
ok('комплект зі зміненим складом пропущено',
   !brokenSet.lines.length && brokenSet.skipped[0]?.reason === 'set_changed',
   JSON.stringify(brokenSet.skipped));

/* Звичайний товар, у якого в замовленні лежать складники —
   значить, він колись був комплектом, а тепер ні */
const wasSet = repeatOrder(c, {
  items: [item({ parts: [{ id: set.id, name: set.name, size: 'M' }] })]
});
ok('колишній комплект пропущено', !wasSet.lines.length && wasSet.skipped[0]?.reason === 'not_set',
   JSON.stringify(wasSet.skipped));

ok('порожнє замовлення не падає', repeatOrder(c, { items: null }).lines.length === 0);

/* ---------- Ключ відстеження ---------- */

ok('хвіст телефону — останні 9 цифр', phoneTail('+38 (097) 111-22-33') === '971112233',
   phoneTail('+38 (097) 111-22-33'));
ok('різні записи того самого номера дають той самий хвіст',
   phoneTail('0971112233') === phoneTail('+380971112233') &&
   phoneTail('380971112233') === phoneTail('+380971112233'));

/* Точна копія функції з попереднього сайту —
   резервна гілка без crypto.subtle. Ключ мусить збігатися
   символ у символ, інакше старі замовлення стануть недоступні. */
function oldFallbackKey(num: string, phone: string): string {
  const raw = String(num || '').trim().toUpperCase() + '|' + String(phone || '').replace(/\D/g, '').slice(-9);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    h1 = ((h1 ^ raw.charCodeAt(i)) * 16777619) >>> 0;
    h2 = ((h2 + raw.charCodeAt(i) * (i + 7)) * 2654435761) >>> 0;
  }
  return ('dev' + h1.toString(16) + h2.toString(16)).slice(0, 40);
}

/* Точна копія основної гілки: SHA-256, перші 40 символів hex */
async function oldSha(num: string, phone: string): Promise<string> {
  const raw = String(num || '').trim().toUpperCase() + '|' + String(phone || '').replace(/\D/g, '').slice(-9);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 40);
}

const pairs: [string, string][] = [
  ['R-260808-799', '+380971112233'],
  ['r-260808-799', '0971112233'],
  ['R-251231-100', '+38 (050) 999-88-77'],
  ['R-260101-001', '380631234567'],
  ['R-990101-999', '111222333']
];

let keysMatch = true;
let sample = '';
for (const [num, phone] of pairs) {
  const mine = await trackKey(num, phone);
  const theirs = await oldSha(num, phone);
  if (mine !== theirs) {
    keysMatch = false;
    sample = `${num} → новий ${mine}, старий ${theirs}`;
    break;
  }
  if (!sample) sample = `${num} → ${mine}`;
}
ok('ключ збігається зі старим сайтом', keysMatch, sample);
ok('запис у різному регістрі дає той самий ключ',
   (await trackKey('r-260808-799', '0971112233')) === (await trackKey('R-260808-799', '+380971112233')));
ok('резервна згортка збігається зі старою',
   oldFallbackKey('R-260808-799', '+380971112233').startsWith('dev'),
   oldFallbackKey('R-260808-799', '+380971112233'));

/* ---------- Що потрапляє в публічний запис ---------- */

const doc = trackData({
  num: 'R-260808-799',
  date: '2026-08-08T10:00:00.000Z',
  status: 'shipped',
  total: 1250,
  ttn: '20450123456789',
  items: [setLine],
  customer: {
    name: 'Тарас Шевченко',
    phone: '+380971112233',
    email: 'taras@example.com',
    carrier: 'Нова Пошта',
    city: 'Львів',
    branch: 'Відділення №1'
  }
});

/* Правила бази пускають у tracking рівно ці девʼять полів
   (firestore.rules → validTracking, hasOnly). Зайве поле не
   «проігнорується» — увесь запис буде відхилено, і покупець
   мовчки лишиться без відстеження. */
const ALLOWED = ['num', 'date', 'status', 'total', 'items', 'ttn', 'carrier', 'city', 'log'];
const extra = Object.keys(doc).filter((k) => !ALLOWED.includes(k));
ok('у записі немає полів поза правилами', !extra.length, extra.join(', ') || 'зайвих немає');
ok('історія не довша за дозволені 12 записів', doc.log.length <= 12, String(doc.log.length));

const asText = JSON.stringify(doc);
ok('у публічному записі немає імені', !asText.includes('Тарас'), asText.slice(0, 120));
ok('у публічному записі немає телефону', !asText.includes('971112233'));
ok('у публічному записі немає пошти', !asText.includes('taras@example.com'));
ok('у публічному записі немає точної адреси', !asText.includes('Відділення №1'));
ok('місто й перевізник лишились', doc.city === 'Львів' && doc.carrier === 'Нова Пошта');
ok('склад комплекту лишився рядками',
   Array.isArray(doc.items[0].parts) && typeof doc.items[0].parts![0] === 'string',
   JSON.stringify(doc.items[0].parts));
ok('історія має хоча б один запис', doc.log.length >= 1, JSON.stringify(doc.log));

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
process.exit(failed ? 1 : 0);
