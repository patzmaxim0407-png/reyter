import type { NextConfig } from 'next';

/* ============================================================
   REYTER — збірка
   ------------------------------------------------------------
   Firebase у нас працює ЛИШЕ в браузері: на сервері сторінки
   читають каталог звичайним REST-запитом (lib/firestore.ts), а
   всі виклики SDK стоять за перевіркою `typeof window`.

   Але імпорти обчислюються при завантаженні модуля, і серверна
   збірка тягнула Node-варіант @firebase/firestore — а він при
   старті будує protobuf через new Function. У Cloudflare Workers
   генерація коду з рядків заборонена, і сторінка падала з
   EvalError ще до першого рядка нашого коду.

   Тому в обох збірках беремо браузерний варіант: на сервері він
   усе одно не виконується, зате нічого не генерує на старті.
   ============================================================ */

const firebaseBrowserBuilds = {
  '@firebase/firestore': './node_modules/@firebase/firestore/dist/index.esm.js',
  '@firebase/auth': './node_modules/@firebase/auth/dist/esm/index.js',
  '@firebase/storage': './node_modules/@firebase/storage/dist/index.esm.js'
};

const nextConfig: NextConfig = {
  /* Магазин живе на шляху /new: у корені reyter.men лишається
     попередній сайт, і поки він там, новий не може займати
     кореневі адреси — інакше вони зіткнулися б. */
  basePath: '/new',
  turbopack: {
    resolveAlias: firebaseBrowserBuilds
  }
};

export default nextConfig;
