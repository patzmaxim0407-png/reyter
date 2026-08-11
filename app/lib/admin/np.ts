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
  StorageAmount?: string | number;
  BackwardDeliverySubTypesActions?: unknown;
  RedeliverySum?: string | number;
}

function днів(відколи?: string | null, тепер = new Date()): number {
  const s = String(відколи || '').trim();
  if (!s) return 0;
  // перевізник віддає «31-07-2026» або «2026-07-31 12:00:00»
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
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
    place: String(r.WarehouseRecipient || r.WarehouseRecipientAddress || r.CityRecipient || ''),
    backMoney: Number(r.RedeliverySum) || 0
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
