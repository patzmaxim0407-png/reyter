/* ============================================================
   REYTER — account.js
   Кабінет користувача: вхід/реєстрація (Email/Password, Google),
   профіль і історія замовлень. З акаунтом дані синхронізуються
   з хмарою (Firestore) і доступні з будь-якого пристрою;
   без акаунта — зберігаються локально в браузері.
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;


  let tab = 'profile';    // profile | promos | orders
  let authMode = 'login'; // login | register

  function drawer() {
    return document.getElementById('accountDrawer');
  }

  function body() {
    return document.getElementById('accountBody');
  }

  function signedIn() {
    return !!(R.fb && R.fb.enabled && R.fb.user);
  }

  /* ---------- Форма входу / реєстрації ---------- */

  function renderAuth(append) {
    const isLogin = authMode === 'login';

    const html =
      (append ? '' : '<p class="account-note">' + R.t('acc.authNote') + '</p>') +

      '<button class="btn btn--ghost auth-google" data-google type="button">' +
        '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.7 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.9 6.2C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.7-6c-2.1 1.4-4.7 2.3-7.5 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z"/></svg>' +
        ' ' + R.t('acc.google') +
      '</button>' +

      '<div class="auth-divider"><span>' + R.t('acc.orEmail') + '</span></div>' +

      '<form class="form-grid" id="authForm" novalidate>' +
        '<div class="field">' +
          '<label for="auEmail">Email</label>' +
          '<input id="auEmail" type="email" autocomplete="email" placeholder="you@example.com">' +
        '</div>' +
        '<div class="field">' +
          '<label for="auPass">' + R.t('acc.password') + '</label>' +
          '<input id="auPass" type="password" autocomplete="' + (isLogin ? 'current-password' : 'new-password') + '" placeholder="' + R.t('acc.passwordPh') + '">' +
        '</div>' +
        '<button class="btn btn--primary" data-submit-auth type="submit">' +
          (isLogin ? R.t('acc.login') : R.t('acc.register')) +
        '</button>' +
      '</form>' +

      '<div class="auth-links">' +
        (isLogin
          ? '<button data-switch="register" type="button">' + R.t('acc.noAccount') + ' <b>' + R.t('acc.register') + '</b></button>' +
            '<button data-reset type="button">' + R.t('acc.forgot') + '</button>'
          : '<button data-switch="login" type="button">' + R.t('acc.hasAccount') + ' <b>' + R.t('acc.login') + '</b></button>') +
      '</div>';

    if (append) body().insertAdjacentHTML('beforeend', html);
    else body().innerHTML = html;
  }

  async function doEmailAuth() {
    const email = document.getElementById('auEmail').value.trim();
    const pass = document.getElementById('auPass').value;
    if (!email || !pass) {
      R.toast(R.t('acc.enterEmailPass'));
      return;
    }
    try {
      if (authMode === 'login') {
        await R.fb.auth.signInWithEmailAndPassword(email, pass);
      } else {
        await R.fb.auth.createUserWithEmailAndPassword(email, pass);
      }
      R.toast(authMode === 'login' ? R.t('acc.welcome') : R.t('acc.created'), 'success');
    } catch (err) {
      R.toast(R.fb.errorText(err));
    }
  }

  async function doGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await R.fb.auth.signInWithPopup(provider);
      R.toast(R.t('acc.welcome'), 'success');
    } catch (err) {
      const code = (err && err.code) || '';
      // Попап заблоковано (типово для мобільних) — повне перенаправлення
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        try {
          await R.fb.auth.signInWithRedirect(provider);
          return;
        } catch (e2) {
          err = e2;
        }
      }
      R.toast(R.fb.errorText(err));
    }
  }

  async function doReset() {
    const email = document.getElementById('auEmail').value.trim();
    if (!email) {
      R.toast(R.t('acc.enterEmailFirst'));
      return;
    }
    try {
      await R.fb.auth.sendPasswordResetEmail(email);
      R.toast(R.t('acc.resetSent'), 'success');
    } catch (err) {
      R.toast(R.fb.errorText(err));
    }
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

  function profileFormHTML(p) {
    return (
      '<form class="form-grid" id="profileForm" novalidate>' +
        fieldHTML('prName', R.t('acc.name'), p.name,
          'autocomplete="name" placeholder="' + R.esc(R.t('acc.namePh')) + '"') +
        fieldHTML('prPhone', R.t('acc.phone'), p.phone, 'type="tel" autocomplete="tel" placeholder="+380..."') +
        R.addressField('pr', p) +
        '<button class="btn btn--primary" data-save type="button">' + R.t('acc.save') + '</button>' +
      '</form>'
    );
  }

  async function renderProfile() {
    if (R.fb && R.fb.enabled && !R.fb.user) {
      renderAuth();
      return;
    }

    const local = R.getProfile();

    if (signedIn()) {
      const u = R.fb.user;
      const authUserHTML = () =>
        '<div class="auth-user">' +
          '<div class="auth-user__avatar">' + R.esc((u.email || 'R')[0].toUpperCase()) + '</div>' +
          '<div class="auth-user__info">' +
            '<b>' + R.esc(u.displayName || R.t('acc.yourAccount')) + '</b>' +
            '<span>' + R.esc(u.email || '') + '</span>' +
          '</div>' +
          '<button class="btn btn--ghost btn--sm" data-logout type="button">' + R.t('acc.logout') + '</button>' +
        '</div>';

      body().innerHTML =
        authUserHTML() +
        '<p class="account-note">' + R.t('acc.profileNote') + '</p>' +
        profileFormHTML(local);

      R.initAddress('pr');

      // Підтягуємо хмарний профіль і перемальовуємо форму, якщо він свіжіший
      const cloud = await R.fb.loadCloudProfile();
      if (cloud && document.getElementById('prName')) {
        const merged = Object.assign({}, local, cloud);
        R.saveProfile(merged);
        // Блок адреси має власний стан (реф міста, тип доставки),
        // тож перемальовуємо його цілком, а не по полю
        body().innerHTML =
          authUserHTML() +
          '<p class="account-note">' + R.t('acc.profileNote') + '</p>' +
          profileFormHTML(merged);
        R.initAddress('pr');
      }
    } else {
      // Firebase недоступний — локальний режим
      body().innerHTML =
        '<p class="account-note">' + R.t('acc.profileNoteLocal') + '</p>' +
        profileFormHTML(local);
      R.initAddress('pr');
    }
  }

  function saveProfileFromForm() {
    const profile = Object.assign({
      name: document.getElementById('prName').value.trim(),
      phone: document.getElementById('prPhone').value.trim()
    }, R.addressValue('pr'));
    R.saveProfile(profile);
    if (signedIn()) R.fb.saveCloudProfile(profile);
    R.toast(R.t('acc.saved'), 'success');
  }


  /* ---------- Персональні знижки ---------- */

  function promoCardHTML(p, idx) {
    const live = R.promoLive(p);
    const value = p.type === 'fixed'
      ? '−' + R.uah(p.value)
      : '−' + (Number(p.value) || 0) + '%';

    return (
      '<article class="mypromo' + (live.ok ? '' : ' is-off') + '" data-idx="' + idx + '">' +
        '<div class="mypromo__top">' +
          '<b class="mypromo__code">' + R.esc(p.code) + '</b>' +
          '<span class="mypromo__value">' + R.esc(value) + '</span>' +
          '<span class="mypromo__state' + (live.ok ? ' is-live' : '') + '">' + R.esc(live.label) + '</span>' +
        '</div>' +
        '<p class="mypromo__terms">' + R.esc(R.promoTerms(p)) + '</p>' +
        (live.ok
          ? '<div class="mypromo__actions">' +
              '<button class="btn btn--primary btn--sm" data-promo-apply type="button">' + R.t('acc.applyPromo') + '</button>' +
              '<button class="btn btn--ghost btn--sm" data-promo-copy type="button">' + R.t('acc.copyPromo') + '</button>' +
            '</div>'
          : '') +
      '</article>'
    );
  }

  let myPromos = [];

  async function renderPromos() {
    // список щоразу свіжий: після замовлення лічильник змінився,
    // і код міг стати вичерпаним
    if (!signedIn()) {
      body().innerHTML =
        '<p class="account-note">' + R.t('acc.promosGuest') + '</p>';
      renderAuth(true);
      return;
    }

    body().innerHTML = '<p class="account-note">' + R.t('acc.loading') + '</p>';
    myPromos = await R.promoMine();

    if (!myPromos.length) {
      body().innerHTML =
        '<div class="empty-state">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a2 2 0 0 1 0-4V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2a2 2 0 0 1 0 4 2 2 0 0 1 0 4v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2a2 2 0 0 1 0-4Z"/><path d="M12 7v10"/></svg>' +
          '<strong>' + R.t('acc.noPromos') + '</strong>' +
          R.t('acc.noPromosNote') +
        '</div>';
      return;
    }

    body().innerHTML =
      '<p class="account-note">' + R.t('acc.promosNote') + '</p>' +
      myPromos.map(promoCardHTML).join('');
  }

  /* ---------- Історія замовлень ---------- */

  /* ---------- Трекер статусу замовлення ---------- */

  function statusList() {
    return (R.config.orderStatuses || []).map((s) => ({
      id: s.id,
      title: R.t('st.' + s.id),
      hint: R.t('st.' + s.id + 'Hint')
    }));
  }

  function statusInfo(id) {
    return statusList().find((s) => s.id === id) || statusList()[0];
  }

  function trackerHTML(status) {
    if (status === 'cancelled') {
      return '<div class="tracker tracker--cancelled">' + R.t('st.cancelledFull') + '</div>';
    }
    const steps = statusList().filter((s) => s.id !== 'cancelled');
    let idx = steps.findIndex((s) => s.id === status);
    if (idx < 0) idx = 0;
    const current = steps[idx];
    return (
      '<div class="tracker">' +
        steps.map((s, i) =>
          '<div class="tracker__step' + (i < idx ? ' is-done' : '') + (i === idx ? ' is-current' : '') + '">' +
            '<span class="tracker__dot"></span>' +
            '<span class="tracker__label">' + R.esc(s.title) + '</span>' +
          '</div>'
        ).join('') +
      '</div>' +
      (current.hint ? '<p class="tracker__hint">' + R.esc(current.hint) + '</p>' : '')
    );
  }

  function orderCardHTML(o, idx, cloud) {
    const date = new Date(o.date).toLocaleDateString(R.lang() === 'en' ? 'en-GB' : 'uk-UA', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const items = (o.items || [])
      .map((i) =>
        '<div>' + R.esc(R.tx(i.name)) + (i.size ? ' · ' + R.esc(R.tx(i.size)) : '') + ' × ' + i.qty + '</div>'
      )
      .join('');
    const st = o.status || 'new';
    const chip = cloud
      ? '<span class="order-card__status' + (st === 'done' ? ' is-done' : '') + (st === 'cancelled' ? ' is-cancelled' : '') + '">' +
          R.esc(statusInfo(st).title) +
        '</span>'
      : '';
    return (
      '<article class="order-card" data-idx="' + idx + '">' +
        '<div class="order-card__head">' +
          '<span class="order-card__num">№' + R.esc(o.num) + chip + '</span>' +
          '<span class="order-card__date">' + date + '</span>' +
        '</div>' +
        (cloud ? trackerHTML(st) : '') +
        (cloud && o.ttn
          ? '<div class="order-card__ttn">📦 ' + R.t('acc.ttn') + ': <b>' + R.esc(o.ttn) + '</b>' +
            '<button data-copyttn type="button">' + R.t('acc.copy') + '</button></div>'
          : '') +
        '<div class="order-card__items">' + items + '</div>' +
        '<div class="order-card__total">' + R.t('cart.total') + ': ' + R.uah(o.total) + '</div>' +
        '<div class="order-card__actions">' +
          '<button class="btn btn--primary btn--sm" data-repeat type="button">' + R.t('acc.repeat') + '</button>' +
          (o.message ? '<button class="btn btn--ghost btn--sm" data-recopy type="button">' + R.t('acc.copy') + '</button>' : '') +
        '</div>' +
      '</article>'
    );
  }

  /* ---------- Відстеження без акаунта ----------
     Замовлення можна оформити гостем — тоді історії в кабінеті
     немає. Щоб покупець усе одно бачив рух, шукаємо запис за
     номером замовлення й телефоном: разом вони працюють як ключ
     до окремої публічної колекції (див. track.js). */

  function trackFormHTML() {
    return (
      '<div class="auth-divider"><span>' + R.t('trk.divider') + '</span></div>' +
      '<form class="form-grid" id="trackForm" novalidate>' +
        '<div class="field">' +
          '<label for="trkNum">' + R.t('trk.num') + '</label>' +
          '<input id="trkNum" autocomplete="off" spellcheck="false" placeholder="R-260808-799">' +
        '</div>' +
        '<div class="field">' +
          '<label for="trkPhone">' + R.t('trk.phone') + '</label>' +
          '<input id="trkPhone" type="tel" autocomplete="tel" placeholder="+380…">' +
        '</div>' +
        '<button class="btn btn--ghost" type="submit">' + R.t('trk.find') + '</button>' +
      '</form>' +
      '<div id="trackResult"></div>'
    );
  }

  function trackCardHTML(o) {
    const date = o.date
      ? new Date(o.date).toLocaleDateString(R.lang() === 'en' ? 'en-GB' : 'uk-UA', {
          day: 'numeric', month: 'long', year: 'numeric'
        })
      : '';
    const items = (o.items || [])
      .map((i) =>
        '<div>' + R.esc(R.tx(i.name)) + (i.size ? ' · ' + R.esc(R.tx(i.size)) : '') + ' × ' + (i.qty || 1) + '</div>')
      .join('');
    const st = o.status || 'new';
    const where = [o.carrier, o.city].filter(Boolean).join(', ');

    return (
      '<article class="order-card">' +
        '<div class="order-card__head">' +
          '<span class="order-card__num">№' + R.esc(o.num) +
            '<span class="order-card__status' +
              (st === 'done' ? ' is-done' : '') + (st === 'cancelled' ? ' is-cancelled' : '') + '">' +
              R.esc(statusInfo(st).title) + '</span>' +
          '</span>' +
          (date ? '<span class="order-card__date">' + date + '</span>' : '') +
        '</div>' +
        trackerHTML(st) +
        (o.ttn
          ? '<div class="order-card__ttn">📦 ' + R.t('acc.ttn') + ': <b>' + R.esc(o.ttn) + '</b>' +
            '<button data-copyttn-track type="button">' + R.t('acc.copy') + '</button></div>'
          : '') +
        (items ? '<div class="order-card__items">' + items + '</div>' : '') +
        (where ? '<div class="order-card__items">🚚 ' + R.esc(where) + '</div>' : '') +
        '<div class="order-card__total">' + R.t('cart.total') + ': ' + R.uah(o.total) + '</div>' +
      '</article>'
    );
  }

  let trackedOrder = null;

  async function doTrack() {
    const box = document.getElementById('trackResult');
    if (!box) return;
    const num = document.getElementById('trkNum').value;
    const phone = document.getElementById('trkPhone').value;

    box.innerHTML = '<p class="account-note">' + R.t('trk.searching') + '</p>';
    const res = await R.trackFind(num, phone);

    if (res.ok) {
      trackedOrder = res.order;
      box.innerHTML = trackCardHTML(res.order);
      return;
    }

    trackedOrder = null;
    const why = {
      no_num: 'trk.needNum',
      no_phone: 'trk.needPhone',
      not_found: 'trk.notFound',
      offline: 'trk.offline'
    }[res.reason] || 'trk.notFound';
    box.innerHTML = '<p class="account-note account-note--warn">' + R.t(why) + '</p>';
  }

  let shownOrders = []; // що зараз відображено (для кнопок)

  async function renderOrders() {
    if (R.fb && R.fb.enabled && !R.fb.user) {
      renderAuth();
      body().insertAdjacentHTML('beforeend', trackFormHTML());
      return;
    }

    const emptyHTML =
      '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l3 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8l3-5Z"/><path d="M5 8h14"/><path d="M9.5 12a2.5 2.5 0 0 0 5 0"/></svg>' +
        '<strong>' + R.t('acc.noOrders') + '</strong>' +
        R.t('acc.noOrdersNote') +
      '</div>';

    if (signedIn()) {
      body().innerHTML = '<p class="account-note">' + R.t('acc.loading') + '</p>';
      const cloud = await R.fb.loadCloudOrders();

      if (cloud === null) {
        // Хмара не відповіла — показуємо локальні
        shownOrders = R.getOrders();
        body().innerHTML =
          '<p class="account-note">' + R.t('acc.cloudDown') + '</p>' +
          (shownOrders.length ? shownOrders.map((o, i) => orderCardHTML(o, i, false)).join('') : emptyHTML);
        return;
      }

      shownOrders = cloud;
      body().innerHTML =
        '<p class="account-note">' + R.t('acc.ordersNote') + '</p>' +
        (cloud.length ? cloud.map((o, i) => orderCardHTML(o, i, true)).join('') : emptyHTML);
      return;
    }

    // Локальний режим
    shownOrders = R.getOrders();
    if (!shownOrders.length) {
      body().innerHTML = emptyHTML;
      return;
    }
    body().innerHTML =
      '<p class="account-note">' + R.t('acc.ordersLocalNote') + '</p>' +
      shownOrders.map((o, i) => orderCardHTML(o, i, false)).join('') +
      '<button class="btn btn--ghost btn--sm" data-clear type="button" style="width:100%;margin-top:.4rem">' + R.t('acc.clear') + '</button>';
  }

  function repeatOrder(order) {
    let added = 0;
    (order.items || []).forEach((i) => {
      if (R.getProduct(i.id)) {
        for (let n = 0; n < i.qty; n++) R.cart.add(i.id, i.size);
        added++;
      }
    });
    if (!added) {
      R.toast(R.t('acc.gone'));
      return;
    }
    R.overlay.close(drawer());
    setTimeout(() => R.openCart(), 250);
  }

  /* ---------- Вкладки ---------- */

  function render() {
    document.querySelectorAll('.drawer__tab').forEach((t) => {
      const active = t.dataset.tab === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (tab === 'profile') renderProfile();
    else if (tab === 'promos') renderPromos();
    else renderOrders();
  }

  function openAccount(startTab) {
    if (startTab) tab = startTab;
    render();
    R.overlay.open(drawer(), { focus: drawer().querySelector('.drawer__close') });
  }

  R.openAccount = openAccount;

  /* ---------- Індикатор входу в шапці ---------- */

  function updateHeaderBadge() {
    const btn = document.getElementById('accountBtn');
    if (btn) btn.classList.toggle('hbtn--authed', signedIn());
  }

  /* ---------- Ініціалізація ---------- */

  function init() {
    const btn = document.getElementById('accountBtn');
    if (btn) btn.addEventListener('click', () => openAccount());

    document.addEventListener('lang:changed', () => {
      const d = drawer();
      if (d && !d.hidden) render();
    });

    document.addEventListener('auth:changed', () => {
      updateHeaderBadge();
      const d = drawer();
      if (d && !d.hidden) render(); // панель відкрита — оновлюємо вміст
    });

    const d = drawer();
    if (!d) return;

    d.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.drawer__tab');
      if (tabBtn) {
        tab = tabBtn.dataset.tab;
        render();
        return;
      }

      const switchBtn = e.target.closest('[data-switch]');
      if (switchBtn) {
        authMode = switchBtn.dataset.switch;
        render();
        return;
      }

      if (e.target.closest('[data-google]')) { doGoogle(); return; }
      if (e.target.closest('[data-reset]')) { doReset(); return; }
      if (e.target.closest('[data-save]')) { saveProfileFromForm(); return; }

      if (e.target.closest('[data-logout]')) {
        R.fb.auth.signOut().then(() => {
          R.toast(R.t('acc.loggedOut'));
          render();
        });
        return;
      }

      const mp = e.target.closest('.mypromo');
      if (mp) {
        const p = myPromos[Number(mp.dataset.idx)];
        if (e.target.closest('[data-promo-copy]')) {
          R.copyText(p.code);
          R.toast(R.t('acc.promoCopied'), 'success');
          return;
        }
        if (e.target.closest('[data-promo-apply]')) {
          R.overlay.close(drawer());
          setTimeout(() => R.openCartWithPromo(p.code), 280);
          return;
        }
      }

      if (e.target.closest('[data-copyttn-track]')) {
        R.copyText((trackedOrder && trackedOrder.ttn) || '');
        return;
      }

      const card = e.target.closest('.order-card');
      if (e.target.closest('[data-copyttn]') && card) {
        R.copyText(shownOrders[Number(card.dataset.idx)].ttn || '');
        return;
      }
      if (e.target.closest('[data-repeat]') && card) {
        repeatOrder(shownOrders[Number(card.dataset.idx)]);
      } else if (e.target.closest('[data-recopy]') && card) {
        R.copyText(shownOrders[Number(card.dataset.idx)].message || '');
      } else if (e.target.closest('[data-clear]')) {
        if (confirm(R.t('acc.clearConfirm'))) {
          R.saveOrders([]);
          render();
        }
      }
    });

    d.addEventListener('submit', (e) => {
      if (e.target.id === 'trackForm') {
        e.preventDefault();
        doTrack();
      }
      if (e.target.id === 'authForm') {
        e.preventDefault();
        doEmailAuth();
      }
      if (e.target.id === 'profileForm') {
        e.preventDefault();
        saveProfileFromForm();
      }
    });

    updateHeaderBadge();
  }

  R.initAccount = init;
})();
