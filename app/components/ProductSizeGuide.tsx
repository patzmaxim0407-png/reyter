'use client';

import { useState } from 'react';
import Lightbox from './Lightbox';
import { SITE_CONFIG } from '@/lib/site-config';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export default function ProductSizeGuide({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const image = '/assets/images/size_2.webp';
  return <>
    <button type="button" className={open ? 'is-open' : ''} aria-expanded={open} aria-controls="product-size-chart" onClick={() => setOpen((value) => !value)}>{t('p.sizeHelp', lang)}</button>
    {open ? <div className="pinfo__sizechart" id="product-size-chart">
      <table><thead><tr><th>{t('size.col1', lang)}</th><th>{t('size.col2', lang)}</th><th>{t('size.col3', lang)}</th></tr></thead>
        <tbody>{SITE_CONFIG.sizeChart.map((row) => <tr key={row.size}><td>{row.size}</td><td>{row.waist}</td><td>{row.hips}</td></tr>)}</tbody></table>
      <button className="pinfo__size-image" type="button" onClick={() => setLightbox(true)}><img src={image} alt={t('size.alt', lang)} loading="lazy" /></button>
    </div> : null}
    <Lightbox images={[image]} index={0} open={lightbox} lang={lang} alt={t('size.alt', lang)} onIndex={() => {}} onClose={() => setLightbox(false)} />
  </>;
}
