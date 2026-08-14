'use client';

import { useRef, useState } from 'react';
import type { Category, Product } from '@/lib/types';
import { productCats } from '@/lib/catalog';

/* Ліва колонка адмінки. Розмітка й класи ті самі, що в admin.html.

   Перетягування зроблено на власних подіях, а не на HTML5
   drag-and-drop: на тачскрині той не працює зовсім, а категорії
   переставляють саме з телефона між справами. Стрілки ↑↓
   лишаються — мишею влучити в тонкий рядок важко. */

export default function CategoryList({
  categories,
  products,
  current,
  onPick,
  onAdd,
  onRename,
  onDelete,
  onReorder
}: {
  categories: Category[];
  products: Product[];
  current: string;
  onPick(id: string): void;
  onAdd(name: string): void;
  onRename(cat: Category): void;
  onDelete(cat: Category): void;
  onReorder(from: number, to: number): void;
}) {
  const [name, setName] = useState('');
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    from: number;
    to: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  /* Товар може стояти в кількох категоріях — лічильник має це
     враховувати, інакше сума лічильників не зійдеться з життям */
  const countIn = (id: string) => products.filter((p) => productCats(p).includes(id)).length;

  const move = (i: number, step: number) => {
    const to = i + step;
    if (to < 0 || to >= categories.length) return;
    onReorder(i, to);
  };

  const dragStart = (e: React.PointerEvent<HTMLButtonElement>, from: number) => {
    // Правою кнопкою й контекстним меню категорію не тягнемо.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      from,
      to: from,
      startX: e.clientX,
      startY: e.clientY,
      active: false
    };
  };

  const dragMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;

    /* Поріг відділяє перетягування від звичайного кліку. Без
       нього рука ледь здригнулась — і категорія вже переїхала. */
    if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    d.active = true;
    e.preventDefault();
    e.stopPropagation();

    const row = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-cat-index]');
    const to = Number(row?.dataset.catIndex);
    if (!Number.isInteger(to) || to < 0 || to >= categories.length) return;
    d.to = to;
    setDrag((v) => (v?.from === d.from && v.to === to ? v : { from: d.from, to }));
  };

  const dragEnd = (e: React.PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.active) e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setDrag(null);
    if (commit && d.active && d.to !== d.from) onReorder(d.from, d.to);
  };

  return (
    <aside className="a-side">
      <h2>Категорії</h2>

      <ul className="a-cats">
        <li
          className={'a-cat' + (current === 'all' ? ' is-active' : '')}
          onClick={() => onPick('all')}
        >
          Всі товари <span className="a-cat__count">{products.length}</span>
        </li>

        {categories.map((c, i) => (
          <li
            key={c.id}
            data-cat-index={i}
            className={
              'a-cat' +
              (current === c.id ? ' is-active' : '') +
              (drag?.from === i ? ' is-dragging' : '') +
              (drag?.to === i && drag.from !== i ? ' is-drop-target' : '')
            }
            onClick={() => onPick(c.id)}
          >
            <button
              type="button"
              className="a-cat__grip"
              title="Перетягніть або використайте стрілки ↑↓"
              aria-label={`Перемістити категорію ${c.title}`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => dragStart(e, i)}
              onPointerMove={dragMove}
              onPointerUp={(e) => dragEnd(e, true)}
              onPointerCancel={(e) => dragEnd(e, false)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(i, -1);
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(i, 1);
                }
              }}
            >
              ⠿
            </button>
            {c.title}
            <span className="a-cat__count">{countIn(c.id)}</span>
            <span className="a-cat__tools">
              <button
                title="Вгору"
                aria-label="Підняти категорію"
                onClick={(e) => {
                  e.stopPropagation();
                  move(i, -1);
                }}
              >
                ↑
              </button>
              <button
                title="Вниз"
                aria-label="Опустити категорію"
                onClick={(e) => {
                  e.stopPropagation();
                  move(i, 1);
                }}
              >
                ↓
              </button>
              <button
                title="Перейменувати"
                aria-label="Перейменувати категорію"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(c);
                }}
              >
                ✎
              </button>
              <button
                title="Видалити"
                aria-label="Видалити категорію"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c);
                }}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>

      <form
        className="a-addcat"
        onSubmit={(e) => {
          e.preventDefault();
          const v = name.trim();
          if (!v) return;
          onAdd(v);
          setName('');
        }}
      >
        <input
          placeholder="Нова категорія"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn--primary btn--sm" type="submit">
          Додати
        </button>
      </form>

      <details className="a-side__note">
        <summary>Як це працює</summary>
        Усе, що ви створюєте чи редагуєте тут, зберігається в <b>чернетку</b> — покупці
        цього не бачать. Коли зміни готові, натисніть <b>«Опублікувати»</b> угорі: одразу
        або на обраний день і час. До того сайт показує попередню опубліковану версію.
      </details>
    </aside>
  );
}
