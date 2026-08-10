import type { Metadata } from 'next';
import CheckoutForm from '@/components/CheckoutForm';
import PageTop from '@/components/PageTop';

/* Сторінка оформлення — приватна за змістом: у пошуку їй нічого
   робити, а прямий перехід сюди з порожнім кошиком показує
   посилання назад у каталог. */
export const metadata: Metadata = {
  title: 'Оформлення замовлення',
  robots: { index: false, follow: false }
};

export default function CheckoutPage() {
  return (
    <div className="container">
      <PageTop />
      <CheckoutForm />
    </div>
  );
}
