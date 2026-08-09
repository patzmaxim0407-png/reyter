'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { User } from 'firebase/auth';
import * as fb from '@/lib/firebase';

/* Верхня панель адмінки. Розмітка й класи ті самі, що в
   admin.html, тож admin.css підходить без правок.

   На старому сайті розділи були якорями (#/catalog) — тут це
   справжні адреси: кожен розділ можна відкрити в новій вкладці,
   а «назад» працює. */

/** Магазин живе на шляху /new, поки в корені попередній сайт. */
export const SHOP_URL = 'https://reyter.men/new';

const TABS = [
  { href: '/admin', title: 'Каталог' },
  { href: '/admin/orders', title: 'Замовлення' },
  { href: '/admin/stock', title: 'Склад' },
  { href: '/admin/promos', title: 'Промокоди' }
];

export default function AdminBar({
  user,
  hasDraft,
  onPublish,
  onSettings
}: {
  user: User;
  /** Є неопубліковані зміни або запланована публікація. */
  hasDraft?: boolean;
  onPublish?: () => void;
  onSettings?: () => void;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="abar">
      <div className="abar__brand">
        <img src="https://reyter.men/assets/images/logo_4.webp" alt="" />
        <span>
          REYTER <b>· Адмінка</b>
        </span>
      </div>

      <nav className="abar__nav" aria-label="Розділи адмінки">
        {TABS.map((x) => (
          <Link
            key={x.href}
            className={'abar__tab' + (path === x.href ? ' is-active' : '')}
            href={x.href}
          >
            {x.title}
          </Link>
        ))}
      </nav>

      <div className="abar__actions">
        <button
          className={'abar__more' + (hasDraft ? ' has-draft' : '')}
          type="button"
          aria-expanded={open}
          aria-haspopup="true"
          aria-label="Ще дії"
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>

        <div className="abar__drop" hidden={!open}>
          <span className="abar__user">{user.email}</span>
          {/* Абсолютне посилання: на адмінському домені корінь —
              це сама адмінка, і відносне вело б у нікуди */}
          <a className="btn btn--ghost btn--sm" href={SHOP_URL} target="_blank" rel="noopener">
            Сайт
          </a>
          {onSettings ? (
            <button className="btn btn--ghost btn--sm" type="button" onClick={onSettings}>
              Налаштування
            </button>
          ) : null}
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => void fb.logout()}>
            Вийти
          </button>
          {onPublish ? (
            <button className="btn btn--primary btn--sm" type="button" onClick={onPublish}>
              Опублікувати{' '}
              {/* Крапка зʼявляється лише коли є що публікувати —
                  інакше вона нічого не означала б */}
              {hasDraft ? <span className="abar__count">●</span> : null}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
