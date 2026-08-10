'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PublishControl from './PublishControl';
import SettingsDialog from './SettingsDialog';
import StockRow from './StockRow';
import MoveRow from './MoveRow';
import RestockForm, { type RestockSubmit, type SizeCell } from './RestockForm';
import RestockEdit from './RestockEdit';
import RestockInfo from './RestockInfo';
import { useAdminUser } from './AdminGate';
import { useAsk } from './AskProvider';
import { useToast } from '../Toasts';
import { db, loadNotifySettings } from '@/lib/firebase';
import { sendBackInStock } from '@/lib/notify';
import { EMPTY_DRAFT, watchDraft, type Draft } from '@/lib/admin/store';
import { loadMoves, loadRestocks, watchInventory, type Doc } from '@/lib/admin/live';
import {
  MOVE_REASONS,
  WRITEOFF_REASONS,
  createRestock,
  createWriteoff,
  filteredMoves,
  moveDate,
  deleteRestock,
  hasInvDoc,
  isSetOf,
  isSized,
  movesPage,
  pagerNumbers,
  planReceive,
  planWriteoff,
  notifyStockAlerts,
  receiveRestock,
  restockOverdue,
  lastReceived,
  pendingRestocks,
  restockTotal,
  saveRestockEdit,
  setStockRow,
  sizeQty,
  stockRow,
  stockSizes,
  todayISO,
  totalQty,
  unitQty,
  type Move,
  type Restock,
  type StockState
} from '@/lib/admin/stock';
import type { Product, Stock } from '@/lib/types';
import { fmt } from '@/lib/catalog';

/* ============================================================
   Склад, прихід і рух
   ------------------------------------------------------------
   Залишки не редагуються руками. Базу задано один раз, далі їх
   змінюють лише прихід, списання й замовлення — так у журналі
   «Рух» лишається повна історія, а не мовчазні виправлення.
   ============================================================ */

type Tab = 'stock' | 'restock' | 'moves';

export default function StockAdmin() {
  const user = useAdminUser();
  const ask = useAsk();
  const toast = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [inv, setInv] = useState<Stock>({});
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [tab, setTab] = useState<Tab>('stock');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [movesPageNo, setMovesPageNo] = useState(1);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => watchDraft(setDraft), []);
  useEffect(
    () => watchInventory((v) => setInv(v as Stock), (e) => setError(e.text)),
    []
  );

  /* Невдале читання лишає на екрані те, що вже було: порожній
     список приходів виглядав би як «усе оприбутковано». */
  const reload = useCallback(async () => {
    const [r, m] = await Promise.all([loadRestocks(), loadMoves()]);
    if (r) setRestocks(r as unknown as Restock[]);
    if (m) setMoves(m as unknown as Move[]);
    if (!r || !m) setError('Не вдалося прочитати склад — показано попередні дані');
  }, []);
  useEffect(() => void reload(), [reload]);

  const s: StockState = useMemo(() => ({ products: draft.products, inv }), [draft.products, inv]);

  function writer() {
    const d = db();
    if (!d) {
      toast('Немає звʼязку з базою');
      return null;
    }
    return { db: d, by: user.email ?? '' };
  }

  const catTitle = useCallback(
    (id: string) => draft.categories.find((c) => c.id === id)?.title ?? id,
    [draft.categories]
  );

  /* ---------- Список складу ---------- */

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return draft.categories
      .map((cat) => ({
        cat,
        items: draft.products.filter((p) => {
          if (p.category !== cat.id) return false;
          if (q && !(p.name + ' ' + p.id).toLowerCase().includes(q)) return false;
          const cls = isSetOf(s, p) ? setStockRow(s, p).state.cls : stockRow(s, p).state.cls;
          if (filter === 'low' && cls !== 'is-low') return false;
          if (filter === 'out' && cls !== 'is-out') return false;
          return true;
        })
      }))
      .filter((x) => x.items.length);
  }, [draft, s, search, filter]);

  const stats = useMemo(() => {
    let units = 0;
    let value = 0;
    let low = 0;
    let out = 0;
    draft.products.forEach((p) => {
      /* Комплект власних штук не має — у сумі й вартості складу
         він рахувався б удруге, через складники. Але «закінчується»
         й «немає» до нього стосуються: покупець бачить саме
         комплект, а не його вміст. */
      const cls = (isSetOf(s, p) ? setStockRow(s, p) : stockRow(s, p)).state.cls;
      if (cls === 'is-low') low++;
      if (cls === 'is-out') out++;
      if (isSetOf(s, p)) return;
      const n = totalQty(s, p);
      units += n;
      value += n * (Number(p.price) || 0);
    });
    return { units, value, low, out };
  }, [draft.products, s]);

  /* ---------- Прихід і списання ---------- */

  const sizesOf = useCallback(
    (p: Product): SizeCell[] =>
      isSized(p)
        ? stockSizes(s, p).map((it) => ({
            size: it.size,
            have: hasInvDoc(s, p.id) ? sizeQty(s, p.id, it.size) : null
          }))
        : [{ size: '', have: hasInvDoc(s, p.id) ? unitQty(s, p.id) : null }],
    [s]
  );

  /* Повертаємо true лише коли запис справді відбувся: форма
     чистить поля саме за цією відповіддю, а між натисканням і
     записом стоять питання «списати більше, ніж є?». */
  async function onRestockSubmit(v: RestockSubmit): Promise<boolean> {
    const w = writer();
    if (!w) return false;
    setBusy(true);
    try {
      if (v.mode === 'in') {
        const res = await createRestock(
          w,
          s,
          restocks,
          { productId: v.productId, expected: v.expected, note: v.note, sizes: v.qty, qty: v.qty[''] },
          new Date()
        );
        if (!res.ok) {
          toast(res.message);
          return false;
        }
        toast('Прихід додано ✓', 'success');
      } else {
        const plan = planWriteoff(s, {
          productId: v.productId,
          reason: v.reason as never,
          note: v.note,
          sizes: v.qty,
          qty: v.qty['']
        });
        if (!plan.ok) {
          toast(plan.message);
          return false;
        }

        /* Списати більше, ніж є, зазвичай означає помилку в цифрі —
           але не завжди: товар могли продати повз систему */
        if (plan.over.length) {
          const go = await ask({
            title: 'Списати більше, ніж є?',
            text: plan.overWarning,
            okText: 'Усе одно списати',
            danger: true
          });
          if (go !== true) return false;
        }
        const yes = await ask({
          title: 'Списання',
          text: plan.confirm,
          okText: 'Списати',
          danger: true
        });
        if (yes !== true) return false;

        const res = await createWriteoff(w, plan);
        if (!res.ok) {
          toast(res.message);
          return false;
        }
        toast('Списано ✓', 'success');
      }
      await reload();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function onReceive(r: Restock) {
    const w = writer();
    if (!w) return;
    /* Перевіряємо наперед: питати «оприбуткувати?» там, де це
       вже неможливо, — марно витрачений клік */
    const plan = planReceive(s, r);
    if (!plan.ok) return toast(plan.message);

    const yes = await ask({
      title: 'Оприбуткувати?',
      text: `«${r.productName || r.productId}» — ${restockTotal(r)} шт додасться до залишків.`,
      okText: 'Оприбуткувати'
    });
    if (yes !== true) return;

    setBusy(true);
    try {
      const res = await receiveRestock(w, s, restocks, r);
      if (!res.ok) return toast(res.message);
      toast('Оприбутковано ✓', 'success');

      /* Товар повернувся в наявність — пишемо тим, хто на нього
         чекав. Без цього підписка на розмір нічого не варта:
         покупець так і не дізнається, що товар приїхав. */
      if (plan.back !== null) {
        const settings = await loadNotifySettings();
        const sent = await notifyStockAlerts(
          {
            db: w.db,
            send: (mail) => sendBackInStock(settings as { workerUrl?: string } | null, mail)
          },
          s,
          r.productId,
          plan.back
        );
        const n = sent.reduce((x, a) => x + a.sent, 0);
        if (n) toast(`Сповіщено підписників: ${n} ✓`, 'success');
      }

      await reload();
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Рух ---------- */

  const [moveReason, setMoveReason] = useState('all');
  const [moveSearch, setMoveSearch] = useState('');
  const shownMoves = useMemo(
    () => filteredMoves(moves, moveReason, moveSearch),
    [moves, moveReason, moveSearch]
  );
  const page = useMemo(
    () => movesPage(shownMoves, movesPageNo, new Date()),
    [shownMoves, movesPageNo]
  );

  return (
    <>
      <PublishControl user={user} onSettings={() => setSettingsOpen(true)} />

      {/* Розкладка — як в admin.html: .admin-wrap це дві колонки
          каталогу з бічним списком категорій, і сторінці складу
          вона не підходить. */}
      <div className="a-page">
        <div className="a-page__head">
          <h2>Склад</h2>
          <p>
            Залишки по розмірах, прихід товару та журнал руху. Сайт показує «Продано» і
            «Закінчується» з цих даних.
          </p>
        </div>

        <div className="a-orders a-orders--page">
          <div className="ao-stats">
            <div className="ao-stat">
              <b>{stats.units}</b>
              <span>штук на складі</span>
            </div>
            <div className="ao-stat">
              <b>{fmt(stats.value)}</b>
              <span>грн у товарі</span>
            </div>
            <div className="ao-stat">
              <b>{stats.low}</b>
              <span>закінчуються</span>
            </div>
            <div className="ao-stat">
              <b>{stats.out}</b>
              <span>немає в наявності</span>
            </div>
            <div className="ao-stat">
              <b>{restocks.filter((r) => r.status !== 'received').length}</b>
              <span>приходів у черзі</span>
            </div>
          </div>

          <div className="ao-toolbar">
            <span className="ao-live">● live</span>
            <div className="ao-chips">
              {(
                [
                  ['stock', 'Залишки'],
                  ['restock', 'Прихід'],
                  ['moves', 'Рух']
                ] as [Tab, string][]
              ).map(([id, title]) => (
                <button
                  key={id}
                  type="button"
                  className={'ao-chip' + (tab === id ? ' is-active' : '')}
                  /* Перечитуємо на кожен вхід у розділ: залишки
                     ведуть удвох, і прихід міг зʼявитися чи бути
                     оприбуткованим з іншого пристрою. */
                  onClick={() => {
                    setTab(id);
                    if (id !== 'stock') void reload();
                  }}
                >
                  {title}
                </button>
              ))}
            </div>
          </div>

          {error ? <p className="ao-note">{error}</p> : null}

          {tab === 'stock' ? (
            <>
              <div className="ao-filterbar">
                <div className="ao-chips">
                  {(
                    [
                      ['all', 'Усі'],
                      ['low', 'Закінчуються'],
                      ['out', 'Немає']
                    ] as ['all' | 'low' | 'out', string][]
                  ).map(([id, title]) => (
                    <button
                      key={id}
                      type="button"
                      className={'ao-chip' + (filter === id ? ' is-active' : '')}
                      onClick={() => setFilter(id)}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                <input
                  className="ao-search"
                  placeholder="Пошук за назвою або артикулом"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {sections.length ? (
                sections.map(({ cat, items }) => (
                  <div key={cat.id}>
                    <h5 className="ao-cat-title">{cat.title}</h5>
                    {items.map((p) => {
                      if (isSetOf(s, p)) {
                        const r = setStockRow(s, p);
                        return (
                          <StockRow
                            key={p.id}
                            p={p}
                            state={r.state}
                            parts={r.parts}
                            total={r.total}
                            cells={
                              r.sized
                                ? r.sizes.length
                                  ? r.sizes.map((c) => ({
                                      label: c.size,
                                      qty: c.qty,
                                      hint: 'Скільки комплектів цього розміру можна зібрати'
                                    }))
                                  : [{ label: '—', qty: null }]
                                : [
                                    {
                                      label: 'шт',
                                      qty: r.total,
                                      hint: 'Рахується за складниками комплекту'
                                    }
                                  ]
                            }
                          />
                        );
                      }
                      const r = stockRow(s, p);
                      return (
                        <StockRow
                          key={p.id}
                          p={p}
                          state={r.state}
                          total={r.total}
                          cells={
                            r.sized
                              ? r.cells.map((c) => ({ label: c.size, qty: c.qty, stray: c.stray }))
                              : [{ label: 'шт', qty: r.unit }]
                          }
                        />
                      );
                    })}
                  </div>
                ))
              ) : (
                <div className="a-empty">Нічого не знайдено.</div>
              )}
            </>
          ) : null}

          {tab === 'restock' ? (
            <>
              <RestockForm
                products={draft.products.filter((p) => !isSetOf(s, p))}
                reasons={WRITEOFF_REASONS}
                today={todayISO(new Date())}
                sizesOf={sizesOf}
                categoryTitle={catTitle}
                totalOf={(p) => (hasInvDoc(s, p.id) ? totalQty(s, p) : null)}
                busy={busy}
                onSubmit={onRestockSubmit}
              />

              <h5>Очікуються</h5>
              {pendingRestocks(restocks).length ? (
                pendingRestocks(restocks).map((r) =>
                    editing === r._id ? (
                      <RestockEdit
                        key={r._id}
                        r={r}
                        p={draft.products.find((x) => x.id === r.productId) ?? null}
                        busy={busy}
                        onCancel={() => setEditing(null)}
                        onSave={async (v) => {
                          const w = writer();
                          if (!w) return;
                          setBusy(true);
                          try {
                            const res = await saveRestockEdit(w, restocks, r, v, new Date());
                            if (!res.ok) return toast(res.message);
                            setEditing(null);
                            toast('Прихід оновлено ✓', 'success');
                            await reload();
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                    ) : (
                    <div
                      className={'ao-restock' + (restockOverdue(r, new Date()) ? ' is-overdue' : '')}
                      key={r._id}
                    >
                      <RestockInfo r={r} />
                      <div className="ao-restock__actions">
                        <button
                          className="btn btn--primary btn--sm"
                          type="button"
                          disabled={busy}
                          onClick={() => void onReceive(r)}
                        >
                          Оприбуткувати
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          type="button"
                          disabled={busy}
                          onClick={() => setEditing(r._id)}
                        >
                          Змінити
                        </button>
                        <button
                          className="btn btn--ghost btn--sm ao-danger"
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            const yes = await ask({
                              title: 'Видалити прихід?',
                              text: 'Залишків це не змінить — прихід іще не оприбуткований.',
                              okText: 'Видалити',
                              danger: true
                            });
                            if (yes !== true) return;
                            const w = writer();
                            if (!w) return;
                            const res = await deleteRestock(w, restocks, r);
                            if (!res.ok) toast(res.message);
                            await reload();
                          }}
                          title="Видалити прихід"
                          aria-label="Видалити прихід"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    )
                  )
              ) : (
                <div className="a-empty">Немає приходів у черзі.</div>
              )}

              {/* Оприбутковані лишаються на очах: інакше не
                  перевірити, коли й хто прийняв товар */}
              {lastReceived(restocks).length ? (
                <>
                  <h5>Останні оприбутковані</h5>
                  {lastReceived(restocks).map((r) => (
                    <div className="ao-restock is-received" key={r._id}>
                      <RestockInfo r={r} />
                    </div>
                  ))}
                </>
              ) : null}
            </>
          ) : null}

          {tab === 'moves' ? (
            <>
              <div className="ao-filterbar">
                <div className="ao-chips">
                  {[['all', 'Усі'] as [string, string]].concat(
                    Object.entries(MOVE_REASONS)
                  ).map(([id, title]) => (
                    <button
                      key={id}
                      type="button"
                      className={'ao-chip' + (moveReason === id ? ' is-active' : '')}
                      onClick={() => {
                        setMoveReason(id);
                        setMovesPageNo(1);
                      }}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                <input
                  className="ao-search"
                  placeholder="Пошук за товаром або замовленням"
                  value={moveSearch}
                  onChange={(e) => {
                    setMoveSearch(e.target.value);
                    setMovesPageNo(1);
                  }}
                />
              </div>

              {/* Підсумки за фільтром, а не за сторінкою: скільки
                  одиниць надійшло і скільки вибуло загалом */}
              <div className="ao-stats">
                <div className="ao-stat">
                  <b>+{page.plus}</b>
                  <span>надійшло</span>
                </div>
                <div className="ao-stat">
                  <b>{page.minus}</b>
                  <span>вибуло</span>
                </div>
              </div>

              {page.days.length ? (
                <>
                  {page.days.map((day) => (
                    <div key={day.title}>
                      <h5 className="ao-cat-title">{day.title}</h5>
                      {day.moves.map((m, i) => (
                        <MoveRow key={i} m={m} date={moveDate(m)} />
                      ))}
                    </div>
                  ))}

                  {page.pages > 1 ? (
                    <nav className="ao-pager" aria-label="Сторінки журналу">
                      <button
                        className="ao-pager__nav"
                        type="button"
                        disabled={page.page === 1}
                        aria-label="Попередня сторінка"
                        onClick={() => setMovesPageNo(page.page - 1)}
                      >
                        ←
                      </button>
                      {/* Перша, остання й вікно навколо поточної:
                          шістнадцять кнопок поспіль не поміщаються
                          на телефон і нічим не допомагають */}
                      {pagerNumbers(page.page, page.pages).map((n, i) =>
                        n === '…' ? (
                          <span className="ao-pager__gap" key={'gap' + i}>
                            …
                          </span>
                        ) : (
                          <button
                            key={n}
                            type="button"
                            className={'ao-pager__num' + (n === page.page ? ' is-active' : '')}
                            aria-current={n === page.page ? 'page' : undefined}
                            onClick={() => setMovesPageNo(n)}
                          >
                            {n}
                          </button>
                        )
                      )}
                      <button
                        className="ao-pager__nav"
                        type="button"
                        disabled={page.page === page.pages}
                        aria-label="Наступна сторінка"
                        onClick={() => setMovesPageNo(page.page + 1)}
                      >
                        →
                      </button>
                    </nav>
                  ) : null}
                </>
              ) : (
                <div className="a-empty">
                  Журнал руху порожній. Тут фіксується кожна зміна залишків: прихід, продаж,
                  повернення, списання.
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user.email ?? ''}
      />
    </>
  );
}
