import HomeView from '@/views/HomeView';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Men’s underwear by a Ukrainian brand',
  description: 'Shop comfortable men’s underwear by Ukrainian brand REYTER. Delivery in Ukraine and worldwide.',
  alternates: { canonical: '/en', languages: { uk: '/', en: '/en', 'x-default': '/' } },
  openGraph: { title: 'REYTER — Ukrainian men’s underwear', description: 'Comfort, confidence and personal style.', locale: 'en_US', url: '/en' }
};

export const revalidate = 60;

export default async function HomeEn({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  return <HomeView lang="en" previewDraft={preview === 'draft'} />;
}
