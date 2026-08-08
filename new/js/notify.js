/* ============================================================
   REYTER — notify.js
   Сповіщення про нове замовлення:
   • Telegram-повідомлення власнику (Bot API)
   • Email-підтвердження покупцю з номером замовлення
     (FormSubmit — безкоштовно, без лімітів; лист-копія
     замовлення також приходить на пошту магазину)
   Налаштування зберігаються у Firestore: settings/notify —
   заповнюються в адмінці, розділ «Налаштування».
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;

  let cached = null;

  async function loadSettings(force) {
    if (cached && !force) return cached;
    if (!R.fb || !R.fb.enabled) return null;
    try {
      const snap = await R.fb.db.collection('settings').doc('notify').get();
      cached = snap.exists ? snap.data() : {};
      return cached;
    } catch (e) {
      return null;
    }
  }

  /* ---------- Telegram ----------
     Отримувачів може бути кілька: особисті чати менеджерів
     або спільна група — Chat ID перелічуються через кому. */

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

  async function sendTelegram(settings, text) {
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

  /* Знаходить усі чати, які писали боту (особисті та групи) */
  async function detectChats(token) {
    if (!token) return { ok: false, description: 'Спершу вставте токен бота' };
    try {
      const res = await fetch('https://api.telegram.org/bot' + token + '/getUpdates');
      const data = await res.json().catch(() => ({}));
      if (!data.ok) return { ok: false, description: data.description || 'Невірний токен' };

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
          description: 'Повідомлень не знайдено. Напишіть боту будь-що (або додайте його в групу і напишіть там) і спробуйте ще раз'
        };
      }
      return { ok: true, chats: chats };
    } catch (e) {
      return { ok: false, description: 'Немає звʼязку з Telegram' };
    }
  }

  /* ---------- Фірмовий лист через Cloudflare Worker + Resend ----------
     Воркер тримає ключ Resend у себе і сам збирає лист із даних
     замовлення. Налаштування — поле «Адреса Worker» в адмінці.
     Розгортання описане у new/worker/README.md */

  /* Адреса могла бути збережена без https:// — інакше браузер
     вважатиме її відносним шляхом на самому сайті */
  R.normalizeUrl = function (u) {
    const s = String(u || '').trim().replace(/\/+$/, '');
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : 'https://' + s;
  };

  async function sendViaWorker(settings, params) {
    try {
      const res = await fetch(R.normalizeUrl(settings.workerUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: params.to_email,
          name: params.to_name || '',
          orderNum: params.order_num,
          items: params.items_list || [],
          total: params.order_total,
          delivery: params.order_delivery || '',
          lang: R.lang ? R.lang() : 'uk'
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) return { ok: true, via: 'worker' };
      return { ok: false, description: data.error || 'воркер відповів кодом ' + res.status };
    } catch (e) {
      return { ok: false, description: 'не вдалося звʼязатися з воркером — перевірте адресу' };
    }
  }

  /* ---------- Email через FormSubmit ----------
     Простий текстовий лист покупцю (автовідповідь) і копія
     замовлення на пошту магазину. Резервний варіант. */

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

  async function sendEmail(settings, params) {
    if (!params.to_email) {
      return { ok: false, description: 'Покупець не вказав email' };
    }

    // Фірмовий лист через воркер; FormSubmit — резерв
    let workerError = '';
    if (settings && settings.workerUrl) {
      const res = await sendViaWorker(settings, params);
      if (res.ok || !settings.fsEmail) return res;
      workerError = res.description;
    }

    if (!settings || !settings.fsEmail) {
      return { ok: false, description: 'Не налаштовано жодного відправника листів' };
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
        workerError: workerError,
        needsActivation: /activat/i.test(msg),
        description: ok ? '' : (msg || 'FormSubmit відхилив запит')
      };
    } catch (e) {
      return { ok: false, description: 'Немає звʼязку з FormSubmit' };
    }
  }

  /* Дані замовлення → параметри листа (для обох відправників) */
  function buildParams(order) {
    const c = order.customer || {};
    const money = (n) => (R.uah ? R.uah(n) : R.fmt(n) + ' грн');

    return {
      to_email: c.email,
      to_name: c.name || '',
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
      order_delivery: [c.carrier, c.city, c.branch].filter(Boolean).join(', ')
    };
  }

  /* ---------- Лист із персональним промокодом ---------- */

  async function sendPromoLetter(settings, data) {
    if (!settings || !settings.workerUrl) {
      return { ok: false, description: 'Не налаштовано Worker для листів (Налаштування → Фірмовий лист)' };
    }
    try {
      const res = await fetch(R.normalizeUrl(settings.workerUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ type: 'promo', lang: 'uk' }, data))
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) return { ok: true };
      return { ok: false, description: out.error || 'воркер відповів кодом ' + res.status };
    } catch (e) {
      return { ok: false, description: 'не вдалося звʼязатися з воркером' };
    }
  }

  /* ---------- Публічний API ---------- */

  R.notify = {
    load: loadSettings,
    detectChats: detectChats,
    sendPromoLetter: (data) => loadSettings().then((s) => sendPromoLetter(s, data)),

    /* Викликається після оформлення замовлення; помилки не блокують покупку */
    async orderPlaced(order) {
      const settings = await loadSettings();
      if (!settings) return;

      const c = order.customer || {};

      sendTelegram(
        settings,
        '🛍 НОВЕ ЗАМОВЛЕННЯ №' + order.num + '\n\n' + order.message
      );

      if (c.email) {
        sendEmail(settings, buildParams(order));
      }
    },

    /* Тестові виклики для адмінки */
    async testTelegram(settings) {
      return sendTelegram(settings, '✅ Тест: Telegram-сповіщення REYTER налаштовано правильно!');
    },

    async testEmail(settings, toEmail) {
      return sendEmail(settings, {
        to_email: toEmail,
        to_name: 'Тест',
        order_num: 'R-TEST-000',
        order_items: '• Бріфи classic (M) × 1 — 550 грн',
        items_list: [{ name: 'Бріфи classic', size: 'M', qty: 1, sum: '550 грн' }],
        order_total: '550 грн',
        order_delivery: 'Нова Пошта, Київ, Відділення №12'
      });
    },

    clearCache() {
      cached = null;
    }
  };
})();
