/* ============================================================
   REYTER — track.js
   Відстеження замовлення без акаунта.

   Задача: покупець, який оформив замовлення гостем, має бачити
   його статус. Читати колекцію orders гостю не можна — там
   адреси й телефони всіх покупців. Тому поряд лежить окрема
   колекція tracking з мінімумом даних (статус, дати, ТТН), а
   ідентифікатор документа — відбиток від номера замовлення
   і телефону. Тобто знайти запис може лише той, хто знає обидва:
   перебрати номери (їх формат передбачуваний) недостатньо.

   Документ tracking/{key}:
     num        номер замовлення
     date       коли оформлено
     status     поточний статус
     total      сума
     items      скільки позицій
     ttn        номер накладної, коли зʼявиться
     carrier    перевізник
     city       місто доставки
     log        [{status, at}] — історія без імен адміністраторів
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  /* Телефон покупець пише як завгодно: +380…, 380…, 0…
     Беремо останні 9 цифр — це та частина, що не змінюється */
  function phoneTail(phone) {
    return String(phone || '').replace(/\D/g, '').slice(-9);
  }

  R.trackPhoneTail = phoneTail;

  /* Ключ документа = відбиток «номер + телефон».
     SHA-256 є в кожному сучасному браузері, але лише на
     захищеному зʼєднанні; на http (локальний перегляд файлу)
     crypto.subtle недоступний — тоді відкочуємось на просту
     згортку. Для http-режиму це все одно лише розробка. */
  R.trackKey = async function (num, phone) {
    const raw = String(num || '').trim().toUpperCase() + '|' + phoneTail(phone);
    if (!raw || raw.length < 4) return '';

    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
        return Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 40);
      } catch (e) { /* нижче резервний варіант */ }
    }

    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < raw.length; i++) {
      h1 = ((h1 ^ raw.charCodeAt(i)) * 16777619) >>> 0;
      h2 = ((h2 + raw.charCodeAt(i) * (i + 7)) * 2654435761) >>> 0;
    }
    return ('dev' + h1.toString(16) + h2.toString(16)).slice(0, 40);
  };

  /* Публічна частина замовлення. Свідомо без імені, телефону,
     пошти й точної адреси: документ читає будь-хто з ключем.
     Назви товарів не таємниця — вони і так є в каталозі, зате
     покупець одразу впізнає своє замовлення. */
  R.trackData = function (order) {
    const c = order.customer || {};
    const log = (order.statusLog || [])
      .map((e) => ({ status: String(e.status || ''), at: String(e.at || '') }))
      .slice(-12);

    return {
      num: String(order.num || ''),
      date: String(order.date || ''),
      status: order.status || 'new',
      total: Number(order.total) || 0,
      items: (order.items || []).slice(0, 50).map((i) => ({
        name: String(i.name || ''),
        size: String(i.size || ''),
        qty: Number(i.qty) || 1
      })),
      ttn: order.ttn || '',
      carrier: c.carrier || '',
      city: c.city || c.intlCity || '',
      log: log.length ? log : [{ status: order.status || 'new', at: order.date || '' }]
    };
  };

  /* Створення запису при оформленні. Помилка тут не має валити
     саме замовлення — воно вже в базі, відстеження вторинне. */
  R.trackCreate = async function (order) {
    if (!R.fb || !R.fb.enabled) return '';
    const c = order.customer || {};
    const key = await R.trackKey(order.num, c.phone);
    if (!key) return '';
    try {
      await R.fb.db.collection('tracking').doc(key).set(R.trackData(order));
      return key;
    } catch (e) {
      return '';
    }
  };

  /* Оновлення статусу / ТТН з адмінки. Ключ лежить у самому
     замовленні: телефон могли відредагувати, і рахувати його
     заново означало б писати в чужий документ. */
  R.trackUpdate = async function (order, patch) {
    if (!R.fb || !R.fb.enabled) return false;
    const key = order.trackKey || (await R.trackKey(order.num, (order.customer || {}).phone));
    if (!key) return false;
    try {
      await R.fb.db.collection('tracking').doc(key).set(
        Object.assign(R.trackData(order), patch || {}),
        { merge: true }
      );
      return true;
    } catch (e) {
      return false;
    }
  };

  R.trackDelete = async function (key) {
    if (!key || !R.fb || !R.fb.enabled) return;
    try {
      await R.fb.db.collection('tracking').doc(key).delete();
    } catch (e) { /* не критично */ }
  };

  /* Пошук для покупця */
  R.trackFind = async function (num, phone) {
    if (!R.fb || !R.fb.enabled) return { ok: false, reason: 'offline' };

    const clean = String(num || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!clean) return { ok: false, reason: 'no_num' };
    if (phoneTail(phone).length < 9) return { ok: false, reason: 'no_phone' };

    const key = await R.trackKey(clean, phone);
    try {
      const snap = await R.fb.db.collection('tracking').doc(key).get();
      if (!snap.exists) return { ok: false, reason: 'not_found' };
      return { ok: true, order: snap.data() };
    } catch (e) {
      return { ok: false, reason: 'offline' };
    }
  };
})();
