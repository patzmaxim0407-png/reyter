import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      /* Адмінка живе на власному домені й закрита входом. Тут
         /admin лише переадресовує туди, але в індексі йому все
         одно робити нічого. Сам адмінський домен віддає власний
         robots із забороною на все — див. worker-entry.ts. */
      disallow: ['/admin', '/new/admin']
    },
    sitemap: 'https://reyter.men/sitemap.xml'
  };
}
