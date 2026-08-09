/* ============================================================
   REYTER — маршрутизація Cloudflare Pages за доменом
   ------------------------------------------------------------
   Один проєкт Pages роздає репозиторій на два домени:

     reyter.men        → старий сайт у корені, новий у /new/
     admin.reyter.men  → адмінка з new/admin.html

   Файл _redirects тут не годиться: у нього немає умови за
   доменом, тож правила для адмінки застосовувались би й до
   головного сайту — і на reyter.men з кореня відкривалася б
   адмінка.

   Middleware виконується перед видачею статики. next(Request)
   віддає інший файл, не змінюючи адресу в браузері.
   ============================================================ */

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // Головний домен віддає репозиторій як є
  if (!url.hostname.startsWith('admin.')) return next();

  const path = url.pathname;
  let target = null;

  if (path === '/' || path === '') {
    /* Без .html: Pages сам нормалізує розширення й віддає 308 на
       «чистий» шлях. Той редирект долітає до браузера і міняє
       адресу на /new/admin — саме тому ціль одразу без .html. */
    target = '/new/admin';
  } else if (path.startsWith('/css/') || path.startsWith('/js/')) {
    // Стилі й скрипти адмінки лежать у папці сайту
    target = '/new' + path;
  }
  // /assets/* і /new/* уже вказують куди треба — не чіпаємо

  if (!target) return next();

  const to = new URL(url);
  to.pathname = target;
  const res = await next(new Request(to.toString(), request));

  /* Корінь домену адмінки не кешуємо. Якщо колись маршрут знову
     віддасть редирект, браузер запамʼятає його надовго (308 —
     «постійний»), і потім адреса чіплятиметься навіть після
     виправлення на сервері. */
  if (path === '/' || path === '') {
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'no-store');
    return out;
  }
  return res;
}
