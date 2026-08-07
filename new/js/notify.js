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

  /* ---------- Брендований HTML-лист (Brevo) ----------
     Красивий лист із логотипом на синьому тлі. Використовується,
     якщо в налаштуваннях заповнено ключ Brevo; інакше працює
     простий текстовий лист через FormSubmit. */

  const LOGO = 'https://reyter.men/assets/images/Logo1.png';
  const BLUE = '#014AAD';
  const INK = '#062B5C';

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function letterHTML(params) {
    const en = R.lang && R.lang() === 'en';

    const T = en ? {
      hi: 'Hello',
      got: 'We have received your order — thank you 💙',
      items: 'Your order', total: 'Total', delivery: 'Delivery',
      next: 'Our manager will contact you shortly to confirm the order. You can track its status in your account.',
      track: 'Track my order', slogan: 'Character is REYTER!',
      site: 'reyter.men', ig: 'Instagram'
    } : {
      hi: 'Вітаємо',
      got: 'Ми отримали ваше замовлення — дякуємо 💙',
      items: 'Ваше замовлення', total: 'Разом', delivery: 'Доставка',
      next: 'Найближчим часом менеджер звʼяжеться з вами для підтвердження. Статус замовлення можна відстежувати у своєму кабінеті.',
      track: 'Відстежити замовлення', slogan: 'Характер — це REYTER!',
      site: 'reyter.men', ig: 'Instagram'
    };

    const siteUrl = 'https://reyter.men/new/' + (en ? '?lang=en' : '');

    const rows = (params.items_list || [])
      .map((i) =>
        '<tr>' +
          '<td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#171b26">' +
            escHtml(i.name) + (i.size ? ' <span style="color:#6e6a5e">· ' + escHtml(i.size) + '</span>' : '') +
            '<br><span style="color:#6e6a5e;font-size:12px">× ' + i.qty + '</span>' +
          '</td>' +
          '<td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;font-weight:700;text-align:right;white-space:nowrap;color:#171b26">' +
            escHtml(i.sum) +
          '</td>' +
        '</tr>'
      ).join('');

    return (
      '<div style="margin:0;padding:24px 12px;background:#fcf8f0;font-family:Helvetica,Arial,sans-serif">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden">' +

          /* шапка з логотипом */
          '<tr><td style="background:' + BLUE + ';padding:30px 24px;text-align:center">' +
            '<img src="' + LOGO + '" alt="REYTER" width="190" style="display:block;margin:0 auto;max-width:190px;height:auto">' +
          '</td></tr>' +

          /* вітання */
          '<tr><td style="padding:30px 26px 8px">' +
            '<p style="margin:0 0 6px;font-size:16px;color:#171b26">' +
              T.hi + (params.to_name ? ', <strong>' + escHtml(params.to_name) + '</strong>' : '') + '!' +
            '</p>' +
            '<p style="margin:0 0 18px;font-size:15px;color:#6e6a5e">' + T.got + '</p>' +
            '<div style="display:inline-block;background:rgba(1,74,173,.08);border:1px solid rgba(1,74,173,.2);' +
              'border-radius:999px;padding:8px 16px;font-size:15px;font-weight:700;color:' + BLUE + '">' +
              '№ ' + escHtml(params.order_num) +
            '</div>' +
          '</td></tr>' +

          /* позиції */
          '<tr><td style="padding:18px 26px 0">' +
            '<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;' +
              'text-transform:uppercase;color:#6e6a5e">' + T.items + '</p>' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + rows + '</table>' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' +
              '<tr>' +
                '<td style="padding:14px 0 0;font-size:16px;font-weight:800;color:' + INK + '">' + T.total + '</td>' +
                '<td style="padding:14px 0 0;font-size:18px;font-weight:800;text-align:right;color:' + INK + '">' +
                  escHtml(params.order_total) +
                '</td>' +
              '</tr>' +
            '</table>' +
          '</td></tr>' +

          /* доставка */
          (params.order_delivery
            ? '<tr><td style="padding:18px 26px 0">' +
                '<div style="background:#fcf8f0;border-radius:12px;padding:14px 16px;font-size:14px;color:#171b26">' +
                  '<strong>' + T.delivery + ':</strong> ' + escHtml(params.order_delivery) +
                '</div>' +
              '</td></tr>'
            : '') +

          /* що далі + кнопка */
          '<tr><td style="padding:20px 26px 6px">' +
            '<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#6e6a5e">' + T.next + '</p>' +
            '<a href="' + siteUrl + '" style="display:inline-block;background:' + BLUE + ';color:#ffffff;' +
              'text-decoration:none;font-size:15px;font-weight:700;padding:13px 26px;border-radius:999px">' +
              T.track +
            '</a>' +
          '</td></tr>' +

          /* підвал */
          '<tr><td style="padding:26px 24px;background:' + INK + ';text-align:center">' +
            '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#ffffff">' + T.slogan + '</p>' +
            '<p style="margin:0;font-size:12px;color:rgba(255,255,255,.7)">' +
              '<a href="' + siteUrl + '" style="color:#ffffff;text-decoration:none">' + T.site + '</a>' +
              ' &nbsp;·&nbsp; ' +
              '<a href="https://www.instagram.com/reyter.ua/" style="color:#ffffff;text-decoration:none">' + T.ig + '</a>' +
            '</p>' +
          '</td></tr>' +

        '</table>' +
      '</div>'
    );
  }

  async function sendBrevo(settings, params) {
    if (!settings.bvKey || !settings.bvSender) {
      return { ok: false, description: 'Не заповнено ключ або адресу відправника Brevo' };
    }
    try {
      const body = {
        sender: { email: settings.bvSender, name: settings.bvSenderName || 'REYTER' },
        to: [{ email: params.to_email, name: params.to_name || '' }],
        subject: (R.lang && R.lang() === 'en' ? 'Order No. ' : 'Замовлення №') + params.order_num + ' — REYTER',
        htmlContent: letterHTML(params)
      };
      if (settings.fsEmail) body.bcc = [{ email: settings.fsEmail }];

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': settings.bvKey,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (res.ok) return { ok: true };
      const err = await res.json().catch(() => ({}));
      return { ok: false, description: (err.message || 'Brevo відхилив запит (код ' + res.status + ')') };
    } catch (e) {
      return { ok: false, description: 'Немає звʼязку з Brevo' };
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
      '\nМенеджер звʼяжеться з вами для підтвердження. ' +
      'Статус замовлення можна відстежувати у своєму кабінеті на https://reyter.men/new/\n\n' +
      '— Команда REYTER. Характер — це REYTER!'
    );
  }

  async function sendEmail(settings, params) {
    if (!params.to_email) {
      return { ok: false, description: 'Покупець не вказав email' };
    }

    // Brevo — красивий лист із логотипом; FormSubmit — резерв
    if (settings && settings.bvKey && settings.bvSender) {
      const res = await sendBrevo(settings, params);
      if (res.ok) return res;
      if (!settings.fsEmail) return res;
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

  /* ---------- Публічний API ---------- */

  R.notify = {
    load: loadSettings,
    detectChats: detectChats,

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

    /* Для попереднього перегляду листа */
    previewLetter: letterHTML,

    clearCache() {
      cached = null;
    }
  };
})();
