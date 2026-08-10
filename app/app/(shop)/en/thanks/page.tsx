import type { Metadata } from 'next';
import ThanksView from '@/views/ThanksView';

export const metadata: Metadata = { title: 'Order received', robots: { index: false, follow: false } };
export default async function ThanksPageEn({ searchParams }: { searchParams: Promise<{ num?: string; mail?: string }> }) {
  const { num, mail } = await searchParams;
  return <ThanksView num={num} mail={mail} lang="en" />;
}
