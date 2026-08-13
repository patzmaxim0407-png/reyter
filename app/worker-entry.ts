import nextWorker from './.open-next/worker.js';

/* ============================================================
   REYTER — вхід у воркер
   ------------------------------------------------------------
   Застосунок зібраний із basePath '/new': у корені reyter.men
   лишається попередній сайт, і новий не може займати кореневі
   адреси.

   Але на admin.reyter.men адмінка має відкриватись із кореня —
   інакше адреса перетворилась би на admin.reyter.men/new/admin,
   що безглуздо для окремого домену.

   Уся маршрутизація за доменом живе саме тут, а не в middleware,
   з двох причин:

   • Next відкидає все, що не починається з basePath, ДО того,
     як middleware спрацює — переписати шлях звідти вже пізно;
   • middleware отримує хост не тим, яким його надіслав браузер:
     запит до нього доходить уже перезібраним, і на всіх доменах
     він виглядав однаково.

   Тут хост беремо із заголовка — він єдиний, кому можна вірити
   і в Cloudflare, і в локальному запуску.
   ============================================================ */

const BASE = '/new';

/** Домени магазину. Перелік, а не здогадка за формою імені:
 *  на технічній адресі workers.dev і локально перенаправляти
 *  нікуди — адмінка там живе на тому самому хості. */
const SHOP_HOSTS = ['reyter.men', 'www.reyter.men'];

function hostOf(request: Request): string {
  const raw = request.headers.get('host') ?? new URL(request.url).host;
  return raw.split(':')[0].toLowerCase();
}

/* Сторінку браузер має перепитувати щоразу.

   Next віддає документ із s-maxage на рік і stale-while-revalidate
   на місяць — це адресовано спільним кешам, і для них воно
   правильне. Але власний кеш браузера при цьому лишається без
   жодної вказівки, і вкладка, відкрита вчора, має право показати
   вчорашню розмітку — з іменами файлів, яких на сервері вже
   немає. Далі все ламається тихо: код не оживає, натискання на
   картку стає звичайним переходом за посиланням, і сторінка
   перезавантажується на кожному відкритті й закритті товару.
   Саме це власник і бачив 14.08.2026.

   Тому документам додаємо no-cache: браузер щоразу питає сервер,
   а сервер відповідає з кеша сторінок за 10-15 мс. Статики це не
   стосується — у неї імена з відбитком вмісту, і вона так і
   лишається immutable на рік. */
function freshDocument(res: Response): Response {
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/html')) return res;
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'no-cache, must-revalidate');
  return out;
}

function withPath(url: URL, pathname: string): URL {
  const next = new URL(url);
  next.pathname = pathname;
  return next;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    const host = hostOf(request);
    const path = url.pathname;

    /* Службові адреси не чіпаємо: під ними лежить статика самого
       Next, і вона однакова для обох доменів. */
    const isInternal =
      path.startsWith(BASE) || path.startsWith('/_next/') || path === '/favicon.ico';

    // Адмінський домен: корінь — це адмінка
    if (host.startsWith('admin.') && !isInternal) {
      const to = withPath(url, BASE + '/admin' + (path === '/' ? '' : path));
      return freshDocument(await nextWorker.fetch(new Request(to, request), env, ctx));
    }

    /* Магазинний домен: адмінці тут робити нічого, ведемо на її
       власний домен — там свій вхід і свої правила кешування. */
    if (SHOP_HOSTS.includes(host) && path.startsWith(BASE + '/admin')) {
      const to = new URL(url);
      to.hostname = 'admin.' + host.replace(/^www\./, '');
      to.pathname = path.slice((BASE + '/admin').length) || '/';
      return Response.redirect(to.toString(), 307);
    }

    return freshDocument(await nextWorker.fetch(request, env, ctx));
  }
};
