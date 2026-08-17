'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from './LangProvider';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from './CartProvider';
import { useToast } from './Toasts';
import AddressFields, { focusAddressField } from './AddressFields';
import PromoField from './PromoField';
import type { User } from 'firebase/auth';
import * as cart from '@/lib/cart';
import * as fb from '@/lib/firebase';
import { DEFAULT_RULES, discountFor, percentOf, type DiscountRules, type LevelNo } from '@/lib/loyalty';
import { readMember, type MemberDoc } from '@/lib/admin/loyalty-db';
import { catTitle, freeFromOf, getProduct, uah } from '@/lib/catalog';
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
import { customsBlock, parcelWeight } from '@/lib/customs';
import { orderPlaced } from '@/lib/notify';
import PayAgain from './PayAgain';
import CheckoutGoogleAuth from './CheckoutGoogleAuth';
import { promoCheck, promoMessage, promoSaveCode, promoSavedCode, type Promo } from '@/lib/promo';
import { metaCartParams, trackMeta } from '@/lib/meta';

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
  const toast = useToast();
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
  /* Окремий прапорець не дає гостьовому Google-блоку мигнути
     залогіненому покупцеві, поки Firebase відновлює сесію. */
  const [authReady, setAuthReady] = useState(false);

  /* null — ще не обрано; '' — вводимо нову адресу; id — узяли
     збережену. Без книги вибирати нема з чого, і форма
     показується одразу. */
  const [pickedAddr, setPickedAddr] = useState<string | null>(null);

  const [bad, setBad] = useState<{ field: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const checkoutTracked = useRef(false);

  /* Checkout рахуємо тоді, коли кошик уже відновився з
     localStorage. Один монтаж — одна подія, навіть якщо далі
     зміниться адреса або вартість доставки. */
  useEffect(() => {
    if (!lines.length || checkoutTracked.current) return;
    checkoutTracked.current = true;
    trackMeta(
      'InitiateCheckout',
      metaCartParams(
        lines.map((line) => ({
          id: line.id,
          quantity: line.qty,
          item_price: line.p.price
        })),
        subtotal
      )
    );
  }, [lines, subtotal]);

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
        setAuthReady(true);
        if (u?.displayName) setName((v) => v || u.displayName || '');
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
    const res = promoCheck(promo, cart.forPromo(c), null, user?.email ?? '', whoNow());
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
    /* Скільки разів ЦЯ людина вже брала цей код. Питаємо саме
       тут, а не тримаємо в пам'яті: код вводять раз на кошик, а
       зайвий запит на кожне відкриття сторінки — ні до чого. */
    const used = found?.perUser ? await fb.promoMineUsed(code, who) : 0;
    setMineUsed(used);
    const res = promoCheck(found, cart.forPromo(c), null, who, whoNow(used));
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
  /* Знижка за рівнем програми лояльності.

     Покупець вирішує сам, застосувати її чи ні: бали
     нараховуються від СПЛАЧЕНОЇ суми, тож застосована знижка
     зменшує бали рівно на свою величину. Біля порога рівня
     вигідніше заплатити повну ціну й перейти на рівень, де
     знижка більша назавжди. */
  const [member, setMember] = useState<MemberDoc | null>(null);
  /* Скільки разів цей покупець уже брав саме цей код. Потрібне
     для кодів, обмежених «раз на людину»: загальний лічильник не
     знає, хто його крутив. */
  const [mineUsed, setMineUsed] = useState(0);
  const [loyaltyOn, setLoyaltyOn] = useState(true);
  const [rules, setRules] = useState<DiscountRules>(DEFAULT_RULES);

  useEffect(() => {
    if (!user?.email) return;
    /* Пошта в замовленні — завжди акаунтна. Профіль міг зберегти
       іншу ще з часів, коли поле було відкрите. */
    setEmail(user.email);
    let alive = true;
    const d = fb.db();
    if (!d) return;
    void readMember(d, user.email, new Date()).then((m) => {
      if (alive) setMember(m);
    });
    void fb.loadNotifySettings().then((raw) => {
      const box = (raw ?? {}) as { loyalty?: Partial<DiscountRules> };
      if (alive && box.loyalty) setRules({ ...DEFAULT_RULES, ...box.loyalty });
    });
    return () => {
      alive = false;
    };
  }, [user]);

  /* Рахуємо тими самими правилами, що й воркер: він виставить
     рахунок сам, і два різні підрахунки означали б, що покупець
     платить не ту суму, яку бачив. */
  const money = useMemo(
    () =>
      discountFor(
        (member?.level ?? 1) as LevelNo,
        lines.map((l) => ({
          sum: l.sum,
          category: String(l.p?.category ?? ''),
          sale: !!l.p?.sale
        })),
        discount,
        rules,
        loyaltyOn && !!member
      ),
    [member, lines, discount, rules, loyaltyOn]
  );

  const loyaltyOff = money.loyalty;
  const offTotal = money.total;
  const goods = Math.max(0, subtotal - offTotal);
  const freeShip = freeReached(underwearSum(c, lines), freeFromOf(c));
  const [ship, setShip] = useState<Quote | null>(null);
  const [payShip, setPayShip] = useState<'branch' | 'order'>('branch');

  const carrier = addr.carrier;
  const cityRef = addr.cityRef;
  const branch = addr.branch;
  const country = addr.countryCode;
  const intlCity = addr.intlCity;
  const intlCityId = addr.intlCityId;
  /* Спосіб отримання міняє тариф: поштомат і пункт видачі
     коштують не так, як власне відділення. */
  const intlType =
    addr.intlMode === 'address'
      ? 'address'
      : addr.intlBranchType === 'Postomat'
        ? 'postomat'
        : addr.intlBranchType === 'PUDO'
          ? 'pudo'
          : 'branch';

  useEffect(() => {
    let alive = true;
    setShip(null);
    void quote({
      carrier,
      cityRef,
      // ознаки поштомата у формі немає — впізнаємо за назвою
      postomat: /поштомат|postomat/i.test(branch || ''),
      country,
      city: intlCity,
      cityId: intlCityId,
      intlType,
      declared: goods,
      weight: parcelWeight(c, lines),
      free: freeShip
    }).then((q) => {
      if (alive) setShip(q);
    });
    return () => {
      alive = false;
    };
  }, [carrier, cityRef, branch, country, intlCity, intlCityId, intlType, goods, freeShip]);

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
        const res = promoCheck(fresh, cart.forPromo(c), null, who, whoNow(mineUsed));
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
        discount: offTotal,
        promoCode: code,
        promoOff: money.promo,
        loyaltyOff,
        loyaltyLevel: loyaltyOn && member ? member.level : 0,
        shipping: shipInTotal,
        /* Коли платить отримувач, сума в замовлення не входить —
           але менеджер має її бачити, інакше рахунок і каса
           розійдуться. */
        shippingNote:
          shipCost && payShip === 'branch' ? `≈${shipCost} грн, оплата у відділенні` : '',
        /* За кордон посилка не поїде без декларації, а збирати її
           щоразу вручну — найкоротший шлях до помилки в коді
           товару. Тому замовлення несе готовий перелік. */
        customs: carrier === 'intl' ? customsBlock(c, lines) : '',
        now: new Date(),
        t
      });

      /* Ключ відстеження рахуємо ДО запису: гість без акаунта
         має бачити статус одразу після оформлення, а ключ мусить
         лежати в самому замовленні — телефон потім відредагують
         в адмінці, і порахувати його заново вже не вийде. */
      const { trackKey, trackCreate } = await import('@/lib/track');
      const key = await trackKey(order.num, customer.phone);

      /* Рахунок виставляємо ДО запису замовлення: його номер має
         лягти в сам документ, а дописати поле потім покупець уже
         не має права — і це правильно.

         Суму рахує воркер із каталогу, ми лише кажемо, що саме
         замовили. Якби суму передавали звідси, її можна було б
         переписати в консолі браузера й купити все за гривню. */
      const { payCreate, rememberInvoice } = await import('@/lib/pay');
      const { metaBrowserContext } = await import('@/lib/meta');
      const settings = (await fb.loadNotifySettings()) as { workerUrl?: string } | null;
      /* Рівень воркер перевірить сам, нашим токеном. Якщо токен
         не дістанеться (вийшли з акаунта в сусідній вкладці) —
         рахунок буде без знижки лояльності, і це чесніше, ніж
         повірити браузеру на слово. */
      const idToken = user ? await user.getIdToken().catch(() => '') : '';

      const bill = await payCreate(String(settings?.workerUrl || ''), {
        idToken,
        loyalty: loyaltyOn && !!member,
        orderNum: order.num,
        items: order.items.map((i) => ({ id: i.id, size: i.size || '', qty: i.qty })),
        promo: code,
        shipping: shipInTotal,
        email: customer.email,
        phone: customer.phone,
        meta: metaBrowserContext(),
        lang: 'uk'
      });
      if (bill.ok && bill.invoiceId) {
        order.payInvoiceId = bill.invoiceId;
        rememberInvoice(order.num, bill.invoiceId);
      }

      /* Спершу база — це єдине, що не можна втратити. Решта
         (відстеження, лист, Telegram, лічильник промокоду) вже
         необовʼязкова: замовлення видно в адмінці й без них. */
      let id = await fb.createOrder(order, { trackKey: key, lang: 'uk' });

      /* Остання лінія оборони: якщо базі щось не сподобалось —
         пробуємо ще раз без поля доставки взагалі. Мовчки
         втратити замовлення не можна: воно вже пішло в Telegram і
         листом, тобто магазин про нього знає, а в адмінці його
         немає — і саме так одне міжнародне замовлення й зникло. */
      if (!id) {
        order.shipping = 0;
        order.shippingNote = shipCost ? `≈${shipCost} грн` : '';
        order.message = buildMessage(order, t);
        id = await fb.createOrder(order, { trackKey: key, lang: 'uk' });
      }

      /* І якщо навіть це не пройшло — кажемо прямо. «Прийнято»
         поверх втраченого замовлення гірше за будь-яку помилку. */
      if (!id) {
        toast(
          'Замовлення прийнято й уже надіслано менеджеру, але не збереглося в кабінеті. ' +
            'Збережіть номер ' + order.num + ' — менеджер звʼяжеться з вами.'
        );
      }

      /* Запис відстеження створюємо лише коли замовлення справді
         лягло в базу. Інакше покупець бачив би статус замовлення,
         якого в магазині немає. */
      if (id && key) void trackCreate({ ...order, status: 'new', trackKey: key });

      const saved = cart.getOrders();
      saved.unshift({ ...order, _id: id, trackKey: key } as never);
      cart.saveOrders(saved.slice(0, 50));

      if (code) void fb.promoConsume(code, order.customer.email || user?.email || '');
      void fb
        .loadNotifySettings()
        .then((s) => orderPlaced(s as { workerUrl?: string } | null, order, 'uk', t));

      clear();
      promoSaveCode('');

      /* Рахунок виставлено — ведемо покупця платити. Замовлення
         вже в базі: якщо він передумає просто на сторінці банку,
         менеджер це побачить і зможе надіслати посилання ще раз.

         Заміна адреси, а не перехід усередині сайту: сторінка
         банку — чужа, і повертатись «назад» покупець має на
         подяку, а не на форму оформлення. */
      if (bill.ok && bill.pageUrl) {
        window.location.assign(bill.pageUrl);
        return;
      }

      /* Рахунок не вийшов. Мовчати не можна: людина щойно
         оформила замовлення й має знати, що грошей із неї ще не
         взяли, а посилання прийде листом. */
      toast(
        'Замовлення №' + order.num + ' записано, але почати оплату не вдалося' +
          (bill.error ? ' (' + bill.error + ')' : '') +
          '. Ми надішлемо посилання на оплату — перевірте пошту.'
      );

      // Номер потрібен на сторінці подяки, а стан між сторінками
      // не переживе перезавантаження — передаємо адресою
      const mail = customer.email ? `&mail=${encodeURIComponent(customer.email)}` : '';
      router.push(`/thanks?num=${encodeURIComponent(order.num)}${mail}`);
    } finally {
      setSending(false);
    }
  }

  /* Останнє замовлення цього браузера — його ми й пропонуємо
     доплатити. Лежить у сховищі поруч із кошиком, тож ані входу,
     ані звернень у базу для цього не треба.

     Читаємо ПІСЛЯ появи сторінки, а не під час малювання: сервер
     сховища не бачить, і якби перший кадр у браузері вже містив
     цю панель, React вважав би розмітку розбіжною й перемальовував
     би сторінку цілком. Саме таку помилку я собі й зробив. */
  const [pending, setPending] = useState<{
    num: string;
    items: { id: string; size: string; qty: number }[];
    promo: string;
    shipping: number;
    email: string;
  } | null>(null);

  useEffect(() => {
    if (lines.length) {
      setPending(null);
      return;
    }
    const last = (cart.getOrders() || [])[0] as
      | {
          num?: string;
          items?: { id: string; size?: string; qty: number }[];
          promoCode?: string;
          shipping?: number;
          customer?: { email?: string };
          trackKey?: string;
        }
      | undefined;
    if (!last?.num || !last.items?.length) return;

    /* Памʼять браузера — не джерело правди про замовлення.
       Магазин міг його вже скасувати чи видалити, а тут і далі
       висіла б кнопка «Оплатити»: банк про наші статуси не знає й
       гроші прийме. Тому спершу питаємо публічне відстеження — по
       ключу, який зберегли собі при оформленні.

       Не відповіло — показуємо: мовчання мережі не привід ховати
       від людини її ж незавершену оплату. */
    let alive = true;
    /* Модуль відстеження підвантажуємо, а не тягнемо в сторінку:
       він веде за собою базу, а більшості відкриттів кошика вона
       тут не потрібна зовсім. Так само зроблено при оформленні. */
    void import('@/lib/track')
      .then(({ trackStatus }) => trackStatus(last.trackKey))
      .then((state) => {
        if (!alive) return;
        const dead = !state.alive || state.status === 'cancelled' || state.status === 'done';
        if (dead) return;
        setPending({
          num: String(last.num),
          items: (last.items || []).map((i) => ({ id: i.id, size: i.size ?? '', qty: Number(i.qty) || 1 })),
          promo: last.promoCode || '',
          shipping: Number(last.shipping) || 0,
          email: String(last.customer?.email || '')
        });
      });
    return () => {
      alive = false;
    };
  }, [lines.length]);

  /* Хто перед нами з погляду програми: рівень і власні
     використання коду. Гість дає нулі, і код для гостей йому
     спрацює, а код «лише для учасників» — ні. */
  const whoNow = (used = 0) => ({ level: member?.level ?? 0, used });

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
    /* Кошик порожній не завжди означає «нічого не купував».
       Найчастіше сюди повертаються кнопкою «назад» зі сторінки
       банку, не завершивши оплату: кошик уже очищено, замовлення
       створено — і без цієї підказки виходив глухий кут. */
    return (
      <div className="empty-state checkout-empty">
        {pending ? (
          <div className="checkout-empty__pending">
            <PayAgain
              num={pending.num}
              items={pending.items}
              promo={pending.promo}
              shipping={pending.shipping}
              email={pending.email}
              lang="uk"
            />
          </div>
        ) : null}

        <span className="checkout-empty__icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
          >
            <path d="M6 8h12l-1 13H7L6 8Z" />
            <path d="M9 10V6a3 3 0 0 1 6 0v4" />
          </svg>
        </span>
        <h1 className="checkout-empty__title">{t('cart.empty')}</h1>
        <p className="checkout-empty__note">{t('cart.emptyNote')}</p>
        <Link
          className="btn btn--primary checkout-empty__action"
          href={(lang === 'en' ? '/en' : '') + '/#catalog'}
        >
          {t('cart.goCatalog')}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
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
        {authReady && !user && fb.auth() ? (
          <CheckoutGoogleAuth
            onUser={(u) => {
              setUser(u);
              if (u.displayName) setName((v) => v || u.displayName || '');
              if (u.email) setEmail((v) => v || u.email || '');
            }}
          />
        ) : null}

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

            {/* Залогіненому покупцеві пошту міняти не можна, і
                причин дві.

                Перша — правила бази: у замовленні від залогіненого
                вони приймають ЛИШЕ його власну пошту. Вписав чужу —
                і замовлення відхиляється мовчки, бо запис ковтає
                помилку. Досі це поле було відкрите, і пастка стояла
                заряджена.

                Друга — програма лояльності. Бали й рівень живуть на
                акаунті, а не на рядку в формі: інакше знижку можна
                було б узяти, вписавши чужу пошту. */}
            <div className="field">
              <label htmlFor="coEmail">{t('cart.email')}</label>
              <input
                id="coEmail"
                ref={emailRef}
                className={bad?.field === 'email' ? 'is-invalid' : undefined}
                type="email"
                required
                readOnly={!!user?.email}
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {user?.email ? (
                <p className="field__hint">{t('cart.emailLocked')}</p>
              ) : null}
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

              {offTotal || ship ? (
                <div>
                  <span>{t('cart.subtotal')}</span>
                  <span>{uah(subtotal, lang)}</span>
                </div>
              ) : null}
              {money.promo ? (
                <div className="is-off">
                  <span>{t('cart.discount')} · {promo?.code}</span>
                  <span>−{uah(money.promo, lang)}</span>
                </div>
              ) : null}

              {/* Знижку за рівнем показуємо окремим рядком і з
                  перемикачем: покупець має бачити, що вона його,
                  і мати змогу відмовитись. Відмова не примха —
                  бали рахуються від сплаченого, тож біля порога
                  рівня вигідніше заплатити повну ціну. */}
              {member && percentOf(member.level) > 0 ? (
                <div className={'is-off loy-row' + (loyaltyOn ? '' : ' is-off-off')}>
                  <label className="loy-row__switch">
                    <input
                      type="checkbox"
                      checked={loyaltyOn}
                      onChange={(e) => setLoyaltyOn(e.target.checked)}
                    />
                    <span>
                      {t('cart.loyalty')} · −{percentOf(member.level)}%
                    </span>
                  </label>
                  <span>{loyaltyOn ? '−' + uah(loyaltyOff, lang) : '—'}</span>
                </div>
              ) : null}

              {money.capped ? (
                <p className="loy-cap">{t('cart.loyaltyCap')}</p>
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
                двох — і на одне рішення покупцеві менше.

                А хто взагалі не хоче, щоб його турбували, ставить
                галочку — і питання зникають разом із нею. */}
            <div className="field co-confirm">
              <label className="co-confirm__skip">
                <input
                  type="checkbox"
                  checked={confirm.method === 'none'}
                  onChange={(e) =>
                    setConfirm((v) => ({ ...v, method: e.target.checked ? 'none' : 'messenger' }))
                  }
                />
                <span>
                  {t('co.noContact')}
                  <em>{t('co.noContactHint')}</em>
                </span>
              </label>

              <div className="co-confirm__part" hidden={confirm.method === 'none'}>
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

              <div className="co-confirm__part" hidden={confirm.method === 'none'}>
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
              <div
                className="co-confirm__part"
                hidden={confirm.method === 'none' || confirm.messenger !== 'telegram'}
              >
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
          <p className="pinfo__order-note">
            {confirm.method === 'none' ? t('co.noContactHint') : t('cart.submitNote')}
          </p>
        </div>
      </form>
    </div>
  );
}
