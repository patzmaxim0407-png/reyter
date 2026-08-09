import type { Metadata } from 'next';
import CheckoutForm from '@/components/CheckoutForm';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false }
};

export default function CheckoutPageEn() {
  return (
    <div className="container">
      <CheckoutForm />
    </div>
  );
}
