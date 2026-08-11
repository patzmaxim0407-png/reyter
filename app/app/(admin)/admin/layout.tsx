import type { Metadata } from 'next';
import '../../../styles/admin.css';
import AdminGate from '@/components/admin/AdminGate';
import AskProvider from '@/components/admin/AskProvider';
import LangProvider from '@/components/LangProvider';
import Toasts from '@/components/Toasts';
import ChunkGuard from '@/components/ChunkGuard';

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
      {/* LangProvider тут не заради перекладу — адмінка лише
          українською. Але пошук міста й вибір товару спільні з
          магазином, а вони питають мову й падають без неї: саме
          через це не відкривалося ручне замовлення й прихід.

          Toasts — щоб «Збережено», «Немає прав» тощо було видно:
          без обгортки підказки мовчки зникали. */}
      <LangProvider>
        <ChunkGuard />
        <Toasts>
          <AskProvider>
            <div className="admin-body">{children}</div>
          </AskProvider>
        </Toasts>
      </LangProvider>
    </AdminGate>
  );
}
