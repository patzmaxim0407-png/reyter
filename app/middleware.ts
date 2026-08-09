import { NextResponse, type NextRequest } from 'next/server';

/* ============================================================
   REYTER — маршрутизація за доменом
   ------------------------------------------------------------
   Один застосунок на два домени:

     reyter.men        → магазин
     admin.reyter.men  → адмінка з кореня

   Це переписування, а не перенаправлення: адреса в браузері
   лишається adminʼською. Перенаправлення показувало б покупцеві
   /admin у рядку, а закладки на адмінку — стрибали б.

   Зворотне теж потрібне: на адмінському домені сторінкам магазину
   робити нічого, і навпаки — /admin на reyter.men краще віддати
   адмінському домену, ніж тримати дві адреси на одне.
   ============================================================ */

function isAdminHost(host: string): boolean {
  return host.startsWith('admin.');
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const { pathname } = req.nextUrl;

  if (isAdminHost(host)) {
    // усе, що не адмінка, на цьому домені — теж адмінка
    if (pathname === '/' || !pathname.startsWith('/admin')) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin' + (pathname === '/' ? '' : pathname);
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  /* На магазинному домені адмінку не ховаємо зовсім — лише
     ведемо на її власний домен: там свій вхід і свої правила
     кешування. Якщо піддомену немає (локально), лишаємо як є. */
  if (pathname.startsWith('/admin') && host.includes('.') && !host.startsWith('localhost')) {
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
