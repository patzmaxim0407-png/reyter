import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Адмінка живе на власному домені й закрита входом,
      // але хай і за старою адресою не потрапляє в індекс
      disallow: ['/admin']
    },
    sitemap: 'https://reyter.men/new/sitemap.xml'
  };
}
