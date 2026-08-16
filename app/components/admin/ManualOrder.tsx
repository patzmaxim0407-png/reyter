'use client';

import { useEffect, useMemo, useState } from 'react';
import AddressFields from '../AddressFields';
import Combobox from '../Combobox';
import ProductChip from './ProductChip';
import { useAsk } from './AskProvider';
import { useToast } from '../Toasts';
import { db } from '@/lib/firebase';
import { EMPTY_FORM, fromForm, toForm, type AddressForm } from '@/lib/address';
import { ALL_SIZES, catTitle, fmt, isSet, setParts } from '@/lib/catalog';
import type { Catalogue } from '@/lib/catalog';
import {
  STATUSES,
  applyNoPromo,
  availableSizes,
  catName,
  createManualOrder,
  findKnownCustomer,
  noItemsTotal,
  noTotal,
  normalizeSetRows,
  type AdminOrder,
  type KnownCustomer,
  type ManualForm,
  type ManualRow,
  type NoPromoHint,
  type OrderDialogs
} from '@/lib/admin/orders';
import { hasInvDoc, sizeQty, unitQty } from '@/lib/admin/stock';
import { promoFetch } from '@/lib/firebase';
import { t } from '@/lib/i18n';
import type { Promo } from '@/lib/promo';
import type { OrderStatus, Product } from '@/lib/types';

/* ============================================================
   Ручне замовлення
   ------------------------------------------------------------
   Замовлення з дзвінка, Direct або особистого спілкування.
   Обовʼязкові лише імʼя, телефон і хоча б один товар — решту
   узгоджують голосом.

   Та сама форма редагує наявне замовлення: різниця лише в тому,
   що саме лягає в базу.

   Розмітка й класи ті самі, що в старій панелі.
   ============================================================ */

let seq = 0;
const blankRow = (): ManualRow => ({ uid: 'r' + ++seq, pid: '', size: '', qty: 1, price: 0 });

export default function ManualOrder({
  open,
  order,
  c,
  orders,
  by,
  onClose,
  onDone
}: {
  open: boolean;
  /** Замовлення, яке редагують; null — нове. */
  order: AdminOrder | null;
  c: Catalogue;
  /** Усі замовлення — щоб упізнати клієнта за телефоном. */
  orders: AdminOrder[];
  by: string;
  onClose(): void;
  onDone(): void;
}) {
  const askDialog = useAsk();
  const toast = useToast();

  const [form, setForm] = useState<Omit<ManualForm, 'address'>>({
    name: '',
    phone: '',
    email: '',
    comment: '',
    discount: 0,
    shipping: 0,
    promo: '',
    notify: false
  });
  const [addr, setAddr] = useState<AddressForm>(EMPTY_FORM);
  const [rows, setRows] = useState<ManualRow[]>([blankRow()]);
  const [status, setStatus] = useState<OrderStatus>('new');
  const [source, setSource] = useState('Дзвінок');
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);

  /* Промокод: документ підтягуємо з бази й самі рахуємо знижку.
     Поле знижки лишається редагованим — auto памʼятає, скільки
     туди підставив код, щоб не затерти суму, вписану руками. */
  const [promoDoc, setPromoDoc] = useState<Promo | null>(null);
  const [loadedFor, setLoadedFor] = useState('');
  const [auto, setAuto] = useState(0);
  const [hint, setHint] = useState<NoPromoHint>({ kind: '', text: '', personal: null });

  useEffect(() => {
    if (!open) return;
    setProgress('');
    setBusy(false);

    if (!order) {
      setForm({ name: '', phone: '', email: '', comment: '', discount: 0, shipping: 0, promo: '', notify: false });
      setAddr(EMPTY_FORM);
      setRows([blankRow()]);
      setStatus('new');
      setSource('Дзвінок');
      return;
    }

    const cu = (order.customer ?? {}) as Record<string, unknown>;
    setForm({
      name: String(cu.name ?? ''),
      phone: String(cu.phone ?? ''),
      email: String(cu.email ?? order.email ?? ''),
      comment: String(cu.comment ?? ''),
      discount: Number(order.discount) || 0,
      shipping: Number(order.shipping) || 0,
      promo: order.promoCode ?? '',
      notify: false
    });
    setAddr(toForm(cu as never));
    setRows(
      (order.items ?? []).map((i) => ({
        uid: 'r' + ++seq,
        pid: i.id,
        size: i.size ?? '',
        qty: i.qty,
        price: i.price,
        parts: (i.parts ?? []).map((x) => ({ id: x.id, size: x.size ?? '' }))
      }))
    );
    setSource(String((order as { source?: string }).source ?? 'Дзвінок'));
    /* Стежимо за НОМЕРОМ замовлення, а не за обʼєктом.

       Замовлення приходять живою підпискою, і кожен її кадр
       створює нові обʼєкти — а прилітають вони будь-якої миті:
       хтось оформив кошик, менеджер змінив статус. Доки в
       залежностях стояв сам обʼєкт, така подія переписувала
       відкриту форму заново й затирала все набране. Заповнювати
       замовлення руками довго, і втрачати його на півдорозі
       через чужу дію не можна. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?._id]);

  /* Комплект у рядку має свій набір складників: коли товар
     змінили, старі розміри належать уже іншому комплекту */
  const normalized = useMemo(() => normalizeSetRows(rows, c), [rows, c]);

  /* Код читаємо один раз на код, а не на кожну літеру */
  useEffect(() => {
    const code = form.promo.trim().toUpperCase();
    if (!code || code === loadedFor) return;
    let alive = true;
    void promoFetch(code).then((doc) => {
      if (!alive) return;
      setPromoDoc((doc as Promo | null) ?? null);
      setLoadedFor(code);
    });
    return () => {
      alive = false;
    };
  }, [form.promo, loadedFor]);

  /* Перерахунок знижки: і коли міняють код, і коли міняють кошик */
  useEffect(() => {
    const plan = applyNoPromo(
      {
        code: form.promo,
        doc: promoDoc,
        loadedFor,
        discount: form.discount,
        auto,
        email: form.email,
        rows: normalized,
        force: false
      },
      c,
      { t, categoryTitle: (id) => catName(c, id) }
    );
    if (plan.pending) return;
    setHint(plan.hint);
    setAuto(plan.auto);
    if (plan.discount !== null) {
      setForm((v) => ({ ...v, discount: plan.discount === '' ? 0 : (plan.discount as number) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.promo, promoDoc, loadedFor, normalized, form.email]);

  const goods = noItemsTotal(normalized, c);
  const total = noTotal(normalized, c, form.discount, form.shipping);

  /* Клієнта впізнаємо за телефоном: у постійних покупців усе вже
     є в попередніх замовленнях, і набирати наново незручно */
  const known = useMemo(
    () => (order ? null : findKnownCustomer(orders, form.phone)),
    [orders, form.phone, order]
  );

  /* Відправлене й виконане замовлення в частині «куди» і «що»
     вважаємо закритим: накладна вже надрукована, товар списаний і
     лежить у коробці. Решту — імʼя, телефон, пошту, коментар,
     суми — правити можна, це буває треба. */
  const sealed = !!order && (order.status === 'shipped' || order.status === 'done');

  if (!open) return null;

  const dialogs: OrderDialogs = {
    confirmAsk: async (q) => (await askDialog(q)) === true,
    ask: async (q) => {
      const r = await askDialog(q);
      if (r === 'alt') return 'alt';
      return r === true ? 'ok' : null;
    },
    askWriteoff: async () => null,
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
    }
  };

  function setRow(uid: string, patch: Partial<ManualRow>) {
    setRows((v) => v.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  }

  async function submit() {
    const d = db();
    if (!d) return toast('Немає звʼязку з базою');

    setBusy(true);
    try {
      const res = await createManualOrder(
        { ...form, address: fromForm(addr) },
        normalized,
        c,
        {
          db: d,
          ask: dialogs,
          now: new Date(),
          by,
          status,
          source,
          editing: order,
          onProgress: setProgress
        }
      );
      if (res.ok) {
        toast(res.toast.text, res.toast.success ? 'success' : 'plain');
        onDone();
        onClose();
        return;
      }
      if (res.kind !== 'cancelled') toast(res.message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <div className="a-modal" role="dialog" aria-modal="true">
      <div className="a-modal__backdrop" onClick={onClose} />
      <div className="a-modal__panel">
        <header className="a-modal__head">
          <h3>{order ? `Замовлення №${order.num}` : 'Нове замовлення'}</h3>
          <button className="a-modal__close" type="button" aria-label="Закрити" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="a-neworder">
          <p className="ao-note">
            Замовлення з дзвінка, Direct або особистого спілкування. Обовʼязкові лише імʼя,
            телефон і хоча б один товар.
          </p>

          <h5 className="ao-sub">Клієнт</h5>
          <div className="a-grid-3">
            <div className="field">
              <label htmlFor="noName">Прізвище та імʼя *</label>
              <input
                id="noName"
                autoComplete="off"
                placeholder="Олег Петренко"
                value={form.name}
                onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="noPhone">Телефон *</label>
              <input
                id="noPhone"
                type="tel"
                autoComplete="off"
                placeholder="+380..."
                value={form.phone}
                onChange={(e) => setForm((v) => ({ ...v, phone: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="noEmail">Пошта (для листа-підтвердження)</label>
              <input
                id="noEmail"
                type="email"
                autoComplete="off"
                placeholder="необовʼязково"
                value={form.email}
                onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}
              />
            </div>
          </div>

          {/* Плашка «впізнали покупця». Читається згори вниз:
              хто це, чим уже був, і аж потім кнопка. Раніше все
              лежало одним рядком суцільним текстом, і кнопка
              висіла просто в реченні. */}
          {known ? (
            <div className="ao-known">
              <span className="ao-known__mark" aria-hidden="true">
                ↺
              </span>
              <span className="ao-known__who">
                <b>{String(known.customer.name ?? '') || 'Постійний покупець'}</b>
                <i>{knownMeta(known)}</i>
              </span>
              <button
                className="btn btn--ghost btn--sm ao-known__fill"
                type="button"
                onClick={() => {
                  /* Підставляємо все разом: імʼя, пошту й адресу.
                     У постійного покупця вони вже є в попередніх
                     замовленнях, і набирати наново незручно. */
                  setForm((v) => ({
                    ...v,
                    name: String(known.customer.name ?? v.name),
                    email: String(known.customer.email ?? '') || v.email
                  }));
                  setAddr(toForm(known.customer));
                }}
              >
                Підставити дані
              </button>
            </div>
          ) : null}

          <h5 className="ao-sub">Доставка</h5>
          {/* Відправлене замовлення адресу вже має — надруковану на
              накладній. Змінити її тут означало б розійтися з
              наклейкою на коробці: посилка поїде за старою, а
              магазин думатиме, що за новою. Те саме з товарами:
              вони вже в коробці й уже списані зі складу.

              Заборона рамкою, а не по полю: браузер сам вимикає
              все, що всередині, — і поля, і кнопки, і випадайки,
              тож жодне не лишиться відкритим через недогляд. */}
          <fieldset className="a-locked" disabled={sealed}>
            <AddressFields
              prefix="no"
              v={addr}
              set={(patch) => setAddr((a) => ({ ...a, ...patch }))}
            />
          </fieldset>

          <h5 className="ao-sub">Товари</h5>
          {sealed ? (
            <p className="ao-note ao-note--locked">
              Замовлення вже {order?.status === 'done' ? 'виконане' : 'відправлене'} — адресу й товари
              змінити не можна. Помилка в адресі виправляється новою накладною, помилка в товарах —
              поверненням або новим замовленням.
            </p>
          ) : null}
          <fieldset className="a-locked" disabled={sealed}>
          <div className="a-noitems">
            {/* Заголовки стовпців один раз угорі, а не підпис над
                кожним полем у кожному рядку: так видно, що
                стовпці рівні, і рядок читається як таблиця. */}
            <div className="a-norow a-norow--head" aria-hidden="true">
              <span>Товар</span>
              <span>Розмір</span>
              <span>К-сть</span>
              <span>Ціна</span>
              <span className="a-norow__sum">Сума</span>
              <span />
            </div>

            {rows.map((row) => {
              const p = c.products.find((x) => x.id === row.pid) ?? null;
              const parts = p && isSet(p) ? setParts(c, p) : [];
              const inv = { products: c.products, inv: c.stock ?? {} };

              /* «Залишок піде в мінус» — не заборона, а попередження:
                 продати наперед іноді треба, але бачити це адмін
                 мусить. Товар без обліку не рахуємо взагалі. */
              const short = parts.length
                ? parts.some((part) => {
                    if (!hasInvDoc(inv, part.id)) return false;
                    const sz = (row.parts ?? []).find((x) => x.id === part.id)?.size;
                    if (!sz) return false;
                    const have = availableSizes(c, part).length
                      ? sizeQty(inv, part.id, sz)
                      : unitQty(inv, part.id);
                    return have < row.qty;
                  })
                : !!p &&
                  hasInvDoc(inv, p.id) &&
                  !!row.size &&
                  sizeQty(inv, p.id, row.size) < row.qty;

              const withQty = (pid: string, sz: string) =>
                hasInvDoc(inv, pid) ? `${sz} (${sizeQty(inv, pid, sz)} шт)` : sz;

              return (
                <div className={'a-norow' + (short ? ' is-short' : '')} key={row.uid}>
                  <span className="a-norow__product">
                    {/* Той самий вибір, що й у приході на складі: з
                        фото, артикулом, категорією й ціною. У каталозі
                        є позиції з майже однаковими назвами — «Бріфи
                        classic» і «Бріфи classic Black», «Майка black»
                        двічі — і за самим рядком не видно, що саме
                        обрано. Фото знімає це питання одразу, а помилка
                        тут коштує неправильно зібраної посилки. */}
                    <Combobox
                      id={'noProd-' + row.uid}
                      label=""
                      className="acombo a-nopick"
                      chip={p ? <ProductChip p={p} /> : null}
                      value={p ? p.name : ''}
                      placeholder="оберіть товар — назва або артикул"
                      empty="Нічого не знайдено"
                      minChars={0}
                      openOnFocus
                      search={async (q) => {
                        const s = q.trim().toLowerCase();
                        /* Прихованих на сайті НЕ відсіюємо: саме
                           їх найчастіше й продають з дзвінка —
                           залишок, який не показують, зняту з
                           продажу позицію, домовлений викуп. Що
                           товар прихований, видно в самому
                           рядку. */
                        return c.products
                          .filter(
                            (x) =>
                              !s ||
                              (x.name + ' ' + x.id + ' ' + catTitle(c, x.category))
                                .toLowerCase()
                                .includes(s)
                          )
                          /* Показуємо весь каталог. Різати список
                             заради ваги не треба: фото тепер
                             кешуються назавжди, а перше відкриття
                             тягне лише те, що видно — решта
                             чекає прокрутки. Межу тримає сам
                             Combobox — і, на відміну від колишніх
                             шістдесяти, каже про неї вголос. */
                          .map((x) => ({
                            ref: x.id,
                            text: x.name,
                            value: x.name,
                            cls: 'a-pick',
                            node: (
                              <>
                                <img
                                  className="a-pick__img"
                                  src={x.images?.[0] ?? ''}
                                  alt=""
                                  /* Розміри в самій розмітці: без
                                     них браузер не знає, скільки
                                     місця займе знімок, і тягне
                                     всі одразу замість тих, що
                                     видно. */
                                  width={34}
                                  height={44}
                                  loading="lazy"
                                  decoding="async"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                                  }}
                                />
                                <span className="a-pick__body">
                                  <b>{x.name}</b>
                                  <i>
                                    {x.id} · {catTitle(c, x.category)} · {fmt(x.price)} грн
                                    {x.hidden ? ' · прихований на сайті' : ''}
                                  </i>
                                </span>
                              </>
                            )
                          }));
                      }}
                      onType={() => setRow(row.uid, { pid: '', size: '', parts: null })}
                      onPick={(it) => {
                        const picked = c.products.find((x) => x.id === it.ref);
                        setRow(row.uid, {
                          pid: it.ref,
                          size: '',
                          parts: null,
                          // ціну підставляємо з каталогу, але лишаємо редагованою
                          price: Number(picked?.price) || 0
                        });
                      }}
                    />
                  </span>

                  <span className="a-norow__size">
                    {parts.length ? (
                      /* Комплект — це кілька товарів, і розмір у
                         кожного свій: по одному вибору на складник */
                      <span className="a-norow__set">
                        {parts.map((part) => (
                          <label className="a-norow__setrow" key={part.id}>
                            <span>{part.name}</span>
                            <select
                              value={(row.parts ?? []).find((x) => x.id === part.id)?.size ?? ''}
                              onChange={(e) =>
                                setRow(row.uid, {
                                  parts: [
                                    ...(row.parts ?? []).filter((x) => x.id !== part.id),
                                    { id: part.id, size: e.target.value }
                                  ]
                                })
                              }
                            >
                              <option value="">розмір</option>
                              {availableSizes(c, part).map((sz) => (
                                <option value={sz} key={sz}>
                                  {withQty(part.id, sz)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </span>
                    ) : !p ? (
                      <select disabled>
                        <option>—</option>
                      </select>
                    ) : (
                      <select
                        value={row.size}
                        onChange={(e) => setRow(row.uid, { size: e.target.value })}
                      >
                        <option value="">розмір</option>
                        {availableSizes(c, p).map((sz) => (
                          <option value={sz} key={sz}>
                            {withQty(p.id, sz)}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>

                  <span className="a-norow__qty">
                    <input
                      type="number"
                      min="1"
                      value={row.qty}
                      placeholder="К-сть"
                      aria-label="Кількість"
                      onChange={(e) => setRow(row.uid, { qty: Math.max(1, Number(e.target.value) || 1) })}
                    />
                  </span>

                  <span className="a-norow__price">
                    <input
                      type="number"
                      min="0"
                      value={row.price}
                      placeholder="Ціна"
                      aria-label="Ціна за штуку"
                      onChange={(e) => setRow(row.uid, { price: Math.max(0, Number(e.target.value) || 0) })}
                    />{' '}
                    грн
                  </span>

                  {/* Без «Разом:» — стовпець уже підписано «Сума»
                      вгорі, а зайве слово розпирало клітинку й
                      налазило на хрестик. */}
                  <span className="a-norow__sum">{fmt(row.price * row.qty)} грн</span>

                  <button
                    className="a-norow__del"
                    type="button"
                    title="Прибрати"
                    aria-label="Прибрати рядок"
                    /* Останній рядок не прибираємо, а очищаємо:
                       форма завжди має один рядок для товару, але
                       натиснути ✕ і не отримати нічого — це те
                       саме, що зламана кнопка. Найчастіший привід
                       натиснути її саме такий: обрали не той
                       товар і хочуть почати спочатку. */
                    onClick={() =>
                      setRows((v) =>
                        v.length > 1
                          ? v.filter((x) => x.uid !== row.uid)
                          : [blankRow()]
                      )
                    }
                  >
                    ✕
                  </button>

                  {short ? (
                    <span className="a-norow__warn">
                      {parts.length
                        ? 'Складників не вистачає — залишок піде в мінус'
                        : `На складі лише ${p ? sizeQty(inv, p.id, row.size) : 0} шт — залишок піде в мінус`}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={() => setRows((v) => [...v, blankRow()])}
          >
            + Додати товар
          </button>
          </fieldset>

          <h5 className="ao-sub">Підсумок</h5>
          <div className="a-grid-3">
            <div className="field">
              <label htmlFor="noPromo">Промокод</label>
              <input
                id="noPromo"
                autoComplete="off"
                placeholder="необовʼязково"
                value={form.promo}
                onChange={(e) => setForm((v) => ({ ...v, promo: e.target.value.toUpperCase() }))}
              />
              {hint.text ? <p className={'field__hint ' + hint.kind}>{hint.text}</p> : null}
            </div>
            <div className="field">
              <label htmlFor="noDiscount">Знижка, грн</label>
              <input
                id="noDiscount"
                type="number"
                min="0"
                value={form.discount || ''}
                onChange={(e) => setForm((v) => ({ ...v, discount: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="field">
              <label htmlFor="noShipping">Доставка, грн</label>
              <input
                id="noShipping"
                type="number"
                min="0"
                value={form.shipping || ''}
                onChange={(e) => setForm((v) => ({ ...v, shipping: Number(e.target.value) || 0 }))}
              />
            </div>
          </div>

          <div className="ao-sums">
            <div className="ao-sumline">
              <span>Товари</span>
              <span>{fmt(goods)} грн</span>
            </div>
            {form.discount ? (
              <div className="ao-sumline is-off">
                <span>Знижка{form.promo ? ` · ${form.promo}` : ''}</span>
                <span>−{fmt(form.discount)} грн</span>
              </div>
            ) : null}
            {form.shipping ? (
              <div className="ao-sumline">
                <span>Доставка</span>
                <span>{fmt(form.shipping)} грн</span>
              </div>
            ) : null}
            <div className="ao-sumline is-total">
              <span>До сплати</span>
              <span>{fmt(total)} грн</span>
            </div>
          </div>

          {order ? null : (
            <div className="a-grid-2">
              <div className="field">
                <label htmlFor="noStatus">Статус</label>
                <select
                  id="noStatus"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as OrderStatus)}
                >
                  {STATUSES.map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.title}
                    </option>
                  ))}
                </select>
                <p className="field__hint">
                  Підтверджене й пізніші статуси одразу списують товар зі складу.
                </p>
              </div>
              <div className="field">
                <label htmlFor="noSource">Звідки</label>
                <select id="noSource" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option>Дзвінок</option>
                  <option>Direct</option>
                  <option>Особисто</option>
                  <option>Інше</option>
                </select>
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="noComment">Коментар</label>
            <input
              id="noComment"
              autoComplete="off"
              value={form.comment}
              onChange={(e) => setForm((v) => ({ ...v, comment: e.target.value }))}
            />
          </div>

          {/* Лист іде лише коли є пошта — інакше галочка нічого
              не означає */}
          <label className="a-check a-check--pad">
            <input
              type="checkbox"
              checked={!!form.notify}
              disabled={!form.email.trim()}
              onChange={(e) => setForm((v) => ({ ...v, notify: e.target.checked }))}
            />{' '}
            Надіслати покупцеві лист-підтвердження
          </label>

          {progress ? <div className="a-publish__status is-wait">{progress}</div> : null}
        </div>

        <footer className="a-modal__foot">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void submit()}>
            {order ? 'Зберегти зміни' : 'Створити замовлення'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* Другий рядок плашки: скільки разів замовляв і куди возили
   востаннє. Відділення скорочуємо до номера — повна назва
   («Відділення №1: вул. Городоцька, 359») ламала б рядок і
   нічого не додавала: адресу видно нижче у формі. */
function knownMeta(known: KnownCustomer): string {
  const c = known.customer as Record<string, unknown>;
  const branch = String(c.branch ?? '');
  const short = /№\s*\d+/.exec(branch)?.[0] || (branch ? 'відділення' : '');
  return [ordersWord(known.orders), [c.city, short].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(' · ');
}

/** «1 замовлення», «2 замовлення», «5 замовлень». */
function ordersWord(n: number): string {
  if (!n) return '';
  const two = n % 100;
  const one = n % 10;
  const word = two >= 11 && two <= 14 ? 'замовлень' : one === 1 || (one >= 2 && one <= 4) ? 'замовлення' : 'замовлень';
  return n + ' ' + word;
}
