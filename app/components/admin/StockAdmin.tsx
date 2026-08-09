'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminBar from './AdminBar';
import StockRow from './StockRow';
import MoveRow from './MoveRow';
import RestockForm, { type RestockSubmit, type SizeCell } from './RestockForm';
import { useAdminUser } from './AdminGate';
import { useAsk } from './AskProvider';
import { useToast } from '../Toasts';
import { db } from '@/lib/firebase';
import { EMPTY_DRAFT, watchDraft, type Draft } from '@/lib/admin/store';
import { loadMoves, loadRestocks, watchInventory, type Doc } from '@/lib/admin/live';
import {
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
  planReceive,
  planWriteoff,
  receiveRestock,
  restockOverdue,
  restockTotal,
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

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [inv, setInv] = useState<Stock>({});
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [tab, setTab] = useState<Tab>('stock');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [movesPageNo, setMovesPageNo] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => watchDraft(setDraft), []);
  useEffect(
    () => watchInventory((v) => setInv(v as Stock), (e) => setError(e.text)),
    []
  );

  const reload = useCallback(async () => {
    setRestocks((await loadRestocks()) as unknown as Restock[]);
    setMoves((await loadMoves()) as unknown as Move[]);
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
    draft.products.forEach((p) => {
      if (isSetOf(s, p)) return;
      const n = totalQty(s, p);
      units += n;
      value += n * (Number(p.price) || 0);
      if (stockRow(s, p).state.cls === 'is-low') low++;
    });
    return { units, value, low };
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

  async function onRestockSubmit(v: RestockSubmit) {
    const w = writer();
    if (!w) return;
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
        if (!res.ok) return toast(res.message);
        toast('Прихід додано ✓', 'success');
      } else {
        const plan = planWriteoff(s, {
          productId: v.productId,
          reason: v.reason as never,
          note: v.note,
          sizes: v.qty,
          qty: v.qty['']
        });
        if (!plan.ok) return toast(plan.message);

        /* Списати більше, ніж є, зазвичай означає помилку в цифрі —
           але не завжди: товар могли продати повз систему */
        if (plan.over.length) {
          const go = await ask({
            title: 'Списати більше, ніж є?',
            text: plan.overWarning,
            okText: 'Усе одно списати',
            danger: true
          });
          if (go !== true) return;
        }
        const yes = await ask({
          title: 'Списання',
          text: plan.confirm,
          okText: 'Списати',
          danger: true
        });
        if (yes !== true) return;

        const res = await createWriteoff(w, plan);
        if (!res.ok) return toast(res.message);
        toast('Списано ✓', 'success');
      }
      await reload();
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
      <AdminBar user={user} />

      <div className="admin-wrap admin-wrap--wide">
        <main className="a-main">
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
          </div>

          <div className="ao-filterbar">
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
                  onClick={() => setTab(id)}
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
                busy={busy}
                onSubmit={(v) => void onRestockSubmit(v)}
              />

              <h5 className="ao-cat-title">Очікуються</h5>
              {restocks.filter((r) => r.status !== 'received').length ? (
                restocks
                  .filter((r) => r.status !== 'received')
                  .map((r) => (
                    <div
                      className={'ao-restock' + (restockOverdue(r, new Date()) ? ' is-late' : '')}
                      key={r._id}
                    >
                      <div className="ao-restock__info">
                        <b>{r.productName || r.productId}</b>
                        <span>
                          {restockTotal(r)} шт
                          {r.expected ? ' · до ' + r.expected : ''}
                          {r.note ? ' · ' + r.note : ''}
                        </span>
                      </div>
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
                        >
                          Видалити
                        </button>
                      </div>
                    </div>
                  ))
              ) : (
                <div className="a-empty">Немає приходів у черзі.</div>
              )}
            </>
          ) : null}

          {tab === 'moves' ? (
            <>
              <div className="ao-filterbar">
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
                    <div className="ao-pager">
                      {Array.from({ length: page.pages }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={'ao-chip' + (n === page.page ? ' is-active' : '')}
                          onClick={() => setMovesPageNo(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
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
        </main>
      </div>
    </>
  );
}
