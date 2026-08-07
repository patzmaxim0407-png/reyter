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

  /* ---------- Доступність товару ----------
     Якщо з Firestore завантажено складські залишки (R.stock) —
     статус, розміри та «закінчується» рахуються з них.
     Інакше — зі статичних полів data.js (status / sizes / lowStock). */

  R.stock = null;
  R.LOW_STOCK_AT = 2; // «закінчується», коли лишилось стільки або менше

  R.availability = function (p) {
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

  function badgesHTML(p, av) {
    const badges = [];
    if (av.soldOut) {
      badges.push('<span class="badge badge--sold">' + R.t('badge.sold') + '</span>');
    } else if (p.sale) {
      badges.push('<span class="badge badge--sale">' + R.t('badge.sale') + '</span>');
    }
    if (!av.soldOut && av.low.length) {
      badges.push('<span class="badge badge--low">' + R.t('badge.low') + ' ' + R.esc(av.low.join(', ')) + '</span>');
    }
    return badges.length ? '<span class="pcard__badges">' + badges.join('') + '</span>' : '';
  }

  function cardHTML(p) {
    const av = R.availability(p);
    const cls = ['pcard'];
    if (p.sale) cls.push('pcard--sale');
    if (av.soldOut) cls.push('pcard--sold');

    const dots = (p.colors || [])
      .map((c) => '<span class="dot" style="background-color:' + R.esc(c) + '"></span>')
      .join('');

    const altImg = p.images[1]
      ? '<img class="alt" src="' + R.esc(p.images[1]) + '" alt="" loading="lazy">'
      : '';

    const saleNote = p.saleNote
      ? '<span class="pcard__salenote">' + R.esc(R.tf(p, 'saleNote')) + '</span>'
      : '';

    return (
      '<button type="button" class="' + cls.join(' ') + '" data-id="' + R.esc(p.id) + '" aria-haspopup="dialog">' +
        '<span class="pcard__media">' +
          '<img src="' + R.esc(p.images[0]) + '" alt="' + R.esc(R.tf(p, 'name')) + '" loading="lazy">' +
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

    let chipsHTML = '';
    let catsHTML = '';

    R.categories.forEach((cat) => {
      const items = products.filter((p) => p.category === cat.id);
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

    // Плавна поява карток із невеликою затримкою-каскадом
    root.querySelectorAll('.pgrid').forEach((grid) => {
      Array.prototype.forEach.call(grid.children, (card, i) => {
        card.classList.add('reveal');
        card.style.transitionDelay = Math.min(i % 4, 3) * 60 + 'ms';
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
      ch.addEventListener('click', () => setActive(ch.dataset.cat));
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
