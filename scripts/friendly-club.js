/* ============================================
   FRIENDLY CLUB — оверлей поверх банера
   Кнопка «Тут» відкриває опис клубу на всю
   площу фото; закривається хрестиком або Esc.
   ============================================ */
(function () {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    var wrap = document.getElementById('friendlyClub');
    if (!wrap) return;

    var openBtn = wrap.querySelector('.fc-btn');
    var overlay = wrap.querySelector('.fc-overlay');
    var closeBtn = wrap.querySelector('.fc-close');
    if (!openBtn || !overlay || !closeBtn) return;

    function isFullscreen() {
      return window.matchMedia('(max-width: 640px)').matches;
    }

    function open() {
      overlay.hidden = false;
      overlay.scrollTop = 0;
      if (isFullscreen()) {
        document.body.style.overflow = 'hidden';
      } else {
        // показуємо банер повністю, щоб текст не ховався під шапкою
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // подвійний rAF, щоб перехід спрацював після вставки в DOM
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          overlay.classList.add('fc-open');
        });
      });
    }

    function close() {
      overlay.classList.remove('fc-open');
      document.body.style.overflow = '';
      setTimeout(function () { overlay.hidden = true; }, 350);
    }

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) close();
    });
  }
})();
