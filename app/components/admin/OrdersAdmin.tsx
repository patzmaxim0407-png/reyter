'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminBar from './AdminBar';
import SettingsDialog from './SettingsDialog';
import OrderCard from './OrderCard';
import ManualOrder from './ManualOrder';
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
  printOrders,
  type AdminOrder,
  type OrderDialogs,
  type OrderFilters
} from '@/lib/admin/orders';
import { todayISO } from '@/lib/admin/stock';
import { watchInventory } from '@/lib/admin/live';
import { doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { fmt } from '@/lib/catalog';
import { printSheet } from './printSheet';
import { trackDelete, trackUpdate } from '@/lib/track';
import type { OrderStatus, Stock } from '@/lib/types';

/* ============================================================
   Замовлення
   ------------------------------------------------------------
   Перехід статусу — найтонше місце всієї адмінки: він зачіпає
   залишки, публічне відстеження й сповіщення покупцю. Уся ця
   логіка живе в lib/admin/orders.ts, а склад вона бере з
   lib/admin/stock.ts сама. Звідси приходять лише каталог із
   залишками, час і діалоги — щоб її можна було прогнати без
   браузера.
   ============================================================ */

export default function OrdersAdmin() {
  const user = useAdminUser();
  const askDialog = useAsk();
  const toast = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [inv, setInv] = useState<Stock>({});
  const [f, setF] = useState<OrderFilters>({ ...DEFAULT_FILTERS });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [error, setError] = useState('');
  /* undefined — форма закрита; null — нове замовлення;
     обʼєкт — редагуємо наявне. */
  const [manual, setManual] = useState<AdminOrder | null | undefined>(undefined);

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
  /* Статистика — за ПЕРІОДОМ, не за пошуком: інакше виручка
     й середній чек перераховувались би на кожен символ у полі,
     і зрозуміти, скільки заробили за місяць, було б неможливо. */
  const stats = useMemo(
    () => orderStats(periodOrders(orders, f, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, f.period, f.from, f.to]
  );

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
    /* Каталог іде разом із залишками: за ним applyStatus рахує
       нестачу й списує товар — саме тим самим кодом, що й
       сторінка складу. */
    return { db: d, c, ask: dialogs, now: new Date(), by: user.email ?? '', silent };
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

  /* Друкуємо окремим вікном: інакше на аркуш ішли б смуги
     фільтрів, чіпи й кнопки, а зі згорнутої картки — жодної
     позиції, і зібрати посилку за таким аркушем неможливо. */
  const printPicked = useCallback(
    (picked: AdminOrder[]) => {
      if (!picked.length) return;
      const w = window.open('', '_blank', 'width=780,height=900');
      if (!w) {
        toast('Браузер заблокував вікно друку — дозвольте спливаючі вікна');
        return;
      }
      w.document.write(printSheet(printOrders(picked, c)));
      w.document.close();
      w.focus();
      w.print();
    },
    [c, toast]
  );

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
      <AdminBar user={user} onSettings={() => setSettingsOpen(true)} />

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

          <div className="a-toolbar">
            <h2>Замовлення</h2>
            <button className="btn btn--primary" type="button" onClick={() => setManual(null)}>
              + Нове замовлення
            </button>
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
            onPrint={() => printPicked(exportList(list, selection))}
            onClear={() => setSelection(new Set())}
          />

          {error ? <p className="ao-note">{error}</p> : null}

          {visible.length ? (
            visible.map((o) => (
              <OrderCard
                key={o._id}
                o={o as never}
                c={c}
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
                onEdit={() => setManual(o)}
                onField={async (field, value) => {
                  const d = db();
                  if (!d) return;
                  try {
                    await updateDoc(doc(d, 'orders', o._id), { [field]: value });
                    if (field === 'ttn') {
                      /* Номер накладної має доїхати й до публічного
                         запису — саме його читає гість у відстеженні.
                         Без цього ТТН бачив би лише адмін. */
                      void trackUpdate({ ...o, ttn: value } as never, { ttn: value });
                      toast('ТТН збережено — покупець бачить його в кабінеті й у відстеженні ✓', 'success');
                    } else {
                      toast('Нотатку збережено ✓', 'success');
                    }
                  } catch {
                    toast(field === 'ttn' ? 'Не вдалося зберегти ТТН' : 'Не вдалося зберегти нотатку');
                  }
                }}
                onCopy={async () => {
                  const done = await copyText(o.message || buildOrderMessage(o as never, c));
                  toast(done ? 'Скопійовано ✓' : 'Не вдалося скопіювати', done ? 'success' : 'plain');
                }}
                onPrint={() => printPicked([o])}
                onDelete={async () => {
                  /* Про списаний товар попереджаємо окремо: видалення
                     його НЕ повертає, і після нього залишки вже
                     нічим не полагодити — тільки руками. */
                  const yes = await askDialog({
                    title: 'Видалити замовлення?',
                    text:
                      `№${o.num} зникне назавжди.` +
                      (o.stockApplied
                        ? '\n\nТовар за цим замовленням списаний зі складу. При видаленні ' +
                          'він автоматично НЕ повернеться — спершу переведіть замовлення ' +
                          'у «Скасовано», якщо потрібне повернення залишків.'
                        : '\n\nДію не можна скасувати.'),
                    okText: 'Видалити',
                    danger: true
                  });
                  if (yes !== true) return;
                  const d = db();
                  if (!d) return;
                  try {
                    setSelection((sel) => {
                      const next = new Set(sel);
                      next.delete(o._id);
                      return next;
                    });
                    await deleteDoc(doc(d, 'orders', o._id));
                    // разом із замовленням прибираємо й публічне відстеження
                    if (o.trackKey) void trackDelete(o.trackKey);
                  } catch {
                    toast('Немає прав видаляти');
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
      <ManualOrder
        open={manual !== undefined}
        order={manual ?? null}
        c={c}
        orders={orders}
        by={user.email ?? ''}
        onClose={() => setManual(undefined)}
        onDone={() => setManual(undefined)}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user.email ?? ''}
      />
    </>
  );
}
