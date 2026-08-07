/* ============================================================
   REYTER — admin.js
   Адмінка каталогу: категорії, товари, чернетка в браузері,
   експорт data.js та публікація через GitHub API
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  const KEY_DRAFT = 'reyter:admin:draft';
  const KEY_TOKEN = 'reyter:admin:token';

  const GH = {
    owner: 'patzmaxim0407-png',
    repo: 'reyter',
    branch: 'main',
    path: 'new/js/data.js'
  };

  const ALL_SIZES = R.config.allSizes;

  /* ---------- Стан ---------- */

  function published() {
    return JSON.parse(JSON.stringify({
      categories: R.categories,
      products: R.products
    }));
  }

  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY_DRAFT));
      if (d && Array.isArray(d.categories) && Array.isArray(d.products)) return d;
    } catch (e) { /* пошкоджена чернетка */ }
    return null;
  }

  let state = loadDraft() || published();
  let baseline = JSON.stringify(published());
  let currentCat = 'all';
  let editingId = null; // артикул товару, що редагується (null — новий)

  // Доступ до чернетки для панелі складу (другий модуль цього файлу)
  R.adminGetState = function () { return state; };

  function persist() {
    localStorage.setItem(KEY_DRAFT, JSON.stringify(state));
    updateDirty();
  }

  function updateDirty() {
    const dirty = JSON.stringify(state) !== baseline;
    document.getElementById('dirtyBadge').hidden = !dirty;
  }

  /* ---------- Хелпери ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(n) {
    return Number(n).toLocaleString('uk-UA');
  }

  function toast(msg, type) {
    const wrap = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'success' ? ' toast--success' : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 320);
    }, 2600);
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

  /* ---------- Рендер категорій ---------- */

  function countIn(catId) {
    return state.products.filter((p) => p.category === catId).length;
  }

  function renderCats() {
    const list = document.getElementById('catList');

    let html =
      '<li class="a-cat' + (currentCat === 'all' ? ' is-active' : '') + '" data-id="all">' +
        'Всі товари <span class="a-cat__count">' + state.products.length + '</span>' +
      '</li>';

    html += state.categories
      .map((c, i) =>
        '<li class="a-cat' + (currentCat === c.id ? ' is-active' : '') + '" data-id="' + esc(c.id) + '">' +
          esc(c.title) +
          '<span class="a-cat__count">' + countIn(c.id) + '</span>' +
          '<span class="a-cat__tools">' +
            (i > 0 ? '<button data-act="up" title="Вище">↑</button>' : '') +
            (i < state.categories.length - 1 ? '<button data-act="down" title="Нижче">↓</button>' : '') +
            '<button data-act="rename" title="Перейменувати">✎</button>' +
            '<button data-act="del" title="Видалити">✕</button>' +
          '</span>' +
        '</li>'
      )
      .join('');

    list.innerHTML = html;
  }

  /* ---------- Рендер списку товарів ---------- */

  function catTitle(id) {
    const c = state.categories.find((c) => c.id === id);
    return c ? c.title : id;
  }

  function renderList() {
    const root = document.getElementById('productList');
    const title = document.getElementById('curCatTitle');
    title.textContent = currentCat === 'all' ? 'Всі товари' : catTitle(currentCat);

    const items = state.products.filter(
      (p) => currentCat === 'all' || p.category === currentCat
    );

    if (!items.length) {
      root.innerHTML = '<div class="a-empty">Тут поки немає товарів.<br>Натисніть «+ Новий товар», щоб додати перший.</div>';
      return;
    }

    root.innerHTML = items
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
              '<div class="a-item__meta">' + esc(p.id) + ' · ' + catTitle(p.category) + ' · ' + fmt(p.price) + ' грн' +
                (p.sizes && p.sizes.length ? ' · ' + p.sizes.join(', ') : '') +
              '</div>' +
            '</div>' +
            '<div class="a-item__actions">' +
              '<button data-act="edit" title="Редагувати">✎</button>' +
              '<button data-act="dup" title="Дублювати">⧉</button>' +
              '<button data-act="toggle" title="' + (p.hidden ? 'Показати' : 'Сховати') + '">' + (p.hidden ? '🙈' : '👁') + '</button>' +
              '<button data-act="del" class="danger" title="Видалити">✕</button>' +
            '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function render() {
    renderCats();
    renderList();
    updateDirty();
  }

  /* ---------- Редактор товару ---------- */

  const $ = (id) => document.getElementById(id);

  function openModal(el) {
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(el) {
    el.hidden = true;
    document.body.style.overflow = '';
  }

  function fillCategorySelect(selected) {
    $('fCategory').innerHTML = state.categories
      .map((c) => '<option value="' + esc(c.id) + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c.title) + '</option>')
      .join('');
  }

  function renderSizeChecks(sizes) {
    $('fSizes').innerHTML = ALL_SIZES
      .map((s) =>
        '<label><input type="checkbox" value="' + s + '"' + ((sizes || []).includes(s) ? ' checked' : '') + '> ' + s + '</label>'
      )
      .join('');
  }

  function addColorRow(value) {
    const row = document.createElement('span');
    row.className = 'a-color';
    row.innerHTML =
      '<input type="color" value="' + esc(value || '#014AAD') + '">' +
      '<button type="button" title="Прибрати">✕</button>';
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      updatePreview();
    });
    $('fColors').appendChild(row);
  }

  function openEditor(product) {
    editingId = product ? product.id : null;
    $('editorTitle').textContent = product ? 'Редагувати: ' + product.name : 'Новий товар';

    const p = product || {};
    $('fId').value = p.id || '';
    $('fName').value = p.name || '';
    fillCategorySelect(p.category || (currentCat !== 'all' ? currentCat : (state.categories[0] || {}).id));
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
    $('fImages').value = (p.images || []).join('\n');
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

    const low = $('fLowStock').value.split(',').map((s) => s.trim()).filter(Boolean);
    if (low.length) p.lowStock = low;

    if ($('fSale').checked) p.sale = true;
    if ($('fHidden').checked) p.hidden = true;
    if ($('fSaleNote').value.trim()) p.saleNote = $('fSaleNote').value.trim();

    const sizes = Array.prototype.map.call(
      document.querySelectorAll('#fSizes input:checked'),
      (i) => i.value
    );
    p.sizes = sizes;

    if ($('fFabric').value.trim()) p.fabric = $('fFabric').value.trim();
    if ($('fMaterial').value.trim()) p.material = $('fMaterial').value.trim();
    if ($('fVolume').value.trim()) p.volume = $('fVolume').value.trim();
    if ($('fAroma').value.trim()) p.aroma = $('fAroma').value.trim();
    if ($('fModel').value.trim()) p.model = $('fModel').value.trim();

    const colors = Array.prototype.map.call(
      document.querySelectorAll('#fColors input[type="color"]'),
      (i) => i.value
    );
    if (colors.length) p.colors = colors;

    p.images = lines($('fImages').value);
    const notes = lines($('fNotes').value);
    if (notes.length) p.notes = notes;
    const chars = lines($('fCharacteristics').value);
    if (chars.length) p.characteristics = chars;
    const care = lines($('fCare').value);
    if (care.length) p.care = care;

    return p;
  }

  function updatePreview() {
    const p = collectForm();
    const dots = (p.colors || [])
      .map((c) => '<span class="dot" style="background-color:' + esc(c) + '"></span>')
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

  function saveProduct() {
    const p = collectForm();

    if (!p.id) return toast('Вкажіть артикул');
    if (!p.name) return toast('Вкажіть назву');
    if (!p.price) return toast('Вкажіть ціну');
    if (!p.category) return toast('Створіть категорію');
    if (!p.images.length) return toast('Додайте хоча б одне фото');

    const clash = state.products.find((x) => x.id === p.id && x.id !== editingId);
    if (clash) return toast('Артикул ' + p.id + ' вже використовується');

    if (editingId) {
      const idx = state.products.findIndex((x) => x.id === editingId);
      state.products[idx] = p;
    } else {
      state.products.push(p);
    }

    persist();
    render();
    closeModal($('editorModal'));
    toast(editingId ? 'Товар оновлено ✓' : 'Товар додано ✓', 'success');
    editingId = null;
  }

  /* ---------- Генерація data.js ---------- */

  function buildDataJs() {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return (
      '/* ============================================================\n' +
      '   REYTER — дані сайту\n' +
      '   Згенеровано адмінкою ' + stamp + '\n' +
      '   Єдине джерело правди для каталогу: категорії та товари.\n' +
      '   ============================================================ */\n\n' +
      'window.REYTER = window.REYTER || {};\n\n' +
      'REYTER.config = ' + JSON.stringify(R.config, null, 2) + ';\n\n' +
      'REYTER.categories = ' + JSON.stringify(state.categories, null, 2) + ';\n\n' +
      'REYTER.products = ' + JSON.stringify(state.products, null, 2) + ';\n'
    );
  }

  function downloadDataJs() {
    const blob = new Blob([buildDataJs()], { type: 'text/javascript;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'data.js';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Файл data.js завантажено — замініть ним new/js/data.js', 'success');
  }

  /* ---------- Публікація через GitHub ---------- */

  function setPublishStatus(cls, text) {
    const el = $('publishStatus');
    el.hidden = false;
    el.className = 'a-publish__status ' + cls;
    el.textContent = text;
  }

  function b64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  async function doPublish() {
    const token = $('ghToken').value.trim();
    if (!token) return setPublishStatus('err', 'Вставте GitHub-токен');

    if ($('ghRemember').checked) localStorage.setItem(KEY_TOKEN, token);
    else localStorage.removeItem(KEY_TOKEN);

    const api = 'https://api.github.com/repos/' + GH.owner + '/' + GH.repo + '/contents/' + GH.path;
    const headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    };

    try {
      setPublishStatus('wait', 'Публікуємо…');

      const getRes = await fetch(api + '?ref=' + GH.branch, { headers: headers });
      if (getRes.status === 401 || getRes.status === 403) {
        return setPublishStatus('err', 'Токен не має доступу до репозиторію. Перевірте дозвіл Contents: Read and write.');
      }
      if (!getRes.ok) {
        return setPublishStatus('err', 'Не вдалося прочитати файл із GitHub (код ' + getRes.status + ')');
      }
      const info = await getRes.json();

      const putRes = await fetch(api, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify({
          message: 'Оновлення каталогу з адмінки',
          content: b64(buildDataJs()),
          sha: info.sha,
          branch: GH.branch
        })
      });

      if (!putRes.ok) {
        const err = await putRes.json().catch(() => ({}));
        return setPublishStatus('err', 'Помилка публікації: ' + (err.message || putRes.status));
      }

      baseline = JSON.stringify(state);
      updateDirty();
      setPublishStatus('ok', 'Опубліковано ✓ Сайт оновиться за 1–2 хвилини.');
      toast('Каталог опубліковано ✓', 'success');
    } catch (e) {
      setPublishStatus('err', 'Немає звʼязку з GitHub. Перевірте інтернет.');
    }
  }

  /* ---------- Події ---------- */

  function init() {
    render();

    // Категорії
    document.getElementById('catList').addEventListener('click', (e) => {
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
        if (name && name.trim()) {
          cat.title = name.trim();
          persist();
          render();
        }
      } else if (act === 'del') {
        if (countIn(id)) {
          toast('Спершу перенесіть або видаліть товари з цієї категорії');
          return;
        }
        if (confirm('Видалити категорію «' + cat.title + '»?')) {
          state.categories.splice(idx, 1);
          if (currentCat === id) currentCat = 'all';
          persist();
          render();
        }
      } else if (act === 'up' && idx > 0) {
        state.categories.splice(idx - 1, 0, state.categories.splice(idx, 1)[0]);
        persist();
        render();
      } else if (act === 'down' && idx < state.categories.length - 1) {
        state.categories.splice(idx + 1, 0, state.categories.splice(idx, 1)[0]);
        persist();
        render();
      }
    });

    document.getElementById('addCatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('newCatName');
      const name = input.value.trim();
      if (!name) return;
      state.categories.push({ id: slugify(name), title: name });
      input.value = '';
      persist();
      render();
      toast('Категорію додано ✓', 'success');
    });

    // Товари
    document.getElementById('productList').addEventListener('click', (e) => {
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
        state.products.splice(idx + 1, 0, copy);
        persist();
        render();
      } else if (btn.dataset.act === 'toggle') {
        p.hidden = !p.hidden;
        if (!p.hidden) delete p.hidden;
        persist();
        render();
      } else if (btn.dataset.act === 'del') {
        if (confirm('Видалити товар «' + p.name + '» (' + p.id + ')?')) {
          state.products.splice(idx, 1);
          persist();
          render();
        }
      }
    });

    document.getElementById('addProductBtn').addEventListener('click', () => {
      if (!state.categories.length) {
        toast('Спершу створіть категорію');
        return;
      }
      openEditor(null);
    });

    // Редактор
    document.getElementById('saveProductBtn').addEventListener('click', saveProduct);
    document.getElementById('addColorBtn').addEventListener('click', () => {
      addColorRow();
      updatePreview();
    });
    document.getElementById('productForm').addEventListener('input', updatePreview);
    document.getElementById('productForm').addEventListener('change', updatePreview);
    document.getElementById('productForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveProduct();
    });

    // Експорт і публікація
    document.getElementById('downloadBtn').addEventListener('click', downloadDataJs);
    document.getElementById('publishBtn').addEventListener('click', () => {
      $('ghToken').value = localStorage.getItem(KEY_TOKEN) || '';
      $('publishStatus').hidden = true;
      openModal($('publishModal'));
    });
    document.getElementById('doPublishBtn').addEventListener('click', doPublish);

    document.getElementById('resetDraftBtn').addEventListener('click', () => {
      if (confirm('Скинути всі незбережені зміни й повернутися до опублікованої версії каталогу?')) {
        localStorage.removeItem(KEY_DRAFT);
        state = published();
        persist();
        localStorage.removeItem(KEY_DRAFT);
        render();
        toast('Чернетку скинуто');
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
   ХМАРНА ЧАСТИНА АДМІНКИ (Firestore)
   ------------------------------------------------------------
   • Замовлення: live-надходження, статистика, фільтри, пошук,
     статуси (Нове → Підтверджено → Відправлено → Виконано /
     Скасовано), ТТН, автосписання складу при підтвердженні
     та повернення при скасуванні
   • Склад: залишки по розмірах, вартість залишків, прихід
     товару з датами та оприбуткуванням, журнал руху
   • Адміністратори: постійні + додавання нових
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

  const LOW_AT = 2; // поріг «закінчується»

  const MOVE_REASONS = {
    manual: 'Ручне коригування',
    order: 'Списання під замовлення',
    'order-cancel': 'Повернення (скасування)',
    restock: 'Прихід товару'
  };

  /* ---------- Дрібні хелпери ---------- */

  const $id = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('uk-UA');
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

  function productById(id) {
    return products().find((p) => p.id === id) || null;
  }

  function isSized(p) {
    return !p.volume;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function fbReady() {
    return R.fb && R.fb.enabled;
  }

  /* ---------- Вхід / права ---------- */

  function updateUserChip() {
    const chip = $id('adminUserChip');
    if (!chip) return;
    const user = R.fb && R.fb.user;
    chip.hidden = !user;
    if (user) chip.textContent = user.email || '';
  }

  function gateHTML(what) {
    if (!fbReady()) {
      return '<p class="ao-note">Firebase недоступний — перевірте інтернет або вимкніть блокувальник реклами.</p>';
    }
    return (
      '<div class="ao-gate">' +
        '<p class="ao-note">Увійдіть акаунтом адміністратора, щоб відкрити ' + what + '.</p>' +
        '<button class="btn btn--primary" data-ao-google type="button">Увійти через Google</button>' +
      '</div>'
    );
  }

  function deniedHTML() {
    return (
      '<div class="ao-gate">' +
        '<p class="ao-note">У акаунта <b>' + esc(R.fb.user.email || '') + '</b> немає прав адміністратора.<br>' +
        'Доступ мають: ' + FOUNDERS.map((e) => '<b>' + esc(e) + '</b>').join(', ') + ' та додані ними адміни.</p>' +
        '<button class="btn btn--ghost btn--sm" data-ao-logout type="button">Вийти та увійти іншим акаунтом</button>' +
      '</div>'
    );
  }

  function errorHTML(extra) {
    return (
      '<p class="ao-note">Не вдалося зʼєднатися з базою. Перевірте, що у Firebase створено Firestore Database ' +
      'і вставлено правила з файлу <code>new/firestore.rules</code>.' + (extra ? '<br>' + esc(extra) : '') + '</p>'
    );
  }

  async function signInGoogle() {
    try {
      await R.fb.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    } catch (err) {
      toast(R.fb.errorText(err));
    }
  }

  /* ============================================================
     СКЛАД: кеш живих залишків
     ============================================================ */

  let inv = {};             // productId -> {sizes:{S:n}} | {qty:n}
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

  /* Журнал руху — записується в той самий batch, що і зміна складу */
  function logMove(batch, entry) {
    const ref = R.fb.db.collection('stock_moves').doc();
    batch.set(ref, Object.assign({
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      by: (R.fb.user && R.fb.user.email) || ''
    }, entry));
  }

  /* Списання/повернення складу під замовлення (direction: -1 або +1) */
  function adjustOrderStock(batch, order, direction) {
    const grouped = {}; // pid -> {sizes:{S:delta}} | {qty:delta}
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

  /* ============================================================
     ПАНЕЛЬ «ЗАМОВЛЕННЯ»
     ============================================================ */

  let ordersCache = [];
  let ordersUnsub = null;
  let orderFilter = 'all';
  let orderSearch = '';
  let knownOrderIds = null;
  let adminsCache = null;

  function ordersBody() {
    return $id('ordersBody');
  }

  function openOrders() {
    $id('ordersModal').hidden = false;
    document.body.style.overflow = 'hidden';
    renderOrdersRoot();
  }

  function renderOrdersRoot() {
    if (!fbReady() || !R.fb.user) {
      stopOrders();
      ordersBody().innerHTML = gateHTML('панель замовлень');
      return;
    }
    if (!ordersUnsub) {
      ordersBody().innerHTML = '<p class="ao-note">Завантажуємо замовлення…</p>';
      subscribeOrders();
    } else {
      renderOrdersUI();
    }
  }

  function subscribeOrders() {
    ordersUnsub = R.fb.db
      .collection('orders')
      .orderBy('created', 'desc')
      .limit(300)
      .onSnapshot(
        (snap) => {
          ordersCache = snap.docs.map((d) => Object.assign({ _id: d.id }, d.data()));

          // сповіщення про нові замовлення, що надійшли наживо
          const ids = new Set(ordersCache.map((o) => o._id));
          if (knownOrderIds) {
            ordersCache.forEach((o) => {
              if (!knownOrderIds.has(o._id)) {
                toast('🛍 Нове замовлення №' + o.num, 'success');
              }
            });
          }
          knownOrderIds = ids;

          updateOrdersBadge();
          if (adminsCache === null) loadAdmins();
          renderOrdersUI();
        },
        (err) => {
          stopOrders();
          ordersBody().innerHTML =
            err && err.code === 'permission-denied' ? deniedHTML() : errorHTML(err && err.code);
        }
      );
  }

  function stopOrders() {
    if (ordersUnsub) {
      ordersUnsub();
      ordersUnsub = null;
    }
  }

  async function loadAdmins() {
    adminsCache = [];
    try {
      const snap = await R.fb.db.collection('admins').get();
      adminsCache = snap.docs
        .map((d) => Object.assign({ email: d.id }, d.data()))
        .filter((a) => !FOUNDERS.includes(a.email));
      renderOrdersUI();
    } catch (e) { /* без списку адмінів панель все одно працює */ }
  }

  function updateOrdersBadge() {
    const badge = $id('newOrdersBadge');
    if (!badge) return;
    const n = ordersCache.filter((o) => (o.status || 'new') === 'new').length;
    badge.hidden = n === 0;
    badge.textContent = n;
  }

  function orderMatches(o) {
    if (orderFilter !== 'all' && (o.status || 'new') !== orderFilter) return false;
    if (orderSearch) {
      const q = orderSearch.toLowerCase();
      const c = o.customer || {};
      const hay = [o.num, c.name, c.phone, o.email, o.ttn].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function orderStatsHTML() {
    const today = todayISO();
    const active = ordersCache.filter((o) => o.status !== 'cancelled');
    const revenue = active.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const todayCount = ordersCache.filter((o) => String(o.date || '').slice(0, 10) === today).length;
    const newCount = ordersCache.filter((o) => (o.status || 'new') === 'new').length;
    return (
      '<div class="ao-stats">' +
        '<div class="ao-stat"><b>' + fmt(ordersCache.length) + '</b><span>всього</span></div>' +
        '<div class="ao-stat"><b>' + fmt(newCount) + '</b><span>нових</span></div>' +
        '<div class="ao-stat"><b>' + fmt(todayCount) + '</b><span>сьогодні</span></div>' +
        '<div class="ao-stat"><b>' + fmt(revenue) + ' грн</b><span>сума (без скасованих)</span></div>' +
      '</div>'
    );
  }

  function orderFiltersHTML() {
    const counts = { all: ordersCache.length };
    STATUSES.forEach((s) => {
      counts[s.id] = ordersCache.filter((o) => (o.status || 'new') === s.id).length;
    });
    const chip = (id, title) =>
      '<button class="ao-chip' + (orderFilter === id ? ' is-active' : '') + '" data-ao-filter="' + id + '" type="button">' +
        title + ' <i>' + counts[id] + '</i>' +
      '</button>';
    return (
      '<div class="ao-filterbar">' +
        '<div class="ao-chips">' +
          chip('all', 'Всі') +
          STATUSES.map((s) => chip(s.id, s.title)).join('') +
        '</div>' +
        '<input class="ao-search" id="aoOrderSearch" placeholder="Пошук: №, імʼя, телефон, ТТН" value="' + esc(orderSearch) + '">' +
      '</div>'
    );
  }

  function orderCardHTML(o) {
    const st = o.status || 'new';
    const date = o.date
      ? new Date(o.date).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '';
    const c = o.customer || {};
    const delivery = [c.carrier, c.city, c.branch].filter(Boolean).join(', ');
    const items = (o.items || [])
      .map((i) => '<div>' + esc(i.name) + (i.size ? ' · <b>' + esc(i.size) + '</b>' : '') + ' × ' + i.qty + ' — ' + fmt(i.price * i.qty) + ' грн</div>')
      .join('');
    const statusSelect =
      '<select class="ao-status-select st-' + st + '" data-ao-status>' +
        STATUSES.map((s) =>
          '<option value="' + s.id + '"' + (s.id === st ? ' selected' : '') + '>' + s.title + '</option>'
        ).join('') +
      '</select>';

    return (
      '<article class="ao-card st-' + st + '" data-id="' + esc(o._id) + '">' +
        '<div class="ao-card__head">' +
          '<b>№' + esc(o.num) + '</b>' +
          statusSelect +
          (o.stockApplied ? '<span class="ao-tag" title="Товар списано зі складу">склад ✓</span>' : '') +
          '<span class="ao-card__date">' + esc(date) + '</span>' +
        '</div>' +
        '<div class="ao-card__customer">' +
          '👤 ' + esc(c.name || '—') +
          ' · 📞 <a href="tel:' + esc(c.phone || '') + '">' + esc(c.phone || '—') + '</a>' +
          (o.email ? ' · ✉️ ' + esc(o.email) : '') +
          (delivery ? '<br>🚚 ' + esc(delivery) : '') +
          (c.comment ? '<br>💬 ' + esc(c.comment) : '') +
        '</div>' +
        '<div class="ao-card__items">' + items + '</div>' +
        '<div class="ao-card__foot">' +
          '<span class="ao-card__total">Разом: ' + fmt(o.total) + ' грн</span>' +
          '<span class="ao-ttn">ТТН: <input data-ao-ttn value="' + esc(o.ttn || '') + '" placeholder="номер накладної"></span>' +
        '</div>' +
        '<div class="ao-card__actions">' +
          '<button class="btn btn--ghost btn--sm" data-ao-copy type="button">Скопіювати</button>' +
          '<button class="btn btn--ghost btn--sm ao-danger" data-ao-del type="button">Видалити</button>' +
        '</div>' +
      '</article>'
    );
  }

  function adminsHTML() {
    const admins = adminsCache || [];
    return (
      '<div class="ao-admins">' +
        '<h4>Адміністратори</h4>' +
        '<p class="ao-note">Адміни бачать замовлення і склад та можуть додавати інших адмінів. Вхід — через Google цим email.</p>' +
        FOUNDERS.map((e) =>
          '<div class="ao-admin"><span>' + esc(e) + '</span><i>постійний</i></div>'
        ).join('') +
        admins.map((a) =>
          '<div class="ao-admin"><span>' + esc(a.email) + '</span>' +
          (a.by ? '<i>додав ' + esc(a.by) + '</i>' : '') +
          '<button data-ao-rmadmin="' + esc(a.email) + '" type="button" title="Прибрати">✕</button></div>'
        ).join('') +
        '<form class="ao-addadmin" id="addAdminForm">' +
          '<input id="newAdminEmail" type="email" placeholder="email нового адміна" autocomplete="off">' +
          '<button class="btn btn--primary btn--sm" type="submit">Додати</button>' +
        '</form>' +
      '</div>'
    );
  }

  function renderOrdersUI() {
    const list = ordersCache.filter(orderMatches);
    ordersBody().innerHTML =
      '<div class="ao-toolbar">' +
        '<span class="ao-live">● live</span>' +
        '<span>Замовлення надходять сюди автоматично</span>' +
        '<button class="btn btn--ghost btn--sm" data-ao-logout type="button" style="margin-left:auto">Вийти</button>' +
      '</div>' +
      orderStatsHTML() +
      orderFiltersHTML() +
      '<div class="ao-list">' +
        (list.length
          ? list.map(orderCardHTML).join('')
          : '<div class="a-empty">' +
              (ordersCache.length ? 'Нічого не знайдено за цим фільтром.' : 'Замовлень поки немає. Щойно покупець оформить кошик — воно зʼявиться тут.') +
            '</div>') +
      '</div>' +
      adminsHTML();

    const search = $id('aoOrderSearch');
    if (search) {
      search.addEventListener('input', () => {
        orderSearch = search.value;
        const listEl = ordersBody().querySelector('.ao-list');
        const filtered = ordersCache.filter(orderMatches);
        listEl.innerHTML = filtered.length
          ? filtered.map(orderCardHTML).join('')
          : '<div class="a-empty">Нічого не знайдено.</div>';
      });
    }
  }

  /* Зміна статусу з обліком складу */
  async function applyStatus(order, next) {
    const prev = order.status || 'new';
    if (prev === next) return;

    try {
      const batch = R.fb.db.batch();
      const upd = { status: next };

      const forward = ['confirmed', 'shipped', 'done'].includes(next);
      const backward = ['new', 'cancelled'].includes(next);

      if (forward && !order.stockApplied) {
        adjustOrderStock(batch, order, -1);
        upd.stockApplied = true;
      }
      if (backward && order.stockApplied) {
        adjustOrderStock(batch, order, +1);
        upd.stockApplied = false;
      }

      batch.update(R.fb.db.collection('orders').doc(order._id), upd);
      await batch.commit();

      if (upd.stockApplied === true) toast('Статус оновлено, товар списано зі складу ✓', 'success');
      else if (upd.stockApplied === false) toast('Статус оновлено, товар повернено на склад ✓', 'success');
      else toast('Статус: ' + statusInfo(next).title + ' ✓', 'success');
    } catch (err) {
      toast('Не вдалося оновити статус');
      renderOrdersUI(); // повертаємо селект у актуальний стан
    }
  }

  /* ============================================================
     ПАНЕЛЬ «СКЛАД»
     ============================================================ */

  let stockTab = 'stock'; // stock | restock | moves
  let stockSearch = '';
  let stockFilter = 'all'; // all | low | out
  let restocksCache = [];
  let movesCache = [];
  let restockProductId = '';

  function stockBody() {
    return $id('stockBody');
  }

  function openStock() {
    $id('stockModal').hidden = false;
    document.body.style.overflow = 'hidden';
    renderStockRoot();
  }

  function renderStockRoot() {
    if (!fbReady() || !R.fb.user) {
      stopStock();
      stockBody().innerHTML = gateHTML('склад');
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
        renderStockUI();
      },
      (err) => {
        stopStock();
        stockBody().innerHTML =
          err && err.code === 'permission-denied' ? deniedHTML() : errorHTML(err && err.code);
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
      if (stockTab === 'restock') renderStockUI();
    } catch (e) { /* покажемо порожній список */ }
  }

  async function loadMoves() {
    try {
      const snap = await R.fb.db.collection('stock_moves').orderBy('ts', 'desc').limit(60).get();
      movesCache = snap.docs.map((d) => d.data());
      if (stockTab === 'moves') renderStockUI();
    } catch (e) { /* покажемо порожній список */ }
  }

  /* ----- вкладка «Залишки» ----- */

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
      return (
        '<h5 class="ao-cat-title">' + esc(cat.title) + '</h5>' +
        items.map(stockRowHTML).join('')
      );
    }).join('');

    return shown
      ? sections
      : '<div class="a-empty">Нічого не знайдено.</div>';
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

  /* ----- вкладка «Прихід» ----- */

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
          '<select id="rstProduct">' +
            '<option value="">— товар —</option>' +
            categories().map((cat) => {
              const items = all.filter((p) => p.category === cat.id);
              if (!items.length) return '';
              return '<optgroup label="' + esc(cat.title) + '">' +
                items.map((p) =>
                  '<option value="' + esc(p.id) + '"' + (p.id === restockProductId ? ' selected' : '') + '>' +
                    esc(p.name) + ' (' + esc(p.id) + ')' +
                  '</option>'
                ).join('') +
              '</optgroup>';
            }).join('') +
          '</select>' +
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

  /* ----- вкладка «Рух» ----- */

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

  /* ----- рендер панелі складу ----- */

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
        '<p class="ao-note">Змініть число — воно збережеться автоматично. Кожна зміна фіксується в журналі «Рух». «Закінчується» — коли лишилося ' + LOW_AT + ' шт або менше; сайт показує це покупцям автоматично.</p>' +
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
        '<button class="btn btn--ghost btn--sm" data-ao-logout type="button" style="margin-left:auto">Вийти</button>' +
      '</div>' +
      content;

    const search = $id('aoStockSearch');
    if (search) {
      search.addEventListener('input', () => {
        stockSearch = search.value;
        stockBody().querySelector('.ao-stocklist').innerHTML = stockListHTML();
      });
    }
  }

  /* ----- дії складу ----- */

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
    const pid = $id('rstProduct').value;
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
     АДМІНІСТРАТОРИ
     ============================================================ */

  async function addAdmin() {
    const input = $id('newAdminEmail');
    const email = (input.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast('Введіть коректний email');
      return;
    }
    if (FOUNDERS.includes(email)) {
      toast('Цей email вже постійний адмін');
      return;
    }
    try {
      await R.fb.db.collection('admins').doc(email).set({
        added: firebase.firestore.FieldValue.serverTimestamp(),
        by: (R.fb.user && R.fb.user.email) || ''
      });
      toast('Адміна додано ✓', 'success');
      loadAdmins();
    } catch (e) {
      toast('Немає прав додавати адмінів');
    }
  }

  /* ============================================================
     ПОДІЇ
     ============================================================ */

  function watchModalClose(modalEl, onClose) {
    new MutationObserver(() => {
      if (modalEl.hidden) onClose();
    }).observe(modalEl, { attributes: true, attributeFilter: ['hidden'] });
  }

  function init() {
    const ordersBtn = $id('ordersBtn');
    const stockBtn = $id('stockBtn');
    if (!ordersBtn || !stockBtn) return;

    ordersBtn.addEventListener('click', openOrders);
    stockBtn.addEventListener('click', openStock);

    watchModalClose($id('ordersModal'), stopOrders);
    watchModalClose($id('stockModal'), stopStock);

    document.addEventListener('auth:changed', () => {
      updateUserChip();
      if (!$id('ordersModal').hidden) renderOrdersRoot();
      if (!$id('stockModal').hidden) renderStockRoot();
    });
    updateUserChip();

    /* ---- замовлення ---- */

    ordersBody().addEventListener('click', async (e) => {
      if (e.target.closest('[data-ao-google]')) return signInGoogle();
      if (e.target.closest('[data-ao-logout]')) return R.fb.auth.signOut();

      const filterBtn = e.target.closest('[data-ao-filter]');
      if (filterBtn) {
        orderFilter = filterBtn.dataset.aoFilter;
        renderOrdersUI();
        return;
      }

      const rm = e.target.closest('[data-ao-rmadmin]');
      if (rm) {
        const email = rm.dataset.aoRmadmin;
        if (confirm('Прибрати адміна ' + email + '?')) {
          try {
            await R.fb.db.collection('admins').doc(email).delete();
            toast('Адміна прибрано');
            loadAdmins();
          } catch (err) {
            toast('Немає прав');
          }
        }
        return;
      }

      const card = e.target.closest('.ao-card');
      if (!card) return;
      const order = ordersCache.find((o) => o._id === card.dataset.id);
      if (!order) return;

      if (e.target.closest('[data-ao-copy]')) {
        R.copyText(order.message || '');
        toast('Скопійовано ✓', 'success');
      } else if (e.target.closest('[data-ao-del]')) {
        if (confirm('Видалити замовлення №' + order.num + '? Списаний товар автоматично НЕ повернеться на склад.')) {
          try {
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

      if (e.target.matches('[data-ao-status]')) {
        applyStatus(order, e.target.value);
      } else if (e.target.matches('[data-ao-ttn]')) {
        R.fb.db.collection('orders').doc(order._id)
          .update({ ttn: e.target.value.trim() })
          .then(() => toast('ТТН збережено ✓', 'success'))
          .catch(() => toast('Не вдалося зберегти ТТН'));
      }
    });

    ordersBody().addEventListener('submit', (e) => {
      if (e.target.id === 'addAdminForm') {
        e.preventDefault();
        addAdmin();
      }
    });

    /* ---- склад ---- */

    stockBody().addEventListener('click', (e) => {
      if (e.target.closest('[data-ao-google]')) return signInGoogle();
      if (e.target.closest('[data-ao-logout]')) return R.fb.auth.signOut();

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
      if (e.target.id === 'rstProduct') {
        restockProductId = e.target.value;
        renderStockUI();
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
