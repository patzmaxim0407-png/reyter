'use client';

import { useEffect, useState } from 'react';
import Combobox from '../Combobox';
import { useToast } from '../Toasts';
import { npCities, npWarehouses } from '@/lib/address';
import { створитиНакладну, type Кабінет } from '@/lib/admin/np';
import type { AdminOrder } from '@/lib/admin/orders';

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
function номерВідділення(branch: string): string {
  const m = String(branch || '').match(/№\s*(\d+)/);
  return m ? m[1] : '';
}

/** Чи годиться імʼя для накладної: щонайменше два слова. */
function повнеІмʼя(v: string): boolean {
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
  cabinet: Кабінет | null;
  /** Звідки відправляємо — з налаштувань магазину. */
  sender: { city: string; cityRef: string; warehouse: string; warehouseRef: string };
  /** Порахована вага посилки, кг. */
  weight: number;
  description: string;
  onSaveSender(v: { city: string; cityRef: string; warehouse: string; warehouseRef: string }): void;
  onDone(ttn: string): void;
  onClose(): void;
}) {
  const toast = useToast();
  const c = (order.customer ?? {}) as Record<string, string>;

  const [від, setВід] = useState(sender);
  /* Імʼя й телефон беремо із замовлення, але дозволяємо
     виправити: перевізник заводить отримувача як приватну особу
     й вимагає щонайменше прізвище та імʼя. Покупець же в кошику
     часто пише «Костя» — і накладна не створюється зовсім. */
  const [імʼя, setІмʼя] = useState(String(c.name || '').trim());
  const [тел, setТел] = useState(String(c.phone || '').trim());
  const [вага, setВага] = useState(String(weight || 0.5));
  const [опис, setОпис] = useState(description || 'Чоловіча білизна');
  const [оцінка, setОцінка] = useState(String(order.total || 0));
  const [платник, setПлатник] = useState<'Sender' | 'Recipient'>('Recipient');
  const [післяплата, setПісляплата] = useState('');
  const [йде, setЙде] = useState(false);
  /* Відмову перевізника лишаємо у вікні, а не в тості: вона
     називає рівно одне поле, якого бракує, і саме її треба
     прочитати уважно — а тост гасне за три секунди. */
  const [відмова, setВідмова] = useState('');

  const номер = номерВідділення(c.branch || '');
  /* Поштомат і відділення — різні послуги в перевізника, і
     переплутати їх означає не створити накладну взагалі. */
  const поштомат = /поштомат/i.test(c.branch || '');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  async function створити() {
    if (!від.cityRef || !від.warehouseRef) {
      toast('Спершу вкажіть, звідки відправляєте — місто й відділення');
      return;
    }
    if (!номер) {
      toast('У замовленні не видно номера відділення отримувача — впишіть ТТН руками');
      return;
    }
    if (!повнеІмʼя(імʼя)) {
      setВідмова(
        'Перевізник заводить отримувача як приватну особу й вимагає щонайменше прізвище та імʼя. ' +
          'Допишіть їх у полі «Отримувач» — у замовленні лишиться те, що написав покупець.'
      );
      return;
    }
    if (String(тел).replace(/\D/g, '').length < 10) {
      setВідмова('Телефон отримувача неповний — перевізник не прийме такий номер.');
      return;
    }
    setЙде(true);
    setВідмова('');
    const res = await створитиНакладну(cabinet, {
      citySender: від.cityRef,
      senderWarehouse: від.warehouseRef,
      name: імʼя.trim(),
      phone: тел,
      cityRecipient: (c.city || '').replace(/^м\.\s*/i, ''),
      warehouseRecipient: номер,
      description: опис,
      weight: Number(вага) || 0.5,
      cost: Number(оцінка) || 1,
      seats: 1,
      payer: платник,
      backMoney: Number(післяплата) || 0,
      postomat: поштомат
    });
    setЙде(false);

    if (!res.ok) {
      setВідмова(res.error);
      toast('Накладну не створено');
      return;
    }
    onSaveSender(від);
    onDone(res.ttn);
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
            {номер
              ? ' · ' + (поштомат ? 'поштомат' : 'відділення') + ' №' + номер
              : ' · номера відділення не видно'}
          </span>
        </div>

        <div className="ttn-grid">
          <label className="ao-field">
            <span>Отримувач</span>
            <input
              value={імʼя}
              placeholder="Прізвище та імʼя"
              onChange={(e) => setІмʼя(e.target.value)}
            />
          </label>
          <label className="ao-field">
            <span>Телефон</span>
            <input value={тел} inputMode="tel" onChange={(e) => setТел(e.target.value)} />
          </label>
        </div>
        <p className="ao-note">
          Перевізник заводить отримувача як приватну особу, тож імені з одного слова не приймає —
          потрібні прізвище та імʼя. У самому замовленні лишиться те, що написав покупець.
        </p>

        <div className="ttn-from">
          <span className="ao-field__label">Звідки відправляємо</span>
          <Combobox
            id="ttnCity"
            label="Місто"
            value={від.city}
            placeholder="почніть вводити назву"
            empty="addr.noCity"
            search={async (q) => {
              const list = await npCities(q);
              return list.map((x) => ({ ref: x.ref, text: x.label, value: x.name, note: '' }));
            }}
            onType={(city) => setВід((v) => ({ ...v, city, cityRef: '' }))}
            onPick={(it) =>
              setВід({ city: it.value, cityRef: it.ref, warehouse: '', warehouseRef: '' })
            }
          />
          <Combobox
            id="ttnWarehouse"
            label="Відділення"
            value={від.warehouse}
            disabled={!від.cityRef}
            openOnFocus
            minChars={0}
            placeholder="номер або вулиця"
            empty="addr.noBranch"
            needFirst="addr.pickCityFirst"
            search={async (q) => {
              if (!від.cityRef) return null;
              const list = await npWarehouses(від.cityRef, q);
              return list.map((x) => ({ ref: x.ref, text: x.label, value: x.label, note: '' }));
            }}
            onType={(warehouse) => setВід((v) => ({ ...v, warehouse, warehouseRef: '' }))}
            onPick={(it) => setВід((v) => ({ ...v, warehouse: it.value, warehouseRef: it.ref }))}
          />
        </div>

        <div className="ttn-grid">
          <label className="ao-field">
            <span>Вага, кг</span>
            <input value={вага} inputMode="decimal" onChange={(e) => setВага(e.target.value)} />
          </label>
          <label className="ao-field">
            <span>Оголошена вартість, грн</span>
            <input value={оцінка} inputMode="numeric" onChange={(e) => setОцінка(e.target.value)} />
          </label>
        </div>

        <label className="ao-field">
          <span>Опис вкладення</span>
          <input value={опис} maxLength={100} onChange={(e) => setОпис(e.target.value)} />
        </label>

        <div className="ttn-grid">
          <label className="ao-field">
            <span>Доставку платить</span>
            <select
              value={платник}
              onChange={(e) => setПлатник(e.target.value as 'Sender' | 'Recipient')}
            >
              <option value="Recipient">Отримувач</option>
              <option value="Sender">Ми</option>
            </select>
          </label>
          <label className="ao-field">
            <span>Післяплата, грн</span>
            <input
              value={післяплата}
              inputMode="numeric"
              placeholder="0 — без неї"
              onChange={(e) => setПісляплата(e.target.value)}
            />
          </label>
        </div>

        {відмова ? (
          <div className="ttn-err">
            <b>Перевізник не створив накладну</b>
            <p>{відмова}</p>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(відмова).then(() => toast('Скопійовано ✓', 'success'))}
            >
              Скопіювати текст
            </button>
          </div>
        ) : null}

        <p className="ao-note">
          Накладна створюється у вашому кабінеті Нової Пошти й одразу лягає в замовлення.
          Покупцеві піде лист із номером.
        </p>

        <div className="ttn-foot">
          <button className="btn btn--primary" type="button" disabled={йде} onClick={() => void створити()}>
            {йде ? 'Створюємо…' : 'Створити накладну'}
          </button>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Скасувати
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
