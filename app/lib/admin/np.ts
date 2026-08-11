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

const URL_НП = 'https://api.novaposhta.ua/v2.0/json/';
const КЛЮЧ = '';
/** Межа перевізника на один запит. */
const ПАЧКА = 100;

/** Що саме зараз із посилкою — рівно те, що потрібно менеджеру. */
export interface Посилка {
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
}

/* ---------- Що означають коди ----------
   Перелік не вигаданий: узятий із документації перевізника.
   Нас цікавлять не всі, а ті, від яких залежить дія менеджера,
   тому решта злипається в «у дорозі». */

export type Стан =
  | 'нема' // номер не знайдено — найчастіше помилка в цифрах
  | 'створено' // накладну оформили, посилку ще не здали
  | 'дорога' // їде
  | 'чекає' // прибула у відділення, лежить
  | 'отримано'
  | 'відмова' // не забрали, повертається відправнику
  | 'повернуто'; // повернулась до нас

const КОДИ: Record<string, Стан> = {
  '1': 'створено',
  '2': 'відмова',
  '3': 'нема',
  '4': 'дорога',
  '41': 'дорога',
  '5': 'дорога',
  '6': 'дорога',
  '7': 'чекає',
  '8': 'чекає',
  '9': 'отримано',
  '10': 'отримано',
  '11': 'отримано',
  '12': 'дорога',
  '101': 'дорога',
  '102': 'відмова',
  '103': 'відмова',
  '104': 'дорога',
  '105': 'відмова',
  '106': 'повернуто',
  '111': 'відмова',
  '112': 'відмова'
};

export function стан(code?: string | null): Стан {
  return КОДИ[String(code || '')] || 'дорога';
}

/** Підпис для менеджера — коротко й дієсловом, а не кодом. */
export function підпис(п: Посилка): string {
  switch (стан(п.code)) {
    case 'нема':
      return 'Номер не знайдено';
    case 'створено':
      return 'Накладну створено — посилку ще не здано';
    case 'чекає':
      return п.waiting > 0 ? 'У відділенні ' + п.waiting + ' дн.' : 'Прибула у відділення';
    case 'отримано':
      return 'Отримано';
    case 'відмова':
      return 'Не забрали — повертається';
    case 'повернуто':
      return 'Повернулась до нас';
    default:
      return п.status || 'У дорозі';
  }
}

/** Наскільки це терміново: 0 — усе гаразд, 2 — треба реагувати. */
export function тривога(п: Посилка, порогУваги = 3, порогБіди = 5): 0 | 1 | 2 {
  const s = стан(п.code);
  if (s === 'нема' || s === 'відмова' || s === 'повернуто') return 2;
  if (s === 'чекає') {
    if (п.waiting >= порогБіди) return 2;
    if (п.waiting >= порогУваги) return 1;
  }
  if (s === 'створено') return 1; // накладна є, а посилки перевізник не бачить
  return 0;
}

/** Куди рухається замовлення за словами перевізника: 'shipped' —
 *  посилка вже в руках Нової Пошти, 'done' — її забрали.
 *  null — статус міняти не можна: або нічого не сталося, або
 *  сталося те, у чому має розібратись людина (повернення,
 *  помилковий номер). */
export function статусЗаТрекером(п: Посилка): 'shipped' | 'done' | null {
  const s = стан(п.code);
  if (s === 'отримано') return 'done';
  if (s === 'дорога' || s === 'чекає') return 'shipped';
  return null;
}

/* ---------- Запит ---------- */

interface Рядок {
  Number?: string;
  StatusCode?: string;
  Status?: string;
  RecipientDateTime?: string;
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

function днів(відколи?: string | null, тепер = new Date()): number {
  const s = String(відколи || '').trim();
  if (!s) return 0;
  /* Перевізник віддає дати трьома різними способами в одній і
     тій самій відповіді: «10-08-2026 20:11:35», «11.08.2026
     10:32:23» і «2026-08-11 08:13:00». Розбираємо всі три —
     інакше «лежить пʼятий день» тихо виходило б нулем, і смуга,
     заради якої все це затівалось, ніколи б не спрацювала. */
  const m = s.match(/^(\d{2})[.\-](\d{2})[.\-](\d{4})/);
  const d = m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return 0;
  const диф = Math.floor((тепер.getTime() - d.getTime()) / 86_400_000);
  return диф > 0 ? диф : 0;
}

async function пачка(items: { ttn: string; phone?: string }[]): Promise<Посилка[]> {
  const res = await fetch(URL_НП, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: КЛЮЧ,
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
  const json = (await res.json()) as { success?: boolean; data?: Рядок[] };
  if (!json.success || !Array.isArray(json.data)) return [];

  return json.data.map((r) => ({
    ttn: String(r.Number || ''),
    code: String(r.StatusCode || ''),
    status: String(r.Status || ''),
    gotAt: String(r.RecipientDateTime || ''),
    waiting: днів(r.DateFirstDayStorage),
    place: String(r.WarehouseRecipient || r.WarehouseRecipientAddress || ''),
    backMoney: Number(r.RedeliverySum) || 0,
    scheduled: String(r.ScheduledDeliveryDate || ''),
    city: String(r.CityRecipient || ''),
    createdAt: String(r.DateCreated || '')
  }));
}

/** Стан посилок за номерами. Порожні номери відсіюємо тут, щоб
 *  кожне місце виклику не робило це саме. */
export async function trackAll(
  items: { ttn?: string | null; phone?: string | null }[]
): Promise<Map<string, Посилка>> {
  const список = items
    .map((x) => ({ ttn: String(x.ttn || '').trim(), phone: String(x.phone || '') }))
    .filter((x) => x.ttn.length >= 8);

  const out = new Map<string, Посилка>();
  if (!список.length) return out;

  for (let i = 0; i < список.length; i += ПАЧКА) {
    try {
      const рядки = await пачка(список.slice(i, i + ПАЧКА));
      for (const р of рядки) if (р.ttn) out.set(р.ttn, р);
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

export interface Кабінет {
  workerUrl?: string;
  adminKey?: string;
}

export async function npCall<T = Record<string, unknown>>(
  cab: Кабінет | null,
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
      body: JSON.stringify({ type: 'np', key: cab?.adminKey || '', model, method, props })
    });
    const d = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: T[];
      error?: string;
    };
    return { ok: !!d.ok, data: d.data || [], error: d.error || (d.ok ? '' : 'воркер відповів кодом ' + res.status) };
  } catch {
    return { ok: false, data: [], error: 'не вдалося звʼязатися з воркером' };
  }
}

/** Хто відправник за договором: контрагент і контактна особа.
 *  Їх у договорі зазвичай по одному, тож не питаємо — беремо. */
export async function відправник(cab: Кабінет | null): Promise<
  { ok: true; ref: string; contact: string; phone: string; name: string } | { ok: false; error: string }
> {
  const к = await npCall<{ Ref?: string; Description?: string }>(
    cab, 'Counterparty', 'getCounterparties', { CounterpartyProperty: 'Sender', Page: '1' }
  );
  if (!к.ok || !к.data.length) return { ok: false, error: к.error || 'у договорі немає відправника' };
  const ref = String(к.data[0].Ref || '');

  const o = await npCall<{ Ref?: string; Phones?: string; Description?: string }>(
    cab, 'Counterparty', 'getCounterpartyContactPersons', { Ref: ref, Page: '1' }
  );
  if (!o.ok || !o.data.length) return { ok: false, error: o.error || 'у відправника немає контактної особи' };

  return {
    ok: true,
    ref,
    contact: String(o.data[0].Ref || ''),
    phone: String(o.data[0].Phones || ''),
    name: String(к.data[0].Description || '')
  };
}

export interface НоваНакладна {
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
  /** Скільки повернути грошей за післяплатою; 0 — без неї. */
  backMoney?: number;
}

/** Створити накладну. Повертає її номер. */
export async function створитиНакладну(
  cab: Кабінет | null,
  n: НоваНакладна
): Promise<{ ok: true; ttn: string; ref: string } | { ok: false; error: string }> {
  const в = await відправник(cab);
  if (!в.ok) return { ok: false, error: в.error };

  const props: Record<string, unknown> = {
    NewAddress: '1',
    PayerType: n.payer,
    PaymentMethod: 'Cash',
    CargoType: 'Parcel',
    /* Вага в кілограмах; менше 0,1 перевізник не приймає. */
    Weight: String(Math.max(0.1, n.weight)),
    ServiceType: 'WarehouseWarehouse',
    SeatsAmount: String(Math.max(1, n.seats || 1)),
    Description: n.description.slice(0, 100),
    Cost: String(Math.max(1, Math.round(n.cost))),
    CitySender: n.citySender,
    Sender: в.ref,
    SenderAddress: n.senderWarehouse,
    ContactSender: в.contact,
    SendersPhone: в.phone,
    /* Отримувача не заводимо контрагентом: за NewAddress перевізник
       створює його сам із назви міста, номера відділення й
       телефону. Інакше на кожне замовлення в кабінеті осідав би
       новий контрагент, і довідник за місяць став би непридатним. */
    RecipientCityName: n.cityRecipient,
    RecipientAddressName: n.warehouseRecipient,
    RecipientName: n.name,
    RecipientType: 'PrivatePerson',
    RecipientsPhone: String(n.phone || '').replace(/\D/g, ''),
    DateTime: сьогодні()
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

/** Дата у вигляді, якого чекає перевізник: 11.08.2026 */
function сьогодні(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}
