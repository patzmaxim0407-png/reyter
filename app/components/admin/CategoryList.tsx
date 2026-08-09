'use client';

import { useState } from 'react';
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

  /* Товар може стояти в кількох категоріях — лічильник має це
     враховувати, інакше сума лічильників не зійдеться з життям */
  const countIn = (id: string) => products.filter((p) => productCats(p).includes(id)).length;

  const move = (i: number, step: number) => {
    const to = i + step;
    if (to < 0 || to >= categories.length) return;
    onReorder(i, to);
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
            className={'a-cat' + (current === c.id ? ' is-active' : '')}
            onClick={() => onPick(c.id)}
          >
            <button
              type="button"
              className="a-cat__grip"
              title="Стрілки ↑↓ змінюють порядок"
              aria-label="Перемістити категорію"
              onClick={(e) => e.stopPropagation()}
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
