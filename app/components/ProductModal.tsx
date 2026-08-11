'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { adoptOrLock, unlockScroll } from '@/lib/scroll-lock';
import { canGoBack } from '@/lib/nav-depth';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

/* Скільки карток зараз живе в дереві. Зазвичай нуль або одна, але
   в мить зміни кольору — дві: React будує нову ще до того, як
   прибрати стару.

   Саме за цим і впізнаємо підміну. Памʼятати «коли зникла
   попередня» не годиться: та мить настає ПІСЛЯ появи нової.

   Модульна змінна, а не стан: вона має пережити розмонтування. */
let живих = 0;

/* ============================================================
   Хто вирішує, бути картці чи ні
   ------------------------------------------------------------
   Правило одне: чужа адреса — картки немає. Воно прибирає дві
   біди. Перша: при зміні кольору на сторінці, відкритій за прямим
   посиланням, поверх старої картки лягала нова від перехопленого
   маршруту. Друга: після закриття Next лишає в слоті останнє
   показане, бо на каталозі тому слотові нема з чим збігтися, —
   картка зникала з очей, але лишалась у розмітці.

   Рішення винесене в окремий компонент навмисно. Якби картка
   просто малювала порожнечу, вона лишалась би змонтованою — з
   памʼяттю «я вже закрита», з незнятими таймерами й лічильниками.
   Тоді при повторному відкритті того самого товару поверталася б
   та сама картка, яка вважає себе закритою: на екрані нічого, а
   натиснути вже нічого не можна.

   Тут же вона по-справжньому зникає й народжується заново — з
   чистим станом. Ключ по адресі: різні товари — різні картки.
   ============================================================ */

export default function ProductModal({
  children,
  lang,
  selfPath
}: {
  children: React.ReactNode;
  lang: Lang;
  /** Адреса, якій ця картка належить. */
  selfPath?: string;
}) {
  const pathname = usePathname();
  if (selfPath && pathname !== selfPath) return null;
  return (
    <ProductSheet key={selfPath ?? pathname} lang={lang}>
      {children}
    </ProductSheet>
  );
}

function ProductSheet({ children, lang }: { children: React.ReactNode; lang: Lang }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const unlockedRef = useRef(false);
  /* Починаємо закритою й відкриваємо наступним кадром — інакше
     вузол вставляється вже з класом is-open, переходити нема від
     чого, і картка не виїжджає, а зʼявляється ривком. Два кадри,
     а не один: перший лише вставляє розмітку, і браузер має
     встигнути порахувати початковий стан. */
  /* Зміна кольору міняє адресу, і Next будує картку наново. Але
     якщо попередня ще на екрані — це не нова картка, а та сама з
     іншим вмістом: зʼявляємось одразу, без появи. Інакше виглядало
     б, наче картка закрилась і відкрилась. */
  const [підміна] = useState(() => живих > 0);
  const [open, setOpen] = useState(підміна);

  /* Поки шторка їде вгору, вона натискань не приймає: інакше
     другий тап (а на телефоні їх роблять швидко) потрапляє вже не
     в картку каталогу, а в те, що під палець приїхало — у фото або
     навіть у «Додати в кошик». */
  const [ready, setReady] = useState(підміна);

  useEffect(() => {
    if (підміна) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setOpen(true));
    });
    const settle = setTimeout(() => setReady(true), 380);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      clearTimeout(settle);
    };
  }, [підміна]);

  useEffect(() => {
    живих += 1;
    return () => {
      живих -= 1;
    };
  }, []);

  const finishClose = useCallback(() => {
    /* Знімаємо блокування ДО переходу: інакше сторінка встигне
       перемалюватись, поки body ще зафіксований, і каталог
       опиниться на початку. */
    unlockedRef.current = true;
    unlockScroll();

    /* Прийшли з каталогу — вертаємось у нього разом із позицією
       прокрутки, яку памʼятає браузер. Прийшли за прямим
       посиланням — вести «назад» нікуди, показуємо каталог. Обидва
       шляхи без перезавантаження: сторінка вже тут, під карткою. */
    if (canGoBack()) router.back();
    else router.replace(lang === 'en' ? '/en' : '/', { scroll: false });
  }, [lang, router]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setOpen(false);
    timerRef.current = setTimeout(finishClose, 240);
  }, [finishClose]);

  /* Замок прокрутки й фокус — рівно один раз за життя картки.
     Раніше це лежало в одному ефекті з обробником клавіш, а той
     перезапускався на кожну зміну close(): картку встигало
     розблокувати й заблокувати знову, а сторінка при цьому
     сіпалась. */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    adoptOrLock();
    closeRef.current?.focus();
    return () => {
      if (!unlockedRef.current) unlockScroll();
      previous?.focus({ preventScroll: true });
    };
  }, []);

  /* Таймер закриття прибираємо ЛИШЕ коли картка справді зникає.
     Доти він недоторканний: якщо його скасувати між «згасанням» і
     переходом, картка лишається в розмітці — невидима, але на весь
     екран, і жоден клік більше нікуди не доходить. */
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
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
    return () => document.removeEventListener('keydown', onKey);
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

    /* Те саме мишею — але тільки за смужку. Картка стала шторкою й
       на компʼютері, смужка на ній видна, і тягнути її очікувано.
       З вмісту мишею не тягнемо: там прокрутка, і будь-який рух із
       затиснутою кнопкою означав би виділення тексту, а не жест. */
    const мишею = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      startY = event.clientY;
      shift = 0;
      dragging = true;
      fromHandle = true;
      panel.style.transition = 'none';

      const рух = (e: MouseEvent) => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        shift = Math.max(0, dy);
        panel.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
        if (backdrop) backdrop.style.opacity = String(Math.max(0.15, 1 - shift / 450));
      };
      const кінець = () => {
        document.removeEventListener('mousemove', рух);
        document.removeEventListener('mouseup', кінець);
        onEnd();
      };
      document.addEventListener('mousemove', рух);
      document.addEventListener('mouseup', кінець);
    };
    handle?.addEventListener('mousedown', мишею);

    return () => {
      for (const target of targets) {
        target.removeEventListener('touchstart', onStart);
        target.removeEventListener('touchmove', onMove);
        target.removeEventListener('touchend', onEnd);
        target.removeEventListener('touchcancel', onEnd);
      }
      handle?.removeEventListener('mousedown', мишею);
    };
  }, [close]);

  return (
    <div className={'pmodal' + (open ? ' is-open' : '') + (ready ? ' is-ready' : '')} role="dialog" aria-modal="true" aria-labelledby="pmName">
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
