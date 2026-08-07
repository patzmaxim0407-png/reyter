/* ============================================================
   REYTER — main.js
   Точка входу: порядок ініціалізації модулів
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  R.initI18n();          // мова (UA/EN) — до першого рендеру
  R.renderCatalog();     // каталог із data.js
  R.initProductModal();  // модалка товару + лайтбокс
  R.initCart();          // кошик
  R.initAccount();       // кабінет користувача
  R.initUI();            // шапка, оверлеї, анімації

  // Каталог і складські залишки з бази: data.js рендериться миттєво
  // як резервна копія, а щойно відповість Firestore — вітрина
  // оновлюється актуальними товарами та наявністю
  if (R.fb && R.fb.enabled) {
    Promise.all([R.fb.loadCatalog(), R.fb.loadInventory()]).then((res) => {
      const catalog = res[0];
      const inv = res[1];
      let changed = false;

      if (catalog && catalog.products.length) {
        R.categories = catalog.categories;
        R.products = catalog.products;
        changed = true;
      }
      if (inv && Object.keys(inv).length) {
        R.stock = inv;
        changed = true;
      }
      if (changed) R.refreshCatalog();
    });
  }
})();
