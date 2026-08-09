'use client';

import { trackerHint, trackerSteps } from '@/lib/account';
import { useLang } from './LangProvider';

/* Крокомір доставки. Порожній список кроків означає скасоване
   замовлення: шлях обірвався, і замість нього — один рядок. */

export default function Tracker({ status }: { status?: string | null }) {
  const { t } = useLang();
  const steps = trackerSteps(status, t);
  const hint = trackerHint(status, t);

  if (!steps.length) return <div className="tracker tracker--cancelled">{hint}</div>;

  return (
    <>
      <div className="tracker">
        {steps.map((s) => (
          <div
            className={'tracker__step' + (s.done ? ' is-done' : '') + (s.current ? ' is-current' : '')}
            key={s.id}
          >
            <span className="tracker__dot" />
            <span className="tracker__label">{s.title}</span>
          </div>
        ))}
      </div>
      {hint ? <p className="tracker__hint">{hint}</p> : null}
    </>
  );
}
