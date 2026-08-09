'use client';

import { useMemo, useState } from 'react';
import { useCart } from './CartProvider';
import {
  ALL_SIZES,
  availability,
  isSet,
  isSized,
  setParts,
  type Catalogue
} from '@/lib/catalog';
import type { Product } from '@/lib/types';

/* Єдиний інтерактивний острівець на сторінці товару.
   Решта сторінки — статичний HTML із сервера: так вона зʼявляється
   миттєво й повністю індексується, а сюди приїжджає лише те, що
   справді потребує стану. */

type PartPick = { id: string; size: string | null };

export default function AddToCart({ c, p }: { c: Catalogue; p: Product }) {
  const cart = useCart();
  const av = useMemo(() => availability(c, p), [c, p]);
  const parts = useMemo(() => setParts(c, p), [c, p]);

  /* Перший доступний розмір — саме в порядку сітки, а не в тому,
     в якому розміри лежать у базі: підсвіченою має бути та сама
     пілюля, що стоїть першою на екрані. */
  const firstFree = (a: { soldOut: boolean; sizes: string[] }) =>
    a.soldOut ? null : ALL_SIZES.find((s) => a.sizes.includes(s)) ?? null;

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
      return { id: part.id, size: firstFree(pav) };
    })
  );

  const [shake, setShake] = useState(false);
  const [added, setAdded] = useState(false);

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
    setAdded(true);
    setTimeout(() => setAdded(false), 1100);
  }

  return (
    <>
      {isComplect ? (
        <div className="pinfo__sizes">
          <div className="pinfo__sizes-head">
            <span>Складники комплекту</span>
          </div>
          <div className={'sizes sizes--set' + (shake ? ' shake' : '')}>
            <p className="setsizes__note">
              Оберіть розмір для кожної речі — комплект збереться саме під вас.
            </p>
            {parts.map((part, n) => {
              const pav = availability(c, part);
              const chosen = picks[n]?.size ?? null;
              const options = isSized(part) ? ALL_SIZES : [part.volume ?? ''];
              return (
                <div className={'setpart' + (pav.soldOut ? ' is-out' : '')} key={part.id}>
                  <div className="setpart__head">
                    <img src={part.images[0]} alt="" loading="lazy" />
                    <span>
                      <b>{part.name}</b>
                      <em>{pav.soldOut ? 'Продано' : part.id}</em>
                    </span>
                  </div>
                  <div className="sizes">
                    {options.map((s) => {
                      const has = !pav.soldOut && (!isSized(part) || pav.sizes.includes(s));
                      const isLow = has && pav.low.includes(s);
                      return (
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
                            disabled={!has}
                            checked={chosen === s}
                            onChange={() => pick(part.id, s)}
                          />
                          <label htmlFor={`part-${n}-${s || 'one'}`}>
                            {s || 'один розмір'}
                          </label>
                        </span>
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
            <span>{p.volume ? 'Обʼєм' : 'Розмір'}</span>
          </div>
          <div className={'sizes' + (shake ? ' shake' : '')}>
            {(p.volume ? [p.volume] : ALL_SIZES).map((s) => {
              const has = !av.soldOut && (p.volume ? true : av.sizes.includes(s));
              const isLow = has && av.low.includes(s);
              return (
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
                    disabled={!has}
                    checked={size === s}
                    onChange={() => setSize(s)}
                  />
                  <label htmlFor={`size-${s}`}>{s}</label>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="pinfo__cta">
        <span className="pinfo__cta-price" aria-hidden="true">
          {p.price.toLocaleString('uk-UA')} грн
        </span>

        {inCart > 0 && !added ? (
          <div className="pinfo__incart">
            <span className="qty qty--lg">
              <button
                type="button"
                aria-label="Менше"
                onClick={() => cart.setQtyOf(p.id, size, isComplect ? picks : undefined, inCart - 1)}
              >
                −
              </button>
              <span>{inCart}</span>
              <button
                type="button"
                aria-label="Більше"
                onClick={() => cart.setQtyOf(p.id, size, isComplect ? picks : undefined, inCart + 1)}
              >
                +
              </button>
            </span>
            <button className="btn btn--ghost" type="button" onClick={cart.open}>
              Перейти в кошик
            </button>
          </div>
        ) : (
          <button
            className={'btn btn--primary btn--order' + (added ? ' is-added' : '')}
            type="button"
            disabled={av.soldOut}
            onClick={handleAdd}
          >
            {av.soldOut ? 'Продано' : added ? 'Додано ✓' : 'Додати в кошик'}
          </button>
        )}
      </div>

      {!av.soldOut && low ? (
        <p className="pinfo__sale-note">Залишилось мало — устигніть забрати</p>
      ) : null}
    </>
  );
}
