import type { Metadata } from 'next';
import { Suspense } from 'react';
import AccountPanel from '@/components/AccountPanel';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { cartCatalogue } from '@/lib/catalog';

/* Кабінет приватний за змістом — у пошуку йому нема чого робити. */
export const metadata: Metadata = {
  title: 'Кабінет',
  robots: { index: false, follow: false }
};

export default async function AccountPage() {
  /* Каталог потрібен двом вкладкам: повторити замовлення й
     показати умови персонального промокоду людською мовою. */
  const [catalog, stock] = await Promise.all([loadCatalog(), loadStock()]);
  const c = cartCatalogue(catalog.products, stock, catalog.categories, catalog.freeFrom);

  return (
    /* Вкладка живе в адресі, а useSearchParams вимагає межі
       очікування — інакше вся сторінка стала б динамічною. */
    <Suspense fallback={null}>
      <AccountPanel c={c} />
    </Suspense>
  );
}
