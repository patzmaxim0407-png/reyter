/* ============================================================
   REYTER — address.js
   Адреса доставки: два перевізники.

   • Нова Пошта — місто й відділення/поштомат підтягуються з
     їхнього API (api.novaposhta.ua). Ключ не потрібен: адресні
     методи відкриті, а CORS вони віддають самі, тож запит іде
     прямо з браузера.
   • Міжнародна доставка — повна адреса за міжнародним
     стандартом: країна, штат/область, місто, вулиця, індекс.

   Модуль дає готовий блок полів (R.addressField) і збирає
   з нього значення (R.addressValue). Ним користуються кошик,
   профіль у кабінеті та ручне замовлення в адмінці.
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';

  /* Власний esc: адмінка не вантажить catalog.js, де живе R.esc */
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  R.CARRIERS = [
    { id: 'np',   title: 'Нова Пошта',          titleEn: 'Nova Poshta' },
    { id: 'intl', title: 'Міжнародна доставка', titleEn: 'International delivery' }
  ];

  /* Назва перевізника ↔ id: у замовленнях зберігається назва,
     і старі замовлення теж мають читатись */
  R.carrierId = function (title) {
    const t = String(title || '').toLowerCase();
    if (!t) return 'np';
    if (t.indexOf('міжнар') === 0 || t.indexOf('intern') === 0) return 'intl';
    return 'np';
  };

  R.carrierTitle = function (id) {
    const c = R.CARRIERS.find((x) => x.id === id) || R.CARRIERS[0];
    return R.tf ? R.tf(c, 'title') : c.title;
  };

  /* ---------- Нова Пошта ---------- */

  const npCache = { cities: {}, warehouses: {} };

  async function npCall(modelName, calledMethod, methodProperties) {
    const res = await fetch(NP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: '',
        modelName: modelName,
        calledMethod: calledMethod,
        methodProperties: methodProperties
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error((data.errors || []).join('; ') || 'Нова Пошта не відповіла');
    return data.data || [];
  }

  /* Пошук населеного пункту. Повертає ще й ref міста —
     саме за ним далі беруться відділення. */
  R.npCities = async function (query) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    const key = q.toLowerCase();
    if (npCache.cities[key]) return npCache.cities[key];

    const data = await npCall('Address', 'searchSettlements', {
      CityName: q,
      Limit: '25',
      Page: '1'
    });
    const rows = (data[0] && data[0].Addresses) || [];

    const list = rows
      .filter((a) => a.DeliveryCity)
      .map((a) => ({
        ref: a.DeliveryCity,
        name: a.MainDescription,
        // «м. Львів, Львівська обл.» — щоб не переплутати тезок
        label: a.Present,
        area: a.Area,
        warehouses: Number(a.Warehouses) || 0
      }));

    npCache.cities[key] = list;
    return list;
  };

  /* Відділення й поштомати міста.
     Пошук робить сам API (FindByString) — у великих містах
     відділень кілька тисяч, тягнути їх усі в браузер немає сенсу.
     Він шукає і за номером, і за вулицею. */
  R.npWarehouses = async function (cityRef, query) {
    if (!cityRef) return [];
    const q = String(query || '').trim();
    const key = cityRef + '|' + q.toLowerCase();
    if (npCache.warehouses[key]) return npCache.warehouses[key];

    const props = { CityRef: cityRef, Limit: q ? '60' : '100', Page: '1' };
    if (q) props.FindByString = q;

    let rows = await npCall('AddressGeneral', 'getWarehouses', props);

    /* Без запиту у великих містах у перші 100 потрапляють самі
       відділення, і поштоматів не видно взагалі. Дотягуємо їх
       окремо, щоб вибір був повним із першого відкриття. */
    if (!q && !rows.some((w) => w.CategoryOfWarehouse === 'Postomat')) {
      try {
        const boxes = await npCall('AddressGeneral', 'getWarehouses', {
          CityRef: cityRef, FindByString: 'Поштомат', Limit: '50', Page: '1'
        });
        rows = rows.concat(boxes);
      } catch (e) { /* без поштоматів теж можна жити */ }
    }

    const list = rows
      .filter((w) => w.WarehouseStatus === 'Working')
      .map((w) => ({
        ref: w.Ref,
        number: Number(w.Number) || 0,
        postomat: w.CategoryOfWarehouse === 'Postomat',
        // «Відділення №1: вул. Городоцька, 359» — так його бачить клієнт
        label: w.Description,
        short: w.ShortAddress || ''
      }))
      // без запиту показуємо спершу відділення, тоді поштомати;
      // з запитом лишаємо порядок релевантності від API
      .sort((a, b) => {
        if (q) return 0;
        if (a.postomat !== b.postomat) return a.postomat ? 1 : -1;
        return a.number - b.number;
      });

    /* Список без запиту обрізаємо порівну: інакше у Львові
       чи Києві сто відділень витіснили б поштомати геть,
       і клієнт вирішив би, що їх немає */
    const shown = q
      ? list
      : list.filter((w) => !w.postomat).slice(0, 60)
          .concat(list.filter((w) => w.postomat).slice(0, 40));

    npCache.warehouses[key] = shown;
    return shown;
  };

  /* ---------- Країни для міжнародної доставки ----------
     Список короткий навмисно: це напрямки, куди бренд реально
     відправляє. «Інша країна» лишає можливість вписати руками. */

  R.COUNTRIES = [
    { code: 'PL', title: 'Польща',            titleEn: 'Poland' },
    { code: 'DE', title: 'Німеччина',         titleEn: 'Germany' },
    { code: 'CZ', title: 'Чехія',             titleEn: 'Czechia' },
    { code: 'SK', title: 'Словаччина',        titleEn: 'Slovakia' },
    { code: 'AT', title: 'Австрія',           titleEn: 'Austria' },
    { code: 'IT', title: 'Італія',            titleEn: 'Italy' },
    { code: 'ES', title: 'Іспанія',           titleEn: 'Spain' },
    { code: 'PT', title: 'Португалія',        titleEn: 'Portugal' },
    { code: 'FR', title: 'Франція',           titleEn: 'France' },
    { code: 'NL', title: 'Нідерланди',        titleEn: 'Netherlands' },
    { code: 'BE', title: 'Бельгія',           titleEn: 'Belgium' },
    { code: 'IE', title: 'Ірландія',          titleEn: 'Ireland' },
    { code: 'GB', title: 'Велика Британія',   titleEn: 'United Kingdom' },
    { code: 'SE', title: 'Швеція',            titleEn: 'Sweden' },
    { code: 'NO', title: 'Норвегія',          titleEn: 'Norway' },
    { code: 'DK', title: 'Данія',             titleEn: 'Denmark' },
    { code: 'FI', title: 'Фінляндія',         titleEn: 'Finland' },
    { code: 'CH', title: 'Швейцарія',         titleEn: 'Switzerland' },
    { code: 'LT', title: 'Литва',             titleEn: 'Lithuania' },
    { code: 'LV', title: 'Латвія',            titleEn: 'Latvia' },
    { code: 'EE', title: 'Естонія',           titleEn: 'Estonia' },
    { code: 'RO', title: 'Румунія',           titleEn: 'Romania' },
    { code: 'HU', title: 'Угорщина',          titleEn: 'Hungary' },
    { code: 'BG', title: 'Болгарія',          titleEn: 'Bulgaria' },
    { code: 'GR', title: 'Греція',            titleEn: 'Greece' },
    { code: 'US', title: 'США',               titleEn: 'United States' },
    { code: 'CA', title: 'Канада',            titleEn: 'Canada' },
    { code: 'AU', title: 'Австралія',         titleEn: 'Australia' },
    { code: 'NZ', title: 'Нова Зеландія',     titleEn: 'New Zealand' },
    { code: 'IL', title: 'Ізраїль',           titleEn: 'Israel' },
    { code: 'AE', title: 'ОАЕ',               titleEn: 'United Arab Emirates' },
    { code: 'TR', title: 'Туреччина',         titleEn: 'Türkiye' },
    { code: 'JP', title: 'Японія',            titleEn: 'Japan' },
    { code: 'other', title: 'Інша країна',    titleEn: 'Other country' }
  ];

  /* Де штат/провінція обовʼязкові за поштовим стандартом */
  const STATE_REQUIRED = ['US', 'CA', 'AU'];

  /* Підказка формату індексу — щоб не вписували «000000» */
  const ZIP_HINT = {
    PL: '00-001', DE: '10115', CZ: '110 00', SK: '811 01', AT: '1010',
    IT: '00100', ES: '28001', PT: '1000-001', FR: '75001', NL: '1011 AB',
    BE: '1000', IE: 'D02 XY45', GB: 'SW1A 1AA', SE: '111 20', NO: '0150',
    DK: '1050', FI: '00100', CH: '8001', LT: 'LT-01100', LV: 'LV-1010',
    EE: '10111', RO: '010011', HU: '1011', BG: '1000', GR: '104 31',
    US: '10001', CA: 'M5H 2N2', AU: '2000', NZ: '1010', IL: '6100000',
    AE: '00000', TR: '34000', JP: '100-0001'
  };

  R.zipHint = function (code) {
    return ZIP_HINT[code] || '';
  };

  R.stateRequired = function (code) {
    return STATE_REQUIRED.includes(code);
  };

  /* ---------- Розмітка блоку адреси ----------
     prefix — префікс id полів: 'co' у кошику, 'pr' у профілі,
     'no' в адмінці. Так один блок працює у трьох місцях. */

  function field(id, label, value, attrs) {
    return (
      '<div class="field">' +
        '<label for="' + id + '">' + label + '</label>' +
        '<input id="' + id + '" value="' + esc(value || '') + '" ' + (attrs || '') + '>' +
      '</div>'
    );
  }

  function combo(id, label, value, ref, placeholder, hint) {
    return (
      '<div class="field acombo" data-combo="' + id + '">' +
        '<label for="' + id + '">' + label + '</label>' +
        '<div class="acombo__box">' +
          '<input id="' + id + '" value="' + esc(value || '') + '" ' +
            'autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" ' +
            'aria-autocomplete="list" placeholder="' + esc(placeholder) + '" ' +
            'data-ref="' + esc(ref || '') + '">' +
          '<span class="acombo__spin" hidden></span>' +
          '<ul class="acombo__list" role="listbox" hidden></ul>' +
        '</div>' +
        (hint ? '<p class="field__hint">' + hint + '</p>' : '') +
      '</div>'
    );
  }

  /* Значення, з яких малюємо блок */
  function normalize(v) {
    v = v || {};
    const intl = v.intl || {};
    return {
      carrier: R.carrierId(v.carrier),
      city: v.city || '',
      cityRef: v.cityRef || '',
      branch: v.branch || '',
      branchRef: v.branchRef || '',
      intl: {
        country: intl.country || '',
        countryCode: intl.countryCode || '',
        state: intl.state || '',
        city: intl.city || '',
        street: intl.street || '',
        extra: intl.extra || '',
        zip: intl.zip || ''
      }
    };
  }

  R.addressField = function (prefix, values) {
    const v = normalize(values);
    const t = (k) => R.t('addr.' + k);

    const carrierOpts = R.CARRIERS
      .map((c) => '<option value="' + c.id + '"' + (v.carrier === c.id ? ' selected' : '') + '>' +
        esc(R.tf(c, 'title')) + '</option>')
      .join('');

    const countryOpts =
      '<option value="">' + esc(t('pickCountry')) + '</option>' +
      R.COUNTRIES.map((c) => '<option value="' + c.code + '"' +
        (v.intl.countryCode === c.code ? ' selected' : '') + '>' +
        esc(R.tf(c, 'title')) + '</option>').join('');

    return (
      '<div class="addr" data-addr="' + prefix + '">' +
        '<div class="field">' +
          '<label for="' + prefix + 'Carrier">' + t('carrier') + '</label>' +
          '<select id="' + prefix + 'Carrier" data-addr-carrier>' + carrierOpts + '</select>' +
        '</div>' +

        '<div class="addr__np" data-addr-np' + (v.carrier === 'np' ? '' : ' hidden') + '>' +
          combo(prefix + 'City', t('city'), v.city, v.cityRef, t('cityPh'), t('cityHint')) +
          combo(prefix + 'Branch', t('branch'), v.branch, v.branchRef, t('branchPh'), t('branchHint')) +
        '</div>' +

        '<div class="addr__intl" data-addr-intl' + (v.carrier === 'intl' ? '' : ' hidden') + '>' +
          '<div class="field">' +
            '<label for="' + prefix + 'Country">' + t('country') + '</label>' +
            '<select id="' + prefix + 'Country" data-addr-country>' + countryOpts + '</select>' +
          '</div>' +
          field(prefix + 'CountryOther', t('countryOther'), v.intl.country,
            'data-addr-country-other placeholder="' + esc(t('countryOtherPh')) + '"' +
            (v.intl.countryCode === 'other' ? '' : ' hidden')) +
          '<div class="form-row">' +
            field(prefix + 'IntlCity', t('intlCity'), v.intl.city, 'autocomplete="address-level2"') +
            field(prefix + 'State', t('state'), v.intl.state,
              'autocomplete="address-level1" data-addr-state') +
          '</div>' +
          field(prefix + 'Street', t('street'), v.intl.street,
            'autocomplete="address-line1" placeholder="' + esc(t('streetPh')) + '"') +
          '<div class="form-row">' +
            field(prefix + 'Extra', t('extra'), v.intl.extra,
              'autocomplete="address-line2" placeholder="' + esc(t('extraPh')) + '"') +
            field(prefix + 'Zip', t('zip'), v.intl.zip,
              'autocomplete="postal-code" data-addr-zip') +
          '</div>' +
          '<p class="field__hint">' + t('intlHint') + '</p>' +
        '</div>' +
      '</div>'
    );
  };

  /* ---------- Значення з полів ---------- */

  R.addressValue = function (prefix) {
    const root = document.querySelector('[data-addr="' + prefix + '"]');
    if (!root) return {};
    const el = (id) => document.getElementById(prefix + id);
    const val = (id) => (el(id) ? el(id).value.trim() : '');

    const carrier = root.querySelector('[data-addr-carrier]').value;

    if (carrier === 'np') {
      const city = el('City');
      const branch = el('Branch');
      return {
        carrier: R.carrierTitle('np'),
        carrierId: 'np',
        city: city.value.trim(),
        cityRef: city.dataset.ref || '',
        branch: branch.value.trim(),
        branchRef: branch.dataset.ref || ''
      };
    }

    const code = root.querySelector('[data-addr-country]').value;
    const country = code === 'other'
      ? val('CountryOther')
      : ((R.COUNTRIES.find((c) => c.code === code) || {}).title || '');

    return {
      carrier: R.carrierTitle('intl'),
      carrierId: 'intl',
      city: val('IntlCity'),
      branch: [val('Street'), val('Extra')].filter(Boolean).join(', '),
      intl: {
        countryCode: code,
        country: country,
        state: val('State'),
        city: val('IntlCity'),
        street: val('Street'),
        extra: val('Extra'),
        zip: val('Zip')
      }
    };
  };

  /* Один рядок адреси — для листа, повідомлення й адмінки */
  R.addressLine = function (c) {
    if (!c) return '';
    const intl = c.intl;
    if (intl && (intl.country || intl.zip || intl.street)) {
      return [
        intl.country,
        intl.state,
        intl.city,
        intl.street,
        intl.extra,
        intl.zip
      ].filter(Boolean).join(', ');
    }
    return [c.carrier, c.city, c.branch].filter(Boolean).join(', ');
  };

  /* ---------- Перевірка перед відправкою ---------- */

  R.addressCheck = function (prefix) {
    const root = document.querySelector('[data-addr="' + prefix + '"]');
    if (!root) return { ok: true };
    const el = (id) => document.getElementById(prefix + id);
    const carrier = root.querySelector('[data-addr-carrier]').value;
    const bad = (node, key) => {
      if (node) node.classList.add('is-invalid');
      return { ok: false, text: R.t('addr.' + key), focus: node };
    };

    root.querySelectorAll('.is-invalid').forEach((n) => n.classList.remove('is-invalid'));

    if (carrier === 'np') {
      if (!el('City').value.trim()) return bad(el('City'), 'needCity');
      if (!el('Branch').value.trim()) return bad(el('Branch'), 'needBranch');
      return { ok: true };
    }

    const code = root.querySelector('[data-addr-country]').value;
    if (!code) return bad(root.querySelector('[data-addr-country]'), 'needCountry');
    if (code === 'other' && !el('CountryOther').value.trim()) {
      return bad(el('CountryOther'), 'needCountry');
    }
    if (!el('IntlCity').value.trim()) return bad(el('IntlCity'), 'needCity');
    if (!el('Street').value.trim()) return bad(el('Street'), 'needStreet');
    if (!el('Zip').value.trim()) return bad(el('Zip'), 'needZip');
    if (R.stateRequired(code) && !el('State').value.trim()) {
      return bad(el('State'), 'needState');
    }
    return { ok: true };
  };

  /* ---------- Поведінка ----------
     Вішається один раз на кожен намальований блок. */

  R.initAddress = function (prefix) {
    const root = document.querySelector('[data-addr="' + prefix + '"]');
    if (!root || root.dataset.bound) return;
    root.dataset.bound = '1';

    const carrierSel = root.querySelector('[data-addr-carrier]');
    const npBox = root.querySelector('[data-addr-np]');
    const intlBox = root.querySelector('[data-addr-intl]');
    const cityInput = document.getElementById(prefix + 'City');
    const branchInput = document.getElementById(prefix + 'Branch');
    const countrySel = root.querySelector('[data-addr-country]');
    const countryOther = document.getElementById(prefix + 'CountryOther');
    const zipInput = root.querySelector('[data-addr-zip]');
    const stateInput = root.querySelector('[data-addr-state]');

    function syncCarrier() {
      const np = carrierSel.value === 'np';
      npBox.hidden = !np;
      intlBox.hidden = np;
    }

    function syncCountry() {
      const code = countrySel.value;
      countryOther.hidden = code !== 'other';
      countryOther.closest('.field').hidden = code !== 'other';
      if (zipInput) zipInput.placeholder = R.zipHint(code) || '';
      if (stateInput) {
        stateInput.closest('.field').classList.toggle('is-required', R.stateRequired(code));
      }
    }

    carrierSel.addEventListener('change', syncCarrier);
    countrySel.addEventListener('change', syncCountry);
    syncCarrier();
    syncCountry();

    /* --- Списки-підказки --- */

    attachCombo(cityInput, {
      minChars: 2,
      load: (q) => R.npCities(q),
      render: (c) => ({
        text: c.label,
        note: c.warehouses ? R.t('addr.nWarehouses').replace('{n}', c.warehouses) : '',
        value: c.name,
        ref: c.ref
      }),
      onPick: () => {
        // місто змінилось — старе відділення більше не діє
        branchInput.value = '';
        branchInput.dataset.ref = '';
        branchInput.disabled = false;
        branchInput.focus();
      },
      empty: 'addr.noCity'
    });

    attachCombo(branchInput, {
      minChars: 0,
      load: async (q) => {
        const ref = cityInput.dataset.ref;
        if (!ref) return null; // спершу місто
        return R.npWarehouses(ref, q);
      },
      render: (w) => ({
        text: w.label,
        note: w.postomat ? R.t('addr.postomat') : '',
        value: w.label,
        ref: w.ref
      }),
      onPick: () => {},
      empty: 'addr.noBranch',
      needFirst: 'addr.pickCityFirst'
    });
  };

  /* ---------- Комбобокс ----------
     Звичайний input плюс список під ним: працює з клавіатури,
     не ламається без JS-фреймворків і не заважає вписати
     значення руками, якщо в списку його раптом немає. */

  function attachCombo(input, opts) {
    if (!input) return;
    const box = input.closest('.acombo__box');
    const list = box.querySelector('.acombo__list');
    const spin = box.querySelector('.acombo__spin');

    let items = [];
    let active = -1;
    let timer = null;
    let seq = 0;

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }

    function message(key) {
      list.innerHTML = '<li class="acombo__msg">' + esc(R.t(key)) + '</li>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function keepInViewLater() {
      setTimeout(keepInView, 40);
    }

    function draw() {
      if (!items.length) return message(opts.empty);
      list.innerHTML = items.map((it, i) => {
        const v = opts.render(it);
        return '<li class="acombo__opt' + (i === active ? ' is-active' : '') + '" ' +
          'role="option" data-i="' + i + '" aria-selected="' + (i === active) + '">' +
          '<span>' + esc(v.text) + '</span>' +
          (v.note ? '<i>' + esc(v.note) + '</i>' : '') +
        '</li>';
      }).join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      keepInView();
    }

    /* На телефоні під полем лишається смуга в пару рядків —
       решту списку затуляє липка кнопка оформлення. Підтягуємо
       поле вгору, щоб список було видно цілком. */
    function keepInView() {
      const room = window.innerHeight - input.getBoundingClientRect().bottom;
      if (room < 220) {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    function pick(i) {
      const it = items[i];
      if (!it) return;
      const v = opts.render(it);
      input.value = v.value;
      input.dataset.ref = v.ref || '';
      input.classList.remove('is-invalid');
      close();
      opts.onPick(it);
    }

    async function run() {
      const q = input.value;
      if (q.length < opts.minChars) return close();

      const my = ++seq;
      spin.hidden = false;
      try {
        const res = await opts.load(q);
        if (my !== seq) return;            // прийшла відповідь на старий запит
        if (res === null) return message(opts.needFirst || opts.empty);
        items = res.slice(0, 100);
        active = -1;
        draw();
      } catch (e) {
        if (my !== seq) return;
        message('addr.offline');
      } finally {
        if (my === seq) spin.hidden = true;
      }
    }

    input.addEventListener('input', () => {
      input.dataset.ref = '';        // текст правлять — старий вибір недійсний
      clearTimeout(timer);
      timer = setTimeout(run, 260);
    });

    input.addEventListener('focus', () => {
      if (input.value.length >= opts.minChars) run();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (list.hidden) { run(); return; }
        e.preventDefault();
        active += e.key === 'ArrowDown' ? 1 : -1;
        if (active < 0) active = items.length - 1;
        if (active >= items.length) active = 0;
        draw();
        const node = list.querySelector('.is-active');
        if (node) node.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (!list.hidden && active >= 0) {
          e.preventDefault();
          pick(active);
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    list.addEventListener('mousedown', (e) => {
      // mousedown, а не click: інакше blur встигне закрити список
      const opt = e.target.closest('.acombo__opt');
      if (opt) {
        e.preventDefault();
        pick(Number(opt.dataset.i));
      }
    });

    input.addEventListener('blur', () => setTimeout(close, 120));
  }
})();
