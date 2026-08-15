'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ProductCard from './ProductCard';
import { useCart } from './CartProvider';
import { useLang } from './LangProvider';
import * as fb from '@/lib/firebase';
import { inCategory } from '@/lib/catalog';
import { cachedMember, inClub, readMember, rememberMember, type MemberDoc } from '@/lib/admin/loyalty-db';
import type { Product } from '@/lib/types';

/* ============================================================
   Закриті товари клубу — у своїх категоріях
   ------------------------------------------------------------
   Малює їх БРАУЗЕР учасника, і це не примха, а єдиний доступний
   спосіб. Вітрина в нас статична й спільна: сторінку рендерять
   раз на всіх і роздають із кеша. Сервер не знає, хто її
   відкрив, — тож «показати лише учасникам» на сервері означало б
   або показати всім, або нікому. Ми показуємо нікому, а потім
   браузер, який уже знає свого користувача, домальовує своє.

   МІСЦЕ. Спершу ці товари стояли окремою полицею під підвалом
   сторінки, і це було неправильно двічі: учасник мусив
   прокручувати повз усе, а сам товар випадав із того ряду, де
   його шукають. Тепер картка вставляється прямо в сітку своєї
   категорії — порталом у вузол, який уже намалював сервер. Так
   вітрина лишається статичною й швидкою для всіх, а учасник
   бачить більше в тих самих полицях.

   Категорії, якої немає на сторінці, чекати нема від чого: якщо
   в ній самі лише закриті товари, сервер її не малює зовсім.
   Такі картки збираються в полицю під каталогом — це рідкісний
   випадок, але губити товар не можна.

   ДВІ МЕЖІ, І ОБИДВІ ПОТРІБНІ. Справжня — правила бази: без
   членства документ із цими товарами просто не читається. Друга
   — перевірка тут: доки правила не перечитано або поки триває
   вихід із клубу, показувати чуже все одно не варто. Правила —
   замок, це — ввічливість. Якщо про членство спитати не вдалося,
   віримо базі: вона вже відповіла, віддавши товари.
   ============================================================ */

interface Slot {
  id: string;
  grid: Element;
  items: Product[];
}

export default function FriendlyShelf() {
  const { c } = useCart();
  const { t, lang } = useLang();
  /** Закриті товари. Читаються входом самого покупця — у розмітці
   *  сторінки їх немає, і бути не може. */
  const [list, setList] = useState<Product[]>([]);
  /** undefined — ще не знаємо (або спитати не вдалося). */
  const [member, setMember] = useState<MemberDoc | null | undefined>(undefined);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [rest, setRest] = useState<Product[]>([]);

  useEffect(() => {
    let alive = true;
    const off = fb.watchAuth((user) => {
      if (!alive) return;
      if (!user?.email) {
        setMember(null);
        setList([]);
        return;
      }

      /* Те, що вже знаємо про цього покупця, — щоб не блимало
         порожнім місцем на кожному оновленні сторінки. */
      const known = cachedMember(user.email);
      if (known) setMember(known);

      const d = fb.db();
      if (d) {
        void readMember(d, user.email, new Date())
          .then((m) => {
            if (!alive) return;
            setMember(m);
            rememberMember(m);
          })
          .catch(() => {
            /* Не змогли спитати — не привід ховати: доступ уже
               підтвердила сама база. */
            if (alive) setMember(undefined);
          });
      }

      /* Питаємо базу, а не звіряємось із рівнем у себе: чи
         пускати — вирішують правила, і вони знають і про ручний
         клуб, і про змінену драбину. Відмова приходить порожнім
         переліком, і це правильна відповідь, а не помилка. */
      void fb.loadFriendlyProducts().then((rows) => {
        if (alive) setList(rows);
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  /** Точно знаємо, що ця людина вже не в клубі. */
  const barred = member !== undefined && !inClub(member);
  const cats = c.categories || [];
  const catIds = cats.map((cat) => cat.id).join(',');

  /* Шукаємо сітки категорій у вже намальованій сторінці. Окремим
     проходом, бо на сервері цих вузлів не існує, а портал вимагає
     справжній вузол — не селектор. */
  useEffect(() => {
    if (!list.length || barred) {
      setSlots([]);
      setRest([]);
      return;
    }

    const found: Slot[] = [];
    const late: Product[] = [];
    const placed = new Set<string>();
    /** Лічильники в заголовках категорій рахує сервер, і про ці
     *  картки він не знає. Підправляємо число й повертаємо його
     *  назад, коли полиця зникає, — щоб слід не лишався. */
    const counts: Array<[Element, string]> = [];

    for (const cat of cats) {
      const mine = list.filter((p) => inCategory(p, cat.id));
      if (!mine.length) continue;

      const grid = document.querySelector(`#cat-${CSS.escape(cat.id)} .pgrid`);
      if (!grid) continue; // категорії немає на сторінці — заберемо нижче

      found.push({ id: cat.id, grid, items: mine });
      mine.forEach((p) => placed.add(p.id));

      const num = grid.parentElement?.querySelector('.category__count');
      if (num) {
        const was = num.textContent || '';
        counts.push([num, was]);
        num.textContent = String((parseInt(was, 10) || 0) + mine.length);
      }
    }

    for (const p of list) if (!placed.has(p.id)) late.push(p);

    setSlots(found);
    setRest(late);

    return () => {
      for (const [node, was] of counts) node.textContent = was;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, barred, catIds]);

  if (barred || (!slots.length && !rest.length)) return null;

  return (
    <>
      {slots.map((s) =>
        createPortal(
          <>
            {s.items.map((p) => (
              /* Позначку малює сама картка: тепер вона буває й у
                 відкритому каталозі, тож місце в неї одне. */
              <ProductCard key={p.id} p={p} c={c} lang={lang} />
            ))}
          </>,
          s.grid,
          'fc-' + s.id
        )
      )}

      {rest.length ? (
        <section className="fshelf" id="friendly-shelf">
          <div className="container">
            <div className="fshelf__head">
              <h2>{t('fc.shelf')}</h2>
              <p>{t('fc.shelfNote')}</p>
            </div>
            <div className="pgrid">
              {rest.map((p) => (
                <ProductCard key={p.id} p={p} c={c} lang={lang} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
