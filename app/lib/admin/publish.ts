/* ============================================================
   REYTER — публікація каталогу
   ------------------------------------------------------------
   Адмінка редагує ЧЕРНЕТКУ (колекції catalog_*), а покупець
   бачить знімок published/catalog. Запланована версія лежить у
   published/next і вмикається сама, щойно годинник покупця
   перейде publishAt — тримати адмінку відкритою не треба.

   Той самий published/next читає сайт: firestore.ts → loadCatalog
   бере products і categories з кореня документа, а publishAt
   порівнює як ЧИСЛО. Тому знімок кладеться розсипом (не вкладеним
   обʼєктом), а час публікації — мілісекундами, не Timestamp.

   Портовано з js/admin.js (перший IIFE) один в один. Без DOM:
   діалог, бейдж і рядок стану малює React, тож звідси пішли
   renderPublishDialog, refreshPublishBadge і setPublishStatus —
   лишились самі тексти, які вони показували. Захист від
   подвійного кліку (pubBusy) теж лишився на боці UI: це стан
   кнопки, а не даних.
   ============================================================ */

import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Firestore
} from 'firebase/firestore';
import type { Category, Product } from '../types';

/* ---------- Типи ---------- */

/** Чернетка так, як адмінка тримає її в памʼяті. Це не Catalog із
 *  types.ts: там уже опублікована версія разом із часом
 *  наступної. */
export interface Draft {
  categories: Category[];
  products: Product[];
}

/** Те, що лягає в published/*: копія чернетки на момент дії. */
export type Snapshot = Draft;

/** published/catalog. Поля необовʼязкові, бо документ пише і ця
 *  адмінка, і старіші її версії. */
export interface PublishedDoc {
  categories?: Category[];
  products?: Product[];
  publishedAt?: unknown;
  publishedBy?: string;
}

/** published/next — те саме плюс час, коли версія має ожити. */
export interface ScheduledDoc extends PublishedDoc {
  publishAt?: number;
  scheduledAt?: unknown;
  scheduledBy?: string;
}

/** Обидві версії разом: жодна дія не змінює одну, не подивившись
 *  на другу. */
export interface PublishedPair {
  published: PublishedDoc | null;
  scheduled: ScheduledDoc | null;
}

/** Хто публікує. Firebase User підходить як є — потрібна сама
 *  лише пошта, вона й лягає в документ. */
export interface PublishUser {
  email?: string | null;
}

export type StatusKind = 'wait' | 'ok' | 'err';

/** Рядок стану в діалозі публікації: клас і текст, як їх ставив
 *  setPublishStatus. */
export interface StatusLine {
  kind: StatusKind;
  text: string;
}

export interface PublishDeps {
  /** null — Firebase у цьому оточенні не піднявся; дія віддасть
   *  ту саму помилку, що й відмова бази. */
  db: Firestore | null;
  user: PublishUser | null;
  /** Проміжний стан ('wait') видно лише через колбек: у
   *  результаті він уже змінений на кінцевий. */
  onStatus?: (status: StatusLine) => void;
  /** Резервний data.js у репозиторії. Викликається без await:
   *  публікація від GitHub не залежить. */
  backup?: (snap: Snapshot) => void;
}

export interface PublishResult {
  ok: boolean;
  status: StatusLine;
  /** Спливне повідомлення при успіху. */
  toast?: string;
  /* Нові версії приходять ЛИШЕ при успіху; поле, якого немає,
     означає «не чіпали» — при помилці чинним лишається те, що
     викликач мав досі. null тут — це «немає версії», а не
     «без змін». */
  published?: PublishedDoc | null;
  scheduled?: ScheduledDoc | null;
}

/* ---------- Резервна копія в GitHub ---------- */

export const GH = {
  owner: 'patzmaxim0407-png',
  repo: 'reyter',
  branch: 'main',
  path: 'backup/data.js'
};

export type GhRepo = typeof GH;

export const KEY_TOKEN = 'reyter:admin:token';

/* ============================================================
   ЧИСТІ ФУНКЦІЇ
   ============================================================ */

/** Стабільний JSON: ключі відсортовані, undefined відкинуто —
 *  інакше однакові дані з різних джерел «відрізняються».
 *
 *  Firestore повертає документ без полів, яких у ньому немає, а
 *  чернетка в памʼяті ті самі поля може мати зі значенням
 *  undefined. Без цього фільтра кожен вхід в адмінку показував би
 *  неопубліковані зміни на порожньому місці. */
export function stableStr(o: unknown): string {
  if (Array.isArray(o)) return '[' + (o as unknown[]).map((x) => stableStr(x)).join(',') + ']';
  if (o && typeof o === 'object') {
    const rec = o as Record<string, unknown>;
    return '{' + Object.keys(rec).sort()
      .filter((k) => rec[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stableStr(rec[k]))
      .join(',') + '}';
  }
  return JSON.stringify(o === undefined ? null : o);
}

/** Копія чернетки на цю мить: далі її редагують далі, а в базу
 *  має піти саме те, що адмін бачив у діалозі.
 *
 *  Клон через JSON, а не structuredClone: він заодно викидає
 *  поля зі значенням undefined, яких Firestore не приймає. */
export function snapshotDraft(draft: Draft): Snapshot {
  return {
    categories: JSON.parse(JSON.stringify(draft.categories)) as Category[],
    products: JSON.parse(JSON.stringify(draft.products)) as Product[]
  };
}

/** Чи є неопубліковані зміни.
 *
 *  Поки каталог не імпортовано в базу (seeded === false), чернетка
 *  — це просто вміст data.js, і «змінами» вона не рахується. */
export function draftDiffers(
  draft: Draft,
  published: PublishedDoc | null,
  seeded: boolean
): boolean {
  if (!seeded || !draft.products.length) return false;
  if (!published) return true;

  /* Товари звіряємо за вмістом, а не за порядком у масиві.

     Опубліковане зібране з двох документів — відкритого й
     закритого, — і закриті товари при складанні опиняються в
     кінці, хоч у чернетці стоять серед інших. Порівняння «рядок
     у рядок» через це завжди бачило б різницю, і кнопка
     «Опублікувати» світилася б вічно: опублікуєш, оновиш
     сторінку — а вона знову горить.

     Втратити цим нічого: порядок товарів руками ніде не
     міняють — на відміну від категорій, які так і звіряються за
     порядком. */
  const byId = (list: Product[]) =>
    [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return stableStr({ c: draft.categories, p: byId(draft.products) }) !==
         stableStr({ c: published.categories || [], p: byId(published.products || []) });
}

/** Чернетку правили вже після того, як розклад зберегли: у
 *  призначений час сайт перейде на застарілу версію. */
export function scheduledStale(draft: Draft, scheduled: ScheduledDoc | null): boolean {
  if (!scheduled) return false;
  return stableStr({ c: draft.categories, p: draft.products }) !==
         stableStr({ c: scheduled.categories || [], p: scheduled.products || [] });
}

/* ---------- Час ---------- */

export function fmtWhen(ts: number | string | null | undefined): string {
  return new Date(Number(ts)).toLocaleString('uk-UA', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  });
}

/** Значення для <input type="datetime-local">. Не toISOString:
 *  той дав би UTC, і адмін призначив би публікацію не на ту
 *  годину, яку бачить на годиннику. */
export function toLocalInput(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/** Що підставити в поле вибору часу, коли його щойно відкрили. */
export function defaultScheduleAt(now: Date): Date {
  const d = new Date(now.getTime() + 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return d;
}

export type ScheduleCheck =
  | { ok: true; ts: number }
  | { ok: false; status: StatusLine };

/** Перевірка часу з поля перед тим, як зберігати розклад.
 *  Хвилина запасу: поки діалог відкритий, «через мить» встигає
 *  стати минулим. */
export function checkScheduleTime(value: string, now: Date): ScheduleCheck {
  const ts = value ? new Date(value).getTime() : NaN;
  if (!ts || isNaN(ts)) {
    return { ok: false, status: { kind: 'err', text: 'Оберіть дату й час публікації' } };
  }
  if (ts < now.getTime() + 60 * 1000) {
    return { ok: false, status: { kind: 'err', text: 'Цей час уже минув — оберіть майбутній момент' } };
  }
  return { ok: true, ts: ts };
}

/* ---------- Опис змін ---------- */

/** Товар і категорія разом: назва в них у різних полях. */
interface Named {
  id: string;
  title?: string;
  name?: string;
}

export function fewNames(list: readonly Named[]): string {
  const names = list.slice(0, 3).map((x) => x.title || x.name || x.id);
  return names.join(', ') + (list.length > 3 ? '…' : '');
}

/** Що саме поїде на сайт — людською мовою, для діалогу
 *  публікації. Порівнюємо з опублікованою версією, а не з базою:
 *  адмін має бачити різницю рівно з тим, що зараз бачить
 *  покупець. */
export function diffSummary(draft: Draft, published: PublishedDoc | null): string[] {
  const pub: PublishedDoc = published || { categories: [], products: [] };
  const pubP: Record<string, Product> = {};
  const pubC: Record<string, Category> = {};
  (pub.products || []).forEach((p) => { pubP[p.id] = p; });
  (pub.categories || []).forEach((c) => { pubC[c.id] = c; });

  const addedP = draft.products.filter((p) => !pubP[p.id]);
  const removedP = (pub.products || []).filter((p) => !draft.products.some((x) => x.id === p.id));
  const changedP = draft.products.filter((p) => pubP[p.id] && stableStr(p) !== stableStr(pubP[p.id]));
  const addedC = draft.categories.filter((c) => !pubC[c.id]);
  const removedC = (pub.categories || []).filter((c) => !draft.categories.some((x) => x.id === c.id));
  const changedC = draft.categories.filter((c) => pubC[c.id] && stableStr(c) !== stableStr(pubC[c.id]));

  const lines: string[] = [];
  if (addedP.length) lines.push('нові товари — ' + addedP.length + ': ' + fewNames(addedP));
  if (changedP.length) lines.push('змінені товари — ' + changedP.length + ': ' + fewNames(changedP));
  if (removedP.length) lines.push('видалені товари — ' + removedP.length + ': ' + fewNames(removedP));
  if (addedC.length) lines.push('нові категорії: ' + fewNames(addedC));
  if (changedC.length) lines.push('змінені категорії: ' + fewNames(changedC));
  if (removedC.length) lines.push('видалені категорії: ' + fewNames(removedC));
  // Порядок і службові поля в перелік не потрапляють, але змінами
  // лишаються — інакше діалог мовчав би при активній кнопці
  if (!lines.length) lines.push('зміни порядку або службових полів');
  return lines;
}

/* ---------- data.js ---------- */

/** Конфіг сайту з data.js. Форма тут не важлива: він переїжджає
 *  в резервну копію як є. */
export type SiteConfig = Record<string, unknown>;

/** Резервна копія каталогу у вигляді data.js. Сайт показує цей
 *  файл, поки вантажиться база, тож формат мусить лишатись
 *  таким, який очікує старий рушій. */
export function buildDataJs(snap: Snapshot, config: SiteConfig, now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
  const cats = snap.categories.map((c) => {
    const out: Category = { id: c.id, title: c.title, order: c.order };
    if (c.titleEn) out.titleEn = c.titleEn;
    return out;
  });
  return (
    '/* ============================================================\n' +
    '   REYTER — резервна копія каталогу\n' +
    '   Згенеровано адмінкою ' + stamp + '\n' +
    '   Сайт показує ці дані, поки завантажується база (Firestore).\n' +
    '   ============================================================ */\n\n' +
    'window.REYTER = window.REYTER || {};\n\n' +
    'REYTER.config = ' + JSON.stringify(config, null, 2) + ';\n\n' +
    'REYTER.categories = ' + JSON.stringify(cats, null, 2) + ';\n\n' +
    'REYTER.products = ' + JSON.stringify(snap.products, null, 2) + ';\n'
  );
}

/* ============================================================
   FIRESTORE
   ============================================================ */

function pubDoc(db: Firestore, id: 'catalog' | 'next' | 'friendly') {
  return doc(db, 'published', id);
}

/* ============================================================
   ЗАКРИТІ ТОВАРИ ЛЕЖАТЬ ОКРЕМО
   ------------------------------------------------------------
   published/catalog читає весь світ — інакше сайт не відкрився б
   без входу й не був би швидким. Тому товар, позначений «тільки
   для Friendly Club», у цей документ не потрапляє ВЗАГАЛІ: інакше
   його побачив би кожен, хто вміє дивитись у мережеві запити,
   і вся закритість була б лише на вигляд.

   Він іде в published/friendly, а туди правила пускають лише
   учасників клубу. Не бачить його ні пошуковик, ні сервер
   вітрини, ні воркер без токена покупця — і саме тому це
   закритість, а не ширма. */
function splitFriendly(snap: Snapshot): { open: Snapshot; closed: Snapshot } {
  const all = snap.products || [];
  return {
    open: { ...snap, products: all.filter((p) => !p.friendly) },
    closed: { ...snap, products: all.filter((p) => !!p.friendly && !p.hidden) }
  };
}

/** Обидві версії однією дією.
 *
 *  null означає «прочитати не вдалося» — викликач лишає при собі
 *  те, що мав. Правила бази могли ще не знати про блок published,
 *  і адмінка має працювати далі, як до появи публікації. */
export async function loadPublished(db: Firestore | null): Promise<PublishedPair | null> {
  if (!db) return null;
  try {
    const [current, next, closed] = await Promise.all([
      getDoc(pubDoc(db, 'catalog')),
      getDoc(pubDoc(db, 'next')),
      getDoc(pubDoc(db, 'friendly'))
    ]);

    /* Опубліковане ЗБИРАЄМО НАЗАД із двох документів.

       Закриті товари лежать окремо — так їх не бачить сторонній.
       Але адмінка порівнює чернетку саме з опублікованим, і без
       цього складання кожен клубний товар вічно значився б
       «неопублікованим»: опублікуєш, оновиш сторінку — і він
       знову в переліку змін, бо у відкритому каталозі його немає
       й бути не може. */
    const open = current.exists() ? (current.data() as PublishedDoc) : null;
    const mine = closed.exists() ? (closed.data() as PublishedDoc) : null;
    const both =
      open && mine?.products?.length
        ? { ...open, products: [...(open.products || []), ...mine.products] }
        : open;

    return {
      published: both,
      scheduled: next.exists() ? (next.data() as ScheduledDoc) : null
    };
  } catch {
    return null;
  }
}

export interface HousekeepingInput {
  db: Firestore | null;
  /** Без адміна прибирання не робиться: усі записи нижче
   *  вимагають його прав. */
  user: PublishUser | null;
  draft: Draft;
  seeded: boolean;
  published: PublishedDoc | null;
  scheduled: ScheduledDoc | null;
  now?: Date;
  /** Разові міграції чернетки (структура категорій, фотографії).
   *  Вони живуть у своєму модулі, сюди приходять колбеками —
   *  важливий лише момент, коли їх запускати. */
  migrations?: Array<() => Promise<void>>;
  backup?: (snap: Snapshot) => void;
  warn?: (message: string, error: unknown) => void;
}

/** Прибирання при вході адміна:
 *  1) запланована версія, чий час настав, стає чинною;
 *  2) якщо публікацій ще не було — фіксуємо поточний стан, щоб
 *     сайт показував рівно те саме, що й досі;
 *  3) разові міграції чернетки.
 *
 *  Пункт 1 дублює те, що робить сам сайт (loadCatalog сам бере
 *  published/next, коли його час настав). Дублювання навмисне:
 *  без нього прострочений розклад висів би в базі вічно, і кожен
 *  наступний перегляд заново вирішував би, що він уже чинний.
 *
 *  Повертає стан на момент виходу — навіть якщо десь усередині
 *  зламалось: те, що встигло записатись, уже чинне. */
export async function housekeeping(input: HousekeepingInput): Promise<PublishedPair> {
  let published = input.published;
  let scheduled = input.scheduled;

  const db = input.db;
  if (!db || !input.user) return { published: published, scheduled: scheduled };

  const nowMs = (input.now ?? new Date()).getTime();

  try {
    if (scheduled && Number(scheduled.publishAt) <= nowMs) {
      const snap: Snapshot = {
        categories: scheduled.categories || [],
        products: scheduled.products || []
      };
      await setDoc(pubDoc(db, 'catalog'), {
        ...snap,
        publishedAt: serverTimestamp(),
        publishedBy: scheduled.scheduledBy || ''
      });
      await deleteDoc(pubDoc(db, 'next'));
      published = snap;
      scheduled = null;
      input.backup?.(snap);
    }

    if (!published && input.seeded && input.draft.products.length) {
      const snap = snapshotDraft(input.draft);
      await setDoc(pubDoc(db, 'catalog'), {
        ...snap,
        publishedAt: serverTimestamp(),
        publishedBy: input.user.email || ''
      });
      published = snap;
    }

    for (const migrate of input.migrations ?? []) await migrate();
  } catch (e) {
    // не ламаємо адмінку, але і не мовчимо — інакше причину
    // не знайти (типово: правила бази ще не оновлені)
    (input.warn ?? defaultWarn)('Прибирання при вході не завершилось:', e);
  }

  return { published: published, scheduled: scheduled };
}

function defaultWarn(message: string, error: unknown): void {
  console.warn(message, error);
}

/* ---------- Дії ---------- */

export async function publishNow(draft: Draft, deps: PublishDeps): Promise<PublishResult> {
  emit(deps, { kind: 'wait', text: 'Публікуємо…' });
  try {
    const db = required(deps.db);
    const snap = snapshotDraft(draft);
    const { open, closed } = splitFriendly(snap);

    await setDoc(pubDoc(db, 'catalog'), {
      ...open,
      publishedAt: serverTimestamp(),
      publishedBy: deps.user?.email || ''
    });
    /* Закриті — окремим документом і завжди, навіть коли їх нема
       жодного: інакше після зняття прапорця з останнього товару
       в ньому назавжди лишився б попередній перелік. */
    await setDoc(pubDoc(db, 'friendly'), {
      ...closed,
      publishedAt: serverTimestamp(),
      publishedBy: deps.user?.email || ''
    });
    // Розклад втратив сенс: чинною щойно стала свіжіша версія
    try {
      await deleteDoc(pubDoc(db, 'next'));
    } catch {
      /* його могло не бути */
    }
    const status = emit(deps, { kind: 'ok', text: 'Опубліковано ✓ Сайт уже показує нову версію' });
    deps.backup?.(snap);
    return {
      ok: true,
      status: status,
      toast: 'Опубліковано ✓',
      published: snap,
      scheduled: null
    };
  } catch {
    return {
      ok: false,
      status: emit(deps, {
        kind: 'err',
        text: 'Не вдалося опублікувати. Перевірте правила Firestore — потрібен блок published'
      })
    };
  }
}

/** ts — мілісекунди. Саме числом його читає сайт (firestore.ts →
 *  loadCatalog), тож serverTimestamp тут стояти не може: з
 *  Timestamp порівняння з Date.now() перестало б працювати, і
 *  запланована публікація не спрацювала б ніколи. */
export async function schedulePublish(
  draft: Draft,
  ts: number,
  deps: PublishDeps
): Promise<PublishResult> {
  emit(deps, { kind: 'wait', text: 'Зберігаємо розклад…' });
  try {
    const db = required(deps.db);
    const snap = snapshotDraft(draft);
    /* У заплановану версію закриті товари не кладемо: сайт читає
       її анонімно, і вона стала б дірою в тій самій стіні. Вони
       поїдуть у published/friendly, коли версія оживе. */
    const { open } = splitFriendly(snap);
    await setDoc(pubDoc(db, 'next'), {
      ...open,
      publishAt: ts,
      scheduledAt: serverTimestamp(),
      scheduledBy: deps.user?.email || ''
    });
    return {
      ok: true,
      status: emit(deps, {
        kind: 'ok',
        text: 'Заплановано на ' + fmtWhen(ts) +
          ' ✓ Сайт перейде на нову версію сам — тримати адмінку відкритою не треба'
      }),
      toast: 'Публікацію заплановано ✓',
      scheduled: { ...snap, publishAt: ts }
    };
  } catch {
    return {
      ok: false,
      status: emit(deps, {
        kind: 'err',
        text: 'Не вдалося запланувати. Перевірте правила Firestore — потрібен блок published'
      })
    };
  }
}

export async function cancelSchedule(deps: PublishDeps): Promise<PublishResult> {
  try {
    await deleteDoc(pubDoc(required(deps.db), 'next'));
    return {
      ok: true,
      status: emit(deps, { kind: 'ok', text: 'Заплановану публікацію скасовано' }),
      scheduled: null
    };
  } catch {
    return {
      ok: false,
      status: emit(deps, { kind: 'err', text: 'Не вдалося скасувати — спробуйте ще раз' })
    };
  }
}

function emit(deps: PublishDeps, status: StatusLine): StatusLine {
  deps.onStatus?.(status);
  return status;
}

/* Відсутня база йде тією ж дорогою, що й відмова бази: у старій
   адмінці звернення до R.fb.db просто падало всередині try. */
function required(db: Firestore | null): Firestore {
  if (!db) throw new Error('offline');
  return db;
}

/* ============================================================
   РЕЗЕРВНА КОПІЯ data.js
   ------------------------------------------------------------
   Сайт показує файл із репозиторію першим, поки вантажиться база.
   Публікація від GitHub не залежить — це фонове оновлення
   запасного джерела, і його невдача нічого не скасовує.
   ============================================================ */

export interface BackupDeps {
  /** Токен із поля діалогу або зі сховища адмінки. */
  token: string;
  config: SiteConfig;
  now: Date;
  /** Рядок під кнопкою; отримує й проміжне «Оновлюємо…». */
  onNote?: (note: string) => void;
  /** Токен, який спрацював, адмінка запамʼятовує (KEY_TOKEN у
   *  localStorage), а той, що не має прав, — забуває. Сховище
   *  сюди не тягнемо: модуль має жити й поза браузером. */
  rememberToken?: (token: string) => void;
  forgetToken?: () => void;
  repo?: GhRepo;
  /** Щоб тест не ходив у GitHub. */
  fetchImpl?: typeof fetch;
}

export type BackupReason = 'done' | 'no-token' | 'forbidden' | 'http' | 'offline';

export interface BackupResult {
  ok: boolean;
  /** Той самий текст, який показувала адмінка. */
  note: string;
  reason: BackupReason;
}

export async function backupDataJs(snap: Snapshot, deps: BackupDeps): Promise<BackupResult> {
  const token = deps.token.trim();
  if (!token) {
    return note(deps, false, 'no-token',
      'Резервний data.js не оновлено: не збережено GitHub-токен (поле вище).');
  }
  deps.rememberToken?.(token);

  const gh = deps.repo ?? GH;
  const call = deps.fetchImpl ?? fetch;
  const api = 'https://api.github.com/repos/' + gh.owner + '/' + gh.repo + '/contents/' + gh.path;
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json'
  };

  try {
    deps.onNote?.('Оновлюємо резервний data.js…');
    const getRes = await call(api + '?ref=' + gh.branch, { headers: headers });
    if (getRes.status === 401 || getRes.status === 403) {
      deps.forgetToken?.();
      return note(deps, false, 'forbidden',
        'Резервний data.js не оновлено: токен не має дозволу Contents: Read and write.');
    }
    if (!getRes.ok) {
      return note(deps, false, 'http',
        'Резервний data.js не оновлено (GitHub відповів ' + getRes.status + ').');
    }
    // sha попередньої версії — GitHub без нього перезапис відхилить
    const info = (await getRes.json()) as { sha?: string };

    const putRes = await call(api, {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify({
        message: 'Публікація каталогу з адмінки',
        content: b64(buildDataJs(snap, deps.config, deps.now)),
        sha: info.sha,
        branch: gh.branch
      })
    });
    return putRes.ok
      ? note(deps, true, 'done', 'Резервний data.js оновлено ✓')
      : note(deps, false, 'http',
        'Резервний data.js не оновлено (GitHub відповів ' + putRes.status + ').');
  } catch {
    return note(deps, false, 'offline',
      'Резервний data.js не оновлено — немає звʼязку з GitHub.');
  }
}

function note(deps: BackupDeps, ok: boolean, reason: BackupReason, text: string): BackupResult {
  deps.onNote?.(text);
  return { ok: ok, note: text, reason: reason };
}

/* GitHub приймає вміст файлу лише в base64, а btoa працює з
   байтами: без цієї пари українські назви товарів його зламали б */
function b64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}
