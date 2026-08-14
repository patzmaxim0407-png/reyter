/* ============================================================
   REYTER — фото товарів в адмінці
   ------------------------------------------------------------
   Портовано з js/admin.js (перша IIFE) один в один: підготовка
   зображення, вивантаження у Firebase Storage і разова міграція
   старих фото з репозиторію у сховище.

   Фото живуть у хмарному сховищі проєкту, а не в репозиторії.
   Перед відправкою їх зменшують і переганяють у WebP: оригінали
   з телефона важать по 4–6 МБ, і саме від цієї обробки залежить
   вага сторінки каталогу.

   Це єдиний модуль порту, якому браузер потрібен по суті: без
   Image і canvas зображення не зменшити. Але сторінки він не
   торкається — полотно створюється відчепленим і в документ не
   потрапляє, а весь прогрес, який стара панель писала у
   #fUploadStatus і в смужку .a-migbar, іде назовні через
   необовʼязковий onProgress.

   Три вимушені відмінності від оригіналу — механіка, не зміст:
   • замість compat-обгортки R.fb — модульний SDK: вивантаження
     робить uploadBytes, адресу віддає getDownloadURL (про форму
     адреси — коментар у storageUpload);
   • стан адмінки модуль не тримає, тож каталог, база й поточний
     адмін приходять аргументом, а не з глобального R;
   • migratePhotos більше не переписує state.products на місці:
     нові адреси повертаються у changed, і застосовує їх той, хто
     цим станом володіє.
   ============================================================ */

import {
  ref,
  uploadBytes,
  updateMetadata,
  getDownloadURL,
  type FirebaseStorage
} from 'firebase/storage';
import { doc, getDoc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Product } from '../types';

/** Довша сторона зображення після зменшення. */
export const MAX_SIDE = 1600;

/** Якість WebP. Число зі старої адмінки: від нього напряму
 *  залежить вага каталогу, тож наосліп його не крутять. */
export const WEBP_QUALITY = 0.82;

/* Чернетка каталогу. Сайт читає published/*, тож нові адреси
   дійдуть до нього лише після публікації — доти він працює на
   старих шляхах і нічого не помічає. */
const PRODUCTS_COL = 'catalog_products';

/* ---------- Залежності ---------- */

/** Куди ллємо і від чийого імені. */
export interface StorageDeps {
  storage: FirebaseStorage;
  /** Правила сховища (firebase/storage.rules) пускають на запис лише
   *  адмінів. Без користувача SDK піде анонімно й отримає відмову
   *  вже посеред вивантаження — краще спинитись одразу. */
  user: User | null;
}

/* ---------- Підготовка зображення ---------- */

/** Зображення з файла або з адреси — у вигляді, придатному для
 *  canvas.drawImage. */
export function fileToImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const img = new Image();
    /* Тимчасову адресу віддаємо назад одразу після завантаження:
       objectURL живе до кінця вкладки й тримає файл у памʼяті.
       Рядок прийшов ззовні — там відкликати нічого. */
    img.onload = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      reject(new Error('Не вдалося прочитати зображення'));
    };
    img.src = url;
  });
}

/** Зменшене зображення у WebP. */
export async function toWebp(src: string | Blob): Promise<Blob> {
  const img = await fileToImage(src);

  /* Math.min(1, …) — зменшуємо, але ніколи не збільшуємо:
     розтягнута маленька картинка тільки важчає, а різкості не
     набирає. Сама конвертація не пропускається ніколи: навіть
     зображення, менше за MAX_SIDE, переїжджає у WebP — основну
     економію дає саме формат, а не масштаб. */
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  // Полотно нульового розміру браузер не приймає
  const w = Math.round(img.width * scale) || 1;
  const h = Math.round(img.height * scale) || 1;

  /* Полотно відчеплене: воно ніде не показується і в документ не
     додається — це просто буфер під перекодування. */
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  // Контексту не буде, якщо памʼяті під полотно не вистачило
  if (!ctx) throw new Error('Не вдалося підготувати зображення');
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, 'image/webp', WEBP_QUALITY)
  );
  if (!blob) throw new Error('Браузер не вміє WebP');
  return blob;
}

/* ---------- Адреса у сховищі ---------- */

/** Імʼя файла, придатне для шляху у сховищі. */
export function slugFile(name: string): string {
  /* З назви лишається тільки латиниця з цифрами: кирилиця й
     пробіли в посиланні перетворюються на %D0%…, і адреса фото
     стає нечитабельною. Назва з самої кирилиці зникає повністю —
     тоді підставляємо 'photo'. */
  return (
    String(name)
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'photo'
  );
}

/** Шлях у сховищі: products/<артикул>/<мітка часу>-<n>-<імʼя>.webp */
export function storagePath(article: string, n: number, name: string): string {
  // Артикул стає текою, тож із нього теж лишається сама латиниця
  const dir = (article || 'misc').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'misc';
  /* Мітка часу в імені — щоб перезавантажене фото не збіглося
     шляхом зі старим і не дісталося з кешу браузера замість
     нового. */
  return 'products/' + dir + '/' + Date.now() + '-' + n + '-' + slugFile(name) + '.webp';
}

/* ---------- Вивантаження ---------- */

/** Заливає blob у Storage і повертає публічну адресу.
 *
 *  Читання за правилами відкрите всім (storage.rules), тож фото
 *  показується будь-кому без авторизації. Адресу віддає
 *  getDownloadURL — на відміну від старої, зібраної вручну, у ній
 *  є службовий token; для показу це нічого не змінює, але сама
 *  адреса вже не виводиться зі шляху. */
export async function storageUpload(
  deps: StorageDeps,
  path: string,
  blob: Blob
): Promise<string> {
  if (!deps.user) throw new Error('Увійдіть акаунтом адміністратора');

  try {
    /* Сховище за замовчуванням віддає фото з «private, max-age=0»
       — тобто браузер не кешує їх узагалі й перезавантажує
       щоразу. У списку товарів це означає кілька мегабайтів на
       кожне відкриття випадайки. Імʼя файла містить відбиток
       часу, тож старе фото ніколи не приходить під новим
       посиланням, і кешувати його можна назавжди. */
    const res = await uploadBytes(ref(deps.storage, path), blob, {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable'
    });
    return await getDownloadURL(res.ref);
  } catch (err) {
    /* Відмова сховища майже завжди означає одне: правила у
       Firebase Console ще не оновлені. Помилка має вести до
       файлу з ними, інакше причину не знайти. */
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
      throw new Error(
        'Сховище не пускає: вставте правила з файлу firebase/storage.rules у Firebase Console → Storage → Rules'
      );
    }
    // HTTP-статусу модульний SDK назовні не дає — лишається його код
    throw new Error('Сховище відповіло кодом ' + (code || 'невідома помилка'));
  }
}

/** Що відбувається під час вивантаження. Перші три стани — те
 *  саме, що setUploadStatus писав у панель (клас + текст), а
 *  'photo' заміняє собою renderPhotos(): у старій адмінці
 *  мініатюра зʼявлялась одразу після кожного файла, а не після
 *  останнього. */
export type UploadProgress =
  | { kind: 'wait' | 'ok' | 'err'; text: string }
  | { kind: 'photo'; url: string };

export interface UploadPhotosResult {
  /** Адреси залитих фото — у порядку файлів. */
  urls: string[];
  /** false — на якомусь файлі зупинились. */
  ok: boolean;
  /** Текст помилки, з якою спинились. Порожній, коли ok. */
  error: string;
}

/** Готує й заливає вибрані файли по черзі.
 *
 *  Перша ж невдача обриває чергу — так було й у старій панелі.
 *  Але вже залиті фото повертаються все одно: вони в сховищі, і
 *  викинути їх зі списку означало б загубити їх назовсім. */
export async function uploadPhotos(
  deps: StorageDeps,
  files: readonly File[],
  article: string,
  onProgress?: (p: UploadProgress) => void
): Promise<UploadPhotosResult> {
  const say = (p: UploadProgress) => {
    if (onProgress) onProgress(p);
  };

  const urls: string[] = [];
  // Порожній вибір: у старій панелі навіть статус не мінявся
  if (!files.length) return { urls: urls, ok: true, error: '' };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    say({ kind: 'wait', text: 'Готуємо ' + (i + 1) + ' з ' + files.length + '…' });

    let blob: Blob;
    try {
      blob = await toWebp(file);
    } catch {
      // Причина тут не потрібна: адмін бачить, який саме файл не пішов
      const error = 'Не вдалося обробити «' + file.name + '»';
      say({ kind: 'err', text: error });
      return { urls: urls, ok: false, error: error };
    }

    say({
      kind: 'wait',
      text:
        'Вивантажуємо ' + (i + 1) + ' з ' + files.length +
        ' (' + Math.round(blob.size / 1024) + ' КБ)…'
    });

    try {
      const url = await storageUpload(deps, storagePath(article, i + 1, file.name), blob);
      urls.push(url);
      say({ kind: 'photo', url: url });
    } catch (e) {
      const error = (e as Error)?.message || 'Не вдалося завантажити';
      say({ kind: 'err', text: error });
      return { urls: urls, ok: false, error: error };
    }
  }

  say({ kind: 'ok', text: 'Додано фото: ' + files.length + ' ✓' });
  return { urls: urls, ok: true, error: '' };
}

/* ============================================================
   РАЗОВА МІГРАЦІЯ СТАРИХ ФОТО У СХОВИЩЕ
   ------------------------------------------------------------
   Наявні картки посилаються на файли репозиторію (../assets/…).
   Тягнемо кожне з сайту, переганяємо у WebP, заливаємо у Storage
   і оновлюємо ЧЕРНЕТКУ — сайт побачить нові адреси після
   публікації, а до того працює як працював.
   ============================================================ */

/* Все, що не починається з http(s), — шлях у репозиторії. */
function isOldPath(src: unknown): boolean {
  return !/^https?:/i.test(String(src || ''));
}

/* Тим фото, що вже лежать у сховищі, кеш прописуємо окремо: це
   зміна метаданих, файл нікуди не їде. Одна дія — і адмінка
   перестає щоразу тягнути ті самі мегабайти.

   Повертає, скільки файлів полагоджено. */
export async function fixPhotoCache(
  deps: StorageDeps,
  urls: string[],
  onStep?: (loaded: number, total: number) => void
): Promise<{ ok: number; fail: number }> {
  const ours = [...new Set(urls.filter((u) => /firebasestorage/.test(String(u || ''))))];
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < ours.length; i += 1) {
    try {
      await updateMetadata(ref(deps.storage, ours[i]), {
        cacheControl: 'public, max-age=31536000, immutable'
      });
      ok += 1;
    } catch {
      fail += 1;
    }
    onStep?.(i + 1, ours.length);
  }
  return { ok, fail };
}

export interface MigrateDeps extends StorageDeps {
  db: Firestore;
  /** Каталог уже засіяний у базу? Поки ні — оновлювати нічого:
   *  документів товарів іще не існує. */
  seeded: boolean;
  /** Чернетка каталогу такою, якою її бачить адмінка. */
  products: readonly Product[];
}

export type MigrateOutcome =
  /** Не бралися: каталог ще не в базі або міграція вже позначена. */
  | 'skipped'
  /** Старих шляхів не лишилось — просто ставимо маркер. */
  | 'nothing'
  /** Частина фото не переїхала; маркер НЕ поставлено. */
  | 'partial'
  /** Усе перенесено, маркер поставлено. */
  | 'done';

export interface MigratedProduct {
  id: string;
  images: string[];
}

export interface MigrateResult {
  outcome: MigrateOutcome;
  /** Товари з новими адресами. У базі вони вже оновлені — ці
   *  самі значення треба покласти й у свій стан, інакше адмінка
   *  показуватиме старі шляхи до перезавантаження. */
  changed: MigratedProduct[];
  /** Скільки фото не переїхало. */
  failed: number;
  /** Скільки фото мало переїхати. */
  total: number;
}

export interface MigrateProgress {
  done: number;
  total: number;
  /** Той самий рядок, що стара адмінка писала у смужку .a-migbar. */
  text: string;
}

export async function migratePhotos(
  deps: MigrateDeps,
  onProgress?: (p: MigrateProgress) => void
): Promise<MigrateResult> {
  const nothingDone: MigrateResult = { outcome: 'skipped', changed: [], failed: 0, total: 0 };
  if (!deps.seeded) return nothingDone;

  const marker = doc(deps.db, 'settings', 'migrations');

  /* Читання маркера може не вдатись (офлайн, правила). Тоді ми не
     знаємо, чи міграція вже була, — і йдемо переносити: зайвий
     прохід нічого не зіпсує, а половина старих шляхів у каталозі
     лишилась би назавжди. */
  const mig = await getDoc(marker).catch(() => null);
  const already = mig?.exists()
    ? Boolean((mig.data() as Record<string, unknown>).photosToStorage)
    : false;
  if (already) return nothingDone;

  const todo = deps.products.filter((p) => (p.images || []).some(isOldPath));

  if (!todo.length) {
    await setDoc(marker, { photosToStorage: true }, { merge: true });
    return { outcome: 'nothing', changed: [], failed: 0, total: 0 };
  }

  const total = todo.reduce((n, p) => n + p.images.filter(isOldPath).length, 0);
  let done = 0;
  let failed = 0;

  const say = () => {
    if (onProgress) {
      onProgress({
        done: done,
        total: total,
        text: 'Переносимо фото у хмарне сховище… ' + done + ' з ' + total
      });
    }
  };
  // Смужка зʼявлялась ще до першого файла — з «0 з N»
  say();

  /* Одна пачка на весь перенос: якщо запис не пройде, каталог
     лишиться цілком на старих шляхах, а не наполовину. */
  const batch = writeBatch(deps.db);
  const changed: MigratedProduct[] = [];

  for (const p of todo) {
    const fresh: string[] = [];
    let touched = false;

    for (let i = 0; i < p.images.length; i++) {
      const src = p.images[i];
      if (!isOldPath(src)) {
        fresh.push(src);
        continue;
      }
      try {
        const blob = await toWebp(src);
        const url = await storageUpload(
          deps,
          storagePath(p.id, i + 1, src.split('/').pop() || 'photo'),
          blob
        );
        fresh.push(url);
        touched = true;
      } catch {
        fresh.push(src); // не вдалося — лишаємо старий шлях
        failed++;
      }
      done++;
      say();
    }

    if (touched) {
      batch.update(doc(deps.db, PRODUCTS_COL, p.id), { images: fresh });
      changed.push({ id: p.id, images: fresh });
    }
  }

  if (changed.length) await batch.commit();

  /* Маркер не ставимо, поки лишились непереїхані фото: наступний
     запуск має доробити решту. */
  if (failed) return { outcome: 'partial', changed: changed, failed: failed, total: total };

  await setDoc(marker, { photosToStorage: true }, { merge: true });
  return { outcome: 'done', changed: changed, failed: failed, total: total };
}
