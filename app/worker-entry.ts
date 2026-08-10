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
      return nextWorker.fetch(new Request(to, request), env, ctx);
    }

    /* Магазинний домен: адмінці тут робити нічого, ведемо на її
       власний домен — там свій вхід і свої правила кешування. */
    if (SHOP_HOSTS.includes(host) && path.startsWith(BASE + '/admin')) {
      const to = new URL(url);
      to.hostname = 'admin.' + host.replace(/^www\./, '');
      to.pathname = path.slice((BASE + '/admin').length) || '/';
      return Response.redirect(to.toString(), 307);
    }

    return nextWorker.fetch(request, env, ctx);
  }
};
