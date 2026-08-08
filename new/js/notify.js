/* ============================================================
   REYTER — notify.js
   Сповіщення про нове замовлення:
   • Telegram-повідомлення магазину
   • фірмовий лист-підтвердження покупцю
   Обидва канали проходять через Cloudflare Worker: він тримає
   у себе ключ Resend і токен Telegram-бота, тому з коду сайту
   їх не прочитати. Резервні шляхи (FormSubmit для листа,
   прямий Bot API для Telegram) вмикаються, лише якщо воркер
   не налаштований або не відповів.

   Налаштування у Firestore:
     settings/public — адреса воркера й пошта магазину
                       (читає браузер покупця, секретів немає)
     settings/notify — те саме + службові поля, лише для адміна
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  let cached = null;

  /* Покупцю потрібна лише публічна частина. settings/notify —
     резерв для сайтів, де адмін ще не перезберіг налаштування
     після оновлення (тоді settings/public ще не існує). */
  async function loadSettings(force) {
    if (cached && !force) return cached;
    if (!R.fb || !R.fb.enabled) return null;
    try {
      let snap = await R.fb.db.collection('settings').doc('public').get();
      if (!snap.exists) {
        snap = await R.fb.db.collection('settings').doc('notify').get();
      }
      cached = snap.exists ? snap.data() : {};
      return cached;
    } catch (e) {
      return null;
    }
  }

  /* Повні налаштування — читає лише адмінка (правила бази
     дозволяють settings/notify тільки адміністраторам) */
  async function loadAdminSettings() {
    if (!R.fb || !R.fb.enabled) return null;
    try {
      const snap = await R.fb.db.collection('settings').doc('notify').get();
      return snap.exists ? snap.data() : {};
    } catch (e) {
      return null;
    }
  }

  /* ---------- Звернення до воркера ----------
     Адреса могла бути збережена без https:// — інакше браузер
     вважатиме її відносним шляхом на самому сайті */

  R.normalizeUrl = function (u) {
    const s = String(u || '').trim().replace(/\/+$/, '');
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : 'https://' + s;
  };

  /* Ключ адміністратора воркера зберігається лише в браузері
     адміна — у базу він не потрапляє */
  const KEY_STORE = 'reyter:workerKey';

  R.workerKey = function (value) {
    try {
      if (value === undefined) return localStorage.getItem(KEY_STORE) || '';
      if (value) localStorage.setItem(KEY_STORE, value);
      else localStorage.removeItem(KEY_STORE);
      return value || '';
    } catch (e) {
      return '';
    }
  };

  async function callWorker(settings, body) {
    const url = R.normalizeUrl(settings && settings.workerUrl);
    if (!url) return { ok: false, error: 'не вказано адресу Worker у налаштуваннях' };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.error) data.error = 'воркер відповів кодом ' + res.status;
      return data;
    } catch (e) {
      return { ok: false, error: 'не вдалося звʼязатися з воркером — перевірте адресу' };
    }
  }

  /* ---------- Telegram напряму (резерв) ----------
     Працює, поки токен ще лежить у settings/notify. Після
     переносу токена у воркер цей шлях не використовується. */

  function chatIds(settings) {
    return String((settings && settings.tgChatId) || '')
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function sendToChat(token, chatId, text) {
    try {
      const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          disable_web_page_preview: true
        })
      });
      const data = await res.json().catch(() => ({}));
      return { ok: !!data.ok, chatId: chatId, description: data.description || '' };
    } catch (e) {
      return { ok: false, chatId: chatId, description: 'Немає звʼязку з Telegram' };
    }
  }

  async function sendTelegramDirect(settings, text) {
    const ids = chatIds(settings);
    if (!settings || !settings.tgToken || !ids.length) {
      return { ok: false, sent: 0, total: 0, description: 'Не заповнено токен або Chat ID' };
    }

    const results = await Promise.all(ids.map((id) => sendToChat(settings.tgToken, id, text)));
    const failed = results.filter((r) => !r.ok);

    return {
      ok: failed.length < results.length,   // хоч комусь дійшло
      sent: results.length - failed.length,
      total: results.length,
      description: failed.map((f) => f.chatId + ' — ' + f.description).join('; ')
    };
  }

  /* Хто писав боту — те саме, що вміє воркер, але з токеном
     із бази. Потрібне лише під час переходу на воркер. */
  async function detectChatsDirect(token) {
    if (!token) return { ok: false, description: 'у воркері не задано TG_TOKEN' };
    try {
      const res = await fetch('https://api.telegram.org/bot' + token + '/getUpdates');
      const data = await res.json().catch(() => ({}));
      if (!data.ok) return { ok: false, description: data.description || 'невірний токен бота' };

      const seen = {};
      (data.result || []).forEach((u) => {
        const msg = u.message || u.edited_message || u.my_chat_member;
        const chat = msg && msg.chat;
        if (!chat || !chat.id) return;
        seen[String(chat.id)] = {
          id: String(chat.id),
          name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '',
          isGroup: chat.type === 'group' || chat.type === 'supergroup'
        };
      });

      const chats = Object.keys(seen).map((k) => seen[k]);
      if (!chats.length) {
        return {
          ok: false,
          description: 'повідомлень не знайдено. Напишіть боту будь-що (або додайте його в групу і напишіть там) і спробуйте ще раз'
        };
      }
      return { ok: true, chats: chats };
    } catch (e) {
      return { ok: false, description: 'немає звʼязку з Telegram' };
    }
  }

  /* ---------- Email через FormSubmit (резерв) ----------
     Простий текстовий лист покупцю (автовідповідь) і копія
     замовлення на пошту магазину. */

  /* Лист покупцю — мовою, якою він користувався на сайті */
  function customerLetter(params) {
    const en = R.lang && R.lang() === 'en';

    if (en) {
      return (
        'Hello' + (params.to_name ? ', ' + params.to_name : '') + '!\n\n' +
        'We have received your order No. ' + params.order_num + ' at reyter.men — thank you 💙\n\n' +
        params.order_items + '\n\n' +
        'Total: ' + params.order_total + '\n' +
        (params.order_delivery ? 'Delivery: ' + params.order_delivery + '\n' : '') +
        '\nOur manager will contact you to confirm the order. ' +
        'You can track its status in your account at https://reyter.men/new/?lang=en\n\n' +
        '— The REYTER team. Character is REYTER!'
      );
    }

    return (
      'Вітаємо' + (params.to_name ? ', ' + params.to_name : '') + '!\n\n' +
      'Ми отримали ваше замовлення №' + params.order_num + ' на reyter.men — дякуємо 💙\n\n' +
      params.order_items + '\n\n' +
      'Разом: ' + params.order_total + '\n' +
      (params.order_delivery ? 'Доставка: ' + params.order_delivery + '\n' : '') +
      '\nНайближчим часом менеджер звʼяжеться з вами для підтвердження. ' +
      'Статус замовлення можна відстежувати у своєму кабінеті на https://reyter.men/new/\n\n' +
      '— Команда REYTER. Характер — це REYTER!'
    );
  }

  async function sendFormSubmit(settings, params) {
    if (!settings || !settings.fsEmail) {
      return { ok: false, description: 'Не налаштовано резервну пошту (FormSubmit)' };
    }
    try {
      const res = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(settings.fsEmail), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: '🛍 Замовлення №' + params.order_num + ' — reyter.men',
          _template: 'table',
          _captcha: 'false',
          _autoresponse: customerLetter(params),
          name: params.to_name || 'Покупець',
          email: params.to_email,
          'Замовлення': params.order_num,
          'Товари': params.order_items,
          'Разом': params.order_total,
          'Доставка': params.order_delivery || '—'
        })
      });
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && (data.success === true || data.success === 'true');
      const msg = String(data.message || '');
      return {
        ok: ok,
        via: ok ? 'formsubmit' : '',
        needsActivation: /activat/i.test(msg),
        description: ok ? '' : (msg || 'FormSubmit відхилив запит')
      };
    } catch (e) {
      return { ok: false, description: 'Немає звʼязку з FormSubmit' };
    }
  }

  /* ---------- Дані замовлення → тіло запиту до воркера ---------- */

  function buildParams(order) {
    const c = order.customer || {};
    const money = (n) => (R.uah ? R.uah(n) : R.fmt ? R.fmt(n) + ' грн' : n + ' грн');
    const discount = Number(order.discount) || 0;

    return {
      to_email: c.email || '',
      to_name: c.name || '',
      to_phone: c.phone || '',
      order_num: order.num,
      order_items: (order.items || [])
        .map((i) => '• ' + i.name + (i.size ? ' (' + i.size + ')' : '') + ' × ' + i.qty + ' — ' + money(i.price * i.qty))
        .join('\n'),
      items_list: (order.items || []).map((i) => ({
        name: i.name,
        size: i.size || '',
        qty: i.qty,
        sum: money(i.price * i.qty)
      })),
      order_total: money(order.total),
      order_discount: discount ? money(discount) : '',
      order_promo: order.promoCode || '',
      order_comment: c.comment || '',
      order_confirm: R.confirmLine ? R.confirmLine(c) : '',
      order_source: order.source || 'Сайт',
      order_delivery: R.addressLine ? R.addressLine(c) : [c.carrier, c.city, c.branch].filter(Boolean).join(', ')
    };
  }

  function workerOrderBody(params, silent) {
    return {
      type: 'order',
      silent: !!silent,
      to: params.to_email,
      name: params.to_name,
      phone: params.to_phone,
      orderNum: params.order_num,
      items: params.items_list || [],
      total: params.order_total,
      discount: params.order_discount,
      promoCode: params.order_promo,
      delivery: params.order_delivery,
      comment: params.order_comment,
      confirm: params.order_confirm,
      source: params.order_source,
      lang: R.lang ? R.lang() : 'uk'
    };
  }

  /* Старий воркер (до переносу Telegram) відповідав {ok, id} —
     це стосувалось лише листа */
  function splitWorkerResult(res) {
    return {
      email: res.email || { ok: !!res.ok, error: res.error || '' },
      telegram: res.telegram || { ok: false, sent: 0, total: 0, error: 'воркер не вміє надсилати в Telegram — оновіть його код' }
    };
  }

  /* Той самий вигляд повідомлення, що й у воркері — на випадок,
     коли доводиться надсилати напряму з браузера */
  function directText(params) {
    const L = ['🛍 НОВЕ ЗАМОВЛЕННЯ №' + params.order_num];
    if (params.order_source) L.push('Звідки: ' + params.order_source);
    L.push('');

    if (params.to_name) L.push('👤 ' + params.to_name);
    if (params.to_phone) L.push('📞 ' + params.to_phone);
    if (params.to_email) L.push('✉️ ' + params.to_email);
    if (params.order_delivery) L.push('📦 ' + params.order_delivery);
    if (params.order_confirm) L.push('☎️ Підтвердити: ' + params.order_confirm);

    L.push('', params.order_items, '');
    if (params.order_discount) {
      L.push('Знижка' + (params.order_promo ? ' (' + params.order_promo + ')' : '') +
        ': −' + params.order_discount);
    }
    L.push('💰 Разом: ' + params.order_total);
    if (params.order_comment) L.push('', '💬 ' + params.order_comment);

    return L.join('\n');
  }

  /* ---------- Замовлення: обидва канали ---------- */

  /* silent — замовлення, яке адмін завів вручну: він і так про
     нього знає, тож у Telegram не шумимо, лише лист покупцю */
  async function sendOrder(settings, params, silent) {
    const out = {
      email: { ok: false, description: params.to_email ? '' : 'Покупець не вказав email' },
      telegram: { ok: false, skipped: !!silent, description: '' }
    };

    if (settings && settings.workerUrl) {
      const res = splitWorkerResult(await callWorker(settings, workerOrderBody(params, silent)));

      out.email = { ok: !!res.email.ok, via: res.email.ok ? 'worker' : '', description: res.email.error || '' };
      out.telegram = {
        ok: !!res.telegram.ok, via: res.telegram.ok ? 'worker' : '',
        sent: res.telegram.sent || 0, total: res.telegram.total || 0,
        description: res.telegram.error || ''
      };
    }

    // Резерв: лист простим текстом
    if (!out.email.ok && params.to_email && settings && settings.fsEmail) {
      const fs = await sendFormSubmit(settings, params);
      out.email = Object.assign({ workerError: out.email.description }, fs);
    }

    // Резерв: Telegram напряму, поки токен ще в базі
    if (!silent && !out.telegram.ok && settings && settings.tgToken) {
      const tg = await sendTelegramDirect(settings, directText(params));
      out.telegram = Object.assign({ via: tg.ok ? 'direct' : '', workerError: out.telegram.description }, tg);
    }

    return out;
  }

  /* ---------- Лист із персональним промокодом ---------- */

  async function sendPromoLetter(settings, data) {
    if (!settings || !settings.workerUrl) {
      return { ok: false, description: 'Не налаштовано Worker для листів (Налаштування → Фірмовий лист)' };
    }
    const res = await callWorker(settings, Object.assign({ type: 'promo', lang: 'uk' }, data));
    return res.ok ? { ok: true } : { ok: false, description: res.error || 'воркер не надіслав лист' };
  }

  /* ---------- Публічний API ---------- */

  R.notify = {
    load: loadSettings,
    loadAdmin: loadAdminSettings,
    sendPromoLetter: (data) => loadSettings(true).then((s) => sendPromoLetter(s, data)),

    /* Лист «знову в наявності» для підписки зі сторінки товару */
    stockAlert: async (data) => {
      const settings = await loadSettings(true);
      if (!settings || !settings.workerUrl) return false;
      const res = await callWorker(settings, Object.assign({ type: 'stock' }, data));
      return !!res.ok;
    },

    /* Стан воркера: чи задані ключі Resend і Telegram */
    async workerStatus(settings) {
      const res = await callWorker(settings, { type: 'status', key: R.workerKey() });
      return res.ok ? res : { ok: false, description: res.error || 'воркер не відповів' };
    },

    /* Хто писав боту — щоб вписати Chat ID у змінну TG_CHAT.
       Поки токен ще в базі, працює й без оновленого воркера. */
    async detectChats(settings) {
      const res = await callWorker(settings, { type: 'tg-detect', key: R.workerKey() });
      if (res.ok) return res;
      if (settings && settings.tgToken) {
        const direct = await detectChatsDirect(settings.tgToken);
        if (direct.ok) return direct;
      }
      return { ok: false, description: res.error || 'не вдалося знайти чати' };
    },

    /* Викликається після оформлення замовлення; помилки не блокують покупку */
    async orderPlaced(order, opts) {
      const settings = await loadSettings();
      if (!settings) return null;
      return sendOrder(settings, buildParams(order), opts && opts.silent);
    },

    /* Тестові виклики для адмінки */
    async testTelegram(settings) {
      const res = await callWorker(settings, { type: 'tg-test', key: R.workerKey() });
      if (res.sent !== undefined) {
        return { ok: !!res.ok, via: 'worker', sent: res.sent, total: res.total, description: res.error || '' };
      }
      // воркер старий або не налаштований — пробуємо напряму
      const direct = await sendTelegramDirect(settings, '✅ Тест: Telegram-сповіщення REYTER налаштовано правильно!');
      return Object.assign({ via: 'direct', workerError: res.error || '' }, direct);
    },

    async testEmail(settings, toEmail) {
      const params = {
        to_email: toEmail,
        to_name: 'Тест',
        to_phone: '+380000000000',
        order_num: 'R-TEST-000',
        order_items: '• Бріфи classic (M) × 1 — 550 грн',
        items_list: [{ name: 'Бріфи classic', size: 'M', qty: 1, sum: '550 грн' }],
        order_total: '550 грн',
        order_discount: '',
        order_promo: '',
        order_comment: 'Це тестове замовлення — реагувати не потрібно',
        order_confirm: 'Telegram · +380000000000 · @test',
        order_source: 'Тест',
        order_delivery: 'Нова Пошта, Київ, Відділення №12'
      };

      if (settings && settings.workerUrl) {
        const res = splitWorkerResult(await callWorker(settings, workerOrderBody(params, true)));
        if (res.email.ok) return { ok: true, via: 'worker' };
        if (!settings.fsEmail) return { ok: false, description: res.email.error || 'воркер не надіслав лист' };
        const fs = await sendFormSubmit(settings, params);
        return Object.assign({ workerError: res.email.error }, fs);
      }
      return sendFormSubmit(settings, params);
    },

    clearCache() {
      cached = null;
    }
  };
})();
