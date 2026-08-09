/* ============================================================
   REYTER — cart.js
   Кошик: додавання товарів, кількість, підсумок, оформлення
   замовлення на сайті та збереження в історію
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  const KEY_CART = 'reyter:cart';
  const KEY_ORDERS = 'reyter:orders';
  const KEY_PROFILE = 'reyter:profile';

  let mode = 'cart'; // cart | checkout | done
  let lastOrder = null;
  let promo = null;      // свіжий документ промокоду з бази
  let promoMsg = null;   // { ok, text } — підказка під полем
  let promoInputValue = ''; // те, що покупець набрав, — не губимо при перемальовці

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
    /* Скільки саме цього товару в цьому розмірі вже в кошику */
    qtyOf(id, size) {
      const found = cart.items().find((i) => i.id === id && i.size === (size || null));
      return found ? found.qty : 0;
    },
    /* Встановити кількість; 0 — прибрати позицію з кошика */
    setQtyOf(id, size, qty) {
      const items = cart.items();
      const idx = items.findIndex((i) => i.id === id && i.size === (size || null));
      const next = Math.max(0, Math.min(99, qty));

      if (idx < 0) {
        if (next > 0) items.push({ id: id, size: size || null, qty: next });
      } else if (next === 0) {
        items.splice(idx, 1);
      } else {
        items[idx].qty = next;
      }
      cart.save(items);
      return next;
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
    },
    /* Позиції у вигляді, зрозумілому рушію промокодів */
    forPromo() {
      return cart.items().map((i) => {
        const p = R.getProduct(i.id);
        return {
          id: p.id,
          category: p.category,
          // товар може стояти в кількох категоріях — промокод
          // на будь-яку з них має спрацювати
          categories: R.productCats(p),
          price: p.price,
          qty: i.qty,
          sale: !!p.sale
        };
      });
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

  /* ---------- Промокод ---------- */

  /* Перерахунок при кожній зміні кошика: якщо умови перестали
     виконуватись (прибрали товар, впала сума) — знімаємо код */
  function revalidatePromo() {
    if (!promo) return;
    const res = R.promoCheck(promo, cart.forPromo());
    if (res.ok) {
      promo.discount = res.discount;
      promo.partial = res.partial;
    } else {
      promoMsg = { ok: false, text: R.promoMessage(res, promo) };
      promo = null;
      R.promoSaveCode('');
    }
  }

  /* Перечитує умови коду з бази — щоб вимкнений або змінений
     адміном промокод одразу переставав діяти */
  async function refreshPromoFromDb() {
    const code = R.promoSavedCode();
    if (!code) return;
    const fresh = await R.promoFetch(code);
    const res = R.promoCheck(fresh, cart.forPromo());
    if (res.ok) {
      promo = Object.assign({}, fresh, { discount: res.discount, partial: res.partial });
    } else {
      promo = null;
      R.promoSaveCode('');
      if (fresh) promoMsg = { ok: false, text: R.promoMessage(res, fresh) };
    }
    render();
  }

  function discount() {
    return promo ? Math.min(promo.discount || 0, cart.subtotal()) : 0;
  }

  function total() {
    return Math.max(0, cart.subtotal() - discount());
  }

  async function applyPromo(codeRaw) {
    const code = R.promoNormalize(codeRaw);
    if (!code) return;

    promoMsg = { ok: false, text: R.t('promo.checking'), pending: true };
    render();

    const found = await R.promoFetch(code);
    const res = R.promoCheck(found, cart.forPromo());

    if (res.ok) {
      promo = Object.assign({}, found, { discount: res.discount, partial: res.partial });
      R.promoSaveCode(code);
      promoInputValue = '';
      promoMsg = { ok: true, text: R.promoMessage(res, found) };
    } else {
      promo = null;
      R.promoSaveCode('');
      promoMsg = { ok: false, text: R.promoMessage(res, found), focus: true };
    }
    render();
  }

  function removePromo() {
    promo = null;
    promoMsg = null;
    promoInputValue = '';
    R.promoSaveCode('');
    render();
  }

  function promoHTML() {
    if (promo) {
      return (
        '<div class="promo promo--on">' +
          '<div class="promo__badge">' +
            '<b>' + R.esc(promo.code) + '</b>' +
            '<span>' + R.esc(R.t('promo.applied')) + '</span>' +
          '</div>' +
          '<span class="promo__sum">−' + R.uah(discount()) + '</span>' +
          '<button class="promo__remove" data-promo-remove type="button" aria-label="' + R.t('promo.remove') + '">✕</button>' +
        '</div>' +
        (promo.partial ? '<p class="promo__hint is-ok">' + R.t('promo.partial') + '</p>' : '')
      );
    }

    return (
      '<form class="promo" id="promoForm">' +
        '<input id="promoInput" value="' + R.esc(promoInputValue) + '" placeholder="' +
          R.t('promo.placeholder') + '" autocomplete="off" spellcheck="false">' +
        '<button class="btn btn--ghost btn--sm" type="submit">' + R.t('promo.apply') + '</button>' +
      '</form>' +
      (promoMsg
        ? '<p class="promo__hint' +
            (promoMsg.pending ? '' : (promoMsg.ok ? ' is-ok' : ' is-err')) + '">' +
            R.esc(promoMsg.text) + '</p>'
        : '')
    );
  }

  function renderCart() {
    const items = cart.items();

    if (!items.length) {
      body().innerHTML =
        '<div class="empty-state">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 13H7L6 8Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/></svg>' +
          '<strong>' + R.t('cart.empty') + '</strong>' +
          R.t('cart.emptyNote') +
        '</div>';
      foot().innerHTML =
        '<button class="btn btn--primary" data-close type="button">' + R.t('cart.goCatalog') + '</button>';
      return;
    }

    body().innerHTML = items
      .map((item, idx) => {
        const p = R.getProduct(item.id);
        return (
          '<div class="cart-item" data-idx="' + idx + '">' +
            '<img class="cart-item__img" src="' + R.esc(p.images[0]) + '" alt="' + R.esc(R.tf(p, 'name')) + '">' +
            '<div>' +
              '<div class="cart-item__name">' + R.esc(R.tf(p, 'name')) + '</div>' +
              '<div class="cart-item__meta">' +
                (item.size ? (p.volume ? R.t('p.volume') : R.t('p.size')) + ': ' + R.esc(R.tx(item.size)) + ' · ' : '') +
                R.t('p.article') + ': ' + R.esc(p.id) +
              '</div>' +
              '<div class="cart-item__price">' + R.uah(p.price * item.qty) + '</div>' +
            '</div>' +
            '<div class="cart-item__col">' +
              '<button class="cart-item__remove" data-remove aria-label="' + R.t('cart.remove') + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
              '</button>' +
              '<span class="qty">' +
                '<button data-minus aria-label="' + R.t('cart.less') + '">−</button>' +
                '<span>' + item.qty + '</span>' +
                '<button data-plus aria-label="' + R.t('cart.more') + '">+</button>' +
              '</span>' +
            '</div>' +
          '</div>'
        );
      })
      .join('');

    revalidatePromo();

    const sub = cart.subtotal();
    const off = discount();
    const sum = total();
    const limit = R.config.freeDeliveryFrom;
    const left = Math.max(0, limit - sum);
    const pct = Math.min(100, Math.round((sum / limit) * 100));

    foot().innerHTML =
      promoHTML() +
      '<div class="free-ship">' +
        (left > 0
          ? R.t('cart.freeLeft') + ' ' + R.uah(left)
          : R.t('cart.freeDone')) +
        '<div class="free-ship__bar"><div class="free-ship__fill' + (left === 0 ? ' is-done' : '') + '" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      (off
        ? '<div class="cart-line"><span>' + R.t('cart.subtotal') + '</span><span>' + R.uah(sub) + '</span></div>' +
          '<div class="cart-line is-off"><span>' + R.t('cart.discount') + ' · ' + R.esc(promo.code) + '</span>' +
            '<span>−' + R.uah(off) + '</span></div>'
        : '') +
      '<div class="cart-total"><span>' + R.t('cart.total') + '</span><span class="cart-total__sum">' + R.uah(sum) + '</span></div>' +
      '<button class="btn btn--primary" data-checkout type="button">' + R.t('cart.checkout') + '</button>';

    // фокус повертаємо лише одразу після невдалої спроби, а не на кожній перемальовці
    const input = document.getElementById('promoInput');
    if (input && promoMsg && promoMsg.focus) {
      promoMsg.focus = false;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
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

  /* ---------- Спосіб підтвердження ----------
     Менеджер має знати, куди писати чи дзвонити. За замовчуванням
     дзвінок на той самий номер — це найчастіший випадок, тож
     покупцю не треба нічого чіпати. */

  const MESSENGERS = [
    { id: 'telegram', title: 'Telegram', icon: 'fa-telegram' },
    { id: 'whatsapp', title: 'WhatsApp', icon: 'fa-whatsapp' },
    { id: 'viber',    title: 'Viber',    icon: 'fa-viber' }
  ];

  function radioChip(name, value, label, checked, extraClass) {
    return (
      '<label class="ochip' + (extraClass ? ' ' + extraClass : '') + '">' +
        '<input type="radio" name="' + name + '" value="' + value + '"' + (checked ? ' checked' : '') + '>' +
        '<span>' + label + '</span>' +
      '</label>'
    );
  }

  function confirmHTML(profile) {
    const c = profile.confirm || {};
    const method = c.method === 'messenger' ? 'messenger' : 'call';
    const messenger = MESSENGERS.some((m) => m.id === c.messenger) ? c.messenger : 'telegram';
    const phoneMode = c.phoneMode === 'other' ? 'other' : 'same';

    return (
      '<div class="field co-confirm" id="coConfirm">' +
        '<label>' + R.t('cart.confirmTitle') + '</label>' +
        '<div class="ochips">' +
          radioChip('co-method', 'call', R.t('cart.byCall'), method === 'call') +
          radioChip('co-method', 'messenger', R.t('cart.byMessenger'), method === 'messenger') +
        '</div>' +

        '<div class="co-confirm__part" id="coMsgrBox"' + (method === 'messenger' ? '' : ' hidden') + '>' +
          '<span class="co-confirm__label">' + R.t('cart.whichMessenger') + '</span>' +
          '<div class="ochips">' +
            MESSENGERS.map((m) => radioChip(
              'co-messenger', m.id,
              '<i class="fab ' + m.icon + '" aria-hidden="true"></i>' + m.title,
              messenger === m.id, 'ochip--' + m.id
            )).join('') +
          '</div>' +
        '</div>' +

        '<div class="co-confirm__part">' +
          '<span class="co-confirm__label">' + R.t('cart.contactPhone') + '</span>' +
          '<div class="ochips">' +
            radioChip('co-phone-mode', 'same', R.t('cart.samePhone'), phoneMode === 'same') +
            radioChip('co-phone-mode', 'other', R.t('cart.otherPhone'), phoneMode === 'other') +
          '</div>' +
          '<input id="coAltPhone" type="tel" inputmode="tel" placeholder="+380..." value="' +
            R.esc(c.altPhone || '') + '"' + (phoneMode === 'other' ? '' : ' hidden') + '>' +
        '</div>' +

        '<div class="co-confirm__part" id="coTgBox"' +
          (method === 'messenger' && messenger === 'telegram' ? '' : ' hidden') + '>' +
          '<span class="co-confirm__label">' + R.t('cart.tgLogin') + '</span>' +
          '<input id="coTgLogin" placeholder="@username" autocomplete="off" spellcheck="false" value="' +
            R.esc(c.telegram || '') + '">' +
          '<p class="co-confirm__hint">' + R.t('cart.tgHint') + '</p>' +
        '</div>' +
      '</div>'
    );
  }

  /* Показуємо тільки те, що доречно для обраного способу */
  function syncConfirm() {
    const box = document.getElementById('coConfirm');
    if (!box) return;

    const method = (box.querySelector('input[name="co-method"]:checked') || {}).value || 'call';
    const messenger = (box.querySelector('input[name="co-messenger"]:checked') || {}).value || '';
    const phoneMode = (box.querySelector('input[name="co-phone-mode"]:checked') || {}).value || 'same';

    document.getElementById('coMsgrBox').hidden = method !== 'messenger';
    document.getElementById('coTgBox').hidden = !(method === 'messenger' && messenger === 'telegram');
    document.getElementById('coAltPhone').hidden = phoneMode !== 'other';
  }

  function collectConfirm() {
    const box = document.getElementById('coConfirm');
    if (!box) return null;

    const val = (name) => (box.querySelector('input[name="' + name + '"]:checked') || {}).value || '';
    const method = val('co-method') || 'call';
    const phoneMode = val('co-phone-mode') || 'same';
    const alt = document.getElementById('coAltPhone').value.trim();
    const messenger = method === 'messenger' ? (val('co-messenger') || 'telegram') : '';
    const tg = document.getElementById('coTgLogin').value.trim();

    const out = {
      method: method,
      messenger: messenger,
      phoneMode: phoneMode,
      altPhone: phoneMode === 'other' ? alt : ''
    };
    if (messenger === 'telegram' && tg) out.telegram = tg.replace(/^@+/, '');
    return out;
  }

  /* Один рядок для листа, повідомлення в Telegram і адмінки */
  R.confirmLine = function (customer) {
    const c = (customer || {}).confirm;
    if (!c) return '';

    const name = { telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber' }[c.messenger] || '';
    const how = c.method === 'messenger'
      ? (name || R.t('cart.byMessenger'))
      : R.t('cart.byCall');

    const phone = c.phoneMode === 'other' && c.altPhone ? c.altPhone : (customer.phone || '');
    const parts = [how];
    if (phone) parts.push(phone);
    if (c.telegram) parts.push('@' + c.telegram);
    return parts.join(' · ');
  };

  /* ---------- Вибір адреси з профілю ----------
     Якщо збережених адрес немає — усе як було, звичайна форма.
     Якщо є — спершу список, і форма розкривається лише під
     «нову адресу»: обрати збережене має бути один клік. */

  let pickedAddr = null;   // id обраної адреси, '' — вводимо нову

  function addrPickHTML() {
    const list = R.addrBook ? R.addrBook.list() : [];
    if (!list.length) {
      pickedAddr = '';
      return R.addressField('co', R.getProfile());
    }

    if (pickedAddr === null) pickedAddr = R.addrBook.defaultId();
    const chosen = pickedAddr ? R.addrBook.get(pickedAddr) : null;

    const cards = list.map((a) =>
      '<button type="button" class="addrpick__item' + (a.id === pickedAddr ? ' is-on' : '') + '" ' +
        'data-pick-addr="' + R.esc(a.id) + '">' +
        '<b>' + R.esc(R.addrBook.title(a)) + '</b>' +
        '<span>' + R.esc(R.addressLine(a)) + '</span>' +
      '</button>'
    ).join('');

    /* Обрану адресу не дублюємо полями: вона вже написана на
       картці. Форма розкривається кнопкою — якщо треба виправити
       відділення саме для цього замовлення. */
    return (
      '<div class="field addrpick">' +
        '<span class="field__label">' + R.t('adr.where') + '</span>' +
        '<div class="addrpick__list">' +
          cards +
          '<button type="button" class="addrpick__item addrpick__item--new' +
            (pickedAddr ? '' : ' is-on') + '" data-pick-addr="">' +
            '<b>+ ' + R.t('adr.newHere') + '</b>' +
            '<span>' + R.t('adr.newHint') + '</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      (chosen
        ? '<button type="button" class="addrpick__edit" data-addr-toggle>' + R.t('adr.editHere') + '</button>'
        : '') +
      '<div id="coAddrForm"' + (chosen ? ' hidden' : '') + '>' +
        R.addressField('co', chosen || {}) +
      '</div>' +
      (chosen
        ? ''
        : '<label class="checkout-savepick">' +
            '<input type="checkbox" id="coSaveAddr" checked> ' + R.t('adr.saveToProfile') +
          '</label>')
    );
  }

  /* Помилку в захованій формі покупець не побачить — розкриваємо */
  function showAddrForm() {
    const box = document.getElementById('coAddrForm');
    const btn = document.querySelector('[data-addr-toggle]');
    if (box) box.hidden = false;
    if (btn) btn.hidden = true;
  }

  function pickAddr(id) {
    pickedAddr = id;
    const box = document.getElementById('coAddrBox');
    if (!box) return;
    box.innerHTML = addrPickHTML();
    R.initAddress('co');
  }

  function renderCheckout() {
    const items = cart.items();
    const profile = R.getProfile();
    revalidatePromo();
    const sub = cart.subtotal();
    const off = discount();
    const sum = total();

    const summary = items
      .map((i) => {
        const p = R.getProduct(i.id);
        return '<div><span>' + R.esc(R.tf(p, 'name')) + (i.size ? ' (' + R.esc(R.tx(i.size)) + ')' : '') + ' × ' + i.qty +
               '</span><span>' + R.uah(p.price * i.qty) + '</span></div>';
      })
      .join('');

    const defaultEmail = profile.email || (R.fb && R.fb.user && R.fb.user.email) || '';

    body().innerHTML =
      '<button class="checkout-back" data-back type="button">' + R.t('cart.back') + '</button>' +
      '<div class="checkout-summary">' + summary +
        (off
          ? '<div><span>' + R.t('cart.subtotal') + '</span><span>' + R.uah(sub) + '</span></div>' +
            '<div class="is-off"><span>' + R.t('cart.discount') + ' · ' + R.esc(promo.code) + '</span>' +
              '<span>−' + R.uah(off) + '</span></div>'
          : '') +
        '<div class="sum"><span>' + R.t('cart.total') + '</span><span>' + R.uah(sum) + '</span></div>' +
      '</div>' +
      '<form class="form-grid" id="checkoutForm" novalidate>' +
        fieldHTML('coName', R.t('cart.name'), profile.name,
          'autocomplete="name" required placeholder="' + R.esc(R.t('cart.namePh')) + '"') +
        fieldHTML('coPhone', R.t('cart.phone'), profile.phone, 'type="tel" autocomplete="tel" placeholder="+380..." required') +
        fieldHTML('coEmail', R.t('cart.email'), defaultEmail, 'type="email" autocomplete="email" placeholder="you@example.com"') +
        '<div id="coAddrBox">' + addrPickHTML() + '</div>' +
        confirmHTML(profile) +
        '<div class="field">' +
          '<label for="coComment">' + R.t('cart.comment') + '</label>' +
          '<textarea id="coComment" placeholder="' + R.t('cart.commentPh') + '"></textarea>' +
        '</div>' +
      '</form>';

    R.initAddress('co');

    foot().innerHTML =
      '<button class="btn btn--primary" data-submit type="button">' + R.t('cart.submit') + '</button>' +
      '<p class="pinfo__order-note" style="text-align:center;margin-top:.55rem">' + R.t('cart.submitNote') + '</p>';
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
    if (order.discount) {
      lines.push('Сума: ' + R.fmt(order.subtotal) + ' грн');
      lines.push('Промокод ' + order.promoCode + ': −' + R.fmt(order.discount) + ' грн');
    }
    lines.push('Разом: ' + R.fmt(order.total) + ' грн');
    lines.push('');
    lines.push('👤 ' + order.customer.name);
    lines.push('📞 ' + order.customer.phone);
    const delivery = R.addressLine(order.customer);
    if (delivery) lines.push('🚚 ' + delivery);
    const confirmLine = R.confirmLine(order.customer);
    if (confirmLine) lines.push('☎️ Підтвердження: ' + confirmLine);
    if (order.customer.comment) lines.push('💬 ' + order.customer.comment);
    return lines.join('\n');
  }

  async function submitOrder() {
    const name = document.getElementById('coName');
    const phone = document.getElementById('coPhone');
    const email = document.getElementById('coEmail');

    const nameOk = !!name.value.trim();
    const phoneOk = /^[+\d][\d\s()-]{8,}$/.test(phone.value.trim());
    const emailVal = email.value.trim();
    const emailOk = !emailVal || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal);
    name.classList.toggle('is-invalid', !nameOk);
    phone.classList.toggle('is-invalid', !phoneOk);
    email.classList.toggle('is-invalid', !emailOk);

    if (!nameOk || !phoneOk) {
      R.toast(R.t('cart.fillNamePhone'));
      return;
    }
    if (!emailOk) {
      R.toast(R.t('cart.checkEmail'));
      return;
    }

    /* Промокод перечитуємо з бази саме зараз: між застосуванням
       і натисканням «Підтвердити» його могли вимкнути, вичерпати
       або він міг протермінуватись. Інакше замовлення пішло б
       зі знижкою, яку база вже не визнає. */
    if (promo) {
      const fresh = await R.promoFetch(promo.code);
      const check = R.promoCheck(fresh, cart.forPromo());
      if (!check.ok) {
        promo = null;
        R.promoSaveCode('');
        promoMsg = { ok: false, text: R.promoMessage(check, fresh) };
        mode = 'cart';
        render();
        R.toast(R.t('promo.dropped'));
        return;
      }
      promo = Object.assign({}, fresh, { discount: check.discount, partial: check.partial });
    }

    const addr = R.addressCheck('co');
    if (!addr.ok) {
      showAddrForm();
      R.toast(addr.text);
      if (addr.focus) addr.focus.focus();
      return;
    }

    const customer = Object.assign({
      name: name.value.trim(),
      phone: phone.value.trim(),
      email: emailVal
    }, R.addressValue('co'), {
      comment: document.getElementById('coComment').value.trim(),
      confirm: collectConfirm()
    });

    /* Профіль запамʼятовуємо для наступних замовлень. Саме
       мерджем: у профілі лежить адресна книга, і перезапис
       обʼєктом покупця стер би її. */
    R.saveProfile(Object.assign({}, R.getProfile(), customer, { comment: '' }));

    // Нову адресу за бажанням кладемо в книгу
    const saveBox = document.getElementById('coSaveAddr');
    if (R.addrBook && saveBox && saveBox.checked) {
      R.addrBook.save(R.addressValue('co'), {
        makeDefault: !R.addrBook.list().length
      });
    }

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
      subtotal: cart.subtotal(),
      discount: discount(),
      promoCode: promo ? promo.code : '',
      total: total(),
      customer: customer
    };

    order.message = buildMessage(order);

    const orders = R.getOrders();
    orders.unshift(order);
    R.saveOrders(orders.slice(0, 50));

    // Замовлення йде в адмінку — і від гостя, і з акаунта
    if (R.fb && R.fb.enabled) {
      R.fb.saveCloudOrder(order);
    }
    if (R.fb && R.fb.enabled && R.fb.user) {
      R.fb.saveCloudProfile(Object.assign({}, customer, { comment: '' }));
    }

    // Промокод використано — лічильник +1, щоб ліміт справді діяв
    if (order.promoCode) R.promoConsume(order.promoCode);

    // Сповіщення: Telegram власнику + email-підтвердження покупцю
    if (R.notify) R.notify.orderPlaced(order);

    lastOrder = order;
    cart.clear();
    promo = null;
    promoMsg = null;
    promoInputValue = '';
    R.promoSaveCode('');
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
        '<h4>' + R.t('cart.order') + ' №' + order.num + ' ' + R.t('cart.doneTitle') + '</h4>' +
        '<p>' + R.t('cart.doneText') + '</p>' +
        (order.customer.email
          ? '<p>' + R.t('cart.doneMail') + ' <b>' + R.esc(order.customer.email) + '</b> 📩</p>'
          : '') +
        // Гість не має історії в кабінеті — підказуємо, як стежити
        (R.fb && R.fb.enabled && !R.fb.user
          ? '<p class="order-done__track">' + R.t('cart.trackNote') + '</p>'
          : '') +
        '<button class="btn btn--primary" data-myorders type="button">' + R.t('cart.myOrders') + '</button>' +
        '<button class="btn btn--ghost" data-close type="button">' + R.t('cart.keepShopping') + '</button>' +
      '</div>';

    foot().innerHTML = '';
  }

  /* ---------- Копіювання в буфер ---------- */

  R.copyText = function (text, silent) {
    function done() {
      if (!silent) R.toast(R.t('cart.copied'), 'success');
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
    refreshPromoFromDb();   // умови завжди свіжі з бази
    R.overlay.open(drawer(), { focus: drawer().querySelector('.drawer__close') });
  }

  R.openCart = openCart;

  /* Відкрити кошик і одразу застосувати код (з кабінету) */
  R.openCartWithPromo = function (code) {
    mode = 'cart';
    render();
    R.overlay.open(drawer(), { focus: drawer().querySelector('.drawer__close') });
    setTimeout(() => applyPromo(code), 120);
  };

  /* ---------- Ініціалізація ---------- */

  function init() {
    updateBadge();

    const btn = document.getElementById('cartBtn');
    if (btn) btn.addEventListener('click', openCart);

    const d = drawer();
    if (!d) return;

    /* Персональний промокод діє лише в акаунті, для якого його
       видано. Вхід або вихід змінює цю умову — перевіряємо код
       заново, інакше в кошику лишалася б чужа знижка. */
    document.addEventListener('auth:changed', () => {
      if (!promo && !R.promoSavedCode()) return;
      refreshPromoFromDb();
    });

    d.addEventListener('input', (e) => {
      if (e.target.id === 'promoInput') promoInputValue = e.target.value;
    });

    // Перемикачі способу підтвердження ховають/показують поля
    // без перемальовки форми — інакше введене загубиться
    d.addEventListener('change', (e) => {
      if (e.target.name && e.target.name.indexOf('co-') === 0) syncConfirm();
    });

    d.addEventListener('submit', (e) => {
      if (e.target.id === 'promoForm') {
        e.preventDefault();
        applyPromo(document.getElementById('promoInput').value);
      }
    });

    d.addEventListener('click', (e) => {
      const item = e.target.closest('.cart-item');

      const pick = e.target.closest('[data-pick-addr]');
      if (pick) {
        pickAddr(pick.dataset.pickAddr);
        return;
      }

      if (e.target.closest('[data-addr-toggle]')) {
        showAddrForm();
        return;
      }

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
      } else if (e.target.closest('[data-promo-remove]')) {
        removePromo();
      } else if (e.target.closest('[data-checkout]')) {
        pickedAddr = null;   // щоразу починаємо з основної адреси
        mode = 'checkout';
        render();
      } else if (e.target.closest('[data-back]')) {
        mode = 'cart';
        render();
      } else if (e.target.closest('[data-submit]')) {
        submitOrder();
      } else if (e.target.closest('[data-myorders]')) {
        R.overlay.close(d);
        setTimeout(() => R.openAccount('orders'), 260);
      }
    });
  }

  R.initCart = init;
})();
