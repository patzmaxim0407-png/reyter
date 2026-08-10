import type { Metadata } from 'next';
import ProductView, { productMetadata, productParams } from '@/views/ProductView';
import ProductModal from '@/components/ProductModal';
import HomeView from '@/views/HomeView';

/* Значення має бути літералом: Next читає його статично,
   до виконання коду, тож імпортовану константу не бачить. */
export const revalidate = 60;

/* Сторінки всіх товарів будуються наперед — покупець отримує
   готовий HTML одразу, без очікування бази. Нові товари, яких на
   момент збірки ще не було, зрендеряться на першому запиті. */
export const generateStaticParams = productParams;

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return productMetadata(id, 'uk');
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <><HomeView lang="uk" /><ProductModal lang="uk"><ProductView id={id} lang="uk" modal /></ProductModal></>;
}
