'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import * as fb from '@/lib/firebase';
import { gateMessage, isAdminUser, type GateState } from '@/lib/admin/access';
import { SHOP_URL } from './AdminBar';

/* Екран входу в адмінку. Розмітка й класи ті самі, що в
   admin.html, тож admin.css підходить без правок.

   Поки доступ не підтверджено, вміст адмінки не рендериться
   взагалі — не ховається, а саме не існує. Інакше дані каталогу
   встигли б поїхати в браузер тому, кому вони не призначені. */

const Ctx = createContext<User | null>(null);

/** Адміністратор, який зараз працює. Поза гейтом не буває —
 *  усе, що всередині, рендериться лише після перевірки прав. */
export function useAdminUser(): User {
  const u = useContext(Ctx);
  if (!u) throw new Error('useAdminUser поза AdminGate');
  return u;
}

export default function AdminGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!fb.auth()) {
      setState({ kind: 'offline' });
      return;
    }
    return fb.watchAuth((u) => {
      setUser(u);
      if (!u) {
        setState({ kind: 'anonymous' });
        return;
      }
      setState({ kind: 'checking' });
      void isAdminUser(u).then((ok) =>
        setState(ok ? { kind: 'ok' } : { kind: 'denied', email: u.email ?? '' })
      );
    });
  }, []);

  if (state.kind === 'ok' && user) return <Ctx.Provider value={user}>{children}</Ctx.Provider>;

  return (
    <div className="a-gate-screen">
      <div className="a-gate-screen__box">
        <img src="https://reyter.men/assets/images/logo_4.webp" alt="REYTER" />
        <h2>REYTER · Адмінка</h2>
        <p>{gateMessage(state)}</p>

        {state.kind === 'anonymous' ? (
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => {
              void fb.loginGoogle().catch((err) => setState({ kind: 'denied', email: fb.authError(err) }));
            }}
          >
            Увійти через Google
          </button>
        ) : null}

        {state.kind === 'denied' ? (
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => void fb.logout()}>
            Вийти та увійти іншим акаунтом
          </button>
        ) : null}

        <a className="a-gate-screen__back" href={SHOP_URL}>
          ← Повернутися на сайт
        </a>
      </div>
    </div>
  );
}
