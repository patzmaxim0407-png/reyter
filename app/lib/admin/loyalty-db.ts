/* ============================================================
   REYTER — учасники програми лояльності в базі
   ------------------------------------------------------------
   Правила самої програми лежать у lib/loyalty.ts і не знають ні
   про базу, ні про React. Тут — тільки те, як цей стан живе у
   Firestore.

   ДЕ ЛЕЖИТЬ. Колекція loyalty, ключ документа — пошта малими
   літерами. Не uid: бали має отримати й той, хто замовив гостем,
   а потім завів акаунт на ту саму пошту, — інакше історія
   розсипалась би на дві.

   ХТО ПИШЕ. Тільки адмін, і це головне правило всієї програми.
   Якби покупець міг писати сюди сам, він виставив би собі
   четвертий рівень із консолі браузера за десять секунд. Тому
   нарахування живе в адмінці: менеджер ставить «Виконано» — бали
   лягають тією ж транзакцією, що й статус.

   ЧОМУ ТЕРМІН ПЕРЕВІРЯЄТЬСЯ ПРИ ЧИТАННІ. Річний строк спливає сам
   собою, без жодної дії покупця. Ганяти по базі щоночі й
   перебирати всіх учасників — це або розклад, якого в проєкті
   немає, або обхід усієї колекції. Натомість expire() — чиста
   функція від «зараз», тож простроченим станом просто нікому не
   дають скористатися: і читання, і нарахування, і знижка бачать
   уже переміряний стан. У базу він лягає при першому ж записі.
   ============================================================ */

import {
  Timestamp,
  Transaction,
  collection,
  runTransaction,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore
} from 'firebase/firestore';

import {
  DEFAULT_RULES,
  HISTORY_FROM,
  ladderRows,
  makeLevels,
  NEW_MEMBER,
  credit,
  expire,
  instagramLogin,
  isFriendly,
  levelOf,
  memberNumber,
  refund,
  type DiscountRules,
  type Level,
  type LevelNo,
  type Member
} from '../loyalty';

export const MEMBERS_COL = 'loyalty';
export const MOVES_COL = 'loyalty_moves';

/** Документ учасника. Member — це його ядро, решта тут. */
export interface MemberDoc extends Member {
  /** Пошта малими літерами; вона ж ключ документа. */
  who: string;
  /** Показуємо людині: FC-000042. */
  number: string;
  /** Логін Instagram. Не ключ від клубу: його просять уже в
   *  учасника, щоб знати, кого відмічати в соцмережах. */
  instagram: string;
  /** Коли вступив у клуб. Порожньо — ще не вступив. */
  friendlyAt: string;
  joinedAt: string;
  /** Клуб, даний руками — незалежно від рівня. Пише лише адмін.
   *  Потрібен для тих, кого хочеться бачити в клубі раніше, ніж
   *  вони наберуть балів: моделей, друзів магазину, тих, хто
   *  прийшов з іншого міста по одній речі. */
  clubManual?: boolean;
  /** Просить зарахувати минулі замовлення. Ставить сам покупець
   *  при вступі, знімає адмінка, коли порахує: підсумувати свої
   *  ж покупки він не може — правила бази не дають писати бали. */
  historyPending?: boolean;
  /** Номери замовлень, уже зарахованих історією. Тримаємо їх,
   *  щоб повторний прохід не нарахував ті самі покупки вдруге. */
  historyNums?: string[];
  /** Замовлення знайшлись, а сума вийшла нульова: рахувати нема
   *  чого, але й закривати питання не можна. Такий учасник
   *  лишається в черзі, проте автоматичний прохід його більше не
   *  бере — інакше кілька таких зайняли б усю чергу, і нові
   *  учасники не дочекались би своїх балів ніколи. */
  historyStuck?: boolean;
}

export type MoveKind = 'order' | 'return' | 'manual' | 'history' | 'expire';

export interface Move {
  who: string;
  kind: MoveKind;
  /** Скільки балів додали (може бути відʼємним). */
  points: number;
  /** Скільки стало після руху. */
  after: number;
  level: LevelNo;
  /** Замовлення, за яке нараховано; порожньо в ручному русі. */
  orderNum?: string;
  note?: string;
  by?: string;
}

/** Пошта як ключ. Одне місце на весь проєкт — інакше Petro@ і
 *  petro@ рано чи пізно стануть двома різними учасниками. */
export function keyOf(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function blankMember(email: string, now: Date): MemberDoc {
  return {
    ...NEW_MEMBER,
    who: keyOf(email),
    number: memberNumber(email),
    instagram: '',
    friendlyAt: '',
    joinedAt: iso(now),
    historyPending: true
  };
}

/** Вступ. Робить сам покупець зі свого кабінету — але вступає з
 *  нуля: правила бази дозволяють створити документ лише з
 *  порожніми балами. Минулі замовлення зарахує адмінка. */
export async function joinProgram(db: Firestore, email: string, now: Date): Promise<MemberDoc> {
  const doc0 = blankMember(email, now);
  await setDoc(doc(db, MEMBERS_COL, doc0.who), doc0);
  return doc0;
}

/** Стан учасника з уже переміряним річним строком.
 *  null — такого учасника ще немає. */
export async function readMember(db: Firestore, email: string, now: Date): Promise<MemberDoc | null> {
  const snap = await getDoc(doc(db, MEMBERS_COL, keyOf(email)));
  if (!snap.exists()) return null;
  return fresh(snap.data() as MemberDoc, now);
}

/** Те саме, але всередині транзакції: саме так його читає
 *  нарахування балів при зміні статусу замовлення. */
export async function readMemberTx(
  tx: Transaction,
  db: Firestore,
  email: string,
  now: Date
): Promise<MemberDoc | null> {
  const snap = await tx.get(doc(db, MEMBERS_COL, keyOf(email)));
  if (!snap.exists()) return null;
  return fresh(snap.data() as MemberDoc, now);
}

/** Прострочений рік застосовуємо мовчки при кожному читанні. */
export function fresh(m: MemberDoc, now: Date): MemberDoc {
  const after = expire(m, iso(now));
  return after === m ? m : { ...m, ...after };
}

/* ============================================================
   РУХ БАЛІВ
   ------------------------------------------------------------
   Дві чисті функції: одна рахує, що станеться, друга пише. Так
   само зроблено на складі, і з тієї ж причини — щоб рішення
   можна було перевірити, не чіпаючи бази.
   ============================================================ */

export interface MovePlan {
  member: MemberDoc;
  move: Move;
}

/** Замовлення виконано. paid — сплачена сума без доставки. */
export function planCredit(
  m: MemberDoc,
  paid: number,
  at: string,
  orderNum: string,
  by: string
): MovePlan | null {
  const add = Math.max(0, Math.floor(paid));
  if (!add) return null;

  const next = credit(m, add, at);
  const member = withFriendly({ ...m, ...next }, at);
  return {
    member,
    move: { who: m.who, kind: 'order', points: add, after: next.points, level: next.level, orderNum, by }
  };
}

/** Замовлення перестало бути виконаним: повернення, скасування,
 *  відкат статусу. Бали знімаються завжди й беззастережно. */
export function planRefund(m: MemberDoc, paid: number, orderNum: string, by: string): MovePlan | null {
  const off = Math.max(0, Math.floor(paid));
  if (!off) return null;

  const next = refund(m, off);
  return {
    member: { ...m, ...next },
    move: { who: m.who, kind: 'return', points: -off, after: next.points, level: next.level, orderNum, by }
  };
}

/** Ручна правка з адмінки. Причина обовʼязкова: через півроку
 *  «чому в нього на 2000 більше» має бути на що відповісти. */
export function planManual(m: MemberDoc, points: number, note: string, by: string): MovePlan | null {
  const delta = Math.round(Number(points) || 0);
  if (!delta) return null;

  const next = delta > 0 ? credit(m, delta, iso(new Date())) : refund(m, -delta);
  const member = withFriendly({ ...m, ...next }, iso(new Date()));
  return {
    member,
    move: { who: m.who, kind: 'manual', points: delta, after: next.points, level: next.level, note, by }
  };
}

/** Клуб відчиняється сам, щойно рівень дозволив. Але дверима ще
 *  треба скористатися: логін Instagram учасник вписує сам, і доти
 *  friendlyAt лишається порожнім. */
function withFriendly(m: MemberDoc, at: string): MemberDoc {
  if (!isFriendly(m.level)) return { ...m, friendlyAt: '' };
  if (m.friendlyAt) return m;
  return { ...m, friendlyAt: at };
}

/** Учасник у клубі.
 *
 *  Два шляхи, і обидва рівноправні: рівень дозволив або власник
 *  дав руками. Instagram потрібен лише на першому — це вхідний
 *  ритуал самої програми; кого запросили особисто, того не
 *  змушують нічого вписувати. */
export function inClub(m: MemberDoc | null, levels?: Level[]): boolean {
  if (!m) return false;
  if (m.clubManual === true) return true;
  /* Забрали руками — рівень назад не пускає. Інакше «Забрати
     клуб» у третьорівневого не робило б нічого: кнопку натиснуто,
     а товари на місці. Слово власника має важити більше за
     драбину — і в обидва боки. */
  if (m.clubManual === false) return false;
  /* Третій рівень відчиняє клуб САМ. Instagram тут ні до чого:
     його просять уже в учасника, щоб знати, кого відмічати, — а
     не як ключ від дверей. Поки він був ключем, людина
     заслуговувала клуб покупками й лишалась за порогом через
     незаповнене поле. */
  return isFriendly(m.level, levels);
}

/** Звідки в людини клуб — для одного рядка в адмінці. */
export function clubSource(m: MemberDoc, levels?: Level[]): 'hand' | 'level' | 'banned' | 'none' {
  if (m.clubManual === true) return 'hand';
  if (m.clubManual === false) return 'banned';
  return isFriendly(m.level, levels) ? 'level' : 'none';
}

/** У клубі, але Instagram ще не вписав. За дверима такі вже НЕ
 *  лишаються — клуб у них є. Просто ми не знаємо, кого відмічати
 *  й до кого писати, а це половина сенсу клубу. Саме їм і варто
 *  нагадати. */
export function clubPending(m: MemberDoc, levels?: Level[]): boolean {
  return inClub(m, levels) && !m.instagram;
}

/* ============================================================
   ЗАПИС
   ============================================================ */

export async function writeMove(db: Firestore, plan: MovePlan): Promise<void> {
  await setDoc(doc(db, MEMBERS_COL, plan.member.who), plan.member, { merge: true });
  await setDoc(doc(collection(db, MOVES_COL)), {
    ...plan.move,
    at: serverTimestamp()
  });
}

/** Те саме всередині транзакції зміни статусу замовлення. */
export function writeMoveTx(tx: Transaction, db: Firestore, plan: MovePlan): void {
  tx.set(doc(db, MEMBERS_COL, plan.member.who), plan.member, { merge: true });
  tx.set(doc(collection(db, MOVES_COL)), { ...plan.move, at: Timestamp.now() });
}

/** Логін Instagram. Єдине, що покупець міняє сам, — але пише його
 *  все одно адмінка: колекція закрита на запис усім іншим. */
export async function saveInstagram(db: Firestore, email: string, raw: string): Promise<string> {
  const login = instagramLogin(raw);
  await setDoc(doc(db, MEMBERS_COL, keyOf(email)), { instagram: login }, { merge: true });
  return login;
}

export async function loadMoves(db: Firestore, email: string, howMany = 50): Promise<Move[]> {
  const q = query(
    collection(db, MOVES_COL),
    where('who', '==', keyOf(email)),
    orderBy('at', 'desc'),
    limit(howMany)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Move);
}

/* ============================================================
   ІСТОРІЯ ПРИ ВСТУПІ
   ------------------------------------------------------------
   За умовою минулі замовлення зараховуються — але лише ті, що
   вже є в адмінці. Це і подяка давнім покупцям, і найсильніший
   привід зареєструватися сьогодні.

   Річний годинник для такого учасника НЕ починається з давньої
   покупки: рік має бути повним, а не зʼїденим історією. Тому
   cycleStart лишається порожнім — його поставить перше
   замовлення після вступу.
   ============================================================ */

export interface PastOrder {
  num: string;
  /** Сплачено без доставки. */
  paid: number;
  at: string;
}

export function planHistory(m: MemberDoc, past: PastOrder[], by: string): MovePlan | null {
  /* Межу тримаємо тут, а не в тому, хто збирає замовлення:
     інакше вона рано чи пізно розійшлася б із написом у кабінеті,
     і покупець рахував би одне, а програма — інше. */
  const after = past.filter((o) => String(o.at || '') >= HISTORY_FROM);

  /* Що вже зараховано — те вдруге не рахується. Без цього списку
     повторний прохід (а він потрібен: причину нуля іноді
     виправляють і рахують ще раз) додавав би ті самі замовлення
     знову, і бали тихо подвоювались би. */
  const had = new Set(m.historyNums || []);
  const mine = after.filter((o) => !o.num || !had.has(o.num));

  const sum = mine.reduce((n, o) => n + Math.max(0, Math.floor(o.paid)), 0);
  if (!sum) return null;

  const points = m.points + sum;
  const level = levelOf(points);
  const nums = [...had, ...mine.map((o) => o.num).filter(Boolean)];
  const member = withFriendly(
    { ...m, points, level, cycleStart: null, historyNums: nums },
    iso(new Date())
  );
  return {
    member,
    move: {
      who: m.who,
      kind: 'history',
      points: sum,
      after: points,
      level,
      note: `зараховано минулих замовлень: ${mine.length} (з ${HISTORY_FROM})`,
      by
    }
  };
}

/* ============================================================
   ОСТАННІЙ ВІДОМИЙ СТАН — У БРАУЗЕРІ
   ------------------------------------------------------------
   База відповідає не миттєво, і до її відповіді кабінет не знає,
   учасник перед ним чи ні. Якщо в цей момент показати запрошення
   вступити, учасник на кожному оновленні сторінки бачитиме
   «Вступити в програму» — тобто пропозицію зробити те, що він уже
   зробив. Дрібниця, але саме такі дрібниці й читаються як
   «сайт мене не памʼятає».

   Тому останній стан лежить у самому браузері й показується
   одразу, а база потім уточнює числа. Це кеш, а не джерело:
   правити його ззовні марно — знижку однаково рахують правила
   бази й воркер, а не цей запис.
   ============================================================ */

const CACHE = 'reyter:loyalty';

export function rememberMember(m: MemberDoc | null): void {
  try {
    if (m) localStorage.setItem(CACHE, JSON.stringify(m));
    else localStorage.removeItem(CACHE);
  } catch {
    /* приватний режим або переповнене сховище — не привід падати */
  }
}

/** Останній відомий стан для цієї пошти. Чужий кеш не віддаємо:
 *  на спільному компʼютері перед нами може бути інша людина. */
export function cachedMember(email: string): MemberDoc | null {
  try {
    const raw = localStorage.getItem(CACHE);
    if (!raw) return null;
    const m = JSON.parse(raw) as MemberDoc;
    return m && m.who === keyOf(email) ? m : null;
  } catch {
    return null;
  }
}

/* ============================================================
   ЕКРАН ПРОГРАМИ В АДМІНЦІ
   ============================================================ */

/** Скільки сплачено за товари в одному замовленні: без доставки
 *  й після знижок. Та сама формула, що й при нарахуванні на
 *  «Виконано», — інакше зарахована історія розійшлася б із тим,
 *  що людина отримала б, замовляючи вже в програмі. */
export function paidGoods(o: {
  subtotal?: number;
  discount?: number;
  items?: Array<{ price?: number; qty?: number }> | null;
}): number {
  const goods = Math.max(0, Math.round(itemsSum(o)));
  const off = Math.max(0, Math.round(Number(o.discount) || 0));
  return Math.max(0, goods - off);
}

/** Сума товарів. Головне джерело — поле subtotal, яке пише сайт.
 *
 *  Але замовлення, заведене в адмінці руками, його довго не мало
 *  зовсім, і для програми лояльності такі покупки виглядали
 *  нульовими: бали не нараховувались ні на «Виконано», ні при
 *  зарахуванні історії, і жодного сліду про це не лишалось.
 *  Поле тепер пишеться, але старі замовлення в базі так і лежать
 *  без нього — тож рахуємо за товарами, як їх рахує сама
 *  адмінка, коли складає замовлення. */
function itemsSum(o: { subtotal?: number; items?: Array<{ price?: number; qty?: number }> | null }): number {
  const said = Number(o.subtotal);
  if (Number.isFinite(said) && said > 0) return said;
  const rows = Array.isArray(o.items) ? o.items : [];
  return rows.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
}

export interface HistorySource {
  email?: string;
  status?: string;
  num?: string;
  date?: string;
  subtotal?: number;
  discount?: number;
  items?: Array<{ price?: number; qty?: number }> | null;
  customer?: { email?: string } | null;
  /** Бали за це замовлення вже нараховані на «Виконано». */
  pointsApplied?: boolean;
}

/** Київський день замовлення.
 *
 *  Дата в базі — ISO за Гринвічем, а межа програми названа днем:
 *  «з 9 серпня». Зріз рядка по десятому символу дає день UTC, і
 *  замовлення, зроблене 9 серпня о першій ночі за Києвом,
 *  вважалося б восьмим — тобто випало б із програми на очах у
 *  покупця, який чудово памʼятає, коли він замовляв. */
export function orderDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/** Розбір минулих замовлень — з причинами, а не самим підсумком.
 *
 *  Нуль балів має щонайменше чотири різні причини, і всі вони
 *  виглядають на екрані однаково. Доки код повертав саме нуль,
 *  власник бачив зниклу кнопку й порожній рахунок, а в журналі
 *  лежало «минулих замовлень не знайшлось» — твердження, якого
 *  ніхто не перевіряв і яке частіше було неправдою.
 *
 *  Тому рахуємо не лише те, що зараховується, а й те, що
 *  відпало, і чому саме. */
export interface HistoryScan {
  /** Замовлень із цією поштою — усіх, хоч би що з ними далі. */
  mine: number;
  /** З них виконаних. */
  done: number;
  /** Виконані, але раніші за межу програми. */
  early: number;
  /** Виконані й свіжі, але сума вийшла нульова — це вже привід
   *  подивитись на замовлення руками. */
  empty: number;
  /** Уже нараховані звичайним шляхом, на «Виконано». */
  already: number;
  /** Ті, що дають бали. */
  take: PastOrder[];
  sum: number;
}

export function scanHistory(who: string, all: HistorySource[], joinedAt = ''): HistoryScan {
  const key = keyOf(who);
  const mine = all.filter((o) => keyOf(o.email || o.customer?.email || '') === key);
  const done = mine.filter((o) => String(o.status || '') === 'done');

  const scan: HistoryScan = {
    mine: mine.length, done: done.length, early: 0, empty: 0, already: 0, take: [], sum: 0
  };

  for (const o of done) {
    const at = orderDay(String(o.date || ''));
    if (at < HISTORY_FROM) {
      scan.early += 1;
      continue;
    }

    /* Замовлення, зроблене вже після вступу, бали отримало
       звичайним шляхом — на «Виконано». Історія його не чіпає,
       інакше та сама покупка нарахувалася б двічі.

       Дата вступу тут не формальність, а межа довіри: до неї
       позначка «нараховано» могла стояти й на замовленні, за яке
       насправді ніхто нічого не отримував — покупця ще не було в
       програмі. Такі беремо, і це правильно. */
    if (o.pointsApplied === true && joinedAt && at >= joinedAt) {
      scan.already += 1;
      continue;
    }
    const paid = paidGoods(o);
    if (paid <= 0) {
      scan.empty += 1;
      continue;
    }
    scan.take.push({ num: String(o.num || ''), paid, at });
  }

  scan.sum = scan.take.reduce((n, o) => n + Math.floor(o.paid), 0);
  return scan;
}

/** Минулі замовлення учасника — ті, що справді дають бали.
 *
 *  Лише ВИКОНАНІ: скасоване чи відправлене замовлення балів не
 *  давало б і сьогодні, тож зараховувати його заднім числом
 *  було б подарунком, якого програма не обіцяла. */
export function pastOrdersOf(who: string, all: HistorySource[]): PastOrder[] {
  return scanHistory(who, all).take;
}

/** Порахувати історію, зняти прапорець і сказати правду.
 *
 *  Прапорець знімається майже завжди: учасник без жодного
 *  придатного замовлення інакше лишався б у черзі назавжди й
 *  щоразу потрапляв би менеджерові на очі.
 *
 *  ОДИН ВИНЯТОК — замовлення знайшлись, виконані й свіжі, а сума
 *  вийшла нульова. Це не відповідь програми, а несправність
 *  даних, і знімати прапорець тут не можна: другої спроби потім
 *  не буде ніколи. Такий учасник лишається в черзі на видноті, і
 *  запису в журнал ми не робимо — писати нема про що, нічого не
 *  сталося. */
export interface HistoryOutcome {
  scan: HistoryScan;
  /** Що записати. null — не чіпаємо нічого, лишаємо в черзі. */
  plan: MovePlan | null;
}

export function planHistoryDone(m: MemberDoc, all: HistorySource[], by: string): HistoryOutcome {
  const scan = scanHistory(m.who, all, orderDay(m.joinedAt) || m.joinedAt || '');
  const plan = planHistory(m, scan.take, by);
  if (plan) {
    return { scan, plan: { ...plan, member: { ...plan.member, historyPending: false } } };
  }

  if (scan.empty > 0) return { scan, plan: null };

  return {
    scan,
    plan: {
      member: { ...m, historyPending: false },
      move: {
        who: m.who,
        kind: 'history',
        points: 0,
        after: m.points,
        level: m.level,
        note: historyNote(scan),
        by
      }
    }
  };
}

/** Чому нуль — словами, у журнал. Саме цього запису бракувало:
 *  «минулих замовлень не знайшлось» писалось і тоді, коли
 *  замовлення були, і читати його як доказ було не можна. */
export function historyNote(scan: HistoryScan): string {
  if (scan.take.length) {
    return `зараховано ${scan.take.length} ${plural(scan.take.length)} на ${scan.sum.toLocaleString('uk')} грн`;
  }
  if (scan.empty) {
    return `без суми, перевірте вручну: ${scan.empty}`;
  }
  if (scan.early) {
    return `раніше за ${dayText(HISTORY_FROM)}, поза межею програми: ${scan.early}`;
  }
  if (scan.already) {
    return `уже нараховано на «Виконано»: ${scan.already}`;
  }
  if (scan.mine) {
    return `на цю пошту ${scan.mine} — жодного виконаного`;
  }
  return 'замовлень на цю пошту немає';
}

function plural(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 14) return 'замовлень';
  const one = n % 10;
  if (one === 1) return 'замовлення';
  if (one >= 2 && one <= 4) return 'замовлення';
  return 'замовлень';
}

function dayText(isoDay: string): string {
  const d = new Date(isoDay);
  return Number.isNaN(d.getTime()) ? isoDay : d.toLocaleDateString('uk-UA');
}

/* ============================================================
   АВТОМАТИЧНЕ ЗАРАХУВАННЯ ІСТОРІЇ
   ------------------------------------------------------------
   Учасник вступає сам, але порахувати свої минулі покупки не
   може: писати бали дозволено лише адмінові. Тому зарахування
   робить адмінка — сама, щойно її відкрили, без жодної кнопки.

   ЧОМУ ТРАНЗАКЦІЯ. Менеджерів може бути двоє, вкладок — теж.
   Обидві бачать той самий прапорець «зарахуйте історію» і обидві
   кинуться рахувати. Проста перевірка «чи прапорець стоїть» тут
   не рятує: між читанням і записом устигає пройти чужий запис.
   Транзакція перечитує документ у момент запису й відступає,
   якщо прапорець уже знято, — і бали не подвоюються.
   ============================================================ */

export async function applyHistoryTx(
  db: Firestore,
  who: string,
  all: HistorySource[],
  by: string,
  /** Повторний прохід руками — коли прапорець уже знято, а
   *  причину нуля виправили. Автоматичний прохід так не робить
   *  ніколи: він рахує кожного рівно раз. */
  again = false,
  /** Чи певні ми, що бачили всі замовлення цієї людини. */
  sure = true
): Promise<number> {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, MEMBERS_COL, keyOf(who));
    const snap = await tx.get(ref);
    if (!snap.exists()) return 0;

    const m = fresh(snap.data() as MemberDoc, new Date());
    // хтось устиг раніше — це успіх, але без другого нарахування
    if (!m.historyPending && !again) return 0;

    const { plan } = planHistoryDone(m, all, by);

    /* Нічого не вирішено — лишаємо в черзі, журнал не засмічуємо.
       Але позначаємо, щоб наступний автоматичний прохід не бився
       об ту саму людину замість нових.

       Сюди ж потрапляє «нуль, але ми не додивились»: записати в
       такому разі «замовлень на цю пошту немає» означало б
       поставити брехню в журнал і зняти прапорець назавжди — а
       саме проти цього все й писалося. */
    if (!plan || (!sure && plan.move.points === 0)) {
      if (!m.historyStuck) tx.set(ref, { historyStuck: true }, { merge: true });
      return 0;
    }

    tx.set(ref, { ...plan.member, historyStuck: false }, { merge: true });
    tx.set(doc(collection(db, MOVES_COL)), { ...plan.move, at: Timestamp.now() });
    return plan.move.points;
  });
}

/** Пройтись по всіх, хто чекає. Невдача одного не спиняє решти:
 *  його прапорець лишається, і наступного разу він знову буде
 *  в черзі. */
export async function sweepHistory(
  db: Firestore,
  members: MemberDoc[],
  all: HistorySource[],
  by: string
): Promise<{ done: number; points: number }> {
  let done = 0;
  let points = 0;
  for (const m of members) {
    if (!m.historyPending) continue;
    try {
      points += await applyHistoryTx(db, m.who, all, by);
      done += 1;
    } catch {
      /* мовчки: наступного відкриття адмінки спробуємо знову */
    }
  }
  return { done, points };
}

export interface Stats {
  members: number;
  /** Скільки на кожному рівні: [1, 2, 3, 4]. */
  byLevel: [number, number, number, number];
  /** У клубі, але Instagram ще не вписав. Саме їм і варто
   *  нагадати: доступ у них є, а знайти їх у соцмережах ми не
   *  можемо. */
  noInsta: number;
  /** У клубі — за рівнем або руками. */
  inClub: number;
  pending: number;
  points: number;
  /** Скільки знижки віддано за рівнями — з самих замовлень. */
  given: number;
}

export function statsOf(list: MemberDoc[], orders: { loyaltyOff?: number }[] = []): Stats {
  const byLevel: [number, number, number, number] = [0, 0, 0, 0];
  let noInsta = 0;
  let club = 0;
  let pending = 0;
  let points = 0;

  for (const m of list) {
    const lvl = Math.max(1, Math.min(4, m.level)) as LevelNo;
    byLevel[lvl - 1] += 1;
    points += Math.max(0, m.points);
    if (inClub(m)) club += 1;
    if (clubPending(m)) noInsta += 1;
    if (m.historyPending) pending += 1;
  }

  return {
    members: list.length,
    byLevel,
    noInsta,
    inClub: club,
    pending,
    points,
    given: orders.reduce((n, o) => n + Math.max(0, Math.round(Number(o.loyaltyOff) || 0)), 0)
  };
}

/** Пошук по переліку: пошта, номер, Instagram. Без урахування
 *  регістру й собачки — менеджер шукає так, як почув у Direct. */
export function findMembers(list: MemberDoc[], query: string): MemberDoc[] {
  const q = String(query || '').trim().toLowerCase().replace(/^@+/, '');
  if (!q) return list;
  return list.filter(
    (m) =>
      m.who.includes(q) ||
      String(m.number || '').toLowerCase().includes(q) ||
      String(m.instagram || '').toLowerCase().includes(q)
  );
}

/* ============================================================
   САМОСТІЙНЕ ЗАРАХУВАННЯ ІСТОРІЇ
   ------------------------------------------------------------
   Покупець вступає в програму й одразу хоче побачити свої бали
   за минулі покупки. Порахувати їх сам він не може — писати бали
   дозволено лише адмінові, і послабити це правило не можна:
   тоді четвертий рівень виставлявся б із консолі браузера.

   Сервер порахувати теж не може: воркер ходить у базу читанням
   від імені самого покупця, службового ключа в нього немає — а
   заводити його заради тимчасової механіки не варто.

   Лишається адмінка, і саме тому цей прохід живе НЕ на екрані
   програми, а в самій оболонці: власник відкриває замовлення
   десятки разів на день, і зарахування відбувається саме тоді,
   без жодної кнопки й незалежно від того, куди він зайшов.

   ЗАМОВЛЕННЯ ПИТАЄМО ПОШТОЮ, А НЕ БЕРЕМО ЗІ СПИСКУ. Список в
   адмінці — це п'ятсот останніх; учасник із давньою покупкою в
   нього просто не потрапляє, і його історія мовчки виходила б
   нульовою. Запит за поштою знаходить її хоч якої давнини, і
   коштує двох читань на людину.
   ============================================================ */

/** Хто чекає на зарахування. Порожньо — і далі нічого не
 *  робимо: це найчастіший випадок, і він майже безкоштовний.
 *
 *  Застряглих пропускаємо. Учасник, у якого замовлення є, а сума
 *  нульова, лишається в черзі навмисно — але місця в проході він
 *  займати не має: набралося б двадцять таких, і жоден новий
 *  учасник не дочекався б своїх балів ніколи. */
export async function pendingMembers(db: Firestore, max = 20): Promise<MemberDoc[]> {
  const snap = await getDocs(
    query(collection(db, MEMBERS_COL), where('historyPending', '==', true), limit(100))
  );
  const now = new Date();
  return snap.docs
    .map((d) => fresh(d.data() as MemberDoc, now))
    .filter((m) => !m.historyStuck)
    .slice(0, max);
}

/** Замовлення цієї пошти — з обох місць, де вона буває.
 *  Гостьове замовлення кладе пошту в customer, замовлення з
 *  акаунта — ще й у верхнє поле; шукаємо там і там. */
export interface OrdersLook {
  rows: HistorySource[];
  /** Чи певні ми, що подивились усе, що могло дати бали.
   *
   *  Різниця між «замовлень немає» і «я не додивився» — це
   *  різниця між правдою й тихою втратою: за першим прапорець
   *  знімається назавжди, і людину вже ніхто не порахує. Тому
   *  невпевненість повертається окремим полем, а не ховається за
   *  порожнім переліком. */
  sure: boolean;
}

const EXACT = 200;
const SCAN = 500;

export async function ordersOfEmail(db: Firestore, email: string): Promise<OrdersLook> {
  const key = keyOf(email);
  const both = await Promise.all([
    getDocs(query(collection(db, 'orders'), where('email', '==', key), limit(EXACT))),
    getDocs(query(collection(db, 'orders'), where('customer.email', '==', key), limit(EXACT)))
  ]);

  const seen = new Map<string, HistorySource>();
  for (const snap of both) {
    for (const d of snap.docs) seen.set(d.id, d.data() as HistorySource);
  }
  if (seen.size) {
    return { rows: [...seen.values()], sure: both.every((s) => s.docs.length < EXACT) };
  }

  /* Нічого не знайшлось — а могло й бути. Пошта в замовленні
     лежить так, як її набрали: «Petro@Gmail.com» теж трапляється,
     а запит рівністю регістру не пробачає. Опустити її при записі
     не можна — правила бази звіряють це поле з поштою в токені
     буква в букву, і замовлення просто не створилося б.

     Тому переглядаємо самі. Але не «останні N»: таке вікно
     закривається з ростом магазину, і одного дня почало б мовчки
     ховати чиюсь історію. Беремо межу самої програми — раніші
     замовлення балів не дають узагалі, тож шукати їх нема
     потреби. Вибірка від цього не росте з часом безмежно, а
     звужується до того, що взагалі може щось дати.

     Трапляється це рідко: лише коли точний запит порожній, тобто
     здебільшого в того, у кого історії й справді немає. */
  const since = await getDocs(
    query(
      collection(db, 'orders'),
      /* Початок київського дня, а не UTC-опівночі: інакше вибірка
         відрізала б замовлення, зроблені ввечері напередодні за
         Гринвічем, — а вони вже наш дев'яте серпня. Та сама межа,
         за якою рахує orderDay. */
      where('created', '>=', Timestamp.fromDate(new Date(HISTORY_FROM + 'T00:00:00+03:00'))),
      limit(SCAN)
    )
  );
  return {
    rows: since.docs
      .map((d) => d.data() as HistorySource)
      .filter((o) => keyOf(o.email || o.customer?.email || '') === key),
    /* Упершись у межу вибірки, ми не знаємо, чи не лишилось там
       іще чогось. Тоді краще нічого не вирішувати. */
    sure: since.docs.length < SCAN
  };
}

/** Пройтись по черзі самостійно. Повертає, скільки нарахували, —
 *  щоб було що показати, коли є про що казати. */
export async function sweepPending(db: Firestore, by: string): Promise<{ done: number; points: number }> {
  const queue = await pendingMembers(db);
  if (!queue.length) return { done: 0, points: 0 };

  let done = 0;
  let points = 0;
  for (const m of queue) {
    try {
      const look = await ordersOfEmail(db, m.who);
      const got = await applyHistoryTx(db, m.who, look.rows, by, false, look.sure);
      points += got;
      done += 1;
    } catch {
      /* один невдалий не спиняє решти: прапорець лишається, і
         наступного відкриття адмінки спробуємо знову */
    }
  }
  return { done, points };
}

export async function loadMembers(db: Firestore): Promise<MemberDoc[]> {
  const snap = await getDocs(collection(db, MEMBERS_COL));
  const now = new Date();
  return snap.docs.map((d) => fresh(d.data() as MemberDoc, now));
}

/** Налаштування знижки. Лежать у settings/public поруч із
 *  адресою воркера — саме тому, що їх мусить читати не лише
 *  адмінка, а й сайт, і сам воркер при виставленні рахунку. */
export async function loadRules(db: Firestore): Promise<DiscountRules> {
  const snap = await getDoc(doc(db, 'settings', 'public'));
  const box = (snap.exists() ? snap.data() : {}) as { loyalty?: Partial<DiscountRules> };
  return { ...DEFAULT_RULES, ...(box.loyalty || {}) };
}

export async function saveRules(db: Firestore, rules: DiscountRules): Promise<void> {
  /* Драбину зберігаємо вже переміряною: makeLevels відкидає
     пороги, що не зростають, і відсотки поза межами. Записати
     сюди зламану драбину означало б зламати ціни в кошику, у
     правилах бази й у рахунку банку одночасно. */
  const levels = ladderRows(makeLevels(rules.levels));

  await setDoc(
    doc(db, 'settings', 'public'),
    {
      loyalty: {
        cap: Math.max(0, Math.min(100, Math.round(rules.cap) || 0)),
        skipSale: !!rules.skipSale,
        skipCats: (rules.skipCats || []).map(String).slice(0, 50),
        levels
      }
    },
    { merge: true }
  );
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
