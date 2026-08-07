/* ============================================================
   REYTER — Cloudflare Worker для листів клієнтам (Resend)
   ------------------------------------------------------------
   Навіщо: Resend не приймає запити напряму з браузера (немає
   CORS), а ключ у коді сайту міг би прочитати будь-хто. Цей
   воркер тримає ключ у себе і сам збирає лист із даних
   замовлення — тому надіслати через нього щось стороннє
   неможливо.

   Як розгорнути — див. README.md у цій же папці.
   Змінні оточення (Settings → Variables):
     RESEND_KEY  — ключ Resend (Secret)
     MAIL_FROM   — відправник, напр. REYTER <orders@reyter.men>
     MAIL_BCC    — (необовʼязково) пошта магазину для копії
     ALLOW_ORIGIN— (необовʼязково) домен сайту, за замовчуванням
                   https://reyter.men
   ============================================================ */

const BLUE = '#014AAD';
const INK = '#062B5C';
const LOGO = 'https://reyter.men/assets/images/Logo1.png';

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
    track: 'Track my order', slogan: 'Character is REYTER!'
  } : {
    hi: 'Вітаємо',
    got: 'Ми отримали ваше замовлення — дякуємо 💙',
    items: 'Ваше замовлення', total: 'Разом', delivery: 'Доставка',
    next: 'Найближчим часом менеджер звʼяжеться з вами для підтвердження. Статус замовлення можна відстежувати у своєму кабінеті.',
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

        (d.delivery
          ? '<tr><td style="padding:18px 26px 0">' +
              '<div style="background:#fcf8f0;border-radius:12px;padding:14px 16px;font-size:14px;color:#171b26">' +
                '<strong>' + T.delivery + ':</strong> ' + esc(clip(d.delivery, 200)) +
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
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
        status: 405, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    let d;
    try {
      d = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: 'Bad JSON' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const to = String(d.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return new Response(JSON.stringify({ ok: false, error: 'Некоректний email отримувача' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    if (!Array.isArray(d.items) || !d.items.length) {
      return new Response(JSON.stringify({ ok: false, error: 'Порожнє замовлення' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    const subject = (d.lang === 'en' ? 'Order No. ' : 'Замовлення №') +
      clip(d.orderNum, 40) + ' — REYTER';

    const payload = {
      from: env.MAIL_FROM || 'REYTER <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: letterHTML(d)
    };
    if (env.MAIL_BCC) payload.bcc = [env.MAIL_BCC];

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    return new Response(
      JSON.stringify(res.ok ? { ok: true, id: data.id } : { ok: false, error: data.message || 'Resend error' }),
      { status: res.ok ? 200 : 502, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
};
