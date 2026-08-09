'use client';

import { useEffect, useRef, useState } from 'react';
import * as cart from '@/lib/cart';
import * as fb from '@/lib/firebase';
import {
  promoCheck,
  promoMessage,
  promoNormalize,
  promoSaveCode,
  promoSavedCode,
  type Promo
} from '@/lib/promo';
import { catTitle, uah, type Catalogue } from '@/lib/catalog';
import { t } from '@/lib/i18n';

/* Промокод. Умови ніколи не беруться зі сховища — тільки з бази:
   там лежить сам код і нічого більше, інакше підроблений обʼєкт
   у localStorage давав би будь-яку знижку. */

export default function PromoField({
  c,
  onChange
}: {
  c: Catalogue;
  onChange(promo: Promo | null, discount: number): void;
}) {
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<Promo | null>(null);
  const [off, setOff] = useState(0);
  const [partial, setPartial] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function apply(raw: string, silent = false) {
    const clean = promoNormalize(raw);
    if (!clean) return;

    const who = fb.auth()?.currentUser?.email ?? '';
    const deps = {
      t,
      categoryTitle: (id: string) => catTitle(c, id),
      productName: (id: string) => c.products.find((p) => p.id === id)?.name ?? '',
      guest: !who
    };

    setBusy(true);
    const found = (await fb.promoFetch(clean)) as Promo | null;
    const res = promoCheck(found, cart.forPromo(c), null, who);
    setBusy(false);

    if (res.ok) {
      setApplied(found);
      setOff(res.discount ?? 0);
      setPartial(!!res.partial);
      setCode('');
      promoSaveCode(clean);
      setMsg(null);
      onChange(found, res.discount ?? 0);
      return;
    }

    setApplied(null);
    setOff(0);
    promoSaveCode('');
    onChange(null, 0);
    /* Мовчки — коли код підтягнувся зі сховища сам: покупець його
       щойно не вводив, і докір йому ні за що */
    if (silent) return;
    setMsg({ ok: false, text: promoMessage(res, found, deps) });
    input.current?.focus();
  }

  /* Раніше застосований код перечитуємо з бази при відкритті:
     адмін міг його вимкнути або він міг протермінуватись */
  useEffect(() => {
    const saved = promoSavedCode();
    if (saved) void apply(saved, true);
    // разово, на монтуванні
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (applied) {
    return (
      <>
        <div className="promo promo--on">
          <div className="promo__badge">
            <b>{applied.code}</b>
            <span>{t('promo.applied')}</span>
          </div>
          <span className="promo__sum">−{uah(off)}</span>
          <button
            className="promo__remove"
            type="button"
            aria-label={t('promo.remove')}
            onClick={() => {
              setApplied(null);
              setOff(0);
              setMsg(null);
              promoSaveCode('');
              onChange(null, 0);
            }}
          >
            ✕
          </button>
        </div>
        {partial ? <p className="promo__hint is-ok">{t('promo.partial')}</p> : null}
      </>
    );
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
            void apply(code);
          }}
        />
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          disabled={busy || !code.trim()}
          onClick={() => void apply(code)}
        >
          {busy ? t('promo.checking') : t('promo.apply')}
        </button>
      </div>
      {msg ? <p className={'promo__hint' + (msg.ok ? ' is-ok' : ' is-err')}>{msg.text}</p> : null}
    </>
  );
}
