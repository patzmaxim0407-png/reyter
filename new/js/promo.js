/* ============================================================
   REYTER — promo.js
   Промокоди: пошук, перевірка умов і розрахунок знижки.
   Один і той самий рушій використовують кошик (клієнт)
   і адмінка (попередній перегляд правил).

   Документ у Firestore: promos/{КОД}
     type        'percent' | 'fixed'   — відсоток або сума в грн
     value       число знижки
     scope       'all' | 'categories' | 'products'
     categories  масив id категорій (для scope = categories)
     products    масив артикулів (для scope = products)
     excludeSale true → не діє на товари, що вже зі знижкою
     minTotal    мінімальна сума кошика, грн
     startsAt    'РРРР-ММ-ДД' — діє з (включно), необовʼязково
     endsAt      'РРРР-ММ-ДД' — діє до (включно), необовʼязково
     usageLimit  скільки разів можна використати всього (0 — без ліміту)
     usedCount   скільки разів уже використано
     active      вимикач без видалення
     note        службовий коментар для адміна
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;
  const KEY = 'reyter:promo';

  /* ---------- Дати ---------- */

  function startOfDay(iso) {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  function endOfDay(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return null;
    d.setDate(d.getDate() + 1); // кінцевий день включно
    return d;
  }

  /* ---------- Нормалізація коду ---------- */

  R.promoNormalize = function (code) {
    return String(code || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
  };

  /* ---------- Позиції, на які поширюється промокод ---------- */

  function eligible(promo, items) {
    return items.filter((it) => {
      if (promo.excludeSale && it.sale) return false;
      if (promo.scope === 'categories') {
        return (promo.categories || []).includes(it.category);
      }
      if (promo.scope === 'products') {
        return (promo.products || []).includes(it.id);
      }
      return true;
    });
  }

  function sumOf(items) {
    return items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  }

  /* ---------- Перевірка ----------
     items: [{ id, category, price, qty, sale }]
     Повертає { ok, reason, discount, eligibleTotal, ... } */

  R.promoCheck = function (promo, items, now) {
    const subtotal = sumOf(items);
    const time = now || new Date();

    if (!promo) return { ok: false, reason: 'not_found' };
    if (promo.active === false) return { ok: false, reason: 'inactive' };

    if (promo.startsAt) {
      const from = startOfDay(promo.startsAt);
      if (from && time < from) {
        return { ok: false, reason: 'not_started', date: promo.startsAt };
      }
    }

    if (promo.endsAt) {
      const to = endOfDay(promo.endsAt);
      if (to && time >= to) {
        return { ok: false, reason: 'expired', date: promo.endsAt };
      }
    }

    const limit = Number(promo.usageLimit) || 0;
    if (limit > 0 && (Number(promo.usedCount) || 0) >= limit) {
      return { ok: false, reason: 'exhausted' };
    }

    const min = Number(promo.minTotal) || 0;
    if (min > 0 && subtotal < min) {
      return { ok: false, reason: 'min_total', need: min - subtotal, minTotal: min };
    }

    const items2 = eligible(promo, items);
    const eligibleTotal = sumOf(items2);

    if (!items2.length || eligibleTotal <= 0) {
      return { ok: false, reason: 'no_items', scope: promo.scope };
    }

    let discount = promo.type === 'fixed'
      ? Math.min(Number(promo.value) || 0, eligibleTotal)
      : Math.round(eligibleTotal * (Number(promo.value) || 0) / 100);

    discount = Math.max(0, Math.min(Math.round(discount), subtotal));

    if (discount <= 0) return { ok: false, reason: 'no_items', scope: promo.scope };

    return {
      ok: true,
      reason: 'ok',
      discount: discount,
      eligibleTotal: eligibleTotal,
      eligibleCount: items2.length,
      partial: items2.length < items.length
    };
  };

  /* ---------- Завантаження коду з бази ----------
     Правила дозволяють читати конкретний документ, але не
     переглядати весь список — підібрати чужі коди не вийде. */

  R.promoFetch = async function (code) {
    if (!R.fb || !R.fb.enabled) return null;
    const id = R.promoNormalize(code);
    if (!id) return null;
    try {
      const snap = await R.fb.db.collection('promos').doc(id).get();
      return snap.exists ? Object.assign({ code: id }, snap.data()) : null;
    } catch (e) {
      return null;
    }
  };

  /* ---------- Збереження застосованого коду ---------- */

  R.promoSaved = function () {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || null;
    } catch (e) {
      return null;
    }
  };

  R.promoSave = function (promo) {
    try {
      if (promo) localStorage.setItem(KEY, JSON.stringify(promo));
      else localStorage.removeItem(KEY);
    } catch (e) { /* приватний режим */ }
  };

  /* ---------- Лічильник використань ----------
     Викликається після успішного оформлення замовлення. */

  R.promoCountUse = async function (code) {
    if (!R.fb || !R.fb.enabled || !code) return;
    try {
      await R.fb.db.collection('promos').doc(R.promoNormalize(code)).update({
        usedCount: firebase.firestore.FieldValue.increment(1)
      });
    } catch (e) { /* не критично для замовлення */ }
  };

  /* ---------- Текст для покупця ---------- */

  /* Рушій використовують і сайт, і адмінка — тож не покладаємось
     на модулі, яких в адмінці може не бути */
  R.promoMessage = function (res, promo) {
    const money = (n) => (R.uah ? R.uah(n) : R.fmt ? R.fmt(n) + ' грн' : n + ' грн');
    const t = (k) => (R.t ? R.t(k) : k);
    const catName = (id) => {
      if (R.categoryTitle) return R.categoryTitle(id) || id;
      const c = (R.categories || []).find((x) => x.id === id);
      return c ? c.title : id;
    };
    const prodName = (id) => {
      const p = R.getProduct
        ? R.getProduct(id)
        : (R.products || []).find((x) => x.id === id);
      if (!p) return id;
      return R.tf ? R.tf(p, 'name') : p.name;
    };

    switch (res.reason) {
      case 'ok': {
        let msg = t('promo.ok').replace('{sum}', money(res.discount));
        if (res.partial) msg += ' ' + t('promo.partial');
        return msg;
      }
      case 'not_found':  return t('promo.notFound');
      case 'inactive':   return t('promo.inactive');
      case 'not_started':
        return t('promo.notStarted').replace('{date}', R.promoDate(res.date));
      case 'expired':
        return t('promo.expired').replace('{date}', R.promoDate(res.date));
      case 'exhausted':  return t('promo.exhausted');
      case 'min_total':
        return t('promo.minTotal')
          .replace('{min}', money(res.minTotal))
          .replace('{need}', money(res.need));
      case 'no_items': {
        if (promo && promo.scope === 'categories') {
          const names = (promo.categories || []).map(catName).filter(Boolean).join(', ');
          return t('promo.noItemsCats').replace('{cats}', names);
        }
        if (promo && promo.scope === 'products') {
          const names = (promo.products || []).map(prodName).join(', ');
          return t('promo.noItemsProducts').replace('{products}', names);
        }
        if (promo && promo.excludeSale) return t('promo.noItemsSale');
        return t('promo.noItems');
      }
      default: return t('promo.notFound');
    }
  };

  R.promoDate = function (iso) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    const en = R.lang && R.lang() === 'en';
    return d.toLocaleDateString(en ? 'en-GB' : 'uk-UA', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  };
})();
