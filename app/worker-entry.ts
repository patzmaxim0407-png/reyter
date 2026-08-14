import nextWorker from './.open-next/worker.js';

/* ============================================================
   REYTER — вхід у воркер
   ------------------------------------------------------------
   Тут вирішується, яка адреса що означає. Правил рівно три, і
   кожне з них — відповідь на конкретну потребу.

   1. МАГАЗИН ЖИВЕ В КОРЕНІ reyter.men.
      Півроку він стояв на /new, поки корінь займав попередній
      сайт. 14.08.2026 новий сайт замінив старий і забрав корінь
      собі.

   2. СТАРІ АДРЕСИ /new/* ВЕДУТЬ НА НОВІ — назавжди.
      На них посилаються листи покупцям, пошукова видача і, що
      найдорожче, вже виставлені рахунки Monobank: у кожному
      лежить redirectUrl на /new/thanks, і людина повернеться
      саме туди. Тому це не тимчасовий місток, а постійна
      переадресація, яку не можна прибрати «колись потім».

   3. НА admin.reyter.men АДМІНКА ВІДКРИВАЄТЬСЯ З КОРЕНЯ.
      Замовлення — це admin.reyter.men/orders, а не
      admin.reyter.men/new/admin/orders. Всередині застосунку
      сторінки лежать під /admin, і цей шлях сюди дописуємо ми —
      мовчки, не показуючи його в адресному рядку.

   Уся маршрутизація за доменом живе саме тут, а не в middleware,
   з двох причин:

   • Next відкидає все, що не належить застосунку, ДО того, як
     middleware спрацює — переписати шлях звідти вже пізно;
   • middleware отримує хост не тим, яким його надіслав браузер:
     запит до нього доходить уже перезібраним, і на всіх доменах
     він виглядав однаково.

   Тут хост беремо із заголовка — він єдиний, кому можна вірити
   і в Cloudflare, і в локальному запуску.
   ============================================================ */

/** Де магазин стояв раніше. Порожньо — він у корені. */
const WAS = '/new';

/** Під яким шляхом лежить адмінка всередині застосунку. */
const ADMIN = '/admin';

/** Домени магазину. Перелік, а не здогадка за формою імені:
 *  на технічній адресі workers.dev і локально перенаправляти
 *  нікуди — адмінка там живе на тому самому хості. */
const SHOP_HOSTS = ['reyter.men', 'www.reyter.men'];

function hostOf(request: Request): string {
  const raw = request.headers.get('host') ?? new URL(request.url).host;
  return raw.split(':')[0].toLowerCase();
}

/** Чи належить шлях старому місцю магазину. Порівнюємо цілим
 *  сегментом, а не початком рядка: інакше під переадресацію
 *  потрапили б і /newsletter, і товар з артикулом, що починається
 *  з тих самих літер. */
function wasHere(path: string): boolean {
  return path === WAS || path.startsWith(WAS + '/');
}

function afterWas(path: string): string {
  return path.slice(WAS.length) || '/';
}

/** Файл, а не сторінка застосунку: статика Next, картинки,
 *  договори в PDF, карта сайту. На адмінському домені їх треба
 *  віддати як є — дописувати їм /admin означало б 404 на кожну
 *  картинку. Ознака проста й надійна: крапка в останньому
 *  сегменті. Сторінок із крапкою в адресі магазин не має. */
function isFile(path: string): boolean {
  if (path.startsWith('/_next/')) return true;
  // мітка збірки: за нею tools/deploy-check.mjs питає живий сайт,
  // чи він оновився. Крапки в імені немає, тож без цього рядка
  // вона поїхала б у /admin/BUILD_ID і перевірка падала б завжди
  if (path === '/BUILD_ID') return true;
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.includes('.');
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

/** Переїзд назавжди. 301, а не 307: пошуковик має переписати
 *  адресу в індексі, інакше стара житиме у видачі роками. */
function moved(url: URL, pathname: string): Response {
  return Response.redirect(withPath(url, pathname).toString(), 301);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    const host = hostOf(request);
    const path = url.pathname;

    /* ---------- Адмінський домен ---------- */
    if (host.startsWith('admin.')) {
      /* Стара адреса адмінки. Її знають закладки менеджерів, і
         вести їх у нікуди не можна: /new/admin/orders → /orders */
      if (wasHere(path)) {
        const rest = afterWas(path);
        const inside = rest === ADMIN || rest.startsWith(ADMIN + '/') ? rest.slice(ADMIN.length) : rest;
        return moved(url, inside || '/');
      }

      /* Пошуковим роботам на адмінському домені робити нічого.
         Стоїть ПЕРЕД перевіркою на файл: у robots.txt є крапка,
         і як файл він проїхав би до застосунку, а той віддав би
         robots магазину з «Allow: /» — тобто адмінка вперше сама
         запросила б себе обійти. Доти цього не траплялося: шлях
         переписувався в /new/admin/robots.txt і давав 404. */
      if (path === '/robots.txt') {
        return new Response('User-agent: *\nDisallow: /\n', {
          headers: { 'content-type': 'text/plain; charset=utf-8' }
        });
      }

      // статика й файли — як є, без /admin
      if (isFile(path)) {
        return freshDocument(await nextWorker.fetch(request, env, ctx));
      }

      /* Довгий шлях пропускаємо як є — переадресовувати його не
         можна. Всередині адмінки кожен перехід між вкладками й
         кожне передчасне підвантаження — це запит до /admin/… із
         заголовком RSC. Переадресовану таку відповідь Next
         вважає за привід перезавантажити сторінку цілком, і
         адмінка блимала б входом на кожному кліку. */
      if (path === ADMIN || path.startsWith(ADMIN + '/')) {
        return freshDocument(await nextWorker.fetch(request, env, ctx));
      }

      const to = withPath(url, ADMIN + (path === '/' ? '' : path));
      return freshDocument(await nextWorker.fetch(new Request(to, request), env, ctx));
    }

    /* ---------- Магазин ---------- */

    /* www веде на голий домен. Доти воркер його й не бачив —
       маршрут закінчувався на /new*, а корінь віддавав старий
       сайт. Тепер весь домен наш, і без цього правила той самий
       магазин жив би за двома адресами: пошуковик вважав би це
       двома сайтами й ділив би вагу між ними. */
    if (host === 'www.reyter.men') {
      const to = new URL(url);
      to.hostname = 'reyter.men';
      return Response.redirect(to.toString(), 301);
    }

    /* Старе місце магазину. Сюди ж повертаються покупці з банку:
       у виставлених рахунках лежить redirectUrl на /new/thanks. */
    if (wasHere(path)) {
      const rest = afterWas(path);

      /* /new/admin/* — стара адреса адмінки, набрана на
         магазинному домені. Ведемо одразу на адмінський домен: два
         стрибки поспіль браузер переживе, але кожен зайвий — це ще
         одна нагода загубити частину адреси. */
      if (SHOP_HOSTS.includes(host) && (rest === ADMIN || rest.startsWith(ADMIN + '/'))) {
        const to = new URL(url);
        to.hostname = 'admin.' + host.replace(/^www\./, '');
        to.pathname = rest.slice(ADMIN.length) || '/';
        return Response.redirect(to.toString(), 301);
      }

      return moved(url, rest);
    }

    /* Адмінці на магазинному домені робити нічого: ведемо на її
       власний домен — там свій вхід і свої правила кешування. */
    if (SHOP_HOSTS.includes(host) && (path === ADMIN || path.startsWith(ADMIN + '/'))) {
      const to = new URL(url);
      to.hostname = 'admin.' + host.replace(/^www\./, '');
      to.pathname = path.slice(ADMIN.length) || '/';
      return Response.redirect(to.toString(), 307);
    }

    return freshDocument(await nextWorker.fetch(request, env, ctx));
  }
};
