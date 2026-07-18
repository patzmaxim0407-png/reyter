/* ============================================
   КАВУНОПАД — літній easter egg REYTER
   Дві іконки ховаються у випадкових місцях сайту.
   Клік по будь-якій — кавунопад і секретна пропозиція.
   ============================================ */
(function () {
  'use strict';

  var ICONS = [
    '/assets/images/Jule2026/kavun.webp',
    '/assets/images/Jule2026/kukurudza.webp'
  ];
  var HOST_SELECTORS = ['#about', '#products', '#size-guide', '#info', '#contacts', 'footer'];
  var INSTAGRAM_URL = 'https://www.instagram.com/reyter.ua/';
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var overlay = null;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    var hosts = HOST_SELECTORS
      .map(function (sel) { return document.querySelector(sel); })
      .filter(Boolean);
    if (!hosts.length) return;

    // тасуємо секції, щоб кожна іконка сховалась в іншому місці
    for (var i = hosts.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = hosts[i];
      hosts[i] = hosts[j];
      hosts[j] = tmp;
    }

    ICONS.forEach(function (src, idx) {
      hideIcon(src, hosts[idx % hosts.length]);
    });
  }

  function hideIcon(src, host) {
    if (window.getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }

    var mobile = window.innerWidth < 600;
    var size = mobile
      ? Math.round(64 + Math.random() * 28)   /* 64–92px */
      : Math.round(88 + Math.random() * 42);  /* 88–130px */

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kvp-icon';
    btn.setAttribute('aria-label', 'Секретна літня знахідка REYTER');
    btn.style.width = size + 'px';
    btn.style.height = size + 'px';
    btn.style.setProperty('--kvp-rot', (Math.random() * 44 - 22).toFixed(1) + 'deg');
    btn.style.top = (8 + Math.random() * 74).toFixed(1) + '%';
    btn.style[Math.random() < 0.5 ? 'left' : 'right'] = (1.5 + Math.random() * 7).toFixed(1) + '%';

    var img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.style.animationDelay = (-Math.random() * 7).toFixed(2) + 's';
    btn.appendChild(img);

    btn.addEventListener('click', onFound);
    host.appendChild(btn);
  }

  function onFound() {
    startRain();
    openModal();
  }

  /* --- Кавунопад --- */
  function startRain() {
    if (reducedMotion) return;

    var rain = document.createElement('div');
    rain.className = 'kvp-rain';

    var count = window.innerWidth < 600 ? 16 : 28;
    for (var i = 0; i < count; i++) {
      var drop = document.createElement('img');
      drop.className = 'kvp-drop';
      drop.src = ICONS[i % ICONS.length];
      drop.alt = '';
      drop.style.width = Math.round(36 + Math.random() * 58) + 'px';
      drop.style.left = (Math.random() * 100).toFixed(1) + '%';
      drop.style.animationDuration = (2.4 + Math.random() * 2.2).toFixed(2) + 's';
      drop.style.animationDelay = (Math.random() * 1.4).toFixed(2) + 's';
      drop.style.setProperty('--kvp-end-rot', Math.round(Math.random() * 720 - 360) + 'deg');
      rain.appendChild(drop);
    }

    document.body.appendChild(rain);
    setTimeout(function () {
      if (rain.parentNode) rain.parentNode.removeChild(rain);
    }, 6500);
  }

  /* --- Модальне вікно --- */
  function buildModal() {
    overlay = document.createElement('div');
    overlay.className = 'kvp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Кавунопад — секретна пропозиція');
    overlay.innerHTML =
      '<div class="kvp-card">' +
        '<button type="button" class="kvp-close" aria-label="Закрити">&times;</button>' +
        '<div class="kvp-hero">' +
          '<img class="kvp-hero-kavun" src="' + ICONS[0] + '" alt="Кавун">' +
          '<img class="kvp-hero-kukurudza" src="' + ICONS[1] + '" alt="Кукурудза">' +
        '</div>' +
        '<span class="kvp-badge">Літній секрет знайдено</span>' +
        '<h3 class="kvp-title">КАВУНОПАД</h3>' +
        '<p class="kvp-text">Опублікуй селфі в нашій білизні з написом <span class="kvp-accent">«кавунопад»</span> познач нас <a href="' + INSTAGRAM_URL + '" target="_blank" rel="noopener">@reyter.ua</a> та отримай <strong>знижку на товари</strong></p>' +
        '<a class="kvp-cta" href="' + INSTAGRAM_URL + '" target="_blank" rel="noopener"><i class="fab fa-instagram"></i>Позначити @reyter.ua</a>' +
      '</div>';

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector('.kvp-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('kvp-open')) closeModal();
    });

    document.body.appendChild(overlay);
  }

  function openModal() {
    if (!overlay) buildModal();
    document.body.style.overflow = 'hidden';
    // невелика затримка, щоб перехід спрацював після вставки в DOM
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add('kvp-open');
      });
    });
  }

  function closeModal() {
    overlay.classList.remove('kvp-open');
    document.body.style.overflow = '';
  }
})();
