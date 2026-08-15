import LoyaltyAdmin from '@/components/admin/LoyaltyAdmin';

/* Даних із сервера не тягнемо навмисно: усе читає браузер під
   правами того, хто увійшов, — так само, як решта екранів. */
export default function AdminLoyaltyPage() {
  return <LoyaltyAdmin />;
}
