'use client';

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import AuthPanel from './AuthPanel';
import { useToast } from './Toasts';
import * as fb from '@/lib/firebase';
import { promoSaveCode, type Promo } from '@/lib/promo';
import { promoCard, sortMyPromos } from '@/lib/account';
import { catTitle, type Catalogue } from '@/lib/catalog';
import { t } from '@/lib/i18n';

/* Персональні знижки покупця.

   Список щоразу перечитується з бази: після замовлення лічильник
   змінився, і код міг стати вичерпаним. Показати вчорашній стан
   означало б пообіцяти знижку, якої вже немає. */

export default function PromosTab({ c, user }: { c: Catalogue; user: User | null }) {
  const [list, setList] = useState<Promo[] | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!user?.email) {
      setList([]);
      return;
    }
    let alive = true;
    setList(null);
    void fb.promoMine(user.email).then((rows) => {
      // спершу ті, що згорають раніше; безстрокові — на початку
      if (alive) setList(sortMyPromos(rows as Promo[]));
    });
    return () => {
      alive = false;
    };
  }, [user]);

  const deps = {
    t,
    categoryTitle: (id: string) => catTitle(c, id),
    productName: (id: string) => c.products.find((p) => p.id === id)?.name ?? ''
  };

  if (!user) {
    return (
      <>
        <p className="account-note">{t('acc.promosGuest')}</p>
        <AuthPanel note={false} />
      </>
    );
  }

  if (list === null) return <p className="account-note">{t('acc.loading')}</p>;

  if (!list.length) {
    return (
      <div className="empty-state">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 12a2 2 0 0 1 0-4V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2a2 2 0 0 1 0 4 2 2 0 0 1 0 4v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2a2 2 0 0 1 0-4Z" />
          <path d="M12 7v10" />
        </svg>
        <strong>{t('acc.noPromos')}</strong>
        {t('acc.noPromosNote')}
      </div>
    );
  }

  return (
    <>
      <p className="account-note">{t('acc.promosNote')}</p>
      {list.map((p) => {
        const card = promoCard(p, deps);
        return (
          <article className={'mypromo' + (card.ok ? '' : ' is-off')} key={card.code}>
            <div className="mypromo__top">
              <b className="mypromo__code">{card.code}</b>
              <span className="mypromo__value">{card.value}</span>
              <span className={'mypromo__state' + (card.ok ? ' is-live' : '')}>{card.label}</span>
            </div>
            <p className="mypromo__terms">{card.terms}</p>
            {/* У неактивного коду кнопок немає взагалі — ані
                застосувати, ані скопіювати */}
            {card.ok ? (
              <div className="mypromo__actions">
                <button
                  className="btn btn--primary btn--sm"
                  type="button"
                  onClick={() => {
                    /* Код лягає у сховище, а не в кошик: умови
                       все одно перечитає сторінка оформлення */
                    promoSaveCode(card.code);
                    toast(t('acc.promoCopied'), 'success');
                  }}
                >
                  {t('acc.applyPromo')}
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(card.code);
                    toast(t('acc.promoCopied'), 'success');
                  }}
                >
                  {t('acc.copyPromo')}
                </button>
              </div>
            ) : null}
          </article>
        );
      })}
    </>
  );
}
