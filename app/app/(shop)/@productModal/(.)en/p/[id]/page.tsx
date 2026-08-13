import ProductModal from '@/components/ProductModal';
import ProductView, { productParams } from '@/views/ProductView';

export const revalidate = 300;
export const generateStaticParams = productParams;

export default async function ProductModalPageEn({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductModal lang="en" selfPath={`/en/p/${id}`}><ProductView id={id} lang="en" modal /></ProductModal>;
}
