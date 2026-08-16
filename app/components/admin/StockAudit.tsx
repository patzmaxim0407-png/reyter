'use client';

import { useEffect, useRef, useState } from 'react';
import { ORDERS_LIMIT, loadAllMoves, watchOrders } from '@/lib/admin/live';
import { checkOrders, reconcile, type AuditResult, type OrderCheck, type SoldOrder } from '@/lib/admin/audit';
import { trueUp, type Move, type StockState } from '@/lib/admin/stock';
import { useToast } from '../Toasts';
import { useAsk } from './AskProvider';
import { useAdminUser } from './AdminGate';
import { db } from '@/lib/firebase';
import type { Check } from '@/lib/admin/audit';

/* ============================================================
   Звірка складу
   ------------------------------------------------------------
   Питання, на яке досі не відповідав ніхто: чи те, що лежить на
   полиці, дорівнює тому, що написано в журналі.

   Читає журнал ЦІЛКОМ, від першого запису, — не ті чотириста, що
   показує вкладка «Рух». На обрізаному журналі розбіжність вийшла
   б у кожного товару, і справжня втрата загубилась би в шумі.

   Тому це окрема вкладка, яку відкривають навмисно: читання всієї
   історії коштує запитів, і робити його на кожне відкриття складу
   немає жодних підстав.
   ============================================================ */

export default function StockAudit({ s }: { s: StockState }) {
  const toast = useToast();
  const ask = useAsk();
  const user = useAdminUser();
  const [fixing, setFixing] = useState('');
  /* Замовлення читаємо тут-таки: сторінка складу їх не тримає, а
     заводити третю підписку в батька заради однієї вкладки
     означало б платити за неї на кожному відкритті складу. */
  const [orders, setOrders] = useState<SoldOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [whole, setWhole] = useState(true);
  const [error, setError] = useState('');
  const [res, setRes] = useState<AuditResult | null>(null);
  const [bad, setBad] = useState<OrderCheck[]>([]);
  const [seen, setSeen] = useState(0);
  /* Прочитаний журнал тримаємо тут: він потрібен ще раз, коли
     доїдуть замовлення. */
  const lastMoves = useRef<Move[]>([]);

  useEffect(() => watchOrders((list) => setOrders(list as unknown as SoldOrder[])), []);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    void loadAllMoves()
      .then((got) => {
        if (!alive) return;
        if (!got) {
          setError('Не вдалося прочитати журнал руху — перевірте права доступу.');
          return;
        }
        const moves = got.moves as unknown as Move[];
        lastMoves.current = moves;
        setSeen(moves.length);
        setWhole(got.whole);
        setRes(reconcile(s, moves, got.whole));
        setDone(true);
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Замовлення приїжджають підпискою й пізніше за журнал, тож
     звіряємо їх окремо — інакше перший кадр порахував би все за
     порожнім списком. */
  useEffect(() => {
    if (done) setBad(checkOrders(orders, lastMoves.current));
  }, [orders, done]);

  /* Записати перерахунок.
     Полиця вже правильна — ми лише дописуємо в журнал те, що з
     нею колись сталося повз адмінку. Після цього сума рухів
     дорівнює залишку, і НАСТУПНА розбіжність буде видна одразу,
     а не загубиться за цією. */
  async function settle(r: Check) {
    const yes = await ask({
      title: 'Полиця правильна?',
      text:
        `«${r.name}»: за журналом ${r.logged}, на полиці ${r.shelf}.\n\n` +
        'Якщо число на полиці правильне — журнал підтягнеться до нього, ' +
        'і розбіжність зникне. Сам залишок не зміниться.\n\n' +
        'Робіть це лише після того, як полицю перерахували руками.',
      okText: 'Так, полиця правильна'
    });
    if (yes !== true) return;

    const d = db();
    if (!d) return;

    /* Полиця правильна — отже «пораховане» дорівнює тому, що на
       ній стоїть. Далі те саме, що й у формі складу: залишок не
       зрушиться (він уже такий), а журнал підтягнеться до нього. */
    const counted: Record<string, number> = {};
    if (r.bySize.length) r.bySize.forEach((x) => (counted[x.size] = x.shelf));
    else counted[''] = r.shelf;

    setFixing(r.id);
    try {
      const done = await trueUp({ db: d, by: user.email ?? '' }, s, r.id, counted);
      if (!done.ok) {
        toast(done.message);
        return;
      }
      toast('Перерахунок записано ✓', 'success');
      /* Перечитуємо журнал: рядок має зникнути зі звірки одразу,
         інакше незрозуміло, спрацювало чи ні. */
      const got = await loadAllMoves();
      if (got) {
        const moves = got.moves as unknown as Move[];
        lastMoves.current = moves;
        setSeen(moves.length);
        setRes(reconcile(s, moves, got.whole));
      }
    } finally {
      setFixing('');
    }
  }

  if (busy && !done) {
    return <p className="ao-note">Читаємо весь журнал руху…</p>;
  }
  if (error) return <p className="ao-note ao-error">{error}</p>;
  if (!res) return null;

  return (
    <div className="au">
      <div className="ao-stats">
        <div className="ao-stat">
          <b>{res.ok}</b>
          <span>товарів сходяться</span>
        </div>
        {/* Головне число: тут журнал знає всю історію товару, і
            розбіжність означає справжню втрату, а не відсутній
            початок відліку. */}
        <div className={'ao-stat' + (res.broken.length ? ' is-bad' : '')}>
          <b>{res.broken.length}</b>
          <span>розійшлись</span>
        </div>
        <div className="ao-stat">
          <b>{res.partial.length}</b>
          <span>
            без початку в журналі
            <i className="ao-stat__hint"> · залишок заводили руками</i>
          </span>
        </div>
        <div className={'ao-stat' + (bad.length ? ' is-bad' : '')}>
          <b>{bad.length}</b>
          <span>замовлень не списались</span>
        </div>
        <div className="ao-stat">
          <b>{seen.toLocaleString('uk')}</b>
          <span>записів у журналі</span>
        </div>
      </div>

      {!whole ? (
        <p className="ao-note ao-error">
          Журнал прочитано не повністю — записів забагато. Звірка неповна, і «сходиться» тут
          означає лише «сходиться в прочитаному».
        </p>
      ) : null}

      {/* ---------- Замовлення ---------- */}
      {bad.length ? (
        <section className="au-box">
          <h4>Замовлення, за якими склад не зійшовся</h4>
          <p className="mk-note">
            Замовлення виконане, а товар за ним не списаний або списаний і повернутий. Полиця
            показує штуки, яких насправді немає. Перевірено {ORDERS_LIMIT} найновіших замовлень —
            саме стільки бачить адмінка.
          </p>
          <ul className="au-list">
            {bad.map((x) => (
              <li key={x.num}>
                <b>№{x.num}</b>
                <span>
                  у замовленні {x.want} шт, списалось {Math.abs(x.got)}
                </span>
                <i className="is-bad">
                  {x.diff > 0 ? `бракує ${x.diff}` : `зайве списання ${Math.abs(x.diff)}`}
                </i>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------- Товари, де журнал знає все ---------- */}
      <section className="au-box">
        <h4>
          Розійшлись <i>{res.broken.length}</i>
        </h4>
        {res.broken.length ? (
          <>
            <p className="mk-note">
              У цих товарів журнал знає всю історію — від першого приходу. Отже різниця не
              пояснюється нічим, крім втрати, перерахунку руками повз адмінку або помилки.
            </p>
            <ul className="au-list">
              {res.broken.map((r) => (
                <li key={r.id}>
                  <b>
                    {r.name} <em>{r.id}</em>
                  </b>
                  <span>
                    за журналом {r.logged}, на полиці {r.shelf}
                    {r.bySize.filter((x) => x.diff).length
                      ? ' · ' +
                        r.bySize
                          .filter((x) => x.diff)
                          .map((x) => `${x.size}: ${x.diff > 0 ? '+' : ''}${x.diff}`)
                          .join(', ')
                      : ''}
                  </span>
                  <i className="is-bad">
                    {r.diff > 0 ? '+' : ''}
                    {r.diff}
                  </i>
                  <button
                    className="btn btn--ghost btn--sm au-fix"
                    type="button"
                    disabled={fixing === r.id}
                    onClick={() => void settle(r)}
                  >
                    {fixing === r.id ? '…' : 'Полиця правильна'}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mk-note">
              «Полиця правильна» підтягує журнал до залишку — сам залишок не змінюється.
              Натискайте після того, як перерахували руками й число на полиці збіглося. Якщо ж
              на полиці інше число — виправте його на вкладці «Прихід» у режимі «Перерахунок»,
              і розбіжність теж зникне.
            </p>
          </>
        ) : (
          <p className="mk-note">
            Жодного. Усе, що журнал бачив від початку, сходиться з полицею штука в штуку.
          </p>
        )}
      </section>

      {/* ---------- Товари без початку ---------- */}
      {res.partial.length ? (
        <section className="au-box">
          <h4>
            Без початку в журналі <i>{res.partial.length}</i>
          </h4>
          <p className="mk-note">
            Залишок цих товарів колись проставили руками в картці — журнал їхнього початку не
            бачив. Різниця нижче і є тим, що лежало на полиці до першого запису. Це не помилка;
            перевіряти тут нічого, поки число не почне змінюватись саме.
          </p>
          <ul className="au-list">
            {res.partial.map((r) => (
              <li key={r.id}>
                <b>
                  {r.name} <em>{r.id}</em>
                </b>
                <span>
                  рухів {r.moves} · за журналом {r.logged}, на полиці {r.shelf}
                </span>
                <i>
                  {r.diff > 0 ? '+' : ''}
                  {r.diff}
                </i>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {res.orphans ? (
        <p className="mk-note">
          У журналі {res.orphans} рухів на товари, яких уже немає в каталозі. Це слід від того, що
          колись продавали, — на теперішні залишки він не впливає.
        </p>
      ) : null}
    </div>
  );
}
