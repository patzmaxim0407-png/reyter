/* ============================================================
   REYTER — програма лояльності
   ------------------------------------------------------------
   Дві різні речі під одним дахом.

   ПРОГРАМА ЛОЯЛЬНОСТІ — для всіх. Бали за покупки, чотири рівні,
   відсоткова знижка.

   FRIENDLY CLUB — те, що відчиняється з третього рівня: закриті
   товари, ранній доступ. Не окрема програма, а її верхня частина.

   Тут — самі правила, чистими функціями: жодного звернення до
   бази, жодного React, жодного часу «зараз» із повітря — момент
   завжди приходить аргументом. Так їх можна проганяти
   перевірками, і так само їх бачить і сайт, і адмінка.

   ГОЛОВНЕ ПРО БАЛИ. Один бал — це одна сплачена гривня, і нічого
   більше: балами не платять. Вони лише відчиняють рівні, а рівень
   дає відсоток. Плутанина тут коштує дорого — покупець, який
   вирішив, що балами можна розрахуватись, іде ображеним.
   ============================================================ */

export interface Level {
  level: 1 | 2 | 3 | 4;
  /** Скільки балів треба, щоб опинитись на цьому рівні. */
  from: number;
  /** Останній бал рівня; null у верхнього — далі рухатись нікуди. */
  to: number | null;
  percent: number;
  /** З третього рівня відчиняється клуб. */
  friendly: boolean;
}

export const LEVELS: Level[] = [
  { level: 1, from: 0, to: 5999, percent: 0, friendly: false },
  { level: 2, from: 6000, to: 19999, percent: 4, friendly: false },
  { level: 3, from: 20000, to: 39999, percent: 8, friendly: true },
  { level: 4, from: 40000, to: null, percent: 15, friendly: true }
];

export type LevelNo = 1 | 2 | 3 | 4;

/** Скільки років дається на рівень. Рік — від першого замовлення
 *  цього рівня, а не від реєстрації. */
export const YEAR = 1;

export function levelInfo(level: LevelNo): Level {
  return LEVELS[level - 1];
}

/** Рівень за кількістю балів. */
export function levelOf(points: number): LevelNo {
  const n = Math.max(0, Math.floor(points) || 0);
  for (let i = LEVELS.length - 1; i >= 0; i--) if (n >= LEVELS[i].from) return LEVELS[i].level;
  return 1;
}

/** Підлога рівня — те, до чого скидаються бали, коли рік минув. */
export function floorOf(level: LevelNo): number {
  return levelInfo(level).from;
}

/** Скільки балів відкриває наступний рівень; null — вище немає. */
export function nextAt(level: LevelNo): number | null {
  const next = LEVELS[level];
  return next ? next.from : null;
}

export function percentOf(level: LevelNo): number {
  return levelInfo(level).percent;
}

export function isFriendly(level: LevelNo): boolean {
  return levelInfo(level).friendly;
}

/* ============================================================
   СТАН УЧАСНИКА
   ============================================================ */

export interface Member {
  /** Скільки балів зараз. */
  points: number;
  level: LevelNo;
  /** Перше замовлення поточного рівня — від нього рік. null —
   *  замовлень на цьому рівні ще не було, тож і втрачати нічого. */
  cycleStart: string | null;
}

export const NEW_MEMBER: Member = { points: 0, level: 1, cycleStart: null };

/** Останній день, коли ще можна набрати на наступний рівень.
 *  null — годинник не запущено або рівень верхній. */
export function deadlineOf(m: Member): string | null {
  if (!m.cycleStart) return null;
  if (nextAt(m.level) === null) return null;
  const d = new Date(m.cycleStart);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + YEAR);
  return iso(d);
}

/** Скільки балів бракує до наступного рівня; 0 — рівень верхній. */
export function needMore(m: Member): number {
  const at = nextAt(m.level);
  return at === null ? 0 : Math.max(0, at - m.points);
}

export interface Progress {
  level: LevelNo;
  percent: number;
  points: number;
  /** Межі поточного рівня — для смужки прогресу. */
  from: number;
  to: number | null;
  need: number;
  /** Частка пройденого рівня, 0…1. Верхній рівень — завжди 1. */
  ratio: number;
  deadline: string | null;
  friendly: boolean;
}

export function progressOf(m: Member): Progress {
  const info = levelInfo(m.level);
  const at = nextAt(m.level);
  const span = at === null ? 0 : at - info.from;
  return {
    level: m.level,
    percent: info.percent,
    points: m.points,
    from: info.from,
    to: at === null ? null : at,
    need: needMore(m),
    ratio: span <= 0 ? 1 : Math.min(1, Math.max(0, (m.points - info.from) / span)),
    deadline: deadlineOf(m),
    friendly: info.friendly
  };
}

/* ============================================================
   РУХ БАЛІВ
   ============================================================ */

/** Замовлення виконано — зараховуємо бали.
 *
 *  paid — саме СПЛАЧЕНА сума, після всіх знижок і без доставки:
 *  доставка не товар, і платити за неї балами програми було б
 *  несправедливо до тих, хто забирає сам.
 *
 *  Перше замовлення рівня запускає річний годинник. Підйом на
 *  рівень годинник зупиняє: новий рік почне вже наступне
 *  замовлення — так вимагає умова «рік від першого замовлення
 *  ПОТОЧНОГО рівня». */
export function credit(m: Member, paid: number, at: string): Member {
  const add = Math.max(0, Math.floor(Number(paid) || 0));
  if (!add) return m;

  const points = m.points + add;
  let level = m.level;
  let cycleStart: string | null = m.cycleStart ?? at;

  for (;;) {
    const up = nextAt(level);
    if (up === null || points < up) break;
    level = (level + 1) as LevelNo;
    cycleStart = null;
  }

  return { points, level, cycleStart };
}

/** Повернення. Бали знімаються, і рівень МОЖЕ впасти.
 *
 *  Без падіння рівня лишалася б відкрита діра: купити на сорок
 *  тисяч, отримати п'ятнадцять відсотків назавжди й повернути все.
 *  Тому рівень тут перераховується чесно, за балами, які лишились. */
export function refund(m: Member, amount: number): Member {
  const off = Math.max(0, Math.floor(Number(amount) || 0));
  if (!off) return m;

  const points = Math.max(0, m.points - off);
  const level = levelOf(points);
  return {
    points,
    level,
    // впав нижче — цикл починається наново, з першого майбутнього замовлення
    cycleStart: level < m.level ? null : m.cycleStart
  };
}

/** Рік минув, а до наступного рівня не дотягнули: бали
 *  скидаються до підлоги свого рівня, сам рівень лишається.
 *
 *  Годинник після скидання зупиняється — новий рік почне
 *  наступне замовлення. Доти втрачати нічого, і підганяти
 *  людину порожнім лічильником ні до чого. */
export function expire(m: Member, now: string): Member {
  const due = deadlineOf(m);
  if (!due) return m;
  if (now < due) return m;

  const at = nextAt(m.level);
  // дотягнув — сюди взагалі не мало дійти, але мовчки псувати стан не можна
  if (at !== null && m.points >= at) return m;

  return { points: floorOf(m.level), level: m.level, cycleStart: null };
}

/* ============================================================
   ЗНИЖКА
   ============================================================ */

/** Налаштування магазину. Знижка лояльності сумується з
 *  промокодом, і без запобіжників акційна субота дала б мінус
 *  півціни — тому стеля й винятки. */
export interface DiscountRules {
  /** Стеля сумарної знижки у відсотках. 0 — без стелі. */
  cap: number;
  /** Не діє на товари з бейджем SALE. */
  skipSale: boolean;
  /** Категорії, у яких не діє. */
  skipCats: string[];
}

export const DEFAULT_RULES: DiscountRules = { cap: 30, skipSale: false, skipCats: [] };

export interface DiscountLine {
  /** Скільки коштує рядок разом: ціна × кількість. */
  sum: number;
  category: string;
  sale?: boolean;
}

export interface DiscountResult {
  /** Знижка лояльності в гривнях. */
  loyalty: number;
  /** Промокод, як його порахували раніше — може бути зрізаний стелею. */
  promo: number;
  total: number;
  /** Стеля спрацювала — це треба показати менеджерові, а не ховати. */
  capped: boolean;
  /** Сума, з якої рахувалась знижка лояльності. */
  base: number;
}

/** Скільки знижки дає рівень і як вона живе поруч із промокодом.
 *
 *  Порядок зрізання при стелі навмисний: першою зменшується
 *  знижка лояльності, промокод лишається цілим. Промокод — це
 *  обіцянка, названа числом, яку покупець уже прочитав у листі
 *  чи в рекламі; лояльність нараховується сама, і про її розмір
 *  ніхто не домовлявся окремо. */
export function discountFor(
  level: LevelNo,
  lines: DiscountLine[],
  promo: number,
  rules: DiscountRules = DEFAULT_RULES,
  on = true
): DiscountResult {
  const goods = lines.reduce((n, l) => n + (Number(l.sum) || 0), 0);
  const percent = on ? percentOf(level) : 0;

  const fits = (l: DiscountLine) =>
    !(rules.skipSale && l.sale) && !rules.skipCats.includes(String(l.category || ''));
  const base = percent ? lines.filter(fits).reduce((n, l) => n + (Number(l.sum) || 0), 0) : 0;

  let loyalty = Math.round((base * percent) / 100);
  const paid = Math.max(0, Math.round(Number(promo) || 0));

  let capped = false;
  const ceiling = rules.cap > 0 ? Math.floor((goods * rules.cap) / 100) : Infinity;
  if (paid + loyalty > ceiling) {
    loyalty = Math.max(0, ceiling - paid);
    capped = true;
  }

  // більше за товар знижка бути не може — інакше рахунок від'ємний
  const total = Math.min(goods, paid + loyalty);

  return { loyalty, promo: paid, total, capped, base };
}

/* ============================================================
   ДРІБНИЦІ
   ============================================================ */

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Номер учасника. Показуємо його людині, тож він має читатися
 *  вголос по телефону: літери клубу й шість цифр. */
export function memberNumber(seq: number): string {
  return 'FC-' + String(Math.max(1, Math.floor(seq))).padStart(6, '0');
}

/** Логін Instagram у придатному вигляді: без @, без адреси, без
 *  пробілів. Власність не перевіряємо — тільки форму. */
export function instagramLogin(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@+/, '')
    .toLowerCase()
    .slice(0, 30);
}

export function instagramOk(login: string): boolean {
  return /^[a-z0-9._]{1,30}$/.test(login);
}
