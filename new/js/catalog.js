/* ============================================================
   REYTER — catalog.js
   Рендер каталогу з даних (data.js): стрічка категорій,
   секції категорій, картки товарів, structured data для SEO
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  /* ---------- Хелпери (спільні для всіх модулів) ---------- */

  R.fmt = function (n) {
    return Number(n).toLocaleString('uk-UA');
  };

  R.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  R.getProduct = function (id) {
    return R.products.find((p) => p.id === id) || null;
  };

  R.categoryTitle = function (id) {
    const c = R.categories.find((c) => c.id === id);
    return c ? R.tf(c, 'title') : '';
  };

  R.visibleProducts = function () {
    return R.products.filter((p) => !p.hidden);
  };

  /* Товар може стояти в кількох категоріях одразу: наприклад
     Swimwear показується і в своїй категорії, і в «New drop».
     Поле category лишається головним — за ним працюють склад,
     адмінка й старі дані, де масиву ще немає. */
  R.productCats = function (p) {
    if (!p) return [];
    const list = Array.isArray(p.categories) ? p.categories.filter(Boolean) : [];
    if (p.category && !list.includes(p.category)) list.unshift(p.category);
    return list;
  };

  /* Кольори товару. Старий формат — просто масив відтінків,
     новий — обʼєкти {hex, id}, де id вказує на картку того
     самого товару в іншому кольорі. Читаємо обидва.

     Прив'язку до схованого товару відкидаємо: зразок вів би на
     картку, якої в каталозі немає, а сам відтінок означав би
     колір, який не купити. Зразки без прив'язки лишаються —
     це просто позначки наявних відтінків. */
  R.productColors = function (p) {
    return ((p && p.colors) || [])
      .map((c) =>
        typeof c === 'string' ? { hex: c, id: '' } : { hex: c.hex || '', id: c.id || '' })
      .filter((c) => {
        if (!c.hex) return false;
        if (!c.id) return true;
        const linked = R.getProduct(c.id);
        return !!linked && !linked.hidden;
      });
  };

  R.inCategory = function (p, catId) {
    return R.productCats(p).includes(catId);
  };

  R.uah = function (n) {
    return R.lang && R.lang() === 'en'
      ? 'UAH ' + R.fmt(n)
      : R.fmt(n) + ' грн';
  };

  R.priceHTML = function (p, big) {
    let html = '<span class="price__now">' + R.uah(p.price) + '</span>';
    if (p.oldPrice) {
      html += '<del class="price__old">' + R.uah(p.oldPrice) + '</del>';
    }
    if (p.priceUsd) {
      html += '<span class="price__usd">≈ ' + p.priceUsd + ' $</span>';
    }
    return html;
  };

  /* ============================================================
     КОМПЛЕКТИ
     ------------------------------------------------------------
     Комплект — товар, зібраний з інших товарів каталогу
     (поле set: масив артикулів). Власних залишків він не має:
     скільки комплектів можна зібрати — рахується зі складників.
     Розміру «комплекту» теж не існує: покупець обирає розмір
     кожного складника окремо, бо верх і низ у людей різні.
     ============================================================ */

  R.isSet = function (p) {
    return !!(p && Array.isArray(p.set) && p.set.length);
  };

  /* Складники з каталогу.
     Схований складник ЛИШАЄТЬСЯ у комплекті: «сховати з сайту»
     означає «не продавати окремо», а не «вийняти з комплекту».
     Якби ми його відкидали, покупець платив би за комплект, а
     отримував менше — і залишок цієї речі не списувався б.
     Відкидаємо лише те, чого справді немає: видалений товар і
     складник, який сам став комплектом (це була б рекурсія). */
  R.setParts = function (p) {
    if (!R.isSet(p)) return [];
    return p.set
      .map((id) => R.getProduct(id))
      .filter((x) => x && !R.isSet(x));
  };

  /* Комплект, з якого зник складник, зібрати неможливо —
     продавати його не можна навіть за наявності решти */
  R.setBroken = function (p) {
    return R.isSet(p) && R.setParts(p).length !== p.set.length;
  };

  /* Чи має товар розмірну сітку (свічки й аромати її не мають) */
  R.isSized = function (p) {
    return !!(p && !p.volume && p.sizes && p.sizes.length);
  };

  /* Скільки штук цього товару в цьому розмірі. Без живих залишків
     орієнтуємось на статичні поля: точного числа там немає, тож
     повертаємо умовно «достатньо». */
  R.stockQty = function (p, size) {
    if (!p) return 0;
    const s = R.stock && R.stock[p.id];
    const sized = R.isSized(p);

    if (!s) {
      if (p.status === 'sold-out') return 0;
      if (!sized) return 99;
      return (p.sizes || []).includes(size) ? 99 : 0;
    }
    if (!sized) return Number(s.qty) || 0;
    return Number((s.sizes || {})[size]) || 0;
  };

  /* Скільки комплектів одного розміру можна зібрати: обмежує
     найдефіцитніший складник. Складник без розмірів (свічка)
     рахується за загальною кількістю. */
  R.setQty = function (p, size) {
    const parts = R.setParts(p);
    if (!parts.length) return 0;
    return parts.reduce(
      (min, x) => Math.min(min, R.stockQty(x, R.isSized(x) ? size : null)),
      Infinity
    ) || 0;
  };

  function setAvailability(p) {
    const parts = R.setParts(p);
    if (!parts.length) return null;   // складників не лишилось зовсім

    const avs = parts.map((x) => R.availability(x));

    // Немає бодай одного складника — комплект не зібрати ніяк.
    // Так само, якщо частину складників видалили з каталогу.
    const soldOut = R.setBroken(p) || avs.some((a) => a.soldOut);

    /* Розміри, у яких комплект збирається «весь одного розміру».
       Це для бейджів на картці та для складу; у самій картці
       товару покупець бачить сітку кожного складника окремо
       й може змішувати розміри. */
    const sizes = R.config.allSizes.filter((s) =>
      parts.every((x) => !R.isSized(x) || R.stockQty(x, s) > 0));

    const low = sizes.filter((s) => R.setQty(p, s) <= R.LOW_STOCK_AT);
    const total = sizes.reduce((n, s) => n + R.setQty(p, s), 0);

    return {
      live: avs.some((a) => a.live),
      isSet: true,
      soldOut: soldOut,
      sizes: soldOut ? [] : sizes,
      low: soldOut ? [] : low,
      total: total
    };
  }

  /* ---------- Доступність товару ----------
     Якщо з Firestore завантажено складські залишки (R.stock) —
     статус, розміри та «закінчується» рахуються з них.
     Інакше — зі статичних полів data.js (status / sizes / lowStock). */

  R.stock = null;
  R.LOW_STOCK_AT = 2; // «закінчується», коли лишилось стільки або менше

  R.availability = function (p) {
    if (R.isSet(p)) {
      const set = setAvailability(p);
      if (set) return set;
    }

    const s = R.stock && R.stock[p.id];

    if (s) {
      if (p.volume || !(p.sizes && p.sizes.length)) {
        const qty = Number(s.qty) || 0;
        return { live: true, soldOut: qty <= 0, sizes: [], low: [], total: qty };
      }
      const sz = s.sizes || {};
      const avail = Object.keys(sz).filter((k) => Number(sz[k]) > 0);
      const low = avail.filter((k) => Number(sz[k]) <= R.LOW_STOCK_AT);
      const total = Object.keys(sz).reduce((sum, k) => sum + (Number(sz[k]) || 0), 0);
      return { live: true, soldOut: total <= 0, sizes: avail, low: low, total: total };
    }

    return {
      live: false,
      soldOut: p.status === 'sold-out',
      sizes: p.sizes || [],
      low: p.lowStock || []
    };
  };

  /* ---------- Картка товару ---------- */

  /* Угорі — статус товару (Sale / Продано), унизу — попередження
     про залишки: воно стосується конкретних розмірів і не має
     сперечатися за увагу з головним бейджем */
  function badgesHTML(p, av) {
    let html = '';

    if (av.soldOut) {
      html += '<span class="pcard__badges"><span class="badge badge--sold">' +
        R.t('badge.sold') + '</span></span>';
    } else if (p.sale) {
      html += '<span class="pcard__badges"><span class="badge badge--sale">' +
        R.t('badge.sale') + '</span></span>';
    }

    if (!av.soldOut && av.low.length) {
      html += '<span class="pcard__badges pcard__badges--low">' +
        '<span class="badge badge--low">' + R.t('badge.low') + ' ' +
        R.esc(av.low.join(', ')) + '</span></span>';
    }

    return html;
  }

  /* Перші картки вантажимо одразу: поки їх зображення «ліниві»,
     на початку каталогу видно порожні прямокутники. Решта —
     lazy, інакше сторінка тягне всі 30 фото відразу. */
  const EAGER_CARDS = 8;
  let cardIndex = 0;

  function cardHTML(p) {
    const av = R.availability(p);
    const cls = ['pcard'];
    if (p.sale) cls.push('pcard--sale');
    if (av.soldOut) cls.push('pcard--sold');

    const eager = cardIndex++ < EAGER_CARDS;
    const load = eager
      ? ' fetchpriority="high" decoding="async"'
      : ' loading="lazy" decoding="async"';

    const dots = R.productColors(p)
      .map((c) => '<span class="dot" style="background-color:' + R.esc(c.hex) + '"></span>')
      .join('');

    const altImg = p.images[1]
      ? '<img class="alt" src="' + R.esc(p.images[1]) + '" alt="" loading="lazy" decoding="async">'
      : '';

    const saleNote = p.saleNote
      ? '<span class="pcard__salenote">' + R.esc(R.tf(p, 'saleNote')) + '</span>'
      : '';

    return (
      '<button type="button" class="' + cls.join(' ') + '" data-id="' + R.esc(p.id) + '" aria-haspopup="dialog">' +
        '<span class="pcard__media">' +
          '<img src="' + R.esc(p.images[0]) + '" alt="' + R.esc(R.tf(p, 'name')) + '"' + load + '>' +
          altImg +
          badgesHTML(p, av) +
        '</span>' +
        '<span class="pcard__body">' +
          '<span class="pcard__title">' + R.esc(R.tf(p, 'name')) + dots + '</span>' +
          '<span class="pcard__price">' + R.priceHTML(p) + '</span>' +
          saleNote +
        '</span>' +
      '</button>'
    );
  }

  /* ---------- Рендер каталогу ---------- */

  function render() {
    const root = document.getElementById('catalogRoot');
    const chips = document.getElementById('catChips');
    if (!root || !chips) return;

    const products = R.visibleProducts();
    cardIndex = 0;

    let chipsHTML = '';
    let catsHTML = '';

    R.categories.forEach((cat) => {
      const items = products.filter((p) => R.inCategory(p, cat.id));
      if (!items.length) return;

      chipsHTML +=
        '<a class="chip" href="#cat-' + R.esc(cat.id) + '" data-cat="' + R.esc(cat.id) + '">' +
        R.esc(R.tf(cat, 'title')) + '</a>';

      catsHTML +=
        '<section class="category" id="cat-' + R.esc(cat.id) + '">' +
          '<div class="category__head reveal">' +
            '<h3 class="category__title">' + R.esc(R.tf(cat, 'title')) + '</h3>' +
            '<span class="category__count">' + items.length + '</span>' +
            '<span class="category__rule"></span>' +
          '</div>' +
          '<div class="pgrid">' + items.map(cardHTML).join('') + '</div>' +
        '</section>';
    });

    chips.innerHTML = chipsHTML;
    root.innerHTML = catsHTML;

    // Плавна поява карток із невеликою затримкою-каскадом.
    // Каскад короткий: довгий читається як підгальмовування.
    root.querySelectorAll('.pgrid').forEach((grid) => {
      Array.prototype.forEach.call(grid.children, (card, i) => {
        card.classList.add('reveal');
        card.style.transitionDelay = Math.min(i % 4, 3) * 35 + 'ms';
        // Затримка потрібна лише каскаду появи. Якщо її лишити,
        // вона відкладає і hover-переходи — картки «блимають»
        // під курсором під час прокрутки.
        card.addEventListener('transitionend', function clear(e) {
          if (e.propertyName !== 'opacity') return;
          card.style.transitionDelay = '';
          card.removeEventListener('transitionend', clear);
        });
      });
    });

    // Відкриття товару (обробник — один раз)
    if (!root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', (e) => {
        const card = e.target.closest('.pcard');
        if (card && R.openProduct) R.openProduct(card.dataset.id);
      });
    }

    initScrollSpy();
    injectJsonLd(products);
  }

  /* Перерендер після завантаження живих залишків */
  function refresh() {
    render();
    // одразу показуємо картки, без повторної reveal-анімації
    document.querySelectorAll('#catalogRoot .reveal').forEach((el) => {
      el.classList.add('is-visible');
    });
  }

  /* ---------- Підсвічування активної категорії ---------- */

  function initScrollSpy() {
    const chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
    if (!chips.length || !('IntersectionObserver' in window)) return;

    const strip = document.getElementById('catChips');
    let userScrolling = 0;

    /* Активний чип під'їжджає в центр стрічки, щоб було видно,
       у якій категорії ти зараз */
    function centerChip(chip) {
      if (!strip || Date.now() < userScrolling) return;
      const target = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
      const max = strip.scrollWidth - strip.clientWidth;
      const left = Math.max(0, Math.min(target, max));
      if (Math.abs(strip.scrollLeft - left) < 4) return;
      strip.scrollTo({ left: left, behavior: 'smooth' });
    }

    /* Поки користувач сам гортає стрічку — не заважаємо йому */
    if (strip) {
      strip.addEventListener('touchstart', () => { userScrolling = Date.now() + 2500; }, { passive: true });
      strip.addEventListener('wheel', () => { userScrolling = Date.now() + 2500; }, { passive: true });
    }

    function setActive(id) {
      let activeChip = null;
      chips.forEach((ch) => {
        const on = ch.dataset.cat === id;
        ch.classList.toggle('is-active', on);
        if (on) activeChip = ch;
      });
      if (activeChip) centerChip(activeChip);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id.replace('cat-', ''));
        });
      },
      { rootMargin: '-30% 0px -60% 0px' }
    );

    document.querySelectorAll('.category').forEach((s) => observer.observe(s));

    chips.forEach((ch) => {
      ch.addEventListener('click', () => {
        setActive(ch.dataset.cat);
        // Показуємо секцію ще до стрибка: інакше приїжджаєш
        // на порожнє місце, яке проявляється вже під носом
        const section = document.getElementById('cat-' + ch.dataset.cat);
        if (section && R.revealNow) R.revealNow(section);
      });
    });
  }

  /* ---------- Structured data (SEO) ---------- */

  function absUrl(path) {
    return R.config.siteUrl + String(path).replace(/^\.\./, '');
  }

  function injectJsonLd(products) {
    const prev = document.getElementById('jsonld-catalog');
    if (prev) prev.remove();

    const data = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'REYTER — каталог',
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: R.tf(p, 'name'),
          sku: p.id,
          image: p.images.map(absUrl),
          brand: { '@type': 'Brand', name: 'REYTER' },
          offers: {
            '@type': 'Offer',
            priceCurrency: 'UAH',
            price: p.price,
            availability:
              p.status === 'sold-out'
                ? 'https://schema.org/SoldOut'
                : 'https://schema.org/InStock'
          }
        }
      }))
    };

    const script = document.createElement('script');
    script.id = 'jsonld-catalog';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }

  R.renderCatalog = render;
  R.refreshCatalog = refresh;
})();
