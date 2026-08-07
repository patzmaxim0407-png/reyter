/* ============================================================
   REYTER — notify.js
   Сповіщення про нове замовлення:
   • Telegram-повідомлення власнику (Bot API)
   • Email-підтвердження покупцю з номером замовлення (EmailJS)
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
    if (!settings || !settings.tgToken || !settings.tgChatId) return false;
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
      const data = await res.json();
      return !!data.ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Email покупцю (EmailJS) ---------- */

  async function sendEmail(settings, params) {
    if (!settings || !settings.ejService || !settings.ejTemplate || !settings.ejPublicKey) return false;
    if (!params.to_email) return false;
    try {
      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: settings.ejService,
          template_id: settings.ejTemplate,
          user_id: settings.ejPublicKey,
          template_params: params
        })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Публічний API ---------- */

  R.notify = {
    load: loadSettings,

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
          to_name: c.name || 'покупцю',
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
