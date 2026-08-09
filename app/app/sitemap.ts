import type { MetadataRoute } from 'next';
import { loadCatalog } from '@/lib/firestore';

/* Карта сайту будується з опублікованого каталогу, а не пишеться
   руками: доки вона була статичним файлом, у ній лишався старий
   домен reyter.store і жодного товару. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { products, categories } = await loadCatalog();
  const base = 'https://reyter.men';

  /* Обидві мови — це різні сторінки з різними адресами, і кожна
     має бути в карті. alternates каже пошуковику, що це та сама
     сторінка іншою мовою, а не дубль. */
  const items = products
    .filter((p) => !p.hidden)
    .flatMap((p) => {
      const path = `/p/${encodeURIComponent(p.id)}`;
      const alternates = { languages: { uk: base + path, en: `${base}/en${path}` } };
      return [
        { url: base + path, changeFrequency: 'weekly' as const, priority: 0.8, alternates },
        { url: `${base}/en${path}`, changeFrequency: 'weekly' as const, priority: 0.6, alternates }
      ];
    });

  const home = { languages: { uk: base, en: `${base}/en` } };

  return [
    { url: base, changeFrequency: 'daily', priority: 1, alternates: home },
    { url: `${base}/en`, changeFrequency: 'daily', priority: 0.8, alternates: home },
    // Категорії — це якорі на головній, окремих сторінок у них немає
    ...categories.map((c) => ({
      url: `${base}/#cat-${c.id}`,
      changeFrequency: 'weekly' as const,
      priority: 0.5
    })),
    ...items
  ];
}
