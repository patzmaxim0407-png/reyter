'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from './LangProvider';
import { useSearchParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import ProfileTab from './ProfileTab';
import PromosTab from './PromosTab';
import OrdersTab, { toRow, type OrdersMode, type Row } from './OrdersTab';
import AuthPanel from './AuthPanel';
import PageTop from './PageTop';
import { useToast } from './Toasts';
import * as cart from '@/lib/cart';
import * as fb from '@/lib/firebase';
import { sortMyPromos } from '@/lib/account';
import { promoLive, type Promo } from '@/lib/promo';
import { uah, type Catalogue } from '@/lib/catalog';

/* ============================================================
   Кабінет
   ------------------------------------------------------------
   На старому сайті це була панель збоку. Тут — сторінка з
   вкладками в адресі: посилання на «мої замовлення» тепер можна
   надіслати, а кнопка «назад» повертає туди, звідки прийшли.

   Замовлення й персональні коди вантажимо саме тут, а не в
   самих вкладках: підсумки видно у шапці, і два незалежні
   запити давали б два різні числа на одному екрані.

   Вкладки — справжній tablist: стрілками ліворуч-праворуч, Home
   і End, як того очікує людина з клавіатурою чи зчитувачем.
   ============================================================ */

const ICONS: Record<string, React.ReactNode> = {
  profile: <><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  promos: <><path d="M20 12a2 2 0 0 1 0-4V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2a2 2 0 0 1 0 4 2 2 0 0 1 0 4v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2a2 2 0 0 1 0-4Z" /><path d="M12 7v10" /></>,
  orders: <><path d="M8 3h8l3 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8l3-5Z" /><path d="M5 8h14" /><path d="M9.5 12a2.5 2.5 0 0 0 5 0" /></>
};

const TABS = [
  { id: 'profile', title: 'acc.profile' },
  { id: 'promos', title: 'acc.myPromos' },
  { id: 'orders', title: 'acc.orders' }
] as const;

type TabId = (typeof TABS)[number]['id'];

/** «З нами з березня 2026» — місяць і рік, без точної дати:
 *  день реєстрації нікому нічого не каже. */
function joinedText(user: User, lang: string, t: (k: string) => string): string {
  const raw = user.metadata?.creationTime;
  if (!raw) return '';
  const date = new Date(raw);
  if (isNaN(date.getTime())) return '';
  const text = date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'uk-UA', {
    month: 'long',
    year: 'numeric'
  });
  return t('acc.since').replace('{date}', text);
}

export default function AccountPanel({ c }: { c: Catalogue }) {
  const { t, lang } = useLang();
  const params = useSearchParams();
  const toast = useToast();
  const tabsRef = useRef<HTMLDivElement>(null);

  /* Початковий розділ береться з адреси, далі ним керує сторінка:
     так перемикання не чекає на сервер, а поділитися посиланням
     усе одно можна. */
  const asked = params.get('tab');
  const [tab, setTab] = useState<TabId>(
    TABS.some((x) => x.id === asked) ? (asked as TabId) : 'profile'
  );

  /* undefined — ще не знаємо, чи покупець увійшов. Показувати
     в цю мить форму входу означало б блимнути нею перед тим,
     хто насправді залогінений. */
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => fb.watchAuth(setUser), []);

  const online = !!fb.auth();

  /* ---------- Дані обох вкладок ---------- */

  const [rows, setRows] = useState<Row[] | null>(null);
  const [mode, setMode] = useState<OrdersMode>('local');
  const [promos, setPromos] = useState<Promo[] | null>(null);

  const localOrders = () =>
    cart.getOrders().map((o) => toRow(o as unknown as Record<string, unknown>));

  useEffect(() => {
    if (user === undefined) return;

    /* Гість бачить свою ж локальну історію — ту, що лежить у
       цьому браузері. На старому сайті ця гілка вмикалась лише
       коли CDN Firebase був заблокований; тепер SDK у бандлі й
       «не завантажитись» не може, тож без цього покупець, який
       щойно оформив замовлення гостем, побачив би форму входу
       замість власного замовлення. */
    if (!user) {
      setRows(localOrders());
      setMode('local');
      return;
    }

    let alive = true;
    setRows(null);
    void fb.loadMyOrders(user.uid, user.email ?? '').then((cloud) => {
      if (!alive) return;
      if (cloud === null) {
        setRows(localOrders());
        setMode('down');
        return;
      }
      setRows(cloud.map(toRow));
      setMode('cloud');
    });
    return () => {
      alive = false;
    };
  }, [user, online]);

  useEffect(() => {
    if (user === undefined) return;
    if (!user?.email) {
      setPromos([]);
      return;
    }
    let alive = true;
    setPromos(null);
    void fb.promoMine(user.email).then((list) => {
      // спершу ті, що згорають раніше; безстрокові — на початку
      if (alive) setPromos(sortMyPromos(list as Promo[]));
    });
    return () => {
      alive = false;
    };
  }, [user]);

  /* ---------- Підсумки для шапки ---------- */

  const stats = useMemo(() => {
    const orders = rows?.length ?? 0;
    const spent = (rows ?? []).reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const live = (promos ?? []).filter((p) => promoLive(p, t).ok).length;
    return { orders, spent, live };
  }, [rows, promos, t]);

  /* ---------- Вкладки ---------- */

  /* Розділ лишається в адресі — посилання на «мої замовлення»
     можна надіслати. Але міняємо її саме history.replaceState, а
     не router: маршрутизатор на кожне перемикання ходив би на
     сервер по ту саму сторінку, і вкладки перемикались із
     затримкою. Next такий виклик підхоплює сам. */
  const go = useCallback((next: TabId) => {
    setTab(next);
    const base = window.location.pathname;
    window.history.replaceState(null, '', next === 'profile' ? base : `${base}?tab=${next}`);
  }, []);

  /* Стрілки ходять по вкладках, як в операційній системі:
     інакше з клавіатури довелося б табати крізь кожну. */
  function onNavKey(event: React.KeyboardEvent) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const at = TABS.findIndex((x) => x.id === tab);
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? TABS.length - 1
          : (at + step + TABS.length) % TABS.length;
    go(TABS[next].id);
    // фокус їде разом із виділенням, інакше стрілки «загубляться»
    tabsRef.current?.querySelectorAll('button')[next]?.focus();
  }

  const signedIn = !!user;
  const title = user
    ? user.displayName || (user.email ? user.email.split('@')[0] : t('acc.yourAccount'))
    : t('acc.guest');
  const badge: Record<TabId, number | null> = {
    profile: null,
    promos: stats.live || null,
    orders: stats.orders || null
  };

  return (
    <div className="container account">
      {/* Кабінет відкривається згори — і на вході, і коли приїхали
          дані: до того сторінка коротша за екран */}
      <PageTop ready={user !== undefined} />

      <header className="account__hero">
        <div className="account__identity">
          <div className="account__avatar" aria-hidden="true">
            {user?.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
            ) : (
              (user?.email || user?.displayName || 'R')[0].toUpperCase()
            )}
          </div>

          <div className="account__who">
            <p className="account__eyebrow">{t('acc.title')}</p>
            <h1 className="account__name">{title}</h1>
            <p className="account__meta">
              {signedIn ? (
                <>
                  <span className="account__email">{user?.email}</span>
                  {user && joinedText(user, lang, t) ? (
                    <span className="account__joined">{joinedText(user, lang, t)}</span>
                  ) : null}
                </>
              ) : (
                <span className="account__email">{t('acc.guestSub')}</span>
              )}
            </p>
          </div>

          {signedIn ? (
            <button
              className="btn btn--ghost btn--sm account__logout"
              type="button"
              onClick={() => {
                void fb.logout();
                toast(t('acc.loggedOut'));
              }}
            >
              {t('acc.logout')}
            </button>
          ) : null}
        </div>

        {/* Підсумки показуємо лише коли є що показати: нулі в
            новому акаунті виглядають як докір */}
        {stats.orders || stats.live ? (
          <dl className="account__stats">
            <div className="account__stat">
              <dt>{t('acc.statOrders')}</dt>
              <dd>{stats.orders}</dd>
            </div>
            {stats.spent ? (
              <div className="account__stat">
                <dt>{t('acc.statSpent')}</dt>
                <dd>{uah(stats.spent, lang)}</dd>
              </div>
            ) : null}
            {stats.live ? (
              <div className="account__stat account__stat--accent">
                <dt>{t('acc.statPromos')}</dt>
                <dd>{stats.live}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </header>

      <div className="account__layout">
        <div
          className="account__nav"
          role="tablist"
          aria-label={t('acc.navHint')}
          ref={tabsRef}
          onKeyDown={onNavKey}
        >
          {TABS.map((x) => {
            const active = tab === x.id;
            return (
              <button
                key={x.id}
                id={`acctab-${x.id}`}
                className={'account__tab' + (active ? ' is-active' : '')}
                role="tab"
                aria-selected={active}
                aria-controls={`accpanel-${x.id}`}
                tabIndex={active ? 0 : -1}
                type="button"
                onClick={() => go(x.id)}
              >
                <svg
                  className="account__tab-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {ICONS[x.id]}
                </svg>
                <span className="account__tab-label">{t(x.title)}</span>
                {badge[x.id] ? <span className="account__tab-count">{badge[x.id]}</span> : null}
              </button>
            );
          })}
        </div>

        <section
          className="account__panel"
          role="tabpanel"
          id={`accpanel-${tab}`}
          aria-labelledby={`acctab-${tab}`}
          tabIndex={-1}
        >
          {user === undefined ? (
            <p className="account-note" aria-live="polite">
              {t('acc.loading')}
            </p>
          ) : /* Без Firebase кабінет працює на локальних даних:
                профіль і замовлення цього браузера. Промокоди —
                ні, вони живуть лише в базі. */
          online && !user && tab !== 'orders' ? (
            tab === 'promos' ? (
              <PromosTab c={c} user={null} list={promos} />
            ) : (
              <AuthPanel />
            )
          ) : tab === 'profile' ? (
            <ProfileTab user={user} online={online} />
          ) : tab === 'promos' ? (
            <PromosTab c={c} user={user} list={promos} />
          ) : (
            <OrdersTab c={c} user={user} online={online} rows={rows} mode={mode} onRows={setRows} />
          )}
        </section>
      </div>
    </div>
  );
}
