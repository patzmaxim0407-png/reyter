import type { Metadata } from 'next';
import ThanksView from '@/views/ThanksView';

export const metadata: Metadata = { title: 'Замовлення прийнято', robots: { index: false, follow: false } };
export default async function ThanksPage({ searchParams }: { searchParams: Promise<{ num?: string; mail?: string }> }) {
  const { num, mail } = await searchParams;
  return <ThanksView num={num} mail={mail} lang="uk" />;
}
