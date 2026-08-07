/* ============================================================
   REYTER — main.js
   Точка входу: порядок ініціалізації модулів
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  R.renderCatalog();     // каталог із data.js
  R.initProductModal();  // модалка товару + лайтбокс
  R.initCart();          // кошик
  R.initAccount();       // кабінет користувача
  R.initUI();            // шапка, оверлеї, анімації

  // Живі складські залишки з Firestore: коли завантажаться —
  // перераховуємо «Продано» / «Закінчується» на вітрині
  if (R.fb && R.fb.enabled) {
    R.fb.loadInventory().then((inv) => {
      if (inv && Object.keys(inv).length) {
        R.stock = inv;
        R.refreshCatalog();
      }
    });
  }
})();
