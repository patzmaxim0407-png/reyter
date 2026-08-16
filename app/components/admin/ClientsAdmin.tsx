'use client';

import { useEffect, useMemo, useState } from 'react';
import ClientRow from './ClientRow';
import Broadcast from './Broadcast';
import { watchMembers } from '@/lib/admin/live';
import { PAGE_SIZE, type AdminOrder } from '@/lib/admin/orders';
import { ORDERS_LIMIT } from '@/lib/admin/live';
import type { Catalogue } from '@/lib/catalog';
import type { MemberDoc } from '@/lib/admin/loyalty-db';
import {
  SEGMENTS,
  buildClients,
  findClients,
  sortClients,
  statsOfClients,
  type Client,
  type ClientSort,
  type Segment
} from '@/lib/admin/clients';

/* ============================================================
   Клієнти
   ------------------------------------------------------------
   Досі людини в адмінці не було ніде. Замовлення знали, що
   продали; програма лояльності — скільки в кого балів; аналітика
   — скільки заробили. А речення «Богдан витратив 11 400, бере
   раз на 68 днів і мовчить уже 92» не міг скласти ніхто: для
   цього треба було руками шукати пошту в архіві.

   Два екрани під однією вкладкою. «Люди» — хто в нас є.
   «Розсилки» — що їм написати. Розділяти їх не варто: обирають
   кому писати саме тут, дивлячись на список.
   ============================================================ */

type Screen = 'people' | 'mail';

const ALL = 'all';

export default function ClientsAdmin({
  orders,
  c,
  workerUrl,
  workerKey
}: {
  orders: AdminOrder[];
  c: Catalogue;
  workerUrl: string;
  workerKey: string;
}) {
  const [screen, setScreen] = useState<Screen>('people');
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [find, setFind] = useState('');
  const [only, setOnly] = useState<Segment | typeof ALL>(ALL);
  const [sort, setSort] = useState<ClientSort>('spent');
  const [limit, setLimit] = useState(PAGE_SIZE);
  /* Кого підставити в розсилку, коли натиснули «написати» з
     картки конкретної людини. */
  const [pick, setPick] = useState<Client | null>(null);

  useEffect(() => watchMembers((list) => setMembers(list as unknown as MemberDoc[])), []);

  const all = useMemo(() => buildClients(orders, members, c), [orders, members, c]);
  const stats = useMemo(() => statsOfClients(all), [all]);

  const view = useMemo(() => {
    const found = findClients(all, find);
    const cut = only === ALL ? found : found.filter((x) => x.segment === only);
    return sortClients(cut, sort);
  }, [all, find, only, sort]);

  /* Новий добір — знову з першої порції. */
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [find, only, sort]);

  const shown = view.slice(0, limit);

  /* Гроші, які тихо йдуть: скільки за весь час принесли ті, хто
     зараз засинає або вже втрачений. Це не збиток — це рівно та
     сума, заради якої варто написати листа сьогодні. */
  const risk = useMemo(
    () => all.filter((x) => x.segment === 'sleep' || x.segment === 'lost').reduce((n, x) => n + x.spent, 0),
    [all]
  );

  return (
    <div className="cl">
      <div className="ao-tabs cl-screens">
        <button
          type="button"
          className={'ao-chip' + (screen === 'people' ? ' is-on' : '')}
          onClick={() => setScreen('people')}
        >
          Люди
        </button>
        <button
          type="button"
          className={'ao-chip' + (screen === 'mail' ? ' is-on' : '')}
          onClick={() => setScreen('mail')}
        >
          Розсилки
        </button>
      </div>

      {screen === 'mail' ? (
        <Broadcast
          clients={all}
          picked={pick}
          onPicked={() => setPick(null)}
          workerUrl={workerUrl}
          workerKey={workerKey}
        />
      ) : (
        <>
          <div className="ao-stats">
            <div className="ao-stat">
              <b>{stats.people}</b>
              <span>
                клієнтів
                <i className="ao-stat__hint">
                  {' '}
                  · покупців {stats.buyers} · у програмі без покупки{' '}
                  {stats.bySegment.member}
                </i>
              </span>
            </div>
            <div className="ao-stat">
              <b>{Math.round(stats.loyal * 100)}%</b>
              <span>
                повертаються
                <i className="ao-stat__hint"> · {stats.again} із {stats.buyers}</i>
              </span>
            </div>
            <div className="ao-stat">
              <b>{stats.ltv.toLocaleString('uk')} грн</b>
              <span>приносить покупець за весь час</span>
            </div>
            {/* Головне число екрана: гроші, які вже пішли б, якби
                ніхто нічого не зробив. */}
            <div className={'ao-stat' + (risk ? ' is-bad' : '')}>
              <b>{risk.toLocaleString('uk')} грн</b>
              <span>
                у тих, хто засинає
                <i className="ao-stat__hint">
                  {' '}
                  · {stats.bySegment.sleep + stats.bySegment.lost} людей
                </i>
              </span>
            </div>
          </div>

          {/* Групи — не просто фільтр, а перелік того, з чим можна
              працювати: у кожної кнопки написано, скільки там
              людей. */}
          <div className="cl-segs">
            <button
              type="button"
              className={'cl-seg' + (only === ALL ? ' is-on' : '')}
              onClick={() => setOnly(ALL)}
            >
              Усі <i>{all.length}</i>
            </button>
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.hint}
                className={'cl-seg cl-' + s.id + (only === s.id ? ' is-on' : '')}
                onClick={() => setOnly(s.id)}
              >
                {s.title} <i>{stats.bySegment[s.id]}</i>
              </button>
            ))}
          </div>

          <div className="ao-toolbar">
            <input
              className="ao-search"
              value={find}
              placeholder="пошта, імʼя, телефон, місто, номер замовлення"
              autoComplete="off"
              onChange={(e) => setFind(e.target.value)}
            />
            <select
              className="ao-select"
              value={sort}
              aria-label="Порядок"
              onChange={(e) => setSort(e.target.value as ClientSort)}
            >
              <option value="spent">Спершу хто більше витратив</option>
              <option value="often">Спершу хто частіше купує</option>
              <option value="recent">Спершу хто купував недавно</option>
              <option value="quiet">Спершу хто найдовше мовчить</option>
              <option value="new">Спершу нові</option>
            </select>
          </div>

          {only !== ALL ? (
            <p className="cl-hint">{SEGMENTS.find((s) => s.id === only)?.todo}</p>
          ) : null}

          {!shown.length ? (
            <div className="a-empty">
              {all.length
                ? 'За цим запитом нікого не знайшлось.'
                : 'Клієнтів поки немає. Вони зʼявляться після першого замовлення або вступу в програму.'}
            </div>
          ) : (
            <div className="ao-list">
              {shown.map((x) => (
                <ClientRow
                  key={x.key}
                  x={x}
                  onWrite={(who) => {
                    setPick(who);
                    setScreen('mail');
                  }}
                />
              ))}
              {view.length > shown.length ? (
                <button
                  className="btn btn--ghost ao-more"
                  type="button"
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                >
                  Показати ще {Math.min(PAGE_SIZE, view.length - shown.length)} із{' '}
                  {view.length - shown.length}
                </button>
              ) : view.length > PAGE_SIZE ? (
                <p className="ao-note ao-count">Показано всіх {view.length}</p>
              ) : null}
              {/* Клієнти складаються з тих замовлень, що приїхали
                  з бази, а їх ORDERS_LIMIT найновіших. Мовчати про
                  це не можна: людина з давньою покупкою виглядала
                  б тут одноразовою, і їй пішов би не той лист. */}
              {orders.length >= ORDERS_LIMIT ? (
                <p className="ao-note ao-count">
                  Зібрано з {ORDERS_LIMIT} найновіших замовлень — у кого покупка була давніше,
                  той тут виглядає одноразовим
                </p>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
