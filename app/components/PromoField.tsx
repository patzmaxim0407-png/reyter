'use client';

import { useRef, useState } from 'react';
import { promoNormalize, type Promo } from '@/lib/promo';
import { uah } from '@/lib/catalog';
import { t } from '@/lib/i18n';

/* Поле промокоду.

   Власного стану про застосований код тут немає навмисно: його
   тримає сторінка оформлення. Інакше при зміні кошика рядок
   знижки зникав би, а зелений бейдж «код застосовано» лишався —
   покупець бачив би два різні твердження одночасно. */

export default function PromoField({
  promo,
  discount,
  partial,
  message,
  busy,
  onApply,
  onDrop
}: {
  promo: Promo | null;
  discount: number;
  partial: boolean;
  message: { ok: boolean; text: string } | null;
  busy: boolean;
  onApply(code: string): void;
  onDrop(): void;
}) {
  const [code, setCode] = useState('');
  const input = useRef<HTMLInputElement>(null);

  if (promo) {
    return (
      <>
        <div className="promo promo--on">
          <div className="promo__badge">
            <b>{promo.code}</b>
            <span>{t('promo.applied')}</span>
          </div>
          <span className="promo__sum">−{uah(discount)}</span>
          <button
            className="promo__remove"
            type="button"
            aria-label={t('promo.remove')}
            onClick={onDrop}
          >
            ✕
          </button>
        </div>
        {partial ? <p className="promo__hint is-ok">{t('promo.partial')}</p> : null}
      </>
    );
  }

  function apply() {
    const clean = promoNormalize(code);
    if (!clean) return;
    setCode('');
    onApply(clean);
    input.current?.focus();
  }

  return (
    <>
      <div className="promo">
        <input
          ref={input}
          value={code}
          placeholder={t('promo.placeholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            // інакше Enter у цьому полі відправляв би всю форму
            if (e.key !== 'Enter') return;
            e.preventDefault();
            apply();
          }}
        />
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          disabled={busy || !code.trim()}
          onClick={apply}
        >
          {busy ? t('promo.checking') : t('promo.apply')}
        </button>
      </div>
      {message ? (
        <p className={'promo__hint' + (message.ok ? ' is-ok' : ' is-err')}>{message.text}</p>
      ) : null}
    </>
  );
}
