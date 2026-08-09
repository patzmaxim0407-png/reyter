import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Замовлення прийнято',
  robots: { index: false, follow: false }
};

export default async function ThanksPage({
  searchParams
}: {
  searchParams: Promise<{ num?: string }>;
}) {
  const { num } = await searchParams;

  return (
    <div className="container checkout-done">
      <h1>Дякуємо за замовлення!</h1>
      {num ? (
        <p className="checkout-done__num">
          Номер замовлення: <b>{num}</b>
        </p>
      ) : null}
      <p>
        Ми звʼяжемося з вами найближчим часом, щоб підтвердити деталі.
        Якщо ви вказали пошту — підтвердження вже летить туди.
      </p>
      <Link className="btn btn--primary" href="/#catalog">
        Повернутись до каталогу
      </Link>
    </div>
  );
}
