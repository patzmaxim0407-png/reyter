'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Lightbox from './Lightbox';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';
import { lockScroll, unlockScroll } from '@/lib/scroll-lock';

export function ReadMore({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="hero__more" type="button" aria-expanded={open} aria-controls="aboutFull" onClick={() => setOpen((value) => !value)}>{t(open ? 'hero.less' : 'hero.more', lang)}</button>
    <div className="hero__full" id="aboutFull" hidden={!open}>
      {['hero.p1', 'hero.p2', 'hero.p3'].map((key) => <p key={key} dangerouslySetInnerHTML={{ __html: t(key, lang) }} />)}
    </div>
  </>;
}

export function FriendlyClub({ lang }: { lang: Lang }) {
  const strip = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [slide, setSlide] = useState(0);
  const [dialog, setDialog] = useState(false);
  const [playVisible, setPlayVisible] = useState(false);

  const go = useCallback((next: number) => {
    const normalized = ((next % 2) + 2) % 2;
    strip.current?.scrollTo({ left: normalized * strip.current.clientWidth, behavior: 'smooth' });
  }, []);

  const playVideo = useCallback(() => {
    const node = video.current;
    if (!node) return;
    if (!node.src) {
      node.src = window.matchMedia('(max-width: 640px)').matches
        ? node.dataset.srcSm ?? ''
        : node.dataset.src ?? '';
    }
    node.play().then(() => setPlayVisible(false)).catch(() => {});
  }, []);

  useEffect(() => {
    const root = strip.current;
    const node = video.current;
    if (!root || !node) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;
    let held = false;
    let onScreen = true;
    let videoOk = true;
    let loaded = false;

    if (reduced) setPlayVisible(true);

    const current = () => Math.round(root.scrollLeft / Math.max(1, root.clientWidth));
    const stopTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const load = () => {
      if (loaded) return;
      loaded = true;
      node.src = window.matchMedia('(max-width: 640px)').matches
        ? node.dataset.srcSm ?? ''
        : node.dataset.src ?? '';
    };
    const goTo = (next: number) => {
      const normalized = ((next % 2) + 2) % 2;
      root.scrollTo({ left: normalized * root.clientWidth, behavior: 'smooth' });
    };
    const plan = () => {
      stopTimer();
      if (reduced || held || !onScreen) return;
      if (current() === 1 && videoOk && !node.ended) {
        timer = setTimeout(() => goTo(current() + 1), 20_000);
      } else {
        timer = setTimeout(() => goTo(current() + 1), current() === 1 && node.ended ? 700 : 5_000);
      }
    };
    const start = () => {
      if (reduced) return;
      load();
      node.currentTime = 0;
      node.play()
        .then(() => setPlayVisible(false))
        .catch(() => {
          setPlayVisible(true);
          videoOk = false;
          plan();
        });
    };
    const onEnded = () => {
      if (!reduced && !held && onScreen) goTo(current() + 1);
    };
    const onPlay = () => {
      videoOk = true;
      plan();
    };
    const hold = () => {
      held = true;
      stopTimer();
    };
    const release = () => {
      held = false;
      plan();
    };
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setSlide(current());
        });
      }
      if (settle) clearTimeout(settle);
      settle = setTimeout(plan, 160);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goTo(current() + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goTo(current() - 1);
      }
    };

    node.addEventListener('ended', onEnded);
    node.addEventListener('play', onPlay);
    root.addEventListener('pointerenter', hold);
    root.addEventListener('pointerleave', release);
    root.addEventListener('touchstart', hold, { passive: true });
    root.addEventListener('touchend', release, { passive: true });
    root.addEventListener('focusin', hold);
    root.addEventListener('focusout', release);
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('keydown', onKey);

    let horizontal: IntersectionObserver | null = null;
    let vertical: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      horizontal = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.intersectionRatio > 0.6) {
            if (onScreen) start();
          } else if (!node.paused) {
            node.pause();
          }
        });
      }, { root, threshold: [0, 0.6] });
      horizontal.observe(node);

      vertical = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          onScreen = entry.isIntersecting;
          if (!onScreen) {
            stopTimer();
            if (!node.paused) node.pause();
          } else {
            plan();
            if (loaded && root.scrollLeft > root.clientWidth * 0.6) start();
          }
        });
      }, { threshold: 0 });
      vertical.observe(root);
    } else {
      load();
    }

    setSlide(current());
    plan();
    return () => {
      stopTimer();
      if (settle) clearTimeout(settle);
      if (frame) cancelAnimationFrame(frame);
      horizontal?.disconnect();
      vertical?.disconnect();
      node.pause();
      node.removeEventListener('ended', onEnded);
      node.removeEventListener('play', onPlay);
      root.removeEventListener('pointerenter', hold);
      root.removeEventListener('pointerleave', release);
      root.removeEventListener('touchstart', hold);
      root.removeEventListener('touchend', release);
      root.removeEventListener('focusin', hold);
      root.removeEventListener('focusout', release);
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    lockScroll();
    close.current?.focus();
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setDialog(false);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); unlockScroll(); previous?.focus({ preventScroll: true }); };
  }, [dialog]);

  return <>
    <section className="fclub-section">
      <div className="container"><article className="fclub reveal">
        <div ref={strip} className="fclub__strip" tabIndex={0} role="group" aria-roledescription="carousel" aria-label="Friendly Club">
          <div className="fclub__slide">
            <img className="fclub__media" src="/new/assets/images/Serpen2026/IMG_2325.webp" alt="Friendly Club — Reyter" loading="lazy" />
            <div className="fclub__overlay"><h2 className="fclub__title">{t('fclub.title', lang)}</h2><p className="fclub__lead">{t('fclub.lead', lang)}</p><button className="btn btn--light" type="button" aria-haspopup="dialog" onClick={() => setDialog(true)}>{t('fclub.btn', lang)}</button></div>
          </div>
          <div className="fclub__slide">
            <video
              ref={video}
              className="fclub__media"
              muted
              playsInline
              preload="none"
              poster="/new/assets/images/fclub-poster.webp"
              data-src="/new/assets/videos/fclub-desktop.mp4"
              data-src-sm="/new/assets/videos/fclub-mobile.mp4"
              aria-label="REYTER Summer"
            />
            <button className="fclub__play" type="button" aria-label={t('fclub.play', lang)} hidden={!playVisible} onClick={playVideo} />
          </div>
        </div>
        <button className="fclub__nav fclub__nav--prev" type="button" aria-label={t('p.prev', lang)} onClick={() => go(slide - 1)} />
        <button className="fclub__nav fclub__nav--next" type="button" aria-label={t('p.next', lang)} onClick={() => go(slide + 1)} />
        <div className="fclub__dots" role="tablist" aria-label="Slides">{[0, 1].map((i) => <button key={i} type="button" role="tab" aria-selected={slide === i} aria-label={`${i + 1} / 2`} className={'fclub__dot' + (slide === i ? ' is-on' : '')} onClick={() => go(i)} />)}</div>
      </article></div>
    </section>
    {dialog ? <div className="fc-dialog is-open" role="dialog" aria-modal="true" aria-labelledby="fcTitle">
      <div className="fc-dialog__backdrop" onClick={() => setDialog(false)} />
      <div className="fc-dialog__panel">
        <button ref={close} className="fc-dialog__close" type="button" aria-label={t('p.close', lang)} onClick={() => setDialog(false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        <h3 className="fc-dialog__title" id="fcTitle">{t('fclub.title', lang)}</h3>
        {['fclub.p1', 'fclub.p2', 'fclub.p3'].map((key) => <p key={key} dangerouslySetInnerHTML={{ __html: t(key, lang) }} />)}
        <h4>{t('fclub.h2', lang)}</h4><p>{t('fclub.p4', lang)}</p>
        <ul>{['fclub.li1', 'fclub.li2', 'fclub.li3', 'fclub.li4'].map((key) => <li key={key}>{t(key, lang)}</li>)}</ul>
        <p className="fc-dialog__note">{t('fclub.note', lang)}</p>
      </div>
    </div> : null}
  </>;
}

export function SizeGuideImage({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const src = '/new/assets/images/size_2.webp';
  return <><figure className="size-guide__visual"><button className="zoomable-button" type="button" onClick={() => setOpen(true)}><img src={src} alt={t('size.alt', lang)} className="zoomable" loading="lazy" /></button><figcaption>{t('size.caption', lang)}</figcaption></figure><Lightbox images={[src]} index={0} open={open} lang={lang} alt={t('size.alt', lang)} onIndex={() => {}} onClose={() => setOpen(false)} /></>;
}

export function HomeEffects({ categoryIds }: { categoryIds: string[] }) {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    if (reduced || !('IntersectionObserver' in window)) nodes.forEach((node) => node.classList.add('is-visible'));
    const reveal = reduced ? null : new IntersectionObserver((entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('is-visible')), { rootMargin: '0px 0px -8% 0px' });
    nodes.forEach((node) => reveal?.observe(node));
    const sections = categoryIds.map((id) => document.getElementById(`cat-${id}`)).filter(Boolean) as HTMLElement[];
    const chips = Array.from(document.querySelectorAll<HTMLAnchorElement>('.cat-chips .chip'));
    const active = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) chips.forEach((chip) => chip.classList.toggle('is-active', chip.hash === `#${entry.target.id}`)); }), { rootMargin: '-30% 0px -60% 0px' });
    sections.forEach((section) => active.observe(section));
    return () => { reveal?.disconnect(); active.disconnect(); };
  }, [categoryIds]);
  return null;
}

export function ToTop({ lang }: { lang: Lang }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const scroll = () => setVisible(window.scrollY > 600); scroll(); window.addEventListener('scroll', scroll, { passive: true }); return () => window.removeEventListener('scroll', scroll); }, []);
  return <button className={'to-top' + (visible ? ' is-visible' : '')} type="button" aria-label={t('nav.scrollTop', lang)} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg></button>;
}
