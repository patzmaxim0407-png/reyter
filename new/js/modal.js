/* ============================================================
   REYTER — modal.js
   Модальне вікно товару: галерея з мініатюрами, розміри,
   статуси наявності, лайтбокс на весь екран
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  let current = null;      // поточний товар
  let currentAv = null;    // його доступність (живі залишки або статичні поля)
  let images = [];
  let index = 0;
  let selectedSize = null;

  const el = {};

  function cache() {
    el.modal = document.getElementById('productModal');
    el.image = document.getElementById('galImage');
    el.counter = document.getElementById('galCounter');
    el.thumbs = document.getElementById('galThumbs');
    el.prev = document.getElementById('galPrev');
    el.next = document.getElementById('galNext');
    el.category = document.getElementById('pmCategory');
    el.name = document.getElementById('pmName');
    el.status = document.getElementById('pmStatus');
    el.article = document.getElementById('pmArticle');
    el.price = document.getElementById('pmPrice');
    el.saleNote = document.getElementById('pmSaleNote');
    el.sizesBlock = document.getElementById('pmSizesBlock');
    el.sizesTitle = document.getElementById('pmSizesTitle');
    el.sizes = document.getElementById('pmSizes');
    el.sizeLink = document.getElementById('pmSizeLink');
    el.sizeChart = document.getElementById('pmSizeChart');
    el.addCart = document.getElementById('pmAddCart');
    el.addCartLabel = document.getElementById('pmAddCartLabel');
    el.ctaPrice = document.getElementById('pmCtaPrice');
    el.desc = document.getElementById('pmDesc');
    el.extras = document.getElementById('pmExtras');
    el.lightbox = document.getElementById('lightbox');
    el.lbImage = document.getElementById('lbImage');
    el.lbCounter = document.getElementById('lbCounter');
  }

  /* ---------- Статус наявності ---------- */

  function setStatus(type, text) {
    el.status.className = 'status-chip status-chip--' + type;
    el.status.textContent = text;
  }

  function refreshStatus() {
    if (currentAv.soldOut) {
      setStatus('no', R.t('p.soldOut'));
    } else if (selectedSize && currentAv.low.includes(selectedSize)) {
      setStatus('low', R.t('p.lowStock'));
    } else {
      setStatus('ok', R.t('p.inStock'));
    }
  }

  /* ---------- Галерея ---------- */

  function setImage(i) {
    if (!images.length) return;
    index = (i + images.length) % images.length;
    el.image.src = images[index];
    el.image.alt = current ? R.tf(current, 'name') : '';
    el.counter.textContent = index + 1 + ' / ' + images.length;
    el.counter.hidden = images.length < 2;
    el.prev.hidden = el.next.hidden = images.length < 2;

    Array.prototype.forEach.call(el.thumbs.children, (t, ti) => {
      t.classList.toggle('is-active', ti === index);
    });

    if (!el.lightbox.hidden) syncLightbox();
  }

  function renderThumbs() {
    el.thumbs.innerHTML = images
      .map(
        (src, i) =>
          '<button type="button" class="gthumb' + (i === 0 ? ' is-active' : '') + '" data-i="' + i + '" role="tab" aria-label="' + (i + 1) + '">' +
            '<img src="' + R.esc(src) + '" alt="" loading="lazy">' +
          '</button>'
      )
      .join('');
    el.thumbs.hidden = images.length < 2;
  }

  /* ---------- Розміри ---------- */

  function sizePillHTML(size, opts) {
    const id = 'size-' + String(size).toLowerCase().replace(/[^a-zа-яіїє0-9]/gi, '');
    return (
      '<span class="size-pill' + (opts.low ? ' size-pill--low' : '') + '">' +
        '<input type="radio" name="pm-size" value="' + R.esc(size) + '" id="' + id + '"' +
        (opts.disabled ? ' disabled' : '') + (opts.checked ? ' checked' : '') + '>' +
        '<label for="' + id + '">' + R.esc(size) + '</label>' +
      '</span>'
    );
  }

  function renderSizes() {
    const p = current;
    const av = currentAv;
    selectedSize = null;

    if (p.volume) {
      el.sizesTitle.textContent = R.t('p.volume');
      el.sizes.innerHTML = sizePillHTML(p.volume, {
        checked: !av.soldOut,
        disabled: av.soldOut
      });
      selectedSize = !av.soldOut ? p.volume : null;
      el.sizesBlock.hidden = false;
      el.sizeLink.hidden = true;
      toggleSizeChart(false);
      return;
    }

    if (!p.sizes && !av.sizes.length) {
      el.sizesBlock.hidden = true;
      return;
    }

    el.sizesTitle.textContent = R.t('p.size');
    el.sizeLink.hidden = false;
    el.sizesBlock.hidden = false;
    toggleSizeChart(false); // при відкритті іншого товару підказка згорнута

    let first = true;

    el.sizes.innerHTML = R.config.allSizes
      .map((size) => {
        const has = !av.soldOut && av.sizes.includes(size);
        const checked = has && first;
        if (checked) {
          first = false;
          selectedSize = size;
        }
        return sizePillHTML(size, {
          disabled: !has,
          checked: checked,
          low: has && av.low.includes(size)
        });
      })
      .join('');
  }

  /* ---------- Розмірна сітка прямо в картці ----------
     Раніше посилання закривало товар і кидало користувача
     в іншу секцію — повернутися було нічим. */

  function renderSizeChart() {
    const rows = (R.config.sizeChart || [])
      .map((r) =>
        '<tr' + (r.size === selectedSize ? ' class="is-current"' : '') + '>' +
          '<td>' + R.esc(r.size) + '</td>' +
          '<td>' + R.esc(r.waist) + '</td>' +
          '<td>' + R.esc(r.hips) + '</td>' +
        '</tr>'
      ).join('');

    el.sizeChart.innerHTML =
      '<p class="pinfo__sizechart-hint">' + R.t('size.sub') + '</p>' +
      '<table>' +
        '<thead><tr>' +
          '<th>' + R.t('size.col1') + '</th>' +
          '<th>' + R.t('size.col2') + '</th>' +
          '<th>' + R.t('size.col3') + '</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '<button type="button" class="pinfo__sizechart-img" data-size-photo>' +
        '<img src="../assets/images/size_2.webp" alt="' + R.esc(R.t('size.alt')) + '" loading="lazy">' +
        '<span>' + R.t('size.caption') + '</span>' +
      '</button>';
  }

  function toggleSizeChart(force) {
    const open = force !== undefined ? force : el.sizeChart.hidden;
    if (open) renderSizeChart();
    el.sizeChart.hidden = !open;
    el.sizeLink.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.sizeLink.classList.toggle('is-open', open);
  }

  /* ---------- Опис і додаткові блоки ---------- */

  function renderDesc() {
    const p = current;
    const rows = [];
    if (p.fabric) rows.push('<div><b>' + R.t('p.fabric') + ':</b> ' + R.esc(R.tf(p, 'fabric')) + '</div>');
    if (p.material) rows.push('<div><b>' + R.t('p.material') + ':</b> ' + R.esc(R.tf(p, 'material')) + '</div>');
    if (p.aroma) rows.push('<div><b>' + R.t('p.aroma') + ':</b> ' + R.esc(R.tf(p, 'aroma')) + '</div>');
    if (p.volume) rows.push('<div><b>' + R.t('p.volume') + ':</b> ' + R.esc(R.tx(p.volume)) + '</div>');
    if (p.model) rows.push('<div><b>' + R.t('p.model') + ':</b> ' + R.esc(R.tx(p.model)) + '</div>');
    (p.notes || []).forEach((n) => rows.push('<div class="note">' + R.esc(R.tx(n)) + '</div>'));
    el.desc.innerHTML = rows.join('');
  }

  function accHTML(title, items, open) {
    return (
      '<details class="acc"' + (open ? ' open' : '') + '>' +
        '<summary>' + R.esc(title) + '</summary>' +
        '<ul>' + items.map((i) => '<li>' + R.esc(R.tx(i)) + '</li>').join('') + '</ul>' +
      '</details>'
    );
  }

  function renderExtras() {
    const p = current;
    let html = '';
    if (p.characteristics && p.characteristics.length) {
      html += accHTML(R.t('p.features'), p.characteristics, false);
    }
    if (!p.volume) {
      const care = p.care && p.care.length ? p.care : [R.t('p.careDefault')];
      html += accHTML(R.t('p.care'), care, false);
    }
    el.extras.innerHTML = html;
  }

  /* ---------- Кнопки ---------- */

  function refreshCta() {
    const soldOut = currentAv.soldOut;
    el.addCart.disabled = soldOut;
    el.addCart.classList.toggle('is-disabled', soldOut);
    el.addCart.classList.remove('is-added');
    clearTimeout(addedTimer);
    el.addCartLabel.textContent = soldOut ? R.t('p.soldOut') : R.t('p.addToCart');
  }

  /* Кнопка на дві секунди перетворюється на підтвердження */
  let addedTimer = null;

  function confirmAdded() {
    clearTimeout(addedTimer);
    el.addCart.classList.add('is-added');
    el.addCartLabel.textContent = R.t('p.addedShort');

    addedTimer = setTimeout(() => {
      el.addCart.classList.remove('is-added');
      el.addCartLabel.textContent = R.t('p.addToCart');
    }, 2000);
  }

  /* ---------- Відкриття / закриття ---------- */

  function openProduct(id) {
    const p = R.getProduct(id);
    if (!p || !el.modal) return;

    current = p;
    currentAv = R.availability(p);
    images = (p.images || []).slice();
    if (!images.length) images = ['../assets/images/logo_4.webp'];

    el.category.textContent = R.categoryTitle(p.category);
    el.name.textContent = R.tf(p, 'name');
    el.article.textContent = R.t('p.article') + ': ' + p.id;
    el.price.innerHTML = R.priceHTML(p, true);
    // дубль ціни в липкій панелі на телефоні
    el.ctaPrice.textContent = R.uah(p.price);
    el.saleNote.hidden = !p.saleNote;
    el.saleNote.textContent = p.saleNote ? R.tf(p, 'saleNote') : '';

    renderSizes();
    renderDesc();
    renderExtras();
    refreshStatus();
    refreshCta();
    renderThumbs();
    setImage(0);

    R.overlay.open(el.modal, { focus: el.modal.querySelector('.pmodal__close') });
    requestAnimationFrame(() => {
      el.modal.querySelector('.pmodal__panel').scrollTop = 0;
    });

    if (history.replaceState) {
      history.replaceState(null, '', '#p/' + encodeURIComponent(p.id));
    }
  }

  function onModalClosed() {
    if (history.replaceState && location.hash.indexOf('#p/') === 0) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  /* ---------- Лайтбокс ---------- */

  let lbImages = [];
  let lbIndex = 0;
  let lbStandalone = false; // відкритий не з модалки товару

  function syncLightbox() {
    el.lbImage.src = lbImages[lbIndex];
    el.lbCounter.textContent = lbIndex + 1 + ' / ' + lbImages.length;
    el.lbCounter.hidden = lbImages.length < 2;
    document.getElementById('lbPrev').hidden = lbImages.length < 2;
    document.getElementById('lbNext').hidden = lbImages.length < 2;
    el.lbImage.classList.remove('is-zoomed');
  }

  function openLightbox(imgs, i, standalone) {
    lbImages = imgs;
    lbIndex = i || 0;
    lbStandalone = !!standalone;
    syncLightbox();
    R.overlay.open(el.lightbox, { focus: document.getElementById('lbClose') });
  }

  function lbGo(delta) {
    lbIndex = (lbIndex + delta + lbImages.length) % lbImages.length;
    syncLightbox();
    // синхронізуємо галерею модалки
    if (!lbStandalone && current) setImage(lbIndex);
  }

  /* ---------- Свайп униз закриває картку (телефон) ----------
     Смужка-«ручка» вгорі — не просто прикраса: тягнеш униз,
     і панель закривається, як у нативних застосунках. */

  function initSheetDrag() {
    const panel = el.modal.querySelector('.pmodal__panel');
    const backdrop = el.modal.querySelector('.pmodal__backdrop');
    if (!panel) return;

    let startY = 0;
    let shift = 0;
    let dragging = false;

    const isSheet = () => window.matchMedia('(max-width: 820px)').matches;

    panel.addEventListener('touchstart', (e) => {
      // тягнемо лише коли вміст догорнуто до самого верху
      if (!isSheet() || e.touches.length !== 1 || panel.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      shift = 0;
      dragging = true;
      panel.style.transition = 'none';
    }, { passive: true });

    panel.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;

      if (dy <= 0) {           // потягнули вгору — віддаємо прокрутку вмісту
        shift = 0;
        panel.style.transform = '';
        dragging = false;
        panel.style.transition = '';
        return;
      }

      e.preventDefault();      // забираємо жест собі
      shift = dy;
      panel.style.transform = 'translateY(' + dy + 'px)';
      if (backdrop) backdrop.style.opacity = String(Math.max(0.15, 1 - dy / 450));
    }, { passive: false });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      panel.style.transform = '';
      if (backdrop) backdrop.style.opacity = '';
      if (shift > 110) R.overlay.close(el.modal);
      shift = 0;
    }

    panel.addEventListener('touchend', endDrag);
    panel.addEventListener('touchcancel', endDrag);
  }

  /* ---------- Ініціалізація ---------- */

  function init() {
    cache();
    if (!el.modal) return;

    el.prev.addEventListener('click', () => setImage(index - 1));
    el.next.addEventListener('click', () => setImage(index + 1));

    el.thumbs.addEventListener('click', (e) => {
      const t = e.target.closest('.gthumb');
      if (t) setImage(Number(t.dataset.i));
    });

    el.image.addEventListener('click', () => openLightbox(images, index, false));

    el.sizes.addEventListener('change', (e) => {
      if (e.target.name === 'pm-size') {
        selectedSize = e.target.value;
        refreshStatus();
      }
    });

    el.sizeLink.addEventListener('click', () => toggleSizeChart());

    // Фото заміру відкривається на весь екран
    el.sizeChart.addEventListener('click', (e) => {
      if (e.target.closest('[data-size-photo]')) {
        R.openLightbox(['../assets/images/size_2.webp'], 0, true);
      }
    });

    el.addCart.addEventListener('click', () => {
      if (!current || currentAv.soldOut) return;
      if (!current.volume && !selectedSize) {
        R.toast(R.t('p.chooseSize'));
        el.sizes.classList.remove('shake');
        void el.sizes.offsetWidth; // перезапуск анімації
        el.sizes.classList.add('shake');
        return;
      }
      R.cart.add(current.id, selectedSize);
      confirmAdded();
    });

    initSheetDrag();

    // Свайпи по галереї
    let sx = null, sy = null;
    el.modal.querySelector('.pmodal__gallery').addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        sx = e.touches[0].screenX;
        sy = e.touches[0].screenY;
      }
    }, { passive: true });
    el.modal.querySelector('.pmodal__gallery').addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].screenX - sx;
      const dy = e.changedTouches[0].screenY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 60) setImage(index + (dx > 0 ? -1 : 1));
      sx = sy = null;
    }, { passive: true });

    // Лайтбокс
    document.getElementById('lbPrev').addEventListener('click', () => lbGo(-1));
    document.getElementById('lbNext').addEventListener('click', () => lbGo(1));
    document.getElementById('lbClose').addEventListener('click', () => R.overlay.close(el.lightbox));
    el.lightbox.addEventListener('click', (e) => {
      if (e.target === el.lightbox || e.target.id === 'lbStage') R.overlay.close(el.lightbox);
    });
    el.lbImage.addEventListener('click', () => el.lbImage.classList.toggle('is-zoomed'));

    // Стрілки клавіатури
    document.addEventListener('keydown', (e) => {
      if (!el.lightbox.hidden) {
        if (e.key === 'ArrowLeft') lbGo(-1);
        if (e.key === 'ArrowRight') lbGo(1);
      } else if (!el.modal.hidden) {
        if (e.key === 'ArrowLeft') setImage(index - 1);
        if (e.key === 'ArrowRight') setImage(index + 1);
      }
    });

    el.modal.addEventListener('overlay:closed', onModalClosed);

    // Глибоке посилання #p/АРТИКУЛ
    if (location.hash.indexOf('#p/') === 0) {
      const id = decodeURIComponent(location.hash.slice(3));
      if (R.getProduct(id)) setTimeout(() => openProduct(id), 150);
    }
  }

  R.openProduct = openProduct;
  R.openLightbox = openLightbox;
  R.initProductModal = init;
})();
