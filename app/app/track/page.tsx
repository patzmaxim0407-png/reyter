import type { Metadata } from 'next';
import TrackForm from '@/components/TrackForm';

/* Окрема адреса для тих, хто замовляв гостем: посилання на неї
   можна покласти в лист-підтвердження. */
export const metadata: Metadata = {
  title: 'Відстеження замовлення',
  description: 'Перевірити статус замовлення REYTER за номером і телефоном.',
  alternates: { canonical: '/track' }
};

export default async function TrackPage({
  searchParams
}: {
  searchParams: Promise<{ num?: string }>;
}) {
  const { num } = await searchParams;

  return (
    <div className="container account-page">
      <h1 className="section-title">Відстеження замовлення</h1>
      <p className="account-note">
        Введіть номер замовлення й телефон, на який воно оформлене, — і побачите,
        де воно зараз.
      </p>
      <TrackForm divider={false} initialNum={num ?? ''} />
    </div>
  );
}
