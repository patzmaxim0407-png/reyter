import { NextResponse, type NextRequest } from 'next/server';

/* ============================================================
   REYTER — маршрутизація за доменом
   ------------------------------------------------------------
   Адмінка має власний домен, і на магазинному їй робити нічого:
   ведемо туди, де в неї свій вхід.

   Саме переписування шляху для admin.* робить не цей файл, а
   worker-entry.ts: застосунок зібраний із basePath, а Next
   відкидає все, що не починається з нього, ДО middleware.
   ============================================================ */

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const { pathname } = req.nextUrl;

  // на адмінському домені все вже переписано входом воркера
  if (host.startsWith('admin.')) return NextResponse.next();

  /* Локально піддомену немає — там адмінка лишається на
     тому самому хості, інакше перевіряти її було б ніде. */
  const canRedirect = host.includes('.') && !host.startsWith('localhost');

  if (pathname.startsWith('/admin') && canRedirect) {
    const url = req.nextUrl.clone();
    url.host = 'admin.' + host.replace(/^www\./, '');
    url.pathname = pathname.replace(/^\/admin/, '') || '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /* Статику й службові адреси не чіпаємо: середній шар на кожній
     картинці — це зайва робота на кожен запит. */
  matcher: ['/((?!_next/|assets/|favicon.ico|robots.txt|sitemap.xml).*)']
};
