import type { Metadata } from 'next';
import TrackForm from '@/components/TrackForm';

export const metadata: Metadata = { title: 'Track your order', description: 'Check your REYTER order status by order number and phone.', alternates: { canonical: '/en/track', languages: { uk: '/track', en: '/en/track' } } };
export default async function TrackPageEn({ searchParams }: { searchParams: Promise<{ num?: string }> }) {
  const { num } = await searchParams;
  return <div className="container account-page"><h1 className="section-title">Track your order</h1><p className="account-note">Enter your order number and the phone used at checkout to see its current status.</p><TrackForm divider={false} initialNum={num ?? ''} /></div>;
}
