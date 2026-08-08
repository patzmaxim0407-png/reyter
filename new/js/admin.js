/* ============================================================
   REYTER — admin.js
   Адмінка магазину. Дві частини:
   1) Каталог: категорії та товари в Firestore (зміни зʼявляються
      на сайті одразу), імпорт із data.js, резервна копія
   2) Хмарні панелі: гейт для адміністраторів, замовлення (live),
      склад із приходами та журналом руху, адміни, сповіщення
   ============================================================ */

/* ============================================================
   МОДУЛЬ 1 — КАТАЛОГ (Firestore)
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  const GH = {
    owner: 'patzmaxim0407-png',
    repo: 'reyter',
    branch: 'main',
    path: 'new/js/data.js'
  };

  const KEY_TOKEN = 'reyter:admin:token';
  const ALL_SIZES = R.config.allSizes;

  /* Стан каталогу: дзеркало бази (або data.js, поки база порожня) */
  let state = { categories: [], products: [] };
  let seeded = false;      // каталог уже в базі?
  let currentCat = 'all';
  let editingId = null;

  R.adminGetState = function () { return state; };

  /* ---------- Хелпери ---------- */

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(n) {
    return Number(n).toLocaleString('uk-UA');
  }

  function toast(msg, type) {
    const wrap = $('toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'success' ? ' toast--success' : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 320);
    }, 2600);
  }

  function fbOk() {
    return R.fb && R.fb.enabled;
  }

  function catCol() {
    return R.fb.db.collection('catalog_categories');
  }

  function prodCol() {
    return R.fb.db.collection('catalog_products');
  }

  function prodDocData(p) {
    const data = Object.assign({}, p);
    delete data.id; // артикул — це id документа
    return data;
  }

  function maxOrder(list) {
    return list.reduce((m, x) => Math.max(m, Number(x.order) || 0), 0);
  }

  function slugify(name) {
    const map = { а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ie',ж:'zh',з:'z',и:'y',і:'i',ї:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ь:'',ю:'iu',я:'ia' };
    let slug = String(name).toLowerCase()
      .split('').map((ch) => map[ch] !== undefined ? map[ch] : ch).join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) slug = 'cat';
    let unique = slug;
    let n = 2;
    while (state.categories.some((c) => c.id === unique)) unique = slug + '-' + n++;
    return unique;
  }

  function lines(value) {
    return value.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  /* ---------- Завантаження каталогу ---------- */

  async function loadCatalog() {
    if (fbOk()) {
      const db = await R.fb.loadCatalog();
      if (db && db.products.length) {
        state = db;
        seeded = true;
        render();
        return;
      }
    }
    // База порожня — показуємо data.js і пропонуємо імпорт
    state = {
      categories: JSON.parse(JSON.stringify(R.categories)),
      products: JSON.parse(JSON.stringify(R.products))
    };
    seeded = false;
    render();
  }

  /* Первинний імпорт каталогу data.js → Firestore */
  async function seedCatalog() {
    try {
      const batch = R.fb.db.batch();
      state.categories.forEach((c, i) => {
        c.order = i * 10;
        batch.set(catCol().doc(c.id), { title: c.title, order: c.order });
      });
      state.products.forEach((p, i) => {
        p.order = i * 10;
        batch.set(prodCol().doc(p.id), prodDocData(p));
      });
      await batch.commit();
      seeded = true;
      render();
      toast('Каталог імпортовано в чернетку ✓ Опублікуйте, коли будете готові', 'success');
    } catch (err) {
      toast('Не вдалося імпортувати. Увійдіть акаунтом адміністратора і перевірте правила Firestore');
    }
  }

  /* ---------- Синхронізація структури з data.js ----------
     Сайт показує каталог із бази, а не з файлу. Коли структуру
     категорій міняють у data.js (перейменували, додали, перерозподілили
     товари), базу треба привести до неї — інакше зміни нікуди не
     дійдуть. Чіпаємо ЛИШЕ структуру: назви категорій, порядок,
     приналежність товару до категорій і прапорець «сховано».
     Ціни, фото й описи, відредаговані в адмінці, лишаються. */

  function structurePlan() {
    const fileCats = R.categories || [];
    const fileProds = R.products || [];
    const fileCatIds = new Set(fileCats.map((c) => c.id));
    const dbById = {};
    state.products.forEach((p) => { dbById[p.id] = p; });

    const gone = state.categories.filter((c) => !fileCatIds.has(c.id));
    const added = fileCats.filter((c) => !state.categories.some((x) => x.id === c.id));
    const renamed = fileCats.filter((c) => {
      const db = state.categories.find((x) => x.id === c.id);
      return db && db.title !== c.title;
    });

    const moved = fileProds.filter((p) => {
      const db = dbById[p.id];
      if (!db) return false;
      return prodCats(db).join(',') !== prodCats(p).join(',') || !!db.hidden !== !!p.hidden;
    });

    const missing = fileProds.filter((p) => !dbById[p.id]);
    const extra = state.products.filter((p) => !fileProds.some((f) => f.id === p.id));

    return { gone, added, renamed, moved, missing, extra, fileCats, fileProds, dbById };
  }

  /* Разова міграція: коли структура категорій у data.js змінилась
     (реліз нового каталогу), приводимо до неї ЧЕРНЕТКУ — сайт
     це не зачіпає, адмін переглядає результат і публікує сам.
     Маркер у settings/migrations, щоб не ганяти щоразу. */
  async function migrateStructure() {
    if (!seeded) return;

    const mig = await R.fb.db.collection('settings').doc('migrations').get()
      .catch(() => null);
    if (mig && mig.exists && mig.data().catalogStructV2) return;

    const plan = structurePlan();
    const hasChanges = plan.added.length || plan.gone.length || plan.renamed.length ||
      plan.moved.length || plan.missing.length;

    if (hasChanges) {
      const batch = R.fb.db.batch();

      plan.fileCats.forEach((c, i) => {
        const doc = { title: c.title, order: i * 10 };
        if (c.titleEn) doc.titleEn = c.titleEn;
        batch.set(catCol().doc(c.id), doc, { merge: true });
      });

      plan.gone.forEach((c) => batch.delete(catCol().doc(c.id)));

      plan.fileProds.forEach((p) => {
        const db = plan.dbById[p.id];
        if (db) {
          const patch = { category: p.category, hidden: !!p.hidden };
          patch.categories = Array.isArray(p.categories) && p.categories.length
            ? p.categories
            : firebase.firestore.FieldValue.delete();
          batch.update(prodCol().doc(p.id), patch);
        } else {
          batch.set(prodCol().doc(p.id), prodDocData(JSON.parse(JSON.stringify(p))));
        }
      });

      await batch.commit();
      await loadCatalog();
      toast('Категорії в чернетці оновлено за новою структурою — перегляньте і опублікуйте', 'success');
    }

    await R.fb.db.collection('settings').doc('migrations')
      .set({ catalogStructV2: true }, { merge: true });
  }

  /* ---------- Рендер ---------- */

  function countIn(catId) {
    return state.products.filter((p) => inCat(p, catId)).length;
  }

  function catTitle(id) {
    const c = state.categories.find((c) => c.id === id);
    return c ? c.title : id;
  }

  function renderCats() {
    const list = $('catList');

    let html =
      '<li class="a-cat' + (currentCat === 'all' ? ' is-active' : '') + '" data-id="all">' +
        'Всі товари <span class="a-cat__count">' + state.products.length + '</span>' +
      '</li>';

    html += state.categories
      .map((c) =>
        '<li class="a-cat' + (currentCat === c.id ? ' is-active' : '') + '" data-id="' + esc(c.id) + '">' +
          '<button type="button" class="a-cat__grip" data-grip ' +
            'title="Перетягніть, щоб змінити порядок" ' +
            'aria-label="Перетягнути категорію (стрілки ↑↓ теж працюють)">⠿</button>' +
          esc(c.title) +
          '<span class="a-cat__count">' + countIn(c.id) + '</span>' +
          '<span class="a-cat__tools">' +
            '<button data-act="rename" title="Перейменувати" aria-label="Перейменувати категорію">✎</button>' +
            '<button data-act="del" title="Видалити" aria-label="Видалити категорію">✕</button>' +
          '</span>' +
        '</li>'
      )
      .join('');

    list.innerHTML = html;
  }

  function renderList() {
    const root = $('productList');
    const title = $('curCatTitle');
    title.textContent = currentCat === 'all' ? 'Всі товари' : catTitle(currentCat);

    const seedBanner = !seeded
      ? '<div class="a-seed">' +
          '<b>Каталог ще не в базі даних.</b> Зараз показано вміст резервного файлу data.js. ' +
          'Натисніть, щоб імпортувати його в базу — після цього всі зміни зберігатимуться миттєво.' +
          '<button class="btn btn--primary btn--sm" id="seedBtn" type="button">Імпортувати каталог у базу</button>' +
        '</div>'
      : '';

    const items = state.products.filter(
      (p) => currentCat === 'all' || inCat(p, currentCat)
    );

    if (!items.length) {
      root.innerHTML = seedBanner + '<div class="a-empty">Тут поки немає товарів.<br>Натисніть «+ Новий товар», щоб додати перший.</div>';
      return;
    }

    root.innerHTML = seedBanner + items
      .map((p) => {
        const tags = [];
        if (p.status === 'sold-out') tags.push('<span class="a-item__tag a-item__tag--sold">Продано</span>');
        if (p.sale) tags.push('<span class="a-item__tag a-item__tag--sale">Sale</span>');
        if (p.hidden) tags.push('<span class="a-item__tag a-item__tag--hidden">Сховано</span>');
        return (
          '<div class="a-item' + (p.hidden ? ' is-hidden-product' : '') + '" data-id="' + esc(p.id) + '">' +
            '<img class="a-item__img" src="' + esc((p.images && p.images[0]) || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
            '<div>' +
              '<div class="a-item__name">' + esc(p.name) + tags.join('') + '</div>' +
              '<div class="a-item__meta">' + esc(p.id) + ' · ' +
                prodCats(p).map(catTitle).join(' + ') + ' · ' + fmt(p.price) + ' грн' +
                (p.sizes && p.sizes.length ? ' · ' + p.sizes.join(', ') : '') +
              '</div>' +
            '</div>' +
            '<div class="a-item__actions">' +
              '<button data-act="edit" title="Редагувати" aria-label="Редагувати товар">✎</button>' +
              '<button data-act="dup" title="Дублювати" aria-label="Дублювати товар">⧉</button>' +
              '<button data-act="toggle" title="' + (p.hidden ? 'Показати' : 'Сховати') +
                '" aria-label="' + (p.hidden ? 'Показати товар на сайті' : 'Сховати товар із сайту') + '">' +
                (p.hidden ? '🙈' : '👁') + '</button>' +
              '<button data-act="del" class="danger" title="Видалити" aria-label="Видалити товар">✕</button>' +
            '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function render() {
    renderCats();
    renderList();
    refreshPublishBadge();
  }

  /* ---------- Операції з категоріями ---------- */

  async function addCategory(name) {
    const cat = { id: slugify(name), title: name, order: maxOrder(state.categories) + 10 };
    try {
      await catCol().doc(cat.id).set({ title: cat.title, order: cat.order });
      state.categories.push(cat);
      render();
      toast('Категорію додано ✓', 'success');
    } catch (e) {
      toast('Немає прав. Увійдіть акаунтом адміністратора');
    }
  }

  async function renameCategory(cat, name) {
    try {
      await catCol().doc(cat.id).update({ title: name });
      cat.title = name;
      render();
    } catch (e) {
      toast('Не вдалося перейменувати');
    }
  }

  async function deleteCategory(idx) {
    const cat = state.categories[idx];
    try {
      await catCol().doc(cat.id).delete();
      state.categories.splice(idx, 1);
      if (currentCat === cat.id) currentCat = 'all';
      render();
    } catch (e) {
      toast('Не вдалося видалити');
    }
  }

  /* Зчитує порядок категорій із DOM після перетягування
     і зберігає його в чернетку */
  async function persistCatOrder() {
    const ids = Array.prototype.map.call($('catList').children, (li) => li.dataset.id)
      .filter((id) => id && id !== 'all');
    const byId = {};
    state.categories.forEach((c) => { byId[c.id] = c; });
    const next = ids.map((id) => byId[id]).filter(Boolean);

    if (next.length !== state.categories.length) {
      render(); // список розійшовся зі станом — перемальовуємо як було
      return;
    }
    if (!next.some((c, i) => state.categories[i] !== c)) return;

    try {
      const batch = R.fb.db.batch();
      next.forEach((c, i) => {
        const order = i * 10;
        if (c.order !== order) batch.update(catCol().doc(c.id), { order: order });
        c.order = order;
      });
      state.categories = next;
      await batch.commit();
      render();
    } catch (e) {
      toast('Не вдалося зберегти порядок');
      loadCatalog();
    }
  }

  /* Перетягування категорій за ручку ⠿. Pointer-події працюють
     і мишею, і пальцем; під час руху елемент переставляється
     в DOM одразу, а зберігається порядок один раз — коли
     відпустили. На телефоні список горизонтальний — вісь
     визначаємо з розкладки, а не вгадуємо пристрій. */
  function initCatDrag() {
    const list = $('catList');
    let dragEl = null;
    let pid = null;

    list.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('[data-grip]');
      if (!grip) return;
      const li = grip.closest('.a-cat');
      if (!li || li.dataset.id === 'all') return;
      dragEl = li;
      pid = e.pointerId;
      e.preventDefault();
      try { grip.setPointerCapture(pid); } catch (err) { /* старий браузер */ }
      li.classList.add('is-dragging');
    });

    list.addEventListener('pointermove', (e) => {
      if (!dragEl || e.pointerId !== pid) return;
      const horizontal =
        getComputedStyle(list).gridAutoFlow.indexOf('column') === 0;
      const pos = horizontal ? e.clientX : e.clientY;

      let before = null;
      for (const li of list.children) {
        if (li === dragEl || li.dataset.id === 'all') continue;
        const r = li.getBoundingClientRect();
        const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
        if (pos < mid) { before = li; break; }
      }
      if (before) list.insertBefore(dragEl, before);
      else list.appendChild(dragEl);
    });

    const finishDrag = (e) => {
      if (!dragEl || e.pointerId !== pid) return;
      dragEl.classList.remove('is-dragging');
      dragEl = null;
      pid = null;
      persistCatOrder();
    };
    list.addEventListener('pointerup', finishDrag);
    list.addEventListener('pointercancel', finishDrag);

    // Клавіатура: стрілки на сфокусованій ручці
    list.addEventListener('keydown', (e) => {
      if (!e.target.closest('[data-grip]')) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' &&
          e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const li = e.target.closest('.a-cat');
      const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
      const sibling = back ? li.previousElementSibling : li.nextElementSibling;
      if (!sibling || sibling.dataset.id === 'all') return;
      if (back) list.insertBefore(li, sibling);
      else list.insertBefore(sibling, li);
      persistCatOrder().then(() => {
        const again = $('catList').querySelector('[data-id="' + li.dataset.id + '"] [data-grip]');
        if (again) again.focus();
      });
    });
  }

  /* ---------- Редактор товару ---------- */

  /* Блокування прокрутки фону під модалкою.
     overflow: hidden на iOS не тримає сторінку — вона все одно
     «протягується», тож фіксуємо body і повертаємо позицію назад.
     Живе на спільному namespace: модалки відкривають обидва
     модулі адмінки, а це різні області видимості. */
  let lockedScroll = 0;

  R.lockBg = function () {
    if (document.body.classList.contains('no-scroll')) return;
    lockedScroll = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = -lockedScroll + 'px';
    document.body.classList.add('no-scroll');
  };

  R.unlockBg = function () {
    // ще відкрита якась модалка — прокрутку не повертаємо
    if (document.querySelector('.a-modal:not([hidden])')) return;
    if (!document.body.classList.contains('no-scroll')) return;
    document.body.classList.remove('no-scroll');
    document.body.style.top = '';
    const behavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, lockedScroll);
    document.documentElement.style.scrollBehavior = behavior;
  };

  function openModal(el) {
    el.hidden = false;
    R.lockBg();
  }

  function closeModal(el) {
    closeColorDrop();
    el.hidden = true;
    R.unlockBg();
  }

  function fillCategorySelect(selected) {
    $('fCategory').innerHTML = state.categories
      .map((c) => '<option value="' + esc(c.id) + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c.title) + '</option>')
      .join('');
  }

  /* Усі категорії товару: головна плюс додаткові */
  function prodCats(p) {
    if (!p) return [];
    const list = Array.isArray(p.categories) ? p.categories.filter(Boolean) : [];
    if (p.category && !list.includes(p.category)) list.unshift(p.category);
    return list;
  }

  function inCat(p, catId) {
    return prodCats(p).includes(catId);
  }

  /* Додаткові категорії — усі, крім головної */
  function renderExtraCats(main, extra) {
    const box = $('fExtraCats');
    if (!box) return;
    const picked = (extra || []).filter((c) => c !== main);

    box.innerHTML = state.categories
      .filter((c) => c.id !== main)
      .map((c) =>
        '<label><input type="checkbox" value="' + esc(c.id) + '"' +
        (picked.includes(c.id) ? ' checked' : '') + '> ' + esc(c.title) + '</label>'
      )
      .join('') || '<p class="ao-note">Інших категорій поки немає.</p>';
  }

  function pickedExtraCats() {
    return Array.prototype.map.call(
      document.querySelectorAll('#fExtraCats input:checked'), (i) => i.value);
  }

  function renderSizeChecks(sizes) {
    $('fSizes').innerHTML = ALL_SIZES
      .map((s) =>
        '<label><input type="checkbox" value="' + s + '"' + ((sizes || []).includes(s) ? ' checked' : '') + '> ' + s + '</label>'
      )
      .join('');
  }

  /* Кольори у двох форматах: старий рядок і новий {hex, id} */
  function adminColors(p) {
    return ((p && p.colors) || []).map((c) =>
      typeof c === 'string' ? { hex: c, id: '' } : { hex: c.hex || '', id: c.id || '' }
    ).filter((c) => c.hex);
  }

  /* Колір + картка того самого товару в цьому кольорі.
     Вибір — власний випадаючий список із фото: нативний select
     зображень не вміє. У списку лише товари ГОЛОВНОЇ категорії
     редагованого товару. Панель позиціонується фіксовано, тож
     прокрутка модалки її не обрізає. */

  /* input[type=color] приймає лише #rrggbb — розгортаємо
     скорочену форму й відкидаємо все, що не hex */
  function normalizeHex(v) {
    const h = String(v || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(h)) return h.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(h)) {
      return ('#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]).toLowerCase();
    }
    return '';
  }

  function colorTriggerHTML(id) {
    const p = id ? state.products.find((x) => x.id === id) : null;
    if (!p) {
      return '<span class="a-colorpick__ph">— без привʼязки —</span>' +
        '<i class="a-colorpick__caret">▾</i>';
    }
    return '<img src="' + esc((p.images && p.images[0]) || '') + '" alt="" loading="lazy"' +
        ' onerror="this.style.visibility=\'hidden\'">' +
      '<span><b>' + esc(p.name) + '</b><em>' + esc(p.id) + '</em></span>' +
      '<i class="a-colorpick__caret">▾</i>';
  }

  function addColorRow(value) {
    const c = typeof value === 'string' ? { hex: value, id: '' } : (value || {});

    const row = document.createElement('div');
    row.className = 'a-color';
    row.innerHTML =
      '<input type="color" value="' + esc(c.hex || '#014AAD') + '">' +
      '<button type="button" class="a-colorpick" data-color-pid data-ref="' + esc(c.id || '') + '" ' +
        'aria-haspopup="listbox">' + colorTriggerHTML(c.id || '') + '</button>' +
      '<button type="button" class="a-color__del" title="Прибрати колір" aria-label="Прибрати колір">✕</button>';

    row.querySelector('.a-color__del').addEventListener('click', () => {
      closeColorDrop();
      row.remove();
      updatePreview();
    });

    $('fColors').appendChild(row);
  }

  /* ---------- Випадаюча панель ---------- */

  let colorDropFor = null; // тригер, для якого відкрито список

  function colorDropEl() {
    let el = document.getElementById('colorDropdown');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'colorDropdown';
    el.className = 'a-colordrop';
    el.hidden = true;
    document.body.appendChild(el);

    // mousedown, а не click — інакше blur/клік повз встигають
    // закрити панель до вибору
    el.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('[data-pick-id]');
      if (!opt) return;
      e.preventDefault();
      if (colorDropFor) {
        colorDropFor.dataset.ref = opt.dataset.pickId;
        colorDropFor.innerHTML = colorTriggerHTML(opt.dataset.pickId);

        // Підтягуємо колір самого товару: перший з його палітри.
        // Якщо у товару кольорів немає — свотч не чіпаємо.
        const target = state.products.find((x) => x.id === opt.dataset.pickId);
        const hex = target ? normalizeHex((adminColors(target)[0] || {}).hex) : '';
        if (hex) {
          const swatch = colorDropFor.closest('.a-color')
            .querySelector('input[type="color"]');
          if (swatch) swatch.value = hex;
        }

        updatePreview();
      }
      closeColorDrop();
    });

    return el;
  }

  function closeColorDrop() {
    const el = document.getElementById('colorDropdown');
    if (el) el.hidden = true;
    colorDropFor = null;
  }

  function openColorDrop(trigger) {
    const el = colorDropEl();
    const mainCat = $('fCategory').value;
    const cur = $('fId').value.trim();

    const items = state.products.filter((x) => x.id !== cur && inCat(x, mainCat));

    el.innerHTML =
      '<button type="button" class="a-colordrop__none" data-pick-id="">— без привʼязки —</button>' +
      (items.length
        ? items.map((x) =>
            '<button type="button" class="a-colordrop__opt' +
              (trigger.dataset.ref === x.id ? ' is-active' : '') + '" ' +
              'data-pick-id="' + esc(x.id) + '">' +
              '<img src="' + esc((x.images && x.images[0]) || '') + '" alt="" loading="lazy"' +
                ' onerror="this.style.visibility=\'hidden\'">' +
              '<span><b>' + esc(x.name) + '</b>' +
                '<em>' + esc(x.id) + ' · ' + fmt(x.price) + ' грн</em></span>' +
            '</button>').join('')
        : '<p class="a-colordrop__empty">У категорії «' + esc(catTitle(mainCat)) +
            '» немає інших товарів.</p>');

    // панель фіксована: рахуємо місце від тригера, вниз чи вгору
    const r = trigger.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    el.hidden = false;
    el.style.left = r.left + 'px';
    el.style.width = r.width + 'px';
    if (below > 220 || below >= r.top) {
      el.style.top = (r.bottom + 4) + 'px';
      el.style.bottom = 'auto';
      el.style.maxHeight = Math.max(160, Math.min(340, below - 12)) + 'px';
    } else {
      el.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      el.style.top = 'auto';
      el.style.maxHeight = Math.max(160, Math.min(340, r.top - 12)) + 'px';
    }
    colorDropFor = trigger;
  }

  function openEditor(product) {
    editingId = product ? product.id : null;
    $('editorTitle').textContent = product ? 'Редагувати: ' + product.name : 'Новий товар';

    const p = product || {};
    $('fId').value = p.id || '';
    $('fName').value = p.name || '';
    setUploadStatus('', '');
    const mainCat = p.category || (currentCat !== 'all' ? currentCat : (state.categories[0] || {}).id);
    fillCategorySelect(mainCat);
    renderExtraCats(mainCat, prodCats(p));
    $('fPrice').value = p.price != null ? p.price : '';
    $('fOldPrice').value = p.oldPrice != null ? p.oldPrice : '';
    $('fPriceUsd').value = p.priceUsd != null ? p.priceUsd : '';
    $('fStatus').value = p.status || 'in-stock';
    $('fLowStock').value = (p.lowStock || []).join(', ');
    renderSizeChecks(p.sizes);
    $('fSale').checked = !!p.sale;
    $('fHidden').checked = !!p.hidden;
    $('fSaleNote').value = p.saleNote || '';
    $('fFabric').value = p.fabric || '';
    $('fMaterial').value = p.material || '';
    $('fVolume').value = p.volume || '';
    $('fAroma').value = p.aroma || '';
    $('fModel').value = p.model || '';
    $('fColors').innerHTML = '';
    (p.colors || []).forEach(addColorRow);
    editImages = (p.images || []).slice();
    renderPhotos();
    $('fNotes').value = (p.notes || []).join('\n');
    $('fCharacteristics').value = (p.characteristics || []).join('\n');
    $('fCare').value = (p.care || []).join('\n');

    updatePreview();
    openModal($('editorModal'));
  }

  function collectForm() {
    const p = {
      id: $('fId').value.trim(),
      category: $('fCategory').value,
      name: $('fName').value.trim(),
      price: Number($('fPrice').value) || 0,
      status: $('fStatus').value
    };

    const oldPrice = Number($('fOldPrice').value);
    if (oldPrice) p.oldPrice = oldPrice;
    const usd = Number($('fPriceUsd').value);
    if (usd) p.priceUsd = usd;

    // Головна категорія завжди перша у списку — так товар
    // не загубиться, навіть якщо додаткові приберуть
    const extra = pickedExtraCats().filter((c) => c && c !== p.category);
    if (extra.length) p.categories = [p.category].concat(extra);

    const low = $('fLowStock').value.split(',').map((s) => s.trim()).filter(Boolean);
    if (low.length) p.lowStock = low;

    if ($('fSale').checked) p.sale = true;
    if ($('fHidden').checked) p.hidden = true;
    if ($('fSaleNote').value.trim()) p.saleNote = $('fSaleNote').value.trim();

    p.sizes = Array.prototype.map.call(
      document.querySelectorAll('#fSizes input:checked'),
      (i) => i.value
    );

    if ($('fFabric').value.trim()) p.fabric = $('fFabric').value.trim();
    if ($('fMaterial').value.trim()) p.material = $('fMaterial').value.trim();
    if ($('fVolume').value.trim()) p.volume = $('fVolume').value.trim();
    if ($('fAroma').value.trim()) p.aroma = $('fAroma').value.trim();
    if ($('fModel').value.trim()) p.model = $('fModel').value.trim();

    const colors = Array.prototype.map.call(
      document.querySelectorAll('#fColors .a-color'),
      (row) => {
        const hex = row.querySelector('input[type="color"]').value;
        const link = row.querySelector('[data-color-pid]');
        const id = link ? (link.dataset.ref || '') : '';
        // без прив'язки лишаємо простий рядок — так data.js
        // не роздувається обʼєктами там, де вони не потрібні
        return id ? { hex: hex, id: id } : hex;
      }
    );
    if (colors.length) p.colors = colors;

    p.images = editImages.slice();
    const notes = lines($('fNotes').value);
    if (notes.length) p.notes = notes;
    const chars = lines($('fCharacteristics').value);
    if (chars.length) p.characteristics = chars;
    const care = lines($('fCare').value);
    if (care.length) p.care = care;

    return p;
  }

  /* ---------- Фото: Firebase Storage ----------
     Фото живуть у хмарному сховищі проєкту (Firebase Storage),
     а не в репозиторії. Перед відправкою зменшуємо й переганяємо
     у WebP: оригінали з телефона важать по 4–6 МБ.
     Заливаємо простим REST-запитом з токеном адміна — правила
     сховища (new/storage.rules) пускають на запис лише адмінів. */

  const STORAGE_BUCKET = 'reyter-18d2c.firebasestorage.app';
  const MAX_SIDE = 1600;

  /* Фото товару, який зараз у редакторі. Порядок важливий:
     перше — обкладинка, друге показується при наведенні. */
  let editImages = [];

  function fileToImage(src) {
    return new Promise((resolve, reject) => {
      const url = typeof src === 'string' ? src : URL.createObjectURL(src);
      const img = new Image();
      img.onload = () => {
        if (typeof src !== 'string') URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        if (typeof src !== 'string') URL.revokeObjectURL(url);
        reject(new Error('Не вдалося прочитати зображення'));
      };
      img.src = url;
    });
  }

  async function toWebp(src) {
    const img = await fileToImage(src);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale) || 1;
    const h = Math.round(img.height * scale) || 1;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.82));
    if (!blob) throw new Error('Браузер не вміє WebP');
    return blob;
  }

  function slugFile(name) {
    return String(name).toLowerCase()
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'photo';
  }

  function ghToken() {
    return (localStorage.getItem(KEY_TOKEN) || '').trim();
  }

  /* Заливає blob у Storage і повертає публічний URL.
     Читання за правилами відкрите, тож токен у посиланні
     не потрібен — URL стабільний і чистий. */
  async function storageUpload(path, blob) {
    const user = R.fb.auth.currentUser;
    if (!user) throw new Error('Увійдіть акаунтом адміністратора');
    const idToken = await user.getIdToken();

    const res = await fetch(
      'https://firebasestorage.googleapis.com/v0/b/' + STORAGE_BUCKET +
        '/o?name=' + encodeURIComponent(path),
      {
        method: 'POST',
        headers: {
          Authorization: 'Firebase ' + idToken,
          'Content-Type': 'image/webp'
        },
        body: blob
      }
    );
    if (res.status === 401 || res.status === 403) {
      throw new Error('Сховище не пускає: вставте правила з файлу new/storage.rules у Firebase Console → Storage → Rules');
    }
    if (!res.ok) throw new Error('Сховище відповіло кодом ' + res.status);

    return 'https://firebasestorage.googleapis.com/v0/b/' + STORAGE_BUCKET +
      '/o/' + encodeURIComponent(path) + '?alt=media';
  }

  function storagePath(article, n, name) {
    const dir = (article || 'misc').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'misc';
    return 'products/' + dir + '/' + Date.now() + '-' + n + '-' + slugFile(name) + '.webp';
  }

  function setUploadStatus(cls, text) {
    const el = $('fUploadStatus');
    if (!el) return;
    el.className = 'a-upload__status ' + (cls || '');
    el.textContent = text || '';
  }

  /* ---------- Мініатюри в редакторі ---------- */

  function renderPhotos() {
    const box = $('fPhotos');
    if (!box) return;

    box.innerHTML = editImages.length
      ? editImages.map((src, i) =>
          '<figure class="a-photo" data-i="' + i + '">' +
            '<img src="' + esc(src) + '" alt="" loading="lazy" ' +
              'onerror="this.style.visibility=\'hidden\'">' +
            (i === 0 ? '<figcaption>обкладинка</figcaption>' : '') +
            (i === 1 ? '<figcaption>при наведенні</figcaption>' : '') +
            '<span class="a-photo__tools">' +
              (i > 0 ? '<button type="button" data-ph="left" title="Пересунути вліво" aria-label="Пересунути вліво">←</button>' : '') +
              (i < editImages.length - 1 ? '<button type="button" data-ph="right" title="Пересунути вправо" aria-label="Пересунути вправо">→</button>' : '') +
              '<button type="button" data-ph="del" class="danger" title="Прибрати фото" aria-label="Прибрати фото">✕</button>' +
            '</span>' +
          '</figure>'
        ).join('')
      : '<p class="a-photos__empty">Фото ще немає — завантажте перше.</p>';
  }

  async function uploadPhotos(files) {
    if (!files.length) return;
    const article = $('fId').value.trim();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadStatus('wait', 'Готуємо ' + (i + 1) + ' з ' + files.length + '…');

      let blob;
      try {
        blob = await toWebp(file);
      } catch (e) {
        setUploadStatus('err', 'Не вдалося обробити «' + file.name + '»');
        return;
      }

      setUploadStatus('wait', 'Вивантажуємо ' + (i + 1) + ' з ' + files.length +
        ' (' + Math.round(blob.size / 1024) + ' КБ)…');

      try {
        const url = await storageUpload(storagePath(article, i + 1, file.name), blob);
        editImages.push(url);
        renderPhotos();
        updatePreview();
      } catch (e) {
        setUploadStatus('err', e.message || 'Не вдалося завантажити');
        return;
      }
    }

    setUploadStatus('ok', 'Додано фото: ' + files.length + ' ✓');
  }

  /* ---------- Разова міграція старих фото у сховище ----------
     Наявні картки посилаються на файли репозиторію
     (../assets/…). Тягнемо кожне з сайту, переганяємо у WebP,
     заливаємо у Storage і оновлюємо ЧЕРНЕТКУ — сайт побачить
     нові адреси після публікації, а до того працює як працював. */

  async function migratePhotos() {
    if (!seeded) return;

    const mig = await R.fb.db.collection('settings').doc('migrations').get()
      .catch(() => null);
    if (mig && mig.exists && mig.data().photosToStorage) return;

    const isOld = (src) => !/^https?:/i.test(String(src || ''));
    const todo = state.products.filter((p) => (p.images || []).some(isOld));

    if (!todo.length) {
      await R.fb.db.collection('settings').doc('migrations')
        .set({ photosToStorage: true }, { merge: true });
      return;
    }

    const total = todo.reduce((n, p) => n + p.images.filter(isOld).length, 0);
    let done = 0;
    let failed = 0;

    const bar = document.createElement('div');
    bar.className = 'a-migbar';
    bar.textContent = 'Переносимо фото у хмарне сховище… 0 з ' + total;
    document.body.appendChild(bar);

    const batch = R.fb.db.batch();
    const changedIds = [];

    for (const p of todo) {
      const fresh = [];
      let touched = false;

      for (let i = 0; i < p.images.length; i++) {
        const src = p.images[i];
        if (!isOld(src)) { fresh.push(src); continue; }
        try {
          const blob = await toWebp(src);
          const url = await storageUpload(storagePath(p.id, i + 1, src.split('/').pop() || 'photo'), blob);
          fresh.push(url);
          touched = true;
        } catch (e) {
          fresh.push(src); // не вдалося — лишаємо старий шлях
          failed++;
        }
        done++;
        bar.textContent = 'Переносимо фото у хмарне сховище… ' + done + ' з ' + total;
      }

      if (touched) {
        p.images = fresh;
        batch.update(prodCol().doc(p.id), { images: fresh });
        changedIds.push(p.id);
      }
    }

    bar.remove();

    if (changedIds.length) {
      await batch.commit();
      render();
    }

    if (failed) {
      toast('Фото перенесено частково (' + failed + ' не вдалося) — спробуємо докінчити наступного разу');
      return; // маркер не ставимо, щоб доробити решту
    }

    await R.fb.db.collection('settings').doc('migrations')
      .set({ photosToStorage: true }, { merge: true });

    if (changedIds.length) {
      toast('Фото перенесено у хмарне сховище ✓ Опублікуйте зміни', 'success');
    }
  }

  function updatePreview() {
    const p = collectForm();
    const dots = adminColors(p)
      .map((c) => '<span class="dot" style="background-color:' + esc(c.hex) + '"></span>')
      .join('');
    const badges = [];
    if (p.status === 'sold-out') badges.push('<span class="badge badge--sold">Продано</span>');
    else if (p.sale) badges.push('<span class="badge badge--sale">Sale</span>');

    let price = '<span class="price__now">' + fmt(p.price) + ' грн</span>';
    if (p.oldPrice) price += '<del class="price__old">' + fmt(p.oldPrice) + ' грн</del>';
    if (p.priceUsd) price += '<span class="price__usd">≈ ' + p.priceUsd + ' $</span>';

    $('previewCard').innerHTML =
      '<div class="pcard' + (p.sale ? ' pcard--sale' : '') + (p.status === 'sold-out' ? ' pcard--sold' : '') + '">' +
        '<span class="pcard__media">' +
          (p.images[0] ? '<img src="' + esc(p.images[0]) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '') +
          (badges.length ? '<span class="pcard__badges">' + badges.join('') + '</span>' : '') +
        '</span>' +
        '<span class="pcard__body">' +
          '<span class="pcard__title">' + esc(p.name || 'Назва товару') + dots + '</span>' +
          '<span class="pcard__price">' + price + '</span>' +
        '</span>' +
      '</div>';
  }

  async function saveProduct() {
    const p = collectForm();

    if (!p.id) return toast('Вкажіть артикул');
    if (!p.name) return toast('Вкажіть назву');
    if (!p.price) return toast('Вкажіть ціну');
    if (!p.category) return toast('Створіть категорію');
    if (!p.images.length) return toast('Додайте хоча б одне фото');

    const clash = state.products.find((x) => x.id === p.id && x.id !== editingId);
    if (clash) return toast('Артикул ' + p.id + ' вже використовується');

    const existing = editingId ? state.products.find((x) => x.id === editingId) : null;
    p.order = existing ? (Number(existing.order) || 0) : maxOrder(state.products) + 10;

    try {
      if (existing && editingId !== p.id) {
        // артикул змінено — переносимо документ
        const batch = R.fb.db.batch();
        batch.delete(prodCol().doc(editingId));
        batch.set(prodCol().doc(p.id), prodDocData(p));
        await batch.commit();
      } else {
        await prodCol().doc(p.id).set(prodDocData(p));
      }

      if (existing) {
        state.products[state.products.indexOf(existing)] = p;
      } else {
        state.products.push(p);
      }

      render();
      closeModal($('editorModal'));
      toast(existing ? 'Товар збережено в чернетку ✓' : 'Товар додано в чернетку ✓', 'success');
      editingId = null;
    } catch (e) {
      toast('Не вдалося зберегти. Увійдіть акаунтом адміністратора');
    }
  }

  /* ---------- data.js: завантаження та резервна копія ---------- */

  function buildDataJs(snap) {
    const src = snap || state;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const cats = src.categories.map((c) => {
      const out = { id: c.id, title: c.title, order: c.order };
      if (c.titleEn) out.titleEn = c.titleEn;
      return out;
    });
    return (
      '/* ============================================================\n' +
      '   REYTER — резервна копія каталогу\n' +
      '   Згенеровано адмінкою ' + stamp + '\n' +
      '   Сайт показує ці дані, поки завантажується база (Firestore).\n' +
      '   ============================================================ */\n\n' +
      'window.REYTER = window.REYTER || {};\n\n' +
      'REYTER.config = ' + JSON.stringify(R.config, null, 2) + ';\n\n' +
      'REYTER.categories = ' + JSON.stringify(cats, null, 2) + ';\n\n' +
      'REYTER.products = ' + JSON.stringify(src.products, null, 2) + ';\n'
    );
  }

  function downloadDataJs() {
    const blob = new Blob([buildDataJs()], { type: 'text/javascript;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'data.js';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Файл data.js завантажено', 'success');
  }

  function setPublishStatus(cls, text) {
    const el = $('publishStatus');
    el.hidden = false;
    el.className = 'a-publish__status ' + cls;
    el.textContent = text;
  }

  function b64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  /* ============================================================
     ПУБЛІКАЦІЯ
     ------------------------------------------------------------
     Чернетка (колекції catalog_*) → знімок published/catalog,
     який читає сайт. Запланована версія лежить у published/next
     і вмикається сама, щойно годинник покупця перейде publishAt.
     ============================================================ */

  let published = null;      // чинна опублікована версія
  let scheduledDoc = null;   // запланована (published/next)
  let pubBusy = false;

  function pubCol() {
    return R.fb.db.collection('published');
  }

  /* Стабільний JSON: ключі відсортовані, undefined відкинуто —
     інакше однакові дані з різних джерел «відрізняються» */
  function stableStr(o) {
    if (Array.isArray(o)) return '[' + o.map(stableStr).join(',') + ']';
    if (o && typeof o === 'object') {
      return '{' + Object.keys(o).sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + stableStr(o[k]))
        .join(',') + '}';
    }
    return JSON.stringify(o === undefined ? null : o);
  }

  function snapshotDraft() {
    return {
      categories: JSON.parse(JSON.stringify(state.categories)),
      products: JSON.parse(JSON.stringify(state.products))
    };
  }

  function draftDiffers() {
    if (!seeded || !state.products.length) return false;
    if (!published) return true;
    return stableStr({ c: state.categories, p: state.products }) !==
           stableStr({ c: published.categories || [], p: published.products || [] });
  }

  function scheduledStale() {
    if (!scheduledDoc) return false;
    return stableStr({ c: state.categories, p: state.products }) !==
           stableStr({ c: scheduledDoc.categories || [], p: scheduledDoc.products || [] });
  }

  function refreshPublishBadge() {
    const differs = draftDiffers();
    const badge = $('publishBadge');
    if (badge) badge.hidden = !differs && !scheduledDoc;
    const more = document.getElementById('abarMoreBtn');
    if (more) more.classList.toggle('has-draft', differs || !!scheduledDoc);
  }

  async function loadPublished() {
    if (!fbOk()) return;
    try {
      const res = await Promise.all([
        pubCol().doc('catalog').get(),
        pubCol().doc('next').get()
      ]);
      published = res[0].exists ? res[0].data() : null;
      scheduledDoc = res[1].exists ? res[1].data() : null;
    } catch (e) { /* правила ще не оновлені — працюємо по-старому */ }
    refreshPublishBadge();
  }

  /* Прибирання при вході адміна:
     1) запланована версія, чий час настав, стає чинною;
     2) якщо публікацій ще не було — фіксуємо поточний стан,
        щоб сайт показував рівно те саме, що й досі;
     3) разова міграція структури категорій у чернетці. */
  async function housekeeping() {
    if (!fbOk() || !R.fb.user) return;
    try {
      if (scheduledDoc && Number(scheduledDoc.publishAt) <= Date.now()) {
        const snap = {
          categories: scheduledDoc.categories || [],
          products: scheduledDoc.products || []
        };
        await pubCol().doc('catalog').set(Object.assign({}, snap, {
          publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
          publishedBy: scheduledDoc.scheduledBy || ''
        }));
        await pubCol().doc('next').delete();
        published = snap;
        scheduledDoc = null;
        backupDataJs(snap);
      }

      if (!published && seeded && state.products.length) {
        const snap = snapshotDraft();
        await pubCol().doc('catalog').set(Object.assign({}, snap, {
          publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
          publishedBy: (R.fb.user && R.fb.user.email) || ''
        }));
        published = snap;
      }

      await migrateStructure();
      await migratePhotos();
    } catch (e) {
      // не ламаємо адмінку, але і не мовчимо — інакше причину
      // не знайти (typово: правила бази ще не оновлені)
      if (window.console) console.warn('Прибирання при вході не завершилось:', e);
    }
    refreshPublishBadge();
  }

  /* ---------- Діалог публікації ---------- */

  function fmtWhen(ts) {
    return new Date(Number(ts)).toLocaleString('uk-UA', {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
    });
  }

  function toLocalInput(d) {
    const p2 = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  function fewNames(list) {
    const names = list.slice(0, 3).map((x) => x.title || x.name || x.id);
    return names.join(', ') + (list.length > 3 ? '…' : '');
  }

  function diffSummary() {
    const pub = published || { categories: [], products: [] };
    const pubP = {};
    const pubC = {};
    (pub.products || []).forEach((p) => { pubP[p.id] = p; });
    (pub.categories || []).forEach((c) => { pubC[c.id] = c; });

    const addedP = state.products.filter((p) => !pubP[p.id]);
    const removedP = (pub.products || []).filter((p) => !state.products.some((x) => x.id === p.id));
    const changedP = state.products.filter((p) => pubP[p.id] && stableStr(p) !== stableStr(pubP[p.id]));
    const addedC = state.categories.filter((c) => !pubC[c.id]);
    const removedC = (pub.categories || []).filter((c) => !state.categories.some((x) => x.id === c.id));
    const changedC = state.categories.filter((c) => pubC[c.id] && stableStr(c) !== stableStr(pubC[c.id]));

    const lines = [];
    if (addedP.length) lines.push('нові товари — ' + addedP.length + ': ' + fewNames(addedP));
    if (changedP.length) lines.push('змінені товари — ' + changedP.length + ': ' + fewNames(changedP));
    if (removedP.length) lines.push('видалені товари — ' + removedP.length + ': ' + fewNames(removedP));
    if (addedC.length) lines.push('нові категорії: ' + fewNames(addedC));
    if (changedC.length) lines.push('змінені категорії: ' + fewNames(changedC));
    if (removedC.length) lines.push('видалені категорії: ' + fewNames(removedC));
    if (!lines.length) lines.push('зміни порядку або службових полів');
    return lines;
  }

  function renderPublishDialog() {
    const sum = $('pubSummary');
    const differs = draftDiffers();

    if (!published) {
      sum.innerHTML = '<p class="a-pub__lead">Перша публікація: чернетка стане версією, яку бачать покупці.</p>';
    } else if (!differs) {
      sum.innerHTML = '<p class="a-pub__lead is-ok">✓ Сайт показує актуальну версію — неопублікованих змін немає.</p>';
    } else {
      sum.innerHTML =
        '<p class="a-pub__lead">Неопубліковані зміни:</p>' +
        '<ul class="a-pub__diff">' +
          diffSummary().map((l) => '<li>' + esc(l) + '</li>').join('') +
        '</ul>';
    }

    const box = $('pubSchedInfo');
    if (scheduledDoc) {
      box.hidden = false;
      box.innerHTML =
        '🕒 Заплановано на <b>' + esc(fmtWhen(scheduledDoc.publishAt)) + '</b>. ' +
        'У цей момент сайт сам перейде на збережену версію.' +
        (scheduledStale()
          ? '<br><b>Чернетка змінилася після планування.</b> Заплануйте знову або опублікуйте зараз, щоб узяти свіжі зміни.'
          : '') +
        '<br><button class="a-linklike" id="pubCancelBtn" type="button">Скасувати заплановану публікацію</button>';
    } else {
      box.hidden = true;
      box.innerHTML = '';
    }

    $('doPublishBtn').disabled = !differs && !scheduledDoc && !!published;
    $('pubWhenBox').hidden = true;
    $('pubScheduleBtn').textContent = 'Запланувати…';
  }

  /* ---------- Дії ---------- */

  async function publishNow() {
    if (pubBusy) return;
    pubBusy = true;
    setPublishStatus('wait', 'Публікуємо…');
    try {
      const snap = snapshotDraft();
      await pubCol().doc('catalog').set(Object.assign({}, snap, {
        publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
        publishedBy: (R.fb.user && R.fb.user.email) || ''
      }));
      try { await pubCol().doc('next').delete(); } catch (e) { /* його могло не бути */ }
      published = snap;
      scheduledDoc = null;
      renderPublishDialog();
      refreshPublishBadge();
      setPublishStatus('ok', 'Опубліковано ✓ Сайт уже показує нову версію');
      toast('Опубліковано ✓', 'success');
      backupDataJs(snap);
    } catch (e) {
      setPublishStatus('err', 'Не вдалося опублікувати. Перевірте правила Firestore — потрібен блок published');
    }
    pubBusy = false;
  }

  async function schedulePublish(ts) {
    if (pubBusy) return;
    pubBusy = true;
    setPublishStatus('wait', 'Зберігаємо розклад…');
    try {
      const snap = snapshotDraft();
      await pubCol().doc('next').set(Object.assign({}, snap, {
        publishAt: ts,
        scheduledAt: firebase.firestore.FieldValue.serverTimestamp(),
        scheduledBy: (R.fb.user && R.fb.user.email) || ''
      }));
      scheduledDoc = Object.assign({}, snap, { publishAt: ts });
      renderPublishDialog();
      refreshPublishBadge();
      setPublishStatus('ok', 'Заплановано на ' + fmtWhen(ts) +
        ' ✓ Сайт перейде на нову версію сам — тримати адмінку відкритою не треба');
      toast('Публікацію заплановано ✓', 'success');
    } catch (e) {
      setPublishStatus('err', 'Не вдалося запланувати. Перевірте правила Firestore — потрібен блок published');
    }
    pubBusy = false;
  }

  async function cancelSchedule() {
    try {
      await pubCol().doc('next').delete();
      scheduledDoc = null;
      renderPublishDialog();
      refreshPublishBadge();
      setPublishStatus('ok', 'Заплановану публікацію скасовано');
    } catch (e) {
      setPublishStatus('err', 'Не вдалося скасувати — спробуйте ще раз');
    }
  }

  /* Резервний data.js у репозиторії: сайт показує його першим,
     поки вантажиться база. Публікація від GitHub не залежить —
     це фонове оновлення запасного джерела. */
  async function backupDataJs(snap) {
    const note = $('pubBackupStatus');
    const fromField = $('ghToken') ? $('ghToken').value.trim() : '';
    const token = fromField || ghToken();
    if (!token) {
      if (note) note.textContent = 'Резервний data.js не оновлено: не збережено GitHub-токен (поле вище).';
      return;
    }
    localStorage.setItem(KEY_TOKEN, token);

    const api = 'https://api.github.com/repos/' + GH.owner + '/' + GH.repo + '/contents/' + GH.path;
    const headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    };

    try {
      if (note) note.textContent = 'Оновлюємо резервний data.js…';
      const getRes = await fetch(api + '?ref=' + GH.branch, { headers: headers });
      if (getRes.status === 401 || getRes.status === 403) {
        localStorage.removeItem(KEY_TOKEN);
        if (note) note.textContent = 'Резервний data.js не оновлено: токен не має дозволу Contents: Read and write.';
        return;
      }
      if (!getRes.ok) {
        if (note) note.textContent = 'Резервний data.js не оновлено (GitHub відповів ' + getRes.status + ').';
        return;
      }
      const info = await getRes.json();

      const putRes = await fetch(api, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify({
          message: 'Публікація каталогу з адмінки',
          content: b64(buildDataJs(snap)),
          sha: info.sha,
          branch: GH.branch
        })
      });
      if (note) {
        note.textContent = putRes.ok
          ? 'Резервний data.js оновлено ✓'
          : 'Резервний data.js не оновлено (GitHub відповів ' + putRes.status + ').';
      }
    } catch (e) {
      if (note) note.textContent = 'Резервний data.js не оновлено — немає звʼязку з GitHub.';
    }
  }


  /* ---------- Події ---------- */

  let catalogReady = null;

  function init() {
    catalogReady = loadCatalog();
    initCatDrag();

    // Категорії
    $('catList').addEventListener('click', (e) => {
      const li = e.target.closest('.a-cat');
      if (!li) return;
      const id = li.dataset.id;
      const act = e.target.closest('button') ? e.target.closest('button').dataset.act : null;

      if (!act) {
        currentCat = id;
        render();
        return;
      }

      const idx = state.categories.findIndex((c) => c.id === id);
      const cat = state.categories[idx];

      if (act === 'rename') {
        const name = prompt('Нова назва категорії:', cat.title);
        if (name && name.trim()) renameCategory(cat, name.trim());
      } else if (act === 'del') {
        if (countIn(id)) {
          toast('Спершу перенесіть або видаліть товари з цієї категорії');
          return;
        }
        if (confirm('Видалити категорію «' + cat.title + '»?')) deleteCategory(idx);
      }
    });

    $('addCatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('newCatName');
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      addCategory(name);
    });

    // Товари
    $('productList').addEventListener('click', async (e) => {
      if (e.target.id === 'seedBtn') {
        seedCatalog();
        return;
      }

      const item = e.target.closest('.a-item');
      const btn = e.target.closest('button');
      if (!item || !btn) return;

      const id = item.dataset.id;
      const idx = state.products.findIndex((p) => p.id === id);
      const p = state.products[idx];

      if (btn.dataset.act === 'edit') {
        openEditor(p);
      } else if (btn.dataset.act === 'dup') {
        const copy = JSON.parse(JSON.stringify(p));
        let n = 2;
        while (state.products.some((x) => x.id === copy.id + '-' + n)) n++;
        copy.id = copy.id + '-' + n;
        copy.name = copy.name + ' (копія)';
        copy.order = (Number(p.order) || 0) + 1;
        try {
          await prodCol().doc(copy.id).set(prodDocData(copy));
          state.products.splice(idx + 1, 0, copy);
          render();
        } catch (err) {
          toast('Немає прав');
        }
      } else if (btn.dataset.act === 'toggle') {
        const hidden = !p.hidden;
        try {
          await prodCol().doc(p.id).update({ hidden: hidden });
          if (hidden) p.hidden = true;
          else delete p.hidden;
          render();
        } catch (err) {
          toast('Немає прав');
        }
      } else if (btn.dataset.act === 'del') {
        if (confirm('Видалити товар «' + p.name + '» (' + p.id + ')?')) {
          try {
            await prodCol().doc(p.id).delete();
            state.products.splice(idx, 1);
            render();
          } catch (err) {
            toast('Немає прав');
          }
        }
      }
    });

    const upload = $('fUpload');
    if (upload) {
      upload.addEventListener('change', () => {
        uploadPhotos(Array.prototype.slice.call(upload.files));
        upload.value = ''; // щоб той самий файл можна було вибрати вдруге
      });
    }

    $('fColors').addEventListener('click', (e) => {
      const t = e.target.closest('.a-colorpick');
      if (!t) return;
      if (colorDropFor === t) closeColorDrop();
      else openColorDrop(t);
    });

    document.addEventListener('click', (e) => {
      if (colorDropFor &&
          !e.target.closest('#colorDropdown') &&
          !e.target.closest('.a-colorpick')) {
        closeColorDrop();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeColorDrop();
    });

    // прокрутка зсуває тригер під фіксованою панеллю — закриваємо;
    // власна прокрутка панелі не рахується
    document.addEventListener('scroll', (e) => {
      if (!colorDropFor) return;
      const drop = document.getElementById('colorDropdown');
      if (drop && e.target !== drop && !(e.target.nodeType === 1 && drop.contains(e.target))) {
        closeColorDrop();
      }
    }, true);

    $('fPhotos').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ph]');
      if (!btn) return;
      const i = Number(btn.closest('.a-photo').dataset.i);
      if (btn.dataset.ph === 'del') {
        editImages.splice(i, 1);
      } else {
        const j = btn.dataset.ph === 'left' ? i - 1 : i + 1;
        const t = editImages[i];
        editImages[i] = editImages[j];
        editImages[j] = t;
      }
      renderPhotos();
      updatePreview();
    });

    $('addProductBtn').addEventListener('click', () => {
      if (!state.categories.length) {
        toast('Спершу створіть категорію');
        return;
      }
      if (!seeded) {
        toast('Спершу імпортуйте каталог у базу (кнопка вгорі списку)');
        return;
      }
      openEditor(null);
    });

    // Редактор
    $('saveProductBtn').addEventListener('click', saveProduct);
    $('addColorBtn').addEventListener('click', () => {
      addColorRow();
      updatePreview();
    });
    $('productForm').addEventListener('input', updatePreview);
    $('productForm').addEventListener('change', (e) => {
      // Головна категорія не має дублюватись у «показувати також»
      if (e.target.id === 'fCategory') {
        renderExtraCats(e.target.value, pickedExtraCats());
        closeColorDrop();
      }
      updatePreview();
    });
    $('productForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveProduct();
    });

    // Експорт і резервна копія
    $('downloadBtn').addEventListener('click', downloadDataJs);

    $('publishBtn').addEventListener('click', () => {
      $('ghToken').value = localStorage.getItem(KEY_TOKEN) || '';
      $('publishStatus').hidden = true;
      $('pubBackupStatus').textContent = '';
      renderPublishDialog();
      openModal($('publishModal'));
    });

    $('doPublishBtn').addEventListener('click', publishNow);

    /* «Запланувати…» спершу відкриває вибір часу, другим кліком —
       зберігає розклад */
    $('pubScheduleBtn').addEventListener('click', () => {
      const box = $('pubWhenBox');
      if (box.hidden) {
        box.hidden = false;
        const d = new Date(Date.now() + 3600 * 1000);
        d.setMinutes(0, 0, 0);
        $('pubWhen').value = toLocalInput(d);
        $('pubWhen').min = toLocalInput(new Date());
        $('pubScheduleBtn').textContent = 'Запланувати';
        $('pubWhen').focus();
        return;
      }
      const val = $('pubWhen').value;
      const ts = val ? new Date(val).getTime() : NaN;
      if (!ts || isNaN(ts)) return setPublishStatus('err', 'Оберіть дату й час публікації');
      if (ts < Date.now() + 60 * 1000) {
        return setPublishStatus('err', 'Цей час уже минув — оберіть майбутній момент');
      }
      schedulePublish(ts);
    });

    $('publishModal').addEventListener('click', (e) => {
      if (e.target.id === 'pubCancelBtn') cancelSchedule();
    });

    /* Опубліковану версію вантажимо після входу: прибирання
       (просрочений розклад, перша публікація, міграція) вимагає
       прав адміністратора */
    document.addEventListener('auth:changed', () => {
      if (R.fb && R.fb.user) {
        Promise.resolve(catalogReady).then(loadPublished).then(housekeeping);
      }
    });

    // Закриття модалок
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) {
        const m = e.target.closest('.a-modal');
        if (m) closeModal(m);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.a-modal:not([hidden])').forEach(closeModal);
      }
    });
  }

  init();
})();

/* ============================================================
   МОДУЛЬ 2 — ХМАРНІ ПАНЕЛІ
   Гейт для адміністраторів, агрегатор замовлень, склад,
   налаштування (сповіщення + адміністратори)
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  /* Постійні адміністратори (продубльовано в правилах Firestore) */
  const FOUNDERS = [
    'kostia.movchanovskyi@gmail.com',
    'reyter.store1@gmail.com'
  ];

  const STATUSES = (R.config && R.config.orderStatuses) || [
    { id: 'new', title: 'Нове' },
    { id: 'confirmed', title: 'Підтверджено' },
    { id: 'shipped', title: 'Відправлено' },
    { id: 'done', title: 'Виконано' },
    { id: 'cancelled', title: 'Скасовано' }
  ];

  /* Статуси, за яких товар вважається списаним зі складу */
  const CONSUMING = ['confirmed', 'shipped', 'done'];

  /* Наступний крок у життєвому циклі — для кнопки швидкої дії */
  const NEXT_STEP = {
    new: { id: 'confirmed', label: 'Підтвердити' },
    confirmed: { id: 'shipped', label: 'Відправлено' },
    shipped: { id: 'done', label: 'Виконано' }
  };

  const LOW_AT = 2;
  const PAGE_SIZE = 25;          // скільки замовлень показуємо за раз
  const BULK_CHUNK = 20;         // розмір порції для масових дій

  const MOVE_REASONS = {
    manual: 'Ручне коригування',
    order: 'Списання під замовлення',
    'order-cancel': 'Повернення (скасування)',
    restock: 'Прихід товару'
  };

  const TRACK_URLS = {
    'Нова Пошта': 'https://novaposhta.ua/tracking/?cargo_number=',
    // старі замовлення можуть мати перевізників, які вже не пропонуються
    'Укрпошта': 'https://track.ukrposhta.ua/tracking_UA.aspx?barcode=',
    'Meest': 'https://meest.com/ua/tracking/?code='
  };

  const $id = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('uk-UA');
  }

  /* cart.js в адмінці не підключено, тож копіюємо самі */
  function copyText(text) {
    const done = () => toast('Скопійовано ✓', 'success');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
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
  }

  function toast(msg, type) {
    const wrap = $id('toasts');
    if (!wrap) return;
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'success' ? ' toast--success' : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 320);
    }, 2600);
  }

  function statusInfo(id) {
    return STATUSES.find((s) => s.id === id) || STATUSES[0];
  }

  function products() {
    return (R.adminGetState ? R.adminGetState() : { products: R.products }).products;
  }

  function categories() {
    return (R.adminGetState ? R.adminGetState() : { categories: R.categories }).categories;
  }

  /* Назва категорії — у цього модуля свій список категорій */
  function catName(id) {
    const c = categories().find((x) => x.id === id);
    return c ? c.title : (id || '');
  }

  function productById(id) {
    return products().find((p) => p.id === id) || null;
  }

  function isSized(p) {
    return !p.volume;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function localISO(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO() {
    return localISO(new Date());
  }

  function fbReady() {
    return R.fb && R.fb.enabled;
  }

  async function signInGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await R.fb.auth.signInWithPopup(provider);
    } catch (err) {
      const code = (err && err.code) || '';
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        const status = $id('gateStatus');
        if (status) status.textContent = 'Переходимо на сторінку входу Google…';
        try {
          await R.fb.auth.signInWithRedirect(provider);
          return;
        } catch (e2) {
          err = e2;
        }
      }
      const msg = R.fb.errorText(err);
      toast(msg);
      const status = $id('gateStatus');
      if (status && !$id('adminGate').hidden) status.textContent = msg;
    }
  }

  /* ============================================================
     ГЕЙТ: адмінка лише для адміністраторів
     ============================================================ */

  async function isAdminUser() {
    const user = R.fb && R.fb.user;
    if (!user || !user.email) return false;
    const email = user.email.toLowerCase();
    if (FOUNDERS.includes(email)) return true;
    try {
      const doc = await R.fb.db.collection('admins').doc(email).get();
      return doc.exists;
    } catch (e) {
      return false; // permission-denied → не адмін
    }
  }

  async function refreshGate() {
    const gate = $id('adminGate');
    const status = $id('gateStatus');
    const loginBtn = $id('gateLoginBtn');
    const logoutBtn = $id('gateLogoutBtn');
    if (!gate) return;

    if (!fbReady()) {
      gate.hidden = false;
      status.textContent = 'Firebase недоступний — перевірте інтернет або блокувальник реклами.';
      loginBtn.hidden = true;
      logoutBtn.hidden = true;
      return;
    }

    if (!R.fb.user) {
      gate.hidden = false;
      status.textContent = 'Доступ лише для адміністраторів магазину.';
      loginBtn.hidden = false;
      logoutBtn.hidden = true;
      return;
    }

    status.textContent = 'Перевіряємо доступ…';
    loginBtn.hidden = true;
    logoutBtn.hidden = true;

    const ok = await isAdminUser();
    if (ok) {
      gate.hidden = true;
      startCloud();
      showView();
    } else {
      gate.hidden = false;
      status.textContent = 'У акаунта ' + (R.fb.user.email || '') + ' немає прав адміністратора.';
      logoutBtn.hidden = false;
    }
  }

  /* ============================================================
     РОУТЕР: Каталог / Замовлення / Склад
     ============================================================ */

  const VIEWS = ['catalog', 'orders', 'stock', 'promos'];

  function currentView() {
    const v = (location.hash || '').replace(/^#\/?/, '');
    return VIEWS.includes(v) ? v : 'catalog';
  }

  function showView() {
    const v = currentView();
    $id('viewCatalog').hidden = v !== 'catalog';
    $id('viewOrders').hidden = v !== 'orders';
    $id('viewStock').hidden = v !== 'stock';
    $id('viewPromos').hidden = v !== 'promos';
    document.querySelectorAll('.abar__tab').forEach((t) => {
      t.classList.toggle('is-active', t.dataset.view === v);
    });
    if (v === 'orders') renderOrdersRoot();
    if (v === 'stock') renderStockRoot();
    if (v === 'promos') renderPromosRoot();
    window.scrollTo(0, 0);
  }

  function startCloud() {
    if (!ordersUnsub) subscribeOrders();
    if (!promosUnsub) subscribePromos();
    if (!invUnsub) {
      subscribeInventory();
      loadRestocks();
    }
  }

  function stopCloud() {
    stopOrders();
    stopStock();
    stopPromos();
  }

  /* ============================================================
     СКЛАД: кеш живих залишків
     ============================================================ */

  let inv = {};
  let invUnsub = null;

  function invOf(pid) {
    return inv[pid] || {};
  }

  function sizeQty(pid, size) {
    const s = invOf(pid).sizes || {};
    return Number(s[size]) || 0;
  }

  function unitQty(pid) {
    return Number(invOf(pid).qty) || 0;
  }

  function totalQty(p) {
    if (!isSized(p)) return unitQty(p.id);
    const s = invOf(p.id).sizes || {};
    return Object.keys(s).reduce((sum, k) => sum + (Number(s[k]) || 0), 0);
  }

  function hasInvDoc(pid) {
    return !!inv[pid];
  }

  function logMove(batch, entry) {
    const ref = R.fb.db.collection('stock_moves').doc();
    batch.set(ref, Object.assign({
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      by: (R.fb.user && R.fb.user.email) || ''
    }, entry));
  }

  function adjustOrderStock(batch, order, direction) {
    const grouped = {};
    (order.items || []).forEach((item) => {
      const p = productById(item.id);
      const delta = direction * (Number(item.qty) || 0);
      if (!delta) return;
      if (!grouped[item.id]) grouped[item.id] = { sizes: {}, qty: 0 };
      if (p && !isSized(p)) {
        grouped[item.id].qty += delta;
      } else if (item.size) {
        grouped[item.id].sizes[item.size] = (grouped[item.id].sizes[item.size] || 0) + delta;
      }
      logMove(batch, {
        productId: item.id,
        productName: item.name || item.id,
        size: item.size || null,
        delta: delta,
        reason: direction < 0 ? 'order' : 'order-cancel',
        ref: order.num || ''
      });
    });

    Object.keys(grouped).forEach((pid) => {
      const ref = R.fb.db.collection('inventory').doc(pid);
      const upd = { updated: firebase.firestore.FieldValue.serverTimestamp() };
      const g = grouped[pid];
      if (g.qty) upd.qty = firebase.firestore.FieldValue.increment(g.qty);
      const sizeKeys = Object.keys(g.sizes);
      if (sizeKeys.length) {
        upd.sizes = {};
        sizeKeys.forEach((s) => {
          upd.sizes[s] = firebase.firestore.FieldValue.increment(g.sizes[s]);
        });
      }
      batch.set(ref, upd, { merge: true });
    });
  }

  /* Чи вистачає залишків на замовлення (попередження перед підтвердженням) */
  function stockShortage(order) {
    const short = [];
    (order.items || []).forEach((item) => {
      const p = productById(item.id);
      if (!p || !hasInvDoc(item.id)) return; // облік не ведеться — не перевіряємо
      const have = (p && !isSized(p)) ? unitQty(item.id) : sizeQty(item.id, item.size);
      if (have < item.qty) {
        short.push(item.name + (item.size ? ' (' + item.size + ')' : '') +
          ': потрібно ' + item.qty + ', на складі ' + have);
      }
    });
    return short;
  }

  /* ============================================================
     АГРЕГАТОР ЗАМОВЛЕНЬ
     ============================================================ */

  let ordersCache = [];
  let ordersUnsub = null;
  let knownOrderIds = null;

  /* Стан фільтрів */
  const F = {
    status: 'all',
    period: '30d',      // today | yesterday | 7d | 30d | month | all | custom
    from: '',
    to: '',
    search: '',
    sort: 'new',        // new | old | sum | sumAsc
    limit: PAGE_SIZE
  };

  let selection = new Set();
  let expanded = new Set();

  function ordersBody() {
    return $id('ordersBody');
  }

  function renderOrdersRoot() {
    if (!fbReady() || !R.fb.user) {
      ordersBody().innerHTML = '<p class="ao-note">Спершу увійдіть акаунтом адміністратора.</p>';
      return;
    }
    if (!ordersUnsub) {
      ordersBody().innerHTML = '<p class="ao-note">Завантажуємо замовлення…</p>';
      subscribeOrders();
    } else {
      renderOrders();
    }
  }

  function subscribeOrders() {
    ordersUnsub = R.fb.db
      .collection('orders')
      .orderBy('created', 'desc')
      .limit(500)
      .onSnapshot(
        (snap) => {
          ordersCache = snap.docs.map((d) => Object.assign({ _id: d.id }, d.data()));

          const ids = new Set(ordersCache.map((o) => o._id));
          if (knownOrderIds) {
            ordersCache.forEach((o) => {
              if (!knownOrderIds.has(o._id)) toast('🛍 Нове замовлення №' + o.num, 'success');
            });
          }
          knownOrderIds = ids;

          updateOrdersBadge();
          if (currentView() === 'orders') renderOrders();
        },
        (err) => {
          stopOrders();
          ordersBody().innerHTML =
            '<p class="ao-note">Не вдалося завантажити замовлення' +
            (err && err.code === 'permission-denied'
              ? ': немає прав.'
              : '. Перевірте правила Firestore (файл new/firestore.rules).') +
            '</p>';
        }
      );
  }

  function stopOrders() {
    if (ordersUnsub) {
      ordersUnsub();
      ordersUnsub = null;
    }
  }

  function updateOrdersBadge() {
    const badge = $id('newOrdersBadge');
    if (!badge) return;
    const n = ordersCache.filter((o) => (o.status || 'new') === 'new').length;
    badge.hidden = n === 0;
    badge.textContent = n;
  }

  /* ---------- Дати та фільтрація ---------- */

  function orderDate(o) {
    if (o.date) return new Date(o.date);
    if (o.created && o.created.toDate) return o.created.toDate();
    return new Date(0);
  }

  function periodRange() {
    const now = new Date();
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = startOfDay(now);

    switch (F.period) {
      case 'today':
        return { from: today, to: null };
      case 'yesterday': {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        return { from: y, to: today };
      }
      case '7d': {
        const d = new Date(today);
        d.setDate(d.getDate() - 6);
        return { from: d, to: null };
      }
      case '30d': {
        const d = new Date(today);
        d.setDate(d.getDate() - 29);
        return { from: d, to: null };
      }
      case 'month':
        return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
      case 'custom': {
        const from = F.from ? new Date(F.from + 'T00:00:00') : null;
        let to = null;
        if (F.to) {
          to = new Date(F.to + 'T00:00:00');
          to.setDate(to.getDate() + 1); // включно з кінцевим днем
        }
        return { from: from, to: to };
      }
      default:
        return { from: null, to: null };
    }
  }

  function inPeriod(o) {
    const range = periodRange();
    if (!range.from && !range.to) return true;
    const d = orderDate(o);
    if (range.from && d < range.from) return false;
    if (range.to && d >= range.to) return false;
    return true;
  }

  function matchesSearch(o) {
    if (!F.search) return true;
    const q = F.search.toLowerCase();
    const c = o.customer || {};
    const items = (o.items || []).map((i) => i.name + ' ' + i.id).join(' ');
    const hay = [o.num, c.name, c.phone, c.email, o.email, o.ttn, c.city, c.branch, items]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  }

  /* Замовлення в межах періоду — база для статистики і лічильників статусів */
  function periodOrders() {
    return ordersCache.filter(inPeriod);
  }

  /* Повністю відфільтровані та відсортовані */
  function filteredOrders() {
    let list = periodOrders().filter((o) => {
      if (F.status !== 'all' && (o.status || 'new') !== F.status) return false;
      return matchesSearch(o);
    });

    list = list.slice().sort((a, b) => {
      if (F.sort === 'old') return orderDate(a) - orderDate(b);
      if (F.sort === 'sum') return (b.total || 0) - (a.total || 0);
      if (F.sort === 'sumAsc') return (a.total || 0) - (b.total || 0);
      return orderDate(b) - orderDate(a);
    });

    return list;
  }

  /* ---------- Блоки інтерфейсу ---------- */

  function statsHTML() {
    const list = periodOrders();
    const active = list.filter((o) => o.status !== 'cancelled');
    const revenue = active.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const avg = active.length ? Math.round(revenue / active.length) : 0;
    const newCount = list.filter((o) => (o.status || 'new') === 'new').length;
    const units = active.reduce(
      (s, o) => s + (o.items || []).reduce((n, i) => n + (Number(i.qty) || 0), 0), 0
    );

    return (
      '<div class="ao-stats">' +
        '<div class="ao-stat"><b>' + fmt(list.length) + '</b><span>замовлень за період</span></div>' +
        '<div class="ao-stat' + (newCount ? ' is-warn' : '') + '"><b>' + fmt(newCount) + '</b><span>потребують уваги</span></div>' +
        '<div class="ao-stat"><b>' + fmt(revenue) + ' грн</b><span>виручка (без скасованих)</span></div>' +
        '<div class="ao-stat"><b>' + fmt(avg) + ' грн</b><span>середній чек</span></div>' +
        '<div class="ao-stat"><b>' + fmt(units) + '</b><span>одиниць товару</span></div>' +
      '</div>'
    );
  }

  function periodBarHTML() {
    const opts = [
      ['today', 'Сьогодні'],
      ['yesterday', 'Вчора'],
      ['7d', '7 днів'],
      ['30d', '30 днів'],
      ['month', 'Цей місяць'],
      ['all', 'Весь час'],
      ['custom', 'Свій період']
    ];
    return (
      '<div class="ao-filterbar">' +
        '<div class="ao-chips">' +
          opts.map(([id, title]) =>
            '<button class="ao-chip' + (F.period === id ? ' is-active' : '') + '" data-period="' + id + '" type="button">' + title + '</button>'
          ).join('') +
        '</div>' +
        (F.period === 'custom'
          ? '<span class="ao-daterange">' +
              '<input type="date" id="aoFrom" value="' + esc(F.from) + '" max="' + todayISO() + '">' +
              '<i>—</i>' +
              '<input type="date" id="aoTo" value="' + esc(F.to) + '" max="' + todayISO() + '">' +
            '</span>'
          : '') +
      '</div>'
    );
  }

  function statusBarHTML() {
    const list = periodOrders().filter(matchesSearch);
    const counts = { all: list.length };
    STATUSES.forEach((s) => {
      counts[s.id] = list.filter((o) => (o.status || 'new') === s.id).length;
    });
    const chip = (id, title) =>
      '<button class="ao-chip' + (F.status === id ? ' is-active' : '') + '" data-status-filter="' + id + '" type="button">' +
        title + ' <i>' + counts[id] + '</i>' +
      '</button>';

    return (
      '<div class="ao-filterbar">' +
        '<div class="ao-chips">' + chip('all', 'Всі') + STATUSES.map((s) => chip(s.id, s.title)).join('') + '</div>' +
        '<input class="ao-search" id="aoSearch" placeholder="Пошук: №, імʼя, телефон, ТТН, місто, товар" value="' + esc(F.search) + '">' +
        '<select class="ao-sort" id="aoSort">' +
          '<option value="new"' + (F.sort === 'new' ? ' selected' : '') + '>Спершу нові</option>' +
          '<option value="old"' + (F.sort === 'old' ? ' selected' : '') + '>Спершу старі</option>' +
          '<option value="sum"' + (F.sort === 'sum' ? ' selected' : '') + '>Сума ↓</option>' +
          '<option value="sumAsc"' + (F.sort === 'sumAsc' ? ' selected' : '') + '>Сума ↑</option>' +
        '</select>' +
      '</div>'
    );
  }

  function bulkBarHTML(visible) {
    const n = selection.size;
    if (!n) {
      return (
        '<div class="ao-bulk ao-bulk--idle">' +
          '<label class="a-check"><input type="checkbox" id="aoSelectAll"> Вибрати всі показані (' + visible.length + ')</label>' +
          '<button class="btn btn--ghost btn--sm" data-export type="button">Експорт CSV</button>' +
        '</div>'
      );
    }
    return (
      '<div class="ao-bulk is-active">' +
        '<label class="a-check"><input type="checkbox" id="aoSelectAll" checked> Обрано: <b>' + n + '</b></label>' +
        '<span class="ao-bulk__actions">' +
          STATUSES.map((s) =>
            '<button class="btn btn--ghost btn--sm" data-bulk-status="' + s.id + '" type="button">' + s.title + '</button>'
          ).join('') +
          '<button class="btn btn--ghost btn--sm" data-export type="button">Експорт CSV</button>' +
          '<button class="btn btn--ghost btn--sm" data-print type="button">Друк</button>' +
          '<button class="btn btn--ghost btn--sm" data-clear-sel type="button">Зняти вибір</button>' +
        '</span>' +
      '</div>'
    );
  }

  function trackLink(o) {
    if (!o.ttn) return '';
    const base = TRACK_URLS[(o.customer || {}).carrier];
    if (!base) return '';
    return '<a class="ao-track" href="' + base + encodeURIComponent(o.ttn) + '" target="_blank" rel="noopener">відстежити ↗</a>';
  }

  function historyHTML(o) {
    const log = (o.statusLog || []).slice().reverse();
    if (!log.length) return '<p class="ao-note">Історія порожня — статус ще не змінювався.</p>';
    return (
      '<div class="ao-history">' +
        log.map((h) => {
          const d = h.at ? new Date(h.at).toLocaleString('uk-UA', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
          }) : '';
          return '<div><b>' + esc(statusInfo(h.status).title) + '</b>' +
            '<span>' + esc(d) + (h.by ? ' · ' + esc(h.by) : '') + '</span></div>';
        }).join('') +
      '</div>'
    );
  }

  /* Сума позицій має сходитися з тим, що прислав браузер.
     Розбіжність — привід перевірити замовлення вручну. */
  function orderMismatch(o) {
    if (!(o.items || []).length || o.subtotal === undefined) return '';
    const itemsSum = (o.items || []).reduce((s, i) =>
      s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
    const sub = Number(o.subtotal) || 0;
    const off = Number(o.discount) || 0;
    const tot = Number(o.total) || 0;
    if (itemsSum !== sub) return 'сума позицій ' + fmt(itemsSum) + ' грн ≠ вказана ' + fmt(sub) + ' грн';
    if (Math.abs(sub - off - tot) > 1) return 'підсумок не сходиться';
    return '';
  }

  /* Як покупець просив із ним звʼязатися. Месенджер — посилання:
     менеджеру достатньо клікнути, а не переносити номер руками. */
  const MSGR = {
    telegram: { title: 'Telegram', icon: '✈️', link: (ph, tg) => tg ? 'https://t.me/' + tg : 'https://t.me/+' + ph },
    whatsapp: { title: 'WhatsApp', icon: '🟢', link: (ph) => 'https://wa.me/' + ph },
    viber:    { title: 'Viber',    icon: '🟣', link: (ph) => 'viber://chat?number=' + ph }
  };

  function confirmText(c) {
    const cf = c && c.confirm;
    if (!cf) return '';
    const phone = (cf.phoneMode === 'other' && cf.altPhone ? cf.altPhone : (c.phone || ''));
    const how = cf.method === 'messenger'
      ? ((MSGR[cf.messenger] || {}).title || 'месенджер')
      : 'дзвінок';
    return [how, phone, cf.telegram ? '@' + cf.telegram : ''].filter(Boolean).join(' · ');
  }

  function confirmHTML(c) {
    const cf = c && c.confirm;
    if (!cf) return '';

    const phone = (cf.phoneMode === 'other' && cf.altPhone ? cf.altPhone : (c.phone || ''));
    const digits = phone.replace(/[^\d+]/g, '').replace(/^\+/, '');

    if (cf.method !== 'messenger') {
      return '<br><span class="ao-muted">📞 Підтвердити дзвінком' +
        (phone && phone !== c.phone ? ' на <b>' + esc(phone) + '</b>' : '') + '</span>';
    }

    const m = MSGR[cf.messenger];
    if (!m) return '<br><span class="ao-muted">💬 Підтвердити в месенджері</span>';

    const label = m.icon + ' ' + m.title + (phone ? ' · ' + phone : '') +
      (cf.telegram ? ' · @' + cf.telegram : '');

    return '<br><span class="ao-muted">' +
      '<a href="' + esc(m.link(digits, cf.telegram)) + '" target="_blank" rel="noopener">' +
        esc(label) + '</a></span>';
  }

  function orderCardHTML(o) {
    const st = o.status || 'new';
    const mismatch = orderMismatch(o);
    const d = orderDate(o);
    const dateFull = d.getTime()
      ? d.toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
      : '';
    const c = o.customer || {};
    const delivery = R.addressLine(c);
    const units = (o.items || []).reduce((n, i) => n + (Number(i.qty) || 0), 0);

    const isOpen = expanded.has(o._id);
    const next = NEXT_STEP[st];

    const items = (o.items || [])
      .map((i) =>
        '<div class="ao-line">' +
          '<span>' + esc(i.name) + (i.size ? ' · <b>' + esc(i.size) + '</b>' : '') + '</span>' +
          '<span>' + i.qty + ' × ' + fmt(i.price) + ' = <b>' + fmt(i.price * i.qty) + ' грн</b></span>' +
        '</div>'
      ).join('');

    return (
      '<article class="ao-card st-' + st + (isOpen ? ' is-open' : '') + '" data-id="' + esc(o._id) + '">' +

        '<div class="ao-card__top">' +
          '<label class="ao-pick"><input type="checkbox" data-pick' + (selection.has(o._id) ? ' checked' : '') + '></label>' +
          '<b class="ao-card__num">№' + esc(o.num) + '</b>' +
          '<select class="ao-status-select st-' + st + '" data-ao-status>' +
            STATUSES.map((s) =>
              '<option value="' + s.id + '"' + (s.id === st ? ' selected' : '') + '>' + s.title + '</option>'
            ).join('') +
          '</select>' +
          (o.stockApplied ? '<span class="ao-tag" title="Товар списано зі складу">склад ✓</span>' : '') +
          '<span class="ao-card__date">' + esc(dateFull) + '</span>' +
          '<span class="ao-card__sum">' + fmt(o.total) + ' грн</span>' +
        '</div>' +

        '<div class="ao-card__mid">' +
          '<div class="ao-card__customer">' +
            '<b>' + esc(c.name || '—') + '</b>' +
            ' · <a href="tel:' + esc((c.phone || '').replace(/\s/g, '')) + '">' + esc(c.phone || '—') + '</a>' +
            ((c.email || o.email) ? ' · <a href="mailto:' + esc(c.email || o.email) + '">' + esc(c.email || o.email) + '</a>' : '') +
            (delivery ? '<br><span class="ao-muted">🚚 ' + esc(delivery) + '</span>' : '') +
            confirmHTML(c) +
            (c.comment ? '<br><span class="ao-muted">💬 ' + esc(c.comment) + '</span>' : '') +
          '</div>' +
          '<button class="ao-toggle" data-toggle type="button">' +
            (isOpen ? 'Згорнути' : 'Деталі') + ' · ' + units + ' шт' +
          '</button>' +
        '</div>' +

        (isOpen
          ? '<div class="ao-card__details">' +
              '<div class="ao-card__items">' + items + '</div>' +
              '<div class="ao-card__grid">' +
                '<label class="ao-field"><span>ТТН ' + trackLink(o) + '</span>' +
                  '<input data-ao-ttn value="' + esc(o.ttn || '') + '" placeholder="номер накладної"></label>' +
                '<label class="ao-field"><span>Нотатка менеджера</span>' +
                  '<input data-ao-note value="' + esc(o.note || '') + '" placeholder="напр.: передзвонити після 18:00"></label>' +
              '</div>' +
              '<div class="ao-card__hist"><span class="ao-field__label">Історія статусів</span>' + historyHTML(o) + '</div>' +
            '</div>'
          : '') +

        '<div class="ao-card__actions">' +
          (next ? '<button class="btn btn--primary btn--sm" data-next="' + next.id + '" type="button">' + next.label + '</button>' : '') +
          (st !== 'cancelled' && st !== 'done'
            ? '<button class="btn btn--ghost btn--sm" data-next="cancelled" type="button">Скасувати</button>' : '') +
          '<button class="btn btn--ghost btn--sm" data-copy type="button">Скопіювати</button>' +
          '<button class="btn btn--ghost btn--sm" data-print-one type="button">Друк</button>' +
          '<button class="btn btn--ghost btn--sm ao-danger" data-del type="button">Видалити</button>' +
        '</div>' +

      '</article>'
    );
  }

  /* Після перемальовки стрічка фільтрів починається з нуля —
     повертаємо в поле зору те, що обране зараз. На телефоні
     чіпи стають прокрутною доріжкою, інакше активного не видно. */
  function showActiveChips(root) {
    if (!root) return;
    root.querySelectorAll('.ao-chips .ao-chip.is-active').forEach((c) => {
      if (c.scrollIntoView) c.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  }

  function renderOrders() {
    const list = filteredOrders();
    const visible = list.slice(0, F.limit);

    // прибираємо з вибору те, що зникло з фільтра
    const visibleIds = new Set(list.map((o) => o._id));
    Array.from(selection).forEach((id) => {
      if (!visibleIds.has(id)) selection.delete(id);
    });

    ordersBody().innerHTML =
      '<div class="ao-toolbar">' +
        '<span class="ao-live">● live</span>' +
        '<span>Нові замовлення зʼявляються автоматично</span>' +
      '</div>' +
      statsHTML() +
      periodBarHTML() +
      statusBarHTML() +
      bulkBarHTML(visible) +
      '<div class="ao-list">' +
        (visible.length
          ? visible.map(orderCardHTML).join('')
          : '<div class="a-empty">' +
              (ordersCache.length
                ? 'За цими фільтрами нічого не знайдено. Спробуйте розширити період або скинути пошук.'
                : 'Замовлень поки немає. Щойно покупець оформить кошик — воно зʼявиться тут.') +
            '</div>') +
      '</div>' +
      (list.length > visible.length
        ? '<button class="btn btn--ghost ao-more" data-more type="button">Показати ще ' +
            Math.min(PAGE_SIZE, list.length - visible.length) + ' із ' + (list.length - visible.length) + '</button>'
        : (list.length ? '<p class="ao-note ao-count">Показано всі ' + list.length + '</p>' : ''));

    bindLiveInputs();
  }

  /* Живі поля (пошук, дати, сортування) — щоб не перерендерювати на кожен символ */
  function bindLiveInputs() {
    const search = $id('aoSearch');
    if (search) {
      search.addEventListener('input', () => {
        F.search = search.value;
        F.limit = PAGE_SIZE;
        const pos = search.selectionStart;
        renderOrders();
        const again = $id('aoSearch');
        if (again) {
          again.focus();
          again.setSelectionRange(pos, pos);
        }
      });
    }

    const sort = $id('aoSort');
    if (sort) {
      sort.addEventListener('change', () => {
        F.sort = sort.value;
        renderOrders();
      });
    }

    const from = $id('aoFrom');
    const to = $id('aoTo');
    if (from) from.addEventListener('change', () => { F.from = from.value; renderOrders(); });
    if (to) to.addEventListener('change', () => { F.to = to.value; renderOrders(); });

    const all = $id('aoSelectAll');
    if (all) {
      all.addEventListener('change', () => {
        const visible = filteredOrders().slice(0, F.limit);
        if (all.checked) visible.forEach((o) => selection.add(o._id));
        else selection.clear();
        renderOrders();
      });
    }

    showActiveChips(ordersBody());
  }

  /* ---------- Зміна статусу ---------- */

  function statusLogEntry(status) {
    return {
      status: status,
      at: new Date().toISOString(),
      by: (R.fb.user && R.fb.user.email) || ''
    };
  }

  async function applyStatus(order, next, opts) {
    const prev = order.status || 'new';
    if (prev === next) return true;
    opts = opts || {};

    const wasApplied = !!order.stockApplied;
    const willConsume = CONSUMING.includes(next);

    // Попередження про нестачу лише при першому списанні
    if (willConsume && !wasApplied && !opts.silent) {
      const short = stockShortage(order);
      if (short.length) {
        const ok = confirm(
          'На складі не вистачає товару:\n\n' + short.join('\n') +
          '\n\nПродовжити? Залишки підуть у мінус — це видно на сторінці «Склад».'
        );
        if (!ok) return false;
      }
    }

    try {
      const batch = R.fb.db.batch();
      const upd = {
        status: next,
        statusLog: firebase.firestore.FieldValue.arrayUnion(statusLogEntry(next))
      };

      if (willConsume && !wasApplied) {
        adjustOrderStock(batch, order, -1);
        upd.stockApplied = true;
      }
      if (!willConsume && wasApplied) {
        adjustOrderStock(batch, order, +1);
        upd.stockApplied = false;
      }

      batch.update(R.fb.db.collection('orders').doc(order._id), upd);
      await batch.commit();

      if (!opts.silent) {
        if (upd.stockApplied === true) toast('Статус оновлено, товар списано зі складу ✓', 'success');
        else if (upd.stockApplied === false) toast('Статус оновлено, товар повернено на склад ✓', 'success');
        else toast('Статус: ' + statusInfo(next).title + ' ✓', 'success');
      }
      return true;
    } catch (err) {
      if (!opts.silent) toast('Не вдалося оновити статус');
      renderOrders();
      return false;
    }
  }

  async function bulkStatus(next) {
    const ids = Array.from(selection);
    if (!ids.length) return;
    const orders = ids.map((id) => ordersCache.find((o) => o._id === id)).filter(Boolean);
    const toChange = orders.filter((o) => (o.status || 'new') !== next);

    if (!toChange.length) {
      toast('Усі обрані замовлення вже мають цей статус');
      return;
    }
    if (!confirm('Змінити статус на «' + statusInfo(next).title + '» для ' + toChange.length + ' замовлень?')) return;

    toast('Оновлюємо ' + toChange.length + ' замовлень…');
    let done = 0;
    for (let i = 0; i < toChange.length; i += BULK_CHUNK) {
      const chunk = toChange.slice(i, i + BULK_CHUNK);
      // послідовно, щоб не перевищити ліміт операцій у батчі
      for (const o of chunk) {
        const ok = await applyStatus(o, next, { silent: true });
        if (ok) done++;
      }
    }
    selection.clear();
    toast('Оновлено замовлень: ' + done + ' ✓', 'success');
    renderOrders();
  }

  /* ---------- Експорт і друк ---------- */

  function csvCell(v) {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return '"' + s + '"';
  }

  function exportCSV() {
    const list = selection.size
      ? filteredOrders().filter((o) => selection.has(o._id))
      : filteredOrders();

    if (!list.length) {
      toast('Немає що експортувати');
      return;
    }

    const head = ['Номер', 'Дата', 'Статус', 'Клієнт', 'Телефон', 'Email',
                  'Перевізник', 'Місто', 'Відділення / вулиця', 'Індекс', 'Штат / область', 'Підтвердження',
                  'ТТН', 'Товари', 'Кількість', 'Сума, грн', 'Нотатка'];
    const rows = list.map((o) => {
      const c = o.customer || {};
      const items = (o.items || [])
        .map((i) => i.name + (i.size ? ' (' + i.size + ')' : '') + ' ×' + i.qty).join('; ');
      const units = (o.items || []).reduce((n, i) => n + (Number(i.qty) || 0), 0);
      return [
        o.num,
        orderDate(o).toLocaleString('uk-UA'),
        statusInfo(o.status || 'new').title,
        c.name || '', c.phone || '', c.email || o.email || '',
        c.carrier || '', c.city || '', c.branch || '',
        (c.intl && c.intl.zip) || '', (c.intl && c.intl.state) || '', confirmText(c),
        o.ttn || '', items, units, o.total || 0, o.note || ''
      ].map(csvCell).join(',');
    });

    // BOM — щоб Excel правильно показав кирилицю
    const csv = '﻿' + [head.map(csvCell).join(',')].concat(rows).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reyter-zamovlennya-' + todayISO() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Експортовано замовлень: ' + list.length + ' ✓', 'success');
  }

  function printOrders(list) {
    if (!list.length) {
      toast('Немає що друкувати');
      return;
    }
    const win = window.open('', '_blank');
    if (!win) {
      toast('Браузер заблокував нове вікно — дозвольте спливаючі вікна');
      return;
    }

    const body = list.map((o) => {
      const c = o.customer || {};
      const items = (o.items || [])
        .map((i) => '<tr><td>' + esc(i.name) + (i.size ? ' (' + esc(i.size) + ')' : '') +
          '</td><td>' + i.qty + '</td><td>' + fmt(i.price * i.qty) + ' грн</td></tr>').join('');
      return (
        '<section>' +
          '<h2>Замовлення №' + esc(o.num) + '</h2>' +
          '<p class="meta">' + esc(orderDate(o).toLocaleString('uk-UA')) +
            ' · ' + esc(statusInfo(o.status || 'new').title) + '</p>' +
          '<p><b>' + esc(c.name || '') + '</b><br>' + esc(c.phone || '') +
            (c.email ? '<br>' + esc(c.email) : '') + '</p>' +
          '<p>' + esc(R.addressLine(c)) +
            (confirmText(c) ? '<br>Підтвердження: ' + esc(confirmText(c)) : '') +
            (o.ttn ? '<br>ТТН: <b>' + esc(o.ttn) + '</b>' : '') + '</p>' +
          (c.comment ? '<p><i>' + esc(c.comment) + '</i></p>' : '') +
          '<table><thead><tr><th>Товар</th><th>К-сть</th><th>Сума</th></tr></thead>' +
            '<tbody>' + items + '</tbody></table>' +
          '<p class="total">Разом: ' + fmt(o.total) + ' грн</p>' +
        '</section>'
      );
    }).join('');

    win.document.write(
      '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>REYTER — замовлення</title><style>' +
      'body{font-family:system-ui,-apple-system,sans-serif;color:#171b26;margin:24px;}' +
      'section{page-break-after:always;border-bottom:1px dashed #ccc;padding-bottom:18px;margin-bottom:18px;}' +
      'section:last-child{page-break-after:auto;border-bottom:none;}' +
      'h2{font-size:18px;margin:0 0 4px;}' +
      '.meta{color:#6e6a5e;font-size:12px;margin:0 0 10px;}' +
      'p{margin:6px 0;font-size:14px;}' +
      'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;}' +
      'th,td{border-bottom:1px solid #eee;padding:5px 4px;text-align:left;}' +
      'th{background:#f4f4f4;}' +
      '.total{font-weight:700;font-size:15px;margin-top:8px;}' +
      '</style></head><body>' + body + '</body></html>'
    );
    win.document.close();
    setTimeout(() => win.print(), 400);
  }

  /* ============================================================
     РУЧНЕ СТВОРЕННЯ ЗАМОВЛЕННЯ
     (дзвінок, Direct, особисте спілкування)
     ============================================================ */

  let noRows = [];      // рядки товарів: {pid, size, qty, price}
  let noSeq = 0;

  function noModal() {
    return $id('newOrderModal');
  }

  function availableSizes(p) {
    if (!isSized(p)) return [];
    const s = invOf(p.id).sizes || {};
    const tracked = Object.keys(s);
    // якщо облік ще не ведеться — показуємо розміри з картки товару
    return tracked.length ? R.config.allSizes.filter((x) => tracked.includes(x)) : (p.sizes || []);
  }

  /* Рядок товару у списку вибору: мініатюра, назва, артикул,
     категорія, ціна й залишок — усе, чим одна позиція
     відрізняється від сусідньої */
  function productOptionHTML(x) {
    const img = (x.images && x.images[0]) || '';
    const left = hasInvDoc(x.id) ? totalQty(x) : null;
    return (
      '<img class="a-pick__img" src="' + esc(img) + '" alt="" loading="lazy"' +
        ' onerror="this.style.visibility=\'hidden\'">' +
      '<span class="a-pick__body">' +
        '<b>' + esc(x.name) + '</b>' +
        '<i>' + esc(x.id) + ' · ' + esc(catName(x.category)) + ' · ' + fmt(x.price) + ' грн' +
          (left === null ? '' : ' · ' + left + ' шт') + '</i>' +
      '</span>'
    );
  }

  /* Обраний товар — той самий вигляд, але як мітка над полем */
  function productChipHTML(p) {
    const img = (p.images && p.images[0]) || '';
    return (
      '<span class="a-pick__chip">' +
        '<img src="' + esc(img) + '" alt="" loading="lazy"' +
          ' onerror="this.style.visibility=\'hidden\'">' +
        '<span><b>' + esc(p.name) + '</b><i>' + esc(p.id) + ' · ' + fmt(p.price) + ' грн</i></span>' +
      '</span>'
    );
  }

  function noRowHTML(row) {
    const p = productById(row.pid);
    const all = products();

    /* Замість <select> — пошук зі списком, де видно мініатюру,
       артикул, категорію, ціну й залишок: у списку три десятки
       позицій із дуже схожими назвами («Бріфи classic» двічі),
       і за самою назвою їх не розрізнити. */
    const productSelect =
      '<div class="acombo a-nopick">' +
        '<div class="acombo__box">' +
          (p ? productChipHTML(p) : '') +
          '<input data-no-pid value="' + esc(p ? p.name : '') + '" ' +
            'placeholder="оберіть товар — назва або артикул" ' +
            'autocomplete="off" spellcheck="false" role="combobox" ' +
            'aria-expanded="false" data-ref="' + esc(row.pid || '') + '">' +
          '<span class="acombo__spin" hidden></span>' +
          '<ul class="acombo__list" role="listbox" hidden></ul>' +
        '</div>' +
      '</div>';

    let sizeSelect;
    if (!p) {
      sizeSelect = '<select data-no-size disabled><option>—</option></select>';
    } else if (!isSized(p)) {
      sizeSelect = '<select data-no-size><option value="' + esc(p.volume) + '">' + esc(p.volume) + '</option></select>';
    } else {
      const sizes = availableSizes(p);
      sizeSelect =
        '<select data-no-size>' +
          (sizes.length
            ? sizes.map((s) => {
                const have = hasInvDoc(p.id) ? sizeQty(p.id, s) : null;
                const label = s + (have === null ? '' : ' (' + have + ' шт)');
                return '<option value="' + s + '"' + (s === row.size ? ' selected' : '') + '>' + label + '</option>';
              }).join('')
            : '<option value="">немає розмірів</option>') +
        '</select>';
    }

    const short = p && isSized(p) && hasInvDoc(p.id) && row.size && sizeQty(p.id, row.size) < row.qty;

    return (
      '<div class="a-norow' + (short ? ' is-short' : '') + '" data-row="' + row.uid + '">' +
        '<span class="a-norow__product">' + productSelect + '</span>' +
        '<span class="a-norow__size">' + sizeSelect + '</span>' +
        '<span class="a-norow__qty"><input type="number" min="1" value="' + row.qty +
          '" data-no-qty placeholder="К-сть" aria-label="Кількість"></span>' +
        '<span class="a-norow__price"><input type="number" min="0" value="' + (row.price || 0) +
          '" data-no-price placeholder="Ціна" aria-label="Ціна за штуку"> грн</span>' +
        '<span class="a-norow__sum">Разом: ' + fmt((row.price || 0) * row.qty) + ' грн</span>' +
        '<button class="a-norow__del" data-no-del type="button" title="Прибрати">✕</button>' +
        (short ? '<span class="a-norow__warn">На складі лише ' + sizeQty(p.id, row.size) + ' шт — залишок піде в мінус</span>' : '') +
      '</div>'
    );
  }

  /* Рахуємо лише заповнені рядки — порожні не впливають на підсумок */
  function noFilledRows() {
    return noRows.filter((r) => !!productById(r.pid));
  }

  function noItemsTotal() {
    return noFilledRows().reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0), 0);
  }

  function noTotal() {
    const discount = Number($id('noDiscount').value) || 0;
    const shipping = Number($id('noShipping').value) || 0;
    return Math.max(0, noItemsTotal() - discount + shipping);
  }

  function renderNoItems() {
    $id('noItems').innerHTML = noRows.length
      ? noRows.map(noRowHTML).join('')
      : '<div class="a-empty">Додайте хоча б одну позицію.</div>';
    bindProductPickers();
    renderNoTotal();
  }

  /* Пошук товару в рядку позиції: шукає і за назвою, і за
     артикулом — назви часто збігаються, артикули ні */
  function bindProductPickers() {
    $id('noItems').querySelectorAll('[data-no-pid]').forEach((input) => {
      R.attachCombo(input, {
        minChars: 0,
        openOnFocus: true,
        load: (q) => {
          const needle = q.trim().toLowerCase();
          return products().filter((x) =>
            !needle ||
            x.name.toLowerCase().includes(needle) ||
            x.id.toLowerCase().includes(needle) ||
            catName(x.category).toLowerCase().includes(needle));
        },
        render: (x) => ({
          html: productOptionHTML(x),
          cls: 'a-pick',
          value: x.name,
          ref: x.id
        }),
        onPick: (x) => {
          const rowEl = input.closest('[data-row]');
          const row = noRows.find((r) => r.uid === rowEl.dataset.row);
          if (!row) return;
          row.pid = x.id;
          row.price = x.price;
          const sizes = availableSizes(x);
          row.size = !isSized(x) ? x.volume : (sizes[0] || '');
          renderNoItems();
        },
        empty: 'admin.noProduct'
      });
    });
  }

  function renderNoTotal() {
    const items = noItemsTotal();
    const discount = Number($id('noDiscount').value) || 0;
    const shipping = Number($id('noShipping').value) || 0;
    const units = noFilledRows().reduce((s, r) => s + (Number(r.qty) || 0), 0);

    $id('noTotal').innerHTML =
      '<div><span>Товарів: ' + units + ' шт</span><span>' + fmt(items) + ' грн</span></div>' +
      (discount ? '<div><span>Знижка</span><span>− ' + fmt(discount) + ' грн</span></div>' : '') +
      (shipping ? '<div><span>Доставка</span><span>+ ' + fmt(shipping) + ' грн</span></div>' : '') +
      '<div class="is-sum"><span>До сплати</span><span>' + fmt(noTotal()) + ' грн</span></div>';
  }

  function addNoRow() {
    noRows.push({ uid: 'r' + (++noSeq), pid: '', size: '', qty: 1, price: 0 });
    renderNoItems();
  }

  function openNewOrder() {
    noRows = [];
    noSeq = 0;
    ['noName', 'noPhone', 'noEmail', 'noComment'].forEach((id) => { $id(id).value = ''; });
    // Блок адреси малюємо щоразу заново: у нього свій стан
    // (обраний перевізник, реф міста), який треба скинути
    $id('noAddress').innerHTML = R.addressField('no', {});
    R.initAddress('no');
    $id('noDiscount').value = '';
    $id('noShipping').value = '';
    $id('noStatus').value = 'new';
    $id('noNotify').checked = false;
    $id('noStatusMsg').hidden = true;
    addNoRow();
    noModal().hidden = false;
    R.lockBg();
    setTimeout(() => $id('noName').focus(), 60);
  }

  function buildOrderMessage(order) {
    const lines = [];
    lines.push('🛍 Замовлення №' + order.num + ' — reyter.men');
    lines.push('');
    order.items.forEach((i, n) => {
      lines.push(n + 1 + '. ' + i.name + ' (' + i.id + ')');
      lines.push('   ' + (i.size ? (i.volume ? 'обʼєм ' : 'розмір ') + i.size + ' · ' : '') +
        i.qty + ' шт · ' + fmt(i.price * i.qty) + ' грн');
    });
    lines.push('');
    if (order.discount) lines.push('Знижка: −' + fmt(order.discount) + ' грн');
    if (order.shipping) lines.push('Доставка: +' + fmt(order.shipping) + ' грн');
    lines.push('Разом: ' + fmt(order.total) + ' грн');
    lines.push('');
    lines.push('👤 ' + order.customer.name);
    lines.push('📞 ' + order.customer.phone);
    const delivery = R.addressLine(order.customer);
    if (delivery) lines.push('🚚 ' + delivery);
    if (order.customer.comment) lines.push('💬 ' + order.customer.comment);
    return lines.join('\n');
  }

  function orderNumber() {
    const now = new Date();
    return 'R-' + String(now.getFullYear()).slice(2) +
      pad2(now.getMonth() + 1) + pad2(now.getDate()) +
      '-' + String(Math.floor(100 + Math.random() * 900));
  }

  async function createManualOrder() {
    const name = $id('noName').value.trim();
    const phone = $id('noPhone').value.trim();

    if (!name) return setNoStatus('err', 'Вкажіть імʼя клієнта');
    if (!phone) return setNoStatus('err', 'Вкажіть телефон клієнта');

    const items = [];
    for (const row of noRows) {
      const p = productById(row.pid);
      if (!p) continue;
      if (isSized(p) && !row.size) {
        return setNoStatus('err', 'Оберіть розмір для «' + p.name + '»');
      }
      const qty = Math.max(1, Math.trunc(Number(row.qty) || 1));
      items.push({
        id: p.id,
        name: p.name,
        size: row.size || null,
        qty: qty,
        price: Math.max(0, Math.trunc(Number(row.price) || 0)),
        volume: !!p.volume
      });
    }

    if (!items.length) return setNoStatus('err', 'Додайте хоча б один товар');

    const discount = Number($id('noDiscount').value) || 0;
    const shipping = Number($id('noShipping').value) || 0;
    const status = $id('noStatus').value;

    const customer = Object.assign({
      name: name,
      phone: phone,
      email: $id('noEmail').value.trim()
    }, R.addressValue('no'), {
      comment: $id('noComment').value.trim()
    });

    const order = {
      num: orderNumber(),
      date: new Date().toISOString(),
      items: items,
      discount: discount,
      shipping: shipping,
      total: Math.max(0, items.reduce((s, i) => s + i.price * i.qty, 0) - discount + shipping),
      customer: customer,
      email: customer.email,
      status: status,
      uid: null,
      source: $id('noSource').value,
      createdBy: (R.fb.user && R.fb.user.email) || '',
      created: firebase.firestore.FieldValue.serverTimestamp(),
      statusLog: [statusLogEntry(status)]
    };
    order.message = buildOrderMessage(order);

    // Попередження про нестачу, якщо одразу підтверджуємо
    if (CONSUMING.includes(status)) {
      const short = stockShortage(order);
      if (short.length) {
        const ok = confirm('На складі не вистачає товару:\n\n' + short.join('\n') +
          '\n\nСтворити замовлення? Залишки підуть у мінус.');
        if (!ok) return;
      }
    }

    setNoStatus('wait', 'Створюємо замовлення…');

    try {
      const batch = R.fb.db.batch();
      const ref = R.fb.db.collection('orders').doc();

      if (CONSUMING.includes(status)) {
        order.stockApplied = true;
        adjustOrderStock(batch, order, -1);
      }

      batch.set(ref, order);
      await batch.commit();

      if ($id('noNotify').checked && customer.email) {
        // Замовлення завів адмін — сповіщати самого себе в Telegram зайве
        R.notify.orderPlaced(order, { silent: true });
      }

      noModal().hidden = true;
      R.unlockBg();
      toast('Замовлення №' + order.num + ' створено ✓', 'success');
    } catch (err) {
      setNoStatus('err', 'Не вдалося створити замовлення. Перевірте правила Firestore (потрібен дозвіл create для адміна).');
    }
  }

  function setNoStatus(cls, text) {
    const el = $id('noStatusMsg');
    el.hidden = false;
    el.className = 'a-publish__status ' + cls;
    el.textContent = text;
  }


  /* ============================================================
     ПРОМОКОДИ
     ============================================================ */

  let promosCache = [];
  let promosUnsub = null;
  let editingPromo = null;   // код, що редагується (null — новий)
  let pcProdFilter = '';
  let pcPicked = new Set();   // вибрані товари живуть тут, а не в DOM

  function promosBody() {
    return $id('promosBody');
  }

  function renderPromosRoot() {
    if (!fbReady() || !R.fb.user) {
      promosBody().innerHTML = '<p class="ao-note">Спершу увійдіть акаунтом адміністратора.</p>';
      return;
    }
    if (!promosUnsub) {
      promosBody().innerHTML = '<p class="ao-note">Завантажуємо промокоди…</p>';
      subscribePromos();
    } else {
      renderPromos();
    }
  }

  function subscribePromos() {
    promosUnsub = R.fb.db.collection('promos').onSnapshot(
      (snap) => {
        promosCache = snap.docs.map((d) => Object.assign({ code: d.id }, d.data()));
        promosCache.sort((a, b) => String(a.code).localeCompare(String(b.code)));
        if (currentView() === 'promos') renderPromos();
      },
      (err) => {
        stopPromos();
        promosBody().innerHTML =
          '<p class="ao-note">Не вдалося завантажити промокоди' +
          (err && err.code === 'permission-denied'
            ? ': немає прав.'
            : '. Перевірте, що правила Firestore оновлено (файл new/firestore.rules).') +
          '</p>';
      }
    );
  }

  function stopPromos() {
    if (promosUnsub) {
      promosUnsub();
      promosUnsub = null;
    }
  }

  /* Стан промокоду для бейджа у списку */
  /* Скільки разів код реально використано — рахуємо із замовлень,
     а не довіряємо лічильнику, який писав браузер покупця */
  function promoUsed(code) {
    return ordersCache.filter((o) =>
      o.promoCode === code && o.status !== 'cancelled').length;
  }

  function promoState(p) {
    const today = todayISO();
    if (p.active === false) return { cls: 'is-off', label: 'Вимкнено' };
    if (p.startsAt && today < p.startsAt) return { cls: 'is-soon', label: 'Ще не почався' };
    if (p.endsAt && today > p.endsAt) return { cls: 'is-off', label: 'Завершився' };
    const limit = Number(p.usageLimit) || 0;
    if (limit > 0 && promoUsed(p.code) >= limit) return { cls: 'is-off', label: 'Вичерпано' };
    return { cls: 'is-on', label: 'Діє' };
  }

  function promoScopeText(p) {
    if (p.scope === 'categories') {
      const names = (p.categories || []).map((c) => {
        const cat = categories().find((x) => x.id === c);
        return cat ? cat.title : c;
      });
      return 'Категорії: ' + (names.join(', ') || '—');
    }
    if (p.scope === 'products') {
      const names = (p.products || []).map((id) => {
        const prod = productById(id);
        return prod ? prod.name : id;
      });
      return 'Товари: ' + (names.join(', ') || '—');
    }
    return 'Весь кошик';
  }

  function promoValueText(p) {
    return p.type === 'fixed' ? fmt(p.value) + ' грн' : (Number(p.value) || 0) + '%';
  }

  function promoCardHTML(p) {
    const st = promoState(p);
    const limit = Number(p.usageLimit) || 0;
    const used = promoUsed(p.code);
    const period = [
      p.startsAt ? 'з ' + p.startsAt : '',
      p.endsAt ? 'до ' + p.endsAt : ''
    ].filter(Boolean).join(' ');

    return (
      '<article class="ao-card a-promo ' + st.cls + '" data-code="' + esc(p.code) + '">' +
        '<div class="ao-card__head">' +
          '<b class="a-promo__code">' + esc(p.code) + '</b>' +
          '<span class="a-promo__value">−' + esc(promoValueText(p)) + '</span>' +
          '<span class="order-card__status ' + (st.cls === 'is-on' ? 'is-done' : (st.cls === 'is-off' ? 'is-cancelled' : '')) + '">' +
            st.label + '</span>' +
          (p.email ? '<span class="a-promo__personal">персональний</span>' : '') +
          '<span class="ao-card__date">' + esc(period) + '</span>' +
        '</div>' +
        '<div class="ao-card__customer">' +
          (p.email ? '✉️ <b>' + esc(p.email) + '</b><br>' : '') +
          esc(promoScopeText(p)) +
          (p.excludeSale ? ' · без SALE-товарів' : '') +
          (Number(p.minTotal) ? ' · від ' + fmt(p.minTotal) + ' грн' : '') +
          '<br><span class="ao-muted">Використано: <b>' + used + '</b>' +
            (limit ? ' із ' + limit : ' (без ліміту)') +
            (p.note ? ' · ' + esc(p.note) : '') + '</span>' +
        '</div>' +
        '<div class="ao-card__actions">' +
          '<button class="btn btn--ghost btn--sm" data-promo-edit type="button">Редагувати</button>' +
          '<button class="btn btn--ghost btn--sm" data-promo-toggle type="button">' +
            (p.active === false ? 'Увімкнути' : 'Вимкнути') + '</button>' +
          '<button class="btn btn--ghost btn--sm" data-promo-copy type="button">Скопіювати код</button>' +
          (p.email ? '<button class="btn btn--ghost btn--sm" data-promo-mail type="button">Надіслати на пошту</button>' : '') +
          '<button class="btn btn--ghost btn--sm ao-danger" data-promo-del type="button">Видалити</button>' +
        '</div>' +
      '</article>'
    );
  }

  function renderPromos() {
    const active = promosCache.filter((p) => promoState(p).cls === 'is-on').length;
    const totalUses = promosCache.reduce((s, p) => s + promoUsed(p.code), 0);

    promosBody().innerHTML =
      '<div class="ao-stats">' +
        '<div class="ao-stat"><b>' + promosCache.length + '</b><span>усього промокодів</span></div>' +
        '<div class="ao-stat"><b>' + active + '</b><span>діють зараз</span></div>' +
        '<div class="ao-stat"><b>' + totalUses + '</b><span>використань</span></div>' +
      '</div>' +
      '<div class="ao-list">' +
        (promosCache.length
          ? promosCache.map(promoCardHTML).join('')
          : '<div class="a-empty">Промокодів ще немає. Натисніть «+ Новий промокод», щоб створити першу знижку.</div>') +
      '</div>';
  }

  /* ---------- Редактор промокоду ---------- */

  function pcSetStatus(cls, text) {
    const el = $id('pcStatus');
    el.hidden = false;
    el.className = 'a-publish__status ' + cls;
    el.textContent = text;
  }

  function renderPcCats(selected) {
    $id('pcCats').innerHTML = categories()
      .map((c) =>
        '<label><input type="checkbox" value="' + esc(c.id) + '"' +
        ((selected || []).includes(c.id) ? ' checked' : '') + '> ' + esc(c.title) + '</label>'
      ).join('');
  }

  function renderPcProds() {
    const q = pcProdFilter.toLowerCase();
    const list = products().filter((p) =>
      !q || (p.name + ' ' + p.id).toLowerCase().includes(q)
    );
    $id('pcProds').innerHTML = list.length
      ? list.map((p) =>
          '<label class="a-promo-product"><input type="checkbox" value="' + esc(p.id) + '"' +
          (pcPicked.has(p.id) ? ' checked' : '') + '>' +
          '<img src="' + esc((p.images && p.images[0]) || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
          '<span>' + esc(p.name) + '<i>' + esc(p.id) + ' · ' + fmt(p.price) + ' грн</i></span></label>'
        ).join('')
      : '<div class="a-empty">Нічого не знайдено.</div>';
  }

  function pcSelectedCats() {
    return Array.prototype.map.call(
      document.querySelectorAll('#pcCats input:checked'), (i) => i.value);
  }

  function pcSyncScope() {
    const scope = $id('pcScope').value;
    $id('pcCatsBox').hidden = scope !== 'categories';
    $id('pcProdsBox').hidden = scope !== 'products';
    pcPreview();
  }

  /* Живий приклад: скільки зекономить клієнт на типовому кошику */
  function pcPreview() {
    const p = pcCollect();
    const box = $id('pcPreview');
    if (!p.value) {
      box.innerHTML = '';
      return;
    }

    // беремо перші три видимі товари як приклад кошика
    const sample = products().filter((x) => !x.hidden).slice(0, 3).map((x) => ({
      id: x.id, category: x.category, price: x.price, qty: 1, sale: !!x.sale
    }));
    const res = R.promoCheck(Object.assign({}, p, { usedCount: 0 }), sample, new Date());
    const sum = sample.reduce((s, i) => s + i.price, 0);

    box.innerHTML =
      '<b>Приклад</b>: кошик на ' + fmt(sum) + ' грн із товарів ' +
      sample.map((i) => esc(i.id)).join(', ') + ' → ' +
      (res.ok
        ? '<span class="is-good">знижка ' + fmt(res.discount) + ' грн, до сплати ' + fmt(sum - res.discount) + ' грн</span>'
        : '<span class="is-bad">не спрацює: ' + esc(R.promoMessage(res, p)) + '</span>');
  }

  function pcCollect() {
    const scope = $id('pcScope').value;
    return {
      code: R.promoNormalize($id('pcCode').value),
      type: $id('pcType').value,
      value: Number($id('pcValue').value) || 0,
      scope: scope,
      categories: scope === 'categories' ? pcSelectedCats() : [],
      products: scope === 'products' ? Array.from(pcPicked) : [],
      excludeSale: $id('pcExcludeSale').checked,
      minTotal: Number($id('pcMinTotal').value) || 0,
      startsAt: $id('pcStartsAt').value || '',
      endsAt: $id('pcEndsAt').value || '',
      email: $id('pcEmail').value.trim().toLowerCase(),
      usageLimit: Number($id('pcUsageLimit').value) || 0,
      active: $id('pcActive').checked,
      note: $id('pcNote').value.trim()
    };
  }

  function openPromoEditor(p) {
    editingPromo = p ? p.code : null;
    pcProdFilter = '';
    $id('promoTitle').textContent = p ? 'Промокод ' + p.code : 'Новий промокод';
    $id('pcStatus').hidden = true;

    const v = p || {};
    $id('pcCode').value = v.code || '';
    $id('pcCode').disabled = !!p;          // код — це id документа, не міняємо
    $id('pcType').value = v.type || 'percent';
    $id('pcValue').value = v.value != null ? v.value : '';
    $id('pcScope').value = v.scope || 'all';
    $id('pcExcludeSale').checked = !!v.excludeSale;
    $id('pcMinTotal').value = v.minTotal || '';
    $id('pcStartsAt').value = v.startsAt || '';
    $id('pcEndsAt').value = v.endsAt || '';
    $id('pcEmail').value = v.email || '';
    $id('pcUsageLimit').value = v.usageLimit || '';
    $id('pcActive').checked = v.active !== false;
    $id('pcNote').value = v.note || '';
    $id('pcProdSearch').value = '';

    pcPicked = new Set(v.products || []);
    renderPcCats(v.categories);
    renderPcProds();
    pcSyncScope();

    $id('promoModal').hidden = false;
    R.lockBg();
  }

  async function savePromo() {
    const p = pcCollect();

    if (!/^[A-Z0-9_-]{3,24}$/.test(p.code)) {
      return pcSetStatus('err', 'Код: 3–24 символи, лише латиниця, цифри, дефіс або підкреслення');
    }
    if (!p.value || p.value <= 0) return pcSetStatus('err', 'Вкажіть розмір знижки');
    if (p.type === 'percent' && p.value > 100) return pcSetStatus('err', 'Відсоток не може бути більшим за 100');
    if (p.scope === 'categories' && !p.categories.length) return pcSetStatus('err', 'Оберіть хоча б одну категорію');
    if (p.scope === 'products' && !p.products.length) return pcSetStatus('err', 'Оберіть хоча б один товар');
    if (p.startsAt && p.endsAt && p.startsAt > p.endsAt) {
      return pcSetStatus('err', 'Дата початку пізніша за дату завершення');
    }
    if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
      return pcSetStatus('err', 'Некоректна пошта клієнта');
    }
    if (!editingPromo && promosCache.some((x) => x.code === p.code)) {
      return pcSetStatus('err', 'Промокод ' + p.code + ' вже існує');
    }

    const doc = Object.assign({}, p);
    delete doc.code;
    if (!editingPromo) {
      doc.usedCount = 0;
      doc.created = firebase.firestore.FieldValue.serverTimestamp();
      doc.createdBy = (R.fb.user && R.fb.user.email) || '';
    }

    try {
      await R.fb.db.collection('promos').doc(p.code).set(doc, { merge: true });
      $id('promoModal').hidden = true;
      R.unlockBg();
      toast(editingPromo ? 'Промокод оновлено ✓' : 'Промокод створено ✓', 'success');
      editingPromo = null;
    } catch (e) {
      pcSetStatus('err', 'Не вдалося зберегти. Перевірте правила Firestore для колекції promos');
    }
  }

  function initPromos() {
    if (!$id('newPromoBtn')) return;

    $id('newPromoBtn').addEventListener('click', () => openPromoEditor(null));
    $id('pcSaveBtn').addEventListener('click', savePromo);

    promosBody().addEventListener('click', async (e) => {
      const card = e.target.closest('.a-promo');
      if (!card) return;
      const p = promosCache.find((x) => x.code === card.dataset.code);
      if (!p) return;

      if (e.target.closest('[data-promo-edit]')) {
        openPromoEditor(p);
      } else if (e.target.closest('[data-promo-copy]')) {
        copyText(p.code);
      } else if (e.target.closest('[data-promo-mail]')) {
        const btn = e.target.closest('[data-promo-mail]');
        btn.disabled = true;
        btn.textContent = 'Надсилаємо…';
        const res = await R.notify.sendPromoLetter({
          to: p.email,
          code: p.code,
          value: p.type === 'fixed' ? fmt(p.value) + ' грн' : (Number(p.value) || 0) + '%',
          terms: R.promoTerms ? R.promoTerms(p) : ''
        });
        btn.disabled = false;
        btn.textContent = 'Надіслати на пошту';
        if (res.ok) toast('Лист із промокодом надіслано на ' + p.email + ' ✓', 'success');
        else toast('Не вдалося надіслати: ' + res.description);
      } else if (e.target.closest('[data-promo-toggle]')) {
        try {
          await R.fb.db.collection('promos').doc(p.code).update({ active: p.active === false });
        } catch (err) {
          toast('Немає прав');
        }
      } else if (e.target.closest('[data-promo-del]')) {
        if (confirm('Видалити промокод ' + p.code + '?')) {
          try {
            await R.fb.db.collection('promos').doc(p.code).delete();
          } catch (err) {
            toast('Немає прав');
          }
        }
      }
    });

    const modal = $id('promoModal');
    modal.addEventListener('change', (e) => {
      if (e.target.id === 'pcScope') { pcSyncScope(); return; }
      // запамʼятовуємо вибір товару одразу — пошук його не скине
      const box = e.target.closest('#pcProds');
      if (box && e.target.type === 'checkbox') {
        if (e.target.checked) pcPicked.add(e.target.value);
        else pcPicked.delete(e.target.value);
      }
      pcPreview();
    });
    modal.addEventListener('input', (e) => {
      if (e.target.id === 'pcProdSearch') {
        pcProdFilter = e.target.value;
        renderPcProds();
      } else {
        pcPreview();
      }
    });
  }

  /* ============================================================
     ПАНЕЛЬ «СКЛАД»
     ============================================================ */

  let stockTab = 'stock';
  let stockSearch = '';
  let stockFilter = 'all';
  let restocksCache = [];
  let movesCache = [];
  let restockProductId = '';

  function stockBody() {
    return $id('stockBody');
  }

  function renderStockRoot() {
    if (!fbReady() || !R.fb.user) {
      stockBody().innerHTML = '<p class="ao-note">Спершу увійдіть акаунтом адміністратора.</p>';
      return;
    }
    if (!invUnsub) {
      stockBody().innerHTML = '<p class="ao-note">Завантажуємо залишки…</p>';
      subscribeInventory();
      loadRestocks();
    } else {
      renderStockUI();
    }
  }

  function subscribeInventory() {
    invUnsub = R.fb.db.collection('inventory').onSnapshot(
      (snap) => {
        inv = {};
        snap.forEach((d) => { inv[d.id] = d.data(); });
        if (currentView() === 'stock') renderStockUI();
      },
      (err) => {
        stopStock();
        stockBody().innerHTML =
          '<p class="ao-note">Не вдалося завантажити склад' +
          (err && err.code === 'permission-denied' ? ': немає прав.' : '. Перевірте правила Firestore.') +
          '</p>';
      }
    );
  }

  function stopStock() {
    if (invUnsub) {
      invUnsub();
      invUnsub = null;
    }
  }

  async function loadRestocks() {
    try {
      const snap = await R.fb.db.collection('restocks').orderBy('expected').limit(100).get();
      restocksCache = snap.docs.map((d) => Object.assign({ _id: d.id }, d.data()));
      if (currentView() === 'stock' && stockTab === 'restock') renderStockUI();
    } catch (e) { /* порожній список */ }
  }

  async function loadMoves() {
    try {
      const snap = await R.fb.db.collection('stock_moves').orderBy('ts', 'desc').limit(80).get();
      movesCache = snap.docs.map((d) => d.data());
      if (stockTab === 'moves') renderStockUI();
    } catch (e) { /* порожній список */ }
  }

  function productRowState(p) {
    const total = totalQty(p);
    if (!hasInvDoc(p.id)) return { cls: '', label: 'не ведеться' };
    if (total <= 0) return { cls: 'is-out', label: 'немає' };
    if (isSized(p)) {
      const s = invOf(p.id).sizes || {};
      const lows = Object.keys(s).filter((k) => Number(s[k]) > 0 && Number(s[k]) <= LOW_AT);
      if (lows.length) return { cls: 'is-low', label: 'закінчується ' + lows.join(', ') };
    } else if (total <= LOW_AT) {
      return { cls: 'is-low', label: 'закінчується' };
    }
    return { cls: 'is-ok', label: 'в наявності' };
  }

  function stockRowHTML(p) {
    const state = productRowState(p);
    const total = totalQty(p);
    const inputs = isSized(p)
      ? R.config.allSizes.map((s) => {
          const v = sizeQty(p.id, s);
          return (
            '<label class="ao-qty' + (v < 0 ? ' is-neg' : '') + '">' +
              '<span>' + s + '</span>' +
              '<input type="number" data-stk-pid="' + esc(p.id) + '" data-stk-size="' + s + '" value="' + v + '">' +
            '</label>'
          );
        }).join('')
      : '<label class="ao-qty' + (unitQty(p.id) < 0 ? ' is-neg' : '') + '">' +
          '<span>шт</span>' +
          '<input type="number" data-stk-pid="' + esc(p.id) + '" value="' + unitQty(p.id) + '">' +
        '</label>';

    return (
      '<div class="ao-stockrow ' + state.cls + '">' +
        '<img src="' + esc((p.images && p.images[0]) || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="ao-stockrow__info">' +
          '<b>' + esc(p.name) + (p.hidden ? ' <i class="ao-tag">сховано з сайту</i>' : '') + '</b>' +
          '<span>' + esc(p.id) + ' · ' + fmt(p.price) + ' грн · <em class="ao-state">' + state.label + '</em></span>' +
        '</div>' +
        '<div class="ao-stockrow__qty">' + inputs + '</div>' +
        '<div class="ao-stockrow__total"><b>' + fmt(total) + '</b><span>шт</span></div>' +
      '</div>'
    );
  }

  function stockListHTML() {
    const all = products();
    const q = stockSearch.toLowerCase();

    let shown = 0;
    const sections = categories().map((cat) => {
      const items = all.filter((p) => {
        if (p.category !== cat.id) return false;
        if (q && !(p.name + ' ' + p.id).toLowerCase().includes(q)) return false;
        const st = productRowState(p);
        if (stockFilter === 'low' && st.cls !== 'is-low') return false;
        if (stockFilter === 'out' && st.cls !== 'is-out') return false;
        return true;
      });
      if (!items.length) return '';
      shown += items.length;
      return '<h5 class="ao-cat-title">' + esc(cat.title) + '</h5>' + items.map(stockRowHTML).join('');
    }).join('');

    return shown ? sections : '<div class="a-empty">Нічого не знайдено.</div>';
  }

  function stockStatsHTML() {
    const all = products();
    let units = 0;
    let value = 0;
    let low = 0;
    let out = 0;
    all.forEach((p) => {
      const t = totalQty(p);
      units += t;
      value += t * (Number(p.price) || 0);
      const st = productRowState(p);
      if (st.cls === 'is-low') low++;
      if (st.cls === 'is-out') out++;
    });
    const pendingArrivals = restocksCache.filter((r) => r.status === 'pending').length;
    return (
      '<div class="ao-stats">' +
        '<div class="ao-stat"><b>' + fmt(units) + '</b><span>одиниць на складі</span></div>' +
        '<div class="ao-stat"><b>' + fmt(value) + ' грн</b><span>вартість залишків</span></div>' +
        '<div class="ao-stat' + (low ? ' is-warn' : '') + '"><b>' + fmt(low) + '</b><span>закінчується</span></div>' +
        '<div class="ao-stat' + (out ? ' is-bad' : '') + '"><b>' + fmt(out) + '</b><span>немає в наявності</span></div>' +
        '<div class="ao-stat"><b>' + fmt(pendingArrivals) + '</b><span>очікується приходів</span></div>' +
      '</div>'
    );
  }

  function restockFormHTML() {
    const all = products();
    const selected = productById(restockProductId) || null;
    const qtyInputs = !selected
      ? '<p class="ao-note">Оберіть товар, щоб вказати кількість.</p>'
      : (isSized(selected)
          ? R.config.allSizes.map((s) =>
              '<label class="ao-qty"><span>' + s + '</span><input type="number" min="0" value="0" data-rst-size="' + s + '"></label>'
            ).join('')
          : '<label class="ao-qty"><span>шт</span><input type="number" min="0" value="0" data-rst-qty></label>');

    return (
      '<form class="ao-restock-form" id="restockForm">' +
        '<h5>Новий прихід</h5>' +
        '<div class="ao-restock-form__row">' +
          '<div class="acombo a-nopick a-rstpick">' +
            '<div class="acombo__box">' +
              (selected ? productChipHTML(selected) : '') +
              '<input id="rstProduct" value="' + esc(selected ? selected.name : '') + '" ' +
                'placeholder="товар — назва або артикул" autocomplete="off" spellcheck="false" ' +
                'role="combobox" aria-expanded="false" data-ref="' + esc(restockProductId) + '">' +
              '<span class="acombo__spin" hidden></span>' +
              '<ul class="acombo__list" role="listbox" hidden></ul>' +
            '</div>' +
          '</div>' +
          '<input type="date" id="rstDate" value="' + todayISO() + '" title="Очікувана дата приходу">' +
        '</div>' +
        '<div class="ao-restock-form__qty" id="rstQtyBox">' + qtyInputs + '</div>' +
        '<input id="rstNote" placeholder="Нотатка: постачальник, партія тощо (необовʼязково)">' +
        '<button class="btn btn--primary btn--sm" type="submit">Додати прихід</button>' +
      '</form>'
    );
  }

  function restockCardHTML(r) {
    const p = productById(r.productId);
    const overdue = r.status === 'pending' && r.expected && r.expected < todayISO();
    const qtyText = r.items
      ? Object.keys(r.items).filter((k) => r.items[k] > 0).map((k) => k + ': ' + r.items[k]).join(', ')
      : (r.qty ? r.qty + ' шт' : '');
    const dateText = r.expected
      ? new Date(r.expected + 'T00:00:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    return (
      '<div class="ao-restock' + (overdue ? ' is-overdue' : '') + (r.status === 'received' ? ' is-received' : '') + '" data-id="' + esc(r._id) + '">' +
        '<div class="ao-restock__info">' +
          '<b>' + esc(r.productName || (p && p.name) || r.productId) + '</b>' +
          '<span>' + esc(qtyText) + (r.note ? ' · ' + esc(r.note) : '') + '</span>' +
          '<span class="ao-restock__date">' +
            (r.status === 'received' ? 'оприбутковано' : (overdue ? '⚠ очікувався ' : 'очікується ')) + esc(dateText) +
          '</span>' +
        '</div>' +
        (r.status === 'pending'
          ? '<div class="ao-restock__actions">' +
              '<button class="btn btn--primary btn--sm" data-rst-receive type="button">Оприбуткувати</button>' +
              '<button class="btn btn--ghost btn--sm ao-danger" data-rst-del type="button">✕</button>' +
            '</div>'
          : '') +
      '</div>'
    );
  }

  function restockListHTML() {
    const pending = restocksCache.filter((r) => r.status === 'pending');
    const received = restocksCache.filter((r) => r.status === 'received').slice(-10).reverse();
    return (
      '<h5>Очікуються</h5>' +
      (pending.length ? pending.map(restockCardHTML).join('') : '<div class="a-empty">Запланованих приходів немає.</div>') +
      (received.length ? '<h5>Останні оприбутковані</h5>' + received.map(restockCardHTML).join('') : '')
    );
  }

  function movesHTML() {
    if (!movesCache.length) {
      return '<div class="a-empty">Журнал руху порожній. Тут фіксується кожна зміна залишків: списання під замовлення, приходи та ручні коригування.</div>';
    }
    return (
      '<div class="ao-moves">' +
        movesCache.map((m) => {
          const d = m.ts && m.ts.toDate
            ? m.ts.toDate().toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
            : '';
          const delta = Number(m.delta) || 0;
          return (
            '<div class="ao-move">' +
              '<span class="ao-move__delta ' + (delta >= 0 ? 'is-plus' : 'is-minus') + '">' + (delta > 0 ? '+' : '') + delta + '</span>' +
              '<div class="ao-move__info">' +
                '<b>' + esc(m.productName || m.productId) + (m.size ? ' · ' + esc(m.size) : '') + '</b>' +
                '<span>' + esc(MOVE_REASONS[m.reason] || m.reason) + (m.ref ? ' · ' + esc(m.ref) : '') + (m.by ? ' · ' + esc(m.by) : '') + '</span>' +
              '</div>' +
              '<span class="ao-move__date">' + esc(d) + '</span>' +
            '</div>'
          );
        }).join('') +
      '</div>'
    );
  }

  function renderStockUI() {
    const tab = (id, title) =>
      '<button class="ao-chip' + (stockTab === id ? ' is-active' : '') + '" data-stk-tab="' + id + '" type="button">' + title + '</button>';

    let content = '';
    if (stockTab === 'stock') {
      content =
        stockStatsHTML() +
        '<div class="ao-filterbar">' +
          '<div class="ao-chips">' +
            '<button class="ao-chip' + (stockFilter === 'all' ? ' is-active' : '') + '" data-stk-filter="all" type="button">Всі</button>' +
            '<button class="ao-chip' + (stockFilter === 'low' ? ' is-active' : '') + '" data-stk-filter="low" type="button">Закінчуються</button>' +
            '<button class="ao-chip' + (stockFilter === 'out' ? ' is-active' : '') + '" data-stk-filter="out" type="button">Немає</button>' +
          '</div>' +
          '<input class="ao-search" id="aoStockSearch" placeholder="Пошук: назва або артикул" value="' + esc(stockSearch) + '">' +
        '</div>' +
        '<p class="ao-note">Змініть число — воно збережеться автоматично, а сайт одразу покаже «Продано» чи «Закінчується» (поріг — ' + LOW_AT + ' шт). Кожна зміна фіксується в журналі «Рух».</p>' +
        '<div class="ao-stocklist">' + stockListHTML() + '</div>';
    } else if (stockTab === 'restock') {
      content = restockFormHTML() + restockListHTML();
    } else {
      content = movesHTML();
    }

    stockBody().innerHTML =
      '<div class="ao-toolbar">' +
        '<span class="ao-live">● live</span>' +
        '<div class="ao-chips">' + tab('stock', 'Залишки') + tab('restock', 'Прихід') + tab('moves', 'Рух') + '</div>' +
      '</div>' +
      content;

    showActiveChips(stockBody());

    /* Пошук товару для приходу — той самий список із фото,
       що в ручному замовленні */
    const rst = $id('rstProduct');
    if (rst && R.attachCombo) {
      R.attachCombo(rst, {
        minChars: 0,
        openOnFocus: true,
        load: (q) => {
          const needle = q.trim().toLowerCase();
          return products().filter((x) =>
            !needle ||
            x.name.toLowerCase().includes(needle) ||
            x.id.toLowerCase().includes(needle) ||
            catName(x.category).toLowerCase().includes(needle));
        },
        render: (x) => ({
          html: productOptionHTML(x),
          cls: 'a-pick',
          value: x.name,
          ref: x.id
        }),
        onPick: (x) => {
          restockProductId = x.id;
          renderStockUI();
        },
        empty: 'admin.noProduct'
      });
    }

    const search = $id('aoStockSearch');
    if (search) {
      search.addEventListener('input', () => {
        stockSearch = search.value;
        stockBody().querySelector('.ao-stocklist').innerHTML = stockListHTML();
      });
    }
  }

  async function setStockValue(pid, size, value) {
    const p = productById(pid);
    const oldVal = size ? sizeQty(pid, size) : unitQty(pid);
    const newVal = Math.trunc(Number(value) || 0);
    if (newVal === oldVal) return;

    try {
      const batch = R.fb.db.batch();
      const ref = R.fb.db.collection('inventory').doc(pid);
      const upd = { updated: firebase.firestore.FieldValue.serverTimestamp() };
      if (size) upd.sizes = { [size]: newVal };
      else upd.qty = newVal;
      batch.set(ref, upd, { merge: true });
      logMove(batch, {
        productId: pid,
        productName: (p && p.name) || pid,
        size: size || null,
        delta: newVal - oldVal,
        reason: 'manual',
        ref: ''
      });
      await batch.commit();
    } catch (err) {
      toast('Не вдалося зберегти залишок');
      renderStockUI();
    }
  }

  async function createRestock() {
    const pid = restockProductId;
    const p = productById(pid);
    if (!p) {
      toast('Оберіть товар');
      return;
    }
    const expected = $id('rstDate').value || todayISO();
    const note = $id('rstNote').value.trim();

    const doc = {
      productId: pid,
      productName: p.name,
      expected: expected,
      note: note,
      status: 'pending',
      created: firebase.firestore.FieldValue.serverTimestamp(),
      by: (R.fb.user && R.fb.user.email) || ''
    };

    if (isSized(p)) {
      const items = {};
      let total = 0;
      document.querySelectorAll('#rstQtyBox [data-rst-size]').forEach((inp) => {
        const v = Math.max(0, Math.trunc(Number(inp.value) || 0));
        if (v > 0) {
          items[inp.dataset.rstSize] = v;
          total += v;
        }
      });
      if (!total) {
        toast('Вкажіть кількість хоча б для одного розміру');
        return;
      }
      doc.items = items;
    } else {
      const v = Math.max(0, Math.trunc(Number((document.querySelector('#rstQtyBox [data-rst-qty]') || {}).value) || 0));
      if (!v) {
        toast('Вкажіть кількість');
        return;
      }
      doc.qty = v;
    }

    try {
      await R.fb.db.collection('restocks').add(doc);
      toast('Прихід заплановано ✓', 'success');
      restockProductId = '';
      loadRestocks().then(renderStockUI);
    } catch (err) {
      toast('Не вдалося зберегти прихід');
    }
  }

  async function receiveRestock(r) {
    const p = productById(r.productId);
    try {
      const batch = R.fb.db.batch();
      const invRef = R.fb.db.collection('inventory').doc(r.productId);
      const upd = { updated: firebase.firestore.FieldValue.serverTimestamp() };

      if (r.items) {
        upd.sizes = {};
        Object.keys(r.items).forEach((s) => {
          const v = Number(r.items[s]) || 0;
          if (!v) return;
          upd.sizes[s] = firebase.firestore.FieldValue.increment(v);
          logMove(batch, {
            productId: r.productId,
            productName: r.productName || (p && p.name) || r.productId,
            size: s,
            delta: v,
            reason: 'restock',
            ref: r.note || ''
          });
        });
      } else if (r.qty) {
        upd.qty = firebase.firestore.FieldValue.increment(Number(r.qty) || 0);
        logMove(batch, {
          productId: r.productId,
          productName: r.productName || (p && p.name) || r.productId,
          size: null,
          delta: Number(r.qty) || 0,
          reason: 'restock',
          ref: r.note || ''
        });
      }

      batch.set(invRef, upd, { merge: true });
      batch.update(R.fb.db.collection('restocks').doc(r._id), {
        status: 'received',
        receivedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await batch.commit();

      toast('Оприбутковано ✓ Залишки оновлено', 'success');
      loadRestocks().then(renderStockUI);
    } catch (err) {
      toast('Не вдалося оприбуткувати');
    }
  }

  /* ============================================================
     НАЛАШТУВАННЯ: сповіщення + адміністратори
     ============================================================ */

  let adminsCache = [];
  let settingsTab = 'notify';

  async function loadAdmins() {
    try {
      const snap = await R.fb.db.collection('admins').get();
      adminsCache = snap.docs
        .map((d) => Object.assign({ email: d.id }, d.data()))
        .filter((a) => !FOUNDERS.includes(a.email));
    } catch (e) {
      adminsCache = [];
    }
    renderAdmins();
  }

  function renderAdmins() {
    const box = $id('settingsAdmins');
    if (!box) return;
    const me = ((R.fb.user && R.fb.user.email) || '').toLowerCase();

    box.innerHTML =
      '<p class="ao-note">Адміністратори мають повний доступ до каталогу, замовлень і складу. ' +
      'Вхід — через Google цим email. Постійних адміністраторів прибрати не можна (вони прописані в правилах бази).</p>' +

      '<div class="ao-admins">' +
        FOUNDERS.map((e) =>
          '<div class="ao-admin">' +
            '<span>' + esc(e) + (e === me ? ' <em>(це ви)</em>' : '') + '</span>' +
            '<i>постійний</i>' +
          '</div>'
        ).join('') +

        adminsCache.map((a) =>
          '<div class="ao-admin">' +
            '<span>' + esc(a.email) + (a.email === me ? ' <em>(це ви)</em>' : '') + '</span>' +
            (a.by ? '<i>додав ' + esc(a.by) + '</i>' : '') +
            '<button data-rmadmin="' + esc(a.email) + '" type="button" title="Прибрати">✕</button>' +
          '</div>'
        ).join('') +

        '<form class="ao-addadmin" id="addAdminForm">' +
          '<input id="newAdminEmail" type="email" placeholder="email нового адміністратора" autocomplete="off">' +
          '<button class="btn btn--primary btn--sm" type="submit">Додати</button>' +
        '</form>' +
      '</div>';
  }

  async function addAdmin() {
    const input = $id('newAdminEmail');
    const email = (input.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast('Введіть коректний email');
      return;
    }
    if (FOUNDERS.includes(email)) {
      toast('Цей email вже постійний адміністратор');
      return;
    }
    if (adminsCache.some((a) => a.email === email)) {
      toast('Такий адміністратор вже доданий');
      return;
    }
    try {
      await R.fb.db.collection('admins').doc(email).set({
        added: firebase.firestore.FieldValue.serverTimestamp(),
        by: (R.fb.user && R.fb.user.email) || ''
      });
      input.value = '';
      toast('Адміністратора додано ✓', 'success');
      loadAdmins();
    } catch (e) {
      toast('Немає прав додавати адміністраторів');
    }
  }

  /* Токен Telegram більше не редагується тут — він живе у
     змінних воркера. Старе значення з бази лише показуємо,
     щоб було що перенести, і даємо кнопку його прибрати. */
  let legacyTg = null;

  function settingsFromForm() {
    return {
      workerUrl: R.normalizeUrl($id('stWorkerUrl').value),
      fsEmail: $id('stFsEmail').value.trim()
    };
  }

  /* Для перевірок додаємо старі значення з бази — щоб кнопки
     працювали і до переносу токена у воркер. У Firestore таке
     не пишемо: інакше токен потрапив би у публічний документ. */
  function settingsForTest() {
    return Object.assign(settingsFromForm(), legacyTg || {});
  }

  function setSettingsStatus(cls, text) {
    const el = $id('settingsStatus');
    el.hidden = false;
    el.className = 'a-publish__status ' + cls;
    el.textContent = text;
  }

  function showSettingsTab(tab) {
    settingsTab = tab;
    $id('settingsNotify').hidden = tab !== 'notify';
    $id('settingsAdmins').hidden = tab !== 'admins';
    // Адміністратори зберігаються одразу — кнопка збереження тут зайва
    $id('saveSettingsBtn').hidden = tab !== 'notify';
    document.querySelectorAll('[data-set-tab]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.setTab === tab);
    });
  }

  /* Залишки старого способу: токен у базі. Показуємо, щоб адмін
     переніс значення у Cloudflare, і одразу даємо його прибрати. */
  function renderLegacyTg() {
    const box = $id('tgLegacy');
    if (!box) return;
    const has = legacyTg && (legacyTg.tgToken || legacyTg.tgChatId);
    box.hidden = !has;
    if (!has) return;

    $id('tgLegacyVals').innerHTML =
      (legacyTg.tgToken
        ? '<div><span>TG_TOKEN</span><code>' + esc(legacyTg.tgToken) + '</code>' +
          '<button data-copy-legacy="' + esc(legacyTg.tgToken) + '" type="button">Копіювати</button></div>'
        : '') +
      (legacyTg.tgChatId
        ? '<div><span>TG_CHAT</span><code>' + esc(legacyTg.tgChatId) + '</code>' +
          '<button data-copy-legacy="' + esc(legacyTg.tgChatId) + '" type="button">Копіювати</button></div>'
        : '');
  }

  async function wipeLegacyTg() {
    if (!confirm('Прибрати токен і Chat ID із бази?\n\nПеред цим переконайтесь, що тестове ' +
      'повідомлення через воркер уже приходить — інакше сповіщення перестануть надходити.')) return;
    try {
      await R.fb.db.collection('settings').doc('notify').update({
        tgToken: firebase.firestore.FieldValue.delete(),
        tgChatId: firebase.firestore.FieldValue.delete()
      });
      legacyTg = null;
      renderLegacyTg();
      R.notify.clearCache();
      setSettingsStatus('ok', 'Токен прибрано з бази ✓ Тепер він є лише у воркері');
    } catch (e) {
      setSettingsStatus('err', 'Не вдалося прибрати токен — спробуйте ще раз');
    }
  }

  /* Що саме налаштовано у воркері — без цього легко здогадуватись,
     чому лист або повідомлення не дійшли */
  async function checkWorker(quiet) {
    const box = $id('workerStatus');
    const url = R.normalizeUrl($id('stWorkerUrl').value);
    if (!url) {
      box.hidden = true;
      if (!quiet) setSettingsStatus('err', 'Спершу вкажіть адресу Worker');
      return;
    }

    box.hidden = false;
    box.className = 'a-wstatus is-wait';
    box.textContent = 'Питаємо воркер…';

    const res = await R.notify.workerStatus({ workerUrl: url });
    if (!res.ok) {
      box.className = 'a-wstatus is-err';
      box.textContent = 'Воркер не відповів: ' + (res.description || 'невідома помилка');
      return;
    }

    /* state: 'on' | 'off' | 'skip' — «skip» для того, що не задане,
       але й не обовʼязкове: червоний хрестик там лише лякає */
    const line = (state, label, extra) =>
      '<div class="is-' + state + '">' +
      (state === 'on' ? '✓' : state === 'off' ? '✕' : '•') + ' ' +
      esc(label) + (extra ? ' <span>' + esc(extra) + '</span>' : '') + '</div>';

    box.className = 'a-wstatus ' + (res.resend && res.telegram && res.chats ? 'is-ok' : 'is-warn');
    box.innerHTML =
      line(res.resend ? 'on' : 'off', 'Resend (листи покупцям)',
        res.mailFrom || 'RESEND_KEY не задано') +
      line(res.telegram && res.chats > 0 ? 'on' : 'off', 'Telegram (сповіщення вам)',
        !res.telegram ? 'TG_TOKEN не задано'
          : !res.chats ? 'TG_CHAT не задано'
          : 'отримувачів: ' + res.chats) +
      line(res.adminKey ? 'on' : 'skip', 'ADMIN_KEY — службові кнопки під захистом',
        res.adminKey ? '' : 'не заданий (необовʼязково)');
  }

  async function openSettings() {
    $id('settingsModal').hidden = false;
    R.lockBg();
    $id('settingsStatus').hidden = true;
    $id('workerStatus').hidden = true;
    $id('tgChatsBox').hidden = true;
    showSettingsTab('notify');
    loadAdmins();

    const s = (await R.notify.loadAdmin()) || {};
    $id('stWorkerUrl').value = s.workerUrl || '';
    $id('stFsEmail').value = s.fsEmail || '';
    $id('stWorkerKey').value = R.workerKey();

    legacyTg = (s.tgToken || s.tgChatId) ? { tgToken: s.tgToken || '', tgChatId: s.tgChatId || '' } : null;
    renderLegacyTg();

    // Публічну копію створюємо самі: інакше сайт, де правила вже
    // оновлені, а «Зберегти» ще не натискали, лишиться без адреси
    // воркера — і замовлення прийдуть без листа й сповіщення
    if (s.workerUrl || s.fsEmail) {
      R.fb.db.collection('settings').doc('public').set({
        workerUrl: s.workerUrl || '',
        fsEmail: s.fsEmail || ''
      }, { merge: true }).catch(() => { /* немає прав — покаже під час збереження */ });
    }

    if (s.workerUrl) checkWorker(true);
  }

  async function saveSettings() {
    const data = settingsFromForm();
    R.workerKey($id('stWorkerKey').value.trim());
    try {
      // Публічну копію читає браузер покупця: там лише адреса
      // воркера й пошта магазину, жодних ключів
      const batch = R.fb.db.batch();
      batch.set(R.fb.db.collection('settings').doc('notify'), data, { merge: true });
      batch.set(R.fb.db.collection('settings').doc('public'), data, { merge: true });
      await batch.commit();

      R.notify.clearCache();
      setSettingsStatus('ok', 'Налаштування збережено ✓');
      toast('Налаштування збережено ✓', 'success');
    } catch (e) {
      setSettingsStatus('err', 'Немає прав зберігати налаштування');
    }
  }

  /* Пояснення типових помилок Telegram українською */
  function tgErrorHint(description) {
    const d = String(description || '').toLowerCase();
    if (d.includes('tg_token')) {
      return 'У воркері немає змінної TG_TOKEN: Cloudflare → ваш воркер → Settings → ' +
        'Variables and Secrets → Add → тип Secret → потім обовʼязково Deploy';
    }
    if (d.includes('tg_chat')) {
      return 'У воркері немає змінної TG_CHAT. Натисніть «Показати Chat ID», ' +
        'скопіюйте значення у цю змінну і натисніть Deploy';
    }
    if (d.includes('admin_key')) {
      return 'Невірний ключ адміністратора — впишіть те саме значення, що у змінній ADMIN_KEY воркера';
    }
    if (d.includes('email отримувача') || d.includes('порожнє замовлення')) {
      return 'Код воркера застарілий — замініть його вмістом new/worker/worker.js і натисніть Deploy';
    }
    if (d.includes('воркер')) return description;
    if (d.includes("bots can't send messages to bots") || d.includes('bot can')) {
      return 'У TG_CHAT вказано ID бота замість вашого. Натисніть «Показати Chat ID» — там правильні значення';
    }
    if (d.includes('chat not found')) {
      return 'Чат не знайдено: напишіть своєму боту будь-що (натисніть Start) і спробуйте ще раз';
    }
    if (d.includes('unauthorized')) {
      return 'Невірний токен бота — перевірте значення TG_TOKEN у воркері (видає @BotFather)';
    }
    if (d.includes('blocked')) {
      return 'Бот заблокований у вашому Telegram — розблокуйте його';
    }
    return description || 'Перевірте змінні TG_TOKEN і TG_CHAT у воркері';
  }

  /* ============================================================
     ПОДІЇ
     ============================================================ */

  function updateUserChip() {
    const chip = $id('adminUserChip');
    if (!chip) return;
    const user = R.fb && R.fb.user;
    chip.hidden = !user;
    if (user) chip.textContent = user.email || '';
  }

  /* Меню «⋯» у шапці на телефоні */
  function initBarMenu() {
    const menu = $id('abarMenu');
    const btn = $id('abarMoreBtn');
    if (!menu || !btn) return;

    const close = () => {
      menu.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Клік по пункту меню або поза ним закриває його
    menu.addEventListener('click', (e) => {
      if (e.target.closest('.abar__drop')) close();
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  function init() {
    if (!$id('viewCatalog')) return;

    window.addEventListener('hashchange', showView);
    showView();
    initBarMenu();

    initPromos();
    $id('settingsBtn').addEventListener('click', openSettings);
    $id('saveSettingsBtn').addEventListener('click', saveSettings);
    $id('gateLoginBtn').addEventListener('click', signInGoogle);
    $id('gateLogoutBtn').addEventListener('click', () => R.fb.auth.signOut());

    /* ---- ручне замовлення ---- */

    $id('newOrderBtn').addEventListener('click', openNewOrder);
    $id('noAddItem').addEventListener('click', addNoRow);
    $id('noCreateBtn').addEventListener('click', createManualOrder);

    noModal().addEventListener('click', (e) => {
      const del = e.target.closest('[data-no-del]');
      if (del) {
        const rowEl = del.closest('[data-row]');
        noRows = noRows.filter((r) => r.uid !== rowEl.dataset.row);
        if (!noRows.length) addNoRow();
        else renderNoItems();
      }
    });

    noModal().addEventListener('change', (e) => {
      const rowEl = e.target.closest('[data-row]');

      if (rowEl) {
        const row = noRows.find((r) => r.uid === rowEl.dataset.row);
        if (!row) return;

        if (e.target.matches('[data-no-size]')) row.size = e.target.value;
        if (e.target.matches('[data-no-qty]')) row.qty = Math.max(1, Math.trunc(Number(e.target.value) || 1));
        if (e.target.matches('[data-no-price]')) row.price = Math.max(0, Math.trunc(Number(e.target.value) || 0));
        renderNoItems();
        return;
      }

      if (['noDiscount', 'noShipping'].includes(e.target.id)) renderNoTotal();
    });

    noModal().addEventListener('input', (e) => {
      if (['noDiscount', 'noShipping'].includes(e.target.id)) renderNoTotal();
    });

    /* ---- налаштування ---- */

    $id('settingsModal').addEventListener('click', async (e) => {
      const tabBtn = e.target.closest('[data-set-tab]');
      if (tabBtn) {
        showSettingsTab(tabBtn.dataset.setTab);
        return;
      }
      const cp = e.target.closest('[data-copy-legacy]');
      if (cp) {
        copyText(cp.dataset.copyLegacy);
        toast('Скопійовано ✓', 'success');
        return;
      }
      const rm = e.target.closest('[data-rmadmin]');
      if (rm) {
        const email = rm.dataset.rmadmin;
        if (confirm('Прибрати адміністратора ' + email + '?')) {
          try {
            await R.fb.db.collection('admins').doc(email).delete();
            toast('Адміністратора прибрано');
            loadAdmins();
          } catch (err) {
            toast('Немає прав');
          }
        }
      }
    });

    $id('settingsModal').addEventListener('submit', (e) => {
      if (e.target.id === 'addAdminForm') {
        e.preventDefault();
        addAdmin();
      }
    });

    $id('workerCheckBtn').addEventListener('click', () => {
      R.workerKey($id('stWorkerKey').value.trim());
      checkWorker(false);
    });

    $id('tgWipeBtn').addEventListener('click', wipeLegacyTg);

    $id('tgDetectBtn').addEventListener('click', async () => {
      const box = $id('tgChatsBox');
      R.workerKey($id('stWorkerKey').value.trim());

      box.hidden = false;
      box.className = 'a-wstatus is-wait';
      box.textContent = 'Питаємо Telegram, хто писав боту…';

      const res = await R.notify.detectChats(settingsForTest());
      if (!res.ok) {
        box.className = 'a-wstatus is-err';
        box.textContent = tgErrorHint(res.description);
        return;
      }

      const ids = res.chats.map((c) => c.id).join(', ');
      box.className = 'a-wstatus is-ok';
      box.innerHTML =
        '<p>Впишіть це у змінну <code>TG_CHAT</code> вашого воркера й натисніть <b>Deploy</b>:</p>' +
        '<div class="a-legacy"><div><code>' + esc(ids) + '</code>' +
          '<button data-copy-legacy="' + esc(ids) + '" type="button">Копіювати</button></div></div>' +
        '<ul>' + res.chats.map((c) =>
          '<li>' + esc(c.id) + ' — ' + esc(c.name || 'без назви') +
          (c.isGroup ? ' <b>(група)</b>' : '') + '</li>').join('') + '</ul>';
    });

    $id('tgTestBtn').addEventListener('click', async () => {
      R.workerKey($id('stWorkerKey').value.trim());
      setSettingsStatus('wait', 'Надсилаємо тест у Telegram…');

      const res = await R.notify.testTelegram(settingsForTest());
      const where = res.via === 'direct' ? ' (напряму з браузера — токен ще в базі)' : '';

      if (res.sent > 0 && res.sent === res.total) {
        setSettingsStatus('ok', 'Надіслано отримувачам: ' + res.sent + where + ' ✓ Перевірте Telegram');
      } else if (res.sent > 0) {
        setSettingsStatus('err', 'Надіслано ' + res.sent + ' із ' + res.total +
          '. Не вдалося: ' + tgErrorHint(res.description));
      } else {
        setSettingsStatus('err', tgErrorHint(res.workerError || res.description));
      }
    });

    $id('fsTestBtn').addEventListener('click', async () => {
      const to = $id('fsTestEmail').value.trim();
      if (!to) {
        setSettingsStatus('err', 'Вкажіть email для тесту');
        return;
      }
      setSettingsStatus('wait', 'Надсилаємо тестовий лист…');
      const res = await R.notify.testEmail(settingsForTest(), to);
      if (res.ok && res.via === 'worker') {
        setSettingsStatus('ok', 'Фірмовий лист надіслано через Worker ✓ Перевірте пошту (і папку Спам)');
      } else if (res.ok && res.workerError) {
        // воркер не спрацював — лист пішов резервним способом
        setSettingsStatus('err', 'Worker не спрацював (' + res.workerError +
          '). Лист надіслано простим текстом через FormSubmit');
      } else if (res.ok) {
        setSettingsStatus('ok', 'Лист надіслано через FormSubmit ✓ Перевірте пошту (і папку Спам)');
      } else if (res.needsActivation) {
        setSettingsStatus('wait',
          'Потрібна разова активація: відкрийте пошту ' + ($id('stFsEmail').value.trim() || 'магазину') +
          ', знайдіть лист від FormSubmit і натисніть «Activate Form». Після цього натисніть «Тест» ще раз.');
      } else {
        setSettingsStatus('err', res.description || 'Не вдалося надіслати');
      }
    });

    document.addEventListener('auth:changed', () => {
      updateUserChip();
      refreshGate();
      if (!R.fb.user) stopCloud();
    });
    updateUserChip();
    refreshGate();

    if (fbReady()) {
      R.fb.auth.getRedirectResult().catch((err) => {
        const status = $id('gateStatus');
        if (status) status.textContent = R.fb.errorText(err);
      });
    }

    /* ---- замовлення ---- */

    ordersBody().addEventListener('click', async (e) => {
      const periodBtn = e.target.closest('[data-period]');
      if (periodBtn) {
        F.period = periodBtn.dataset.period;
        F.limit = PAGE_SIZE;
        if (F.period === 'custom' && !F.from) {
          const d = new Date();
          d.setDate(d.getDate() - 6);
          F.from = localISO(d);
          F.to = todayISO();
        }
        renderOrders();
        return;
      }

      const statusBtn = e.target.closest('[data-status-filter]');
      if (statusBtn) {
        F.status = statusBtn.dataset.statusFilter;
        F.limit = PAGE_SIZE;
        renderOrders();
        return;
      }

      if (e.target.closest('[data-more]')) {
        F.limit += PAGE_SIZE;
        renderOrders();
        return;
      }

      if (e.target.closest('[data-export]')) {
        exportCSV();
        return;
      }

      if (e.target.closest('[data-print]')) {
        printOrders(filteredOrders().filter((o) => selection.has(o._id)));
        return;
      }

      if (e.target.closest('[data-clear-sel]')) {
        selection.clear();
        renderOrders();
        return;
      }

      const bulkBtn = e.target.closest('[data-bulk-status]');
      if (bulkBtn) {
        bulkStatus(bulkBtn.dataset.bulkStatus);
        return;
      }

      const card = e.target.closest('.ao-card');
      if (!card) return;
      const order = ordersCache.find((o) => o._id === card.dataset.id);
      if (!order) return;

      if (e.target.closest('[data-toggle]')) {
        if (expanded.has(order._id)) expanded.delete(order._id);
        else expanded.add(order._id);
        renderOrders();
        return;
      }

      const nextBtn = e.target.closest('[data-next]');
      if (nextBtn) {
        applyStatus(order, nextBtn.dataset.next);
        return;
      }

      if (e.target.closest('[data-copy]')) {
        copyText(order.message || '');
      } else if (e.target.closest('[data-print-one]')) {
        printOrders([order]);
      } else if (e.target.closest('[data-del]')) {
        if (confirm('Видалити замовлення №' + order.num + '?\n\nСписаний товар автоматично НЕ повернеться на склад — спершу переведіть замовлення у «Скасовано», якщо потрібне повернення залишків.')) {
          try {
            selection.delete(order._id);
            await R.fb.db.collection('orders').doc(order._id).delete();
          } catch (err) {
            toast('Немає прав видаляти');
          }
        }
      }
    });

    ordersBody().addEventListener('change', (e) => {
      const card = e.target.closest('.ao-card');
      if (!card) return;
      const order = ordersCache.find((o) => o._id === card.dataset.id);
      if (!order) return;

      if (e.target.matches('[data-pick]')) {
        if (e.target.checked) selection.add(order._id);
        else selection.delete(order._id);
        renderOrders();
        return;
      }

      if (e.target.matches('[data-ao-status]')) {
        applyStatus(order, e.target.value);
        return;
      }

      if (e.target.matches('[data-ao-ttn]')) {
        R.fb.db.collection('orders').doc(order._id)
          .update({ ttn: e.target.value.trim() })
          .then(() => toast('ТТН збережено — покупець бачить його в кабінеті ✓', 'success'))
          .catch(() => toast('Не вдалося зберегти ТТН'));
        return;
      }

      if (e.target.matches('[data-ao-note]')) {
        R.fb.db.collection('orders').doc(order._id)
          .update({ note: e.target.value.trim() })
          .then(() => toast('Нотатку збережено ✓', 'success'))
          .catch(() => toast('Не вдалося зберегти нотатку'));
      }
    });

    /* ---- склад ---- */

    stockBody().addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-stk-tab]');
      if (tabBtn) {
        stockTab = tabBtn.dataset.stkTab;
        if (stockTab === 'moves') loadMoves();
        if (stockTab === 'restock') loadRestocks();
        renderStockUI();
        return;
      }

      const filterBtn = e.target.closest('[data-stk-filter]');
      if (filterBtn) {
        stockFilter = filterBtn.dataset.stkFilter;
        renderStockUI();
        return;
      }

      const restockEl = e.target.closest('.ao-restock');
      if (restockEl) {
        const r = restocksCache.find((x) => x._id === restockEl.dataset.id);
        if (!r) return;
        if (e.target.closest('[data-rst-receive]')) {
          receiveRestock(r);
        } else if (e.target.closest('[data-rst-del]')) {
          if (confirm('Видалити запланований прихід?')) {
            R.fb.db.collection('restocks').doc(r._id).delete()
              .then(() => loadRestocks().then(renderStockUI))
              .catch(() => toast('Немає прав'));
          }
        }
      }
    });

    stockBody().addEventListener('change', (e) => {
      if (e.target.matches('[data-stk-pid]')) {
        setStockValue(e.target.dataset.stkPid, e.target.dataset.stkSize || null, e.target.value);
        return;
      }
    });

    stockBody().addEventListener('submit', (e) => {
      if (e.target.id === 'restockForm') {
        e.preventDefault();
        createRestock();
      }
    });
  }

  init();
})();
