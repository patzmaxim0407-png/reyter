'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PublishControl from './PublishControl';
import SettingsDialog from './SettingsDialog';
import OrderCard from './OrderCard';
import OrdersQueue from './OrdersQueue';
import TtnCreate from './TtnCreate';
import ManualOrder from './ManualOrder';
import { ArchiveBar, BulkBar } from './OrderFilters';
import OrderRow from './OrderRow';
import { useAdminUser } from './AdminGate';
import { useAsk } from './AskProvider';
import { useToast } from '../Toasts';
import { copyText } from '@/lib/copy';
import { db, loadNotifySettings } from '@/lib/firebase';
import { sendTtn } from '@/lib/notify';
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
import { KEY_WORKER } from '@/lib/admin/settings';
import { orderDate, statusInfo } from '@/lib/admin/orders';
import { watchInventory } from '@/lib/admin/live';
import { doc, deleteDoc, setDoc, updateDoc } from 'firebase/firestore';
import { fmt } from '@/lib/catalog';
import { printSheet } from './printSheet';
import { trackDelete, trackUpdate } from '@/lib/track';
import { trackAll, підпис, статусЗаТрекером, тривога, type Посилка } from '@/lib/admin/np';
import { parcelWeight } from '@/lib/customs';
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

  /* ---------- Де зараз посилки ----------
     Перевізник знає про них більше за нас: чи доїхала, чи лежить
     пʼятий день, чи вже повертається назад. Питаємо його самі —
     ключа для цього не треба.

     Опитуємо лише те, що в дорозі й має номер, і лише поки
     вкладка на очах: смикати чужий сервер, коли адмінку згорнули
     й пішли, — ні до чого. */
  const [посилки, setПосилки] = useState<Map<string, Посилка>>(new Map());

  /* Який екран показувати. Памʼять на пристрої, не в базі: у двох
     менеджерів можуть бути різні звички, а перемикач має
     вимикатись будь-якої миті без викладки. */
  const [екран, setЕкран] = useState<'queue' | 'archive'>('queue');
  /** Яке замовлення розкрите в архіві. */
  const [розкрито, setРозкрито] = useState('');
  /** Для якого замовлення зараз створюємо накладну. */
  const [ттнДля, setТтнДля] = useState<AdminOrder | null>(null);
  /** Налаштування воркера: там лежить ключ кабінету Нової Пошти. */
  const [нала, setНала] = useState<Record<string, string>>({});
  useEffect(() => {
    void loadNotifySettings().then((s) => setНала((s || {}) as Record<string, string>));
  }, []);

  /* Ключ адміністратора воркера живе лише в браузері — у базу він
     не потрапляє навмисно: з нього можна створювати накладні за
     чужі гроші. Беремо його звідти ж, звідки його кладе вікно
     налаштувань. */
  const [ключВоркера, setКлючВоркера] = useState('');
  useEffect(() => {
    try {
      setКлючВоркера(localStorage.getItem(KEY_WORKER) ?? '');
    } catch {
      /* приватне вікно */
    }
  }, [settingsOpen]);
  useEffect(() => {
    try {
      const v = localStorage.getItem('reyter:orders-view');
      if (v === 'archive' || v === 'queue') setЕкран(v);
    } catch {
      /* приватне вікно — лишається типове */
    }
  }, []);
  const обратиЕкран = (v: 'queue' | 'archive') => {
    setЕкран(v);
    try {
      localStorage.setItem('reyter:orders-view', v);
    } catch {
      /* нічого не вдієш */
    }
  };
  const вДорозіКлюч = orders
    .map((o) =>
      o.status === 'shipped' || o.status === 'done' ? o._id + ':' + (o.ttn || '') : ''
    )
    .filter(Boolean)
    .join('|');

  /* Чи дозволено перевізникові рухати статус самому. За
     замовчуванням так: інакше «Відправлено» висить тижнями на
     посилках, які давно забрали. Вимикач на пристрої — на
     випадок, коли менеджер хоче вести статуси лише руками. */
  const [авто, setАвто] = useState(true);
  useEffect(() => {
    try {
      setАвто(localStorage.getItem('reyter:np-auto') !== 'off');
    } catch {
      /* приватне вікно — лишається типове */
    }
  }, []);
  const перемкнутиАвто = (on: boolean) => {
    setАвто(on);
    try {
      localStorage.setItem('reyter:np-auto', on ? 'on' : 'off');
    } catch {
      /* нічого не вдієш */
    }
  };

  useEffect(() => {
    /* Питаємо і про відправлені, і про недавно закриті: в архіві
       менеджер теж хоче бачити, чим скінчилось, а не порожнє
       місце там, де в черзі був стан посилки. */
    const вДорозі = orders
      .filter(
        (o) =>
          (o.status === 'shipped' || o.status === 'done') && String(o.ttn || '').trim()
      )
      .slice(0, 100)
      .map((o) => ({ ttn: o.ttn, phone: String(o.customer?.phone || '') }));
    if (!вДорозі.length) return;

    let живий = true;
    const спитати = () => {
      if (document.hidden) return;
      void trackAll(вДорозі).then((m) => {
        if (!живий || !m.size) return;
        setПосилки(m);
        if (авто) void підтягнутиСтатуси(m);
      });
    };
    спитати();
    const t = setInterval(спитати, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', спитати);
    return () => {
      живий = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', спитати);
    };
    /* Перезапитуємо, коли міняється склад посилок у дорозі, а не
       на кожен рендер списку. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [вДорозіКлюч]);

  /* ---------- Залежності для зміни статусу ---------- */

  const dialogs: OrderDialogs = useMemo(
    () => ({
      confirmAsk: async (q) => (await askDialog(q)) === true,
      ask: async (q) => {
        const r = await askDialog(q);
        if (r === 'alt') return 'alt';
        return r === true ? 'ok' : null;
      },
      askText: async (q) => {
        const r = await askDialog({
          title: q.title,
          text: q.text,
          okText: q.okText,
          input: '',
          label: q.label,
          placeholder: q.placeholder
        });
        return typeof r === 'string' ? r : null;
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

  /* Перевізник знає про посилку раніше за нас, тож нехай сам і
     рухає статус: забрали — «Виконано», поїхала — «Відправлено».

     Рухаємо тільки ВПЕРЕД і тільки два переходи. Повернення,
     відмови й помилкові номери лишаються людині: за ними стоїть
     рішення про склад і гроші, якого не можна вгадувати.

     Записуємо від імені перевізника, а не менеджера: у журналі
     має бути видно, хто саме це зробив, інакше через тиждень
     ніхто не згадає, чому статус змінився сам. */
  const підтягнутиСтатуси = useCallback(
    async (m: Map<string, Посилка>) => {
      const d = db();
      if (!d) return;
      for (const o of orders) {
        const п = m.get(String(o.ttn || '').trim());
        if (!п) continue;
        const треба = статусЗаТрекером(п);
        const зараз = o.status || 'new';
        if (!треба || треба === зараз) continue;
        if (зараз === 'cancelled' || зараз === 'done') continue;
        if (треба === 'shipped' && зараз !== 'confirmed') continue;
        if (треба === 'done' && зараз !== 'shipped') continue;

        const res = await applyStatus(o, треба as OrderStatus, {
          db: d,
          c,
          ask: dialogs,
          now: new Date(),
          by: 'Нова Пошта',
          silent: true
        });
        if (res.ok) {
          toast(
            треба === 'done'
              ? 'Нова Пошта: посилку №' + (o.num || '') + ' забрали — замовлення закрито'
              : 'Нова Пошта: посилка №' + (o.num || '') + ' вирушила — статус «Відправлено»',
            'success'
          );
        }
      }
    },
    [orders, c, dialogs, toast]
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

  /* Номер накладної покупцеві. Раніше він осідав в адмінці й
     нікуди далі не йшов — людина писала «а де посилка?», хоча
     посилка вже їхала. */
  const надіслатиТТН = useCallback(
    async (o: AdminOrder, ttn: string) => {
      const пошта = o.customer?.email || o.email || '';
      if (!пошта) {
        toast('ТТН збережено, але надіслати нема куди — покупець не лишив пошти');
        return;
      }
      const s = (await loadNotifySettings()) as { workerUrl?: string } | null;
      const res = await sendTtn(s, {
        to: пошта,
        name: o.customer?.name || '',
        orderNum: o.num || '',
        ttn: ttn,
        delivery: [o.customer?.carrier, o.customer?.city, o.customer?.branch]
          .filter(Boolean)
          .join(', '),
        lang: (o.lang as 'uk' | 'en') || 'uk'
      });
      if (res.ok) {
        const d = db();
        if (d) void updateDoc(doc(d, 'orders', o._id), { ttnSentAt: new Date().toISOString() });
        toast('ТТН надіслано покупцеві на ' + пошта + ' ✓', 'success');
      } else {
        toast('ТТН збережено, але лист не пішов: ' + res.error);
      }
    },
    [toast]
  );


  /* Ці три дії однакові на обох екранах, тож живуть тут, а не в
     розмітці картки: інакше довелося б тримати дві копії, які
     розійдуться при першій же правці. */

  const зберегтиПоле = useCallback(
    async (o: AdminOrder, field: 'ttn' | 'note', value: string) => {
      const d = db();
      if (!d) return;
      try {
        await updateDoc(doc(d, 'orders', o._id), { [field]: value });
        if (field === 'ttn') {
          /* Номер накладної має доїхати й до публічного запису —
             саме його читає гість у відстеженні. */
          void trackUpdate({ ...o, ttn: value } as never, { ttn: value });
          toast('ТТН збережено — покупець бачить його в кабінеті й у відстеженні ✓', 'success');
          // посилка вже в дорозі — номер має піти покупцеві одразу
          if (value.trim() && o.status === 'shipped') void надіслатиТТН(o, value.trim());
        } else {
          toast('Нотатку збережено ✓', 'success');
        }
      } catch {
        toast(field === 'ttn' ? 'Не вдалося зберегти ТТН' : 'Не вдалося зберегти нотатку');
      }
    },
    [toast, надіслатиТТН]
  );

  const скопіювати = useCallback(
    async (o: AdminOrder) => {
      const done = await copyText(o.message || buildOrderMessage(o as never, c));
      toast(done ? 'Скопійовано ✓' : 'Не вдалося скопіювати', done ? 'success' : 'plain');
    },
    [c, toast]
  );

  const видалити = useCallback(
    async (o: AdminOrder) => {
      /* Про списаний товар попереджаємо окремо: видалення його НЕ
         повертає, і після нього залишки вже нічим не полагодити. */
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
    },
    [askDialog, toast]
  );

  /* Скільки справ у черзі — число на вкладці. */
  const справ = orders.filter((o) => {
    const st = o.status || 'new';
    return st !== 'done' && st !== 'cancelled';
  }).length;

  /** Що каже перевізник — для рядка списку. */
  function посилкаДляРядка(o: AdminOrder) {
    const п = посилки.get(String(o.ttn || '').trim());
    return п ? { text: підпис(п), tone: тривога(п) } : undefined;
  }

  /** Коли це було — коротко, для рядка списку. */
  function shortWhen(o: AdminOrder): string {
    const d = orderDate(o);
    return d.getTime()
      ? d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
      : '';
  }

  async function onStatus(o: AdminOrder, next: string) {
    const dd = deps();
    if (!dd) return;
    const res = await applyStatus(o, next as OrderStatus, dd);
    if (res.toast) toast(res.toast.text, res.toast.success ? 'success' : 'plain');
    /* Накладну вписали просто в мить відправлення — тоді ж її й
       надсилаємо: другого підходу до цього замовлення може вже
       не бути. */
    if (res.ok && res.ttn) void надіслатиТТН(o, res.ttn);
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
      <PublishControl
        user={user}
        onSettings={() => setSettingsOpen(true)}
        newOrders={orders.filter((o) => (o.status ?? 'new') === 'new').length}
      />

      {/* Розкладка — як в admin.html: .admin-wrap це дві колонки
          каталогу з бічним списком категорій, і сторінці замовлень
          вона не підходить. */}
      <div className="a-page">
        <div className="a-page__head a-page__head--row">
          <div>
            <h2>Замовлення</h2>
            <p>
              Оформлені замовлення надходять сюди автоматично. Змінюйте статус — покупець
              бачить його у своєму кабінеті.
            </p>
          </div>
          <button className="btn btn--primary" type="button" onClick={() => setManual(null)}>
            + Нове замовлення
          </button>
        </div>

        <div className="a-orders a-orders--page">
          {/* Видно, що список живий: замовлення приходять самі,
              і сторінку не треба перезавантажувати */}
          <div className="ao-toolbar">
            <span className="ao-live">● live</span>
            <span>Нові замовлення зʼявляються автоматично</span>
          </div>

          {/* Два екрани одного вікна: у черзі — те, що треба
              зробити сьогодні; в архіві — усе, що вже сталося,
              разом із фільтрами, статистикою, CSV і друком. */}
          <div className="ao-tabs">
            <button
              type="button"
              className={'ao-tab' + (екран === 'queue' ? ' is-on' : '')}
              onClick={() => обратиЕкран('queue')}
            >
              Черга
              {справ ? <i>{справ}</i> : null}
            </button>
            <button
              type="button"
              className={'ao-tab' + (екран === 'archive' ? ' is-on' : '')}
              onClick={() => обратиЕкран('archive')}
            >
              Архів і пошук
            </button>

            {/* Статуси з Нової Пошти. Вимикач тут, а не в
                налаштуваннях: це рішення міняють не раз на рік, а
                тоді, коли перевізник почав помилятися. */}
            <label className="ao-auto" title="Забрали — «Виконано», поїхала — «Відправлено». Повернення й помилки завжди лишаються вам.">
              <input
                type="checkbox"
                checked={авто}
                onChange={(e) => перемкнутиАвто(e.target.checked)}
              />
              <span>Статуси з Нової Пошти</span>
            </label>
          </div>

          {екран === 'queue' ? (
            <OrdersQueue
              orders={orders as never}
              c={c}
              parcels={посилки}
              onStatus={(o, next) => void onStatus(o as never, next)}
              onEdit={(o) => setManual(o as never)}
              onField={(o, field, value) => void зберегтиПоле(o as never, field, value)}
              onSendTtn={(o) => void надіслатиТТН(o as never, String(o.ttn || '').trim())}
              onMakeTtn={(o) => setТтнДля(o as never)}
              onCopy={(o) => void скопіювати(o as never)}
              onPrint={(o) => printPicked([o as never])}
              onDelete={(o) => void видалити(o as never)}
            />
          ) : (
          <>

          <div className="ao-sum">
            <span>
              <b>{stats.count}</b> замовлень
            </span>
            <span>
              <b>{fmt(stats.revenue)}</b> грн
            </span>
            <span>
              середній <b>{fmt(stats.avg)}</b>
            </span>
            <span>
              <b>{stats.units}</b> одиниць
            </span>
          </div>

          <ArchiveBar
            f={f}
            set={(p) => setF((v) => ({ ...v, ...p }))}
            scope={scope}
            today={todayISO(new Date())}
          />

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

          <div className="ao-list">
          {visible.length ? (
            visible.map((o) => (
              <div key={o._id} className={'aq-item' + (розкрито === o._id ? ' is-open' : '')}>
                <OrderRow
                  num={o.num || ''}
                  name={String((o.customer as Record<string, unknown>)?.name ?? '')}
                  place={[
                    (o.customer as Record<string, unknown>)?.city,
                    (o.customer as Record<string, unknown>)?.branch
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  badge={{ id: o.status || 'new', title: statusInfo(o.status || 'new').title }}
                  parcel={
                    o.pickup ? { text: 'Самовиніс', tone: 0 as const } : посилкаДляРядка(o)
                  }
                  tone={посилкаДляРядка(o)?.tone ?? 0}
                  meta={shortWhen(o)}
                  sum={o.total || 0}
                  picked={selection.has(o._id)}
                  onPick={(on) =>
                    setSelection((sel) => {
                      const next = new Set(sel);
                      if (on) next.add(o._id);
                      else next.delete(o._id);
                      return next;
                    })
                  }
                  open={розкрито === o._id}
                  onToggle={() => setРозкрито(розкрито === o._id ? '' : o._id)}
                />

                {розкрито === o._id ? (
                  <div className="aq-details">
                    <OrderCard
                      o={o as never}
                      c={c}
                      embedded
                      parcel={посилки.get(String(o.ttn || '').trim())}
                      onStatus={(next) => void onStatus(o, next)}
                      onEdit={() => setManual(o)}
                      onField={(field, value) => void зберегтиПоле(o, field, value)}
                      onSendTtn={() => void надіслатиТТН(o, String(o.ttn || '').trim())}
                      onMakeTtn={() => setТтнДля(o)}
                      onCopy={() => void скопіювати(o)}
                      onPrint={() => printPicked([o])}
                      onDelete={() => void видалити(o)}
                    />
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            /* Порожньо через фільтр і порожньо взагалі — різні речі,
               і підказка має бути різна */
            <div className="a-empty">
              {orders.length
                ? 'За цими фільтрами нічого не знайдено. Спробуйте розширити період або скинути пошук.'
                : 'Замовлень поки немає. Щойно покупець оформить кошик — воно зʼявиться тут.'}
            </div>
          )}
          </div>

          {list.length > visible.length ? (
            <button
              className="btn btn--ghost ao-more"
              type="button"
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
            >
              Показати ще {Math.min(PAGE_SIZE, list.length - visible.length)} із{' '}
              {list.length - visible.length}
            </button>
          ) : list.length ? (
            <p className="ao-note ao-count">Показано всі {list.length}</p>
          ) : null}
          </>
          )}
        </div>
      </div>
      {ттнДля ? (
        <TtnCreate
          order={ттнДля}
          cabinet={{ workerUrl: нала.workerUrl, adminKey: ключВоркера }}
          sender={{
            city: нала.npCity || '',
            cityRef: нала.npCityRef || '',
            warehouse: нала.npWarehouse || '',
            warehouseRef: нала.npWarehouseRef || ''
          }}
          weight={parcelWeight(
            c,
            /* Позиції замовлення мають той самий вигляд, що й
               рядки кошика, — вага рахується тим самим кодом. */
            ((ттнДля.items || []) as never[]).map((i) => i as never)
          )}
          description={нала.npDescription || 'Чоловіча білизна'}
          onSaveSender={(v) => {
            const d = db();
            setНала((n) => ({
              ...n,
              npCity: v.city,
              npCityRef: v.cityRef,
              npWarehouse: v.warehouse,
              npWarehouseRef: v.warehouseRef
            }));
            /* Відділення відправлення міняють раз на рік, тож
               памʼятаємо його в налаштуваннях, а не питаємо
               щоразу. */
            if (d) void setDoc(doc(d, 'settings', 'notify'), {
              npCity: v.city, npCityRef: v.cityRef,
              npWarehouse: v.warehouse, npWarehouseRef: v.warehouseRef
            }, { merge: true });
          }}
          onDone={async (ttn) => {
            const o = ттнДля;
            setТтнДля(null);
            await зберегтиПоле(o, 'ttn', ttn);
            if ((o.status || 'new') !== 'shipped') await onStatus(o, 'shipped');
            toast('Накладну ' + ttn + ' створено ✓', 'success');
          }}
          onClose={() => setТтнДля(null)}
        />
      ) : null}

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
