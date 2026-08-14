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
     MONO_TOKEN  — токен еквайрингу Monobank (Secret). Дає право
                   виставляти рахунки й повертати гроші, тож у
                   браузер не потрапляє ніколи
     ALLOW_ORIGIN— (необовʼязково) домени, з яких дозволені запити.
                   Кілька — через кому. За замовчуванням
                   https://reyter.men та https://admin.reyter.men
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
    goods: 'Items', discount: 'Discount', shippingCost: 'Shipping',
    next: 'Our manager will contact you shortly to confirm the order. You can track its status in your account.',
    confirm: 'We will contact you via',
    track: 'Track my order', slogan: 'Character is REYTER!'
  } : {
    hi: 'Вітаємо',
    got: 'Ми отримали ваше замовлення — дякуємо 💙',
    items: 'Ваше замовлення', total: 'Разом', delivery: 'Доставка',
    goods: 'Товари', discount: 'Знижка', shippingCost: 'Доставка',
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
        // категорія: у каталозі трапляються однакові назви
        (i.category
          ? '<br><span style="color:#6e6a5e;font-size:12px">' + esc(clip(i.category, 60)) + '</span>'
          : '') +
        // склад комплекту: що саме й у яких розмірах
        ((i.parts || []).length
          ? '<br><span style="color:#6e6a5e;font-size:12px">' +
              i.parts.slice(0, 10).map((x) => '· ' + esc(clip(x, 80))).join('<br>') +
            '</span>'
          : '') +
        '<br><span style="color:#6e6a5e;font-size:12px">× ' + (Number(i.qty) || 1) + '</span>' +
      '</td>' +
      '<td style="padding:10px 0;border-bottom:1px solid #eeeeee;font-size:14px;font-weight:700;' +
        'text-align:right;white-space:nowrap;color:#171b26">' + esc(clip(i.sum, 40)) + '</td>' +
    '</tr>'
  ).join('');

  /* Розклад суми. Показуємо лише коли є що пояснювати: без знижки
     й доставки рядок «Товари» просто дублював би «Разом». */
  const sumRow = (label, value) =>
    '<tr>' +
      '<td style="padding:7px 0 0;font-size:14px;color:#6e6a5e">' + label + '</td>' +
      '<td style="padding:7px 0 0;font-size:14px;text-align:right;white-space:nowrap;color:#6e6a5e">' +
        value + '</td>' +
    '</tr>';

  const hasBreakdown = !!(d.discount || d.shipping);

  const sums =
    (hasBreakdown
      ? sumRow(T.goods, esc(clip(d.subtotal || d.total, 40))) +
        (d.discount
          ? sumRow(
              T.discount +
                (d.promoCode ? ' · <strong>' + esc(clip(d.promoCode, 30)) + '</strong>' : ''),
              '−' + esc(clip(d.discount, 30)))
          : '') +
        (d.shipping ? sumRow(T.shippingCost, esc(clip(d.shipping, 30))) : '')
      : '') +
    '<tr>' +
      '<td style="padding:12px 0 0;' + (hasBreakdown ? 'border-top:1px solid #eeeeee;' : '') +
        'font-size:16px;font-weight:800;color:' + INK + '">' + T.total + '</td>' +
      '<td style="padding:12px 0 0;' + (hasBreakdown ? 'border-top:1px solid #eeeeee;' : '') +
        'font-size:18px;font-weight:800;text-align:right;white-space:nowrap;color:' + INK + '">' +
        esc(clip(d.total, 40)) + '</td>' +
    '</tr>';

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
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' +
            sums +
          '</table>' +
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


/* Лист «посилка вирушила»: номер накладної, посилання на
   відстеження в перевізника і в кабінеті магазину.

   Найдорожчий лист із усіх: саме його чекають найбільше, і саме
   він досі не надсилався взагалі — номер лишався в адмінці. */
function ttnHTML(d) {
  const en = d.lang === 'en';
  const T = en ? {
    hi: 'Hello',
    lead: 'Your parcel is on its way 📦',
    num: 'Tracking number',
    order: 'Order',
    trackNp: 'Track at the carrier',
    trackUs: 'Order status',
    note: 'The carrier updates the status within a few hours after handover.',
    slogan: 'Character is REYTER!'
  } : {
    hi: 'Вітаємо',
    lead: 'Ваша посилка вирушила 📦',
    num: 'Номер накладної',
    order: 'Замовлення',
    trackNp: 'Відстежити в перевізника',
    trackUs: 'Статус замовлення',
    note: 'Перевізник оновлює статус протягом кількох годин після передачі посилки.',
    slogan: 'Характер — це REYTER!'
  };

  const siteUrl = 'https://reyter.men/new/' + (en ? '?lang=en' : '');
  const ttn = clip(String(d.ttn || ''), 40);
  const carrierUrl = 'https://novaposhta.ua/tracking/?cargo_number=' + encodeURIComponent(ttn);
  const ourUrl = 'https://reyter.men/new/' + (en ? 'en/' : '') + 'track';

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
            '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6e6a5e">' +
              T.num + '</div>' +
            '<div style="font-size:24px;font-weight:800;letter-spacing:.06em;color:' + BLUE + '">' +
              esc(ttn) + '</div>' +
          '</div>' +

          (d.orderNum
            ? '<p style="margin:16px 0 0;font-size:14px;color:#6e6a5e">' +
                T.order + ' №' + esc(clip(String(d.orderNum), 40)) + '</p>'
            : '') +
          (d.delivery
            ? '<p style="margin:6px 0 0;font-size:14px;color:#6e6a5e">' +
                esc(clip(String(d.delivery), 200)) + '</p>'
            : '') +
        '</td></tr>' +

        '<tr><td style="padding:22px 26px 8px;text-align:center">' +
          '<a href="' + carrierUrl + '" style="display:inline-block;background:' + BLUE + ';color:#ffffff;' +
            'text-decoration:none;font-size:15px;font-weight:700;padding:13px 30px;border-radius:999px">' +
            T.trackNp + '</a>' +
          '<p style="margin:14px 0 0;font-size:13px">' +
            '<a href="' + ourUrl + '" style="color:' + BLUE + '">' + T.trackUs + '</a>' +
          '</p>' +
          '<p style="margin:14px 0 0;font-size:12px;color:#6e6a5e">' + T.note + '</p>' +
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

/* Лист «товар знову в наявності» для підписки
   «Повідомити, коли зʼявиться» */
function stockHTML(d) {
  const en = d.lang === 'en';
  const T = en ? {
    hi: 'Good news!',
    lead: 'The item you were waiting for is back in stock:',
    size: 'Size',
    cta: 'Buy now',
    note: 'Quantities are limited — popular sizes sell out fast.',
    slogan: 'Character is REYTER!'
  } : {
    hi: 'Гарні новини!',
    lead: 'Товар, на який ви чекали, знову в наявності:',
    size: 'Розмір',
    cta: 'Перейти до товару',
    note: 'Кількість обмежена — популярні розміри розбирають швидко.',
    slogan: 'Характер — це REYTER!'
  };

  const url = clip(d.url, 300) || 'https://reyter.men/new/';

  return (
    '<div style="margin:0;padding:24px 12px;background:#fcf8f0;font-family:Helvetica,Arial,sans-serif">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
        'style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden">' +

        '<tr><td style="background:' + BLUE + ';padding:30px 24px;text-align:center">' +
          '<img src="' + LOGO + '" alt="REYTER" width="190" ' +
            'style="display:block;margin:0 auto;max-width:190px;height:auto">' +
        '</td></tr>' +

        '<tr><td style="padding:30px 26px 8px;text-align:center">' +
          '<p style="margin:0 0 6px;font-size:18px;font-weight:800;color:#171b26">' + T.hi + '</p>' +
          '<p style="margin:0 0 18px;font-size:15px;color:#6e6a5e">' + T.lead + '</p>' +
          (d.image
            ? '<img src="' + esc(clip(d.image, 400)) + '" alt="" width="180" ' +
                'style="display:block;margin:0 auto 14px;border-radius:12px;max-width:180px;height:auto">'
            : '') +
          '<p style="margin:0;font-size:17px;font-weight:800;color:' + INK + '">' +
            esc(clip(d.product, 120)) + '</p>' +
          (d.size
            ? '<p style="margin:6px 0 0;font-size:14px;color:#6e6a5e">' + T.size + ': <b>' + esc(clip(d.size, 20)) + '</b></p>'
            : '') +
        '</td></tr>' +

        '<tr><td style="padding:22px 26px 8px;text-align:center">' +
          '<a href="' + esc(url) + '" style="display:inline-block;background:' + BLUE + ';color:#ffffff;' +
            'text-decoration:none;font-size:15px;font-weight:700;padding:13px 30px;border-radius:999px">' +
            T.cta + '</a>' +
          '<p style="margin:14px 0 0;font-size:12px;color:#6e6a5e">' + T.note + '</p>' +
        '</td></tr>' +

        '<tr><td style="padding:26px 24px;background:' + INK + ';text-align:center">' +
          '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#ffffff">' + T.slogan + '</p>' +
          '<p style="margin:0;font-size:12px">' +
            '<a href="https://reyter.men/new/" style="color:#ffffff;text-decoration:none">reyter.men</a>' +
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
      (i.category ? ' — ' + clip(i.category, 60) : '') +
      (i.size ? ' (' + clip(i.size, 20) + ')' : '') +
      ' × ' + (Number(i.qty) || 1) +
      ' — ' + clip(i.sum, 40));
    (i.parts || []).slice(0, 10).forEach((x) => L.push('    – ' + clip(x, 80)));
  });

  L.push('');
  if (d.discount || d.shipping) L.push('Товари: ' + clip(d.subtotal || d.total, 40));
  if (d.discount) {
    L.push('Знижка' + (d.promoCode ? ' (' + clip(d.promoCode, 30) + ')' : '') +
      ': −' + clip(d.discount, 30));
  }
  if (d.shipping) L.push('Доставка: ' + clip(d.shipping, 30));
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

async function sendMail(env, to, subject, html, bcc, files) {
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
  /* Вкладення — так Resend приймає готовий PDF: імʼя файла й
     його вміст у base64, рівно в такому вигляді, як його віддав
     банк. */
  if (Array.isArray(files) && files.length) payload.attachments = files;

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

/* ============================================================
   Оплата карткою: Monobank Еквайринг
   ------------------------------------------------------------
   Токен еквайрингу — це право виставляти рахунки й повертати
   гроші з рахунку магазину. У браузер він не потрапляє ніколи:
   сайт просить воркер, а токен лежить тут, поруч із рештою
   секретів (MONO_TOKEN).

   Головне правило: СУМУ РАХУНКУ РАХУЄ ВОРКЕР. Якби її передавав
   браузер, будь-хто міг би відкрити консоль і купити все за одну
   гривню. Тому воркер сам читає опублікований каталог, сам бере
   ціни, сам перевіряє промокод — а від сайту приймає лише перелік
   товарів і код.

   Стан оплати теж не зберігається ніде в нас: і адмінка, і
   сторінка подяки щоразу питають Monobank. Те, чого немає в
   нашій базі, неможливо ні підробити, ні розсинхронізувати.
   ============================================================ */

/* Лист із посиланням на оплату. Коротко й по суті: людина вже
   знає, що замовила, — їй потрібна кнопка й сума. */
function payHTML(d) {
  const en = d.lang === 'en';
  const T = en
    ? { hi: 'Hello', text: 'To complete your order, please pay by card:', pay: 'Pay', sum: 'Amount', note: 'The link is valid for 30 minutes. If it expires, ask us for a new one.' }
    : { hi: 'Вітаємо', text: 'Щоб завершити замовлення, оплатіть його карткою:', pay: 'Оплатити', sum: 'До сплати', note: 'Посилання дійсне 30 хвилин. Якщо не встигли — попросіть у нас нове.' };

  return `<!doctype html><html><body style="margin:0;background:#FCF8F0;font-family:Arial,Helvetica,sans-serif;color:#171B26">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
    <table width="100%" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden">
      <tr><td style="background:${BLUE};padding:22px;text-align:center">
        <img src="${LOGO}" alt="REYTER" width="150" style="display:block;margin:0 auto">
      </td></tr>
      <tr><td style="padding:24px">
        <p style="margin:0 0 10px;font-size:16px">${T.hi}, <b>${esc(clip(d.name, 60))}</b>!</p>
        <p style="margin:0 0 16px;color:#5b6270">${T.text}</p>
        <p style="margin:0 0 4px;color:#5b6270;font-size:13px">№ ${esc(clip(d.num, 40))}</p>
        <p style="margin:0 0 20px;font-size:20px"><b>${T.sum}: ${esc(String(d.total))} ${en ? 'UAH' : 'грн'}</b></p>
        <table cellpadding="0" cellspacing="0"><tr><td style="background:${BLUE};border-radius:999px">
          <a href="${esc(d.url)}" style="display:inline-block;padding:14px 34px;color:#fff;font-size:16px;font-weight:bold;text-decoration:none">${T.pay}</a>
        </td></tr></table>
        <p style="margin:18px 0 0;color:#8a8f99;font-size:12px">${T.note}</p>
      </td></tr>
      <tr><td style="background:${INK};padding:16px;text-align:center;color:#fff;font-size:12px">reyter.men</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/* Лист із чеком. Сам чек — вкладенням; у тілі листа лише те,
   заради чого його відкривають: за що і на скільки. */
function receiptHTML(d) {
  const en = d.lang === 'en';
  const T = en
    ? { hi: 'Hello', text: 'Your receipt for the order is attached.', tax: 'Check it at the tax service', num: 'Order' }
    : { hi: 'Вітаємо', text: 'Чек за вашим замовленням — у вкладенні.', tax: 'Перевірити в податковій', num: 'Замовлення' };

  return `<!doctype html><html><body style="margin:0;background:#FCF8F0;font-family:Arial,Helvetica,sans-serif;color:#171B26">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
    <table width="100%" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden">
      <tr><td style="background:${BLUE};padding:22px;text-align:center">
        <img src="${LOGO}" alt="REYTER" width="150" style="display:block;margin:0 auto">
      </td></tr>
      <tr><td style="padding:24px">
        <p style="margin:0 0 10px;font-size:16px">${T.hi}${d.name ? ', <b>' + esc(clip(d.name, 60)) + '</b>' : ''}!</p>
        <p style="margin:0 0 14px;color:#5b6270">${T.text}</p>
        <p style="margin:0 0 16px;color:#5b6270;font-size:13px">${T.num} № ${esc(clip(d.num, 40))}</p>
        ${d.taxUrl ? '<p style="margin:0"><a href="' + esc(d.taxUrl) + '" style="color:' + BLUE + '">' + T.tax + ' →</a></p>' : ''}
      </td></tr>
      <tr><td style="background:${INK};padding:16px;text-align:center;color:#fff;font-size:12px">reyter.men</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

const MONO = 'https://api.monobank.ua/api/merchant';
const FB_PROJECT = 'reyter-18d2c';
const FB = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

/* Firestore віддає значення в обгортках виду {stringValue: '…'}.
   Розгортаємо рівно так само, як це робить сайт. */
function fbValue(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fbValue);
  if ('mapValue' in v) return fbFields(v.mapValue.fields || {});
  return null;
}

function fbFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fbValue(v);
  return out;
}

async function fbGet(path) {
  const res = await fetch(`${FB}/${path}`);
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return json && json.fields ? fbFields(json.fields) : null;
}

/** Каталог, який ЗАРАЗ бачить покупець: запланована публікація
 *  вмикається сама, щойно настає її час — так само, як на сайті. */
async function catalogueNow() {
  const [next, current] = await Promise.all([
    fbGet('published/next'),
    fbGet('published/catalog')
  ]);
  const at = Number((next && next.publishAt) || 0);
  const due = !!next && at > 0 && at <= Date.now();
  const snap = due ? next : current;
  return Array.isArray(snap && snap.products) ? snap.products : [];
}

/* Знижка за промокодом — ті самі правила, що й на сайті. Код тут
   не для зручності, а для безпеки: якщо повірити знижці з
   браузера, у ній можна написати будь-що. */
function promoOff(promo, lines, email) {
  if (!promo || promo.active === false) return 0;
  const now = Date.now();
  if (promo.email && String(promo.email).toLowerCase() !== String(email || '').toLowerCase()) return 0;
  if (promo.startsAt && now < Date.parse(promo.startsAt + 'T00:00:00')) return 0;
  if (promo.endsAt && now >= Date.parse(promo.endsAt + 'T23:59:59')) return 0;
  const limit = Number(promo.usageLimit) || 0;
  if (limit > 0 && (Number(promo.usedCount) || 0) >= limit) return 0;

  const goods = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const min = Number(promo.minTotal) || 0;
  if (min > 0 && goods < min) return 0;

  const list = Array.isArray(promo.list) ? promo.list.map(String) : [];
  const fits = (l) =>
    promo.scope === 'products' ? list.includes(l.id)
    : promo.scope === 'categories' ? list.includes(String(l.category || ''))
    : true;
  const base = lines.filter(fits).reduce((s, l) => s + l.price * l.qty, 0);
  if (base <= 0) return 0;

  const value = Number(promo.value) || 0;
  const off = promo.type === 'fixed' ? Math.min(value, base) : Math.floor(base * value / 100);
  return Math.max(0, Math.min(Math.round(off), goods));
}

/** Рахунок за замовленням. Ціни — з каталогу, знижка — з коду,
 *  доставка — від сайту, але в межах здорового глузду. */
async function priceOrder(d) {
  const products = await catalogueNow();
  const byId = new Map(products.map((p) => [String(p.id), p]));

  const lines = [];
  for (const raw of Array.isArray(d.items) ? d.items.slice(0, 50) : []) {
    const p = byId.get(String(raw.id || ''));
    if (!p) continue;
    const qty = Math.max(1, Math.min(50, Math.round(Number(raw.qty) || 1)));
    lines.push({
      id: String(p.id),
      name: String(p.name || p.id),
      category: String(p.category || ''),
      size: clip(raw.size, 12),
      price: Math.max(0, Math.round(Number(p.price) || 0)),
      qty: qty
    });
  }
  if (!lines.length) return { error: 'У замовленні немає жодного товару з каталогу' };

  const goods = lines.reduce((s, l) => s + l.price * l.qty, 0);

  let off = 0;
  const code = String(d.promo || '').trim().toUpperCase();
  if (code) {
    const promo = await fbGet('promos/' + encodeURIComponent(code));
    off = promoOff(promo, lines, d.to || d.email || '');
  }

  /* Доставку рахує перевізник на сайті, і підробити її в бік
     зменшення означає лише недоплатити за пересилку — товар усе
     одно оплачується повністю. Але межу ставимо: рахунок на
     мільйон за «доставку» нікому не потрібен. */
  const shipping = Math.max(0, Math.min(5000, Math.round(Number(d.shipping) || 0)));

  return { lines, goods, discount: off, shipping, total: Math.max(1, goods - off + shipping) };
}

/* Виписка банку. Вікно не довше за 31 день — це межа самого
   Monobank, і за неї він відповідає помилкою замість даних.
   Тому питаємо місяцями й склеюємо. */
async function monoStatement(env, days = 30) {
  const now = Math.floor(Date.now() / 1000);
  const window = 30 * 24 * 3600;
  const out = [];
  for (let back = 0; back < days * 24 * 3600; back += window) {
    const to = now - back;
    const from = Math.max(now - days * 24 * 3600, to - window);
    const r = await monoCall(env, '/statement?from=' + from + '&to=' + to, { method: 'GET' });
    if (!r.ok) return { ok: false, error: (r.data && r.data.errText) || 'Виписка недоступна', list: out };
    out.push(...((r.data && r.data.list) || []));
    if (from <= now - days * 24 * 3600) break;
  }
  return { ok: true, error: '', list: out };
}

async function monoCall(env, path, init) {
  const res = await fetch(MONO + path, {
    ...init,
    headers: { 'X-Token': env.MONO_TOKEN, 'Content-Type': 'application/json', ...(init && init.headers) }
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Рахунок у Monobank. Сума — тільки та, що порахував воркер. */
async function monoInvoice(env, { total, lines, num, lang, hook }) {
  const site = 'https://reyter.men/new';
  const body = {
    // Monobank рахує в копійках
    amount: Math.round(total * 100),
    ccy: 980,
    merchantPaymInfo: {
      reference: clip(num, 40),
      destination: (lang === 'en' ? 'Order No. ' : 'Замовлення №') + clip(num, 40) + ' — REYTER',
      basketOrder: (lines || []).slice(0, 50).map((l) => ({
        name: clip(l.name + (l.size ? ' · ' + l.size : ''), 100),
        qty: l.qty,
        sum: Math.round(l.price * 100),
        unit: 'шт',
        code: clip(l.id, 40)
      }))
    },
    redirectUrl: `${site}/thanks?num=${encodeURIComponent(clip(num, 40))}`,
    /* Куди банк сам повідомить про оплату. Адреса — цей же
       воркер, шлях /mono; підпис перевіряється там-таки. */
    webHookUrl: hook || undefined,
    /* Півгодини на оплату. Менше — і людина не встигне дійти до
       картки; більше — і рахунок висить, коли товар уже продано. */
    validity: 1800,
    paymentType: 'debit'
  };
  const r = await monoCall(env, '/invoice/create', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok || !r.data.invoiceId) {
    return { ok: false, error: r.data.errText || r.data.errorDescription || 'Monobank не створив рахунок' };
  }
  return { ok: true, invoiceId: r.data.invoiceId, pageUrl: r.data.pageUrl };
}

/* ============================================================
   Скільки разів поспіль можна просити рахунок
   ------------------------------------------------------------
   Створення рахунку відкрите для сайту — інакше покупець не зміг
   би оплатити. Але відкритий шлях без ліку означає, що його можна
   смикати ботом: грошей це не коштує, зате кабінет засипає
   порожніми рахунками, а банк рано чи пізно почне відмовляти всім.

   Лічильник у памʼяті воркера, не в сховищі: він живе стільки,
   скільки живе ізолят, і при великому напливі частину запитів
   пропустить. Це свідомий розмін — за точний лік довелося б
   платити зверненням у сховище на КОЖЕН запит. Проти простого
   циклу цього досить, а проти справжньої атаки однаково потрібен
   не лічильник, а Cloudflare перед воркером.
   ============================================================ */

const SEEN = new Map();
/** Скільки рахунків на одне замовлення за десять хвилин. */
const PER_ORDER = 5;
/** І скільки на весь магазин за хвилину. */
const PER_MINUTE = 60;

function tooOften(ref) {
  const now = Date.now();
  // прибираємо старе, щоб мапа не росла нескінченно
  for (const [k, times] of SEEN) {
    const live = times.filter((t) => now - t < 600_000);
    if (live.length) SEEN.set(k, live);
    else SEEN.delete(k);
  }

  const all = [...SEEN.values()].flat().filter((t) => now - t < 60_000);
  if (all.length >= PER_MINUTE) return 'Забагато запитів на оплату. Спробуйте за хвилину.';

  const key = String(ref || 'без-номера');
  const mine = (SEEN.get(key) || []).filter((t) => now - t < 600_000);
  if (mine.length >= PER_ORDER) {
    return 'Для цього замовлення вже виставляли кілька рахунків. Зачекайте десять хвилин або напишіть нам.';
  }
  SEEN.set(key, [...mine, now]);
  return '';
}

/* ============================================================
   Вебхук Monobank
   ------------------------------------------------------------
   Банк сам сповіщає про оплату — і це єдиний спосіб дізнатись про
   неї тоді, коли адмінка закрита. Але вірити такому повідомленню
   на слово не можна: адресу вебхука видно в кожному рахунку, і
   надіслати на неї «оплачено» може будь-хто.

   Тому підпис перевіряється завжди: банк підписує тіло запиту
   своїм ключем (ECDSA P-256 + SHA-256), а відкритий ключ віддає
   окремим методом. Не збігся — мовчки відмовляємо.

   Що робить вебхук: пише в Telegram, що гроші прийшли. Статус
   замовлення він НЕ міняє навмисно — підтвердження списує товар
   зі складу, а це найтонша логіка в усьому магазині, і жити вона
   має в одному місці, а не в двох. Менеджер відкриє адмінку й
   побачить, що замовлення вже оплачене.
   ============================================================ */

let PUBKEY = null;

async function monoPubKey(env) {
  if (PUBKEY) return PUBKEY;
  const r = await monoCall(env, '/pubkey', { method: 'GET' });
  const raw = r.data && r.data.key;
  if (!raw) return null;

  // ключ приходить як PEM у base64 — розгортаємо до самих байтів
  const pem = atob(raw).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  PUBKEY = await crypto.subtle.importKey(
    'spki', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
  );
  return PUBKEY;
}

async function signedByMono(env, body, sign) {
  if (!sign) return false;
  try {
    const key = await monoPubKey(env);
    if (!key) return false;
    const sig = Uint8Array.from(atob(sign), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      sig,
      new TextEncoder().encode(body)
    );
  } catch (e) {
    return false;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


export default {
  async fetch(request, env) {
    /* Сайт і адмінка живуть на різних доменах, тож дозволених
       origin кілька. Браузер приймає в заголовку рівно один —
       віддаємо той, з якого прийшов запит, якщо він у списку. */
    const allowed = String(env.ALLOW_ORIGIN || 'https://reyter.men,https://admin.reyter.men')
      .split(/[,;\s]+/)
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    const origin = (request.headers.get('Origin') || '').replace(/\/+$/, '');
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
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

    /* Вебхук банку. Ловимо його ДО розбору JSON: підпис
       перевіряється по сирому тілу, і будь-яка переробка тексту
       його зламала б. */
    if (new URL(request.url).pathname.replace(/\/+$/, '').endsWith('/mono')) {
      const body = await request.text();
      if (!(await signedByMono(env, body, request.headers.get('X-Sign')))) {
        // не банк — і пояснювати чужому, що саме не так, ні до чого
        return new Response('no', { status: 403 });
      }
      let w = {};
      try {
        w = JSON.parse(body);
      } catch (e) {
        return new Response('bad', { status: 400 });
      }

      /* Пишемо в Telegram лише про гроші, які справді дійшли.
         Статус замовлення вебхук не міняє навмисно: підтвердження
         списує товар зі складу, і ця логіка має жити в одному
         місці — в адмінці, а не в двох. */
      if (w.status === 'success') {
        await tgSend(
          env,
          '💳 ОПЛАЧЕНО ' + clip(String(Math.round((Number(w.amount) || 0) / 100)), 12) + ' грн\n' +
            'Замовлення №' + clip(String(w.reference || ''), 40) + '\n' +
            'Рахунок ' + clip(String(w.invoiceId || ''), 60)
        );
      }
      if (w.status === 'reversed') {
        await tgSend(
          env,
          '↩️ ПОВЕРНЕНО ' + clip(String(Math.round((Number(w.amount) || 0) / 100)), 12) + ' грн\n' +
            'Замовлення №' + clip(String(w.reference || ''), 40)
        );
      }
      // банк чекає лише «прийняв»
      return new Response('ok');
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

    /* --- «Знову в наявності» для підписки --- */

    if (type === 'stock') {
      const to = String(d.to || '').trim();
      if (!EMAIL_RE.test(to)) {
        return reply({ ok: false, error: 'Некоректний email отримувача' }, 400, cors);
      }
      if (!d.product) {
        return reply({ ok: false, error: 'Не вказано товар' }, 400, cors);
      }
      const subject = d.lang === 'en'
        ? 'Back in stock — ' + clip(d.product, 80) + ' | REYTER'
        : 'Знову в наявності — ' + clip(d.product, 80) + ' | REYTER';
      const res = await sendMail(env, to, subject, stockHTML(d));
      return reply(res, res.ok ? 200 : 502, cors);
    }

    /* --- Нова Пошта: кабінет договору ---
       Ключ від кабінету дає право створювати накладні й списувати
       гроші з рахунку, тому в браузер він не потрапляє: адмінка
       просить воркер, а ключ лежить тут, поруч із рештою секретів.

       Дозволені лише ті методи, які потрібні для накладної.
       Інакше проксі перетворилося б на відкриті двері в кабінет
       для будь-кого, хто знає адресу воркера. */

    if (type === 'np') {
      if (env.ADMIN_KEY && d.key !== env.ADMIN_KEY) {
        return reply({ ok: false, error: 'Невірний ключ адміністратора (ADMIN_KEY)' }, 403, cors);
      }
      if (!env.NP_KEY) {
        return reply({
          ok: false,
          error: 'у воркері не задано NP_KEY — ключ кабінету Нової Пошти (Settings → Variables and Secrets → Add → Secret → потім Deploy)'
        }, 400, cors);
      }

      const ДОЗВОЛЕНО = {
        Counterparty: ['getCounterparties', 'getCounterpartyContactPersons', 'getCounterpartyAddresses'],
        InternetDocument: ['save', 'delete', 'getDocumentPrice', 'getDocumentDeliveryDate', 'printDocument'],
        Address: ['getCities', 'getWarehouses', 'searchSettlements', 'searchSettlementStreets'],
        AddressGeneral: ['getWarehouses'],
        Common: ['getTypesOfPayers', 'getPaymentForms', 'getCargoTypes', 'getServiceTypes', 'getBackwardDeliveryCargoTypes']
      };
      const model = String(d.model || '');
      const method = String(d.method || '');
      if (!(ДОЗВОЛЕНО[model] || []).includes(method)) {
        return reply({ ok: false, error: 'Метод не дозволено: ' + model + '.' + method }, 403, cors);
      }

      try {
        const res = await fetch('https://api.novaposhta.ua/v2.0/json/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: env.NP_KEY,
            modelName: model,
            calledMethod: method,
            methodProperties: d.props && typeof d.props === 'object' ? d.props : {}
          })
        });
        const data = await res.json().catch(() => ({}));
        return reply({
          ok: !!data.success,
          data: data.data || [],
          error: (data.errors || []).join('; ') || (data.warnings || []).join('; ') || ''
        }, 200, cors);
      } catch (e) {
        return reply({ ok: false, error: 'немає звʼязку з Новою Поштою' }, 502, cors);
      }
    }

    /* --- Номер накладної покупцю --- */

    if (type === 'ttn') {
      const to = String(d.to || '').trim();
      if (!EMAIL_RE.test(to)) {
        return reply({ ok: false, error: 'Некоректний email отримувача' }, 400, cors);
      }
      if (!String(d.ttn || '').trim()) {
        return reply({ ok: false, error: 'Не вказано номер накладної' }, 400, cors);
      }
      const subject = d.lang === 'en'
        ? 'Your parcel is on its way — ' + clip(String(d.ttn), 40) + ' | REYTER'
        : 'Посилка вирушила — ' + clip(String(d.ttn), 40) + ' | REYTER';
      const res = await sendMail(env, to, subject, ttnHTML(d));
      return reply(res, res.ok ? 200 : 502, cors);
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

    /* --- Оплата карткою: Monobank --- */

    if (
      type === 'pay-create' || type === 'pay-status' || type === 'pay-refund' ||
      type === 'pay-link' || type === 'pay-receipt' || type === 'pay-receipt-send' ||
      type === 'pay-find' || type === 'pay-doubles' || type === 'pay-paid' ||
      type === 'pay-map'
    ) {
      // Усе, крім створення рахунку й перевірки стану, — тільки з адмінки
      const adminOnly = type !== 'pay-create' && type !== 'pay-status' && type !== 'pay-paid';
      if (adminOnly && env.ADMIN_KEY && d.key !== env.ADMIN_KEY) {
        return reply({ ok: false, error: 'Невірний ключ адміністратора (ADMIN_KEY)' }, 403, cors);
      }
      if (!env.MONO_TOKEN) {
        return reply({
          ok: false,
          error: 'у воркері не задано MONO_TOKEN — токен еквайрингу Monobank (Settings → Variables and Secrets → Add → Secret → потім Deploy)'
        }, 400, cors);
      }

      /* Стан рахунку. Єдине джерело правди — сам Monobank: у нас
         оплата ніде не зберігається, тож і підробити її нікому. */
      if (type === 'pay-status') {
        const inv = clip(d.invoiceId, 60);
        if (!inv) return reply({ ok: false, error: 'Немає номера рахунку' }, 400, cors);
        const r = await monoCall(env, '/invoice/status?invoiceId=' + encodeURIComponent(inv), { method: 'GET' });
        if (!r.ok) {
          return reply({ ok: false, error: r.data.errText || 'Monobank не відповів' }, 200, cors);
        }
        return reply({
          ok: true,
          status: r.data.status || '',
          failureReason: r.data.failureReason || '',
          amount: Math.round((Number(r.data.amount) || 0) / 100),
          reference: r.data.reference || '',
          at: r.data.modifiedDate || r.data.createdDate || ''
        }, 200, cors);
      }

      /* Чи оплачене замовлення — питання про ЗАМОВЛЕННЯ, а не про
         рахунок. Рахунків у нього може бути кілька: перший із
         кошика, потім надісланий листом, потім ще один із
         кабінету. Браузер памʼятає лише свій, і саме тому сторінка
         подяки писала «оплата не пройшла» над успішно оплаченим
         замовленням.

         Відповідь навмисно куца: чи оплачено й на скільки. Ні
         імені, ні адреси, ні складу — по номеру замовлення звідси
         не дізнатись нічого, чого покупець і так не бачить. */
      if (type === 'pay-paid') {
        const want = clip(d.orderNum || d.num, 40).trim();
        if (!want) return reply({ ok: false, error: 'Немає номера замовлення' }, 400, cors);
        const seen = await monoStatement(env, 30);
        if (!seen.ok) return reply({ ok: false, error: seen.error }, 200, cors);

        let paid = 0;
        let back = 0;
        for (const x of seen.list) {
          if (String(x.reference || '') !== want || x.status !== 'success') continue;
          paid += Number(x.amount) || 0;
          back += (x.cancelList || []).reduce((n, c) => n + (Number(c.amount) || 0), 0);
        }
        return reply({
          ok: true,
          paid: paid - back > 0,
          refunded: paid > 0 && paid - back <= 0,
          amount: Math.round((paid - back) / 100)
        }, 200, cors);
      }

      /* Чек. Банк віддає два різні документи, і менеджерові
         потрібні обидва: фіскальний чек — той, що подається в
         податкову, а квитанція — те, що покупець звик називати
         чеком. Обидва приходять готовим PDF, який ми лише
         передаємо далі. */
      if (type === 'pay-receipt') {
        const inv = clip(d.invoiceId, 60);
        if (!inv) return reply({ ok: false, error: 'Немає номера рахунку' }, 400, cors);

        const [fiscal, receipt] = await Promise.all([
          monoCall(env, '/invoice/fiscal-checks?invoiceId=' + encodeURIComponent(inv), { method: 'GET' }),
          monoCall(env, '/invoice/receipt?invoiceId=' + encodeURIComponent(inv), { method: 'GET' })
        ]);

        const checks = (fiscal.data && fiscal.data.checks) || [];
        const done = checks.filter((c) => c && c.status === 'done');
        return reply({
          ok: !!(done.length || (receipt.data && receipt.data.file)),
          fiscal: done.map((c) => ({ id: c.id, type: c.type, taxUrl: c.taxUrl || '', file: c.file || '' })),
          receipt: (receipt.data && receipt.data.file) || '',
          error: done.length ? '' : (receipt.data && receipt.data.errText) || 'Чека ще немає — банк формує його за кілька хвилин після оплати'
        }, 200, cors);
      }

      /* Чек листом покупцеві. Той самий документ, що менеджер
         бачить у себе, — але вкладенням у лист, щоб не пересилати
         файл руками з власної пошти. */
      if (type === 'pay-receipt-send') {
        const inv = clip(d.invoiceId, 60);
        const to = String(d.to || '').trim();
        if (!inv) return reply({ ok: false, error: 'Немає номера рахунку' }, 400, cors);
        if (!EMAIL_RE.test(to)) return reply({ ok: false, error: 'Некоректний email отримувача' }, 400, cors);

        const [fiscal, receipt] = await Promise.all([
          monoCall(env, '/invoice/fiscal-checks?invoiceId=' + encodeURIComponent(inv), { method: 'GET' }),
          monoCall(env, '/invoice/receipt?invoiceId=' + encodeURIComponent(inv), { method: 'GET' })
        ]);
        const check = (((fiscal.data && fiscal.data.checks) || []).filter((c) => c && c.status === 'done'))[0];
        const files = [];
        if (check && check.file) files.push({ filename: 'fiskalnyi-chek.pdf', content: check.file });
        if (receipt.data && receipt.data.file) files.push({ filename: 'kvytantsiia.pdf', content: receipt.data.file });
        if (!files.length) {
          return reply({ ok: false, error: 'Чека ще немає — банк формує його за кілька хвилин після оплати' }, 200, cors);
        }

        const res = await sendMail(
          env, to,
          (d.lang === 'en' ? 'Receipt for order No. ' : 'Чек за замовленням №') + clip(d.orderNum || d.num, 40) + ' — REYTER',
          receiptHTML({ lang: d.lang, name: d.name, num: d.orderNum || d.num, taxUrl: (check && check.taxUrl) || '' }),
          env.MAIL_BCC,
          files
        );
        return reply(res, res.ok ? 200 : 502, cors);
      }

      /* Пошук оплати за номером замовлення.
         Рахунок міг загубитись: покупець платив за одним
         посиланням, а в замовленні лежало інше. Банк памʼятає всі
         платежі й знає номер замовлення в полі reference — тож
         знайти гроші можна навіть тоді, коли номер рахунку в нас
         не зберігся. */
      if (type === 'pay-find') {
        const want = clip(d.orderNum || d.num, 40).trim();
        if (!want) return reply({ ok: false, error: 'Немає номера замовлення' }, 400, cors);
        // 60 днів назад: далі шукати немає сенсу, повернення теж скінчились
        const r = await monoStatement(env, 60);
        if (!r.ok) return reply({ ok: false, error: r.error }, 200, cors);
        const found = r.list
          .filter((x) => String(x.reference || '') === want)
          .map((x) => {
            const back = (x.cancelList || []).reduce((n, c) => n + (Number(c.amount) || 0), 0);
            return {
              invoiceId: x.invoiceId,
              status: x.status,
              amount: Math.round((Number(x.amount) || 0) / 100),
              refunded: Math.round(back / 100),
              at: x.date || '',
              card: x.maskedPan || ''
            };
          });
        return reply({ ok: true, found }, 200, cors);
      }

      /* Гроші за всіма замовленнями — одним запитом.
         Раніше адмінка питала стан кожного рахунку окремо: сто
         замовлень — сто запитів кожні пів хвилини. Тут одна
         виписка, а розкладаємо її за номерами замовлень уже самі.

         Рахуємо і повернення: часткове повернення інакше ніде не
         видно, і картка каже «оплачено», хоч половину грошей уже
         віддали. */
      if (type === 'pay-map') {
        const r = await monoStatement(env, 30);
        if (!r.ok) return reply({ ok: false, error: r.error }, 200, cors);
        const map = {};
        for (const x of r.list) {
          if (x.status !== 'success') continue;
          const ref = String(x.reference || '');
          if (!ref) continue;
          const back = (x.cancelList || []).reduce((n, c) => n + (Number(c.amount) || 0), 0);
          const at = map[ref] || (map[ref] = { paid: 0, refunded: 0, count: 0, invoices: [] });
          at.paid += Number(x.amount) || 0;
          at.refunded += back;
          // за оплату рахуємо лише те, що лишилось у магазину
          if ((Number(x.amount) || 0) - back > 0) at.count += 1;
          at.invoices.push(x.invoiceId);
        }
        for (const ref of Object.keys(map)) {
          map[ref].paid = Math.round(map[ref].paid / 100);
          map[ref].refunded = Math.round(map[ref].refunded / 100);
        }
        return reply({ ok: true, map }, 200, cors);
      }

      /* Подвійні списання — одним запитом на весь магазин.
         Питати виписку окремо на кожне замовлення означало б
         десятки запитів на кожне оновлення списку; тут вона одна,
         а групування за номером замовлення робимо вже в себе. */
      if (type === 'pay-doubles') {
        const r = await monoStatement(env, 30);
        if (!r.ok) return reply({ ok: false, error: r.error }, 200, cors);
        /* Повернені платежі лишаються у виписці зі станом
           success — про повернення каже cancelList. Тому гроші
           рахуємо як «оплачено мінус повернуто»: інакше замовлення,
           за яке вже все віддали, вічно значилось би оплаченим
           двічі. */
        const byRef = {};
        for (const x of r.list) {
          if (x.status !== 'success') continue;
          const ref = String(x.reference || '');
          if (!ref) continue;
          const back = (x.cancelList || []).reduce((n, c) => n + (Number(c.amount) || 0), 0);
          const left = (Number(x.amount) || 0) - back;
          if (left <= 0) continue;
          (byRef[ref] ||= []).push({
            invoiceId: x.invoiceId,
            amount: Math.round(left / 100),
            at: x.date || '',
            card: x.maskedPan || ''
          });
        }
        const doubles = {};
        for (const [ref, list] of Object.entries(byRef)) if (list.length > 1) doubles[ref] = list;
        return reply({ ok: true, doubles }, 200, cors);
      }

      /* Повернення коштів. Сума — у гривнях; без неї Monobank
         повертає все. Скасувати можна лише те, що оплачено. */
      if (type === 'pay-refund') {
        const inv = clip(d.invoiceId, 60);
        if (!inv) return reply({ ok: false, error: 'Немає номера рахунку' }, 400, cors);

        /* Скільки за цим рахунком ще можна повернути. Банк на
           спробу повернути більше відповідає «wrong cancel amount
           or ccy» — правильна відповідь, але зрозуміти з неї
           нічого не можна. Тому дивимось у виписку самі: там видно
           і суму платежу, і все, що вже повернуто. */
        const seen = await monoStatement(env, 30);
        const row = seen.list.find((x) => x.invoiceId === inv);
        if (row) {
          const done = (row.cancelList || []).reduce((n, c) => n + (Number(c.amount) || 0), 0);
          const left = (Number(row.amount) || 0) - done;
          if (left <= 0) {
            return reply({
              ok: false,
              error: 'За цим рахунком уже повернуто все (' + Math.round(done / 100) + ' грн). Повертати більше нічого.'
            }, 200, cors);
          }
          const want = Math.max(0, Math.round(Number(d.amount) || 0)) * 100;
          if (want > left) {
            return reply({
              ok: false,
              error: 'Повернути можна не більше ніж ' + Math.round(left / 100) + ' грн — решту вже повернули.'
            }, 200, cors);
          }
        }

        /* Часткове повернення вимагає валюти поруч із сумою:
           без ccy банк вважає запит хибним. Повне — це просто
           рахунок без суми. */
        const back = Math.max(0, Math.round(Number(d.amount) || 0));
        const body = back > 0 ? { invoiceId: inv, amount: back * 100, ccy: 980 } : { invoiceId: inv };
        const r = await monoCall(env, '/invoice/cancel', { method: 'POST', body: JSON.stringify(body) });
        if (!r.ok) {
          return reply({ ok: false, error: r.data.errText || 'Monobank відмовив у поверненні' }, 200, cors);
        }
        return reply({ ok: true, status: r.data.status || '', at: r.data.modifiedDate || '' }, 200, cors);
      }

      /* ГОЛОВНИЙ ЗАПОБІЖНИК ВІД ПОДВІЙНОГО СПИСАННЯ.

         Перед тим як виставити рахунок, питаємо банк, чи за цим
         замовленням уже не платили. Виписка знає номер замовлення
         в полі reference, тож відповідь не залежить ні від того,
         які номери рахунків памʼятає браузер, ні від того, скільки
         старих посилань лишилось живими.

         Доти рішення ухвалював браузер: він знав свій рахунок, а
         посилання з листа — ні. 15.08.2026 покупець заплатив за
         листом, повернувся в кабінет, натиснув «оплатити ще раз» —
         і заплатив удруге. Такі помилки коштують не збоїв, а
         грошей і довіри, тож перевірка тепер там, де її не
         обійти. */
      {
        const want = clip(d.orderNum || d.num, 40).trim();
        if (want) {
          const seen = await monoStatement(env, 30);
          const paid = seen.list.find((x) => {
            if (String(x.reference || '') !== want || x.status !== 'success') return false;
            const back = (x.cancelList || []).reduce((n, c) => n + (Number(c.amount) || 0), 0);
            // повернене грошима магазину вже не є — за таке замовлення можна платити знову
            return (Number(x.amount) || 0) - back > 0;
          });
          if (paid) {
            return reply({
              ok: false,
              paidAlready: true,
              status: 'success',
              invoiceId: paid.invoiceId,
              amount: Math.round((Number(paid.amount) || 0) / 100),
              error: 'Замовлення №' + want + ' уже оплачене (' +
                Math.round((Number(paid.amount) || 0) / 100) + ' грн, рахунок ' + paid.invoiceId +
                '). Новий рахунок не виставлено.'
            }, 200, cors);
          }
        }
      }

      /* Новий рахунок скасовує старий. Без цього в замовлення
         веде два живі посилання — те, що покупець відкрив на
         сайті, і те, що менеджер надіслав листом, — і заплатити
         можна за обома. Саме так 14.08.2026 гроші пройшли за
         посиланням, про яке адмінка вже не знала: чек є, а
         замовлення значиться неоплаченим.

         Спершу питаємо стан: якщо старий рахунок уже оплачено,
         нового не буде — інакше з людини візьмуть двічі. */
      const older = [
        clip(d.previousInvoiceId, 60),
        ...(Array.isArray(d.previousInvoiceIds) ? d.previousInvoiceIds.slice(0, 10).map((x) => clip(x, 60)) : [])
      ].filter(Boolean);

      for (const previous of [...new Set(older)]) {
        const was = await monoCall(env, '/invoice/status?invoiceId=' + encodeURIComponent(previous), { method: 'GET' });
        const state = (was.data && was.data.status) || '';
        if (state === 'success' || state === 'hold' || state === 'processing') {
          return reply({
            ok: false,
            paidAlready: true,
            status: state,
            error: 'За цим замовленням уже платили (рахунок ' + previous + ', стан «' + state + '»). Новий рахунок не виставлено.'
          }, 200, cors);
        }
        // не оплачений — глушимо, щоб лишилось рівно одне посилання
        await monoCall(env, '/invoice/remove', { method: 'POST', body: JSON.stringify({ invoiceId: previous }) });
      }

      /* Скільки разів поспіль можна просити рахунок. Стоїть саме
         тут, після всіх перевірок: відмовляти тому, за кого вже
         заплатили, немає сенсу. */
      const often = tooOften(d.orderNum || d.num);
      if (often) return reply({ ok: false, error: often }, 429, cors);

      /* Рахунок для покупця. Ціни бере з каталогу сам воркер —
         від сайту приймається лише перелік товарів. */
      const bill = await priceOrder(d);
      if (bill.error) return reply({ ok: false, error: bill.error }, 400, cors);

      const made = await monoInvoice(env, {
        total: bill.total,
        lines: bill.lines,
        num: d.orderNum || d.num,
        lang: d.lang,
        // власна адреса: беремо з самого запиту, щоб не тримати її ще й у налаштуваннях
        hook: new URL(request.url).origin + '/mono'
      });
      if (!made.ok) return reply({ ok: false, error: made.error }, 200, cors);

      /* Рахунок із адмінки ще й летить покупцеві листом: інакше
         менеджерові довелося б копіювати посилання руками. */
      let mail = { ok: false, skipped: true, error: '' };
      if (type === 'pay-link') {
        const to = String(d.to || '').trim();
        if (EMAIL_RE.test(to)) {
          const en = d.lang === 'en';
          mail = await sendMail(
            env, to,
            (en ? 'Payment for order No. ' : 'Оплата замовлення №') + clip(d.orderNum || d.num, 40) + ' — REYTER',
            payHTML({
              lang: d.lang,
              name: d.name,
              num: d.orderNum || d.num,
              total: bill.total,
              url: made.pageUrl
            }),
            env.MAIL_BCC
          );
        } else {
          mail = { ok: false, error: 'Некоректний email отримувача' };
        }
      }

      return reply({
        ok: true,
        invoiceId: made.invoiceId,
        pageUrl: made.pageUrl,
        amount: bill.total,
        goods: bill.goods,
        discount: bill.discount,
        shipping: bill.shipping,
        email: mail
      }, 200, cors);
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
