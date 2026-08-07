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
