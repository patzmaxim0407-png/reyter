'use client';

import { fmt } from '@/lib/catalog';
import type { Product } from '@/lib/types';

/* Обраний товар у полі пошуку: фото, назва, артикул і ціна.

   Це не прикраса. У каталозі є позиції з майже однаковими
   назвами — «Бріфи classic» і «Бріфи classic Black», — і за самим
   рядком у полі не видно, що саме обрано. Фото й артикул знімають
   питання одразу.

   Розмітка й класи ті самі, що в productChipHTML старої панелі. */

export default function ProductChip({ p }: { p: Product }) {
  return (
    <span className="a-pick__chip">
      <img
        src={p.images?.[0] ?? ''}
        alt=""
        width={34}
        height={44}
        loading="lazy"
        decoding="async"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
        }}
      />
      <span>
        <b>{p.name}</b>
        <i>
          {p.id} · {fmt(p.price)} грн
        </i>
      </span>
    </span>
  );
}
