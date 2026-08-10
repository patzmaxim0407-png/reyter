import ProductModal from '@/components/ProductModal';
import ProductView, { productParams } from '@/views/ProductView';

export const revalidate = 60;
export const generateStaticParams = productParams;

export default async function ProductModalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductModal lang="uk"><ProductView id={id} lang="uk" modal /></ProductModal>;
}
