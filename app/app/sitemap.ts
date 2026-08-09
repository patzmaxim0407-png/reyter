import type { MetadataRoute } from 'next';
import { loadCatalog } from '@/lib/firestore';

/* Карта сайту будується з опублікованого каталогу, а не пишеться
   руками: доки вона була статичним файлом, у ній лишався старий
   домен reyter.store і жодного товару. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { products, categories } = await loadCatalog();
  const base = 'https://reyter.men';

  const items = products
    .filter((p) => !p.hidden)
    .map((p) => ({
      url: `${base}/p/${encodeURIComponent(p.id)}`,
      changeFrequency: 'weekly' as const,
      priority: 0.8
    }));

  return [
    { url: base, changeFrequency: 'daily', priority: 1 },
    // Категорії — це якорі на головній, окремих сторінок у них немає
    ...categories.map((c) => ({
      url: `${base}/#cat-${c.id}`,
      changeFrequency: 'weekly' as const,
      priority: 0.5
    })),
    ...items
  ];
}
