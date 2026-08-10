import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import kvIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache';
import { withRegionalCache } from '@opennextjs/cloudflare/overrides/incremental-cache/regional-cache';
import memoryQueue from '@opennextjs/cloudflare/overrides/queue/memory-queue';

/* ============================================================
   REYTER — кеш сторінок на Cloudflare
   ------------------------------------------------------------
   Без цього сховища у воркера немає кешу взагалі: кожен запит
   рендерився наново, а рендер каталогу — це два читання
   Firestore. Сторінка товару віддавалася за півтори-дві секунди,
   і саме стільки покупець чекав, поки відкриється картка.

   Два рівні:
   • KV — спільний для всіх дата-центрів, переживає перезапуск
     воркера; сюди лягає зрендерена сторінка;
   • Cache API поверх нього — той самий дата-центр більше не
     ходить у KV по те, що вже брав.

   Кеш саме такий, що вміє оновлюватись: сторінки живуть із
   revalidate, і публікація з адмінки має доходити до покупця
   сама, без перезбірки сайту.
   ============================================================ */

export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(kvIncrementalCache, { mode: 'long-lived' }),

  /* Черга перебудови. Без неї сторінка, у якої минув строк
     свіжості, перемальовується просто в запиті — тобто рівно тоді,
     коли хтось її відкрив, і саме він на це чекає. З чергою
     покупцеві віддається те, що вже лежить у кеші, а оновлення
     йде окремо, після відповіді. */
  queue: memoryQueue,

  /* Готову сторінку віддаємо з кешу, не піднімаючи сервер Next.
     Позначено «небезпечним» через middleware й перезаписи, яких
     у нас немає: маршрутизація за доменом живе у worker-entry.ts
     і відпрацьовує ще до Next. */
  enableCacheInterception: true
});
