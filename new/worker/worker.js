/* ============================================================
   REYTER — Cloudflare Worker: листи покупцям (Resend)
   та сповіщення магазину (Telegram)
   ------------------------------------------------------------
   Навіщо: Resend не приймає запити напряму з браузера (немає
   CORS), а ключ Resend і токен Telegram-бота в коді сайту міг
   би прочитати будь-хто. Воркер тримає їх у себе і сам збирає
   і лист, і повідомлення з даних замовлення — тому надіслати
   через нього щось стороннє неможливо.

   Як розгорнути — див. README.md у цій же папці.
   Змінні оточення (Settings → Variables and Secrets):
     RESEND_KEY  — ключ Resend (Secret)
     MAIL_FROM   — відправник, напр. REYTER <orders@reyter.men>
     MAIL_BCC    — (необовʼязково) пошта магазину для копії
     TG_TOKEN    — токен Telegram-бота від @BotFather (Secret)
     TG_CHAT     — Chat ID отримувачів, кілька — через кому
     ADMIN_KEY   — (необовʼязково) пароль для службових запитів
                   з адмінки: перевірка стану, пошук чатів, тест
     ALLOW_ORIGIN— (необовʼязково) домен сайту, за замовчуванням
                   https://reyter.men
   ============================================================ */

const BLUE = '#014AAD';
const INK = '#062B5C';
const LOGO = 'https://reyter.men/assets/images/Logo1.png';
const TG_LIMIT = 3900; // Telegram обриває повідомлення на 4096

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Обрізаємо все, що приходить ззовні, щоб лист не роздували */
function clip(s, max) {
  return String(s == null ? '' : s).slice(0, max);
}

function letterHTML(d) {
  const en = d.lang === 'en';

  const T = en ? {
    hi: 'Hello',
    got: 'We have received your order — thank you 💙',
    items: 'Your order', total: 'Total', delivery: 'Delivery',
    next: 'Our manager will contact you shortly to confirm the order. You can track its status in your account.',
    confirm: 'We will contact you via',
    track: 'Track my order', slogan: 'Character is REYTER!'
  } : {
    hi: 'Вітаємо',
    got: 'Ми отримали ваше замовлення — дякуємо 💙',
    items: 'Ваше замовлення', total: 'Разом', delivery: 'Доставка',
    next: 'Найближчим часом менеджер звʼяжеться з вами для підтвердження. Статус замовлення можна відстежувати у своєму кабінеті.',
    confirm: 'Звʼяжемось із вами через',
    track: 'Відстежити замовлення', slogan: 'Характер — це REYTER!'
  };

  const siteUrl = 'https://reyter.men/new/' + (en ? '?lang=en' : '');

  const rows = (d.items || []).slice(0, 50).map((i) =>
    '<tr>' +
      '<td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#171b26">' +
        esc(clip(i.name, 120)) +
        (i.size ? ' <span style="color:#6e6a5e">· ' + esc(clip(i.size, 20)) + '</span>' : '') +
        '<br><span style="color:#6e6a5e;font-size:12px">× ' + (Number(i.qty) || 1) + '</span>' +
      '</td>' +
      '<td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;font-weight:700;' +
        'text-align:right;white-space:nowrap;color:#171b26">' + esc(clip(i.sum, 40)) + '</td>' +
    '</tr>'
  ).join('');

  return (
    '<div style="margin:0;padding:24px 12px;background:#fcf8f0;font-family:Helvetica,Arial,sans-serif">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
        'style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden">' +

        '<tr><td style="background:' + BLUE + ';padding:30px 24px;text-align:center">' +
          '<img src="' + LOGO + '" alt="REYTER" width="190" ' +
            'style="display:block;margin:0 auto;max-width:190px;height:auto">' +
        '</td></tr>' +

        '<tr><td style="padding:30px 26px 8px">' +
          '<p style="margin:0 0 6px;font-size:16px;color:#171b26">' +
            T.hi + (d.name ? ', <strong>' + esc(clip(d.name, 80)) + '</strong>' : '') + '!' +
          '</p>' +
          '<p style="margin:0 0 18px;font-size:15px;color:#6e6a5e">' + T.got + '</p>' +
          '<div style="display:inline-block;background:rgba(1,74,173,.08);' +
            'border:1px solid rgba(1,74,173,.2);border-radius:999px;padding:8px 16px;' +
            'font-size:15px;font-weight:700;color:' + BLUE + '">№ ' + esc(clip(d.orderNum, 40)) + '</div>' +
        '</td></tr>' +

        '<tr><td style="padding:18px 26px 0">' +
          '<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;' +
            'text-transform:uppercase;color:#6e6a5e">' + T.items + '</p>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + rows + '</table>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
            '<td style="padding:14px 0 0;font-size:16px;font-weight:800;color:' + INK + '">' + T.total + '</td>' +
            '<td style="padding:14px 0 0;font-size:18px;font-weight:800;text-align:right;color:' + INK + '">' +
              esc(clip(d.total, 40)) + '</td>' +
          '</tr></table>' +
        '</td></tr>' +

        (d.delivery || d.confirm
          ? '<tr><td style="padding:18px 26px 0">' +
              '<div style="background:#fcf8f0;border-radius:12px;padding:14px 16px;font-size:14px;color:#171b26">' +
                (d.delivery
                  ? '<strong>' + T.delivery + ':</strong> ' + esc(clip(d.delivery, 200))
                  : '') +
                (d.confirm
                  ? (d.delivery ? '<br>' : '') +
                    '<strong>' + T.confirm + ':</strong> ' + esc(clip(d.confirm, 120))
                  : '') +
              '</div></td></tr>'
          : '') +

        '<tr><td style="padding:20px 26px 6px">' +
          '<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#6e6a5e">' + T.next + '</p>' +
          '<a href="' + siteUrl + '" style="display:inline-block;background:' + BLUE + ';color:#ffffff;' +
            'text-decoration:none;font-size:15px;font-weight:700;padding:13px 26px;border-radius:999px">' +
            T.track + '</a>' +
        '</td></tr>' +

        '<tr><td style="padding:26px 24px;background:' + INK + ';text-align:center">' +
          '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#ffffff">' + T.slogan + '</p>' +
          '<p style="margin:0;font-size:12px">' +
            '<a href="' + siteUrl + '" style="color:#ffffff;text-decoration:none">reyter.men</a>' +
            ' &nbsp;·&nbsp; ' +
            '<a href="https://www.instagram.com/reyter.ua/" style="color:#ffffff;text-decoration:none">Instagram</a>' +
          '</p>' +
        '</td></tr>' +

      '</table>' +
    '</div>'
  );
}

/* Лист із персональним промокодом */
function promoHTML(d) {
  const en = d.lang === 'en';
  const T = en ? {
    hi: 'Hello',
    lead: 'Here is your personal promo code 🎁',
    use: 'Enter it in the cart — the discount applies instantly.',
    terms: 'Terms', shop: 'Go shopping', slogan: 'Character is REYTER!'
  } : {
    hi: 'Вітаємо',
    lead: 'Ваш персональний промокод 🎁',
    use: 'Введіть його в кошику — знижка застосується одразу.',
    terms: 'Умови', shop: 'Перейти до покупок', slogan: 'Характер — це REYTER!'
  };

  const siteUrl = 'https://reyter.men/new/' + (en ? '?lang=en' : '');

  return (
    '<div style="margin:0;padding:24px 12px;background:#fcf8f0;font-family:Helvetica,Arial,sans-serif">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
        'style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden">' +

        '<tr><td style="background:' + BLUE + ';padding:30px 24px;text-align:center">' +
          '<img src="' + LOGO + '" alt="REYTER" width="190" ' +
            'style="display:block;margin:0 auto;max-width:190px;height:auto">' +
        '</td></tr>' +

        '<tr><td style="padding:30px 26px 6px;text-align:center">' +
          '<p style="margin:0 0 6px;font-size:16px;color:#171b26">' +
            T.hi + (d.name ? ', <strong>' + esc(clip(d.name, 80)) + '</strong>' : '') + '!</p>' +
          '<p style="margin:0 0 22px;font-size:15px;color:#6e6a5e">' + T.lead + '</p>' +

          '<div style="display:inline-block;border:2px dashed ' + BLUE + ';border-radius:14px;' +
            'padding:16px 28px;background:rgba(1,74,173,.05)">' +
            '<div style="font-size:26px;font-weight:800;letter-spacing:.14em;color:' + BLUE + '">' +
              esc(clip(d.code, 30)) + '</div>' +
            '<div style="font-size:15px;font-weight:700;color:#15803d;margin-top:6px">−' +
              esc(clip(d.value, 24)) + '</div>' +
          '</div>' +
          '<p style="margin:18px 0 0;font-size:14px;color:#6e6a5e">' + T.use + '</p>' +
        '</td></tr>' +

        (d.terms
          ? '<tr><td style="padding:18px 26px 0">' +
              '<div style="background:#fcf8f0;border-radius:12px;padding:14px 16px;font-size:13px;color:#171b26">' +
                '<strong>' + T.terms + ':</strong> ' + esc(clip(d.terms, 400)) +
              '</div></td></tr>'
          : '') +

        '<tr><td style="padding:22px 26px 8px;text-align:center">' +
          '<a href="' + siteUrl + '" style="display:inline-block;background:' + BLUE + ';color:#ffffff;' +
            'text-decoration:none;font-size:15px;font-weight:700;padding:13px 30px;border-radius:999px">' +
            T.shop + '</a>' +
        '</td></tr>' +

        '<tr><td style="padding:26px 24px;background:' + INK + ';text-align:center">' +
          '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#ffffff">' + T.slogan + '</p>' +
          '<p style="margin:0;font-size:12px">' +
            '<a href="' + siteUrl + '" style="color:#ffffff;text-decoration:none">reyter.men</a>' +
          '</p>' +
        '</td></tr>' +

      '</table>' +
    '</div>'
  );
}

/* ============================================================
   TELEGRAM
   Текст повідомлення воркер збирає сам із полів замовлення —
   довільний текст ззовні надіслати через нього не вийде.
   ============================================================ */

function tgChats(env) {
  return String(env.TG_CHAT || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function orderText(d) {
  const L = [];

  L.push('🛍 НОВЕ ЗАМОВЛЕННЯ №' + clip(d.orderNum, 40));
  if (d.source) L.push('Звідки: ' + clip(d.source, 40));
  L.push('');

  if (d.name) L.push('👤 ' + clip(d.name, 80));
  if (d.phone) L.push('📞 ' + clip(d.phone, 40));
  if (d.to) L.push('✉️ ' + clip(d.to, 120));
  if (d.delivery) L.push('📦 ' + clip(d.delivery, 200));
  if (d.confirm) L.push('☎️ Підтвердити: ' + clip(d.confirm, 120));

  L.push('');
  (d.items || []).slice(0, 50).forEach((i) => {
    L.push('• ' + clip(i.name, 120) +
      (i.size ? ' (' + clip(i.size, 20) + ')' : '') +
      ' × ' + (Number(i.qty) || 1) +
      ' — ' + clip(i.sum, 40));
  });

  L.push('');
  if (d.discount) {
    L.push('Знижка' + (d.promoCode ? ' (' + clip(d.promoCode, 30) + ')' : '') +
      ': −' + clip(d.discount, 30));
  }
  L.push('💰 Разом: ' + clip(d.total, 40));

  if (d.comment) L.push('', '💬 ' + clip(d.comment, 500));

  const text = L.join('\n');
  return text.length > TG_LIMIT ? text.slice(0, TG_LIMIT) + '\n…' : text;
}

async function tgSendOne(token, chatId, text) {
  try {
    const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, disable_web_page_preview: true })
    });
    const data = await res.json().catch(() => ({}));
    return { ok: !!data.ok, chatId: chatId, error: data.description || '' };
  } catch (e) {
    return { ok: false, chatId: chatId, error: 'немає звʼязку з Telegram' };
  }
}

async function tgSend(env, text) {
  const ids = tgChats(env);
  if (!env.TG_TOKEN || !ids.length) {
    return {
      ok: false, sent: 0, total: 0,
      error: 'у воркері не задано ' + (!env.TG_TOKEN ? 'TG_TOKEN' : 'TG_CHAT') +
        ' (Settings → Variables and Secrets → Add → потім Deploy)'
    };
  }

  const results = await Promise.all(ids.map((id) => tgSendOne(env.TG_TOKEN, id, text)));
  const failed = results.filter((r) => !r.ok);

  return {
    ok: failed.length < results.length, // хоч комусь дійшло
    sent: results.length - failed.length,
    total: results.length,
    error: failed.map((f) => f.chatId + ' — ' + f.error).join('; ')
  };
}

/* Хто писав боту — щоб адмін дізнався Chat ID для змінної TG_CHAT */
async function tgDetect(env) {
  if (!env.TG_TOKEN) {
    return { ok: false, error: 'у воркері не задано TG_TOKEN' };
  }
  try {
    const res = await fetch('https://api.telegram.org/bot' + env.TG_TOKEN + '/getUpdates');
    const data = await res.json().catch(() => ({}));
    if (!data.ok) return { ok: false, error: data.description || 'невірний токен бота' };

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
        error: 'повідомлень не знайдено. Напишіть боту будь-що (або додайте його в групу і напишіть там) і спробуйте ще раз'
      };
    }
    return { ok: true, chats: chats };
  } catch (e) {
    return { ok: false, error: 'немає звʼязку з Telegram' };
  }
}

/* ---------- Resend ---------- */

async function sendMail(env, to, subject, html, bcc) {
  if (!env.RESEND_KEY) {
    return {
      ok: false,
      error: 'у воркері не задано змінну RESEND_KEY (Settings → Variables and Secrets → Add → тип Secret → потім Deploy)'
    };
  }

  const payload = {
    from: env.MAIL_FROM || 'REYTER <onboarding@resend.dev>',
    to: [to],
    subject: subject,
    html: html
  };
  if (bcc) payload.bcc = [bcc];

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: true, id: data.id }
      : { ok: false, error: data.message || 'Resend відповів кодом ' + res.status };
  } catch (e) {
    return { ok: false, error: 'немає звʼязку з Resend' };
  }
}

/* ---------- Відповідь ---------- */

function reply(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  async fetch(request, env) {
    const allow = env.ALLOW_ORIGIN || 'https://reyter.men';
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': origin === allow ? origin : allow,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return reply({ ok: false, error: 'Method not allowed' }, 405, cors);
    }

    let d;
    try {
      d = await request.json();
    } catch (e) {
      return reply({ ok: false, error: 'Bad JSON' }, 400, cors);
    }

    const type = String(d.type || 'order');

    /* --- Службові запити з адмінки --- */

    if (type === 'status' || type === 'tg-detect' || type === 'tg-test') {
      // ADMIN_KEY необовʼязковий, але якщо заданий — без нього
      // ці запити недоступні навіть тому, хто знає адресу воркера
      if (env.ADMIN_KEY && d.key !== env.ADMIN_KEY) {
        return reply({ ok: false, error: 'Невірний ключ адміністратора (ADMIN_KEY)' }, 403, cors);
      }

      if (type === 'status') {
        return reply({
          ok: true,
          resend: !!env.RESEND_KEY,
          mailFrom: env.MAIL_FROM || '',
          bcc: env.MAIL_BCC || '',
          telegram: !!env.TG_TOKEN,
          chats: tgChats(env).length,
          adminKey: !!env.ADMIN_KEY
        }, 200, cors);
      }

      if (type === 'tg-detect') {
        const res = await tgDetect(env);
        return reply(res, res.ok ? 200 : 400, cors);
      }

      const res = await tgSend(env, '✅ Тест: сповіщення REYTER надходять сюди. Все налаштовано правильно!');
      return reply(res, res.ok ? 200 : 400, cors);
    }

    /* --- Лист із персональним промокодом --- */

    if (type === 'promo') {
      const to = String(d.to || '').trim();
      if (!EMAIL_RE.test(to)) {
        return reply({ ok: false, error: 'Некоректний email отримувача' }, 400, cors);
      }
      if (!d.code) {
        return reply({ ok: false, error: 'Не вказано промокод' }, 400, cors);
      }
      const subject = d.lang === 'en'
        ? 'Your personal promo code — REYTER'
        : 'Ваш персональний промокод — REYTER';
      const res = await sendMail(env, to, subject, promoHTML(d));
      return reply(res, res.ok ? 200 : 502, cors);
    }

    /* --- Замовлення: лист покупцю + сповіщення магазину --- */

    if (!(Array.isArray(d.items) && d.items.length)) {
      return reply({ ok: false, error: 'Порожнє замовлення' }, 400, cors);
    }

    const to = String(d.to || '').trim();
    const wantsMail = !!to;

    const [mail, tg] = await Promise.all([
      wantsMail
        ? (EMAIL_RE.test(to)
            ? sendMail(
                env, to,
                (d.lang === 'en' ? 'Order No. ' : 'Замовлення №') + clip(d.orderNum, 40) + ' — REYTER',
                letterHTML(d),
                env.MAIL_BCC
              )
            : Promise.resolve({ ok: false, error: 'Некоректний email отримувача' }))
        : Promise.resolve({ ok: false, skipped: true, error: 'Покупець не вказав email' }),
      // silent — перевірка листа з адмінки: у Telegram не шумимо
      d.silent === true
        ? Promise.resolve({ ok: false, sent: 0, total: 0, skipped: true, error: '' })
        : tgSend(env, orderText(d))
    ]);

    // ok = хоч один канал спрацював; сайт розбирає деталі й за
    // потреби вмикає резервні способи
    return reply({
      ok: mail.ok || tg.ok,
      email: mail,
      telegram: tg,
      id: mail.id
    }, 200, cors);
  }
};
