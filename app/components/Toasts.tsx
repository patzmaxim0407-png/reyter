'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/* ============================================================
   Спливні повідомлення
   ------------------------------------------------------------
   Порт R.toast. Розмітка й класи ті самі, що в ui.js, тож стилі
   підходять без правок.

   Тримати їх у контексті, а не в модульній змінній, довелося
   через сервер: модуль там спільний для всіх запитів, і черга
   повідомлень одного покупця показалась би іншому.
   ============================================================ */

type Kind = 'plain' | 'success';
type Toast = { id: number; text: string; kind: Kind; leaving: boolean };

const Ctx = createContext<((text: string, kind?: Kind) => void) | null>(null);

/** Показати повідомлення. Поза провайдером мовчить, а не падає:
 *  повідомлення — не та річ, заради якої варто валити сторінку. */
export function useToast() {
  return useContext(Ctx) ?? (() => {});
}

let seq = 0;

export default function Toasts({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);

  const show = useCallback((text: string, kind: Kind = 'plain') => {
    const id = ++seq;
    setList((v) => [...v, { id, text, kind, leaving: false }]);

    // 2,4 с на прочитання, тоді 320 мс на зникнення — як в оригіналі
    setTimeout(() => {
      setList((v) => v.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
      setTimeout(() => setList((v) => v.filter((x) => x.id !== id)), 320);
    }, 2400);
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" id="toasts" aria-live="polite">
        {list.map((x) => (
          <div
            key={x.id}
            className={
              'toast' + (x.kind === 'success' ? ' toast--success' : '') + (x.leaving ? ' is-leaving' : '')
            }
          >
            {x.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
