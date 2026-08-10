import HomeView from '@/views/HomeView';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  alternates: { canonical: '/', languages: { uk: '/', en: '/en', 'x-default': '/' } },
  openGraph: { locale: 'uk_UA', url: '/' }
};

/* Каталог рендериться на сервері й перечитується раз на хвилину.
   Так публікація з адмінки доходить до покупця швидко, але база
   не отримує запит на кожен перегляд сторінки. */
/* Значення має бути літералом: Next читає його статично,
   до виконання коду, тож імпортовану константу не бачить. */
export const revalidate = 60;

export default async function Home({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  return <HomeView lang="uk" previewDraft={preview === 'draft'} />;
}
