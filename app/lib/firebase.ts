/* ============================================================
   REYTER — Firebase у браузері
   ------------------------------------------------------------
   Модульний SDK замість compat-збірки зі старого сайту: у бандл
   потрапляє лише те, що справді використовується.

   Ініціалізація ліниво, на першому зверненні: на сервері модуль
   імпортується разом із компонентами, але жоден виклик до нього
   не доходить, і піднімати SDK там ні до чого.

   Якщо Firebase недоступний — сайт має працювати далі, на
   localStorage. Тому всі функції тут повертають null або false
   замість того, щоб кидати помилку.
   ============================================================ */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import type { Product } from './types';
import { fromNow } from './attribution';
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  GoogleAuthProvider,
  type Auth,
  type User
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  limit,
  serverTimestamp,
  increment,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  clearIndexedDbPersistence,
  type Firestore
} from 'firebase/firestore';

export const FB_CONFIG = {
  apiKey: 'AIzaSyD_88QLk2dxQDUIjEVMrRCTHgVkeVX-9pI',
  authDomain: 'reyter-18d2c.firebaseapp.com',
  projectId: 'reyter-18d2c',
  storageBucket: 'reyter-18d2c.firebasestorage.app',
  messagingSenderId: '475583686911',
  appId: '1:475583686911:web:8f75bc02248fc3e46f04ca'
};

let app: FirebaseApp | null = null;

function ready(): boolean {
  if (typeof window === 'undefined') return false;
  if (!app) {
    try {
      app = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
    } catch {
      return false;
    }
  }
  return !!app;
}

/* ---------- Кеш бази ----------
   Досі база трималась у памʼяті вкладки, тобто фактично ніде:
   кожне оновлення сторінки адмінки заново тягнуло всі пʼятсот
   замовлень — близько двох мегабайтів. Постійний кеш лишає їх
   у сховищі браузера: другий і кожен наступний захід малює
   список одразу, а мережею їде лише різниця.

   Багатовкладковий менеджер обовʼязковий: менеджери тримають
   адмінку в кількох вкладках, і без нього кеш дістається лише
   першій, а решта тихо працює по-старому.

   initializeFirestore можна викликати рівно раз і тільки до
   першого getFirestore, тому памʼятаємо створене. Приватне
   вікно Safari сховища не дає — тоді відкочуємось на звичайну
   базу, а не лишаємо адмінку без бази взагалі. */
let store: Firestore | null = null;

export function db(): Firestore | null {
  if (!ready()) return null;
  if (store) return store;
  try {
    store = initializeFirestore(app as FirebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch {
    store = getFirestore(app as FirebaseApp);
  }
  return store;
}

export function auth(): Auth | null {
  return ready() ? getAuth(app as FirebaseApp) : null;
}

/* ---------- Авторизація ---------- */

/** Закриті товари клубу. Читаються ВХОДОМ САМОГО ПОКУПЦЯ:
 *  правила пускають у цей документ лише учасника, і саме тому
 *  його немає ні в розмітці сторінки, ні у відкритому каталозі.
 *
 *  Порожньо — або не учасник, або товарів немає. Розрізняти ці
 *  два випадки нема потреби: показувати однаково нічого. */
export async function loadFriendlyProducts(): Promise<Product[]> {
  const d = db();
  if (!d) return [];
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(d, 'published', 'friendly'));
    if (!snap.exists()) return [];
    const data = snap.data() as { products?: Product[] };
    return Array.isArray(data.products) ? data.products : [];
  } catch {
    // немає прав — це не помилка, а відповідь «вам не видно»
    return [];
  }
}

export function watchAuth(fn: (user: User | null) => void): () => void {
  const a = auth();
  if (!a) {
    fn(null);
    return () => {};
  }
  return onAuthStateChanged(a, (u) => fn(u));
}

/* Перенаправлення працює лише тоді, коли сторінка входу лежить
   на тому самому домені, що й сайт. Наш обробник — на
   reyter-18d2c.firebaseapp.com, тобто на чужому: сучасні браузери
   ділять сховище між доменами, і після повернення Firebase не
   знаходить власного стану. Саме звідси «Unable to process request
   due to missing initial state» — глухий кут, з якого людина вже
   не повертається на сайт.

   Тому перенаправлення вмикається саме тоді, коли обробник свій.
   Перенесемо його на admin.reyter.men — умова стане правдивою
   сама, і нічого міняти не доведеться. */
function redirectWorks(): boolean {
  return typeof location !== 'undefined' && location.hostname === FB_CONFIG.authDomain;
}

export async function loginGoogle(): Promise<User | null> {
  const a = auth();
  if (!a) return null;
  const provider = new GoogleAuthProvider();
  try {
    return (await signInWithPopup(a, provider)).user;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    const blocked =
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment';
    if (!blocked) throw err;

    if (redirectWorks()) {
      /* Не повертає користувача одразу: сторінка перезавантажиться,
         і його підхопить watchAuth. */
      await signInWithRedirect(a, provider);
      return null;
    }

    /* Вбудований браузер месенджера — типовий випадок, коли попап
       не відкривається. Чесно кажемо, що робити, замість того щоб
       завести людину в глухий кут. */
    throw Object.assign(new Error('in-app-browser'), { code: 'reyter/no-popup' });
  }
}

export async function loginEmail(email: string, pass: string) {
  const a = auth();
  if (!a) throw new Error('offline');
  return (await signInWithEmailAndPassword(a, email, pass)).user;
}

export async function registerEmail(email: string, pass: string) {
  const a = auth();
  if (!a) throw new Error('offline');
  const user = (await createUserWithEmailAndPassword(a, email, pass)).user;

  /* Лист із підтвердженням обовʼязковий, хоч Firebase його й не
     вимагає. Правила бази пускають до замовлень, оформлених до
     реєстрації, і до персональних промокодів лише за
     email_verified — без цього листа акаунт «пошта + пароль»
     назавжди лишається непідтвердженим і не бачить нічого свого.
     Вхід через Google підтверджує пошту сам. */
  try {
    await sendEmailVerification(user);
  } catch {
    /* лист не пішов — акаунт усе одно створено */
  }
  return user;
}

export async function resetPassword(email: string) {
  const a = auth();
  if (!a) throw new Error('offline');
  await sendPasswordResetEmail(a, email);
}

export async function logout() {
  const a = auth();
  if (a) await signOut(a);

  /* Кеш лишається на диску й після виходу — а в ньому адреси й
     телефони покупців, які читалися б офлайн з чужого ноутбука.
     Тому при виході стираємо: база вже нікому не потрібна, а
     наступний вхід збере її наново. */
  try {
    if (store) {
      await terminate(store);
      await clearIndexedDbPersistence(store);
      store = null;
    }
  } catch {
    /* база могла бути ще не створена або вже закрита */
  }
}

/** Помилки авторизації людською мовою: коди Firebase покупцеві
 *  нічого не пояснюють. */
export function authError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'Некоректний email',
    'auth/missing-password': 'Введіть пароль',
    'auth/weak-password': 'Закороткий пароль — потрібно мінімум 6 символів',
    'auth/email-already-in-use': 'Акаунт із таким email вже існує — спробуйте увійти',
    'auth/user-not-found': 'Невірний email або пароль',
    'auth/wrong-password': 'Невірний email або пароль',
    'auth/invalid-credential': 'Невірний email або пароль',
    'auth/too-many-requests': 'Забагато спроб — спробуйте трохи пізніше',
    'auth/popup-closed-by-user': 'Вікно входу було закрито',
    'auth/cancelled-popup-request': 'Вікно входу було закрито',
    'auth/popup-blocked': 'Браузер заблокував спливаюче вікно — дозвольте його',
    'reyter/no-popup':
      'Цей браузер не дає відкрити вікно входу. Відкрийте сторінку в Safari або Chrome — там вхід спрацює.',
    'auth/operation-not-supported-in-this-environment':
      'Цей браузер не підтримує спливаючі вікна — спробуйте ще раз',
    'auth/unauthorized-domain':
      'Домен не додано у Firebase: Authentication → Settings → Authorized domains',
    'auth/network-request-failed': 'Немає звʼязку — перевірте інтернет'
  };
  return map[code] ?? `Не вдалося виконати дію (${code || 'невідома помилка'})`;
}

/* ---------- Профіль покупця ---------- */

export async function loadCloudProfile(uid: string): Promise<Record<string, unknown> | null> {
  const d = db();
  if (!d) return null;
  try {
    const snap = await getDoc(doc(d, 'users', uid));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function saveCloudProfile(uid: string, email: string, profile: unknown) {
  const d = db();
  if (!d) return;
  try {
    const { setDoc } = await import('firebase/firestore');
    await setDoc(
      doc(d, 'users', uid),
      { ...(profile as object), email, updated: serverTimestamp() },
      { merge: true }
    );
  } catch {
    /* хмара недоступна — профіль лишається локально */
  }
}

/* ---------- Промокоди ----------
   Правила дозволяють читати конкретний код, який покупець знає,
   але не переглядати весь список. Персональний код прочитає лише
   власник тієї пошти. */

export async function promoFetch(code: string): Promise<Record<string, unknown> | null> {
  const d = db();
  if (!d || !code) return null;
  try {
    const snap = await getDoc(doc(d, 'promos', code));
    return snap.exists() ? { code, ...snap.data() } : null;
  } catch {
    return null;
  }
}

export async function promoMine(email: string) {
  const d = db();
  if (!d || !email) return [];
  try {
    const snap = await getDocs(
      query(collection(d, 'promos'), where('email', '==', email), limit(50))
    );
    return snap.docs.map((x) => ({ code: x.id, ...x.data() }));
  } catch {
    return [];
  }
}

/** Лічильник використань збільшує браузер після створення
 *  замовлення. Правила дозволяють рівно +1 і жодних інших полів,
 *  тож обнулити код чи «розширити» ліміт так не вийде. Без цього
 *  ліміт не працював би взагалі. */
export async function promoConsume(code: string, email = ''): Promise<boolean> {
  const d = db();
  if (!d || !code) return false;
  try {
    await updateDoc(doc(d, 'promos', code), { usedCount: increment(1) });
  } catch {
    /* лічильник міг упертись у власну межу — не привід губити
       запис про те, що ця людина кодом скористалась */
  }

  /* Скільки разів кодом скористалась САМЕ ця людина. Окремим
     документом на пару «код + пошта»: інакше обмеження «один раз
     на покупця» неможливе — загальний лічильник не знає, хто
     саме його крутив. */
  const who = String(email || '').trim().toLowerCase();
  if (!who) return true;
  try {
    const { setDoc } = await import('firebase/firestore');
    await setDoc(
      doc(d, 'promo_uses', code + '__' + who),
      { code, who, count: increment(1) },
      { merge: true }
    );
  } catch {
    /* не критично: код спрацював, замовлення створене */
  }
  return true;
}

/** Скільки разів цей покупець уже брав цей код.
 *  Гість — нуль: у нього немає ані пошти, ані історії. */
export async function promoMineUsed(code: string, email = ''): Promise<number> {
  const d = db();
  const who = String(email || '').trim().toLowerCase();
  if (!d || !code || !who) return 0;
  try {
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(d, 'promo_uses', code + '__' + who));
    return snap.exists() ? Math.max(0, Math.round(Number(snap.data().count) || 0)) : 0;
  } catch {
    return 0;
  }
}

/* ---------- Замовлення ---------- */

export interface NewOrder {
  num: string;
  date: string;
  items: unknown[];
  subtotal: number;
  discount: number;
  promoCode: string;
  shipping?: number;
  total: number;
  customer: { email?: string; phone?: string; [k: string]: unknown };
  message?: string;
  /** Номер рахунку Monobank, якщо оплату вже почали. */
  payInvoiceId?: string;
}

/** Замовлення потрапляє в адмінку і від гостя без акаунта: тоді
 *  uid порожній, а правила бази дозволяють такий запис.
 *
 *  Поля перелічені поіменно, а не розсипані спредом: документ
 *  читає адмінка, і кожне з них їй потрібне. status без значення
 *  зламав би фільтри, uid — відрізав би замовлення від кабінету,
 *  trackKey — від відстеження. */
/* База не приймає документ, у якому хоч одне значення undefined,
   і відмовляє всім документом одразу. Одне таке поле в глибині
   адреси — і замовлення зникає мовчки: покупець бачить «прийнято»,
   лист іде, а в адмінці порожньо. Тому перед записом чистимо. */
function noHoles<T>(value: T): T {
  if (Array.isArray(value)) return value.map((x) => noHoles(x)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = noHoles(v);
    }
    return out as T;
  }
  return value;
}

/** Дописати до покупця те, що браузер знає про його прихід.
 *  Не знає нічого — лишаємо як було: порожні поля в базі гірші
 *  за відсутні. */
function withFrom(customer: NewOrder['customer']): NewOrder['customer'] {
  try {
    const box = fromNow();
    return box ? ({ ...customer, from: box } as NewOrder['customer']) : customer;
  } catch {
    return customer;
  }
}

export async function createOrder(
  order: NewOrder,
  opts: { trackKey?: string; lang?: string } = {}
): Promise<string | null> {
  const d = db();
  if (!d) return null;
  const user = auth()?.currentUser ?? null;
  try {
    const ref = await addDoc(collection(d, 'orders'), noHoles({
      num: order.num,
      date: order.date,
      items: order.items,
      subtotal: Number(order.subtotal) || Number(order.total) || 0,
      discount: Number(order.discount) || 0,
      promoCode: order.promoCode || '',
      shipping: Number(order.shipping) || 0,
      total: order.total,
      /* Звідки прийшов покупець — усередині customer, а не
         окремим полем.

         Причина не в стрункості, а в порядку подій: правила бази
         перелічують дозволені поля замовлення й публікуються
         руками. Нове поле верхнього рівня означало б, що живий
         сайт перестане приймати замовлення до тієї хвилини, коли
         правила опублікують, — і перестане МОВЧКИ. Усередині
         customer місця скільки завгодно вже сьогодні. */
      customer: withFrom(order.customer),
      message: order.message ?? '',
      status: 'new',
      uid: user ? user.uid : null,
      email: order.customer.email || user?.email || '',
      source: 'Сайт',
      lang: opts.lang || 'uk',
      trackKey: opts.trackKey || '',
      /* Номер рахунку кладемо ОДРАЗУ при створенні: дописати поле
         потім покупець не має права, і це правильно — інакше
         будь-хто міг би привʼязати до чужого замовлення свій
         рахунок. Порожнього поля тут не буває: noHoles прибирає
         те, чого немає. */
      payInvoiceId: order.payInvoiceId || undefined,
      created: serverTimestamp()
    }));
    return ref.id;
  } catch (e) {
    /* Тиша тут коштувала замовлення. Хоч у консоль, але сказати
       треба: без причини наступний такий випадок доведеться
       шукати знову з нуля. */
    console.error('Замовлення не збереглося:', e);
    return null;
  }
}

/** Замовлення без власника, оформлені на цю пошту, робимо своїми.
 *  Правила дозволяють змінити рівно поле uid і лише тому, чия
 *  пошта збігається, — чуже замовлення так не забрати. Тихо:
 *  покупцеві ця технічна деталь не потрібна.
 *
 *  Без цього замовлення лишається доступним тільки пошуком за
 *  поштою, а він у правилах вимагає підтвердженої адреси. */
function claimGuestOrders(orders: Record<string, unknown>[], uid: string, email: string) {
  const d = db();
  if (!d || !email) return;
  orders
    .filter((o) => !o.uid && o.email === email)
    .slice(0, 20)
    .forEach((o) => {
      const id = String(o._id ?? '');
      if (!id) return;
      updateDoc(doc(d, 'orders', id), { uid })
        .then(() => {
          o.uid = uid;
        })
        .catch(() => {
          /* лишиться пошуку за поштою */
        });
    });
}

/** Замовлення кабінету: шукаємо і за uid, і за поштою. Другий
 *  запит потрібен, бо покупець міг оформити замовлення гостем,
 *  а зареєструватися пізніше — такі замовлення uid не мають. */
export async function loadMyOrders(uid: string, email: string) {
  const d = db();
  if (!d) return null;
  const byId = new Map<string, Record<string, unknown>>();
  let failed = 0;

  const collect = async (field: string, value: string) => {
    try {
      const snap = await getDocs(
        query(collection(d, 'orders'), where(field, '==', value), limit(50))
      );
      snap.docs.forEach((x) => byId.set(x.id, { _id: x.id, ...x.data() }));
    } catch {
      failed++;
    }
  };

  const jobs = [collect('uid', uid)];
  if (email) jobs.push(collect('email', email));
  await Promise.all(jobs);
  if (failed === jobs.length) return null;

  const list = [...byId.values()].sort((a, b) =>
    String(b.date ?? '').localeCompare(String(a.date ?? ''))
  );
  claimGuestOrders(list, uid, email);
  return list;
}

/** Публічні налаштування сповіщень: адреса воркера. Секретів
 *  тут немає — правила бази дозволяють читати цей документ усім.
 *  Кеш на вкладку: адреса змінюється раз на рік. */
let settingsCache: Record<string, unknown> | null = null;

/** Скинути кеш. Після запису налаштувань наступне читання має
 *  побачити нову адресу воркера, а не стару з памʼяті. */
export function forgetNotifySettings(): void {
  settingsCache = null;
}

/* Адреса воркера — не таємниця: правила бази прямо кажуть, що
   settings/public читає будь-хто, а ключі Resend і Telegram лежать
   у змінних самого воркера. Тому вона може лежати ще й тут.

   Це не дублювання налаштування, а запасний шлях. 31.08.2026
   замовлення R-260831-566 лишилось і без оплати, і без сповіщення
   в Telegram через ОДИН невдалий читальний запит до цього
   документа: адреса воркера не дісталась, а на ній тримаються
   обидві дії. Запис самого замовлення при цьому пройшов — і
   магазин дізнався про нього тільки від покупця.

   Гість особливо беззахисний: у нього цей документ читається
   рівно раз, у мить натискання «Оформити». Промахнувся той
   єдиний запит — промахнулось усе.

   Налаштування лишається головним: код підставляється тільки
   тоді, коли база не відповіла. Що ці двоє не розійшлись,
   стежить tools/deploy-check.mjs — він питає живу базу. */
const WORKER_FALLBACK = 'https://reyter.pzh6yz55nw.workers.dev';

export async function loadNotifySettings(): Promise<Record<string, unknown> | null> {
  if (settingsCache) return settingsCache;
  const d = db();
  if (!d) return { workerUrl: WORKER_FALLBACK };
  /* Дві спроби: перша могла впасти на мить поганого звʼязку —
     а ціна тієї миті — ціле замовлення. */
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const snap = await getDoc(doc(d, 'settings', 'public'));
      settingsCache = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
      return settingsCache;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  /* Навмисно НЕ кешуємо: тут лише адреса, без правил лояльності
     й порога безкоштовної доставки. Наступний виклик має ще раз
     спитати базу, а не жити із запасним варіантом до кінця
     сеансу. */
  return { workerUrl: WORKER_FALLBACK };
}

/* ---------- Очікуваний прихід і підписка ---------- */

export async function fetchEta(productId: string) {
  const d = db();
  if (!d) return null;
  try {
    const snap = await getDoc(doc(d, 'restock_eta', productId));
    return snap.exists() ? (snap.data() as { any?: string; sizes?: Record<string, string> }) : null;
  } catch {
    return null;
  }
}

export async function subscribeStockAlert(input: {
  productId: string;
  productName: string;
  size: string | null;
  email: string;
  lang: string;
}): Promise<boolean> {
  const d = db();
  if (!d) return false;
  try {
    await addDoc(collection(d, 'stock_alerts'), {
      ...input,
      notified: false,
      created: new Date().toISOString()
    });
    return true;
  } catch {
    return false;
  }
}
