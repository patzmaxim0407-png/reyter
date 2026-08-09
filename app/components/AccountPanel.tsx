'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import ProfileTab from './ProfileTab';
import PromosTab from './PromosTab';
import OrdersTab from './OrdersTab';
import AuthPanel from './AuthPanel';
import * as fb from '@/lib/firebase';
import type { Catalogue } from '@/lib/catalog';
import { t } from '@/lib/i18n';

/* ============================================================
   Кабінет
   ------------------------------------------------------------
   На старому сайті це була панель збоку. Тут — сторінка з
   вкладками в адресі: посилання на «мої замовлення» тепер можна
   надіслати, а кнопка «назад» повертає туди, звідки прийшли.

   Розмітка й класи ті самі, тож стилі панелі підходять як є.
   ============================================================ */

const TABS = [
  { id: 'profile', title: 'acc.profile' },
  { id: 'promos', title: 'acc.myPromos' },
  { id: 'orders', title: 'acc.orders' }
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AccountPanel({ c }: { c: Catalogue }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const asked = params.get('tab');
  const tab: TabId = TABS.some((x) => x.id === asked) ? (asked as TabId) : 'profile';

  /* undefined — ще не знаємо, чи покупець увійшов. Показувати
     в цю мить форму входу означало б блимнути нею перед тим,
     хто насправді залогінений. */
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => fb.watchAuth(setUser), []);

  const online = !!fb.auth();

  function go(next: TabId) {
    router.replace(next === 'profile' ? pathname : `${pathname}?tab=${next}`, { scroll: false });
  }

  return (
    <div className="container account-page">
      <h1 className="section-title">{t('acc.title')}</h1>

      <div className="drawer__tabs" role="tablist" aria-label={t('acc.title')}>
        {TABS.map((x) => (
          <button
            key={x.id}
            className={'drawer__tab' + (tab === x.id ? ' is-active' : '')}
            role="tab"
            aria-selected={tab === x.id}
            type="button"
            onClick={() => go(x.id)}
          >
            {t(x.title)}
          </button>
        ))}
      </div>

      <div className="drawer__body">
        {user === undefined ? (
          <p className="account-note">{t('acc.loading')}</p>
        ) : /* Без Firebase кабінет працює на локальних даних:
              профіль і замовлення цього браузера. Промокоди —
              ні, вони живуть лише в базі. */
        online && !user && tab !== 'orders' ? (
          tab === 'promos' ? (
            <PromosTab c={c} user={null} />
          ) : (
            <AuthPanel />
          )
        ) : tab === 'profile' ? (
          <ProfileTab user={user} online={online} />
        ) : tab === 'promos' ? (
          <PromosTab c={c} user={user} />
        ) : (
          <OrdersTab c={c} user={user} online={online} />
        )}
      </div>
    </div>
  );
}
