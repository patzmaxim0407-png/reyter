import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Замовлення прийнято',
  robots: { index: false, follow: false }
};

export default async function ThanksPage({
  searchParams
}: {
  searchParams: Promise<{ num?: string; mail?: string }>;
}) {
  const { num, mail } = await searchParams;

  return (
    <div className="container">
      <div className="order-done">
        <div className="order-done__icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m4.5 12.5 5 5 10-11" />
          </svg>
        </div>

        <h1>
          {t('cart.order')}
          {num ? ` №${num} ` : ' '}
          {t('cart.doneTitle')}
        </h1>
        <p>{t('cart.doneText')}</p>

        {mail ? (
          <p>
            {t('cart.doneMail')} <b>{mail}</b> 📩
          </p>
        ) : null}

        {/* Гість не має історії в кабінеті — підказуємо, як стежити.
            Номер підставляємо в посилання: переписувати його руками
            з екрана — саме те місце, де люди помиляються. */}
        <p className="order-done__track">
          {t('cart.trackNote')}{' '}
          <Link href={num ? `/track?num=${encodeURIComponent(num)}` : '/track'}>
            {t('trk.find')}
          </Link>
        </p>

        <Link className="btn btn--primary" href="/account?tab=orders">
          {t('cart.myOrders')}
        </Link>
        <Link className="btn btn--ghost" href="/#catalog">
          {t('cart.keepShopping')}
        </Link>
      </div>
    </div>
  );
}
