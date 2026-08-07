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

  /* ---------- Telegram власнику ---------- */

  async function sendTelegram(settings, text) {
    if (!settings || !settings.tgToken || !settings.tgChatId) {
      return { ok: false, description: 'Не заповнено токен або Chat ID' };
    }
    try {
      const res = await fetch('https://api.telegram.org/bot' + settings.tgToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.tgChatId,
          text: text,
          disable_web_page_preview: true
        })
      });
      const data = await res.json().catch(() => ({}));
      return { ok: !!data.ok, description: data.description || '' };
    } catch (e) {
      return { ok: false, description: 'Немає звʼязку з Telegram' };
    }
  }

  /* Визначає Chat ID з останнього повідомлення, надісланого боту */
  async function detectChatId(token) {
    if (!token) return { ok: false, description: 'Спершу вставте токен бота' };
    try {
      const res = await fetch('https://api.telegram.org/bot' + token + '/getUpdates');
      const data = await res.json().catch(() => ({}));
      if (!data.ok) return { ok: false, description: data.description || 'Невірний токен' };
      const updates = data.result || [];
      for (let i = updates.length - 1; i >= 0; i--) {
        const msg = updates[i].message || updates[i].edited_message;
        if (msg && msg.chat && msg.chat.id) {
          return { ok: true, chatId: String(msg.chat.id), name: msg.chat.first_name || msg.chat.title || '' };
        }
      }
      return { ok: false, description: 'Повідомлень не знайдено. Напишіть будь-що своєму боту і спробуйте ще раз' };
    } catch (e) {
      return { ok: false, description: 'Немає звʼязку з Telegram' };
    }
  }

  /* ---------- Email через FormSubmit ----------
     Лист покупцю надсилається як автовідповідь (_autoresponse),
     а на пошту магазину приходить копія замовлення. */

  function customerLetter(params) {
    return (
      'Вітаємо' + (params.to_name ? ', ' + params.to_name : '') + '!\n\n' +
      'Ми отримали ваше замовлення №' + params.order_num + ' на reyter.men — дякуємо 💙\n\n' +
      params.order_items + '\n\n' +
      'Разом: ' + params.order_total + '\n' +
      (params.order_delivery ? 'Доставка: ' + params.order_delivery + '\n' : '') +
      '\nМенеджер звʼяжеться з вами для підтвердження. ' +
      'Статус замовлення можна відстежувати у своєму кабінеті на https://reyter.men/new/\n\n' +
      '— Команда REYTER. Характер — це REYTER!'
    );
  }

  async function sendEmail(settings, params) {
    if (!settings || !settings.fsEmail) {
      return { ok: false, description: 'Не заповнено email магазину' };
    }
    if (!params.to_email) {
      return { ok: false, description: 'Покупець не вказав email' };
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
      return { ok: ok, description: ok ? '' : (data.message || 'FormSubmit відхилив запит') };
    } catch (e) {
      return { ok: false, description: 'Немає звʼязку з FormSubmit' };
    }
  }

  /* ---------- Публічний API ---------- */

  R.notify = {
    load: loadSettings,
    detectChatId: detectChatId,

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
        const itemsText = (order.items || [])
          .map((i) => '• ' + i.name + (i.size ? ' (' + i.size + ')' : '') + ' × ' + i.qty + ' — ' + R.fmt(i.price * i.qty) + ' грн')
          .join('\n');
        sendEmail(settings, {
          to_email: c.email,
          to_name: c.name || '',
          order_num: order.num,
          order_items: itemsText,
          order_total: R.fmt(order.total) + ' грн',
          order_delivery: [c.carrier, c.city, c.branch].filter(Boolean).join(', ')
        });
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
        order_items: '• Тестовий товар × 1 — 0 грн',
        order_total: '0 грн',
        order_delivery: 'Тестова доставка'
      });
    },

    clearCache() {
      cached = null;
    }
  };
})();
