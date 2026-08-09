'use client';

import { useEffect, useRef, useState } from 'react';
import { fmt } from '@/lib/catalog';
import type { Product } from '@/lib/types';

/* Вибір картки того самого товару в іншому кольорі.

   Власний список, а не native select, — саме через фото: у
   каталозі по кілька «Бріфи classic», і відрізнити їх за назвою
   неможливо. Панель позиціонується фіксовано, тож прокрутка
   модалки її не обрізає; напрямок — туди, де більше місця. */

export default function ColorPicker({
  value,
  choices,
  emptyNote,
  onPick
}: {
  value: string;
  choices: Product[];
  emptyNote: string;
  onPick(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const picked = choices.find((x) => x.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // у захваті: інакше клік по пункту всередині панелі закрив би її раніше
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  function place() {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    // вниз, якщо там більше місця; інакше вгору
    if (below > 220 || below >= r.top) {
      setBox({
        left: r.left,
        width: r.width,
        top: r.bottom + 4,
        maxHeight: Math.max(160, Math.min(340, below - 12))
      });
    } else {
      setBox({
        left: r.left,
        width: r.width,
        bottom: window.innerHeight - r.top + 4,
        maxHeight: Math.max(160, Math.min(340, r.top - 12))
      });
    }
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        className="a-colorpick"
        ref={trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : place())}
      >
        {picked ? (
          <>
            <img
              src={picked.images?.[0] ?? ''}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
            <span>
              <b>{picked.name}</b>
              <em>{picked.id}</em>
            </span>
          </>
        ) : (
          <span className="a-colorpick__ph">— без привʼязки —</span>
        )}
        <i className="a-colorpick__caret">▾</i>
      </button>

      {open && box ? (
        <div
          className="a-colordrop"
          role="listbox"
          style={{
            position: 'fixed',
            left: box.left,
            width: box.width,
            top: box.top,
            bottom: box.bottom,
            maxHeight: box.maxHeight
          }}
        >
          <button
            type="button"
            className="a-colordrop__none"
            onClick={() => {
              onPick('');
              setOpen(false);
            }}
          >
            — без привʼязки —
          </button>

          {choices.length ? (
            choices.map((x) => (
              <button
                type="button"
                key={x.id}
                className={'a-colordrop__opt' + (x.id === value ? ' is-active' : '')}
                onClick={() => {
                  onPick(x.id);
                  setOpen(false);
                }}
              >
                <img
                  src={x.images?.[0] ?? ''}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
                <span>
                  <b>{x.name}</b>
                  <em>
                    {x.id} · {fmt(x.price)} грн
                  </em>
                </span>
              </button>
            ))
          ) : (
            <p className="a-colordrop__empty">{emptyNote}</p>
          )}
        </div>
      ) : null}
    </>
  );
}
