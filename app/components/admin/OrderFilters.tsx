'use client';

import { useEffect, useRef } from 'react';
import { ORDER_STATUSES, statusInfo } from '@/lib/account';
import { t } from '@/lib/i18n';
import type { AdminOrder } from './OrderCard';

/* Смуги фільтрів над списком замовлень. Розмітка й класи ті самі,
   що в старій панелі. */

export const PERIODS: [string, string][] = [
  ['today', 'Сьогодні'],
  ['yesterday', 'Вчора'],
  ['7d', '7 днів'],
  ['30d', '30 днів'],
  ['month', 'Цей місяць'],
  ['all', 'Весь час'],
  ['custom', 'Свій період']
];

export const SORTS: [string, string][] = [
  ['new', 'Спершу нові'],
  ['old', 'Спершу старі'],
  ['sum', 'Сума ↓'],
  ['sumAsc', 'Сума ↑']
];

export interface Filters {
  period: string;
  from: string;
  to: string;
  status: string;
  search: string;
  sort: string;
}

/* Після перемальовки стрічка фільтрів починається з нуля —
   повертаємо в поле зору те, що обране зараз. Рухаємо саме
   доріжку, а не сторінку: замовлення оновлюються в реальному
   часі, і scrollIntoView підкидав би адміна вгору на кожен
   знімок, хоч би де він читав список. */
function useKeepActiveVisible(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = ref.current;
    const active = strip?.querySelector('.ao-chip.is-active');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    const s = strip.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    strip.scrollLeft += a.left - s.left - (s.width - a.width) / 2;
  }, [dep]);
  return ref;
}

export function PeriodBar({
  f,
  set,
  today
}: {
  f: Filters;
  set(patch: Partial<Filters>): void;
  today: string;
}) {
  const strip = useKeepActiveVisible(f.period);

  return (
    <div className="ao-filterbar">
      <div className="ao-chips" ref={strip}>
        {PERIODS.map(([id, title]) => (
          <button
            key={id}
            type="button"
            className={'ao-chip' + (f.period === id ? ' is-active' : '')}
            onClick={() => set({ period: id })}
          >
            {title}
          </button>
        ))}
      </div>

      {f.period === 'custom' ? (
        <span className="ao-daterange">
          <input type="date" value={f.from} max={today} onChange={(e) => set({ from: e.target.value })} />
          <i>—</i>
          <input type="date" value={f.to} max={today} onChange={(e) => set({ to: e.target.value })} />
        </span>
      ) : null}
    </div>
  );
}

export function StatusBar({
  f,
  set,
  /** Замовлення періоду, що вже пройшли пошук: лічильники мають
   *  показувати, скільки лишиться після кліку, а не скільки їх
   *  усього в базі. */
  scope
}: {
  f: Filters;
  set(patch: Partial<Filters>): void;
  scope: AdminOrder[];
}) {
  const strip = useKeepActiveVisible(f.status);
  const count = (id: string) =>
    id === 'all' ? scope.length : scope.filter((o) => (o.status || 'new') === id).length;

  return (
    <div className="ao-filterbar">
      <div className="ao-chips" ref={strip}>
        {(['all', ...ORDER_STATUSES] as string[]).map((id) => (
          <button
            key={id}
            type="button"
            className={'ao-chip' + (f.status === id ? ' is-active' : '')}
            onClick={() => set({ status: id })}
          >
            {id === 'all' ? 'Всі' : statusInfo(id, t).title} <i>{count(id)}</i>
          </button>
        ))}
      </div>

      <input
        className="ao-search"
        placeholder="Пошук: №, імʼя, телефон, ТТН, місто, товар"
        value={f.search}
        onChange={(e) => set({ search: e.target.value })}
      />

      <select className="ao-sort" value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
        {SORTS.map(([id, title]) => (
          <option value={id} key={id}>
            {title}
          </option>
        ))}
      </select>
    </div>
  );
}

export function BulkBar({
  visible,
  selected,
  onSelectAll,
  onBulkStatus,
  onExport,
  onPrint,
  onClear
}: {
  visible: number;
  selected: number;
  onSelectAll(on: boolean): void;
  onBulkStatus(id: string): void;
  onExport(): void;
  onPrint(): void;
  onClear(): void;
}) {
  if (!selected) {
    return (
      <div className="ao-bulk ao-bulk--idle">
        <label className="a-check">
          <input type="checkbox" checked={false} onChange={(e) => onSelectAll(e.target.checked)} />{' '}
          Вибрати всі показані ({visible})
        </label>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onExport}>
          Експорт CSV
        </button>
      </div>
    );
  }

  return (
    <div className="ao-bulk is-active">
      <label className="a-check">
        <input type="checkbox" checked onChange={(e) => onSelectAll(e.target.checked)} /> Обрано:{' '}
        <b>{selected}</b>
      </label>
      <span className="ao-bulk__actions">
        {ORDER_STATUSES.map((id) => (
          <button
            key={id}
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={() => onBulkStatus(id)}
          >
            {statusInfo(id, t).title}
          </button>
        ))}
        <button className="btn btn--ghost btn--sm" type="button" onClick={onExport}>
          Експорт CSV
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onPrint}>
          Друк
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onClear}>
          Зняти вибір
        </button>
      </span>
    </div>
  );
}
