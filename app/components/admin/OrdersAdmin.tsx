'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { db } from '@/lib/firebase';
import { sendTtn } from '@/lib/notify';
import { EMPTY_DRAFT, watchDraft, type Draft } from '@/lib/admin/store';
import { watchOrders } from '@/lib/admin/live';
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  applyStatus,
  queue,
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
import { KEY_WORKER, loadAdminSettings } from '@/lib/admin/settings';
import { orderDate, statusInfo } from '@/lib/admin/orders';
import { watchInventory } from '@/lib/admin/live';
import { doc, deleteDoc, setDoc, updateDoc } from 'firebase/firestore';
import { fmt } from '@/lib/catalog';
import { printSheet } from './printSheet';
import { trackDelete, trackUpdate } from '@/lib/track';
import {
  trackAll,
  deleteWaybill,
  shortLabel,
  statusFromTracker,
  alarm,
  parcelState,
  type Parcel
} from '@/lib/admin/np';
import { parcelWeight } from '@/lib/customs';
import { payLabel, payStatus, payTone, type PayStatus } from '@/lib/pay';
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
  const [parcels, setParcels] = useState<Map<string, Parcel>>(new Map());

  /* Який екран показувати. Памʼять на пристрої, не в базі: у двох
     менеджерів можуть бути різні звички, а перемикач має
     вимикатись будь-якої миті без викладки. */
  const [view, setScreen] = useState<'queue' | 'archive'>('queue');
  /** Яке замовлення розкрите в архіві. */
  const [openId, setOpen] = useState('');
  /** Для якого замовлення зараз створюємо накладну. */
  const [ttnFor, setTtnFor] = useState<AdminOrder | null>(null);
  /** Налаштування воркера: там лежить ключ кабінету Нової Пошти. */
  const [settings, setSettings] = useState<Record<string, string>>({});
  useEffect(() => {
    /* Саме службові налаштування, а не публічні. Публічні читає
       браузер покупця, тож ключів і відділення відправлення в них
       немає й бути не може — а я спершу брав їх звідти, і тому
       ані спільний ключ, ані збережене відділення не доїжджали. */
    const d = db();
    if (!d) return;
    void loadAdminSettings(d).then((s) => setSettings((s || {}) as Record<string, string>));
  }, []);

  /* Ключ адміністратора воркера живе лише в браузері — у базу він
     не потрапляє навмисно: з нього можна створювати накладні за
     чужі гроші. Беремо його звідти ж, звідки його кладе вікно
     налаштувань. */
  const [ownWorkerKey, setWorkerKey] = useState('');
  useEffect(() => {
    try {
      setWorkerKey((localStorage.getItem(KEY_WORKER) ?? '').trim());
    } catch {
      /* приватне вікно */
    }
  }, [settingsOpen]);

  /* Свого ключа може не бути зовсім — у менеджера, який щойно
     сів за адмінку. Тоді беремо спільний із налаштувань: інакше
     він не створить жодної накладної, доки хтось не продиктує
     йому рядок. */
  const workerKey = ownWorkerKey || String(settings.adminKey || '').trim();
  useEffect(() => {
    try {
      const v = localStorage.getItem('reyter:orders-view');
      if (v === 'archive' || v === 'queue') setScreen(v);
    } catch {
      /* приватне вікно — лишається типове */
    }
  }, []);
  const pickView = (v: 'queue' | 'archive') => {
    setScreen(v);
    try {
      localStorage.setItem('reyter:orders-view', v);
    } catch {
      /* нічого не вдієш */
    }
  };
  const inTransitKey = orders
    .map((o) =>
      o.status === 'shipped' || o.status === 'done' ? o._id + ':' + (o.ttn || '') : ''
    )
    .filter(Boolean)
    .join('|');

  /* Чи дозволено перевізникові рухати статус самому. За
     замовчуванням так: інакше «Відправлено» висить тижнями на
     посилках, які давно забрали. Вимикач на пристрої — на
     випадок, коли менеджер хоче вести статуси лише руками. */
  const [autoStatus, setAuto] = useState(true);
  /* Ефект опитування підписується один раз і застигає на тому,
     що бачив у ту мить: знята галочка не діяла, а статуси
     підтягувались за старим списком — і трекер закривав удруге
     те, що менеджер щойно закрив руками. */
  const autoRef = useRef(autoStatus);
  autoRef.current = autoStatus;
  useEffect(() => {
    try {
      setAuto(localStorage.getItem('reyter:np-auto') !== 'off');
    } catch {
      /* приватне вікно — лишається типове */
    }
  }, []);
  const toggleAuto = (on: boolean) => {
    setAuto(on);
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
    const inTransit = orders
      .filter(
        (o) =>
          (o.status === 'shipped' || o.status === 'done') && String(o.ttn || '').trim()
      )
      /* Спершу ті, що їдуть: у жваві дні сотня найновіших — це
         переважно виконані, і саме ті посилки, заради яких усе
         це робиться, у запит не потрапляли. */
      .sort((a, b) => (a.status === 'shipped' ? -1 : 1) - (b.status === 'shipped' ? -1 : 1))
      .slice(0, 200)
      .map((o) => ({ ttn: o.ttn, phone: String(o.customer?.phone || '') }));
    if (!inTransit.length) return;

    let alive = true;
    const ask = () => {
      if (document.hidden) return;
      void trackAll(inTransit).then((m) => {
        if (!alive || !m.size) return;
        /* Домішуємо, а не заміщаємо: якщо одна пачка не доїхала,
           рядок «лежить пʼятий день» не має перетворюватись на
           «у дорозі» саме тоді, коли на нього треба реагувати. */
        setParcels((stale) => {
          const merged = new Map(stale);
          for (const [k, v] of m) merged.set(k, v);
          return merged;
        });
        if (autoRef.current) void syncRef.current(m);
      });
    };
    ask();
    const t = setInterval(ask, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', ask);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', ask);
    };
    /* Перезапитуємо, коли міняється склад посилок у дорозі, а не
       на кожен рендер списку. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inTransitKey]);

  /* ---------- Що з оплатою ----------
     Стан оплати в нас не зберігається ніде — щоразу питаємо
     банк. Тому й підробити його неможливо: у базі його просто
     немає. Питаємо лише про ті замовлення, де рахунок узагалі
     виставлявся, і лише поки вкладка на очах. */
  const [pays, setPays] = useState<Map<string, PayStatus>>(new Map());

  /* Рахунків у замовлення може бути кілька: перший — той, що
     покупець отримав на сайті, наступні виставляв менеджер. Новий
     гасить попередній, але вже оплачений лишається оплаченим, і
     менеджер має його бачити, а не порожнє місце. */
  const invoicesOf = useCallback((o: AdminOrder) => {
    const all = [String(o.payInvoiceId || ''), ...(o.payAll ?? []).map(String)];
    return [...new Set(all.filter(Boolean))];
  }, []);

  const payKey = orders
    .flatMap((o) => invoicesOf(o))
    .slice(0, 120)
    .join('|');

  const askPays = useCallback(
    async (only?: string[]) => {
      const url = String(settings.workerUrl || '');
      if (!url) return;
      const list = only && only.length ? only : payKey.split('|').filter(Boolean);
      /* По черзі, а не залпом: сотня одночасних запитів у банк —
         це найкоротший шлях до того, щоб він перестав відповідати
         саме тоді, коли треба. */
      for (const invoice of list) {
        const r = await payStatus(url, invoice);
        if (r.ok) setPays((was) => new Map(was).set(invoice, r));
      }
    },
    [payKey, settings.workerUrl]
  );
  const askRef = useRef(askPays);
  askRef.current = askPays;

  useEffect(() => {
    if (!payKey) return;

    let alive = true;
    /* Рахунки, за якими грошей ще немає, перепитуємо часто: саме
       їх менеджер і тримає на очах, чекаючи на оплату. Оплачені й
       повернуті не міняються — їх досить питати зрідка.

       Доти стояло п'ять хвилин на всіх, і виглядало це так, наче
       статус не оновлюється взагалі. */
    const tick = async (all: boolean) => {
      if (!alive || document.hidden) return;
      const list = payKey.split('|').filter(Boolean);
      const waiting = list.filter((id) => {
        const state = pays.get(id)?.state;
        return !state || state === 'created' || state === 'processing';
      });
      await askRef.current(all ? list : waiting);
    };

    void tick(true);
    const fast = setInterval(() => void tick(false), 20 * 1000);
    const slow = setInterval(() => void tick(true), 5 * 60 * 1000);
    const wake = () => void tick(true);
    document.addEventListener('visibilitychange', wake);
    return () => {
      alive = false;
      clearInterval(fast);
      clearInterval(slow);
      document.removeEventListener('visibilitychange', wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payKey, settings.workerUrl]);

  /* Оплачене замовлення підтверджується саме: гроші в магазині —
     значить, домовленість відбулась, і чекати ще й кліку
     менеджера немає сенсу. Робимо це рівно один раз на
     замовлення: applyStatus списує товар зі складу, і повторний
     виклик списав би його вдруге. */
  const confirmedByPay = useRef<Set<string>>(new Set());
  /* Через ref, бо сам обробник оголошений нижче: ефект живе весь
     час, а функція перестворюється на кожен рендер. */
  const confirmPaid = useRef<(o: AdminOrder) => void | Promise<void>>(() => {});
  useEffect(() => {
    if (!autoRef.current) return;
    for (const o of orders) {
      const invoice = String(o.payInvoiceId || '');
      if (!invoice || o.status !== 'new') continue;
      const paid = pays.get(invoice);
      if (!paid || paid.state !== 'success') continue;
      if (confirmedByPay.current.has(o._id)) continue;
      confirmedByPay.current.add(o._id);
      void confirmPaid.current(o);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pays, orders]);

  /* Показуємо найважливіший зі станів: якщо хоч за одним
     рахунком гроші пройшли — замовлення оплачене, хоч би скільки
     невдалих спроб було до того. */
  const RANK: Record<string, number> = {
    success: 5, hold: 4, processing: 3, reversed: 2, created: 1, failure: 0, expired: 0
  };
  const payOf = useCallback(
    (o: AdminOrder) => {
      const known = invoicesOf(o)
        .map((id) => pays.get(id))
        .filter(Boolean) as PayStatus[];
      if (!known.length) return undefined;
      return known.slice().sort((a, b) => (RANK[b.state] ?? 0) - (RANK[a.state] ?? 0))[0];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pays, invoicesOf]
  );

  /* Виставити рахунок і надіслати листом. Ціни бере воркер із
     каталогу — менеджер не може виставити «на око». */
  const sendPayLink = useCallback(
    async (o: AdminOrder) => {
      const url = String(settings.workerUrl || '');
      const to = String((o.customer as Record<string, unknown>)?.email || o.email || '');
      if (!to) return toast('У замовленні немає пошти — нема куди надсилати');
      const yes = await askDialog({
        title: 'Надіслати посилання на оплату?',
        text: 'Покупець отримає лист із кнопкою «Оплатити». Рахунок дійсний 30 хвилин.',
        okText: 'Надіслати'
      });
      if (yes !== true) return;

      const { payLink } = await import('@/lib/pay');
      const previous = String(o.payInvoiceId || '');
      const r = await payLink(url, workerKey, {
        previousInvoiceId: previous,
        orderNum: o.num || '',
        items: (o.items ?? []).map((i) => ({ id: i.id, size: i.size ?? '', qty: Number(i.qty) || 1 })),
        promo: o.promoCode || '',
        shipping: Number(o.shipping) || 0,
        email: to,
        name: String((o.customer as Record<string, unknown>)?.name || ''),
        lang: (o.lang === 'en' ? 'en' : 'uk') as 'uk' | 'en'
      });
      if (!r.ok) {
        /* Найважливіший випадок: за замовлення вже платили.
           Нового рахунку немає й не буде — інакше з людини
           візьмуть удруге. */
        toast(r.error || 'Рахунок не виставлено');
        if (r.paidAlready) void askPays([previous]);
        return;
      }

      /* Номер нового рахунку кладемо в замовлення, а старий — у
         історію: він уже погашений, але якщо за ним усе-таки
         пройшли гроші, менеджер має це бачити, а не порожнє
         місце. */
      const d = db();
      if (d) {
        await updateDoc(doc(d, 'orders', o._id), {
          payInvoiceId: r.invoiceId,
          payAll: [...new Set([...(o.payAll ?? []), previous].filter(Boolean))]
        });
      }
      void askPays([r.invoiceId, previous].filter(Boolean));
      toast(
        r.mailed
          ? 'Посилання на оплату надіслано на ' + to
          : 'Рахунок виставлено, але лист не пішов: ' + (r.mailError || 'невідомо чому'),
        r.mailed ? 'success' : 'plain'
      );
    },
    [askDialog, askPays, settings.workerUrl, toast, workerKey]
  );

  /* Повернення коштів. Двічі питаємо: гроші йдуть назад одразу,
     і скасувати це вже не можна. */
  const refund = useCallback(
    async (o: AdminOrder, paid: number) => {
      const invoice = String(o.payInvoiceId || '');
      if (!invoice) return;
      const answer = await askDialog({
        title: 'Повернути кошти?',
        text:
          'Покупцеві повернеться ' + fmt(paid) + ' грн за замовленням №' + (o.num || '') +
          '. Щоб повернути частину — впишіть суму; порожнє поле означає повне повернення.',
        okText: 'Повернути',
        input: '',
        label: 'Сума повернення, грн',
        placeholder: String(paid)
      });
      if (typeof answer !== 'string') return;
      const part = Math.max(0, Math.round(Number(String(answer).replace(',', '.')) || 0));
      if (part > paid) return toast('Більше, ніж оплачено, повернути не можна');

      const { payRefund } = await import('@/lib/pay');
      const r = await payRefund(String(settings.workerUrl || ''), workerKey, invoice, part);
      // стан міняється тієї ж миті — питаємо банк одразу, не чекаючи черги
      if (r.ok) void askPays([invoice]);
      toast(
        r.ok ? 'Кошти повертаються — банк опрацює за кілька хвилин' : 'Не вдалося: ' + r.error,
        r.ok ? 'success' : 'plain'
      );
    },
    [askDialog, askPays, settings.workerUrl, toast, workerKey]
  );

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
  const syncStatuses = useCallback(
    async (m: Map<string, Parcel>) => {
      const d = db();
      if (!d) return;
      for (const o of orders) {
        const parcel = m.get(String(o.ttn || '').trim());
        if (!parcel) continue;
        const want = statusFromTracker(parcel);
        const now = o.status || 'new';
        if (!want || want === now) continue;
        if (now === 'cancelled' || now === 'done') continue;
        if (want === 'shipped' && now !== 'confirmed') continue;
        /* Менеджер міг свідомо відкотити «Відправлено →
           Підтверджено»: домовились переоформити, покупець
           передумав. Слід цього рішення є в журналі — і воно
           важить більше за те, що посилка ще фізично лежить у
           відділенні. */
        if (
          want === 'shipped' &&
          (o.statusLog || []).some((e) => e.status === 'shipped')
        ) {
          continue;
        }
        if (want === 'done' && now !== 'shipped') continue;

        const res = await applyStatus(o, want as OrderStatus, {
          db: d,
          c,
          ask: dialogs,
          now: new Date(),
          by: 'Нова Пошта',
          silent: true
        });
        if (res.ok) {
          toast(
            want === 'done'
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
  const sendTtnLetter = useCallback(
    async (o: AdminOrder, ttn: string) => {
      const mail = o.customer?.email || o.email || '';
      if (!mail) {
        toast('ТТН збережено, але надіслати нема куди — покупець не лишив пошти');
        return;
      }
      const res = await sendTtn({ workerUrl: settings.workerUrl }, {
        to: mail,
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
        toast('ТТН надіслано покупцеві на ' + mail + ' ✓', 'success');
      } else {
        toast('ТТН збережено, але лист не пішов: ' + res.error);
      }
    },
    [toast, settings.workerUrl]
  );


  /* Ці три дії однакові на обох екранах, тож живуть тут, а не в
     розмітці картки: інакше довелося б тримати дві копії, які
     розійдуться при першій же правці. */

  const saveField = useCallback(
    async (o: AdminOrder, field: 'ttn' | 'note', value: string, letter = true) => {
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
          if (letter && value.trim() && o.status === 'shipped') void sendTtnLetter(o, value.trim());
        } else {
          toast('Нотатку збережено ✓', 'success');
        }
      } catch {
        toast(field === 'ttn' ? 'Не вдалося зберегти ТТН' : 'Не вдалося зберегти нотатку');
      }
    },
    [toast, sendTtnLetter]
  );

  const copyOrder = useCallback(
    async (o: AdminOrder) => {
      const done = await copyText(o.message || buildOrderMessage(o as never, c));
      toast(done ? 'Скопійовано ✓' : 'Не вдалося скопіювати', done ? 'success' : 'plain');
    },
    [c, toast]
  );

  const removeOrder = useCallback(
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

  /* Скільки справ у черзі — тим самим кодом, що й сама черга.
     Інакше на вкладці «14», а робити треба три речі: решта
     спокійно їде, і черга справами їх не вважає. На такий
     лічильник перестають дивитися за тиждень. */
  const todo = useMemo(
    () =>
      queue(orders as never, parcels as never, new Date())
        .filter((s) => s.band.id !== 'transit' && s.band.id !== 'pickup')
        .reduce((n, s) => n + s.rows.length, 0),
    [orders, parcels]
  );

  /** Що каже перевізник — для рядка списку. */
  function parcelForRow(o: AdminOrder) {
    const parcel = parcels.get(String(o.ttn || '').trim());
    return parcel
      ? { text: shortLabel(parcel), tone: alarm(parcel), state: parcelState(parcel.code) }
      : undefined;
  }

  /** Коли це було — коротко, для рядка списку. */
  function shortWhen(o: AdminOrder): string {
    const d = orderDate(o);
    return d.getTime()
      ? d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })
      : '';
  }

  /* Скасувати накладну. Доки посилку не прийняли у відділенні,
     перевізник дозволяє це — і саме тоді замовлення ще можна
     виправити: розмір, склад, адресу. Після скасування статус
     відкочуємо на «Підтверджено», інакше замовлення лишалося б
     «Відправленим» без жодної посилки. */
  const cancelWaybill = useCallback(
    async (o: AdminOrder) => {
      const ttn = String(o.ttn || '').trim();
      if (!ttn) return;

      const yes = await askDialog({
        title: 'Скасувати накладну?',
        text:
          'Накладна ' + ttn + ' буде видалена в кабінеті Нової Пошти, а замовлення ' +
          'повернеться в «Підтверджено» — його знову можна буде редагувати.' +
          '\n\nЦе працює, доки посилку не прийняли у відділенні. Якщо вона вже в дорозі, ' +
          'перевізник відмовить.',
        okText: 'Скасувати накладну',
        danger: true
      });
      if (yes !== true) return;

      const res = await deleteWaybill(
        { workerUrl: settings.workerUrl, adminKey: workerKey },
        ttn,
        o.ttnRef
      );
      if (!res.ok) {
        toast('Накладну не скасовано: ' + res.error);
        return;
      }

      const d = db();
      if (d) {
        try {
          await updateDoc(doc(d, 'orders', o._id), { ttn: '', ttnRef: '', ttnSentAt: '' });
          void trackUpdate({ ...o, ttn: '' } as never, { ttn: '' });
        } catch {
          /* У кабінеті вже видалено, а в нас номер лишився —
             мовчати про це не можна: далі трекер шукав би
             неіснуючу накладну й ставив замовлення в
             «Повернення й помилки» з вигаданою причиною. */
          toast('Накладну в кабінеті видалено, але номер у замовленні не стерся — зітріть його вручну');
          return;
        }
      }
      if ((o.status || 'new') === 'shipped') {
        /* Саме 'confirmed', а не 'new': товар уже підтверджений і
           списаний, і повертати його на склад тут нема потреби —
           замовлення просто чекає нової накладної. */
        await onStatus({ ...o, ttn: '' } as AdminOrder, 'confirmed');
      }
      toast('Накладну скасовано — замовлення знову можна редагувати ✓', 'success');
    },
    [askDialog, toast, settings.workerUrl, workerKey]
  );

  const syncRef = useRef(syncStatuses);
  syncRef.current = syncStatuses;

  /* Накладна вже в кабінеті перевізника, а форма редагування
     переписує імʼя, телефон і адресу — у накладній вони
     лишаються старими. Тихо це робити не можна. */
  const editOrder = useCallback(
    async (o: AdminOrder) => {
      if (String(o.ttn || '').trim()) {
        const yes = await askDialog({
          title: 'Накладна вже створена',
          text:
            'У замовленні є накладна ' + o.ttn + '. Зміни в імені, телефоні чи адресі в неї ' +
            'НЕ потраплять — там лишиться те, що вже надруковано.' +
            '\n\nЯкщо міняється саме доставка — спершу скасуйте накладну, а потім створіть нову.',
          okText: 'Все одно редагувати'
        });
        if (yes !== true) return;
      }
      setManual(o);
    },
    [askDialog]
  );

  confirmPaid.current = (o: AdminOrder) => onStatus(o, 'confirmed');

  async function onStatus(o: AdminOrder, next: string) {
    const dd = deps();
    if (!dd) return;
    const res = await applyStatus(o, next as OrderStatus, dd);
    if (res.toast) toast(res.toast.text, res.toast.success ? 'success' : 'plain');
    /* Накладну вписали просто в мить відправлення — тоді ж її й
       надсилаємо: другого підходу до цього замовлення може вже
       не бути. */
    /* Номер могли вписати руками ще до відправлення — тоді лист
       не йшов узагалі: збереження шле його лише для вже
       відправлених, а перехід — лише для щойно введеного. */
    const num = res.ttn || String(o.ttn || '').trim();
    if (res.ok && next === 'shipped' && num && !o.ttnSentAt) void sendTtnLetter(o, num);
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
          {/* Два екрани одного вікна: у черзі — те, що треба
              зробити сьогодні; в архіві — усе, що вже сталося,
              разом із фільтрами, статистикою, CSV і друком. */}
          <div className="ao-tabs">
            <button
              type="button"
              className={'ao-tab' + (view === 'queue' ? ' is-on' : '')}
              onClick={() => pickView('queue')}
            >
              Черга
              {todo ? <i>{todo}</i> : null}
            </button>
            <button
              type="button"
              className={'ao-tab' + (view === 'archive' ? ' is-on' : '')}
              onClick={() => pickView('archive')}
            >
              Архів і пошук
            </button>

            {/* Статуси з Нової Пошти. Вимикач тут, а не в
                налаштуваннях: це рішення міняють не раз на рік, а
                тоді, коли перевізник почав помилятися. */}
            <label className="ao-auto" title="Забрали — «Виконано», поїхала — «Відправлено». Повернення й помилки завжди лишаються вам.">
              <input
                type="checkbox"
                checked={autoStatus}
                onChange={(e) => toggleAuto(e.target.checked)}
              />
              <span>Статуси з Нової Пошти</span>
            </label>
          </div>

          {/* Помилка читання бази має бути видна на ОБОХ екранах:
              інакше черга бадьоро малює «Усе зроблено» саме тоді,
              коли замовлення є, а їх не видно. */}
          {error ? <p className="ao-note ao-error">{error}</p> : null}

          {view === 'queue' ? (
            <OrdersQueue
              orders={orders as never}
              c={c}
              parcels={parcels}
              payOf={(o) => payOf(o as never)}
              onPayLink={(o) => void sendPayLink(o as never)}
              onPayBack={(o, paid) => void refund(o as never, paid)}
              onStatus={(o, next) => void onStatus(o as never, next)}
              onEdit={(o) => void editOrder(o as never)}
              onField={(o, field, value) => void saveField(o as never, field, value)}
              onSendTtn={(o) => void sendTtnLetter(o as never, String(o.ttn || '').trim())}
              onMakeTtn={(o) => setTtnFor(o as never)}
              onDropTtn={(o) => void cancelWaybill(o as never)}
              onCopy={(o) => void copyOrder(o as never)}
              onPrint={(o) => printPicked([o as never])}
              onDelete={(o) => void removeOrder(o as never)}
            />
          ) : (
          <>

          <div className="ao-sum">
            {/* «підпис: число» — так не треба узгоджувати число з
                іменником і зрозуміло, що саме показано. */}
            <span>
              Замовлень: <b>{stats.count}</b>
            </span>
            <span>
              Виручка: <b>{fmt(stats.revenue)} грн</b>
            </span>
            <span>
              Середній чек: <b>{fmt(stats.avg)} грн</b>
            </span>
            <span>
              Одиниць товару: <b>{stats.units}</b>
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


          {/* Смужка зліва фарбується статусом — в архіві саме він і
              потрібен оку. Тривога перевізника (u-1/u-2) цей колір
              перебиває: те, що горить, має лишатись помітним і
              серед виконаних. */}
          <div className="ao-list">
          {visible.length ? (
            visible.map((o) => (
              <div
                key={o._id}
                className={
                  'aq-item st-' +
                  (o.status || 'new') +
                  ' u-' +
                  (parcelForRow(o)?.tone ?? 0) +
                  (openId === o._id ? ' is-open' : '')
                }
              >
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
                    o.pickup ? { text: 'Самовиніс', tone: 0 as const } : parcelForRow(o)
                  }
                  pay={(() => {
                    const r = payOf(o);
                    return r ? { text: payLabel(r.state), tone: payTone(r.state) } : undefined;
                  })()}
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
                  open={openId === o._id}
                  onToggle={() => setOpen(openId === o._id ? '' : o._id)}
                />

                {openId === o._id ? (
                  <div className="aq-details">
                    <OrderCard
                      o={o as never}
                      c={c}
                      embedded
                      parcel={parcels.get(String(o.ttn || '').trim())}
                      onStatus={(next) => void onStatus(o, next)}
                      onEdit={() => void editOrder(o)}
                      onField={(field, value) => void saveField(o, field, value)}
                      pay={payOf(o)}
                      onPayLink={() => void sendPayLink(o)}
                      onPayBack={() => void refund(o, payOf(o)?.amount ?? o.total ?? 0)}
                      onSendTtn={() => void sendTtnLetter(o, String(o.ttn || '').trim())}
                      onMakeTtn={() => setTtnFor(o)}
                      onDropTtn={() => void cancelWaybill(o)}
                      onCopy={() => void copyOrder(o)}
                      onPrint={() => printPicked([o])}
                      onDelete={() => void removeOrder(o)}
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
      {ttnFor ? (
        <TtnCreate
          order={ttnFor}
          cabinet={{ workerUrl: settings.workerUrl, adminKey: workerKey }}
          sender={{
            city: settings.npCity || '',
            cityRef: settings.npCityRef || '',
            warehouse: settings.npWarehouse || '',
            warehouseRef: settings.npWarehouseRef || ''
          }}
          weight={parcelWeight(
            c,
            /* Позиції замовлення мають той самий вигляд, що й
               рядки кошика, — вага рахується тим самим кодом. */
            ((ttnFor.items || []) as never[]).map((i) => i as never)
          )}
          description={settings.npDescription || 'Чоловіча білизна'}
          onSaveSender={(v) => {
            const d = db();
            setSettings((n) => ({
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
          onDone={async (ttn, ref) => {
            const o = ttnFor;
            setTtnFor(null);
            // лист надішлемо наприкінці самі — інакше їх буде два
            await saveField(o, 'ttn', ttn, false);
            /* Ідентифікатор документа знадобиться, якщо накладну
               доведеться скасувати: видаляють саме за ним. */
            const d0 = db();
            if (d0 && ref) void updateDoc(doc(d0, 'orders', o._id), { ttnRef: ref });

            /* Далі — з ОНОВЛЕНОЮ копією замовлення. Зі старою
               перевірка не бачила щойно створеного номера й
               питала його вдруге, просто у вікні поверх щойно
               створеної накладної. */
            const fresh = { ...o, ttn } as AdminOrder;
            /* Виконане замовлення накладна не відкочує назад:
               накладну для нього створюють на обмін або дослання,
               і «Відправлено» тут було б неправдою. */
            if (['new', 'confirmed'].includes(o.status || 'new')) {
              await onStatus(fresh, 'shipped');
            }

            /* І лист. Сам він не пішов би: зберігання надсилає
               його лише тоді, коли замовлення вже «Відправлено»,
               а в цю мить воно ще не було. */
            void sendTtnLetter(fresh, ttn);
            toast('Накладну ' + ttn + ' створено ✓', 'success');
          }}
          onClose={() => setTtnFor(null)}
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
