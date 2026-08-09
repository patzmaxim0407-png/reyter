/* ============================================================
   REYTER — адміністратори й налаштування сповіщень
   ------------------------------------------------------------
   Портовано з js/admin.js (другий IIFE) один в один. Два різні
   сюжети, які в старій адмінці жили в одному вікні з вкладками:

   • ХТО МАЄ ДОСТУП — колекція admins, де id документа є поштою.
     Постійних адміністраторів (FOUNDERS) у цьому переліку немає
     й бути не може: вони прописані в правилах бази, тож із
     списку тут відфільтровані, а екран малює їх окремо.

   • КУДИ ЙДУТЬ СПОВІЩЕННЯ — два документи колекції settings:
       settings/public — адреса воркера й пошта магазину; це
                         читає браузер покупця, тому секретів
                         там немає й бути не може;
       settings/notify — те саме плюс службові поля, доступні
                         лише адміністратору.
     Обидва пишуться однією пачкою: публічна копія має існувати
     завжди, інакше сайт із оновленими правилами лишиться без
     адреси воркера й замовлення прийдуть без листа.

   Розмітки тут немає: вкладки, список адміністраторів, поля
   форми й рядок стану малює React. Звідси пішли renderAdmins,
   renderLegacyTg, showSettingsTab і setSettingsStatus — лишились
   самі рішення й тексти, які вони показували.

   Ключ адміністратора воркера (ADMIN_KEY) сюди не переїхав: він
   живе лише в браузері адміна (localStorage), а модуль має
   працювати й поза браузером — тому приходить аргументом.
   ============================================================ */

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore
} from 'firebase/firestore';

import { normalizeUrl } from '../notify';
import { FOUNDERS } from './access';
import type { StatusKind, StatusLine } from './publish';

/* Перелік постійних адміністраторів потрібен і екрану — він
   показує їх окремим блоком «постійний». Другий примірник тут
   розійшовся б із перевіркою доступу, тож просто передаємо далі. */
export { FOUNDERS } from './access';

export const ADMIN_COL = 'admins';
export const SETTINGS_COL = 'settings';

/* ============================================================
   АДМІНІСТРАТОРИ
   ============================================================ */

export interface AdminEntry {
  email: string;
  /** Пошта того, хто натиснув «Додати». */
  by?: string;
  /** Час додавання — Timestamp Firestore; екран його не показує. */
  added?: unknown;
}

/** Перелік доданих адміністраторів. Постійні звідси прибрані:
 *  прибрати їх усе одно не можна, а показує їх екран окремо.
 *
 *  Помилка читання дає порожній список, а не виняток: колекцію
 *  admins бачить не кожен, і екран має відкритись у будь-якому
 *  разі — хоча б із постійними. */
export async function loadAdmins(db: Firestore): Promise<AdminEntry[]> {
  try {
    const snap = await getDocs(collection(db, ADMIN_COL));
    return snap.docs
      .map((x) => ({ email: x.id, ...x.data() }) as AdminEntry)
      .filter((a) => !FOUNDERS.includes(a.email));
  } catch {
    return [];
  }
}

export type AdminCheck =
  | { ok: true; email: string }
  | { ok: false; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Перевірка перед додаванням. Пошта нормалізується до нижнього
 *  регістру, бо саме в такому вигляді вона стає id документа й
 *  саме так її порівнюють правила бази: «Ivan@…» і «ivan@…» дали
 *  б два записи, з яких працював би один. */
export function checkAdminEmail(raw: string, admins: AdminEntry[]): AdminCheck {
  const email = String(raw || '').trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: 'Введіть коректний email' };
  }
  if (FOUNDERS.includes(email)) {
    return { ok: false, message: 'Цей email вже постійний адміністратор' };
  }
  if (admins.some((a) => a.email === email)) {
    return { ok: false, message: 'Такий адміністратор вже доданий' };
  }
  return { ok: true, email: email };
}

/** Результат дії над переліком: ok вирішує й тон повідомлення —
 *  в старій адмінці успіх ішов зеленим тостом, відмова звичайним. */
export interface AdminActionResult {
  ok: boolean;
  toast: string;
}

/** Додає адміністратора. Викликати після checkAdminEmail — email
 *  сюди має прийти вже перевіреним і в нижньому регістрі. */
export async function addAdmin(
  db: Firestore,
  email: string,
  by: string
): Promise<AdminActionResult> {
  try {
    await setDoc(doc(db, ADMIN_COL, email), {
      added: serverTimestamp(),
      by: by || ''
    });
    return { ok: true, toast: 'Адміністратора додано ✓' };
  } catch {
    return { ok: false, toast: 'Немає прав додавати адміністраторів' };
  }
}

export async function removeAdmin(db: Firestore, email: string): Promise<AdminActionResult> {
  try {
    await deleteDoc(doc(db, ADMIN_COL, email));
    return { ok: true, toast: 'Адміністратора прибрано' };
  } catch {
    return { ok: false, toast: 'Немає прав' };
  }
}

/** Питання перед прибиранням — воно називає пошту, тому текст
 *  збирається тут, поряд із самою дією. */
export function removeAdminAsk(email: string): string {
  return 'Прибрати адміністратора ' + email + '?';
}

/* ============================================================
   НАЛАШТУВАННЯ СПОВІЩЕНЬ
   ============================================================ */

/** Те, що адмін справді редагує. Обидва поля лягають і в
 *  settings/notify, і в settings/public. */
export interface SettingsForm {
  workerUrl: string;
  fsEmail: string;
}

/** Токен Telegram більше не редагується в адмінці — він живе у
 *  змінних воркера. Старе значення з бази лише показуємо, щоб
 *  було що перенести, і даємо кнопку його прибрати. */
export interface LegacyTg {
  tgToken: string;
  tgChatId: string;
}

/** settings/notify як він є. Усе необовʼязкове: документ пише і
 *  ця адмінка, і старіші її версії. */
export interface NotifyDoc {
  workerUrl?: string;
  fsEmail?: string;
  tgToken?: string;
  tgChatId?: string;
}

/** Значення полів форми як їх набрали. Нормалізує settingsFromForm. */
export interface SettingsFormValues {
  workerUrl: string;
  fsEmail: string;
}

export function settingsFromForm(values: SettingsFormValues): SettingsForm {
  return {
    workerUrl: normalizeUrl(values.workerUrl),
    fsEmail: values.fsEmail.trim()
  };
}

export interface TestSettings extends SettingsForm {
  tgToken?: string;
  tgChatId?: string;
}

/** Для перевірок додаємо старі значення з бази — щоб кнопки
 *  працювали і до переносу токена у воркер. У Firestore таке не
 *  пишемо: інакше токен потрапив би у публічний документ. */
export function settingsForTest(form: SettingsForm, legacy: LegacyTg | null): TestSettings {
  return { ...form, ...(legacy || {}) };
}

export function legacyTgFrom(s: NotifyDoc): LegacyTg | null {
  return s.tgToken || s.tgChatId
    ? { tgToken: s.tgToken || '', tgChatId: s.tgChatId || '' }
    : null;
}

/* ---------- Читання ---------- */

/** Повні налаштування — правила бази дозволяють settings/notify
 *  лише адміністраторам. null означає «не вдалося прочитати», а
 *  не «порожньо»: документа може ще не існувати, і тоді це {}. */
export async function loadAdminSettings(db: Firestore): Promise<NotifyDoc | null> {
  try {
    const snap = await getDoc(doc(db, SETTINGS_COL, 'notify'));
    return snap.exists() ? (snap.data() as NotifyDoc) : {};
  } catch {
    return null;
  }
}

/** Стан вікна налаштувань на момент відкриття. */
export interface SettingsScreen {
  /** Значення полів як вони лежать у базі — без normalizeUrl:
   *  адмін має бачити рівно те, що збережено. */
  values: SettingsFormValues;
  legacy: LegacyTg | null;
}

export function settingsScreen(s: NotifyDoc | null): SettingsScreen {
  const src = s || {};
  return {
    values: { workerUrl: src.workerUrl || '', fsEmail: src.fsEmail || '' },
    legacy: legacyTgFrom(src)
  };
}

/** Публічна копія: адреса воркера й пошта магазину, жодних
 *  ключів. Її читає браузер покупця. */
export async function syncPublicSettings(db: Firestore, form: SettingsForm): Promise<void> {
  await setDoc(doc(db, SETTINGS_COL, 'public'), form, { merge: true });
}

/** Дані для вікна налаштувань.
 *
 *  Публічну копію створюємо самі, не чекаючи «Зберегти»: інакше
 *  сайт, де правила вже оновлені, лишиться без адреси воркера —
 *  і замовлення прийдуть без листа й сповіщення. Без await і з
 *  проковтнутою помилкою, як у старій адмінці: немає прав —
 *  покаже під час збереження.
 *
 *  Стан воркера тут не питаємо: старе вікно робило це окремим
 *  тихим викликом checkWorker уже після відкриття, і лише коли
 *  адреса задана. */
export async function openSettings(db: Firestore): Promise<SettingsScreen> {
  const screen = settingsScreen(await loadAdminSettings(db));

  if (screen.values.workerUrl || screen.values.fsEmail) {
    void syncPublicSettings(db, {
      workerUrl: screen.values.workerUrl,
      fsEmail: screen.values.fsEmail
    }).catch(() => {});
  }

  return screen;
}

/* ---------- Запис ---------- */

/** Обидва документи однією пачкою: розійтись їм не можна.
 *  Публічний читає покупець, службовий — адмінка, а поля в них
 *  ті самі. */
export async function saveSettings(db: Firestore, data: SettingsForm): Promise<StatusLine> {
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, SETTINGS_COL, 'notify'), data, { merge: true });
    batch.set(doc(db, SETTINGS_COL, 'public'), data, { merge: true });
    await batch.commit();
    return { kind: 'ok', text: 'Налаштування збережено ✓' };
  } catch {
    return { kind: 'err', text: 'Немає прав зберігати налаштування' };
  }
}

/** Питання перед прибиранням токена з бази. Попередження про
 *  тест не формальність: після цього єдиним джерелом токена
 *  лишається воркер, і ненастроєний воркер означає тишу. */
export const WIPE_TG_ASK =
  'Прибрати токен і Chat ID із бази?\n\nПеред цим переконайтесь, що тестове ' +
  'повідомлення через воркер уже приходить — інакше сповіщення перестануть надходити.';

export async function wipeLegacyTg(db: Firestore): Promise<StatusLine> {
  try {
    await updateDoc(doc(db, SETTINGS_COL, 'notify'), {
      tgToken: deleteField(),
      tgChatId: deleteField()
    });
    return { kind: 'ok', text: 'Токен прибрано з бази ✓ Тепер він є лише у воркері' };
  } catch {
    return { kind: 'err', text: 'Не вдалося прибрати токен — спробуйте ще раз' };
  }
}

/* ============================================================
   СТАН ВОРКЕРА
   ------------------------------------------------------------
   Що саме налаштовано у воркері — без цього легко здогадуватись,
   чому лист або повідомлення не дійшли.
   ============================================================ */

export interface WorkerStatusOk {
  ok: true;
  resend: boolean;
  mailFrom: string;
  bcc: string;
  telegram: boolean;
  /** Скільки отримувачів у змінній TG_CHAT. */
  chats: number;
  adminKey: boolean;
}

export interface WorkerStatusFail {
  ok: false;
  description: string;
}

export type WorkerStatus = WorkerStatusOk | WorkerStatusFail;

/* Відповідь воркера розбираємо полем за полем: тип запиту в
   ньому службовий, і старіші розгортання частини полів просто
   не мають. */
async function callWorker(
  workerUrl: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const url = normalizeUrl(workerUrl);
  if (!url) return { ok: false, error: 'не вказано адресу Worker у налаштуваннях' };

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && !data.error) data.error = 'воркер відповів кодом ' + res.status;
    return data;
  } catch {
    return { ok: false, error: 'не вдалося звʼязатися з воркером — перевірте адресу' };
  }
}

/** ADMIN_KEY у воркері необовʼязковий, але якщо заданий — без
 *  нього службові запити не проходять. Ключ приходить аргументом:
 *  зберігає його браузер адміна, а не цей модуль. */
export async function workerStatus(
  workerUrl: string,
  key: string,
  fetchImpl: typeof fetch = fetch
): Promise<WorkerStatus> {
  const res = await callWorker(workerUrl, { type: 'status', key: key }, fetchImpl);
  if (!res.ok) {
    return { ok: false, description: String(res.error || '') || 'воркер не відповів' };
  }
  return {
    ok: true,
    resend: !!res.resend,
    mailFrom: String(res.mailFrom || ''),
    bcc: String(res.bcc || ''),
    telegram: !!res.telegram,
    chats: Number(res.chats) || 0,
    adminKey: !!res.adminKey
  };
}

/** 'skip' — для того, що не задане, але й не обовʼязкове:
 *  червоний хрестик там лише лякає. */
export type WorkerLineState = 'on' | 'off' | 'skip';

export interface WorkerLine {
  state: WorkerLineState;
  label: string;
  /** Уточнення дрібним шрифтом; порожнє — рядок без нього. */
  extra: string;
}

export type WorkerReport =
  | { ok: false; error: string }
  | { ok: true; tone: 'ok' | 'warn'; lines: WorkerLine[] };

function line(state: WorkerLineState, label: string, extra: string): WorkerLine {
  return { state: state, label: label, extra: extra };
}

export function workerReport(res: WorkerStatus): WorkerReport {
  if (!res.ok) {
    return { ok: false, error: 'Воркер не відповів: ' + (res.description || 'невідома помилка') };
  }

  return {
    ok: true,
    tone: res.resend && res.telegram && res.chats > 0 ? 'ok' : 'warn',
    lines: [
      line(
        res.resend ? 'on' : 'off',
        'Resend (листи покупцям)',
        res.mailFrom || 'RESEND_KEY не задано'
      ),
      line(
        res.telegram && res.chats > 0 ? 'on' : 'off',
        'Telegram (сповіщення вам)',
        !res.telegram
          ? 'TG_TOKEN не задано'
          : !res.chats
            ? 'TG_CHAT не задано'
            : 'отримувачів: ' + res.chats
      ),
      line(
        res.adminKey ? 'on' : 'skip',
        'ADMIN_KEY — службові кнопки під захистом',
        res.adminKey ? '' : 'не заданий (необовʼязково)'
      )
    ]
  };
}

export type CheckWorkerResult =
  /** Адреси немає — питати нічого. Старе вікно ховало блок стану
   *  й показувало цей текст лише коли перевірку натиснули руками
   *  (тихий виклик після відкриття мовчав). */
  | { kind: 'no-url'; status: string }
  | { kind: 'report'; report: WorkerReport };

export async function checkWorker(
  rawUrl: string,
  key: string,
  fetchImpl: typeof fetch = fetch
): Promise<CheckWorkerResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { kind: 'no-url', status: 'Спершу вкажіть адресу Worker' };

  return { kind: 'report', report: workerReport(await workerStatus(url, key, fetchImpl)) };
}

/* ============================================================
   ПОМИЛКИ TELEGRAM
   ------------------------------------------------------------
   Bot API відповідає англійською й натяками. Кожен рядок нижче —
   готова інструкція, що саме натиснути, бо всі ці помилки
   виправляються в Cloudflare, а не в коді.
   ============================================================ */

export function tgErrorHint(description: string | null | undefined): string {
  const text = String(description || '');
  const d = text.toLowerCase();

  if (d.includes('tg_token')) {
    return 'У воркері немає змінної TG_TOKEN: Cloudflare → ваш воркер → Settings → ' +
      'Variables and Secrets → Add → тип Secret → потім обовʼязково Deploy';
  }
  if (d.includes('tg_chat')) {
    return 'У воркері немає змінної TG_CHAT. Натисніть «Показати Chat ID», ' +
      'скопіюйте значення у цю змінну і натисніть Deploy';
  }
  if (d.includes('admin_key')) {
    return 'Невірний ключ адміністратора — впишіть те саме значення, що у змінній ADMIN_KEY воркера';
  }
  if (d.includes('email отримувача') || d.includes('порожнє замовлення')) {
    return 'Код воркера застарілий — замініть його вмістом new/worker/worker.js і натисніть Deploy';
  }
  // Помилки самого воркера вже українською — переказувати нічого
  if (d.includes('воркер')) return text;
  if (d.includes("bots can't send messages to bots") || d.includes('bot can')) {
    return 'У TG_CHAT вказано ID бота замість вашого. Натисніть «Показати Chat ID» — там правильні значення';
  }
  if (d.includes('chat not found')) {
    return 'Чат не знайдено: напишіть своєму боту будь-що (натисніть Start) і спробуйте ще раз';
  }
  if (d.includes('unauthorized')) {
    return 'Невірний токен бота — перевірте значення TG_TOKEN у воркері (видає @BotFather)';
  }
  if (d.includes('blocked')) {
    return 'Бот заблокований у вашому Telegram — розблокуйте його';
  }
  return text || 'Перевірте змінні TG_TOKEN і TG_CHAT у воркері';
}

/* ============================================================
   ПЕРЕВІРКИ
   ------------------------------------------------------------
   Три кнопки в налаштуваннях, і кожна відповідає на своє
   питання: чи бачить воркер Telegram, чи вміє слати листи, і
   куди саме йдуть повідомлення.

   Результат тут — не «ok / не ok», а готовий рядок стану:
   різниця між «надіслано двом із трьох» і «нічого не пішло»
   визначає, що робити далі, і губити її не можна.
   ============================================================ */

export interface TestResult {
  kind: StatusKind;
  text: string;
}

/** Ключ адміністратора воркера живе лише в браузері адміна —
 *  у базу він не потрапляє навіть випадково. */
export const KEY_WORKER = 'reyter:workerKey';

async function callAdmin(
  s: TestSettings,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  const url = normalizeUrl(s.workerUrl);
  if (!url) return { ok: false, error: 'не вказано адресу Worker у налаштуваннях' };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && !data.error) data.error = 'воркер відповів кодом ' + res.status;
    return data;
  } catch {
    return { ok: false, error: 'не вдалося звʼязатися з воркером — перевірте адресу' };
  }
}

export interface DetectedChat {
  id: string;
  name: string;
  isGroup: boolean;
}

export interface DetectChatsResult {
  kind: StatusKind;
  text: string;
  chats: DetectedChat[];
  /** Рівно те, що треба вписати у змінну TG_CHAT воркера:
   *  id через кому з пробілом — саме в такому вигляді. */
  value: string;
}

export async function detectChats(
  s: TestSettings,
  adminKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<DetectChatsResult> {
  const res = await callAdmin(s, { type: 'tg-chats', key: adminKey }, fetchImpl);
  const raw = Array.isArray(res.chats) ? (res.chats as Record<string, unknown>[]) : [];

  if (!res.ok || !raw.length) {
    return {
      kind: 'err',
      text: tgErrorHint(String(res.error ?? res.description ?? '')),
      chats: [],
      value: ''
    };
  }

  const chats: DetectedChat[] = raw.map((c) => ({
    id: String(c.id ?? ''),
    // чат без назви теж треба показати — інакше його id виглядає нізвідки
    name: String(c.name ?? '') || 'без назви',
    isGroup: !!c.isGroup
  }));

  return {
    kind: 'ok',
    text: 'Впишіть це у змінну TG_CHAT вашого воркера й натисніть Deploy',
    chats,
    value: chats.map((c) => c.id).join(', ')
  };
}

export async function testTelegram(
  s: TestSettings,
  adminKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<TestResult> {
  const res = await callAdmin(s, { type: 'tg-test', key: adminKey }, fetchImpl);
  const sent = Number(res.sent) || 0;
  const total = Number(res.total) || 0;

  if (sent > 0 && sent === total) {
    return { kind: 'ok', text: `Надіслано отримувачам: ${sent} ✓ Перевірте Telegram` };
  }
  /* Часткова відправка — окремий випадок: половина команди
     повідомлення отримає, половина ні, і мовчати про це не можна */
  if (sent > 0) {
    return {
      kind: 'err',
      text: `Надіслано ${sent} із ${total}. Не вдалося: ` +
        tgErrorHint(String(res.error ?? res.description ?? ''))
    };
  }
  return { kind: 'err', text: tgErrorHint(String(res.error ?? res.description ?? '')) };
}

export async function testEmail(
  s: TestSettings,
  to: string,
  adminKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<TestResult> {
  // питаємо ДО запиту: без отримувача воркеру нема куди слати
  if (!to.trim()) return { kind: 'err', text: 'Вкажіть email для тесту' };

  const res = await callAdmin(
    s,
    {
      type: 'order',
      silent: true,
      key: adminKey,
      to: to.trim(),
      name: 'Тест',
      phone: '+380000000000',
      orderNum: 'R-TEST-000',
      items: [{ name: 'Бріфи classic', size: 'M', qty: 1, sum: '550 грн' }],
      total: '550 грн',
      subtotal: '550 грн',
      discount: '',
      shipping: '',
      promoCode: '',
      delivery: 'Нова Пошта, Київ, Відділення №12',
      comment: 'Це тестове замовлення — реагувати не потрібно',
      confirm: 'Telegram · +380000000000 · @test',
      source: 'Тест',
      lang: 'uk'
    },
    fetchImpl
  );

  const email = (res.email ?? {}) as { ok?: boolean; error?: string };
  if (email.ok) {
    return { kind: 'ok', text: 'Фірмовий лист надіслано ✓ Перевірте пошту (і папку Спам)' };
  }
  return {
    kind: 'err',
    text: String(email.error ?? res.error ?? 'Не вдалося надіслати')
  };
}
