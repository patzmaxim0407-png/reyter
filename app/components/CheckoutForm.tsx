'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from './LangProvider';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from './CartProvider';
import AddressFields, { focusAddressField } from './AddressFields';
import PromoField from './PromoField';
import type { User } from 'firebase/auth';
import * as cart from '@/lib/cart';
import * as fb from '@/lib/firebase';
import { catTitle, getProduct, uah } from '@/lib/catalog';
import {
  EMPTY_FORM,
  addressLine,
  checkAddress,
  createAddrBook,
  fromForm,
  toForm,
  type AddressForm,
  type SavedAddress
} from '@/lib/address';
import { buildMessage, buildOrder, checkCustomer, MESSENGERS, type Confirm, type Customer } from '@/lib/order';
import { freeReached, quote, underwearSum, type Quote } from '@/lib/delivery';
import { orderPlaced } from '@/lib/notify';
import { promoCheck, promoMessage, promoSaveCode, promoSavedCode, type Promo } from '@/lib/promo';

/* ============================================================
   Оформлення замовлення
   ------------------------------------------------------------
   Сторінка, а не крок у панелі кошика: на неї можна повернутись
   назад, кинути посилання й побачити її в історії браузера.

   Порядок дій при відправці той самий, що й був, і саме в такому
   порядку: перевірити поля → перечитати промокод із бази →
   перевірити адресу → зберегти профіль → створити замовлення.
   ============================================================ */

const EMPTY_CONFIRM: Confirm = {
  method: 'messenger',
  messenger: 'telegram',
  phoneMode: 'main',
  altPhone: ''
};

export default function CheckoutForm() {
  const { t, lang } = useLang();
  const { c, lines, subtotal, clear } = useCart();
  const router = useRouter();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(EMPTY_CONFIRM);
  const [tg, setTg] = useState('');
  const [addr, setAddr] = useState<AddressForm>(EMPTY_FORM);
  const [saveAddr, setSaveAddr] = useState(true);

  /* Промокод живе тут, а не в полі: при зміні кошика його треба
     перевіряти заново, і поле мусить це побачити. */
  const [promo, setPromo] = useState<Promo | null>(null);
  const [discount, setDiscount] = useState(0);
  const [partial, setPartial] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);

  const [user, setUser] = useState<User | null>(null);

  /* null — ще не обрано; '' — вводимо нову адресу; id — узяли
     збережену. Без книги вибирати нема з чого, і форма
     показується одразу. */
  const [pickedAddr, setPickedAddr] = useState<string | null>(null);

  const [bad, setBad] = useState<{ field: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  /* Профіль підставляємо після монтування: на сервері його немає,
     і поля, заповнені одразу, розійшлися б із розміткою */
  useEffect(() => {
    const p = cart.getProfile();
    setName(String(p.name || ''));
    setPhone(String(p.phone || ''));
    setEmail(String(p.email || ''));
    setAddr(toForm(p));
    const saved = p.confirm as (Confirm & { phoneMode?: string }) | undefined;
    if (saved) {
      setConfirm({
        ...EMPTY_CONFIRM,
        ...saved,
        /* Старий сайт писав у профіль 'same'. Якби ми лишили це
           значення як є, жодна з двох радіокнопок не була б
           позначена — покупець побачив би порожній вибір. */
        phoneMode: saved.phoneMode === 'other' ? 'other' : 'main'
      });
      setTg(String(saved.telegram || ''));
    }
  }, []);

  /* Пошту залогіненого покупця підставляємо, якщо в профілі
     її ще немає — питати те, що ми вже знаємо, зайве */
  useEffect(
    () =>
      fb.watchAuth((u) => {
        setUser(u);
        if (u?.email) setEmail((v) => v || u.email || '');
      }),
    []
  );

  /* Адресна книга профілю: у покупця їх зазвичай кілька —
     собі, на роботу, рідним. */
  const book = useMemo(
    () =>
      createAddrBook({
        get: () => cart.getProfile(),
        save: (p) => {
          cart.saveProfile(p);
          const u = fb.auth()?.currentUser;
          if (u) void fb.saveCloudProfile(u.uid, u.email ?? '', p);
        }
      }),
    []
  );
  const [addrList, setAddrList] = useState<SavedAddress[]>([]);
  const [addrOpen, setAddrOpen] = useState(false);

  useEffect(() => {
    const list = book.list();
    setAddrList(list);
    // є що обрати — беремо основну; немає — одразу форма
    const def = list.length ? book.defaultId() || list[0].id : '';
    setPickedAddr(def);
    setAddrOpen(!def);
    if (def) setAddr(toForm(book.get(def)));
  }, [book]);

  function pickAddr(id: string) {
    setPickedAddr(id);
    setAddrOpen(!id);
    setAddr(id ? toForm(book.get(id)) : EMPTY_FORM);
    setBad(null);
  }

  /* Умови промокоду перевіряємо заново на кожну зміну кошика:
     прибрали товар — і код із порогом суми більше не діє.
     Без цього знижка лишалась би намальованою, а база її
     не визнала б уже при відправці. */
  useEffect(() => {
    if (!promo) return;
    const res = promoCheck(promo, cart.forPromo(c), null, user?.email ?? '');
    if (res.ok) {
      setDiscount(res.discount ?? 0);
      setPartial(!!res.partial);
      return;
    }
    setPromo(null);
    setDiscount(0);
    setPartial(false);
    promoSaveCode('');
    setPromoMsg({ ok: false, text: promoMessage(res, promo, promoDeps(!user)) });
  }, [lines, promo, c, user]);

  function promoDeps(guest: boolean) {
    return {
      t,
      categoryTitle: (id: string) => catTitle(c, id),
      productName: (id: string) => c.products.find((x) => x.id === id)?.name ?? '',
      guest
    };
  }

  async function applyPromo(code: string, silent = false) {
    setPromoBusy(true);
    const who = user?.email ?? '';
    const found = (await fb.promoFetch(code)) as Promo | null;
    const res = promoCheck(found, cart.forPromo(c), null, who);
    setPromoBusy(false);

    if (res.ok) {
      setPromo(found);
      setDiscount(res.discount ?? 0);
      setPartial(!!res.partial);
      setPromoMsg(null);
      promoSaveCode(code);
      return;
    }
    setPromo(null);
    setDiscount(0);
    setPartial(false);
    promoSaveCode('');
    /* Мовчки — коли код підтягнувся зі сховища сам: покупець
       щойно нічого не вводив, і докір йому ні за що */
    if (!silent) setPromoMsg({ ok: false, text: promoMessage(res, found, promoDeps(!who)) });
  }

  /* Раніше застосований код перечитуємо з бази: адмін міг його
     вимкнути або він міг протермінуватись, поки кошик лежав */
  useEffect(() => {
    const saved = promoSavedCode();
    if (saved) void applyPromo(saved, true);
    // разово, на монтуванні
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Вартість доставки ----------
     Перевізник має назвати ціну ще до «Підтвердити»: людина
     мусить розуміти, у що їй стане замовлення, а не дізнаватись
     це у відділенні.

     Хто платить — вибір покупця. По Україні звично платити при
     отриманні, тож так і стоїть за замовчуванням. За кордон
     платить відправник, тобто ми, — там вибору немає, і сума
     входить у замовлення. */
  const goods = Math.max(0, subtotal - discount);
  const freeShip = freeReached(underwearSum(c, lines));
  const [ship, setShip] = useState<Quote | null>(null);
  const [payShip, setPayShip] = useState<'branch' | 'order'>('branch');

  const carrier = addr.carrier;
  const cityRef = addr.cityRef;
  const branch = addr.branch;
  const country = addr.countryCode;
  const intlCity = addr.intlCity;

  useEffect(() => {
    let живий = true;
    setShip(null);
    void quote({
      carrier,
      cityRef,
      // ознаки поштомата у формі немає — впізнаємо за назвою
      postomat: /поштомат|postomat/i.test(branch || ''),
      country,
      city: intlCity,
      declared: goods,
      free: freeShip
    }).then((q) => {
      if (живий) setShip(q);
    });
    return () => {
      живий = false;
    };
  }, [carrier, cityRef, branch, country, intlCity, goods, freeShip]);

  /* За кордон «оплачу у відділенні» не буває: для відправлень з
     України платить відправник. */
  useEffect(() => {
    if (carrier === 'intl') setPayShip('order');
  }, [carrier]);

  const shipCost = ship && !ship.unknown && !ship.free ? ship.cost : 0;
  const shipInTotal = payShip === 'order' ? shipCost : 0;
  const total = goods + shipInTotal;

  const canSubmit = lines.length > 0 && !sending;

  async function submit() {
    if (!canSubmit) return;
    setBad(null);

    const who = checkCustomer({ name, phone, email });
    if (who) {
      setBad({ field: who.field, text: t(who.key) });
      const map = { name: nameRef, phone: phoneRef, email: emailRef };
      map[who.field].current?.focus();
      return;
    }

    setSending(true);
    try {
      /* Промокод перечитуємо з бази саме зараз: між застосуванням
         і натисканням «Підтвердити» його могли вимкнути, вичерпати
         або він міг протермінуватись. Інакше замовлення пішло б
         зі знижкою, яку база вже не визнає. */
      let code = '';
      let off = 0;
      if (promo) {
        const who = user?.email ?? '';
        const fresh = (await fb.promoFetch(promo.code ?? '')) as Promo | null;
        // пошту передаємо й тут: без неї персональний код власника
        // не пройшов би останню перевірку, хоч щойно був прийнятий
        const res = promoCheck(fresh, cart.forPromo(c), null, who);
        if (!res.ok) {
          setPromo(null);
          setDiscount(0);
          setPartial(false);
          promoSaveCode('');
          setPromoMsg({ ok: false, text: promoMessage(res, fresh, promoDeps(!who)) });
          setBad({ field: 'promo', text: t('promo.dropped') });
          return;
        }
        code = promo.code ?? '';
        off = res.discount ?? 0;
        setDiscount(off);
      }

      const problem = checkAddress(addr);
      if (problem) {
        setBad({ field: problem.field, text: t(problem.key) });
        // помилку в захованій формі покупець не побачить
        setAddrOpen(true);
        // фокус ставимо після того, як форма розкриється
        requestAnimationFrame(() => focusAddressField('co', problem.field));
        return;
      }

      const customer: Customer = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        ...fromForm(addr),
        comment: comment.trim(),
        confirm: (() => {
          /* Логін пишемо лише коли месенджер справді Telegram.
             Перевіряти сире confirm.messenger не можна: за
             замовчуванням там 'telegram', і покупець, який обрав
             дзвінок, отримав би в замовленні чужий рядок «@…». */
          const messenger = confirm.method === 'messenger' ? confirm.messenger : '';
          const login = messenger === 'telegram' ? tg.trim().replace(/^@+/, '') : '';
          return {
            ...confirm,
            messenger,
            altPhone: confirm.phoneMode === 'other' ? confirm.altPhone.trim() : '',
            ...(login ? { telegram: login } : {})
          };
        })()
      };

      /* Профіль запамʼятовуємо мерджем: у ньому лежить адресна
         книга, і перезапис обʼєктом покупця стер би її */
      const profile = { ...cart.getProfile(), ...customer, comment: '' };
      cart.saveProfile(profile);
      /* І в хмару — щоб на іншому пристрої не набирати заново.
         Без цього залогінений покупець щоразу заповнював би
         форму з нуля, хоч акаунт у нього є. */
      if (user) void fb.saveCloudProfile(user.uid, user.email ?? '', profile);

      // Нову адресу за бажанням кладемо в книгу
      if (saveAddr && !pickedAddr) {
        book.save(fromForm(addr), { makeDefault: !book.list().length });
      }

      const order = buildOrder({
        c,
        lines,
        customer,
        subtotal,
        discount: off,
        promoCode: code,
        shipping: shipInTotal,
        /* Коли платить отримувач, сума в замовлення не входить —
           але менеджер має її бачити, інакше рахунок і каса
           розійдуться. */
        shippingNote:
          shipCost && payShip === 'branch' ? `≈${shipCost} грн, оплата у відділенні` : '',
        now: new Date(),
        t
      });

      /* Ключ відстеження рахуємо ДО запису: гість без акаунта
         має бачити статус одразу після оформлення, а ключ мусить
         лежати в самому замовленні — телефон потім відредагують
         в адмінці, і порахувати його заново вже не вийде. */
      const { trackKey, trackCreate } = await import('@/lib/track');
      const key = await trackKey(order.num, customer.phone);

      /* Спершу база — це єдине, що не можна втратити. Решта
         (відстеження, лист, Telegram, лічильник промокоду) вже
         необовʼязкова: замовлення видно в адмінці й без них. */
      let id = await fb.createOrder(order, { trackKey: key, lang: 'uk' });

      /* Правила бази перевіряють суму замовлення й доти, доки в
         них не додано доставку, запис із нею не пройде. Мовчки
         втратити замовлення через це не можна: пробуємо ще раз,
         лишивши доставку довідковою. Менеджер побачить її в
         тексті й додасть у рахунок — а покупець не втратить
         заповнену форму. */
      if (!id && order.shipping) {
        order.shipping = 0;
        order.total = goods;
        order.shippingNote = `≈${shipCost} грн`;
        order.message = buildMessage(order, t);
        id = await fb.createOrder(order, { trackKey: key, lang: 'uk' });
      }

      /* Запис відстеження створюємо лише коли замовлення справді
         лягло в базу. Інакше покупець бачив би статус замовлення,
         якого в магазині немає. */
      if (id && key) void trackCreate({ ...order, status: 'new', trackKey: key });

      const saved = cart.getOrders();
      saved.unshift({ ...order, _id: id, trackKey: key } as never);
      cart.saveOrders(saved.slice(0, 50));

      if (code) void fb.promoConsume(code);
      void fb
        .loadNotifySettings()
        .then((s) => orderPlaced(s as { workerUrl?: string } | null, order, 'uk', t));

      clear();
      promoSaveCode('');

      // Номер потрібен на сторінці подяки, а стан між сторінками
      // не переживе перезавантаження — передаємо адресою
      const mail = customer.email ? `&mail=${encodeURIComponent(customer.email)}` : '';
      router.push(`/thanks?num=${encodeURIComponent(order.num)}${mail}`);
    } finally {
      setSending(false);
    }
  }

  const summary = useMemo(
    () =>
      lines.map((i) => ({
        key: i.idx,
        name: i.p.name,
        size: i.size,
        qty: i.qty,
        sum: i.sum,
        cat: catTitle(c, i.p.category),
        parts: (i.parts || []).map((x) => {
          const sp = getProduct(c, x.id);
          return [catTitle(c, sp?.category), sp?.name ?? x.id, x.size].filter(Boolean).join(' · ');
        })
      })),
    [lines, c]
  );

  if (!lines.length) {
    return (
      <div className="empty-state">
        <strong>{t('cart.empty')}</strong>
        {t('cart.emptyNote')}
        <Link className="btn btn--primary" href="/#catalog">
          {t('cart.goCatalog')}
        </Link>
      </div>
    );
  }

  return (
    <div className="checkout">
      <h1 className="section-title">{t('cart.checkout')}</h1>

      {/* Порядок кроків тут не випадковий: спершу хто отримує,
          потім куди везти, і аж тоді — що саме й за скільки.
          Людина заповнює те, що знає напамʼять, і лише потім
          дивиться на суму, яка вже врахувала доставку. */}
      <form
        className="checkout-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <section className="cosec">
          <h2 className="cosec__head">
            <span className="cosec__num">1</span>
            {t('co.who')}
          </h2>
          <div className="cosec__body form-grid">
            <div className="field">
              <label htmlFor="coName">{t('cart.name')}</label>
              <input
                id="coName"
                ref={nameRef}
                className={bad?.field === 'name' ? 'is-invalid' : undefined}
                autoComplete="name"
                placeholder={t('cart.namePh')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="coPhone">{t('cart.phone')}</label>
              <input
                id="coPhone"
                ref={phoneRef}
                className={bad?.field === 'phone' ? 'is-invalid' : undefined}
                type="tel"
                autoComplete="tel"
                placeholder="+380..."
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="coEmail">{t('cart.email')}</label>
              <input
                id="coEmail"
                ref={emailRef}
                className={bad?.field === 'email' ? 'is-invalid' : undefined}
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="cosec">
          <h2 className="cosec__head">
            <span className="cosec__num">2</span>
            {t('adr.where')}
          </h2>
          <div className="cosec__body form-grid">
            {/* Є збережені адреси — спершу список: обрати «на роботу»
                має бути один клік, а не перенабирання відділення */}
            {addrList.length ? (
              <div className="field addrpick">
                <div className="addrpick__list">
                  {addrList.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={'addrpick__item' + (a.id === pickedAddr ? ' is-on' : '')}
                      onClick={() => pickAddr(a.id)}
                    >
                      <b>{book.title(a)}</b>
                      <span>{addressLine(a)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={'addrpick__item addrpick__item--new' + (pickedAddr ? '' : ' is-on')}
                    onClick={() => pickAddr('')}
                  >
                    <b>+ {t('adr.newHere')}</b>
                    <span>{t('adr.newHint')}</span>
                  </button>
                </div>
              </div>
            ) : null}

            {/* Обрану адресу не дублюємо полями — вона вже написана
                на картці. Форма розкривається кнопкою, якщо треба
                виправити відділення саме для цього замовлення. */}
            {addrList.length && pickedAddr && !addrOpen ? (
              <button type="button" className="addrpick__edit" onClick={() => setAddrOpen(true)}>
                {t('adr.editHere')}
              </button>
            ) : null}

            <div hidden={!!(addrList.length && pickedAddr && !addrOpen)}>
              <AddressFields
                v={addr}
                set={(patch) => setAddr((a) => ({ ...a, ...patch }))}
                invalid={bad && bad.field in EMPTY_FORM ? (bad.field as keyof AddressForm) : null}
              />
            </div>

            {/* Пропонуємо зберегти лише нову адресу: обрана вже в книзі */}
            {!pickedAddr ? (
              <label className="checkout-savepick">
                <input
                  type="checkbox"
                  checked={saveAddr}
                  onChange={(e) => setSaveAddr(e.target.checked)}
                />{' '}
                {t('adr.saveToProfile')}
              </label>
            ) : null}

            {/* Хто платить за доставку — питаємо лише там, де вибір
                справді є. За кордон платить відправник, тож там
                замість вибору стоїть пояснення. */}
            {shipCost && carrier === 'np' ? (
              <fieldset className="ship-pay">
                <legend>{t('dlv.who')}</legend>
                <label>
                  <input
                    type="radio"
                    name="ship-pay"
                    checked={payShip === 'branch'}
                    onChange={() => setPayShip('branch')}
                  />{' '}
                  {t('dlv.branch')}
                </label>
                <label>
                  <input
                    type="radio"
                    name="ship-pay"
                    checked={payShip === 'order'}
                    onChange={() => setPayShip('order')}
                  />{' '}
                  {t('dlv.order')}
                </label>
              </fieldset>
            ) : null}
            {shipCost && carrier === 'intl' ? (
              <p className="ship-pay__note">{t('dlv.intlNote')}</p>
            ) : null}
          </div>
        </section>

        <section className="cosec">
          <h2 className="cosec__head">
            <span className="cosec__num">3</span>
            {t('co.order')}
          </h2>
          <div className="cosec__body">
            <div className="checkout-summary">
              {summary.map((i) => (
                <div key={i.key}>
                  <span>
                    {i.name}
                    {i.size ? ` (${i.size})` : ''} × {i.qty}
                    {i.cat ? <em className="checkout-parts">{i.cat}</em> : null}
                    {i.parts.length ? <em className="checkout-parts">{i.parts.join(' · ')}</em> : null}
                  </span>
                  <span>{uah(i.sum, lang)}</span>
                </div>
              ))}

              {discount || ship ? (
                <div>
                  <span>{t('cart.subtotal')}</span>
                  <span>{uah(subtotal, lang)}</span>
                </div>
              ) : null}
              {discount ? (
                <div className="is-off">
                  <span>{t('cart.discount')} · {promo?.code}</span>
                  <span>−{uah(discount, lang)}</span>
                </div>
              ) : null}

              {/* Рядок доставки не зникає ніколи: поки міста немає —
                  підказує, що зробити; коли перевізник мовчить —
                  стоїть слово «орієнтовно». Порожнє місце тут гірше
                  за приблизне число. */}
              <div className="checkout-ship">
                <span>
                  {t('cart.delivery')}
                  {ship?.estimate ? <em className="checkout-parts">{t('dlv.about')}</em> : null}
                  {shipCost && payShip === 'branch' ? (
                    <em className="checkout-parts">{t('dlv.atBranch')}</em>
                  ) : null}
                </span>
                <span>
                  {!ship ? '…' : ship.free ? t('dlv.free') : ship.unknown
                    ? <em className="checkout-ship__hint">{carrier === 'intl' ? t('dlv.pickIntl') : t('dlv.pick')}</em>
                    : uah(ship.cost, lang)}
                </span>
              </div>

              <div className="sum">
                <span>{t('cart.total')}</span>
                <span>{uah(total, lang)}</span>
              </div>
            </div>

            <PromoField
              promo={promo}
              discount={discount}
              partial={partial}
              message={promoMsg}
              busy={promoBusy}
              onApply={(code) => void applyPromo(code)}
              onDrop={() => {
                setPromo(null);
                setDiscount(0);
                setPartial(false);
                setPromoMsg(null);
                promoSaveCode('');
              }}
            />
          </div>
        </section>

        <section className="cosec">
          <h2 className="cosec__head">
            <span className="cosec__num">4</span>
            {t('cart.confirmTitle')}
          </h2>
          <div className="cosec__body form-grid">
            {/* Дзвінок прибрано свідомо: його однаково беруть не всі,
                а менеджер пише в месенджер. Одна відповідь замість
                двох — і на одне рішення покупцеві менше. */}
            <div className="field co-confirm">
              <div className="co-confirm__part">
                <span className="co-confirm__label">{t('cart.whichMessenger')}</span>
                <div className="ochips">
                  {MESSENGERS.map((m) => (
                    <label className={'ochip ochip--' + m.id} key={m.id}>
                      <input
                        type="radio"
                        name="co-messenger"
                        checked={confirm.messenger === m.id}
                        onChange={() => setConfirm((v) => ({ ...v, messenger: m.id }))}
                      />
                      <span>{m.title}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="co-confirm__part">
                <span className="co-confirm__label">{t('cart.contactPhone')}</span>
                <div className="ochips">
                  <label className="ochip">
                    <input
                      type="radio"
                      name="co-phone-mode"
                      checked={confirm.phoneMode === 'main'}
                      onChange={() => setConfirm((v) => ({ ...v, phoneMode: 'main' }))}
                    />
                    <span>{t('cart.samePhone')}</span>
                  </label>
                  <label className="ochip">
                    <input
                      type="radio"
                      name="co-phone-mode"
                      checked={confirm.phoneMode === 'other'}
                      onChange={() => setConfirm((v) => ({ ...v, phoneMode: 'other' }))}
                    />
                    <span>{t('cart.otherPhone')}</span>
                  </label>
                </div>
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="+380..."
                  hidden={confirm.phoneMode !== 'other'}
                  value={confirm.altPhone}
                  onChange={(e) => setConfirm((v) => ({ ...v, altPhone: e.target.value }))}
                />
              </div>

              {/* Логін питаємо лише для Telegram: якщо номер прихований
                  налаштуваннями, без нього ми покупця не знайдемо */}
              <div className="co-confirm__part" hidden={confirm.messenger !== 'telegram'}>
                <span className="co-confirm__label">{t('cart.tgLogin')}</span>
                <input
                  placeholder="@username"
                  autoComplete="off"
                  spellCheck={false}
                  value={tg}
                  onChange={(e) => setTg(e.target.value)}
                />
                <p className="co-confirm__hint">{t('cart.tgHint')}</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="coComment">{t('cart.comment')}</label>
              <textarea
                id="coComment"
                placeholder={t('cart.commentPh')}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          </div>
        </section>

        {bad ? (
          <p className="promo__hint is-err" role="alert">
            {bad.text}
          </p>
        ) : null}

        <div className="checkout-go">
          <button className="btn btn--primary btn--order" type="submit" disabled={!canSubmit}>
            {sending ? t('cart.sending') : t('cart.submit')}
          </button>
          <p className="pinfo__order-note">{t('cart.submitNote')}</p>
        </div>
      </form>
    </div>
  );
}
