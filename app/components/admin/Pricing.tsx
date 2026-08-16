'use client';

import { useMemo, useState } from 'react';
import {
  adviseOf,
  breakEven,
  ladderOf,
  leakOf,
  priceForEarn,
  spendOf,
  splitPrice,
  toLadder,
  type CostLine
} from '@/lib/admin/pricing';
import { rangeOf } from '@/lib/admin/insights';
import type { AdminOrder } from '@/lib/admin/orders';
import type { Catalogue } from '@/lib/catalog';

/* ============================================================
   Калькулятор випуску
   ------------------------------------------------------------
   Ліворуч — те, що власник рахує на папері: рахунки за пошив,
   чеки за тканину, зйомка, пакування. Праворуч — те, чого на
   папері не порахуєш: скільки з поставленої ціни справді
   залишиться і скільки штук треба продати, щоб випуск вийшов у
   нуль.

   ГОЛОВНЕ ЧИСЛО ТУТ НЕ ЦІНА, А ЗАРОБІТОК. «Собівартість ×3» не
   бачить ні знижки лояльності, ні промокоду, ні комісії банку —
   і саме тому наприкінці сезону виходить менше, ніж рахували.
   Тому калькулятор показує ціну розкладеною: скільки відкусили,
   скільки дійшло, скільки лишилось.

   РЕКЛАМА ЛЕЖИТЬ ОКРЕМО. Вона не в товарі — вона в місяці.
   Поклавши її в собівартість, магазин робить річ дорожчою
   назавжди через один невдалий таргет. Тут вона в окремому
   казані й видно її там, де їй місце: у «скільки продати, щоб
   вийти в нуль».
   ============================================================ */

const START: CostLine[] = [
  { id: 'fabric', title: 'Тканина', sum: 0, perUnit: false },
  { id: 'sew', title: 'Пошив', sum: 0, perUnit: false },
  { id: 'trims', title: 'Фурнітура, бирки, нитки', sum: 0, perUnit: false },
  { id: 'shoot', title: 'Зйомка', sum: 0, perUnit: false },
  { id: 'pack', title: 'Пакування', sum: 0, perUnit: true },
  { id: 'ads', title: 'Реклама запуску', sum: 0, perUnit: false, apart: true }
];

export default function Pricing({ orders, c }: { orders: AdminOrder[]; c: Catalogue }) {
  const [lines, setLines] = useState<CostLine[]>(START);
  const [units, setUnits] = useState(100);
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState(0);
  const [want, setWant] = useState('');

  const now = useMemo(() => new Date(), []);

  const view = useMemo(() => {
    const { from, to } = rangeOf('365', now);
    const spend = spendOf(lines, units);
    const leak = leakOf(orders, c, category, from, to);
    const advice = adviseOf(spend, units, leak, c, category);
    const shown = price || advice.work;
    return {
      spend,
      leak,
      advice,
      shown,
      split: splitPrice(shown, spend.unit, leak),
      need: breakEven(shown, spend, leak),
      ladder: ladderOf(c, category)
    };
  }, [lines, units, category, price, orders, c, now]);

  const { spend, leak, advice, split, need } = view;
  const share = units > 0 ? Math.min(999, Math.round((need / units) * 100)) : 0;

  const set = (id: string, patch: Partial<CostLine>) =>
    setLines((v) => v.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <div className="calc">
      <div className="calc__two">
        {/* ---------- Витрати ---------- */}
        <section className="ins__card">
          <header className="ins__card-head">
            <h3>Витрати випуску</h3>
            <span>як ви й рахуєте: усе разом, поділити на кількість</span>
          </header>

          <div className="calc__lines">
            {lines.map((l) => (
              <div className={'calc-line' + (l.apart ? ' is-apart' : '')} key={l.id}>
                <input
                  className="calc-line__title"
                  value={l.title}
                  aria-label="Назва витрати"
                  onChange={(e) => set(l.id, { title: e.target.value })}
                />
                <input
                  className="calc-line__sum"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={l.sum || ''}
                  aria-label={'Сума: ' + l.title}
                  onChange={(e) => set(l.id, { sum: Number(e.target.value) || 0 })}
                />
                {/* За партію чи за штуку — двома словами, бо саме
                    тут найлегше помилитись у десять разів. */}
                <button
                  type="button"
                  className="calc-line__mode"
                  onClick={() => set(l.id, { perUnit: !l.perUnit })}
                  title="За всю партію чи за одну річ"
                >
                  {l.perUnit ? 'за шт' : 'за партію'}
                </button>
                <button
                  type="button"
                  className="calc-line__drop"
                  aria-label="Прибрати рядок"
                  onClick={() => setLines((v) => v.filter((x) => x.id !== l.id))}
                >
                  ✕
                </button>
              </div>
            ))}

            <button
              type="button"
              className="btn btn--ghost btn--sm calc__add"
              onClick={() =>
                setLines((v) => [
                  ...v,
                  { id: 'x' + v.length + Date.now(), title: '', sum: 0, perUnit: false }
                ])
              }
            >
              + рядок витрат
            </button>
          </div>

          <div className="calc__units">
            <label>
              <span>Скільки одиниць у випуску</span>
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={units || ''}
                onChange={(e) => setUnits(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label>
              <span>Категорія</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">усі товари</option>
                {(c.categories || []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="calc__cost">
            <span>Собівартість одиниці</span>
            <b>{spend.unit.toLocaleString('uk')} грн</b>
            <i>
              у товар {spend.goods.toLocaleString('uk')}
              {spend.apart ? ` · окремо ${spend.apart.toLocaleString('uk')}` : ''}
            </i>
          </div>
        </section>

        {/* ---------- Ціна ---------- */}
        <section className="ins__card">
          <header className="ins__card-head">
            <h3>Яку ціну ставити</h3>
            <span>
              {advice.basis === 'margin'
                ? `за вашою маржею в категорії (${advice.known} товарів із собівартістю)`
                : advice.basis === 'prices'
                  ? 'за цінами, які вже стоять у цій категорії'
                  : 'даних магазину замало — узято звичайний множник'}
            </span>
          </header>

          <div className="calc__prices">
            <Price
              title="Межа"
              value={advice.floor}
              hint="нижче випуск не відбивається"
              on={view.shown === advice.floor}
              onPick={() => setPrice(advice.floor)}
            />
            <Price
              title="Робоча"
              value={advice.work}
              hint="як у вас прийнято"
              main
              on={view.shown === advice.work}
              onPick={() => setPrice(advice.work)}
            />
            <Price
              title="Смілива"
              value={advice.bold}
              hint="верх вашого прайсу"
              on={view.shown === advice.bold}
              onPick={() => setPrice(advice.bold)}
            />
          </div>

          <label className="calc__own">
            <span>Своя ціна</span>
            <input
              type="number"
              min="0"
              inputMode="numeric"
              placeholder={String(advice.work)}
              value={price || ''}
              onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>

          {/* ---------- Розклад ---------- */}
          <div className="calc__split">
            <Row label="Ціна" value={split.price} strong />
            <Row
              label={`Знижки${leak.discount ? ` · ${Math.round(leak.discount * 100)}%` : ''}`}
              value={-split.discount}
            />
            <Row label={`Комісія банку · ${(leak.fee * 100).toFixed(1)}%`} value={-split.fee} />
            <Row label="Дійшло до магазину" value={split.net} line />
            <Row label="Собівартість" value={-split.cost} />
            <Row
              label="Ваш заробіток"
              value={split.earn}
              strong
              tone={split.earn > 0 ? 'good' : 'bad'}
              note={split.price ? Math.round(split.margin * 100) + '%' : ''}
            />
          </div>

          {leak.sample < 5 ? (
            <p className="calc__note">
              Відсотки взято з {leak.sample} замовлень — це замало, щоб на них
              покладатись. Що більше продажів у цій категорії, то точнішим буде розклад.
            </p>
          ) : null}

          {/* ---------- Коли відіб'ється ---------- */}
          <div className={'calc__break' + (share > 90 ? ' is-bad' : share > 70 ? ' is-warn' : '')}>
            <b>
              Відбити випуск: {need.toLocaleString('uk')} шт
              {units ? <i> — це {share}% партії</i> : null}
            </b>
            <span>
              вкладено {spend.total.toLocaleString('uk')} грн
              {spend.apart ? `, з них ${spend.apart.toLocaleString('uk')} поза товаром` : ''}
            </span>
            {share > 90 ? (
              <em>
                За цією ціною випуск виходить у нуль, лише продавшись майже повністю.
                Так не буває — частина завжди лишається. Ціна замала.
              </em>
            ) : null}
          </div>

          {/* ---------- Зворотний хід ---------- */}
          <div className="calc__reverse">
            <label>
              <span>Хочу мати з речі</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="500"
                value={want}
                onChange={(e) => setWant(e.target.value)}
              />
            </label>
            {Number(want) > 0 ? (
              <b>
                ціна {toLadder(priceForEarn(Number(want), spend.unit, leak), view.ladder).toLocaleString('uk')} грн
              </b>
            ) : (
              <span className="is-quiet">порахуємо ціну навпаки — від заробітку</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Price({
  title,
  value,
  hint,
  main,
  on,
  onPick
}: {
  title: string;
  value: number;
  hint: string;
  main?: boolean;
  on?: boolean;
  onPick(): void;
}) {
  return (
    <button
      type="button"
      className={'calc-price' + (main ? ' is-main' : '') + (on ? ' is-on' : '')}
      onClick={onPick}
    >
      <span>{title}</span>
      <b>{value.toLocaleString('uk')}</b>
      <i>{hint}</i>
    </button>
  );
}

function Row({
  label,
  value,
  strong,
  line,
  tone,
  note
}: {
  label: string;
  value: number;
  strong?: boolean;
  line?: boolean;
  tone?: 'good' | 'bad';
  note?: string;
}) {
  return (
    <div className={'calc-row' + (strong ? ' is-strong' : '') + (line ? ' is-line' : '')}>
      <span>{label}</span>
      <b className={tone ? 'is-' + tone : undefined}>
        {value < 0 ? '−' : ''}
        {Math.abs(value).toLocaleString('uk')}
        {note ? <i> · {note}</i> : null}
      </b>
    </div>
  );
}
