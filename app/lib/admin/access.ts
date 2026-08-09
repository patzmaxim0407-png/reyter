/* ============================================================
   REYTER — доступ до адмінки
   ------------------------------------------------------------
   Хто адміністратор, вирішує база: колекція admins, де id
   документа — пошта. Правила бази спираються на той самий
   перелік, тож перевірка тут не «захист», а лише спосіб показати
   людині зрозумілий екран замість купи помилок доступу.

   Засновники прописані в коді навмисно: якщо колекція admins
   випадково спорожніє, зайти й полагодити її має хтось змогти.
   ============================================================ */

import { doc, getDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';

export const FOUNDERS = ['kostia.movchanovskyi@gmail.com', 'reyter.store1@gmail.com'];

export async function isAdminUser(user: User | null | undefined): Promise<boolean> {
  if (!user?.email) return false;
  const email = user.email.toLowerCase();
  if (FOUNDERS.includes(email)) return true;

  const d = db();
  if (!d) return false;
  try {
    const snap = await getDoc(doc(d, 'admins', email));
    return snap.exists();
  } catch {
    // permission-denied — отже, не адмін
    return false;
  }
}

/** Стан екрана входу. Розділений на випадки навмисно: «немає
 *  звʼязку», «ви не увійшли» і «у цього акаунта немає прав» —
 *  три різні проблеми, і три різні дії у відповідь. */
export type GateState =
  | { kind: 'offline' }
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'denied'; email: string }
  | { kind: 'ok' };

export function gateMessage(s: GateState): string {
  switch (s.kind) {
    case 'offline':
      return 'Firebase недоступний — перевірте інтернет або блокувальник реклами.';
    case 'checking':
      return 'Перевіряємо доступ…';
    case 'denied':
      return `У акаунта ${s.email} немає прав адміністратора.`;
    default:
      return 'Доступ лише для адміністраторів магазину.';
  }
}
