/* ============================================================
   REYTER — firebase.js
   Ініціалізація Firebase: авторизація (Email/Password, Google)
   та хмарна база Firestore (профілі users/, замовлення orders/).
   Якщо SDK не завантажився — сайт працює далі без хмари,
   на localStorage.
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  R.fbConfig = {
    apiKey: 'AIzaSyD_88QLk2dxQDUIjEVMrRCTHgVkeVX-9pI',
    authDomain: 'reyter-18d2c.firebaseapp.com',
    projectId: 'reyter-18d2c',
    storageBucket: 'reyter-18d2c.firebasestorage.app',
    messagingSenderId: '475583686911',
    appId: '1:475583686911:web:8f75bc02248fc3e46f04ca',
    measurementId: 'G-7S5QT2F8NF'
  };

  R.fb = {
    enabled: false,
    auth: null,
    db: null,
    user: null
  };

  if (!window.firebase || !window.firebase.initializeApp) {
    return; // CDN заблоковано — працюємо локально
  }

  try {
    firebase.initializeApp(R.fbConfig);
    R.fb.auth = firebase.auth();
    R.fb.db = firebase.firestore();
    R.fb.enabled = true;

    R.fb.auth.onAuthStateChanged((user) => {
      R.fb.user = user || null;
      document.dispatchEvent(new CustomEvent('auth:changed', { detail: user }));
    });
  } catch (e) {
    R.fb.enabled = false;
  }

  /* ---------- Помилки авторизації українською ---------- */

  R.fb.errorText = function (err) {
    const code = (err && err.code) || '';
    const map = {
      'auth/invalid-email': 'Некоректний email',
      'auth/missing-password': 'Введіть пароль',
      'auth/weak-password': 'Закороткий пароль — потрібно мінімум 6 символів',
      'auth/email-already-in-use': 'Акаунт із таким email вже існує — спробуйте увійти',
      'auth/user-not-found': 'Невірний email або пароль',
      'auth/wrong-password': 'Невірний email або пароль',
      'auth/invalid-credential': 'Невірний email або пароль',
      'auth/too-many-requests': 'Забагато спроб — спробуйте трохи пізніше',
      'auth/popup-closed-by-user': 'Вікно входу було закрито',
      'auth/cancelled-popup-request': 'Вікно входу було закрито',
      'auth/popup-blocked': 'Браузер заблокував спливаюче вікно — дозвольте його',
      'auth/operation-not-supported-in-this-environment': 'Цей браузер не підтримує спливаючі вікна — спробуйте ще раз',
      'auth/unauthorized-domain': 'Домен не додано у Firebase: Authentication → Settings → Authorized domains → додайте reyter.men',
      'auth/network-request-failed': 'Немає звʼязку — перевірте інтернет'
    };
    return map[code] || 'Не вдалося виконати дію (' + (code || 'невідома помилка') + ')';
  };

  /* ---------- Хмарний профіль ---------- */

  R.fb.loadCloudProfile = async function () {
    if (!R.fb.user) return null;
    try {
      const snap = await R.fb.db.collection('users').doc(R.fb.user.uid).get();
      return snap.exists ? snap.data() : null;
    } catch (e) {
      return null;
    }
  };

  R.fb.saveCloudProfile = async function (profile) {
    if (!R.fb.user) return;
    try {
      await R.fb.db.collection('users').doc(R.fb.user.uid).set(
        Object.assign({}, profile, {
          email: R.fb.user.email || '',
          updated: firebase.firestore.FieldValue.serverTimestamp()
        }),
        { merge: true }
      );
    } catch (e) { /* хмара недоступна — профіль лишається локально */ }
  };

  /* ---------- Хмарні замовлення ---------- */

  /* Замовлення потрапляє в адмінку і від гостя без акаунта:
     тоді uid порожній, а правила бази дозволяють такий запис. */
  R.fb.saveCloudOrder = async function (order) {
    const user = R.fb.user;
    try {
      await R.fb.db.collection('orders').add({
        num: order.num,
        date: order.date,
        items: order.items,
        subtotal: Number(order.subtotal) || Number(order.total) || 0,
        discount: Number(order.discount) || 0,
        promoCode: order.promoCode || '',
        total: order.total,
        customer: order.customer,
        message: order.message,
        status: 'new',
        uid: user ? user.uid : null,
        email: (order.customer && order.customer.email) || (user && user.email) || '',
        source: 'Сайт',
        lang: R.lang ? R.lang() : 'uk',
        created: firebase.firestore.FieldValue.serverTimestamp()
      });
      return true;
    } catch (e) {
      return false; // локальна копія та сповіщення все одно спрацюють
    }
  };

  /* ---------- Каталог із бази (публічне читання) ---------- */

  R.fb.loadCatalog = async function () {
    try {
      const results = await Promise.all([
        R.fb.db.collection('catalog_categories').orderBy('order').get(),
        R.fb.db.collection('catalog_products').orderBy('order').get()
      ]);
      const cats = results[0];
      const prods = results[1];
      if (cats.empty || prods.empty) return null;
      return {
        categories: cats.docs.map((d) => Object.assign({ id: d.id }, d.data())),
        products: prods.docs.map((d) => Object.assign({ id: d.id }, d.data()))
      };
    } catch (e) {
      return null;
    }
  };

  /* ---------- Складські залишки (публічне читання) ---------- */

  R.fb.loadInventory = async function () {
    try {
      const snap = await R.fb.db.collection('inventory').get();
      const map = {};
      snap.forEach((d) => { map[d.id] = d.data(); });
      return map;
    } catch (e) {
      return null;
    }
  };

  R.fb.loadCloudOrders = async function () {
    if (!R.fb.user) return [];
    try {
      const snap = await R.fb.db
        .collection('orders')
        .where('uid', '==', R.fb.user.uid)
        .limit(50)
        .get();
      const orders = snap.docs.map((d) => Object.assign({ _id: d.id }, d.data()));
      orders.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return orders;
    } catch (e) {
      return null; // null = не вдалося прочитати (нема бази чи правил)
    }
  };
})();
