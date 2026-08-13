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
export const revalidate = 300;

/* Без параметрів адреси навмисно: варто сторінці зазирнути в
   searchParams — і Next рендерить її на кожен запит, а це два
   читання Firestore щоразу. Перегляд чернетки живе окремо, на
   /preview: він потрібен лише адміністраторові. */
export default async function Home() {
  return <HomeView lang="uk" />;
}
