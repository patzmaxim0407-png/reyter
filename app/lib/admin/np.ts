/* ============================================================
   REYTER — трекер Нової Пошти
   ------------------------------------------------------------
   Доти менеджер дізнавався про долю посилки з телефонного дзвінка
   покупця. Тепер про неї розповідає сам перевізник: де вона,
   скільки днів лежить у відділенні, чи не повертається назад.

   Метод відкритий — ключ не потрібен, як і в розрахунку
   вартості. Перевірено 11.08.2026: apiKey '' дає success: true.
   Ключ усе одно передаємо змінною: якщо колись його зроблять
   обовʼязковим, поміняється один рядок, а не вся адмінка.

   За один запит — до ста накладних. Це не наша обережність, а
   їхня межа: на сто першій сервер відповідає помилкою.

   Телефон отримувача передаємо завжди. Без нього перевізник
   ховає частину полів і дописує в попередження, що для повної
   картки потрібен номер — а нам потрібна саме повна.
   ============================================================ */

const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';
const KEY = '';
/** Межа перевізника на один запит. */
const BATCH = 100;

/** Що саме зараз із посилкою — рівно те, що потрібно менеджеру. */
export interface Parcel {
  ttn: string;
  /** Код стану від перевізника. */
  code: string;
  /** Його ж словами. */
  status: string;
  /** Коли отримали (порожньо, доки не отримали). */
  gotAt: string;
  /** Скільки днів лежить у відділенні; 0 — ще не доїхала. */
  waiting: number;
  /** Відділення, де лежить або куди прямує. */
  place: string;
  /** Гроші, які перевізник поверне за післяплатою. */
  backMoney: number;
  /** Коли перевізник обіцяє доставити. */
  scheduled: string;
  /** Місто отримувача. */
  city: string;
  /** Коли накладну створено. */
  createdAt: string;
  /** Ідентифікатор документа в кабінеті — за ним його й видаляють. */
  ref: string;
}

/* ---------- Що означають коди ----------
   Перелік не вигаданий: узятий із документації перевізника.
   Нас цікавлять не всі, а ті, від яких залежить дія менеджера,
   тому решта злипається в «у дорозі». */

export type ParcelState =
  | 'missing' // номер не знайдено — найчастіше помилка в цифрах
  | 'created' // накладну оформили, посилку ще не здали
  | 'moving' // їде
  | 'waiting' // прибула у відділення, лежить
  | 'received'
  | 'refused' // не забрали, повертається відправнику
  | 'returned'; // повернулась до нас

const CODES: Record<string, ParcelState> = {
  '1': 'created',
  /* Код 2 — «Видалено»: накладну скасували в кабінеті, а не
     покупець відмовився від посилки. */
  '2': 'missing',
  '3': 'missing',
  '4': 'moving',
  '41': 'moving',
  '5': 'moving',
  '6': 'moving',
  '7': 'waiting',
  '8': 'waiting',
  '9': 'received',
  '10': 'received',
  '11': 'received',
  '12': 'moving',
  '101': 'moving',
  '102': 'refused',
  '103': 'refused',
  '104': 'moving',
  '105': 'refused',
  /* 106 — «Одержано і створено накладну зворотної доставки»:
     посилку ЗАБРАЛИ, а назад їдуть гроші за післяплатою. Це
     доставка, а не повернення — інакше замовлення з післяплатою
     не закривалося б ніколи. */
  '106': 'received',
  '111': 'refused',
  '112': 'refused'
};

export function parcelState(code?: string | null): ParcelState {
  return CODES[String(code || '')] || 'moving';
}

/** Підпис для менеджера — коротко й дієсловом, а не кодом. */
export function label(parcel: Parcel): string {
  switch (parcelState(parcel.code)) {
    case 'missing':
      return 'Номер не знайдено';
    case 'created':
      return 'Накладну створено — посилку ще не здано';
    case 'waiting':
      return parcel.waiting > 0 ? 'У відділенні ' + parcel.waiting + ' дн.' : 'Прибула у відділення';
    case 'received':
      return 'Отримано';
    case 'refused':
      return 'Не забрали — повертається';
    case 'returned':
      return 'Повернулась до нас';
    default:
      return parcel.status || 'У дорозі';
  }
}

/** Те саме, але для рядка списку: там колонка вузька, а підпис
 *  на пів речення розпихає сусідні й ховає адресу під три
 *  крапки. Розлогий текст лишається в картці й у підказці. */
export function shortLabel(parcel: Parcel): string {
  switch (parcelState(parcel.code)) {
    case 'missing':
      return 'Номера немає';
    case 'created':
      return 'Ще не здано';
    case 'waiting':
      return parcel.waiting > 0 ? 'У відділенні ' + parcel.waiting + ' дн.' : 'У відділенні';
    case 'received':
      return 'Отримано';
    case 'refused':
      return 'Повертається';
    case 'returned':
      return 'Повернулась';
    default:
      return 'У дорозі';
  }
}

/** Наскільки це терміново: 0 — усе гаразд, 2 — треба реагувати. */
export function alarm(parcel: Parcel, WARN_AT = 3, ALARM_AT = 5): 0 | 1 | 2 {
  const s = parcelState(parcel.code);
  if (s === 'missing' || s === 'refused' || s === 'returned') return 2;
  if (s === 'waiting') {
    if (parcel.waiting >= ALARM_AT) return 2;
    if (parcel.waiting >= WARN_AT) return 1;
  }
  if (s === 'created') return 1; // накладна є, а посилки перевізник не бачить
  return 0;
}

/** Куди рухається замовлення за словами перевізника: 'shipped' —
 *  посилка вже в руках Нової Пошти, 'done' — її забрали.
 *  null — статус міняти не можна: або нічого не сталося, або
 *  сталося те, у чому має розібратись людина (повернення,
 *  помилковий номер). */
export function statusFromTracker(parcel: Parcel): 'shipped' | 'done' | null {
  const s = parcelState(parcel.code);
  if (s === 'received') return 'done';
  if (s === 'moving' || s === 'waiting') return 'shipped';
  return null;
}

/* ---------- Запит ---------- */

interface Row {
  Number?: string;
  StatusCode?: string;
  Status?: string;
  RecipientDateTime?: string;
  RefEW?: string;
  WarehouseRecipient?: string;
  WarehouseRecipientAddress?: string;
  CityRecipient?: string;
  DateFirstDayStorage?: string;
  ScheduledDeliveryDate?: string;
  ActualDeliveryDate?: string;
  DateCreated?: string;
  StorageAmount?: string | number;
  BackwardDeliverySubTypesActions?: unknown;
  RedeliverySum?: string | number;
}

function daysSince(since?: string | null, now = new Date()): number {
  const s = String(since || '').trim();
  if (!s) return 0;
  /* Перевізник віддає дати трьома різними способами в одній і
     тій самій відповіді: «10-08-2026 20:11:35», «11.08.2026
     10:32:23» і «2026-08-11 08:13:00». Розбираємо всі три —
     інакше «лежить пʼятий день» тихо виходило б нулем, і смуга,
     заради якої все це затівалось, ніколи б не спрацювала. */
  const m = s.match(/^(\d{2})[.\-](\d{2})[.\-](\d{4})/);
  const d = m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return 0;
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  return diff > 0 ? diff : 0;
}

async function batch(items: { ttn: string; phone?: string }[]): Promise<Parcel[]> {
  const res = await fetch(NP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: KEY,
      modelName: 'TrackingDocument',
      calledMethod: 'getStatusDocuments',
      methodProperties: {
        Documents: items.map((x) => ({
          DocumentNumber: x.ttn,
          Phone: String(x.phone || '').replace(/\D/g, '')
        }))
      }
    })
  });
  const json = (await res.json()) as { success?: boolean; data?: Row[] };
  if (!json.success || !Array.isArray(json.data)) return [];

  return json.data.map((r) => ({
    ttn: String(r.Number || ''),
    code: String(r.StatusCode || ''),
    status: String(r.Status || ''),
    gotAt: String(r.RecipientDateTime || ''),
    waiting: daysSince(r.DateFirstDayStorage),
    place: String(r.WarehouseRecipient || r.WarehouseRecipientAddress || ''),
    backMoney: Number(r.RedeliverySum) || 0,
    scheduled: String(r.ScheduledDeliveryDate || ''),
    city: String(r.CityRecipient || ''),
    createdAt: String(r.DateCreated || ''),
    ref: String(r.RefEW || '')
  }));
}

/** Стан посилок за номерами. Порожні номери відсіюємо тут, щоб
 *  кожне місце виклику не робило це саме. */
export async function trackAll(
  items: { ttn?: string | null; phone?: string | null }[]
): Promise<Map<string, Parcel>> {
  const list = items
    /* Номер із пробілами перевізник не знаходить, а замовлення
       після цього вічно висить «у дорозі». Лишаємо самі цифри. */
    .map((x) => ({ ttn: String(x.ttn || '').replace(/\D/g, ''), phone: String(x.phone || '') }))
    .filter((x) => x.ttn.length >= 8);

  const out = new Map<string, Parcel>();
  if (!list.length) return out;

  for (let i = 0; i < list.length; i += BATCH) {
    try {
      const rows = await batch(list.slice(i, i + BATCH));
      for (const row of rows) if (row.ttn) out.set(row.ttn, row);
    } catch {
      /* мережа підвела — покажемо те, що вже знаємо */
    }
  }
  return out;
}

/* ============================================================
   КАБІНЕТ ДОГОВОРУ
   ------------------------------------------------------------
   Відстеження відкрите й ключа не потребує, а от створення
   накладної списує гроші з рахунку — і ключ від кабінету дає
   право це робити. У браузер він не потрапляє: адмінка віддає
   свою збірку будь-кому, хто відкриє її адресу.

   Тому всі такі запити йдуть через воркер сповіщень: ключ лежить
   там, поруч із ключем пошти й токеном Telegram, і воркер
   пропускає лише ті методи, які потрібні для накладної.
   ============================================================ */

export interface Cabinet {
  workerUrl?: string;
  adminKey?: string;
}

export async function npCall<T = Record<string, unknown>>(
  cab: Cabinet | null,
  model: string,
  method: string,
  props: Record<string, unknown> = {}
): Promise<{ ok: boolean; data: T[]; error: string }> {
  const url = String(cab?.workerUrl || '').trim().replace(/\/+$/, '');
  if (!url) return { ok: false, data: [], error: 'не вказано адресу Worker у налаштуваннях' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /* Ключ підрізаємо: при копіюванні з панелі Cloudflare до
         нього легко чіпляється пробіл або перенос рядка, а
         порівняння у воркері точне — і виходить «ключ не
         збігається» там, де насправді збігається. */
      body: JSON.stringify({
        type: 'np',
        key: String(cab?.adminKey || '').trim(),
        model,
        method,
        props
      })
    });
    const d = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: T[];
      error?: string;
    };
    const err = d.error || (d.ok ? '' : 'воркер відповів кодом ' + res.status);
    return { ok: !!d.ok, data: d.data || [], error: explain(err) };
  } catch {
    return { ok: false, data: [], error: 'не вдалося звʼязатися з воркером' };
  }
}

/* Воркер старої версії не знає типу «np» і провалює запит у гілку
   замовлення — звідти й береться «Порожнє замовлення». Сказати
   про це прямо дешевше, ніж дати менеджеру гадати над відповіддю,
   яка до накладної не має жодного стосунку. */
function explain(err: string): string {
  if (/порожнє замовлення/i.test(err)) {
    return 'воркер сповіщень ще не оновлено — скопіюйте new/worker/worker.js у Cloudflare і натисніть Deploy';
  }
  if (/NP_KEY/i.test(err)) {
    return 'у воркері не задано ключ кабінету Нової Пошти (NP_KEY) — додайте його як Secret і натисніть Deploy';
  }
  if (/ключ адміністратора/i.test(err)) {
    return 'ключ адміністратора не збігається з ADMIN_KEY у воркері — перевірте його в налаштуваннях';
  }
  return err;
}

/** Хто відправник за договором: контрагент і контактна особа.
 *  Їх у договорі зазвичай по одному, тож не питаємо — беремо. */
export async function senderFromContract(cab: Cabinet | null): Promise<
  { ok: true; ref: string; contact: string; phone: string; name: string } | { ok: false; error: string }
> {
  const party = await npCall<{ Ref?: string; Description?: string }>(
    cab, 'Counterparty', 'getCounterparties', { CounterpartyProperty: 'Sender', Page: '1' }
  );
  if (!party.ok || !party.data.length) return { ok: false, error: party.error || 'у договорі немає відправника' };
  const ref = String(party.data[0].Ref || '');

  const o = await npCall<{ Ref?: string; Phones?: string; Description?: string }>(
    cab, 'Counterparty', 'getCounterpartyContactPersons', { Ref: ref, Page: '1' }
  );
  if (!o.ok || !o.data.length) return { ok: false, error: o.error || 'у відправника немає контактної особи' };

  return {
    ok: true,
    ref,
    contact: String(o.data[0].Ref || ''),
    phone: String(o.data[0].Phones || ''),
    name: String(party.data[0].Description || '')
  };
}

export interface NewWaybill {
  /** Місто й відділення відправника — з налаштувань магазину. */
  citySender: string;
  senderWarehouse: string;
  /** Кому. */
  name: string;
  phone: string;
  cityRecipient: string;
  warehouseRecipient: string;
  /** Що всередині й скільки важить. */
  description: string;
  weight: number;
  cost: number;
  seats: number;
  /** Хто платить за доставку: 'Sender' або 'Recipient'. */
  payer: 'Sender' | 'Recipient';
  /** Габарити місця, см. Без них договір накладну не приймає. */
  box?: { length: number; width: number; height: number };
  /** Отримувач забирає з поштомата, а не з відділення. */
  postomat?: boolean;
  /** Скільки повернути грошей за післяплатою; 0 — без неї. */
  backMoney?: number;
}

/** Створити накладну. Повертає її номер. */
export async function createWaybill(
  cab: Cabinet | null,
  n: NewWaybill
): Promise<{ ok: true; ttn: string; ref: string } | { ok: false; error: string }> {
  const sender = await senderFromContract(cab);
  if (!sender.ok) return { ok: false, error: sender.error };

  const box = n.box || { length: 30, width: 20, height: 10 };

  const props: Record<string, unknown> = {
    NewAddress: '1',
    PayerType: n.payer,
    PaymentMethod: 'Cash',
    CargoType: 'Parcel',
    /* Вага в кілограмах; менше 0,1 перевізник не приймає. */
    Weight: String(Math.max(0.1, n.weight)),
    /* Поштомат — окремий тип послуги. З «відділення–відділення»
       перевізник посилку в поштомат не оформить. */
    ServiceType: n.postomat ? 'WarehousePostomat' : 'WarehouseWarehouse',
    SeatsAmount: String(Math.max(1, n.seats || 1)),
    Description: n.description.slice(0, 100),
    Cost: String(Math.max(1, Math.round(n.cost))),
    CitySender: n.citySender,
    Sender: sender.ref,
    SenderAddress: n.senderWarehouse,
    ContactSender: sender.contact,
    SendersPhone: sender.phone,
    /* Отримувача не заводимо контрагентом: за NewAddress перевізник
       створює його сам із назви міста, номера відділення й
       телефону. Інакше на кожне замовлення в кабінеті осідав би
       новий контрагент, і довідник за місяць став би непридатним. */
    RecipientCityName: n.cityRecipient,
    RecipientAddressName: n.warehouseRecipient,
    RecipientName: n.name,
    RecipientType: 'PrivatePerson',
    RecipientsPhone: String(n.phone || '').replace(/\D/g, ''),
    DateTime: todayStr(),
    /* Габарити місця. Перевізник вимагає їх окремо від ваги —
       «param OptionsSeat required», — бо за обʼємом він рахує
       свою вагу й може взяти більшу з двох. Розміри ті самі, що
       й у розрахунку доставки на сайті: одна коробка, одні
       числа. */
    OptionsSeat: [
      {
        volumetricVolume: String(volume(box)),
        volumetricWidth: String(box.width),
        volumetricLength: String(box.length),
        volumetricHeight: String(box.height),
        weight: String(Math.max(0.1, n.weight))
      }
    ]
  };

  if (n.backMoney && n.backMoney > 0) {
    props.BackwardDeliveryData = [
      { PayerType: 'Recipient', CargoType: 'Money', RedeliveryString: String(Math.round(n.backMoney)) }
    ];
  }

  const res = await npCall<{ IntDocNumber?: string; Ref?: string }>(
    cab, 'InternetDocument', 'save', props
  );
  if (!res.ok || !res.data.length) return { ok: false, error: res.error || 'перевізник не створив накладну' };

  const ttn = String(res.data[0].IntDocNumber || '');
  if (!ttn) return { ok: false, error: 'перевізник не повернув номер накладної' };
  return { ok: true, ttn, ref: String(res.data[0].Ref || '') };
}

/** Обʼєм коробки в кубометрах — саме в них його чекають. */
function volume(b: { length: number; width: number; height: number }): number {
  return Math.round(((b.length * b.width * b.height) / 1_000_000) * 10_000) / 10_000;
}

/** Скасувати накладну. Перевізник дозволяє це, доки посилку не
 *  прийняли у відділенні — далі вона вже їде, і скасувати нічого.
 *
 *  Видаляють за ідентифікатором документа, а не за номером. Якщо
 *  ідентифікатора немає (накладну вписали руками або створили до
 *  того, як ми почали його зберігати) — беремо з відстеження:
 *  воно віддає його полем RefEW. */
export async function deleteWaybill(
  cab: Cabinet | null,
  ttn: string,
  ref?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  let docRef = String(ref || '').trim();

  if (!docRef) {
    const found = await trackAll([{ ttn }]);
    docRef = found.get(String(ttn).trim())?.ref || '';
  }
  if (!docRef) {
    return { ok: false, error: 'перевізник не знає такої накладної — можливо, її вже видалено' };
  }

  const res = await npCall(cab, 'InternetDocument', 'delete', { DocumentRefs: [docRef] });
  if (!res.ok) return { ok: false, error: res.error || 'перевізник не видалив накладну' };
  return { ok: true };
}

/** Дата у вигляді, якого чекає перевізник: 11.08.2026 */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}
