'use client';

import { useEffect } from 'react';
import { remember } from '@/lib/attribution';

/* Запамʼятовує джерело візиту й нічого не малює.
 *
 *  Стоїть в оболонці магазину, а не в адмінці: звідки прийшов
 *  менеджер, нікого не цікавить. Працює й у розробці — інакше
 *  перевірити це можна було б лише на живому сайті. */
export default function Attribution() {
  useEffect(() => {
    remember(window.location.href, document.referrer);
  }, []);
  return null;
}
