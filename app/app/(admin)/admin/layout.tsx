import type { Metadata } from 'next';
import '../../../styles/admin.css';
import AdminGate from '@/components/admin/AdminGate';
import AskProvider from '@/components/admin/AskProvider';

/* Адмінка — не частина сайту для покупця: ні шапки, ні кошика,
   ні каталогу в розмітці. Усе, що всередині, рендериться лише
   після підтвердження прав. */
export const metadata: Metadata = {
  title: 'REYTER · Адмінка',
  robots: { index: false, follow: false, nocache: true }
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGate>
      <AskProvider>
        <div className="admin-body">{children}</div>
      </AskProvider>
    </AdminGate>
  );
}
