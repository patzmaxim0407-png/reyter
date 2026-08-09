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

   Переписати шлях у middleware не вийде: Next відкидає все, що
   не починається з basePath, ДО того, як middleware спрацює.
   Тому це робиться тут, перед самим Next.

   Переписування, а не перенаправлення: адреса в браузері
   лишається чистою.
   ============================================================ */

const BASE = '/new';

function adminUrl(url: URL): URL {
  const next = new URL(url);
  // '/' → /new/admin, '/orders' → /new/admin/orders
  next.pathname = BASE + '/admin' + (url.pathname === '/' ? '' : url.pathname);
  return next;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    const isAdminHost = url.hostname.startsWith('admin.');

    /* Службові адреси не чіпаємо: під ними лежить статика самого
       Next, і вона однакова для обох доменів. */
    const passthrough =
      url.pathname.startsWith(BASE) ||
      url.pathname.startsWith('/_next/') ||
      url.pathname === '/favicon.ico';

    if (isAdminHost && !passthrough) {
      return nextWorker.fetch(new Request(adminUrl(url), request), env, ctx);
    }

    return nextWorker.fetch(request, env, ctx);
  }
};
