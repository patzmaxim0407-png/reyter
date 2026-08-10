'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adoptOrLock, unlockScroll } from '@/lib/scroll-lock';
import { canGoBack } from '@/lib/nav-depth';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export default function ProductModal({
  children,
  lang
}: {
  children: React.ReactNode;
  lang: Lang;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const unlockedRef = useRef(false);
  const [open, setOpen] = useState(true);

  const finishClose = useCallback(() => {
    /* Знімаємо блокування ДО переходу: інакше сторінка встигне
       перемалюватись, поки body ще зафіксований, і каталог
       опиниться на початку. */
    unlockedRef.current = true;
    unlockScroll();

    /* Прийшли з каталогу — вертаємось у нього разом із позицією
       прокрутки, яку памʼятає браузер. Прийшли за прямим
       посиланням — вести «назад» нікуди, відкриваємо головну. */
    if (canGoBack()) router.back();
    else router.replace(lang === 'en' ? '/en' : '/', { scroll: false });
  }, [lang, router]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setOpen(false);
    timerRef.current = setTimeout(finishClose, 240);
  }, [finishClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    adoptOrLock();
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
      if (!unlockedRef.current) unlockScroll();
      if (timerRef.current) clearTimeout(timerRef.current);
      previous?.focus({ preventScroll: true });
    };
  }, [close]);

  /* ---------- Стягування панелі донизу (телефон) ----------
     Картка на вузькому екрані — це «шторка», і закривати її
     зручніше жестом, а не прицілюванням у хрестик. Тягнемо
     завжди з ручки; з вмісту — лише коли він догорнутий угору,
     інакше жест забирав би в покупця звичайну прокрутку. */

  useEffect(() => {
    const panel = panelRef.current;
    // прокручується саме .pmodal__scroll — його малює вміст картки
    const scroll = panel?.querySelector<HTMLElement>('.pmodal__scroll') ?? null;
    const handle = panel?.querySelector<HTMLElement>('.pmodal__handle');
    const backdrop = backdropRef.current;
    if (!panel || !scroll) return;

    let startY = 0;
    let shift = 0;
    let dragging = false;
    let fromHandle = false;

    const isSheet = () => window.matchMedia('(max-width: 820px)').matches;

    const onStart = (event: TouchEvent) => {
      if (!isSheet() || event.touches.length !== 1) return;
      fromHandle = event.currentTarget === handle;
      if (!fromHandle && scroll.scrollTop > 0) return;
      startY = event.touches[0].clientY;
      shift = 0;
      dragging = true;
      panel.style.transition = 'none';
    };

    const onMove = (event: TouchEvent) => {
      if (!dragging) return;
      const dy = event.touches[0].clientY - startY;

      if (dy <= 0) {
        shift = 0;
        panel.style.transform = '';
        if (!fromHandle) {
          // рух угору — віддаємо жест прокрутці вмісту
          dragging = false;
          panel.style.transition = '';
        }
        return;
      }

      if (event.cancelable) event.preventDefault();
      shift = dy;
      panel.style.transform = 'translateY(' + dy + 'px)';
      if (backdrop) backdrop.style.opacity = String(Math.max(0.15, 1 - dy / 450));
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      panel.style.transform = '';
      if (backdrop) backdrop.style.opacity = '';
      if (shift > 110) close();
      shift = 0;
    };

    const targets = [handle, scroll].filter(Boolean) as HTMLElement[];
    for (const target of targets) {
      target.addEventListener('touchstart', onStart, { passive: true });
      target.addEventListener('touchmove', onMove, { passive: false });
      target.addEventListener('touchend', onEnd);
      target.addEventListener('touchcancel', onEnd);
    }
    return () => {
      for (const target of targets) {
        target.removeEventListener('touchstart', onStart);
        target.removeEventListener('touchmove', onMove);
        target.removeEventListener('touchend', onEnd);
        target.removeEventListener('touchcancel', onEnd);
      }
    };
  }, [close]);

  return (
    <div className={'pmodal' + (open ? ' is-open' : '')} role="dialog" aria-modal="true" aria-labelledby="pmName">
      <button ref={backdropRef} className="pmodal__backdrop" type="button" aria-label={t('p.close', lang)} onClick={close} />
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
