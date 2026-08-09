'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import * as fb from '@/lib/firebase';
import { t } from '@/lib/i18n';

/* Кнопка кабінету. Позначку «увійшов» вішаємо лише після
   гідратації: сервер про акаунт не знає, і намальована наперед
   вона блимнула б у того, хто насправді гість. */
export default function AccountButton() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => fb.watchAuth((u) => setAuthed(!!u)), []);

  return (
    <Link
      className={'hbtn' + (authed ? ' hbtn--authed' : '')}
      href="/account"
      aria-label={t('nav.account')}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
      </svg>
    </Link>
  );
}
