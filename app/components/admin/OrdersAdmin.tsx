'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminBar from './AdminBar';
import OrderCard from './OrderCard';
import { BulkBar, PeriodBar, StatusBar } from './OrderFilters';
import { useAdminUser } from './AdminGate';
import { useAsk } from './AskProvider';
import { useToast } from '../Toasts';
import { copyText } from '@/lib/copy';
import { db } from '@/lib/firebase';
import { EMPTY_DRAFT, watchDraft, type Draft } from '@/lib/admin/store';
import { watchOrders } from '@/lib/admin/live';
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  applyStatus,
  buildOrderMessage,
  bulkStatus,
  csvName,
  exportCSV,
  exportList,
  filteredOrders,
  matchesSearch,
  orderStats,
  periodOrders,
  type AdminOrder,
  type OrderDialogs,
  type OrderFilters,
  type StockOps
} from '@/lib/admin/orders';
import {
  adjustOrderStock,
  collectStock,
  logMoves,
  stockShortage,
  writeStock,
  todayISO,
  type StockState
} from '@/lib/admin/stock';
import { watchInventory } from '@/lib/admin/live';
import { doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { fmt } from '@/lib/catalog';
import type { OrderStatus, Stock } from '@/lib/types';

/* ============================================================
   Замовлення
   ------------------------------------------------------------
   Перехід статусу — найтонше місце всієї адмінки: він зачіпає
   залишки, публічне відстеження й сповіщення покупцю. Уся ця
   логіка живе в lib/admin/orders.ts; сюди вона приходить із
   двома залежностями — складом і діалогами, — щоб її можна було
   прогнати без браузера.
   ============================================================ */

export default function OrdersAdmin() {
  const user = useAdminUser();
  const askDialog = useAsk();
  const toast = useToast();

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [inv, setInv] = useState<Stock>({});
  const [f, setF] = useState<OrderFilters>({ ...DEFAULT_FILTERS });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [error, setError] = useState('');

  useEffect(
    () =>
      watchOrders(
        (list) => setOrders(list as unknown as AdminOrder[]),
        (o) => toast('🛍 Нове замовлення №' + String(o.num ?? ''), 'success'),
        (e) => setError(e.text)
      ),
    [toast]
  );
  useEffect(() => watchDraft(setDraft), []);
  useEffect(() => watchInventory((v) => setInv(v as Stock)), []);

  const c = useMemo(
    () => ({ products: draft.products, stock: inv, categories: draft.categories }),
    [draft, inv]
  );
  const s: StockState = useMemo(
    () => ({ products: draft.products, inv }),
    [draft.products, inv]
  );

  const now = new Date();
  const scope = useMemo(
    () => periodOrders(orders, f, now).filter((o) => matchesSearch(o, f.search)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, f]
  );
  const list = useMemo(
    () => filteredOrders(orders, f, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, f]
  );
  const visible = list.slice(0, limit);
  const stats = useMemo(() => orderStats(scope), [scope]);

  /* Вибір тримається за id, тож зниклі з фільтра позиції треба
     прибирати самим — інакше масова дія зачепила б те, чого
     адмін уже не бачить */
  useEffect(() => {
    setSelection((sel) => {
      const alive = new Set(list.map((o) => o._id));
      const next = new Set([...sel].filter((id) => alive.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [list]);

  /* ---------- Залежності для зміни статусу ---------- */

  /* Замовлення накопичують зміни залишків у спільну мапу, а
     журнал руху пишуть одразу — саме на це розраховує applyStatus.
     Модуль складу натомість збирає обидва в один план, тож моста
     між ними будуємо тут: групи віддаємо викликачу, а рухи
     кладемо в пакет тієї ж миті. */
  const stockOps: StockOps = useMemo(() => {
    const w = () => {
      const d = db();
      return d ? { db: d, by: user.email ?? '' } : null;
    };
    return {
      stockShortage: (order) => stockShortage(s, order),
      collectStock: (batch, order, direction, into, reason, refText) => {
        const writer = w();
        if (!writer) return;
        const plan = { groups: into, moves: [] };
        collectStock(s, order, direction, plan, reason as never, refText);
        logMoves(writer, batch, plan.moves);
      },
      writeStock: (batch, grouped) => {
        const writer = w();
        if (writer) writeStock(writer, batch, grouped);
      },
      adjustOrderStock: (batch, order, direction, reason) => {
        const writer = w();
        if (writer) adjustOrderStock(writer, batch, s, order, direction, reason as never);
      }
    };
  }, [s, user]);

  const dialogs: OrderDialogs = useMemo(
    () => ({
      confirmAsk: async (q) => (await askDialog(q)) === true,
      ask: async (q) => {
        const r = await askDialog(q);
        if (r === 'alt') return 'alt';
        return r === true ? 'ok' : null;
      },
      askWriteoff: async (q) => {
        const r = await askDialog({
          title: q.title,
          text: q.text,
          okText: q.okText,
          danger: q.danger,
          input: '',
          label: q.label,
          placeholder: q.placeholder,
          select: { label: q.label, options: [...q.reasons], value: q.reason }
        });
        return r && typeof r === 'object' ? (r as { reason: string; note: string }) : null;
      }
    }),
    [askDialog]
  );

  function deps(silent = false) {
    const d = db();
    if (!d) {
      toast('Немає звʼязку з базою');
      return null;
    }
    return { db: d, stock: stockOps, ask: dialogs, now: new Date(), by: user.email ?? '', silent };
  }

  async function onStatus(o: AdminOrder, next: string) {
    const dd = deps();
    if (!dd) return;
    const res = await applyStatus(o, next as OrderStatus, dd);
    if (res.toast) toast(res.toast.text, res.toast.success ? 'success' : 'plain');
  }

  async function onBulk(next: string) {
    const dd = deps(true);
    if (!dd) return;
    const res = await bulkStatus(list, [...selection], next as OrderStatus, dd);
    if ('toast' in res) toast(res.toast.text, res.toast.success ? 'success' : 'plain');
    if (res.kind === 'done' || res.kind === 'already') setSelection(new Set());
  }

  const download = useCallback(
    (name: string, text: string, type: string) => {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    []
  );

  return (
    <>
      <AdminBar user={user} />

      <div className="admin-wrap admin-wrap--wide">
        <main className="a-main">
          <div className="ao-stats">
            <div className="ao-stat">
              <b>{stats.count}</b>
              <span>замовлень</span>
            </div>
            <div className="ao-stat">
              <b>{fmt(stats.revenue)}</b>
              <span>грн виручки</span>
            </div>
            <div className="ao-stat">
              <b>{fmt(stats.avg)}</b>
              <span>середній чек</span>
            </div>
            <div className="ao-stat">
              <b>{stats.units}</b>
              <span>одиниць товару</span>
            </div>
          </div>

          <PeriodBar f={f} set={(p) => setF((v) => ({ ...v, ...p }))} today={todayISO(new Date())} />
          <StatusBar f={f} set={(p) => setF((v) => ({ ...v, ...p }))} scope={scope} />

          <BulkBar
            visible={visible.length}
            selected={selection.size}
            onSelectAll={(on) => setSelection(on ? new Set(visible.map((o) => o._id)) : new Set())}
            onBulkStatus={(id) => void onBulk(id)}
            onExport={() =>
              download(
                csvName(new Date()),
                exportCSV(exportList(list, selection), c),
                'text/csv;charset=utf-8'
              )
            }
            onPrint={() => window.print()}
            onClear={() => setSelection(new Set())}
          />

          {error ? <p className="ao-note">{error}</p> : null}

          {visible.length ? (
            visible.map((o) => (
              <OrderCard
                key={o._id}
                o={o as never}
                picked={selection.has(o._id)}
                onPick={(on) =>
                  setSelection((sel) => {
                    const next = new Set(sel);
                    if (on) next.add(o._id);
                    else next.delete(o._id);
                    return next;
                  })
                }
                onStatus={(next) => void onStatus(o, next)}
                onField={async (field, value) => {
                  const d = db();
                  if (!d) return;
                  try {
                    await updateDoc(doc(d, 'orders', o._id), { [field]: value });
                  } catch {
                    toast('Не вдалося зберегти');
                  }
                }}
                onCopy={async () => {
                  const done = await copyText(o.message || buildOrderMessage(o as never, c));
                  toast(done ? 'Скопійовано ✓' : 'Не вдалося скопіювати', done ? 'success' : 'plain');
                }}
                onPrint={() => window.print()}
                onDelete={async () => {
                  const yes = await askDialog({
                    title: 'Видалити замовлення?',
                    text:
                      `№${o.num} зникне назавжди.\n\n` +
                      'Якщо товар уже списано зі складу, залишки це не поверне — ' +
                      'спершу скасуйте замовлення.',
                    okText: 'Видалити',
                    danger: true
                  });
                  if (yes !== true) return;
                  const d = db();
                  if (!d) return;
                  try {
                    await deleteDoc(doc(d, 'orders', o._id));
                  } catch {
                    toast('Не вдалося видалити');
                  }
                }}
              />
            ))
          ) : (
            <div className="a-empty">За цим фільтром замовлень немає.</div>
          )}

          {list.length > visible.length ? (
            <button
              className="btn btn--ghost"
              type="button"
              style={{ width: '100%' }}
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
            >
              Показати ще ({list.length - visible.length})
            </button>
          ) : null}
        </main>
      </div>
    </>
  );
}
