'use client';

import { useEffect } from 'react';
import { useLang } from './LangProvider';
import Link from 'next/link';
import { useCart } from './CartProvider';
import { catTitle, getProduct, uah, FREE_DELIVERY_FROM } from '@/lib/catalog';
import { lockScroll, unlockScroll } from '@/lib/scroll-lock';

/* Панель кошика. Розмітка й класи ті самі, що в index.html
   старого сайту, — стилі підходять без правок. */

export default function CartDrawer() {
  const { t, lang } = useLang();
  const { c, lines, subtotal, isOpen, close, setQty, remove } = useCart();

  /* Поріг рахуємо від суми товарів: знижку тут ще не знають,
     а обіцяти безкоштовну доставку й потім забрати не можна */
  const left = Math.max(0, FREE_DELIVERY_FROM - subtotal);
  const pct = Math.min(100, Math.round((subtotal / FREE_DELIVERY_FROM) * 100));

  /* Поки панель відкрита, сторінка під нею не має скролитись —
     інакше на мобільному палець тягне фон замість списку */
  useEffect(() => {
    if (!isOpen) return;
    lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      unlockScroll();
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, close]);

  return (
    <div
      className={'drawer' + (isOpen ? ' is-open' : '')}
      role="dialog"
      aria-modal="true"
      aria-label={t('cart.title')}
      hidden={!isOpen}
    >
      <div className="drawer__backdrop" onClick={close} />
      <aside className="drawer__panel">
        <header className="drawer__head">
          <h3 className="drawer__title">{t('cart.title')}</h3>
          <button className="drawer__close" type="button" aria-label={t('p.close')} onClick={close}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="drawer__body">
          {lines.length === 0 ? (
            <div className="empty-state">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 8h12l-1 13H7L6 8Z" />
                <path d="M9 10V6a3 3 0 0 1 6 0v4" />
              </svg>
              <strong>{t('cart.empty')}</strong>
              {t('cart.emptyNote')}
            </div>
          ) : (
            lines.map((i) => {
              const cat = catTitle(c, i.p.category);
              return (
                <div className="cart-item" key={i.idx}>
                  <Link href={(lang === 'en' ? '/en' : '') + `/p/${encodeURIComponent(i.p.id)}`} onClick={close}>
                    <img className="cart-item__img" src={i.p.images[0]} alt={i.p.name} />
                  </Link>
                  <div>
                    <div className="cart-item__name">{i.p.name}</div>
                    <div className="cart-item__meta">
                      {/* категорія допомагає впізнати позицію: назви
                          в каталозі повторюються («Бріфи classic» двічі) */}
                      {cat ? cat + ' · ' : ''}
                      {i.size ? `${i.p.volume ? t('p.volume') : t('p.size')}: ${i.size} · ` : ''}
                      {t('p.article')}: {i.p.id}
                    </div>

                    {i.parts?.length ? (
                      <ul className="cart-item__parts">
                        {i.parts.map((x) => {
                          const sp = getProduct(c, x.id);
                          const scat = catTitle(c, sp?.category);
                          return (
                            <li key={x.id}>
                              {[scat, sp?.name ?? x.id, x.size].filter(Boolean).join(' · ')}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}

                    <div className="cart-item__price">{uah(i.sum, lang)}</div>
                  </div>

                  <div className="cart-item__col">
                    <button
                      className="cart-item__remove"
                      type="button"
                      aria-label={t('cart.remove')}
                      onClick={() => remove(i.idx)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                    <span className="qty">
                      <button type="button" aria-label={t('cart.less')} onClick={() => setQty(i.idx, i.qty - 1)}>
                        −
                      </button>
                      <span>{i.qty}</span>
                      <button type="button" aria-label={t('cart.more')} onClick={() => setQty(i.idx, i.qty + 1)}>
                        +
                      </button>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer className="drawer__foot">
          {lines.length === 0 ? (
            <Link className="btn btn--primary" href={(lang === 'en' ? '/en' : '') + '/#catalog'} onClick={close}>
              {t('cart.goCatalog')}
            </Link>
          ) : (
            <>
              {/* Скільки лишилось до безкоштовної доставки —
                  єдина причина, чому покупець тут щось доскладає */}
              <div className="free-ship">
                {left > 0 ? (
                  <>
                    <span dangerouslySetInnerHTML={{ __html: t('cart.freeLeft') }} /> {uah(left, lang)}
                  </>
                ) : (
                  <span dangerouslySetInnerHTML={{ __html: t('cart.freeDone') }} />
                )}
                <div className="free-ship__bar">
                  <div className={'free-ship__fill' + (left === 0 ? ' is-done' : '')} style={{ width: pct + '%' }} />
                </div>
              </div>

              {/* Знижку рахує сторінка оформлення: тут промокод
                  іще не введено, а доставку визначає магазин
                  після підтвердження */}
              <div className="cart-total">
                <span>{t('cart.total')}</span>
                <span className="cart-total__sum">{uah(subtotal, lang)}</span>
              </div>
              <Link className="btn btn--primary" href={(lang === 'en' ? '/en' : '') + '/checkout'} onClick={close}>
                {t('cart.checkout')}
              </Link>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
