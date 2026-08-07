/* ============================================================
   REYTER — cart.js
   Кошик: додавання товарів, кількість, підсумок, оформлення
   замовлення (Instagram Direct) та збереження в історію
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  const KEY_CART = 'reyter:cart';
  const KEY_ORDERS = 'reyter:orders';
  const KEY_PROFILE = 'reyter:profile';

  const CARRIERS = ['Нова Пошта', 'Укрпошта', 'Meest', 'Міжнародна доставка'];

  let mode = 'cart'; // cart | checkout | done
  let lastOrder = null;

  /* ---------- Сховище ---------- */

  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* приватний режим — ігноруємо */ }
  }

  const cart = {
    items() {
      // прибираємо позиції, яких більше немає в каталозі
      return read(KEY_CART, []).filter((i) => R.getProduct(i.id));
    },
    save(items) {
      write(KEY_CART, items);
      updateBadge();
    },
    add(id, size) {
      const items = cart.items();
      const found = items.find((i) => i.id === id && i.size === size);
      if (found) found.qty += 1;
      else items.push({ id: id, size: size || null, qty: 1 });
      cart.save(items);
    },
    setQty(idx, qty) {
      const items = cart.items();
      if (!items[idx]) return;
      items[idx].qty = Math.max(1, Math.min(99, qty));
      cart.save(items);
    },
    remove(idx) {
      const items = cart.items();
      items.splice(idx, 1);
      cart.save(items);
    },
    clear() {
      cart.save([]);
    },
    count() {
      return cart.items().reduce((s, i) => s + i.qty, 0);
    },
    subtotal() {
      return cart.items().reduce((s, i) => {
        const p = R.getProduct(i.id);
        return s + (p ? p.price * i.qty : 0);
      }, 0);
    }
  };

  R.cart = cart;

  R.getProfile = function () {
    return read(KEY_PROFILE, {});
  };

  R.saveProfile = function (profile) {
    write(KEY_PROFILE, profile);
  };

  R.getOrders = function () {
    return read(KEY_ORDERS, []);
  };

  R.saveOrders = function (orders) {
    write(KEY_ORDERS, orders);
  };

  /* ---------- Лічильник у шапці ---------- */

  function updateBadge() {
    const badge = document.getElementById('cartCount');
    if (!badge) return;
    const n = cart.count();
    badge.textContent = n;
    badge.hidden = n === 0;
  }

  /* ---------- Рендер панелі ---------- */

  function drawer() {
    return document.getElementById('cartDrawer');
  }

  function body() {
    return document.getElementById('cartBody');
  }

  function foot() {
    return document.getElementById('cartFoot');
  }

  function render() {
    if (mode === 'cart') renderCart();
    else if (mode === 'checkout') renderCheckout();
    else renderDone();
  }

  function renderCart() {
    const items = cart.items();

    if (!items.length) {
      body().innerHTML =
        '<div class="empty-state">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 13H7L6 8Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/></svg>' +
          '<strong>Кошик порожній</strong>' +
          'Оберіть щось із наших позицій — вони чекають 💙' +
        '</div>';
      foot().innerHTML =
        '<button class="btn btn--primary" data-close type="button">Перейти до позицій</button>';
      return;
    }

    body().innerHTML = items
      .map((item, idx) => {
        const p = R.getProduct(item.id);
        return (
          '<div class="cart-item" data-idx="' + idx + '">' +
            '<img class="cart-item__img" src="' + R.esc(p.images[0]) + '" alt="' + R.esc(p.name) + '">' +
            '<div>' +
              '<div class="cart-item__name">' + R.esc(p.name) + '</div>' +
              '<div class="cart-item__meta">' +
                (item.size ? (p.volume ? 'Обʼєм: ' : 'Розмір: ') + R.esc(item.size) + ' · ' : '') +
                'Артикул: ' + R.esc(p.id) +
              '</div>' +
              '<div class="cart-item__price">' + R.fmt(p.price * item.qty) + ' грн</div>' +
            '</div>' +
            '<div class="cart-item__col">' +
              '<button class="cart-item__remove" data-remove aria-label="Видалити">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
              '</button>' +
              '<span class="qty">' +
                '<button data-minus aria-label="Менше">−</button>' +
                '<span>' + item.qty + '</span>' +
                '<button data-plus aria-label="Більше">+</button>' +
              '</span>' +
            '</div>' +
          '</div>'
        );
      })
      .join('');

    const total = cart.subtotal();
    const limit = R.config.freeDeliveryFrom;
    const left = Math.max(0, limit - total);
    const pct = Math.min(100, Math.round((total / limit) * 100));

    foot().innerHTML =
      '<div class="free-ship">' +
        (left > 0
          ? 'До <strong>безкоштовної доставки</strong> білизни по Україні ще ' + R.fmt(left) + ' грн'
          : '<strong>🎉 Безкоштовна доставка</strong> білизни по Україні (при оплаті 100%)') +
        '<div class="free-ship__bar"><div class="free-ship__fill' + (left === 0 ? ' is-done' : '') + '" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="cart-total"><span>Разом</span><span class="cart-total__sum">' + R.fmt(total) + ' грн</span></div>' +
      '<button class="btn btn--primary" data-checkout type="button">Оформити замовлення</button>';
  }

  /* ---------- Оформлення ---------- */

  function fieldHTML(id, label, value, attrs) {
    return (
      '<div class="field">' +
        '<label for="' + id + '">' + label + '</label>' +
        '<input id="' + id + '" value="' + R.esc(value || '') + '" ' + (attrs || '') + '>' +
      '</div>'
    );
  }

  function renderCheckout() {
    const items = cart.items();
    const profile = R.getProfile();
    const total = cart.subtotal();

    const summary = items
      .map((i) => {
        const p = R.getProduct(i.id);
        return '<div><span>' + R.esc(p.name) + (i.size ? ' (' + R.esc(i.size) + ')' : '') + ' × ' + i.qty +
               '</span><span>' + R.fmt(p.price * i.qty) + ' грн</span></div>';
      })
      .join('');

    body().innerHTML =
      '<button class="checkout-back" data-back type="button">← Назад до кошика</button>' +
      '<div class="checkout-summary">' + summary +
        '<div class="sum"><span>Разом</span><span>' + R.fmt(total) + ' грн</span></div>' +
      '</div>' +
      '<form class="form-grid" id="checkoutForm" novalidate>' +
        fieldHTML('coName', 'Імʼя та прізвище *', profile.name, 'autocomplete="name" required') +
        fieldHTML('coPhone', 'Телефон *', profile.phone, 'type="tel" autocomplete="tel" placeholder="+380..." required') +
        '<div class="form-row">' +
          '<div class="field">' +
            '<label for="coCarrier">Доставка</label>' +
            '<select id="coCarrier">' +
              CARRIERS.map((c) =>
                '<option' + (profile.carrier === c ? ' selected' : '') + '>' + c + '</option>'
              ).join('') +
            '</select>' +
          '</div>' +
          fieldHTML('coCity', 'Місто', profile.city, 'autocomplete="address-level2"') +
        '</div>' +
        fieldHTML('coBranch', 'Відділення / адреса', profile.branch, '') +
        '<div class="field">' +
          '<label for="coComment">Коментар</label>' +
          '<textarea id="coComment" placeholder="Побажання до замовлення (необовʼязково)"></textarea>' +
        '</div>' +
      '</form>';

    foot().innerHTML =
      '<button class="btn btn--primary" data-submit type="button">' +
        '<i class="fab fa-instagram" aria-hidden="true"></i> Сформувати замовлення' +
      '</button>' +
      '<p class="pinfo__order-note" style="text-align:center;margin-top:.55rem">Замовлення надсилається нам в Instagram Direct</p>';
  }

  function buildMessage(order) {
    const lines = [];
    lines.push('🛍 Замовлення №' + order.num + ' — reyter.men');
    lines.push('');
    order.items.forEach((i, n) => {
      lines.push(n + 1 + '. ' + i.name + ' (' + i.id + ')');
      lines.push('   ' + (i.size ? (i.volume ? 'обʼєм ' : 'розмір ') + i.size + ' · ' : '') + i.qty + ' шт · ' + R.fmt(i.price * i.qty) + ' грн');
    });
    lines.push('');
    lines.push('Разом: ' + R.fmt(order.total) + ' грн');
    lines.push('');
    lines.push('👤 ' + order.customer.name);
    lines.push('📞 ' + order.customer.phone);
    const delivery = [order.customer.carrier, order.customer.city, order.customer.branch]
      .filter(Boolean).join(', ');
    if (delivery) lines.push('🚚 ' + delivery);
    if (order.customer.comment) lines.push('💬 ' + order.customer.comment);
    return lines.join('\n');
  }

  function submitOrder() {
    const name = document.getElementById('coName');
    const phone = document.getElementById('coPhone');

    const nameOk = !!name.value.trim();
    const phoneOk = /^[+\d][\d\s()-]{8,}$/.test(phone.value.trim());
    name.classList.toggle('is-invalid', !nameOk);
    phone.classList.toggle('is-invalid', !phoneOk);

    if (!nameOk || !phoneOk) {
      R.toast('Заповніть імʼя та телефон');
      return;
    }

    const customer = {
      name: name.value.trim(),
      phone: phone.value.trim(),
      carrier: document.getElementById('coCarrier').value,
      city: document.getElementById('coCity').value.trim(),
      branch: document.getElementById('coBranch').value.trim(),
      comment: document.getElementById('coComment').value.trim()
    };

    // Профіль запамʼятовуємо для наступних замовлень
    R.saveProfile({
      name: customer.name,
      phone: customer.phone,
      carrier: customer.carrier,
      city: customer.city,
      branch: customer.branch
    });

    const now = new Date();
    const num =
      'R-' +
      String(now.getFullYear()).slice(2) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      '-' +
      String(Math.floor(100 + Math.random() * 900));

    const order = {
      num: num,
      date: now.toISOString(),
      items: cart.items().map((i) => {
        const p = R.getProduct(i.id);
        return {
          id: p.id,
          name: p.name,
          size: i.size,
          qty: i.qty,
          price: p.price,
          volume: !!p.volume
        };
      }),
      total: cart.subtotal(),
      customer: customer
    };

    order.message = buildMessage(order);

    const orders = R.getOrders();
    orders.unshift(order);
    R.saveOrders(orders.slice(0, 50));

    lastOrder = order;
    cart.clear();
    mode = 'done';
    render();
  }

  function renderDone() {
    const order = lastOrder;
    if (!order) {
      mode = 'cart';
      render();
      return;
    }

    body().innerHTML =
      '<div class="order-done">' +
        '<div class="order-done__icon">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 12.5 5 5 10-11"/></svg>' +
        '</div>' +
        '<h4>Замовлення №' + order.num + ' сформовано!</h4>' +
        '<p>Залишився один крок: надішліть його нам в Instagram Direct — текст уже скопійовано, просто вставте його в повідомлення.</p>' +
        '<div class="order-msg">' + R.esc(order.message) + '</div>' +
        '<a class="btn btn--primary" href="' + R.esc(R.config.orderUrl) + '" target="_blank" rel="noopener">' +
          '<i class="fab fa-instagram" aria-hidden="true"></i> Відкрити Instagram</a>' +
        '<button class="btn btn--ghost" data-copy type="button">Скопіювати ще раз</button>' +
      '</div>';

    foot().innerHTML = '';
    R.copyText(order.message, true);
  }

  /* ---------- Копіювання в буфер ---------- */

  R.copyText = function (text, silent) {
    function done() {
      if (!silent) R.toast('Скопійовано ✓', 'success');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else {
      fallback();
    }
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ігноруємо */ }
      ta.remove();
    }
  };

  /* ---------- Відкриття панелі ---------- */

  function openCart() {
    mode = 'cart';
    render();
    R.overlay.open(drawer(), { focus: drawer().querySelector('.drawer__close') });
  }

  R.openCart = openCart;

  /* ---------- Ініціалізація ---------- */

  function init() {
    updateBadge();

    const btn = document.getElementById('cartBtn');
    if (btn) btn.addEventListener('click', openCart);

    const d = drawer();
    if (!d) return;

    d.addEventListener('click', (e) => {
      const item = e.target.closest('.cart-item');

      if (e.target.closest('[data-remove]') && item) {
        cart.remove(Number(item.dataset.idx));
        render();
      } else if (e.target.closest('[data-plus]') && item) {
        const idx = Number(item.dataset.idx);
        cart.setQty(idx, cart.items()[idx].qty + 1);
        render();
      } else if (e.target.closest('[data-minus]') && item) {
        const idx = Number(item.dataset.idx);
        cart.setQty(idx, cart.items()[idx].qty - 1);
        render();
      } else if (e.target.closest('[data-checkout]')) {
        mode = 'checkout';
        render();
      } else if (e.target.closest('[data-back]')) {
        mode = 'cart';
        render();
      } else if (e.target.closest('[data-submit]')) {
        submitOrder();
      } else if (e.target.closest('[data-copy]') && lastOrder) {
        R.copyText(lastOrder.message);
      }
    });
  }

  R.initCart = init;
})();
