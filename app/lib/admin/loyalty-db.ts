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
  NEW_MEMBER,
  credit,
  expire,
  instagramLogin,
  isFriendly,
  levelOf,
  memberNumber,
  refund,
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
  /** Логін Instagram — без нього клуб не відчиняється. */
  instagram: string;
  /** Коли вступив у клуб. Порожньо — ще не вступив. */
  friendlyAt: string;
  joinedAt: string;
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

export function blankMember(email: string, seq: number, now: Date): MemberDoc {
  return {
    ...NEW_MEMBER,
    who: keyOf(email),
    number: memberNumber(seq),
    instagram: '',
    friendlyAt: '',
    joinedAt: iso(now)
  };
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

/** Учасник у клубі: рівень дозволив І логін вписаний. */
export function inClub(m: MemberDoc | null): boolean {
  return !!m && isFriendly(m.level) && !!m.instagram;
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
  const sum = past.reduce((n, o) => n + Math.max(0, Math.floor(o.paid)), 0);
  if (!sum) return null;

  const points = m.points + sum;
  const level = levelOf(points);
  const member = withFriendly({ ...m, points, level, cycleStart: null }, iso(new Date()));
  return {
    member,
    move: {
      who: m.who,
      kind: 'history',
      points: sum,
      after: points,
      level,
      note: `зараховано минулих замовлень: ${past.length}`,
      by
    }
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
