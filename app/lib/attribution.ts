/* ============================================================
   REYTER — звідки прийшов покупець
   ------------------------------------------------------------
   Google Analytics знає джерела трафіку, але не знає наших
   замовлень: він рахує сеанси, а гроші лежать у Firestore. Тому
   питання «скільки нам принесла реклама» досі не мало відповіді
   ніде — ні там, ні тут.

   Тут вирішується рівно одна річ: запамʼятати, звідки людина
   прийшла, і покласти це в замовлення. Далі аналітика магазину
   рахує виручку за джерелами тими самими числами, що й усе інше.

   ДВА ДОТИКИ, І ОБИДВА ПОТРІБНІ. Перший — хто ПРИВІВ: людина
   побачила рекламу в Instagram, пішла думати, за три дні
   повернулась пошуком і купила. Останній — хто ЗАКРИВ. Якщо
   лишити тільки останній, уся заслуга дістанеться пошуку за
   назвою бренду, і реклама виглядатиме марною. Якщо тільки
   перший — навпаки. Тому зберігаємо обидва, а на екрані
   показуємо перший: він відповідає на питання «куди вкладати
   гроші», а саме заради нього все це й пишеться.

   ЩО НЕ ЗБЕРІГАЄТЬСЯ. Нічого про саму людину: ні адреси
   сторінок, ні часу на сайті, ні пристрою. Тільки джерело,
   кампанія й день — рівно те, що потрібно, щоб порахувати гроші.
   ============================================================ */

export interface Touch {
  /** Людською мовою: «Instagram», «Google Реклама», «Прямий захід». */
  channel: string;
  /** Технічно: utm_source або домен, з якого прийшли. */
  source: string;
  /** utm_medium: cpc, organic, social, referral… */
  medium: string;
  campaign: string;
  /** День, коли цей дотик стався. */
  at: string;
}

export interface From {
  first: Touch;
  last: Touch;
}

const KEY = 'reyter:from';
/** Скільки живе памʼять про джерело. Три місяці — стільки ж
 *  дає рекламним кабінетам більшість майданчиків, і довше вона
 *  однаково нічого не пояснює. */
const LIVES = 90 * 24 * 3600 * 1000;

const DIRECT: Touch = { channel: 'Прямий захід', source: '', medium: '', campaign: '', at: '' };

/** Своє посилання переходом не вважається: людина ходить
 *  сторінками магазину, а не приходить ззовні. */
function ours(host: string): boolean {
  return /(^|\.)reyter\.men$/i.test(host);
}

/** Як назвати джерело так, щоб це читалось без словника. */
export function channelOf(p: {
  source: string;
  medium: string;
  gclid: boolean;
  fbclid: boolean;
  host: string;
}): string {
  const s = p.source.toLowerCase();
  const m = p.medium.toLowerCase();
  const paid = /cpc|ppc|paid|ads?/.test(m);

  /* Мітка кліку — найнадійніший слід реклами: її ставить сам
     майданчик, і вона переживає будь-які втрати utm. */
  if (p.gclid || (s.includes('google') && paid)) return 'Google Реклама';
  if (p.fbclid || ((s.includes('facebook') || s.includes('instagram') || s === 'fb' || s === 'ig') && paid)) {
    return 'Meta Реклама';
  }

  if (s.includes('instagram') || /instagram\.com$/i.test(p.host)) return 'Instagram';
  if (s.includes('facebook') || /(^|\.)(facebook\.com|fb\.me|m\.facebook\.com)$/i.test(p.host)) return 'Facebook';
  if (s.includes('tiktok') || /tiktok\.com$/i.test(p.host)) return 'TikTok';
  if (s.includes('telegram') || /(^|\.)t\.me$/i.test(p.host)) return 'Telegram';
  if (s.includes('google') || /google\./i.test(p.host)) return 'Google Пошук';
  if (/bing\.|duckduckgo\.|yahoo\./i.test(p.host) || s.includes('bing')) return 'Інший пошук';
  if (s.includes('email') || m.includes('email') || m.includes('mail')) return 'Лист';

  if (p.host && !ours(p.host)) return 'Перехід з ' + p.host.replace(/^www\./, '');
  if (s) return s;
  return DIRECT.channel;
}

/** Розібрати адресу сторінки й реферер у дотик.
 *  null — нічого нового: людина просто ходить сайтом. */
export function touchFrom(url: string, referrer: string, today: string): Touch | null {
  let q: URLSearchParams;
  try {
    q = new URL(url).searchParams;
  } catch {
    return null;
  }

  const get = (k: string) => String(q.get(k) || '').trim().slice(0, 60);
  const source = get('utm_source');
  const medium = get('utm_medium');
  const campaign = get('utm_campaign');
  const gclid = !!q.get('gclid');
  const fbclid = !!q.get('fbclid');

  let host = '';
  try {
    host = referrer ? new URL(referrer).hostname : '';
  } catch {
    host = '';
  }

  /* Ані міток, ані чужого реферера — це продовження візиту, а не
     новий дотик. Перезаписати ним памʼять означало б стерти
     рекламу, яка привела людину пʼять хвилин тому. */
  if (!source && !campaign && !gclid && !fbclid && (!host || ours(host))) {
    return null;
  }

  return {
    channel: channelOf({ source, medium, gclid, fbclid, host }),
    source: source || host.replace(/^www\./, ''),
    medium: medium || (gclid || fbclid ? 'cpc' : host ? 'referral' : ''),
    campaign,
    at: today
  };
}

function read(): (From & { saved: number }) | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const box = JSON.parse(raw) as From & { saved: number };
    if (!box || !box.first || Date.now() - Number(box.saved || 0) > LIVES) return null;
    return box;
  } catch {
    return null;
  }
}

/** Запамʼятати, звідки прийшли. Викликається на кожному
 *  відкритті сторінки; мовчить, коли новини немає. */
export function remember(url: string, referrer: string, now = new Date()): From | null {
  const today = now.toISOString().slice(0, 10);
  const fresh = touchFrom(url, referrer, today);
  const had = read();

  /* Перший дотик не переписується ніколи — у цьому весь його
     сенс. Останній оновлюється щоразу, коли людина приходить
     звідкись заново. */
  const next: From = {
    first: had?.first || fresh || { ...DIRECT, at: today },
    last: fresh || had?.last || { ...DIRECT, at: today }
  };

  try {
    localStorage.setItem(KEY, JSON.stringify({ ...next, saved: Date.now() }));
  } catch {
    /* приватне вікно — тоді просто не памʼятаємо */
  }
  return next;
}

/** Те, що кладеться в замовлення. Порожньо — нічого не знаємо. */
export function fromNow(): From | null {
  const box = read();
  if (!box) return null;
  return { first: box.first, last: box.last };
}
