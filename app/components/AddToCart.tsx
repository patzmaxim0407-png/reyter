'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCart } from './CartProvider';
import {
  productSizes,
  availability,
  uah,
  isSet,
  isSized,
  setParts,
  type Catalogue
} from '@/lib/catalog';
import { t, tx } from '@/lib/i18n';
import type { Lang, Product } from '@/lib/types';
import ProductSizeGuide from './ProductSizeGuide';
import RestockNotice from './RestockNotice';
import { usePublishStock } from './StockStatus';
import { metaProductParams, trackMeta } from '@/lib/meta';

/* Єдиний інтерактивний острівець на сторінці товару.
   Решта сторінки — статичний HTML із сервера: так вона зʼявляється
   миттєво й повністю індексується, а сюди приїжджає лише те, що
   справді потребує стану. */

type PartPick = { id: string; size: string | null };

export default function AddToCart({
  c,
  p,
  lang = 'uk'
}: {
  c: Catalogue;
  p: Product;
  lang?: Lang;
}) {
  const cart = useCart();
  const av = useMemo(() => availability(c, p), [c, p]);
  const parts = useMemo(() => setParts(c, p), [c, p]);

  /* Перший доступний розмір — саме в порядку сітки, а не в тому,
     в якому розміри лежать у базі: підсвіченою має бути та сама
     пілюля, що стоїть першою на екрані. */
  const firstFree = (a: { soldOut: boolean; sizes: string[] }, of: Product = p) =>
    a.soldOut ? null : productSizes(of).find((s) => a.sizes.includes(s)) ?? null;

  const [size, setSize] = useState<string | null>(() => {
    if (isSet(p) && parts.length) return null;
    if (p.volume) return av.soldOut ? null : p.volume;
    if (!isSized(p)) return null;
    return firstFree(av);
  });

  /* Комплект: по розміру на кожен складник */
  const [picks, setPicks] = useState<PartPick[]>(() =>
    parts.map((part) => {
      const pav = availability(c, part);
      if (!isSized(part)) return { id: part.id, size: pav.soldOut ? null : part.volume ?? '' };
      return { id: part.id, size: firstFree(pav, part) };
    })
  );

  /* Складник, який тримає весь комплект розпроданим. */
  const blocker = useMemo(() => {
    if (!isSet(p) || !parts.length || !av.soldOut) return null;
    const part = parts.find((x) => availability(c, x).soldOut);
    return part ? { id: part.id, name: part.name } : null;
  }, [p, parts, av.soldOut, c]);

  const [shake, setShake] = useState(false);
  const [added, setAdded] = useState(false);
  const [etaTarget, setEtaTarget] = useState<{ id: string; name: string; size: string | null } | null>(null);

  const isComplect = isSet(p) && parts.length > 0;
  const inCart = cart.qtyOf(p.id, size, isComplect ? picks : undefined);

  /* Наявність комплекту визначає найдефіцитніший складник саме
     в обраних розмірах — загальні цифри тут ні про що */
  const low = useMemo(() => {
    if (!isComplect) return !!(size && av.low.includes(size));
    const left = picks.reduce((min, x) => {
      const part = parts.find((y) => y.id === x.id);
      if (!part || x.size == null) return min;
      const q = isSized(part) ? (c.stock?.[part.id]?.sizes ?? {})[x.size] ?? 0 : c.stock?.[part.id]?.qty ?? 0;
      return Math.min(min, q);
    }, Infinity);
    return left <= 2;
  }, [isComplect, picks, parts, c, size, av.low]);

  /* Значок наявності над ціною читає саме це. */
  usePublishStock({ soldOut: av.soldOut, low: !av.soldOut && low });

  /* Картка може бути і повною сторінкою, і модальним вікном із
     каталогу. В обох випадках це справжній перегляд товару. */
  useEffect(() => {
    trackMeta('ViewContent', metaProductParams(p));
  }, [p.id, p.name, p.price, p.category]);

  function pick(partId: string, value: string) {
    setPicks((prev) => prev.map((x) => (x.id === partId ? { ...x, size: value } : x)));
  }

  function shakeSizes() {
    setShake(false);
    requestAnimationFrame(() => setShake(true));
    setTimeout(() => setShake(false), 500);
  }

  function handleAdd() {
    if (av.soldOut || added) return;

    if (isComplect) {
      // Комплект збирається тільки повністю: не можна покласти
      // в кошик половину, а другу «дообрати потім»
      if (picks.some((x) => x.size == null)) return shakeSizes();
    } else if (!p.volume && isSized(p) && !size) {
      return shakeSizes();
    }

    cart.add(p.id, size, isComplect ? picks : undefined);
    trackMeta('AddToCart', metaProductParams(p));
    setAdded(true);
    // Зелений стан із галочкою короткий: підтвердження видно,
    // але кнопка знову доступна вже через 0.8 секунди.
    setTimeout(() => setAdded(false), 800);
  }

  return (
    <>
      {isComplect ? (
        <div className="pinfo__sizes">
          <div className="pinfo__sizes-head">
            <span>{t('p.setParts', lang)}</span>
            <ProductSizeGuide lang={lang} />
          </div>
          <div className={'sizes sizes--set' + (shake ? ' shake' : '')}>
            <p className="setsizes__note">
              {t('p.setNote', lang)}
            </p>
            {parts.map((part, n) => {
              const pav = availability(c, part);
              const chosen = picks[n]?.size ?? null;
              /* Складник комплекту — теж товар зі своєю сіткою. */
              const options = isSized(part) ? productSizes(part) : [part.volume ?? ''];
              return (
                <div className={'setpart' + (pav.soldOut ? ' is-out' : '')} key={part.id}>
                  <div className="setpart__head">
                    <img src={part.images[0]} alt="" loading="lazy" />
                    <span>
                      <b>{part.name}</b>
                      <em>{pav.soldOut ? t('p.soldOut', lang) : part.id}</em>
                    </span>
                  </div>
                  <div className="sizes">
                    {options.map((s) => {
                      const has = !pav.soldOut && (!isSized(part) || pav.sizes.includes(s));
                      const isLow = has && pav.low.includes(s);
                      return has ? (
                        <span
                          key={s || 'one'}
                          className={
                            'size-pill' +
                            (has ? '' : ' size-pill--out') +
                            (isLow ? ' size-pill--low' : '')
                          }
                        >
                          <input
                            type="radio"
                            name={`part-${n}`}
                            id={`part-${n}-${s || 'one'}`}
                            value={s}
                            checked={chosen === s}
                            onChange={() => pick(part.id, s)}
                          />
                          <label htmlFor={`part-${n}-${s || 'one'}`}>
                            {s ? tx(s, lang) : t('p.onePiece', lang)}
                          </label>
                        </span>
                      ) : (
                        <button
                          type="button"
                          key={s || 'one'}
                          className="size-pill size-pill--out size-pill__alert"
                          onClick={() => setEtaTarget({ id: part.id, name: part.name, size: s || null })}
                        >
                          {s ? tx(s, lang) : t('p.onePiece', lang)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : isSized(p) || p.volume ? (
        <div className="pinfo__sizes">
          <div className="pinfo__sizes-head">
            <span>{t(p.volume ? 'p.volume' : 'p.size', lang)}</span>
            {!p.volume ? <ProductSizeGuide lang={lang} /> : null}
          </div>
          <div className={'sizes' + (shake ? ' shake' : '')}>
            {(p.volume ? [p.volume] : productSizes(p)).map((s) => {
              const has = !av.soldOut && (p.volume ? true : av.sizes.includes(s));
              const isLow = has && av.low.includes(s);
              return has ? (
                <span
                  key={s}
                  className={
                    'size-pill' + (has ? '' : ' size-pill--out') + (isLow ? ' size-pill--low' : '')
                  }
                >
                  <input
                    type="radio"
                    name="pm-size"
                    id={`size-${s}`}
                    value={s}
                    checked={size === s}
                    onChange={() => setSize(s)}
                  />
                  <label htmlFor={`size-${s}`}>{tx(s, lang)}</label>
                </span>
              ) : (
                <button
                  type="button"
                  key={s}
                  className="size-pill size-pill--out size-pill__alert"
                  onClick={() => setEtaTarget({ id: p.id, name: p.name, size: p.volume ? null : s })}
                >
                  {tx(s, lang)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {etaTarget || av.soldOut ? (
        <RestockNotice
          productId={etaTarget?.id ?? p.id}
          productName={etaTarget?.name ?? p.name}
          size={etaTarget?.size ?? null}
          lang={lang}
          /* Комплекту нічого не «приходить»: на склад їдуть речі.
             Тому дату беремо в того складника, через який комплект
             і став недоступним, а чекає покупець усе одно комплект. */
          etaOf={etaTarget ? null : blocker}
        />
      ) : null}

      <div className="pinfo__cta">
        <span className="pinfo__cta-price" aria-hidden="true">
          {uah(p.price, lang)}
        </span>

        {inCart > 0 && !added ? (
          <div className="pinfo__incart">
            <span className="qty qty--lg">
              <button
                type="button"
                aria-label={t('cart.less', lang)}
                onClick={() => cart.setQtyOf(p.id, size, isComplect ? picks : undefined, inCart - 1)}
              >
                −
              </button>
              <span>{inCart}</span>
              <button
                type="button"
                aria-label={t('cart.more', lang)}
                onClick={() => cart.setQtyOf(p.id, size, isComplect ? picks : undefined, inCart + 1)}
              >
                +
              </button>
            </span>
            <button className="btn btn--ghost" type="button" onClick={cart.open}>
              {t('p.goCart', lang)}
            </button>
          </div>
        ) : (
          <button
            className={'btn btn--primary btn--order' + (added ? ' is-added' : '')}
            type="button"
            disabled={av.soldOut}
            onClick={handleAdd}
          >
            {/* Кошик перетворюється на галочку — підтвердження, що
                товар додано. Обидві іконки лежать у розмітці, показ
                перемикає клас is-added. */}
            <svg className="ico-cart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M6 8h12l-1 13H7L6 8Z" /><path d="M9 10V6a3 3 0 0 1 6 0v4" /></svg>
            <svg className="ico-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m4.5 12.5 5 5 10-11" /></svg>
            <span>{av.soldOut ? t('p.soldOut', lang) : added ? t('p.added', lang) : t('p.addToCart', lang)}</span>
          </button>
        )}
      </div>

    </>
  );
}
