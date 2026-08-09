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
  /* Для комплекту — обраний розмір кожного складника:
     [{ id, size }]. У звичайного товару лишається null. */
  let selectedParts = null;

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
    el.colorsBlock = document.getElementById('pmColorsBlock');
    el.colors = document.getElementById('pmColors');
    el.sizesBlock = document.getElementById('pmSizesBlock');
    el.sizesTitle = document.getElementById('pmSizesTitle');
    el.sizes = document.getElementById('pmSizes');
    el.sizeLink = document.getElementById('pmSizeLink');
    el.sizeChart = document.getElementById('pmSizeChart');
    el.eta = document.getElementById('pmEta');
    el.etaText = document.getElementById('pmEtaText');
    el.etaForm = document.getElementById('pmEtaForm');
    el.etaEmail = document.getElementById('pmEtaEmail');
    el.etaDone = document.getElementById('pmEtaDone');
    el.addCart = document.getElementById('pmAddCart');
    el.addCartLabel = document.getElementById('pmAddCartLabel');
    el.ctaPrice = document.getElementById('pmCtaPrice');
    el.inCart = document.getElementById('pmInCart');
    el.qtyValue = document.getElementById('pmQtyValue');
    el.goCart = document.getElementById('pmGoCart');
    el.desc = document.getElementById('pmDesc');
    el.extras = document.getElementById('pmExtras');
    el.scroll = document.getElementById('pmScroll');
    el.handle = document.getElementById('pmHandle');
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
      return;
    }

    /* Для комплекту наявність визначає найдефіцитніший складник
       саме в обраних розмірах — загальні цифри тут ні про що */
    if (selectedParts) {
      const left = selectedParts.reduce((min, x) => {
        const part = R.getProduct(x.id);
        if (!part || x.size == null) return min;
        return Math.min(min, R.stockQty(part, R.isSized(part) ? x.size : null));
      }, Infinity);
      setStatus(left <= R.LOW_STOCK_AT ? 'low' : 'ok',
        R.t(left <= R.LOW_STOCK_AT ? 'p.lowStock' : 'p.inStock'));
      return;
    }

    if (selectedSize && currentAv.low.includes(selectedSize)) {
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

  /* group — у комплекті кожен складник має власну групу радіо,
     інакше вибір розміру для майки скидав би вибір для бріфів */
  function sizePillHTML(size, opts) {
    const group = opts.group || 'pm-size';
    const label = opts.label || size;
    const id = group + '-' + String(size || 'one').toLowerCase().replace(/[^a-zа-яіїє0-9]/gi, '');
    return (
      '<span class="size-pill' + (opts.low ? ' size-pill--low' : '') +
        (opts.disabled ? ' size-pill--out' : '') + '" data-size="' + R.esc(size) + '">' +
        '<input type="radio" name="' + group + '" value="' + R.esc(size) + '" id="' + id + '"' +
        (opts.disabled ? ' disabled' : '') + (opts.checked ? ' checked' : '') + '>' +
        '<label for="' + id + '">' + R.esc(label) + '</label>' +
      '</span>'
    );
  }

  /* Розмірна сітка комплекту: по рядку на кожен складник.
     Комплект не має «свого» розміру — верх і низ у людей різні,
     тож покупець складає його сам. */
  function renderSetSizes() {
    const parts = R.setParts(current);
    selectedParts = [];

    el.sizesTitle.textContent = R.t('p.setSizes');
    el.sizeLink.hidden = false;
    el.sizesBlock.hidden = false;
    toggleSizeChart(false);

    el.sizes.innerHTML =
      '<p class="setsizes__note">' + R.t('p.setNote') + '</p>' +
      parts.map((part, n) => {
        const av = R.availability(part);
        const group = 'pm-part-' + n;
        let chosen = null;

        /* Складник без розмірної сітки (свічка, аромат) усе одно
           має бути «обраним», інакше комплект не покласти в кошик.
           Значення пілюлі й записаний розмір мусять збігатися —
           з них будується ключ позиції. */
        const one = part.volume || '';

        const pills = R.isSized(part)
          ? R.config.allSizes.map((size) => {
              const has = av.sizes.includes(size);
              const checked = has && !chosen;
              if (checked) chosen = size;
              return sizePillHTML(size, {
                group: group,
                disabled: !has,
                checked: checked,
                low: has && av.low.includes(size)
              });
            }).join('')
          : sizePillHTML(one, {
              group: group,
              label: part.volume || R.t('p.onePiece'),
              checked: !av.soldOut,
              disabled: av.soldOut
            });

        if (!R.isSized(part)) chosen = av.soldOut ? null : one;
        selectedParts.push({ id: part.id, size: chosen });

        return (
          '<div class="setpart' + (av.soldOut ? ' is-out' : '') + '" data-part="' + R.esc(part.id) + '">' +
            '<div class="setpart__head">' +
              '<img src="' + R.esc((part.images || [])[0] || '') + '" alt="" loading="lazy"' +
                ' onerror="this.style.visibility=\'hidden\'">' +
              '<span>' +
                '<b>' + R.esc(R.tf(part, 'name')) + '</b>' +
                '<em>' + (av.soldOut ? R.t('p.soldOut') : R.esc(part.id)) + '</em>' +
              '</span>' +
            '</div>' +
            '<div class="sizes">' + pills + '</div>' +
          '</div>'
        );
      }).join('');
  }

  function renderSizes() {
    const p = current;
    const av = currentAv;
    selectedSize = null;
    selectedParts = null;

    if (R.isSet(p) && R.setParts(p).length) {
      renderSetSizes();
      return;
    }

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

  /* ---------- «Очікується ~дата» + «Повідомити, коли зʼявиться» ----------
     Дати очікуваних приходів адмінка публікує в restock_eta —
     без кількостей, лише «коли». Підписка кладе email у
     stock_alerts; лист піде, щойно адмін оприбуткує прихід. */

  const etaCache = {};
  let etaFor = null; // розмір, для якого показано блок (null = весь товар)

  function fetchEta(pid) {
    if (etaCache[pid] !== undefined) return Promise.resolve(etaCache[pid]);
    if (!R.fb || !R.fb.enabled) return Promise.resolve(null);
    return R.fb.db.collection('restock_eta').doc(pid).get()
      .then((snap) => {
        etaCache[pid] = snap.exists ? snap.data() : null;
        return etaCache[pid];
      })
      .catch(() => null);
  }

  function etaDateText(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(R.lang && R.lang() === 'en' ? 'en-GB' : 'uk-UA',
      { day: 'numeric', month: 'long' });
  }

  /* Показ блоку для конкретного розміру або товару загалом */
  let etaProduct = null;   // для якого товару показано блок (складник комплекту)

  function showEta(size, product) {
    if (!el.eta) return;
    etaFor = size || null;
    etaProduct = product || current;
    const soldAll = currentAv.soldOut;

    fetchEta(etaProduct.id).then((eta) => {
      if (!current) return;
      const iso = eta
        ? (size ? (eta.sizes || {})[size] || eta.any : eta.any)
        : '';

      let text;
      if (iso) {
        text = size
          ? R.t('eta.expectedSize').replace('{size}', size).replace('{date}', etaDateText(iso))
          : R.t('eta.expected').replace('{date}', etaDateText(iso));
      } else {
        text = size ? R.t('eta.noDate') : R.t('eta.noDateAll');
      }

      // У комплекті одразу кажемо, якого саме складника чекати
      el.etaText.textContent = (etaProduct !== current ? R.tf(etaProduct, 'name') + ': ' : '') + text;
      el.etaDone.hidden = true;
      el.etaForm.hidden = false;
      el.etaEmail.value = (R.fb && R.fb.user && R.fb.user.email) || el.etaEmail.value || '';
      el.eta.hidden = false;
    });

    // без бази показуємо блок лише коли є що сказати
    if (!R.fb || !R.fb.enabled) el.eta.hidden = !soldAll;
  }

  function hideEta() {
    if (!el.eta) return;
    el.eta.hidden = true;
    etaFor = null;
    etaProduct = null;
  }

  /* Після рендера розмірів: товар повністю проданий — блок
     одразу; інакше блок зʼявляється кліком по сірому розміру */
  function refreshEta() {
    hideEta();
    if (!R.fb || !R.fb.enabled) return;
    if (currentAv.soldOut) showEta(null);
  }

  async function submitEtaForm() {
    const email = el.etaEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      R.toast(R.t('eta.badEmail'));
      el.etaEmail.focus();
      return;
    }
    try {
      const target = etaProduct || current;
      await R.fb.db.collection('stock_alerts').add({
        productId: target.id,
        productName: R.tf(target, 'name'),
        size: etaFor || null,
        email: email,
        lang: R.lang ? R.lang() : 'uk',
        notified: false,
        created: new Date().toISOString()
      });
      el.etaForm.hidden = true;
      el.etaDone.textContent = R.t('eta.done').replace('{email}', email);
      el.etaDone.hidden = false;
    } catch (e) {
      R.toast(R.t('eta.fail'));
    }
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

  /* ---------- Кольори ----------
     До кольору може бути прив'язана картка того самого товару
     в цьому кольорі: клік по зразку відкриває саме її.
     Зразок без прив'язки — просто позначка наявного кольору. */

  function renderColors() {
    if (!el.colors) return;

    const colors = R.productColors(current);
    // самі кольори без прив'язок нічого не перемикають —
    // вони вже видно на фото, тож блок не показуємо
    const switchable = colors.filter((c) => c.id && R.getProduct(c.id));

    if (!colors.length || !switchable.length) {
      el.colorsBlock.hidden = true;
      el.colors.innerHTML = '';
      return;
    }

    /* Поточний товар теж має бути зразком, інакше повернутись
       до нього після переходу не вийде */
    const own = colors.find((c) => !c.id || c.id === current.id) || colors[0];

    const list = [{ hex: own.hex, id: current.id }].concat(
      switchable.filter((c) => c.id !== current.id)
    );

    /* Порядок зразків однаковий на всіх картках родини — як у
       каталозі. Інакше поточний колір щоразу стрибав на перше
       місце, і після перемикання зразки мінялись місцями. */
    const pos = (id) => R.products.findIndex((x) => x.id === id);
    list.sort((a, b) => pos(a.id) - pos(b.id));

    el.colorsBlock.hidden = false;
    el.colors.innerHTML = list.map((c) => {
      const target = c.id === current.id ? current : R.getProduct(c.id);
      const active = c.id === current.id;
      const av = target ? R.availability(target) : null;
      const name = target ? R.tf(target, 'name') : '';
      return (
        '<button type="button" class="swatch' + (active ? ' is-active' : '') +
          (av && av.soldOut ? ' is-sold' : '') + '" ' +
          'data-color-id="' + R.esc(c.id) + '" ' +
          'style="--swatch:' + R.esc(c.hex) + '" ' +
          'aria-current="' + active + '" ' +
          'title="' + R.esc(name + (active ? ' — ' + R.t('p.thisColor') : '')) + '" ' +
          'aria-label="' + R.esc(name) + '"></button>'
      );
    }).join('');
  }

  /* ---------- Кнопки ---------- */

  function refreshCta() {
    const soldOut = currentAv.soldOut;
    el.addCart.disabled = soldOut;
    el.addCart.classList.toggle('is-disabled', soldOut);
    el.addCart.classList.remove('is-added');
    clearTimeout(addedTimer);
    el.addCartLabel.textContent = soldOut ? R.t('p.soldOut') : R.t('p.addToCart');

    // Якщо товар уже в кошику — одразу показуємо лічильник
    showInCart(!soldOut && inCartQty() > 0);
  }

  /* Кількість саме цієї комбінації: для комплекту вона залежить
     від обраних розмірів складників, а не від одного розміру */
  function inCartQty() {
    return R.cart.qtyOf(current.id, selectedSize, selectedParts);
  }

  /* Перемикання «Додати в кошик» ⇄ лічильник кількості */
  function showInCart(on) {
    el.addCart.hidden = on;
    el.inCart.hidden = !on;
    if (on) el.qtyValue.textContent = inCartQty();
  }

  function changeQty(delta) {
    const now = inCartQty();
    const next = R.cart.setQtyOf(current.id, selectedSize, selectedParts, now + delta);
    if (next === 0) {
      showInCart(false);            // прибрали з кошика — знову «Додати»
      el.addCart.classList.remove('is-added');
      el.addCartLabel.textContent = R.t('p.addToCart');
    } else {
      el.qtyValue.textContent = next;
      el.qtyValue.classList.remove('bump');
      void el.qtyValue.offsetWidth;
      el.qtyValue.classList.add('bump');
    }
  }

  /* Кнопка коротко підтверджує, а тоді стає лічильником */
  let addedTimer = null;

  function confirmAdded() {
    clearTimeout(addedTimer);
    el.addCart.classList.add('is-added');
    el.addCartLabel.textContent = R.t('p.addedShort');

    addedTimer = setTimeout(() => {
      el.addCart.classList.remove('is-added');
      el.addCartLabel.textContent = R.t('p.addToCart');
      showInCart(true);
    }, 1100);
  }

  /* ---------- Відкриття / закриття ---------- */

  function openProduct(id) {
    const p = R.getProduct(id);
    if (!p || !el.modal) return;
    // Схований товар не відкриваємо навіть за прямим посиланням:
    // у каталозі його немає, і показувати його як звичайний
    // товар — вводити покупця в оману
    if (p.hidden) return;

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

    renderColors();
    renderSizes();
    refreshEta();
    renderDesc();
    renderExtras();
    refreshStatus();
    refreshCta();
    renderThumbs();
    setImage(0);

    R.overlay.open(el.modal, { focus: el.modal.querySelector('.pmodal__close') });
    requestAnimationFrame(() => { el.scroll.scrollTop = 0; });

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
    let fromHandle = false;

    const isSheet = () => window.matchMedia('(max-width: 820px)').matches;

    function onStart(e) {
      if (!isSheet() || e.touches.length !== 1) return;
      fromHandle = e.currentTarget === el.handle;
      // з «ручки» тягнемо завжди; з вмісту — лише коли догорнуто вгору
      if (!fromHandle && el.scroll.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      shift = 0;
      dragging = true;
      panel.style.transition = 'none';
    }

    function onMove(e) {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;

      if (dy <= 0) {
        shift = 0;
        panel.style.transform = '';
        if (!fromHandle) {          // віддаємо жест прокрутці вмісту
          dragging = false;
          panel.style.transition = '';
        }
        return;
      }

      if (e.cancelable) e.preventDefault();
      shift = dy;
      panel.style.transform = 'translateY(' + dy + 'px)';
      if (backdrop) backdrop.style.opacity = String(Math.max(0.15, 1 - dy / 450));
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      panel.style.transform = '';
      if (backdrop) backdrop.style.opacity = '';
      if (shift > 110) R.overlay.close(el.modal);
      shift = 0;
    }

    [el.handle, el.scroll].forEach((target) => {
      if (!target) return;
      target.addEventListener('touchstart', onStart, { passive: true });
      target.addEventListener('touchmove', onMove, { passive: false });
      target.addEventListener('touchend', onEnd);
      target.addEventListener('touchcancel', onEnd);
    });
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
        refreshCta();   // кількість рахується для кожного розміру окремо
        return;
      }
      // Складник комплекту: у кожного своя група радіо
      const m = /^pm-part-(\d+)$/.exec(e.target.name || '');
      if (m && selectedParts && selectedParts[Number(m[1])]) {
        selectedParts[Number(m[1])].size = e.target.value;
        refreshStatus();
        refreshCta();
      }
    });

    /* Перемикання кольору = перехід на картку того кольору */
    el.colors.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color-id]');
      if (!btn) return;
      const id = btn.dataset.colorId;
      if (!id || id === (current && current.id)) return;
      if (R.getProduct(id)) openProduct(id);
    });

    el.inCart.addEventListener('click', (e) => {
      if (e.target.closest('[data-pm-minus]')) changeQty(-1);
      else if (e.target.closest('[data-pm-plus]')) changeQty(1);
    });

    el.goCart.addEventListener('click', () => {
      R.overlay.close(el.modal);
      setTimeout(() => R.openCart(), 260);
    });

    el.sizeLink.addEventListener('click', () => toggleSizeChart());

    // Клік по недоступному розміру: не покупка, а «коли буде?»
    el.sizes.addEventListener('click', (e) => {
      const pill = e.target.closest('.size-pill--out');
      if (!pill) return;
      // У комплекті чекаємо не «комплект», а конкретний складник
      const row = e.target.closest('[data-part]');
      const part = row ? R.getProduct(row.dataset.part) : null;
      showEta(pill.dataset.size, part);
      el.eta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    el.etaForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitEtaForm();
    });

    // Фото заміру відкривається на весь екран
    el.sizeChart.addEventListener('click', (e) => {
      if (e.target.closest('[data-size-photo]')) {
        R.openLightbox(['../assets/images/size_2.webp'], 0, true);
      }
    });

    el.addCart.addEventListener('click', () => {
      if (!current || currentAv.soldOut) return;
      // Клік по зеленому «Додано» — це та сама покупка, а не ще одна.
      // CSS уже вимикає pointer-events, але клавіатура їх не питає.
      if (el.addCart.classList.contains('is-added')) return;
      const shake = () => {
        el.sizes.classList.remove('shake');
        void el.sizes.offsetWidth; // перезапуск анімації
        el.sizes.classList.add('shake');
      };

      if (selectedParts) {
        // Комплект збирається тільки повністю: не можна покласти
        // в кошик половину, а другу «дообрати потім»
        if (selectedParts.some((x) => x.size == null)) {
          R.toast(R.t('p.chooseSetSizes'));
          shake();
          return;
        }
      } else if (!current.volume && !selectedSize) {
        R.toast(R.t('p.chooseSize'));
        shake();
        return;
      }

      R.cart.add(current.id, selectedSize, selectedParts);
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
