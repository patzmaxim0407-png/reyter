/* ============================================================
   REYTER — account.js
   Кабінет користувача: профіль (дані для доставки)
   та історія замовлень. Дані зберігаються в цьому браузері.
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  const CARRIERS = ['Нова Пошта', 'Укрпошта', 'Meest', 'Міжнародна доставка'];

  let tab = 'profile'; // profile | orders

  function drawer() {
    return document.getElementById('accountDrawer');
  }

  function body() {
    return document.getElementById('accountBody');
  }

  /* ---------- Профіль ---------- */

  function fieldHTML(id, label, value, attrs) {
    return (
      '<div class="field">' +
        '<label for="' + id + '">' + label + '</label>' +
        '<input id="' + id + '" value="' + R.esc(value || '') + '" ' + (attrs || '') + '>' +
      '</div>'
    );
  }

  function renderProfile() {
    const p = R.getProfile();

    body().innerHTML =
      '<p class="account-note">Дані зберігаються лише у вашому браузері та автоматично підставляються під час оформлення замовлення.</p>' +
      '<form class="form-grid" id="profileForm" novalidate>' +
        fieldHTML('prName', 'Імʼя та прізвище', p.name, 'autocomplete="name"') +
        fieldHTML('prPhone', 'Телефон', p.phone, 'type="tel" autocomplete="tel" placeholder="+380..."') +
        '<div class="form-row">' +
          '<div class="field">' +
            '<label for="prCarrier">Доставка</label>' +
            '<select id="prCarrier">' +
              CARRIERS.map((c) =>
                '<option' + (p.carrier === c ? ' selected' : '') + '>' + c + '</option>'
              ).join('') +
            '</select>' +
          '</div>' +
          fieldHTML('prCity', 'Місто', p.city, 'autocomplete="address-level2"') +
        '</div>' +
        fieldHTML('prBranch', 'Відділення / адреса', p.branch, '') +
        '<button class="btn btn--primary" data-save type="button">Зберегти</button>' +
      '</form>';
  }

  function saveProfile() {
    R.saveProfile({
      name: document.getElementById('prName').value.trim(),
      phone: document.getElementById('prPhone').value.trim(),
      carrier: document.getElementById('prCarrier').value,
      city: document.getElementById('prCity').value.trim(),
      branch: document.getElementById('prBranch').value.trim()
    });
    R.toast('Профіль збережено ✓', 'success');
  }

  /* ---------- Історія замовлень ---------- */

  function renderOrders() {
    const orders = R.getOrders();

    if (!orders.length) {
      body().innerHTML =
        '<div class="empty-state">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l3 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8l3-5Z"/><path d="M5 8h14"/><path d="M9.5 12a2.5 2.5 0 0 0 5 0"/></svg>' +
          '<strong>Замовлень поки немає</strong>' +
          'Ваші замовлення з цього браузера зʼявляться тут.' +
        '</div>';
      return;
    }

    body().innerHTML =
      '<p class="account-note">Історія зберігається у вашому браузері. Статус замовлення уточнюйте в Instagram Direct.</p>' +
      orders
        .map((o, idx) => {
          const date = new Date(o.date).toLocaleDateString('uk-UA', {
            day: 'numeric', month: 'long', year: 'numeric'
          });
          const items = o.items
            .map((i) =>
              '<div>' + R.esc(i.name) +
              (i.size ? ' · ' + R.esc(i.size) : '') +
              ' × ' + i.qty + '</div>'
            )
            .join('');
          return (
            '<article class="order-card" data-idx="' + idx + '">' +
              '<div class="order-card__head">' +
                '<span class="order-card__num">№' + R.esc(o.num) + '</span>' +
                '<span class="order-card__date">' + date + '</span>' +
              '</div>' +
              '<div class="order-card__items">' + items + '</div>' +
              '<div class="order-card__total">Разом: ' + R.fmt(o.total) + ' грн</div>' +
              '<div class="order-card__actions">' +
                '<button class="btn btn--primary btn--sm" data-repeat type="button">Повторити</button>' +
                '<button class="btn btn--ghost btn--sm" data-recopy type="button">Скопіювати</button>' +
              '</div>' +
            '</article>'
          );
        })
        .join('') +
      '<button class="btn btn--ghost btn--sm" data-clear type="button" style="width:100%;margin-top:.4rem">Очистити історію</button>';
  }

  function repeatOrder(order) {
    let added = 0;
    order.items.forEach((i) => {
      if (R.getProduct(i.id)) {
        for (let n = 0; n < i.qty; n++) R.cart.add(i.id, i.size);
        added++;
      }
    });
    if (!added) {
      R.toast('Цих товарів уже немає в каталозі');
      return;
    }
    R.overlay.close(drawer());
    setTimeout(() => R.openCart(), 250);
  }

  /* ---------- Рендер вкладок ---------- */

  function render() {
    document.querySelectorAll('.drawer__tab').forEach((t) => {
      const active = t.dataset.tab === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (tab === 'profile') renderProfile();
    else renderOrders();
  }

  function openAccount(startTab) {
    if (startTab) tab = startTab;
    render();
    R.overlay.open(drawer(), { focus: drawer().querySelector('.drawer__close') });
  }

  R.openAccount = openAccount;

  /* ---------- Ініціалізація ---------- */

  function init() {
    const btn = document.getElementById('accountBtn');
    if (btn) btn.addEventListener('click', () => openAccount());

    const d = drawer();
    if (!d) return;

    d.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.drawer__tab');
      if (tabBtn) {
        tab = tabBtn.dataset.tab;
        render();
        return;
      }

      if (e.target.closest('[data-save]')) {
        saveProfile();
        return;
      }

      const card = e.target.closest('.order-card');
      const orders = R.getOrders();

      if (e.target.closest('[data-repeat]') && card) {
        repeatOrder(orders[Number(card.dataset.idx)]);
      } else if (e.target.closest('[data-recopy]') && card) {
        R.copyText(orders[Number(card.dataset.idx)].message);
      } else if (e.target.closest('[data-clear]')) {
        if (confirm('Видалити всю історію замовлень із цього браузера?')) {
          R.saveOrders([]);
          render();
        }
      }
    });
  }

  R.initAccount = init;
})();
