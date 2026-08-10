'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export default function ProductModal({
  children,
  lang,
  navigation = 'back'
}: {
  children: React.ReactNode;
  lang: Lang;
  navigation?: 'back' | 'home';
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const [open, setOpen] = useState(true);

  const finishClose = useCallback(() => {
    if (navigation === 'back') router.back();
    else router.replace(lang === 'en' ? '/en' : '/');
  }, [lang, navigation, router]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setOpen(false);
    timerRef.current = setTimeout(finishClose, 240);
  }, [finishClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Лайтбокс фотографій лежить вище за картку й має
        // закриватися першим, не забираючи за собою всю модалку.
        if (document.querySelector('.lightbox.is-open')) return;
        return close();
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = oldOverflow;
      if (timerRef.current) clearTimeout(timerRef.current);
      previous?.focus();
    };
  }, [close]);

  return (
    <div className={'pmodal' + (open ? ' is-open' : '')} role="dialog" aria-modal="true" aria-labelledby="pmName">
      <button className="pmodal__backdrop" type="button" aria-label={t('p.close', lang)} onClick={close} />
      <div className="pmodal__panel" ref={panelRef}>
        <span className="pmodal__handle" aria-hidden="true" />
        <button ref={closeRef} className="pmodal__close" type="button" aria-label={t('p.close', lang)} onClick={close}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        {children}
      </div>
    </div>
  );
}
