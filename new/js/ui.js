/* ============================================================
   REYTER — ui.js
   Спільні механізми: оверлеї (модалки/панелі), тости,
   шапка, бургер-меню, поява при прокручуванні, кнопка
   «догори», «читати більше», Friendly Club, зум зображень
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  /* ---------- Оверлеї (спільний стек) ---------- */

  const stack = [];

  /* ---------- Блокування прокрутки фону ----------
     На iOS одного overflow: hidden замало — сторінка все одно
     «протягується». Фіксуємо body і повертаємо позицію назад. */

  let savedScroll = 0;

  function lockScroll() {
    savedScroll = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = -savedScroll + 'px';
    document.body.classList.add('no-scroll');
  }

  function unlockScroll() {
    document.body.classList.remove('no-scroll');
    document.body.style.top = '';
    // миттєво, без плавної прокрутки — інакше сторінка «їде»
    const behavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, savedScroll);
    document.documentElement.style.scrollBehavior = behavior;
  }

  R.overlay = {
    open(el, opts) {
      if (!el || stack.some((s) => s.el === el)) return;
      opts = opts || {};

      const entry = { el: el, opts: opts, lastFocus: document.activeElement };
      if (!stack.length) lockScroll();
      stack.push(entry);

      el.hidden = false;
      // подвійний rAF — щоб CSS-перехід спрацював після вставки в DOM
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.classList.add('is-open'));
      });

      if (opts.focus && opts.focus.focus) {
        setTimeout(() => opts.focus.focus(), 60);
      }
    },

    close(el) {
      const i = stack.findIndex((s) => s.el === el);
      if (i < 0) return;
      const entry = stack.splice(i, 1)[0];

      el.classList.remove('is-open');
      setTimeout(() => {
        el.hidden = true;
        el.dispatchEvent(new CustomEvent('overlay:closed'));
      }, 400);

      if (!stack.length) unlockScroll();
      if (entry.lastFocus && entry.lastFocus.focus) {
        entry.lastFocus.focus({ preventScroll: true });
      }
    },

    closeTop() {
      if (stack.length) R.overlay.close(stack[stack.length - 1].el);
    }
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') R.overlay.closeTop();
  });

  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (!closer) return;
    const root = closer.closest('.pmodal, .drawer, .fc-dialog, .lightbox');
    if (root) R.overlay.close(root);
  });

  /* ---------- Тости ---------- */

  R.toast = function (message, type) {
    const wrap = document.getElementById('toasts');
    if (!wrap) return;

    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'success' ? ' toast--success' : '');
    toast.textContent = message;
    wrap.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 320);
    }, 2400);
  };

  /* ---------- Шапка та навігація ---------- */

  function initHeader() {
    const header = document.getElementById('siteHeader');
    const burger = document.getElementById('burgerBtn');
    const nav = document.getElementById('siteNav');

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        header.classList.toggle('is-scrolled', window.scrollY > 8);

        const toTop = document.getElementById('toTopBtn');
        if (toTop) toTop.classList.toggle('is-visible', window.scrollY > 400);

        ticking = false;
      });
    }, { passive: true });

    if (!burger || !nav) return;

    function closeNav() {
      nav.classList.remove('is-open');
      burger.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
    }

    burger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = nav.classList.toggle('is-open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) closeNav();
    });

    document.addEventListener('click', (e) => {
      if (nav.classList.contains('is-open') && !nav.contains(e.target) && e.target !== burger) {
        closeNav();
      }
    });
  }

  /* ---------- Поява при прокручуванні ---------- */

  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 }
    );

    els.forEach((el) => {
      // Все, що вже у вʼюпорті (напр., при відкритті сторінки з якорем),
      // показуємо одразу — без очікування колбека обсервера
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add('is-visible');
      } else {
        observer.observe(el);
      }
    });
  }

  /* ---------- Кнопка «догори» ---------- */

  function initToTop() {
    const btn = document.getElementById('toTopBtn');
    if (btn) {
      btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
  }

  /* ---------- «Читати більше» про бренд ---------- */

  function initReadMore() {
    const btn = document.getElementById('readMoreBtn');
    const text = document.getElementById('aboutFull');
    if (!btn || !text) return;

    btn.addEventListener('click', () => {
      const isHidden = text.hidden;
      text.hidden = !isHidden;
      btn.textContent = isHidden ? 'Приховати' : 'Читати більше про бренд';
      btn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });
  }

  /* ---------- Friendly Club ---------- */

  function initFriendlyClub() {
    const btn = document.getElementById('fcOpenBtn');
    const dialog = document.getElementById('fcDialog');
    if (!btn || !dialog) return;

    btn.addEventListener('click', () => {
      R.overlay.open(dialog, { focus: dialog.querySelector('.fc-dialog__close') });
    });
  }

  /* ---------- Зум зображень (розмірна сітка тощо) ---------- */

  function initZoomables() {
    document.querySelectorAll('.zoomable').forEach((img) => {
      img.addEventListener('click', () => {
        if (R.openLightbox) R.openLightbox([img.src], 0, true);
      });
    });
  }

  R.initUI = function () {
    initHeader();
    initReveal();
    initToTop();
    initReadMore();
    initFriendlyClub();
    initZoomables();
  };
})();
