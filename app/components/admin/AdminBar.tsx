'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import * as fb from '@/lib/firebase';

/* Верхня панель адмінки. Розмітка й класи ті самі, що в
   admin.html, тож admin.css підходить без правок.

   На старому сайті розділи були якорями (#/catalog) — тут це
   справжні адреси: кожен розділ можна відкрити в новій вкладці,
   а «назад» працює. */

/** Магазин живе в корені домену. */
export const SHOP_URL = 'https://reyter.men';

/* Адреси розділів — короткі, які бачить менеджер:
   admin.reyter.men/orders. Усередині застосунку ці сторінки
   лежать під /admin, і той шлях дописує воркер (worker-entry.ts),
   не показуючи його в адресному рядку.

   Саме href задає адресу після кліку, тому коротким він має бути
   тут, а не десь у переадресації. Переадресовувати /admin/* на
   короткий шлях не можна зовсім: перехід між вкладками — це запит
   із заголовком RSC, і переадресовану відповідь Next вважає за
   привід перезавантажити сторінку цілком. */
const TABS = [
  { href: '/', title: 'Каталог' },
  { href: '/orders', title: 'Замовлення' },
  { href: '/stock', title: 'Склад' },
  { href: '/promos', title: 'Промокоди' },
  /* Коротко навмисно. Нижня панель на телефоні — це сітка з
     однаковими колонками, і при пʼятьох розділах слово
     «Лояльність» у неї не вміщається. */
  { href: '/loyalty', title: 'Бали' }
];

/** Один вигляд шляху з двох можливих. На сервері сторінка
 *  рендериться за внутрішньою адресою (/admin/orders), у браузері
 *  живе коротка (/orders) — без зведення до спільного вигляду
 *  підсвітка вкладки при першому показі й після оживлення
 *  розмітки відрізнялася б, а це вже розбіжність гідратації. */
const plain = (path: string) => path.replace(/^\/admin/, '') || '/';

export default function AdminBar({
  user,
  hasDraft,
  newOrders = 0,
  onPublish,
  onSettings
}: {
  user: User;
  /** Є неопубліковані зміни або запланована публікація. */
  hasDraft?: boolean;
  /** Скільки замовлень чекають на обробку — значок на вкладці. */
  newOrders?: number;
  onPublish?: () => void;
  onSettings?: () => void;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const actions = useRef<HTMLDivElement>(null);

  /* Меню «⋯» закривається кліком повз нього та Escape — інакше на
     телефоні воно лишається розгорнутим над сторінкою */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!actions.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // розділ змінили — меню має закритись само
  useEffect(() => setOpen(false), [path]);

  /* Скільки місця займає шапка — щоб під нею могли прилипати
     керування сторінки.

     Міряємо, а не вписуємо числом: на телефоні шапка переносить
     кнопки на другий рядок і стає вищою, а вгадане число
     перетворилось би на щілину або на смугу, що заїжджає під
     шапку. Кладемо в змінну на :root — далі нею користується вся
     адмінка. */
  const bar = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const box = bar.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const seen = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        '--abar-h',
        Math.round(box.getBoundingClientRect().height) + 'px'
      );
    });
    seen.observe(box);
    return () => seen.disconnect();
  }, []);

  return (
    <header className="abar" ref={bar}>
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
            className={'abar__tab' + (plain(path) === x.href ? ' is-active' : '')}
            href={x.href}
          >
            {x.title}
            {x.href === '/orders' && newOrders ? (
              <span className="abar__count">{newOrders}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      {/* is-open на батькові, а не hidden на самому списку: на
          широкому екрані це просто ряд кнопок, і hidden ховав їх
          там, де кнопки «⋯» взагалі немає — «Опублікувати» ставало
          недосяжним. */}
      <div className={'abar__actions' + (open ? ' is-open' : '')} ref={actions}>
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

        <div className="abar__drop">
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
