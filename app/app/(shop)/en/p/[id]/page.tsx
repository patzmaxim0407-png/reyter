import type { Metadata } from 'next';
import ProductView, { productMetadata, productParams } from '@/views/ProductView';

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
  return productMetadata(id, 'en');
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductView id={id} lang="en" />;
}
