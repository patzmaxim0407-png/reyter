'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export default function Lightbox({
  images,
  index,
  open,
  lang,
  alt,
  onIndex,
  onClose
}: {
  images: string[];
  index: number;
  open: boolean;
  lang: Lang;
  alt: string;
  onIndex(index: number): void;
  onClose(): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (images.length > 1 && event.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length);
      if (images.length > 1 && event.key === 'ArrowRight') onIndex((index + 1) % images.length);
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [open, images.length, index, onClose, onIndex]);

  useEffect(() => setZoomed(false), [index, open]);
  if (!open || !images[index]) return null;

  const move = (delta: number) => onIndex((index + delta + images.length) % images.length);
  return (
    <div className="lightbox is-open" role="dialog" aria-modal="true" aria-label={t('p.photos', lang)} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button ref={closeRef} className="lightbox__close" type="button" aria-label={t('p.close', lang)} onClick={onClose}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      {images.length > 1 ? <>
        <button className="lightbox__nav lightbox__nav--prev" type="button" aria-label={t('p.prev', lang)} onClick={() => move(-1)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg></button>
        <button className="lightbox__nav lightbox__nav--next" type="button" aria-label={t('p.next', lang)} onClick={() => move(1)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg></button>
      </> : null}
      <div className="lightbox__stage" onClick={() => setZoomed((value) => !value)}>
        <img className={zoomed ? 'is-zoomed' : ''} src={images[index]} alt={alt} />
      </div>
      {images.length > 1 ? <span className="lightbox__counter">{index + 1} / {images.length}</span> : null}
    </div>
  );
}
