'use client';

import { useMemo, useState } from 'react';
import Combobox from '../Combobox';
import ProductChip from './ProductChip';
import { fmt } from '@/lib/catalog';
import type { Product } from '@/lib/types';

/* ============================================================
   Прихід і списання
   ------------------------------------------------------------
   Одна форма на дві дії — вони відрізняються лише напрямком і
   тим, що прихід спершу стає в чергу очікування, а списання
   забирає товар одразу.

   Товар обирають не зі списку назв, а з рядків із фото, артикулом,
   категорією, ціною й залишком: у каталозі є «Бріфи classic» і
   «Бріфи classic Black», і за самою назвою їх не розрізнити.
   Обране лишається чіпом над полем — щоб не покластися на памʼять.

   Розмітка й класи ті самі, що в старій панелі.
   ============================================================ */

export interface WriteoffReason {
  id: string;
  title: string;
}

export interface SizeCell {
  size: string;
  /** Скільки зараз на складі; null — документа залишків немає. */
  have: number | null;
}

export interface RestockSubmit {
  mode: 'in' | 'off';
  productId: string;
  /** Кількості за розмірами; ключ '' — товар без сітки. */
  qty: Record<string, number>;
  /** Прихід: очікувана дата. */
  expected: string;
  /** Списання: причина. */
  reason: string;
  note: string;
  /** Прихід: собівартість одиниці в цій партії. 0 — не міняємо. */
  cost?: number;
}

export default function RestockForm({
  products,
  reasons,
  today,
  sizesOf,
  categoryTitle,
  totalOf,
  onSubmit,
  busy
}: {
  products: Product[];
  reasons: WriteoffReason[];
  today: string;
  /** Розміри товару разом із поточними залишками. Порожній
   *  масив — товар без сітки, кількість одна. */
  sizesOf(p: Product): SizeCell[];
  categoryTitle(id: string): string;
  /** Скільки всього на складі; null — обліку немає. */
  totalOf(p: Product): number | null;
  /** true — записалось, форму можна чистити. Форма чекає на
   *  відповідь: між натисканням і записом стоять питання
   *  «списати більше, ніж є?», і після «скасувати» введене має
   *  лишитись на місці. */
  onSubmit(v: RestockSubmit): Promise<boolean>;
  busy?: boolean;
}) {
  const [mode, setMode] = useState<'in' | 'off'>('in');
  const [pid, setPid] = useState('');
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [expected, setExpected] = useState(today);
  const [reason, setReason] = useState(reasons[0]?.id ?? 'lost');
  const [note, setNote] = useState('');
  /* Собівартість партії. Підставляємо ту, що вже стоїть у товарі:
     найчастіше вона й не змінилась, а набирати те саме число
     щоразу — вірний спосіб перестати його вписувати взагалі. */
  const [cost, setCost] = useState('');

  const off = mode === 'off';
  const selected = products.find((p) => p.id === pid) ?? null;
  const cells = useMemo(() => (selected ? sizesOf(selected) : []), [selected, sizesOf]);

  /* Що станеться після оприбуткування — кажемо ДО нього.
     Залишок лишається за своєю ціною, нова партія йде за новою:
     спершу продасться старе, і лише потім нове. */
  const blend = useMemo(() => {
    const now = Math.round(Number(cost) || 0);
    const was = Math.round(Number(selected?.cost) || 0);
    if (!now) return null;
    const have = cells.reduce((n, x) => n + Math.max(0, x.have ?? 0), 0);
    const add = cells.reduce((n, x) => n + Math.max(0, Number(qty[x.size]) || 0), 0);
    if (!add) return null;
    return { have, add, was, now };
  }, [cost, selected, cells, qty]);

  /* Перемикання напрямку — це вже інша операція: кількості й
     нотатка від попередньої до неї не належать. Товар лишаємо:
     часто саме його щойно й дивились. */
  function switchMode(next: 'in' | 'off') {
    if (next === mode) return;
    setMode(next);
    setQty({});
    setNote('');
    setCost('');
    setExpected(today);
    setReason(reasons[0]?.id ?? 'lost');
  }

  return (
    <form
      className={'ao-restock-form' + (off ? ' is-writeoff' : '')}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!selected || busy) return;
        const done = await onSubmit({
          mode,
          productId: selected.id,
          qty,
          expected,
          reason,
          note: note.trim(),
          cost: Number(cost) || 0
        });
        if (!done) return;
        setQty({});
        setNote('');
        setCost('');
        setPid('');
        setSearch('');
        setExpected(today);
      }}
    >
      <div className="ao-restock-form__head">
        <div className="ao-chips">
          <button
            type="button"
            className={'ao-chip' + (!off ? ' is-active' : '')}
            onClick={() => switchMode('in')}
          >
            ↓ Прихід
          </button>
          <button
            type="button"
            className={'ao-chip' + (off ? ' is-active' : '')}
            onClick={() => switchMode('off')}
          >
            ↑ Списання
          </button>
        </div>
      </div>

      <p className="ao-note">
        {off
          ? 'Товар зникає зі складу одразу. Причина потрапляє в журнал руху — потім видно, скільки втрачено на браку, а скільки просто загубилось.'
          : 'Прихід стає в чергу очікування. Коли товар фізично приїде — натисніть «Оприбуткувати», і залишки зростуть.'}
      </p>

      <div className="ao-restock-form__row">
        <Combobox
          id="rstProduct"
          label=""
          className="acombo a-nopick a-rstpick"
          chip={selected ? <ProductChip p={selected} /> : null}
          value={search}
          placeholder="товар — назва або артикул"
          empty="Нічого не знайдено"
          minChars={0}
          openOnFocus
          search={async (q) => {
            const needle = q.trim().toLowerCase();
            return products
              .filter(
                (p) =>
                  !needle ||
                  p.name.toLowerCase().includes(needle) ||
                  p.id.toLowerCase().includes(needle) ||
                  categoryTitle(p.category).toLowerCase().includes(needle)
              )
              /* Свого зрізу тут більше немає: список ріже сам
                 Combobox і сам каже, скільки лишилось за межею.
                 Доти сорок товарів обривались мовчки — і при
                 порожньому запиті це були просто перші сорок
                 каталогу. */
              .map((p) => {
                const left = totalOf(p);
                return {
                  ref: p.id,
                  text: p.name,
                  value: p.name,
                  cls: 'a-pick',
                  node: (
                    <>
                      <img
                        className="a-pick__img"
                        src={p.images?.[0] ?? ''}
                        alt=""
                        width={34}
                        height={44}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                        }}
                      />
                      <span className="a-pick__body">
                        <b>{p.name}</b>
                        <i>
                          {p.id} · {categoryTitle(p.category)} · {fmt(p.price)} грн
                          {left === null ? '' : ` · ${left} шт`}
                        </i>
                      </span>
                    </>
                  )
                };
              });
          }}
          onType={(v) => {
            setSearch(v);
            setPid('');
            setQty({});
          }}
          onPick={(it) => {
            setSearch(it.value);
            setPid(it.ref);
            setQty({});
          }}
        />

        {off ? (
          <select
            title="Причина списання"
            aria-label="Причина списання"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {reasons.map((r) => (
              <option value={r.id} key={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="date"
            title="Очікувана дата приходу"
            aria-label="Очікувана дата приходу"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        )}
      </div>

      <div className="ao-restock-form__qty">
        {!selected ? (
          <p className="ao-note">Оберіть товар, щоб вказати кількість.</p>
        ) : (
          cells.map((c) => (
            <label
              className={'ao-qty' + (off && c.have === 0 ? ' is-zero' : '')}
              key={c.size || 'one'}
            >
              <span>
                {c.size || 'шт'}
                {c.have === null ? '' : ' · ' + c.have}
              </span>
              <input
                type="number"
                min="0"
                aria-label={(off ? 'Списати' : 'Прихід') + ', ' + (c.size || 'штук')}
                /* Обмеження лише там, де розмір справді рахують.
                   Поштучний товар лишаємо без max, як у старій
                   панелі: інакше при нульовому залишку в поле не
                   ввести нічого, і питання «списати більше, ніж
                   є?» ніколи б не пролунало. */
                max={off && c.size && c.have !== null ? Math.max(0, c.have) : undefined}
                value={qty[c.size] ?? 0}
                onChange={(e) =>
                  setQty((v) => ({ ...v, [c.size]: Math.max(0, Number(e.target.value) || 0) }))
                }
              />
            </label>
          ))
        )}
      </div>

      {/* Собівартість — лише для приходу: списання нічого не
          купує, і питати там ціну закупівлі ні до чого. */}
      {!off ? (
        <label className="ao-restock-form__cost">
          <span>Собівартість, грн</span>
          <input
            type="number"
            min="0"
            placeholder={selected?.cost ? String(selected.cost) : '—'}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
          <i>
            {blend && blend.have && blend.was && blend.was !== blend.now
              ? `спершу продасться залишок — ${blend.have} шт по ${blend.was} грн, і лише потім нова партія по ${blend.now}`
              : blend
                ? `${blend.add} шт по ${blend.now} грн стануть у чергу продажу`
                : 'ціна цієї партії: продаватись вона почне після залишку'}
          </i>
        </label>
      ) : null}

      <input
        aria-label="Нотатка"
        placeholder={
          off
            ? 'Нотатка: що саме сталося (необовʼязково)'
            : 'Нотатка: постачальник, партія тощо (необовʼязково)'
        }
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <button
        className={'btn ' + (off ? 'btn--danger' : 'btn--primary') + ' btn--sm'}
        type="submit"
        disabled={busy || !selected}
      >
        {off ? 'Списати зі складу' : 'Додати прихід'}
      </button>
    </form>
  );
}
