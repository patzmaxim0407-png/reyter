/* Вивантаження замовлень із бази — ВСТАВИТИ В КОНСОЛЬ БРАУЗЕРА
   на відкритій сторінці адмінки reyter.men, під своїм входом.

   Читає базу ТВОЇМИ правами: скрипт бере токен уже наявного
   входу з IndexedDB, оновлює його і питає Firestore напряму.
   Нікуди нічого не надсилає — лише завантажує файл orders.json
   у теку «Завантаження».

   Чому не 500, як в адмінці: адмінка тягне ORDERS_LIMIT
   найновіших, а для звірки потрібні ВСІ, інакше «увесь час»
   тихо занижує суму. Тому тут посторінково, доки не скінчиться.
*/
(async () => {
  const API_KEY = 'AIzaSyD_88QLk2dxQDUIjEVMrRCTHgVkeVX-9pI';
  const PROJECT = 'reyter-18d2c';
  const FB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

  /* Токен входу лежить у IndexedDB firebase-івським ключем. */
  const stored = await new Promise((done, fail) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => fail(new Error('IndexedDB недоступна'));
    req.onsuccess = () => {
      const tx = req.result.transaction('firebaseLocalStorage', 'readonly');
      const all = tx.objectStore('firebaseLocalStorage').getAll();
      all.onsuccess = () => done(all.result || []);
      all.onerror = () => fail(new Error('не читається сховище входу'));
    };
  });
  const rec = stored.find((x) => String(x.fbase_key || '').startsWith('firebase:authUser:'));
  if (!rec) throw new Error('Не бачу входу. Залогінься в адмінці й повтори.');
  const refresh = rec.value?.stsTokenManager?.refreshToken;
  if (!refresh) throw new Error('У сховищі немає токена оновлення.');
  console.log('вхід:', rec.value?.email);

  /* Свіжий токен: збережений живе годину і зазвичай уже протух. */
  const tokRes = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refresh)
  });
  if (!tokRes.ok) throw new Error('токен не оновився: ' + tokRes.status);
  const idToken = (await tokRes.json()).id_token;

  /* Firestore віддає значення в обгортках — розгортаємо так
     само, як це робить воркер. */
  const val = (v) => {
    if (v == null) return null;
    if ('nullValue' in v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
    if ('mapValue' in v) return fields(v.mapValue.fields || {});
    return null;
  };
  const fields = (f) => {
    const out = {};
    for (const [k, v] of Object.entries(f || {})) out[k] = val(v);
    return out;
  };

  async function pull(collectionId, orderField) {
    const rows = [];
    const PAGE = 300;
    for (let offset = 0; ; offset += PAGE) {
      const body = {
        structuredQuery: {
          from: [{ collectionId }],
          limit: PAGE,
          offset,
          ...(orderField
            ? { orderBy: [{ field: { fieldPath: orderField }, direction: 'DESCENDING' }] }
            : {})
        }
      };
      const res = await fetch(FB + ':runQuery', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(collectionId + ': ' + res.status + ' ' + (await res.text()));
      const page = (await res.json()).filter((x) => x.document);
      for (const x of page) {
        rows.push({
          _id: x.document.name.split('/').pop(),
          ...fields(x.document.fields || {})
        });
      }
      console.log(collectionId, rows.length);
      if (page.length < PAGE) return rows;
    }
  }

  /* Товари й категорії — щоб звірка бачила собівартість і могла
     перевірити не лише виручку, а й маржу. */
  const [orders, products, categories] = await Promise.all([
    pull('orders', 'created'),
    pull('catalog_products', null),
    pull('catalog_categories', null)
  ]);

  const blob = new Blob([JSON.stringify({ orders, products, categories }, null, 2)], {
    type: 'application/json'
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'orders.json';
  a.click();
  console.log('✓ готово:', orders.length, 'замовлень,', products.length, 'товарів');
})();
