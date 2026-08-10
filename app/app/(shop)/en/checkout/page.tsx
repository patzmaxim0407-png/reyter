import type { Metadata } from 'next';
import CheckoutForm from '@/components/CheckoutForm';
import PageTop from '@/components/PageTop';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false }
};

export default function CheckoutPageEn() {
  return (
    <div className="container">
      <PageTop />
      <CheckoutForm />
    </div>
  );
}
