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

    /* rootMargin знизу — щоб анімація стартувала ще до того, як
       блок доїде до екрана. Інакше при швидкому прокручуванні
       картки встигають показатись уже порожніми і «наздоганяють»
       себе на очах. threshold 0 з тієї ж причини: чекати, поки
       блок відкриється на 8%, — це ще майже пів екрана прокрутки. */
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0, rootMargin: '0px 0px 320px 0px' }
    );

    els.forEach((el) => {
      // Все, що вже у вʼюпорті (напр., при відкритті сторінки з якорем),
      // показуємо одразу — без очікування колбека обсервера
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 320 && rect.bottom > -320) {
        el.classList.add('is-visible');
      } else {
        observer.observe(el);
      }
    });
  }

  /* Перехід до категорії з чипа: цільова секція має бути вже
     видимою на момент прокрутки, інакше під час стрибка бачиш
     порожнє місце, яке проявляється лише коли ти вже там */
  R.revealNow = function (root) {
    (root || document).querySelectorAll('.reveal:not(.is-visible)')
      .forEach((el) => el.classList.add('is-visible'));
  };

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

  /* ---------- Стрічка кадрів Friendly Club ----------
     Горизонтальна прокрутка з крапками, стрілками і клавішами.
     Відео вантажиться лише коли доїжджає до екрана: файл важить
     кілька мегабайтів, і качати його всім підряд немає сенсу. */

  function initFclubStrip() {
    const strip = document.getElementById('fcStrip');
    if (!strip) return;

    const slides = Array.from(strip.children);
    const dotsBox = document.getElementById('fcDots');
    const navs = Array.from(document.querySelectorAll('[data-fc-nav]'));
    if (slides.length < 2) {
      if (dotsBox) dotsBox.hidden = true;
      return;
    }

    const PHOTO_MS = 5000;   // скільки тримаємо фотокадр
    const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const video = strip.querySelector('video[data-src]');

    let timer = null;
    let held = false;      // палець або курсор на банері
    let onScreen = true;   // банер у полі зору
    let videoOk = true;    // відео справді грає (не заборонено браузером)

    /* ---- крапки ---- */
    const dots = slides.map((_, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'fclub__dot' + (i ? '' : ' is-on');
      d.setAttribute('role', 'tab');
      d.setAttribute('aria-label', 'Кадр ' + (i + 1));
      d.addEventListener('click', () => goTo(i));
      dotsBox.appendChild(d);
      return d;
    });

    // Прокрутка циклічна, тож стрілки не вимикаються ніколи:
    // з останнього кадру «далі» веде на перший
    navs.forEach((b) => {
      b.hidden = false;
      b.addEventListener('click', () => goTo(current() + Number(b.dataset.fcNav)));
    });

    function current() {
      return Math.round(strip.scrollLeft / strip.clientWidth);
    }

    function goTo(i) {
      const n = (i % slides.length + slides.length) % slides.length;
      strip.scrollTo({ left: n * strip.clientWidth, behavior: 'smooth' });
    }

    function sync() {
      const n = current();
      dots.forEach((d, i) => {
        d.classList.toggle('is-on', i === n);
        d.setAttribute('aria-selected', i === n ? 'true' : 'false');
      });
    }

    /* ---- автоматична прокрутка ----
       Фото тримаємо 5 секунд, відео — рівно доти, доки не догралось
       (далі рушає слухач ended). Якщо браузер заборонив автогру —
       відео не має підвісити карусель, тож ставимо звичайний
       таймер і на нього. */

    function stopTimer() {
      clearTimeout(timer);
      timer = null;
    }

    function plan() {
      stopTimer();
      if (slow || held || !onScreen) return;

      const v = slides[current()].querySelector('video');

      if (v && videoOk && !v.ended) {
        // Далі рушає слухач ended. Довгий запобіжник — на випадок,
        // коли відео так і не догралось через повільну мережу:
        // банер не має застигнути на ньому назавжди
        timer = setTimeout(() => goTo(current() + 1), 20000);
        return;
      }

      // Кадр, що вже догрався (наприклад, поки курсор тримав паузу),
      // не тримаємо ще пʼять секунд
      timer = setTimeout(() => goTo(current() + 1), v && v.ended ? 700 : PHOTO_MS);
    }

    if (video) {
      video.addEventListener('ended', () => {
        if (!slow && !held && onScreen) goTo(current() + 1);
      });
      // Кожен показ — з початку: інакше кадр підхоплюється там,
      // де його зупинили, і банер виглядає зламаним
      video.addEventListener('play', () => { videoOk = true; plan(); });
    }

    /* ---- пауза, поки людина дивиться сама ---- */

    const hold = () => { held = true; stopTimer(); };
    const release = () => { held = false; plan(); };

    strip.addEventListener('pointerenter', hold);
    strip.addEventListener('pointerleave', release);
    strip.addEventListener('touchstart', hold, { passive: true });
    strip.addEventListener('touchend', release, { passive: true });
    strip.addEventListener('focusin', hold);
    strip.addEventListener('focusout', release);

    // Раз на кадр анімації: слухач скролу без throttle помітно
    // смикає банер на слабких машинах
    let ticking = false;
    let settle = null;
    strip.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => { ticking = false; sync(); });
      }
      // прокрутка вщухла — плануємо наступний кадр від нової позиції
      clearTimeout(settle);
      settle = setTimeout(plan, 160);
    }, { passive: true });

    strip.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current() + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current() - 1); }
    });

    // Банер поїхав із екрана — карусель і відео зупиняються:
    // крутити те, чого не видно, немає сенсу
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          onScreen = entry.isIntersecting;
          if (onScreen) plan();
          else stopTimer();
        });
      }, { threshold: 0 }).observe(strip);
    }

    sync();
    initFclubVideo(strip, {
      slow: slow,
      onBlocked: () => { videoOk = false; plan(); },
      onScreen: () => onScreen
    });
    plan();
  }

  /* Відео: джерело підставляємо за шириною екрана, вмикаємо, коли
     кадр видно, і зупиняємо, щойно він поїхав — фонове відео за
     межами екрана даремно гріє процесор */
  function initFclubVideo(strip, opts) {
    const video = strip.querySelector('video[data-src]');
    if (!video) return;

    const playBtn = strip.querySelector('[data-fc-play]');
    if (opts.slow && playBtn) playBtn.hidden = false;

    let loaded = false;
    function load() {
      if (loaded) return;
      loaded = true;
      const small = window.matchMedia('(max-width: 640px)').matches;
      video.src = (small && video.dataset.srcSm) || video.dataset.src;
    }

    /* Автогру блокують у режимі енергозбереження та за деяких
       налаштувань браузера. Тоді показуємо кнопку відтворення —
       мовчазний нерухомий постер виглядав би як поламане відео. */
    function start() {
      if (opts.slow) return;
      load();
      video.currentTime = 0;
      const p = video.play();
      if (p && p.catch) {
        p.then(() => { if (playBtn) playBtn.hidden = true; })
         .catch(() => {
           if (playBtn) playBtn.hidden = false;
           opts.onBlocked();
         });
      }
    }

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        load();
        video.play().then(() => { playBtn.hidden = true; }).catch(() => {});
      });
    }

    if (!('IntersectionObserver' in window)) { load(); return; }

    // root — сама стрічка: так ловимо саме горизонтальний виїзд
    // слайда, а не вертикальне положення банера на сторінці
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.intersectionRatio > 0.6) {
          if (opts.onScreen()) start();
        } else if (!video.paused) {
          video.pause();
        }
      });
    }, { root: strip, threshold: [0, 0.6] }).observe(video);

    // Банер поїхав із екрана по вертикалі — відео теж на паузу
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          if (!video.paused) video.pause();
        } else if (loaded && strip.scrollLeft > strip.clientWidth * 0.6) {
          start();
        }
      });
    }, { threshold: 0 }).observe(strip);
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
    initFclubStrip();
    initZoomables();
  };
})();
