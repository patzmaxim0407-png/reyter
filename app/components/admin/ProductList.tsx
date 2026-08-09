'use client';

import { useMemo } from 'react';
import type { Category, Product } from '@/lib/types';
import { fmt, inCategory, isSet, productCats } from '@/lib/catalog';

/* Список товарів. Розмітка й класи ті самі, що в admin.html. */

type Act = 'edit' | 'dup' | 'toggle' | 'del';

export default function ProductList({
  categories,
  products,
  current,
  onAct
}: {
  categories: Category[];
  products: Product[];
  current: string;
  onAct(act: Act, p: Product): void;
}) {
  const catTitle = (id: string) => categories.find((c) => c.id === id)?.title ?? id;

  const items = useMemo(
    () => products.filter((p) => current === 'all' || inCategory(p, current)),
    [products, current]
  );

  /* «Всі товари» — довгий суцільний список, у якому легко
     загубитися. Групуємо за головною категорією в тому ж порядку,
     що й ліва колонка; товар із кількох категорій показуємо один
     раз — там, де він числиться головним. Категорію, якої вже
     немає, не ховаємо: інакше товар зник би зі списку зовсім. */
  const groups = useMemo(() => {
    if (current !== 'all') return null;
    const known = categories.map((c) => c.id);
    const out = categories.map((c) => ({
      id: c.id,
      title: c.title,
      list: items.filter((p) => p.category === c.id)
    }));
    const orphans = items.filter((p) => !known.includes(p.category));
    if (orphans.length) out.push({ id: '', title: 'Без категорії', list: orphans });
    return out.filter((g) => g.list.length);
  }, [current, categories, items]);

  function Item({ p }: { p: Product }) {
    const tags = [
      p.status === 'sold-out' ? ['sold', 'Продано'] : null,
      p.sale ? ['sale', 'Sale'] : null,
      p.hidden ? ['hidden', 'Сховано'] : null,
      isSet(p) ? ['set', 'Комплект'] : null
    ].filter(Boolean) as [string, string][];

    /* У комплекту показуємо не розміри, а склад: розміру
       «комплекту» не існує, покупець обирає кожну річ окремо */
    const meta = isSet(p)
      ? (p.set ?? [])
          .map((id) => products.find((y) => y.id === id)?.name ?? `${id} (немає)`)
          .join(' + ')
      : (p.sizes ?? []).join(', ');

    return (
      <div className={'a-item' + (p.hidden ? ' is-hidden-product' : '')}>
        <img
          className="a-item__img"
          src={p.images?.[0] ?? ''}
          alt=""
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        <div>
          <div className="a-item__name">
            {p.name}
            {tags.map(([cls, text]) => (
              <span className={`a-item__tag a-item__tag--${cls}`} key={cls}>
                {text}
              </span>
            ))}
          </div>
          <div className="a-item__meta">
            {[p.id, productCats(p).map(catTitle).join(' + '), `${fmt(p.price)} грн`, meta]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="a-item__actions">
          <button title="Редагувати" aria-label="Редагувати товар" onClick={() => onAct('edit', p)}>
            ✎
          </button>
          <button title="Дублювати" aria-label="Дублювати товар" onClick={() => onAct('dup', p)}>
            ⧉
          </button>
          <button
            title={p.hidden ? 'Показати' : 'Сховати'}
            aria-label={p.hidden ? 'Показати товар на сайті' : 'Сховати товар із сайту'}
            onClick={() => onAct('toggle', p)}
          >
            {p.hidden ? '🙈' : '👁'}
          </button>
          <button
            className="danger"
            title="Видалити"
            aria-label="Видалити товар"
            onClick={() => onAct('del', p)}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="a-empty">
        Тут поки немає товарів.
        <br />
        Натисніть «+ Новий товар», щоб додати перший.
      </div>
    );
  }

  if (!groups) return <>{items.map((p) => <Item p={p} key={p.id} />)}</>;

  return (
    <>
      {groups.map((g) => (
        <div key={g.id || 'none'}>
          <h3 className="a-group">
            {g.title}
            <span>{g.list.length}</span>
          </h3>
          {g.list.map((p) => (
            <Item p={p} key={p.id} />
          ))}
        </div>
      ))}
    </>
  );
}
