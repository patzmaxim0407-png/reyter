'use client';

import { useState } from 'react';
import * as fb from '@/lib/firebase';
import { useToast } from './Toasts';
import { t } from '@/lib/i18n';

/* Вхід і реєстрація. Розмітка й класи ті самі, що в account.js.

   Google стоїть першим навмисно: більшість покупців заходить
   саме ним, а пароль — це ще одне, що треба памʼятати. */

export default function AuthPanel({ note = true }: { note?: boolean }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const isLogin = mode === 'login';

  async function submit() {
    if (!email.trim() || !pass) {
      toast(t('acc.enterEmailPass'));
      return;
    }
    setBusy(true);
    try {
      if (isLogin) await fb.loginEmail(email.trim(), pass);
      else await fb.registerEmail(email.trim(), pass);
      toast(isLogin ? t('acc.welcome') : t('acc.created'), 'success');
    } catch (err) {
      toast(fb.authError(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    try {
      const user = await fb.loginGoogle();
      // null означає перенаправлення: сторінка зараз перезавантажиться,
      // і вітати покупця ще нема з чим
      if (user) toast(t('acc.welcome'), 'success');
    } catch (err) {
      toast(fb.authError(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!email.trim()) {
      toast(t('acc.enterEmailFirst'));
      return;
    }
    try {
      await fb.resetPassword(email.trim());
      toast(t('acc.resetSent'), 'success');
    } catch (err) {
      toast(fb.authError(err));
    }
  }

  return (
    <>
      {note ? <p className="account-note">{t('acc.authNote')}</p> : null}

      <button className="btn btn--ghost auth-google" type="button" disabled={busy} onClick={google}>
        <svg width="18" height="18" viewBox="0 0 48 48">
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
        </svg>{' '}
        {t('acc.google')}
      </button>

      <div className="auth-divider">
        <span>{t('acc.orEmail')}</span>
      </div>

      <form
        className="form-grid"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="auEmail">Email</label>
          <input
            id="auEmail"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="auPass">{t('acc.password')}</label>
          <input
            id="auPass"
            type="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            placeholder={t('acc.passwordPh')}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {isLogin ? t('acc.login') : t('acc.register')}
        </button>
      </form>

      <div className="auth-links">
        {isLogin ? (
          <>
            <button type="button" onClick={() => setMode('register')}>
              {t('acc.noAccount')} <b>{t('acc.register')}</b>
            </button>
            <button type="button" onClick={() => void reset()}>
              {t('acc.forgot')}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setMode('login')}>
            {t('acc.hasAccount')} <b>{t('acc.login')}</b>
          </button>
        )}
      </div>
    </>
  );
}
