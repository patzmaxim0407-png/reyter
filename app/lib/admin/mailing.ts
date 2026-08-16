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

import type { Client } from './clients';

/** Скільки контактів вміщає безкоштовний тариф Resend. */
export const CONTACTS_MAX = 1000;
/** І скільки груп. Тому групу не створюють на кожну розсилку, а
 *  перевикористовують. */
export const SEGMENTS_MAX = 3;

export interface Cabinet {
  workerUrl: string;
  adminKey: string;
}

export interface MailSegment {
  id: string;
  name: string;
}

export interface SentMail {
  id: string;
  name: string;
  status: string;
  at: string;
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

export function loadSegments(cab: Cabinet) {
  return ask<{ segments?: MailSegment[] }>(cab, { type: 'mk-segments' });
}

export function loadSent(cab: Cabinet) {
  return ask<{ sent?: SentMail[] }>(cab, { type: 'mk-sent' });
}

/** Записати людей у групу. segmentId порожній — група
 *  створюється, і воркер поверне її id. */
export function syncPeople(
  cab: Cabinet,
  name: string,
  segmentId: string,
  people: { email: string; name: string }[]
) {
  return ask<{ segmentId?: string; added?: number; failed?: number; skipped?: number }>(cab, {
    type: 'mk-sync',
    name,
    segmentId,
    people
  });
}

export function sendBroadcast(cab: Cabinet, segmentId: string, letter: Letter, at = '') {
  return ask<{ id?: string }>(cab, { type: 'mk-send', segmentId, at, ...letter });
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
