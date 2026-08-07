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
    return c ? c.title : '';
  };

  R.visibleProducts = function () {
    return R.products.filter((p) => !p.hidden);
  };

  R.priceHTML = function (p, big) {
    let html = '<span class="price__now">' + R.fmt(p.price) + ' грн</span>';
    if (p.oldPrice) {
      html += '<del class="price__old">' + R.fmt(p.oldPrice) + ' грн</del>';
    }
    if (p.priceUsd) {
      html += '<span class="price__usd">≈ ' + p.priceUsd + ' $</span>';
    }
    return html;
  };

  /* ---------- Картка товару ---------- */

  function badgesHTML(p) {
    const badges = [];
    if (p.status === 'sold-out') {
      badges.push('<span class="badge badge--sold">Продано</span>');
    } else if (p.sale) {
      badges.push('<span class="badge badge--sale">Sale</span>');
    }
    if (p.status !== 'sold-out' && p.lowStock && p.lowStock.length) {
      badges.push('<span class="badge badge--low">Закінчується ' + R.esc(p.lowStock.join(', ')) + '</span>');
    }
    return badges.length ? '<span class="pcard__badges">' + badges.join('') + '</span>' : '';
  }

  function cardHTML(p) {
    const cls = ['pcard'];
    if (p.sale) cls.push('pcard--sale');
    if (p.status === 'sold-out') cls.push('pcard--sold');

    const dots = (p.colors || [])
      .map((c) => '<span class="dot" style="background-color:' + R.esc(c) + '"></span>')
      .join('');

    const altImg = p.images[1]
      ? '<img class="alt" src="' + R.esc(p.images[1]) + '" alt="" loading="lazy">'
      : '';

    const saleNote = p.saleNote
      ? '<span class="pcard__salenote">' + R.esc(p.saleNote) + '</span>'
      : '';

    return (
      '<button type="button" class="' + cls.join(' ') + '" data-id="' + R.esc(p.id) + '" aria-haspopup="dialog">' +
        '<span class="pcard__media">' +
          '<img src="' + R.esc(p.images[0]) + '" alt="' + R.esc(p.name) + '" loading="lazy">' +
          altImg +
          badgesHTML(p) +
        '</span>' +
        '<span class="pcard__body">' +
          '<span class="pcard__title">' + R.esc(p.name) + dots + '</span>' +
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
        R.esc(cat.title) + '</a>';

      catsHTML +=
        '<section class="category" id="cat-' + R.esc(cat.id) + '">' +
          '<div class="category__head reveal">' +
            '<h3 class="category__title">' + R.esc(cat.title) + '</h3>' +
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

    // Відкриття товару
    root.addEventListener('click', (e) => {
      const card = e.target.closest('.pcard');
      if (card && R.openProduct) R.openProduct(card.dataset.id);
    });

    initScrollSpy();
    injectJsonLd(products);
  }

  /* ---------- Підсвічування активної категорії ---------- */

  function initScrollSpy() {
    const chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
    if (!chips.length || !('IntersectionObserver' in window)) return;

    function setActive(id) {
      chips.forEach((ch) => ch.classList.toggle('is-active', ch.dataset.cat === id));
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
    const data = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'REYTER — каталог',
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: p.name,
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
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }

  R.renderCatalog = render;
})();
