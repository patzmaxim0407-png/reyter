'use client';

import { useEffect, useState } from 'react';
import { useLang } from './LangProvider';
import type { User } from 'firebase/auth';
import AddressBook from './AddressBook';
import { useToast } from './Toasts';
import * as cart from '@/lib/cart';
import * as fb from '@/lib/firebase';

/* Профіль: імʼя й телефон. Адреси живуть в окремій книзі —
   у покупця їх зазвичай кілька, і в одному полі вони не тримались. */

export default function ProfileTab({ user, online }: { user: User | null; online: boolean }) {
  const { t } = useLang();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const toast = useToast();

  useEffect(() => {
    const local = cart.getProfile();
    setName(String(local.name || ''));
    setPhone(String(local.phone || ''));

    /* Хмарний профіль важливіший за локальний: покупець міг
       заповнити його з іншого пристрою. Зливаємо, а не
       підміняємо — у локальному лежить ще й адресна книга. */
    if (!user) return;
    let alive = true;
    void fb.loadCloudProfile(user.uid).then((cloud) => {
      if (!alive || !cloud) return;
      const merged = { ...cart.getProfile(), ...cloud };
      cart.saveProfile(merged);
      setName(String(merged.name || ''));
      setPhone(String(merged.phone || ''));
    });
    return () => {
      alive = false;
    };
  }, [user]);

  function save() {
    const profile = { ...cart.getProfile(), name: name.trim(), phone: phone.trim() };
    cart.saveProfile(profile);
    if (user) void fb.saveCloudProfile(user.uid, user.email ?? '', profile);
    toast(t('acc.saved'), 'success');
  }

  return (
    <>
      {user ? (
        <div className="auth-user">
          <div className="auth-user__avatar">{(user.email || 'R')[0].toUpperCase()}</div>
          <div className="auth-user__info">
            <b>{user.displayName || t('acc.yourAccount')}</b>
            <span>{user.email || ''}</span>
          </div>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={() => {
              void fb.logout();
              toast(t('acc.loggedOut'));
            }}
          >
            {t('acc.logout')}
          </button>
        </div>
      ) : null}

      <p className="account-note">{t(online ? 'acc.profileNote' : 'acc.profileNoteLocal')}</p>

      <form
        className="form-grid"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="field">
          <label htmlFor="prName">{t('acc.name')}</label>
          <input
            id="prName"
            autoComplete="name"
            placeholder={t('acc.namePh')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="prPhone">{t('acc.phone')}</label>
          <input
            id="prPhone"
            type="tel"
            autoComplete="tel"
            placeholder="+380..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <button className="btn btn--primary" type="submit">
          {t('acc.save')}
        </button>
      </form>

      <AddressBook />
    </>
  );
}
