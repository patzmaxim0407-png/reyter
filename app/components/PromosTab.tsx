'use client';

import { useLang } from './LangProvider';
import type { User } from 'firebase/auth';
import AuthPanel from './AuthPanel';
import { useToast } from './Toasts';
import { copyText } from '@/lib/copy';
import { promoSaveCode, type Promo } from '@/lib/promo';
import { promoCard } from '@/lib/account';
import { catTitle, type Catalogue } from '@/lib/catalog';

/* Персональні знижки покупця.

   Список щоразу перечитується з бази: після замовлення лічильник
   змінився, і код міг стати вичерпаним. Показати вчорашній стан
   означало б пообіцяти знижку, якої вже немає. */

export default function PromosTab({
  c,
  user,
  list
}: {
  c: Catalogue;
  user: User | null;
  /* Коди вантажить сторінка кабінету — їх кількість видно ще
     й у шапці, тож джерело має бути одне. null — ще вантажимо. */
  list: Promo[] | null;
}) {
  const { t, lang } = useLang();
  const toast = useToast();

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
                    void copyText(card.code).then((done) =>
                      toast(t(done ? 'acc.promoCopied' : 'cart.copyFail'), done ? 'success' : 'plain')
                    );
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
