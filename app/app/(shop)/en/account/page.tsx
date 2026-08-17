import type { Metadata } from 'next';
import { Suspense } from 'react';
import AccountPanel from '@/components/AccountPanel';
import { loadCatalog, loadStock } from '@/lib/firestore';
import { cartCatalogue } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'Account',
  robots: { index: false, follow: false }
};

export default async function AccountPageEn() {
  const [catalog, stock] = await Promise.all([loadCatalog(), loadStock()]);
  const c = cartCatalogue(catalog.products, stock, catalog.categories, catalog.freeFrom);

  return (
    <Suspense fallback={null}>
      <AccountPanel c={c} />
    </Suspense>
  );
}
