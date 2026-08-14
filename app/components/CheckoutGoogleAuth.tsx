'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { useLang } from './LangProvider';
import { useToast } from './Toasts';
import * as fb from '@/lib/firebase';

/* Швидкий акаунт прямо в оформленні. Це не окремий крок і не
   умова покупки: гість може продовжити без входу, а Google лише
   привʼязує поточне замовлення до кабінету. Попап не перезавантажує
   сторінку, тому вже введені одержувач і адреса не губляться. */
export default function CheckoutGoogleAuth({ onUser }: { onUser(user: User): void }) {
  const { t } = useLang();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function google() {
    setBusy(true);
    try {
      const user = await fb.loginGoogle();
      /* null тут означає redirect: сторінка вже переходить до
         Google, а стан після повернення підхопить watchAuth. */
      if (!user) return;
      onUser(user);
      toast(t('co.authSuccess'), 'success');
    } catch (err) {
      toast(fb.authError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="checkout-auth" aria-labelledby="checkout-auth-title">
      <div className="checkout-auth__copy">
        <strong id="checkout-auth-title" className="checkout-auth__title">
          {t('co.authTitle')}
        </strong>
        <p className="checkout-auth__note">{t('co.authNote')}</p>
      </div>

      <button
        className="btn btn--ghost auth-google checkout-auth__button"
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void google()}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <path
            fill="#EA4335"
            d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.7 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.9 6.2C12.3 13.6 17.7 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"
          />
          <path
            fill="#FBBC05"
            d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.8l7.9-6.2z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.7-6c-2.1 1.4-4.7 2.3-7.5 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z"
          />
        </svg>
        <span>{t(busy ? 'co.authBusy' : 'co.authGoogle')}</span>
      </button>
    </aside>
  );
}
