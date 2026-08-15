'use client';

import { useEffect, useState } from 'react';
import Combobox from '../Combobox';
import { useToast } from '../Toasts';
import { npCities, npWarehouses } from '@/lib/address';
import { createWaybill, type Cabinet } from '@/lib/admin/np';
import { paidForGoods, type AdminOrder } from '@/lib/admin/orders';

/* ============================================================
   Накладна просто із замовлення
   ------------------------------------------------------------
   Досі шлях був такий: менеджер відкриває кабінет Нової Пошти,
   набирає там імʼя, телефон, місто й відділення заново, отримує
   номер, повертається в адмінку й вписує його руками. Чотири
   переписування тих самих даних — і саме тут беруться посилки,
   що поїхали не тим людям.

   Тепер накладна створюється звідси: отримувача підставляє
   замовлення, відправника — договір, а менеджер підтверджує вагу
   й опис. Номер одразу лягає в замовлення, замовлення стає
   «Відправлено», а покупцеві йде лист.

   Ключ від кабінету в браузер не потрапляє: запит іде через
   воркер, де він і лежить.
   ============================================================ */

/** Номер відділення з його назви: «Відділення №20 (до 30 кг…)» → 20 */
function branchNumber(branch: string): string {
  const m = String(branch || '').match(/№\s*(\d+)/);
  return m ? m[1] : '';
}

/** Число з поля: українська розкладка дає кому, а Number('1,5')
 *  це NaN — і накладна на півтора кілограма тихо йшла б як на
 *  півкілограма, а перевізник перерахував би доставку у
 *  відділенні. */
function toNumber(v: string): number {
  const n = Number(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Чи годиться імʼя для накладної: щонайменше два слова. */
function fullName(v: string): boolean {
  return String(v || '')
    .trim()
    .split(/\s+/)
    .filter((x) => x.length >= 2).length >= 2;
}

export default function TtnCreate({
  order,
  cabinet,
  sender,
  weight,
  description,
  onSaveSender,
  onDone,
  onClose
}: {
  order: AdminOrder;
  cabinet: Cabinet | null;
  /** Звідки відправляємо — з налаштувань магазину. */
  sender: { city: string; cityRef: string; warehouse: string; warehouseRef: string };
  /** Порахована вага посилки, кг. */
  weight: number;
  description: string;
  onSaveSender(v: { city: string; cityRef: string; warehouse: string; warehouseRef: string }): void;
  onDone(ttn: string, ref: string): void;
  onClose(): void;
}) {
  const toast = useToast();
  const c = (order.customer ?? {}) as Record<string, string>;

  const [since, setSince] = useState(sender);
  /* Імʼя й телефон беремо із замовлення, але дозволяємо
     виправити: перевізник заводить отримувача як приватну особу
     й вимагає щонайменше прізвище та імʼя. Покупець же в кошику
     часто пише «Костя» — і накладна не створюється зовсім. */
  const [name, setName] = useState(String(c.name || '').trim());
  const [phone, setPhone] = useState(String(c.phone || '').trim());
  const [weightText, setWeight] = useState(String(weight || 0.5));
  const [descr, setDesc] = useState(description || 'Чоловіча білизна');
  /* Оголошена вартість — це ціна вкладення, а не сума до сплати.
     Доставка в неї не входить: за неї перевізник відповідає й
     так, а страхує він те, що всередині коробки. Коли покупець
     оплатив доставку разом із замовленням, різниця саме на неї —
     і платити з неї страховий відсоток нема за що. */
  const [declared, setDeclared] = useState(String(paidForGoods(order) || order.total || 0));
  /* Хто платить перевізникові.
  
     Коли доставка сидить у сумі замовлення, покупець уже заплатив
     її НАМ — і платити ще раз у відділенні він не має. Тому в
     таких замовленнях одразу «Ми»: інакше з людини візьмуть
     гроші двічі, а дізнаємось ми про це з її повідомлення.
  
     Коли ж shipping нульовий, доставка в замовлення не входила:
     ціна лежала довідковим рядком, і платить її отримувач на
     місці, як і домовлялись. */
  const paidShipping = Math.round(Number(order.shipping) || 0) > 0;
  const [payer, setPayer] = useState<'Sender' | 'Recipient'>(paidShipping ? 'Sender' : 'Recipient');
  const [backMoney, setCod] = useState('');
  const [sending, setSending] = useState(false);
  /* Відмову перевізника лишаємо у вікні, а не в тості: вона
     називає рівно одне поле, якого бракує, і саме її треба
     прочитати уважно — а тост гасне за три секунди. */
  const [refusal, setRefusal] = useState('');

  const num = branchNumber(c.branch || '');
  /* Поштомат і відділення — різні послуги в перевізника, і
     переплутати їх означає не створити накладну взагалі. */
  const postomat = /поштомат/i.test(c.branch || '');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  async function submit() {
    if (!since.cityRef || !since.warehouseRef) {
      toast('Спершу вкажіть, звідки відправляєте — місто й відділення');
      return;
    }
    if (!num) {
      toast('У замовленні не видно номера відділення отримувача — впишіть ТТН руками');
      return;
    }
    if (!fullName(name)) {
      setRefusal(
        'Перевізник заводить отримувача як приватну особу й вимагає щонайменше прізвище та імʼя. ' +
          'Допишіть їх у полі «Отримувач» — у замовленні лишиться те, що написав покупець.'
      );
      return;
    }
    if (String(phone).replace(/\D/g, '').length < 10) {
      setRefusal(
        'Телефон у замовленні неповний — перевізник не прийме такий номер. Виправте його ' +
          'в самому замовленні («Редагувати замовлення»), щоб номер на накладній і в ' +
          'замовленні лишались тим самим.'
      );
      return;
    }
    setSending(true);
    setRefusal('');
    const res = await createWaybill(cabinet, {
      citySender: since.cityRef,
      senderWarehouse: since.warehouseRef,
      name: name.trim(),
      phone: phone,
      cityRecipient: (c.city || '').replace(/^м\.\s*/i, ''),
      warehouseRecipient: num,
      /* Посилання із замовлення — ті самі, за якими рахувалась
         доставка в кошику. За ними перевізник знаходить село
         однозначно, а за назвою — ні. */
      cityRef: String(c.cityRef || ''),
      branchRef: String(c.branchRef || ''),
      description: descr,
      weight: toNumber(weightText) || 0.5,
      cost: toNumber(declared) || 1,
      seats: 1,
      payer: payer,
      backMoney: toNumber(backMoney) || 0,
      postomat: postomat
    });
    setSending(false);

    if (!res.ok) {
      setRefusal(res.error);
      toast('Накладну не створено');
      return;
    }
    onSaveSender(since);
    onDone(res.ttn, res.ref);
  }

  return (
    <div className="a-modal" role="dialog" aria-modal="true">
      <div className="a-modal__backdrop" onClick={onClose} />
      <div className="a-modal__panel a-modal__panel--sm ttn-panel">
        <header className="a-modal__head">
          <h3>Створити накладну</h3>
          <button className="a-modal__close" type="button" aria-label="Закрити" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="ttn-box">

        <div className="ttn-to">
          <span>
            {c.city || '—'}
            {num
              ? ' · ' + (postomat ? 'поштомат' : 'відділення') + ' №' + num
              : ' · номера відділення не видно'}
          </span>
        </div>

        <div className="ttn-grid">
          <label className="ao-field">
            <span>Отримувач</span>
            <input
              value={name}
              placeholder="Прізвище та імʼя"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {/* Телефон не редагується тут навмисно. Саме за ним
              перевізник знаходить отримувача, і саме він має
              збігатися з тим, що в замовленні: вставлений похапцем
              інший номер означає посилку, яку людина не забере, і
              помилку, якої ніхто не помітить. Треба інший —
              виправляйте в самому замовленні. */}
          <label className="ao-field">
            <span>Телефон</span>
            <input value={phone} readOnly title="Той самий номер, що в замовленні" />
          </label>
        </div>
        <p className="ao-note">
          Перевізник заводить отримувача як приватну особу, тож імені з одного слова не приймає —
          потрібні прізвище та імʼя. У самому замовленні лишиться те, що написав покупець.
          Телефон береться із замовлення й не редагується тут: він має збігатися з тим, за
          яким людина шукатиме посилку.
        </p>

        <div className="ttn-from">
          <span className="ao-field__label">Звідки відправляємо</span>
          <Combobox
            id="ttnCity"
            label="Місто"
            value={since.city}
            placeholder="почніть вводити назву"
            empty="addr.noCity"
            search={async (q) => {
              const list = await npCities(q);
              return list.map((x) => ({ ref: x.ref, text: x.label, value: x.name, note: '' }));
            }}
            onType={(city) => setSince((v) => ({ ...v, city, cityRef: '' }))}
            onPick={(it) =>
              setSince({ city: it.value, cityRef: it.ref, warehouse: '', warehouseRef: '' })
            }
          />
          <Combobox
            id="ttnWarehouse"
            label="Відділення"
            value={since.warehouse}
            disabled={!since.cityRef}
            openOnFocus
            minChars={0}
            placeholder="номер або вулиця"
            empty="addr.noBranch"
            needFirst="addr.pickCityFirst"
            search={async (q) => {
              if (!since.cityRef) return null;
              const list = await npWarehouses(since.cityRef, q);
              return list.map((x) => ({ ref: x.ref, text: x.label, value: x.label, note: '' }));
            }}
            onType={(warehouse) => setSince((v) => ({ ...v, warehouse, warehouseRef: '' }))}
            onPick={(it) => setSince((v) => ({ ...v, warehouse: it.value, warehouseRef: it.ref }))}
          />
        </div>

        <div className="ttn-grid">
          <label className="ao-field">
            <span>Вага, кг</span>
            <input value={weightText} inputMode="decimal" onChange={(e) => setWeight(e.target.value)} />
          </label>
          <label className="ao-field">
            <span>Оголошена вартість, грн</span>
            <input value={declared} inputMode="numeric" onChange={(e) => setDeclared(e.target.value)} />
          </label>
        </div>

        <label className="ao-field">
          <span>Опис вкладення</span>
          <input value={descr} maxLength={100} onChange={(e) => setDesc(e.target.value)} />
        </label>

        <div className="ttn-grid">
          <label className="ao-field">
            <span>Доставку платить</span>
            <select
              value={payer}
              onChange={(e) => setPayer(e.target.value as 'Sender' | 'Recipient')}
            >
              <option value="Recipient">Отримувач</option>
              <option value="Sender">Ми</option>
            </select>
            {paidShipping && payer === 'Sender' ? (
              <span className="field__hint">
                доставка вже в сумі замовлення — {Math.round(Number(order.shipping) || 0)} грн
              </span>
            ) : null}
            {paidShipping && payer === 'Recipient' ? (
              <span className="field__hint is-warn">
                покупець уже оплатив доставку разом із замовленням — у відділенні з нього візьмуть удруге
              </span>
            ) : null}
          </label>
          <label className="ao-field">
            <span>Післяплата, грн</span>
            <input
              value={backMoney}
              inputMode="numeric"
              placeholder="0 — без неї"
              onChange={(e) => setCod(e.target.value)}
            />
          </label>
        </div>

        {refusal ? (
          <div className="ttn-err">
            <b>Перевізник не створив накладну</b>
            <p>{refusal}</p>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(refusal).then(() => toast('Скопійовано ✓', 'success'))}
            >
              Скопіювати текст
            </button>
          </div>
        ) : null}

        <p className="ao-note">
          Накладна створюється у вашому кабінеті Нової Пошти й одразу лягає в замовлення.
          Покупцеві піде лист із номером.
        </p>

        </div>

        {/* Підвал за межами прокрутки й у тому самому порядку, що
            в решті вікон адмінки: головна кнопка праворуч. Доти
            «Створити накладну» ховалася нижче згину, і її треба
            було шукати гортанням. */}
        <footer className="a-modal__foot">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Скасувати
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={sending}
            onClick={() => void submit()}
          >
            {sending ? 'Створюємо…' : 'Створити накладну'}
          </button>
        </footer>
      </div>
    </div>
  );
}
