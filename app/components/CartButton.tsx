'use client';

import { useCart } from './CartProvider';
import { t } from '@/lib/i18n';

/* Кнопка кошика в шапці. До гідратації лічильник схований:
   сервер про вміст кошика не знає, і будь-яке число тут
   розійшлося б із розміткою. */
export default function CartButton() {
  const { count, open } = useCart();

  return (
    <button className="hbtn" type="button" aria-label={t('nav.cart')} aria-haspopup="dialog" onClick={open}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 8h12l-1 13H7L6 8Z" />
        <path d="M9 10V6a3 3 0 0 1 6 0v4" />
      </svg>
      <span className="cart-count" hidden={!count}>
        {count}
      </span>
    </button>
  );
}
