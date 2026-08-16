/* ============================================================
   REYTER — маркетингові розсилки
   ------------------------------------------------------------
   Тонкий шар над воркером: ключ Resend лежить у нього, а не в
   браузері, і сам лист збирає теж він. Звідси йдуть лише тема,
   текст і перелік людей.

   ЩО ТРЕБА ЗНАТИ ПРО МЕЖІ. Розсилки в Resend живуть в іншій
   системі лічильників, ніж листи про замовлення: там обмежена
   не кількість листів, а розмір бази — тисяча контактів на
   безкоштовному тарифі. Написати тим самим девʼятистам покупцям
   можна хоч щодня, і сотня транзакційних листів на добу від
   цього не постраждає.

   А от тисяча перша людина ламає все й тихо: контакт створиться
   нормально, а надсилання відповість 403 і не піде ЖОДНОМУ
   отримувачеві. Тому межу видно в адмінці ще до натискання.
   ============================================================ */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  type Firestore
} from 'firebase/firestore';
import { paidGoods } from './loyalty-db';
import { dateOf, keyOfBuyer } from './insights';
import type { AdminOrder } from './orders';
import type { Client } from './clients';

/** Скільки контактів вміщає безкоштовний тариф Resend. */
export const CONTACTS_MAX = 1000;
/** І скільки груп. Через це воркер не заводить нову на кожну
 *  розсилку, а бере наявну й зводить її рівно до потрібних людей:
 *  у новому обліковому записі Resend усі три вже можуть бути
 *  зайняті — там від початку лежить «General». */
export const SEGMENTS_MAX = 3;

export interface Cabinet {
  workerUrl: string;
  adminKey: string;
}


/** Лист так, як його пише людина в адмінці. Готового HTML звідси
 *  не буває навмисно: його збирає воркер, і саме тому в кожному
 *  листі гарантовано є посилання на відписку. */
export interface Letter {
  subject: string;
  title: string;
  text: string;
  button: string;
  url: string;
  code: string;
  codeNote: string;
  image: string;
}

export const EMPTY_LETTER: Letter = {
  subject: '',
  title: '',
  text: '',
  button: '',
  url: '',
  code: '',
  codeNote: '',
  image: ''
};

async function ask<T>(cab: Cabinet, body: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const url = String(cab?.workerUrl || '').trim().replace(/\/+$/, '');
  if (!url) {
    return { ok: false, error: 'не вказано адресу Worker у налаштуваннях' } as T & { ok: boolean; error: string };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /* Ключ підрізаємо: при копіюванні з панелі Cloudflare до
         нього легко чіпляється пробіл, а порівняння у воркері
         точне. */
      body: JSON.stringify({ key: String(cab?.adminKey || '').trim(), ...body })
    });
    const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
    return { ...data, ok: data.ok === true } as T & { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: 'немає звʼязку з Worker' } as T & { ok: boolean; error: string };
  }
}

/** Надіслати. ОДИН запит робить усе: заводить групу в Resend,
 *  зводить її рівно до цих людей і відправляє лист.
 *
 *  Доти в адмінці було три кроки — «зібрати групу», обрати її зі
 *  списку, потім надіслати. Кроки існували не для людини, а тому,
 *  що так влаштований Resend: спершу сегмент, потім контакти,
 *  потім розсилка. Показувати чуже внутрішнє влаштування як
 *  роботу для власника — помилка, і кнопка «надіслати» стояла
 *  сірою, поки не здогадаєшся натиснути попередню. */
export function sendBroadcast(
  cab: Cabinet,
  people: { email: string; name: string }[],
  letter: Letter,
  at = ''
) {
  return ask<{ id?: string; added?: number; failed?: number; segmentName?: string }>(cab, {
    type: 'mk-send',
    people,
    at,
    ...letter
  });
}

/** «1 лист», «2 листи», «5 листів».
 *
 *  Дрібниця, яку видно щоразу: «Піде 1 листів» у вікні, де
 *  вирішують, чи писати живим людям, читається як недороблено. */
export function manyLetters(n: number): string {
  const ten = n % 100;
  const one = n % 10;
  if (ten >= 11 && ten <= 14) return n + ' листів';
  if (one === 1) return n + ' лист';
  if (one >= 2 && one <= 4) return n + ' листи';
  return n + ' листів';
}

/** Кому взагалі можна писати.
 *
 *  Без пошти лист нікуди не піде — таких відсіюємо мовчки. А от
 *  усі інші правила (хто саме потрапляє в групу) вирішує людина
 *  в адмінці, а не цей файл. */
export function reachable(list: Client[]): Client[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const mail = x.email.trim().toLowerCase();
    if (!mail || !mail.includes('@')) return false;
    if (seen.has(mail)) return false;
    seen.add(mail);
    return true;
  });
}

/** Що піде у воркер: лише пошта й імʼя. Ані сум, ані міст —
 *  надсилати в чужий сервіс більше, ніж потрібно для листа, немає
 *  жодних підстав. */
export function contactsOf(list: Client[]): { email: string; name: string }[] {
  return reachable(list).map((x) => ({ email: x.email, name: x.name }));
}

/** Чи влізе така розсилка в безкоштовний тариф. Рахуємо ДО
 *  надсилання: інакше про межу дізнаєшся з відмови, коли лист
 *  уже мав піти. */
export function overLimit(n: number): boolean {
  return n > CONTACTS_MAX;
}


/* ============================================================
   ЗВІТ ПО РОЗСИЛЦІ
   ------------------------------------------------------------
   Resend знає, скільком лист дійшов і скільки його відкрили.
   Але власник питає не про це. Він питає «а купили?» — і на це
   не відповість жоден поштовий сервіс, бо покупки живуть у нас.

   Тому кожна розсилка запамʼятовується в базі разом із поштами
   тих, кому вона пішла. Далі конверсія рахується просто: скільки
   з ЦИХ людей замовили ПІСЛЯ того, як лист пішов.

   ЧЕСНІСТЬ. Це не доказ, що замовили саме через лист — людина
   могла прийти й сама. Тому вікно коротке, а поруч завжди стоїть
   те, з чим порівнювати: скільки ті самі люди купували за такий
   самий час ДО розсилки. Одне число без порівняння вміє
   переконати в чому завгодно.
   ============================================================ */

export const RUNS_COL = 'broadcasts';

/** Скільки днів після листа рахуємо покупку його заслугою.
 *
 *  Два тижні: за менший строк губляться ті, хто прочитав у
 *  вихідні й замовив у понеділок; за більший до розсилки
 *  починають приписувати випадкові покупки. */
export const WINDOW = 14;

export interface MailRun {
  _id: string;
  /** Ідентифікатор розсилки в Resend. */
  id: string;
  subject: string;
  /** Кому писали — словами, як це бачив власник. */
  audience: string;
  /** Коли надіслано, ISO. */
  at: string;
  /** Пошти отримувачів. Без них конверсію не порахувати ніяк:
   *  замовлення не знає, що йому передував лист. */
  to: string[];
  by: string;
}

export interface RunReport {
  /** Скільки людей отримало лист. */
  sent: number;
  /** Скільки з них замовили у вікні. */
  buyers: number;
  orders: number;
  revenue: number;
  /** Частка тих, хто замовив, 0–1. */
  rate: number;
  avg: number;
  /** Ті самі люди за такий самий час ДО листа — з чим
   *  порівнювати. */
  wasBuyers: number;
  wasRevenue: number;
  /** Наскільки більше, ніж було. null — до листа не купував
   *  ніхто, і ділити нема на що. */
  lift: number | null;
}

export async function saveRun(db: Firestore, run: Omit<MailRun, '_id'>): Promise<void> {
  const id = run.id || String(Date.parse(run.at) || Date.now());
  await setDoc(doc(db, RUNS_COL, id), run);
}

export async function loadRuns(db: Firestore): Promise<MailRun[]> {
  try {
    const snap = await getDocs(query(collection(db, RUNS_COL), orderBy('at', 'desc')));
    return snap.docs.map((d) => ({ _id: d.id, ...(d.data() as Omit<MailRun, '_id'>) }));
  } catch {
    return [];
  }
}

export async function dropRun(db: Firestore, id: string): Promise<void> {
  await deleteDoc(doc(db, RUNS_COL, id));
}

const DAY = 86_400_000;

/** Що дала розсилка.
 *
 *  Рахуємо лише виконані замовлення: покупка, яку скасували,
 *  грошей не принесла, і зараховувати її листові немає підстав. */
export function reportOf(run: MailRun, orders: AdminOrder[], now = new Date()): RunReport {
  const to = new Set((run.to || []).map((x) => String(x).trim().toLowerCase()));
  const at = Date.parse(run.at);
  if (!to.size || !Number.isFinite(at)) {
    return {
      sent: to.size, buyers: 0, orders: 0, revenue: 0, rate: 0, avg: 0,
      wasBuyers: 0, wasRevenue: 0, lift: null
    };
  }

  /* Вікно не може заглядати в майбутнє: розсилка, надіслана
     вчора, має показувати один день спостережень, а не
     чотирнадцять. Інакше свіжа розсилка завжди виглядала б
     провальною. */
  const till = Math.min(at + WINDOW * DAY, now.getTime());
  const from = at - WINDOW * DAY;

  const after = new Map<string, { n: number; sum: number }>();
  const before = new Map<string, { n: number; sum: number }>();

  for (const o of orders) {
    if (o.status !== 'done') continue;
    const key = keyOfBuyer(o);
    if (!to.has(key)) continue;
    const t = dateOf(o).getTime();
    const box = t >= at && t <= till ? after : t >= from && t < at ? before : null;
    if (!box) continue;
    const was = box.get(key) || { n: 0, sum: 0 };
    was.n += 1;
    was.sum += paidGoods(o);
    box.set(key, was);
  }

  const orderCount = [...after.values()].reduce((n, x) => n + x.n, 0);
  const revenue = Math.round([...after.values()].reduce((n, x) => n + x.sum, 0));
  const wasRevenue = Math.round([...before.values()].reduce((n, x) => n + x.sum, 0));

  return {
    sent: to.size,
    buyers: after.size,
    orders: orderCount,
    revenue,
    rate: to.size ? after.size / to.size : 0,
    avg: orderCount ? Math.round(revenue / orderCount) : 0,
    wasBuyers: before.size,
    wasRevenue,
    lift: wasRevenue > 0 ? revenue / wasRevenue - 1 : null
  };
}

/** Скільки днів розсилка вже під спостереженням. Поки їх менше
 *  за WINDOW, звіт неповний — і сказати про це треба, бо інакше
 *  учорашній лист виглядатиме гіршим за торішній. */
export function watchedDays(run: MailRun, now = new Date()): number {
  const at = Date.parse(run.at);
  if (!Number.isFinite(at)) return 0;
  return Math.min(WINDOW, Math.max(0, Math.floor((now.getTime() - at) / DAY)));
}
