'use client';

import { useEffect, useState } from 'react';
import ProductCard from './ProductCard';
import { useCart } from './CartProvider';
import { useLang } from './LangProvider';
import * as fb from '@/lib/firebase';
import { friendlyProducts } from '@/lib/catalog';
import { cachedMember, inClub, readMember, rememberMember, type MemberDoc } from '@/lib/admin/loyalty-db';

/* ============================================================
   Полиця Friendly Club
   ------------------------------------------------------------
   Товари, яких немає у відкритому каталозі. Малює їх БРАУЗЕР
   учасника, і це не примха, а єдиний доступний спосіб.

   Вітрина в нас статична й спільна: сторінку рендерять раз на
   всіх і роздають із кеша. Сервер не знає, хто її відкрив, — тож
   «показати лише учасникам» на сервері означало б або показати
   всім, або нікому. Ми показуємо нікому, а потім браузер, який
   уже знає свого користувача, домальовує полицю.

   Дані для карток беруться з каталогу, що й так їде в кожну
   сторінку для кошика, — тож зайвого запиту немає.

   ЧЕСНО ПРО МЕЖУ ЦІЄЇ ЗАКРИТОСТІ. Опублікований каталог
   читається публічно: так зроблено, щоб сайт відкривався швидко
   й без входу. Товар зникає з очей, але лишається в тих даних —
   його знайде той, хто вміє дивитись у мережеві запити браузера.
   Для раннього доступу цього досить; для таємниці — ні, і тоді
   закриті товари довелося б публікувати окремим документом із
   правами доступу, до якого вміє ходити ще й воркер оплати.
   ============================================================ */

export default function FriendlyShelf() {
  const { c } = useCart();
  const { t, lang } = useLang();
  const [member, setMember] = useState<MemberDoc | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const off = fb.watchAuth((user) => {
      if (!alive) return;
      if (!user?.email) {
        setMember(null);
        return;
      }
      /* Спершу памʼять браузера, щоб полиця не блимала на кожному
         оновленні, потім база — вона й вирішує. */
      const known = cachedMember(user.email);
      if (known) setMember(known);

      const d = fb.db();
      if (!d) return;
      void readMember(d, user.email, new Date()).then((m) => {
        if (!alive) return;
        setMember(m);
        rememberMember(m);
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!inClub(member ?? null)) return null;

  const list = friendlyProducts(c);
  if (!list.length) return null;

  return (
    <section className="fshelf" id="friendly-shelf">
      <div className="container">
        <div className="fshelf__head">
          <h2>{t('fc.shelf')}</h2>
          <p>{t('fc.shelfNote')}</p>
        </div>
        <div className="pgrid">
          {list.map((p) => (
            /* Позначку малюємо обгорткою, а не всередині картки:
               картка спільна з рештою каталогу, і додавати їй
               знання про клуб заради одного місця не варто. */
            <div className="fshelf__item" key={p.id}>
              <span className="fshelf__mark">Friendly</span>
              <ProductCard p={p} c={c} lang={lang} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
