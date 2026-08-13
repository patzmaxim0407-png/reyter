import type { Metadata } from 'next';
import ProductView, { productMetadata, productParams } from '@/views/ProductView';
import ProductModal from '@/components/ProductModal';
import HomeView from '@/views/HomeView';

/* Значення має бути літералом: Next читає його статично,
   до виконання коду, тож імпортовану константу не бачить. */
export const revalidate = 300;

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
  /* Каталог, а поверх нього картка. Слот @productModal сюди
     не втручається: перехоплення працює лише при переході
     всередині сайту, а це прямий вхід.

     selfPath — щоб картка сама зникла, щойно адреса стане
     чужою. Так буває при зміні кольору: перехоплювач малює
     нову картку, і без цього поверх неї лишалася б ця. */
  return <><HomeView lang="en" /><ProductModal lang="en" selfPath={`/en/p/${id}`}><ProductView id={id} lang="en" modal /></ProductModal></>;
}
