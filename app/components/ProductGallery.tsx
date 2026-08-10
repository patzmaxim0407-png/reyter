'use client';

import { useCallback, useState } from 'react';
import Lightbox from './Lightbox';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export default function ProductGallery({ images, alt, lang }: { images: string[]; alt: string; lang: Lang }) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const choose = useCallback((next: number) => setIndex(next), []);
  const move = (delta: number) => setIndex((value) => (value + delta + images.length) % images.length);

  if (!images.length) return null;
  return (
    <div className="pmodal__gallery">
      <div className="gal__main">
        <button className="gal__image-button" type="button" aria-label={t('p.photos', lang)} onClick={() => setLightbox(true)}>
          <img src={images[index]} alt={alt} />
        </button>
        {images.length > 1 ? <>
          <button className="gal__nav gal__nav--prev" type="button" aria-label={t('p.prev', lang)} onClick={() => move(-1)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg></button>
          <button className="gal__nav gal__nav--next" type="button" aria-label={t('p.next', lang)} onClick={() => move(1)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg></button>
          <span className="gal__counter">{index + 1} / {images.length}</span>
        </> : null}
      </div>
      {images.length > 1 ? <div className="gal__thumbs" role="tablist" aria-label={t('p.photos', lang)}>
        {images.map((src, i) => <button type="button" role="tab" aria-selected={i === index} className={'gthumb' + (i === index ? ' is-active' : '')} key={`${src}-${i}`} onClick={() => setIndex(i)}><img src={src} alt="" loading="lazy" /></button>)}
      </div> : null}
      <Lightbox images={images} index={index} open={lightbox} lang={lang} alt={alt} onIndex={choose} onClose={() => setLightbox(false)} />
    </div>
  );
}
