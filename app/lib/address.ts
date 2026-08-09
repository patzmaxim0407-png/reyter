/* ============================================================
   REYTER — адреса доставки
   ------------------------------------------------------------
   Два перевізники:

   • Нова Пошта — місто й відділення/поштомат підтягуються з
     їхнього API (api.novaposhta.ua). Ключ не потрібен: адресні
     методи відкриті, а CORS вони віддають самі, тож запит іде
     прямо з браузера.
   • Міжнародна доставка — повна адреса за міжнародним
     стандартом: країна, штат/область, місто, вулиця, індекс.

   Портовано з js/address.js один в один, але без DOM: розмітку
   полів (addressField / addressValue / addressCheck / initAddress
   і комбобокс) замінюють React-компоненти. Тут лишились дані,
   виклики Нової Пошти та адресна книга.
   ============================================================ */

import type { Lang } from './types';

const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';

/* ---------- Перевізники ---------- */

export type CarrierId = 'np' | 'intl';

export interface Carrier {
  id: CarrierId;
  title: string;
  titleEn: string;
}

export const CARRIERS: readonly Carrier[] = [
  { id: 'np', title: 'Нова Пошта', titleEn: 'Nova Poshta' },
  { id: 'intl', title: 'Міжнародна доставка', titleEn: 'International delivery' }
];

/* Назва перевізника ↔ id: у замовленнях зберігається назва,
   і старі замовлення теж мають читатись */
export function carrierId(title?: string | null): CarrierId {
  const t = String(title || '').toLowerCase();
  if (!t) return 'np';
  if (t.indexOf('міжнар') === 0 || t.indexOf('intern') === 0) return 'intl';
  return 'np';
}

/* В оригіналі мова бралася з глобального R.tf; тут її передають
   ззовні, щоб модуль працював і на сервері. Обидва перевізники
   мають titleEn, тож автоперекладу (R.tx) тут ніколи не було. */
export function carrierTitle(id: string, lang: Lang = 'uk'): string {
  const c = CARRIERS.find((x) => x.id === id) ?? CARRIERS[0];
  return lang === 'en' ? c.titleEn : c.title;
}

/* ---------- Нова Пошта ---------- */

export interface NpCity {
  ref: string;
  name: string;
  label: string;
  area: string;
  warehouses: number;
}

export interface NpWarehouse {
  ref: string;
  number: number;
  postomat: boolean;
  label: string;
  short: string;
}

/* Відповіді API описані такими, якими вони приходять насправді.
   Типи невимушено різні: кількість відділень у пошуку міст —
   число, а номер відділення в getWarehouses — рядок. Саме тому
   нижче всюди Number(). */
interface NpAddressRow {
  DeliveryCity: string;
  MainDescription: string;
  Present: string;
  Area: string;
  Warehouses: string | number;
}

interface NpSettlementRow {
  Addresses?: NpAddressRow[];
}

interface NpWarehouseRow {
  Ref: string;
  Number: string;
  CategoryOfWarehouse: string;
  Description: string;
  ShortAddress?: string;
  WarehouseStatus: string;
}

interface NpResponse {
  success?: boolean;
  errors?: string[];
  data?: unknown[];
}

/* Кеш на час життя вкладки: поки покупець набирає назву міста,
   той самий запит інакше летів би в API по кілька разів поспіль.

   Тільки в браузері. На сервері модуль спільний для всіх запитів,
   тож кеш став би загальним на весь процес — без строку давності
   й без межі: закриті відділення віддавались би до перезапуску,
   а словник міст ріс би нескінченно. */
const CACHE_LIMIT = 200;
const npCityCache = new Map<string, NpCity[]>();
const npWarehouseCache = new Map<string, NpWarehouse[]>();

function cacheGet<T>(map: Map<string, T>, key: string): T | undefined {
  return typeof window === 'undefined' ? undefined : map.get(key);
}

function cachePut<T>(map: Map<string, T>, key: string, value: T): void {
  if (typeof window === 'undefined') return;
  // найстаріший запис іде першим — Map тримає порядок вставки
  if (map.size >= CACHE_LIMIT) map.delete(map.keys().next().value as string);
  map.set(key, value);
}

async function npCall<T>(
  modelName: string,
  calledMethod: string,
  methodProperties: Record<string, string>
): Promise<T[]> {
  const res = await fetch(NP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: '',
      modelName: modelName,
      calledMethod: calledMethod,
      methodProperties: methodProperties
    })
  });
  const data = (await res.json()) as NpResponse;
  if (!data.success) throw new Error((data.errors || []).join('; ') || 'Нова Пошта не відповіла');
  return (data.data || []) as T[];
}

/* Пошук населеного пункту. Повертає ще й ref міста —
   саме за ним далі беруться відділення. */
export async function npCities(query?: string | null): Promise<NpCity[]> {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const hit = cacheGet(npCityCache, key);
  if (hit) return hit;

  const data = await npCall<NpSettlementRow>('Address', 'searchSettlements', {
    CityName: q,
    Limit: '25',
    Page: '1'
  });
  const rows = (data[0] && data[0].Addresses) || [];

  const list = rows
    .filter((a) => a.DeliveryCity)
    .map((a) => ({
      ref: a.DeliveryCity,
      name: a.MainDescription,
      // «м. Львів, Львівська обл.» — щоб не переплутати тезок
      label: a.Present,
      area: a.Area,
      warehouses: Number(a.Warehouses) || 0
    }));

  cachePut(npCityCache, key, list);
  return list;
}

/* Відділення й поштомати міста.
   Пошук робить сам API (FindByString) — у великих містах
   відділень кілька тисяч, тягнути їх усі в браузер немає сенсу.
   Він шукає і за номером, і за вулицею. */
export async function npWarehouses(
  cityRef?: string | null,
  query?: string | null
): Promise<NpWarehouse[]> {
  if (!cityRef) return [];
  const q = String(query || '').trim();
  const key = cityRef + '|' + q.toLowerCase();
  const hit = cacheGet(npWarehouseCache, key);
  if (hit) return hit;

  const props: Record<string, string> = { CityRef: cityRef, Limit: q ? '60' : '100', Page: '1' };
  if (q) props.FindByString = q;

  let rows = await npCall<NpWarehouseRow>('AddressGeneral', 'getWarehouses', props);

  /* Без запиту у великих містах у перші 100 потрапляють самі
     відділення, і поштоматів не видно взагалі. Дотягуємо їх
     окремо, щоб вибір був повним із першого відкриття. */
  if (!q && !rows.some((w) => w.CategoryOfWarehouse === 'Postomat')) {
    try {
      const boxes = await npCall<NpWarehouseRow>('AddressGeneral', 'getWarehouses', {
        CityRef: cityRef,
        FindByString: 'Поштомат',
        Limit: '50',
        Page: '1'
      });
      rows = rows.concat(boxes);
    } catch {
      /* без поштоматів теж можна жити */
    }
  }

  const list = rows
    .filter((w) => w.WarehouseStatus === 'Working')
    .map((w) => ({
      ref: w.Ref,
      number: Number(w.Number) || 0,
      postomat: w.CategoryOfWarehouse === 'Postomat',
      // «Відділення №1: вул. Городоцька, 359» — так його бачить клієнт
      label: w.Description,
      short: w.ShortAddress || ''
    }))
    // без запиту показуємо спершу відділення, тоді поштомати;
    // з запитом лишаємо порядок релевантності від API
    .sort((a, b) => {
      if (q) return 0;
      if (a.postomat !== b.postomat) return a.postomat ? 1 : -1;
      return a.number - b.number;
    });

  /* Список без запиту обрізаємо порівну: інакше у Львові
     чи Києві сто відділень витіснили б поштомати геть,
     і клієнт вирішив би, що їх немає */
  const shown = q
    ? list
    : list
        .filter((w) => !w.postomat)
        .slice(0, 60)
        .concat(list.filter((w) => w.postomat).slice(0, 40));

  cachePut(npWarehouseCache, key, shown);
  return shown;
}

/* ---------- Країни для міжнародної доставки ----------
   Список короткий навмисно: це напрямки, куди бренд реально
   відправляє. «Інша країна» лишає можливість вписати руками. */

export interface Country {
  code: string;
  title: string;
  titleEn: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'PL', title: 'Польща', titleEn: 'Poland' },
  { code: 'DE', title: 'Німеччина', titleEn: 'Germany' },
  { code: 'CZ', title: 'Чехія', titleEn: 'Czechia' },
  { code: 'SK', title: 'Словаччина', titleEn: 'Slovakia' },
  { code: 'AT', title: 'Австрія', titleEn: 'Austria' },
  { code: 'IT', title: 'Італія', titleEn: 'Italy' },
  { code: 'ES', title: 'Іспанія', titleEn: 'Spain' },
  { code: 'PT', title: 'Португалія', titleEn: 'Portugal' },
  { code: 'FR', title: 'Франція', titleEn: 'France' },
  { code: 'NL', title: 'Нідерланди', titleEn: 'Netherlands' },
  { code: 'BE', title: 'Бельгія', titleEn: 'Belgium' },
  { code: 'IE', title: 'Ірландія', titleEn: 'Ireland' },
  { code: 'GB', title: 'Велика Британія', titleEn: 'United Kingdom' },
  { code: 'SE', title: 'Швеція', titleEn: 'Sweden' },
  { code: 'NO', title: 'Норвегія', titleEn: 'Norway' },
  { code: 'DK', title: 'Данія', titleEn: 'Denmark' },
  { code: 'FI', title: 'Фінляндія', titleEn: 'Finland' },
  { code: 'CH', title: 'Швейцарія', titleEn: 'Switzerland' },
  { code: 'LT', title: 'Литва', titleEn: 'Lithuania' },
  { code: 'LV', title: 'Латвія', titleEn: 'Latvia' },
  { code: 'EE', title: 'Естонія', titleEn: 'Estonia' },
  { code: 'RO', title: 'Румунія', titleEn: 'Romania' },
  { code: 'HU', title: 'Угорщина', titleEn: 'Hungary' },
  { code: 'BG', title: 'Болгарія', titleEn: 'Bulgaria' },
  { code: 'GR', title: 'Греція', titleEn: 'Greece' },
  { code: 'US', title: 'США', titleEn: 'United States' },
  { code: 'CA', title: 'Канада', titleEn: 'Canada' },
  { code: 'AU', title: 'Австралія', titleEn: 'Australia' },
  { code: 'NZ', title: 'Нова Зеландія', titleEn: 'New Zealand' },
  { code: 'IL', title: 'Ізраїль', titleEn: 'Israel' },
  { code: 'AE', title: 'ОАЕ', titleEn: 'United Arab Emirates' },
  { code: 'TR', title: 'Туреччина', titleEn: 'Türkiye' },
  { code: 'JP', title: 'Японія', titleEn: 'Japan' },
  { code: 'other', title: 'Інша країна', titleEn: 'Other country' }
];

/* Де штат/провінція обовʼязкові за поштовим стандартом */
const STATE_REQUIRED: readonly string[] = ['US', 'CA', 'AU'];

/* Підказка формату індексу — щоб не вписували «000000» */
const ZIP_HINT: Record<string, string> = {
  PL: '00-001', DE: '10115', CZ: '110 00', SK: '811 01', AT: '1010',
  IT: '00100', ES: '28001', PT: '1000-001', FR: '75001', NL: '1011 AB',
  BE: '1000', IE: 'D02 XY45', GB: 'SW1A 1AA', SE: '111 20', NO: '0150',
  DK: '1050', FI: '00100', CH: '8001', LT: 'LT-01100', LV: 'LV-1010',
  EE: '10111', RO: '010011', HU: '1011', BG: '1000', GR: '104 31',
  US: '10001', CA: 'M5H 2N2', AU: '2000', NZ: '1010', IL: '6100000',
  AE: '00000', TR: '34000', JP: '100-0001'
};

export function zipHint(code: string): string {
  return ZIP_HINT[code] || '';
}

export function stateRequired(code: string): boolean {
  return STATE_REQUIRED.includes(code);
}

/* ---------- Модель адреси ----------
   Усе необовʼязкове: у профілі поля зʼявлялися поступово, а старі
   записи мають читатись без міграцій. */

export type IntlAddress = {
  countryCode?: string;
  country?: string;
  state?: string;
  city?: string;
  street?: string;
  extra?: string;
  zip?: string;
};

export type Address = {
  /** Назва перевізника так, як вона потрапляє в замовлення. */
  carrier?: string;
  carrierId?: string;
  city?: string;
  cityRef?: string;
  branch?: string;
  branchRef?: string;
  intl?: IntlAddress | null;
};

export type SavedAddress = Address & {
  id: string;
  /** Власний підпис картки: «Дім», «Робота». */
  label?: string;
};

/** Профіль покупця з localStorage. Крім адреси в ньому лежать
 *  імʼя, телефон, пошта й інше — модуль їх не чіпає, але мусить
 *  зберігати при перезаписі. */
export type Profile = Address & {
  name?: string;
  phone?: string;
  email?: string;
  comment?: string;
  addresses?: SavedAddress[];
  defaultAddressId?: string;
} & { [key: string]: unknown };

/* ---------- Форма адреси ----------
   У старому сайті ці три речі жили в коді, що читав DOM. Тут вони
   працюють із простим обʼєктом полів: розмітку малює React, а
   правила — те, що нижче, — лишаються ті самі. */

/** Стан форми: рівно ті поля, які покупець заповнює руками. */
export interface AddressForm {
  carrier: CarrierId;
  city: string;
  cityRef: string;
  branch: string;
  branchRef: string;
  countryCode: string;
  countryOther: string;
  state: string;
  intlCity: string;
  street: string;
  extra: string;
  zip: string;
}

export const EMPTY_FORM: AddressForm = {
  /* Порожній профіль — це Нова Пошта: нею користується
     переважна більшість, і зайвий вибір тут ні до чого */
  carrier: 'np',
  city: '',
  cityRef: '',
  branch: '',
  branchRef: '',
  countryCode: '',
  countryOther: '',
  state: '',
  intlCity: '',
  street: '',
  extra: '',
  zip: ''
};

/** Збережена адреса → поля форми. Приводить будь-який вхід до
 *  повної форми: старі записи в профілі частини полів не мають. */
export function toForm(v?: Address | null): AddressForm {
  const a = v || {};
  const intl = a.intl || {};
  return {
    carrier: carrierId(a.carrier),
    city: a.city || '',
    cityRef: a.cityRef || '',
    branch: a.branch || '',
    branchRef: a.branchRef || '',
    countryCode: intl.countryCode || '',
    /* Країну поза списком зберігали текстом у country — вона
       належить окремому полю, а не випадайці, тож повертаємо її
       туди, звідки вона прийшла. Ознака саме код 'other': він
       і сам є пунктом списку, тож «немає в COUNTRIES» тут не
       спрацювало б. */
    countryOther: intl.countryCode === 'other' ? intl.country || '' : '',
    state: intl.state || '',
    intlCity: intl.city || '',
    street: intl.street || '',
    extra: intl.extra || '',
    zip: intl.zip || ''
  };
}

/** Поля форми → адреса в тому вигляді, в якому вона лягає
 *  в замовлення, лист і адмінку. */
export function fromForm(f: AddressForm, lang: Lang = 'uk'): Address {
  if (f.carrier === 'np') {
    return {
      carrier: carrierTitle('np', lang),
      carrierId: 'np',
      city: f.city.trim(),
      cityRef: f.cityRef || '',
      branch: f.branch.trim(),
      branchRef: f.branchRef || ''
    };
  }

  const country =
    f.countryCode === 'other'
      ? f.countryOther.trim()
      : COUNTRIES.find((c) => c.code === f.countryCode)?.title || '';

  return {
    carrier: carrierTitle('intl', lang),
    carrierId: 'intl',
    /* city і branch дублюють закордонні поля навмисно: лист
       і адмінка друкують саме їх і про intl нічого не знають */
    city: f.intlCity.trim(),
    branch: [f.street.trim(), f.extra.trim()].filter(Boolean).join(', '),
    intl: {
      countryCode: f.countryCode,
      country: country,
      state: f.state.trim(),
      city: f.intlCity.trim(),
      street: f.street.trim(),
      extra: f.extra.trim(),
      zip: f.zip.trim()
    }
  };
}

/** Поле, на якому форма зупинилась, і ключ підказки. Порядок
 *  перевірок той самий, що й був: штат — після індексу. */
export type AddressProblem = { field: keyof AddressForm; key: string } | null;

export function checkAddress(f: AddressForm): AddressProblem {
  if (f.carrier === 'np') {
    if (!f.city.trim()) return { field: 'city', key: 'addr.needCity' };
    if (!f.branch.trim()) return { field: 'branch', key: 'addr.needBranch' };
    return null;
  }
  if (!f.countryCode) return { field: 'countryCode', key: 'addr.needCountry' };
  if (f.countryCode === 'other' && !f.countryOther.trim()) {
    return { field: 'countryOther', key: 'addr.needCountry' };
  }
  if (!f.intlCity.trim()) return { field: 'intlCity', key: 'addr.needCity' };
  if (!f.street.trim()) return { field: 'street', key: 'addr.needStreet' };
  if (!f.zip.trim()) return { field: 'zip', key: 'addr.needZip' };
  if (stateRequired(f.countryCode) && !f.state.trim()) {
    return { field: 'state', key: 'addr.needState' };
  }
  return null;
}

/* Один рядок адреси — для листа, повідомлення й адмінки */
export function addressLine(c?: Address | null): string {
  if (!c) return '';
  const intl = c.intl;
  if (intl && (intl.country || intl.zip || intl.street)) {
    return [intl.country, intl.state, intl.city, intl.street, intl.extra, intl.zip]
      .filter(Boolean)
      .join(', ');
  }
  return [c.carrier, c.city, c.branch].filter(Boolean).join(', ');
}

/* ============================================================
   Адресна книга профілю
   ------------------------------------------------------------
   Покупці замовляють на різні відділення — собі, на роботу,
   рідним. Тримаємо список адрес у профілі, а поля верхнього
   рівня (carrier / city / branch …) лишаємо дзеркалом основної:
   на них спираються кошик, лист і адмінка, і переписувати їх
   заради книги немає сенсу.
   ============================================================ */

const ADDR_FIELDS = ['carrier', 'carrierId', 'city', 'cityRef', 'branch', 'branchRef', 'intl'] as const;

function pickAddr(src?: Address | null): Address {
  const out: Address = {};
  if (!src) return out;
  for (const k of ADDR_FIELDS) {
    const v = src[k];
    if (v != null) Object.assign(out, { [k]: v });
  }
  return out;
}

function blankAddr(): Address {
  return { carrier: '', carrierId: '', city: '', cityRef: '', branch: '', branchRef: '', intl: null };
}

function hasAddr(a?: Address | null): boolean {
  if (!a) return false;
  const intl = a.intl || {};
  return !!(a.city || a.branch || intl.city || intl.street);
}

function nextId(list: SavedAddress[]): string {
  let n = 1;
  while (list.some((x) => x.id === 'a' + n)) n++;
  return 'a' + n;
}

/** Дві адреси вважаємо однаковою, якщо збігаються перевізник,
 *  місто, відділення/вулиця та індекс. Точного порівняння полів
 *  замало: те саме відділення приходить із різним регістром. */
export function sameAddress(a?: Address | null, b?: Address | null): boolean {
  if (!a || !b) return false;
  const key = (x: Address) => {
    const intl = x.intl || {};
    return [
      /* carrierId(x.carrier) ніколи не порожній — він повертає 'np'
         за замовчуванням, тож запасний x.carrierId тут мертвий.
         Лишаємо як в оригіналі: інакше однаковими стали б адреси,
         збережені без назви перевізника. */
      carrierId(x.carrier) || x.carrierId || '',
      (x.city || intl.city || '').toLowerCase().trim(),
      (x.branch || intl.street || '').toLowerCase().trim(),
      (intl.zip || '').toLowerCase().trim()
    ].join('|');
  };
  return key(a) === key(b);
}

/* Підпис картки: свій, якщо його вписали, інакше — місто */
export function addressTitle(a?: SavedAddress | Address | null): string {
  if (a && 'label' in a && a.label) return String(a.label);
  const intl = (a && a.intl) || {};
  return a ? a.city || intl.city || addressLine(a) || '' : '';
}

/** Читання/запис профілю передаємо ззовні: у браузері це
 *  localStorage з cart, на сервері — що завгодно або нічого. */
export interface ProfileStore {
  get(): Profile;
  save(profile: Profile): void;
  /** Дзеркалення в хмару. В оригіналі викликалось лише коли
   *  Firebase увімкнений і користувач залогінений — тепер це
   *  вирішує той, хто складає store. */
  saveCloud?(profile: Profile): void;
}

export interface SaveAddrOptions {
  /** Перезаписати конкретний запис, а не шукати схожий. */
  id?: string;
  label?: string;
  makeDefault?: boolean;
}

export interface AddrBook {
  list(): SavedAddress[];
  defaultId(): string;
  get(id: string): SavedAddress | null;
  save(addr: Address, opts?: SaveAddrOptions): string;
  remove(id: string): void;
  setDefault(id: string): void;
  same(a?: Address | null, b?: Address | null): boolean;
  title(a?: SavedAddress | Address | null): string;
}

export function createAddrBook(store: ProfileStore): AddrBook {
  const profile = (): Profile => store.get() || {};

  function commit(list: SavedAddress[], defaultId: string): Profile {
    const p = profile();
    const def = list.find((x) => x.id === defaultId) || list[0] || null;
    const next: Profile = {
      ...p,
      ...blankAddr(),
      ...(def ? pickAddr(def) : {}),
      addresses: list,
      defaultAddressId: def ? def.id : ''
    };
    store.save(next);
    store.saveCloud?.(next);
    return next;
  }

  const book: AddrBook = {
    /* Старий профіль тримав рівно одну адресу полями верхнього
       рівня — показуємо її як першу збережену */
    list() {
      const p = profile();
      const list = Array.isArray(p.addresses) ? p.addresses.filter(hasAddr) : [];
      if (list.length) return list;
      return hasAddr(p) ? [{ id: 'a1', label: '', ...pickAddr(p) }] : [];
    },

    defaultId() {
      const list = book.list();
      const saved = profile().defaultAddressId;
      return list.some((x) => x.id === saved) ? (saved as string) : list[0] ? list[0].id : '';
    },

    get(id) {
      return book.list().find((x) => x.id === id) || null;
    },

    /* Повертає id збереженої адреси. Однакову двічі не додаємо:
       після кожного замовлення книга інакше росла б дублікатами. */
    save(addr, opts = {}) {
      const list = book.list();
      const dup = list.find((x) => sameAddress(x, addr));
      const id = opts.id || (dup ? dup.id : nextId(list));
      const entry: SavedAddress = { id: id, label: opts.label || '', ...pickAddr(addr) };

      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) entry.label = opts.label != null ? opts.label : list[i].label || '';
      if (i >= 0) list[i] = entry;
      else list.push(entry);

      /* defaultId() перечитує профіль зі сховища, а не з list —
         так було в оригіналі, і поки книга не збережена, це та
         сама відповідь. */
      commit(list.slice(0, 12), opts.makeDefault ? id : book.defaultId());
      return id;
    },

    remove(id) {
      const list = book.list().filter((x) => x.id !== id);
      commit(list, book.defaultId() === id ? '' : book.defaultId());
    },

    setDefault(id) {
      commit(book.list(), id);
    },

    same: sameAddress,
    title: addressTitle
  };

  return book;
}
