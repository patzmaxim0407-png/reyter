/* ============================================================
   REYTER — main.js
   Точка входу: порядок ініціалізації модулів
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  R.initI18n();          // мова (UA/EN) — до першого рендеру

  /* Перший рендер робимо з копії останнього опублікованого
     каталогу, якщо вона є: інакше видно, як стрічка категорій
     перебудовується, щойно відповість Firestore. data.js лишається
     запасним варіантом для першого візиту. */
  const online = R.fb && R.fb.enabled;
  const cached = online && R.fb.cachedCatalog && R.fb.cachedCatalog();
  const cachedStock = online && R.fb.cachedStock && R.fb.cachedStock();
  if (cached) {
    R.categories = cached.categories;
    R.products = cached.products;
  }
  if (cachedStock) R.stock = cachedStock;

  R.renderCatalog();
  R.initProductModal();  // модалка товару + лайтбокс
  R.initCart();          // кошик
  R.initAccount();       // кабінет користувача
  R.initUI();            // шапка, оверлеї, анімації

  // Каталог і складські залишки з бази: data.js рендериться миттєво
  // як резервна копія, а щойно відповість Firestore — вітрина
  // оновлюється. Сайт читає ОПУБЛІКОВАНУ версію каталогу:
  // зміни в адмінці лежать у чернетці, поки їх не опублікують.
  // ?preview=draft — попередній перегляд чернетки для адміна.
  const previewDraft =
    new URLSearchParams(location.search).get('preview') === 'draft';

  if (R.fb && R.fb.enabled) {
    const catalogReq = previewDraft
      ? R.fb.loadCatalog()
      : R.fb.loadPublishedCatalog().then(
          // поки не було жодної публікації — читаємо базу напряму,
          // як раніше (перехідний період)
          (pub) => pub || R.fb.loadCatalog()
        );

    Promise.all([catalogReq, R.fb.loadInventory()]).then((res) => {
      const catalog = res[0];
      const inv = res[1];
      let changed = false;

      if (catalog && catalog.products.length) {
        // З копії ми вже намалювали те саме — не перемальовуємо
        // вітрину заради ідентичних даних: це зайве мерехтіння
        const same = cached &&
          JSON.stringify(cached.categories) === JSON.stringify(catalog.categories) &&
          JSON.stringify(cached.products) === JSON.stringify(catalog.products);

        R.categories = catalog.categories;
        R.products = catalog.products;
        if (!same) changed = true;
      }
      if (inv && Object.keys(inv).length) {
        const sameStock = cachedStock &&
          JSON.stringify(cachedStock) === JSON.stringify(inv);
        R.stock = inv;
        if (!sameStock) changed = true;
      }
      if (changed) R.refreshCatalog();

      // Є запланована публікація — вмикаємо її точно в час,
      // навіть якщо вкладку відкрили заздалегідь
      const nextAt = catalog && catalog.nextAt;
      if (nextAt && !previewDraft) {
        const wait = Math.min(nextAt - Date.now() + 1000, 12 * 3600 * 1000);
        setTimeout(() => {
          R.fb.loadPublishedCatalog().then((pub) => {
            if (pub && pub.products.length) {
              R.categories = pub.categories;
              R.products = pub.products;
              R.refreshCatalog();
            }
          });
        }, Math.max(wait, 1000));
      }
    });

    if (previewDraft) {
      const pill = document.createElement('div');
      pill.className = 'draft-pill';
      pill.textContent = 'Чернетка — так виглядатиме сайт після публікації';
      document.body.appendChild(pill);
    }
  }
})();
