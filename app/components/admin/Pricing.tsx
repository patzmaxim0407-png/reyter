'use client';

import { useEffect, useMemo, useState } from 'react';
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
import {
  loadReleases,
  makeRestocks,
  planOf,
  paybackOf,
  saveRelease,
  totalUnits,
  unitsOf,
  type Release,
  type ReleaseItem,
  type Split
} from '@/lib/admin/release';
import { db } from '@/lib/firebase';
import { useToast } from '../Toasts';
import { useAdminUser } from './AdminGate';
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
  const toast = useToast();
  const user = useAdminUser();

  const [lines, setLines] = useState<CostLine[]>(START);
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState(0);
  const [want, setWant] = useState('');

  /* Випуск: назва, дата й що з нього вийшло. Доки товарів немає,
     екран працює як простий калькулятор — саме так ним і почнуть
     користуватись. */
  const [title, setTitle] = useState('');
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<ReleaseItem[]>([]);
  const [howSplit, setHowSplit] = useState<Split>('units');
  const [id, setId] = useState('');
  const [saved, setSaved] = useState<Release[]>([]);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    const d = db();
    if (d) void loadReleases(d).then(setSaved);
  }, []);

  /* Скільки одиниць у випуску. Товарів немає — рахуємо як
     раніше, одним числом: калькулятор має працювати й без
     випуску. */
  const [loose, setLoose] = useState(100);
  const units = items.length ? totalUnits(items) : loose;

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
      ladder: ladderOf(c, category),
      plan: planOf({ lines, items, split: howSplit })
    };
  }, [lines, units, category, price, orders, c, now, items, howSplit]);

  const { spend, leak, advice, split, need, plan } = view;
  const share = units > 0 ? Math.min(999, Math.round((need / units) * 100)) : 0;

  const set = (lineId: string, patch: Partial<CostLine>) =>
    setLines((v) => v.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));

  const names = useMemo(
    () => new Map((c.products || []).map((p) => [p.id, p.name])),
    [c.products]
  );

  const release: Release = { _id: id, title, at, lines, items, split: howSplit };

  /** Відкрити збережений випуск. */
  function open(r: Release) {
    setId(r._id);
    setTitle(r.title || '');
    setAt(r.at || '');
    setLines(r.lines?.length ? r.lines : START);
    setItems(r.items || []);
    setHowSplit(r.split || 'units');
    setPrice(0);
  }

  function fresh() {
    setId('');
    setTitle('');
    setAt(new Date().toISOString().slice(0, 10));
    setLines(START);
    setItems([]);
    setPrice(0);
  }

  async function keep() {
    const d = db();
    if (!d) return toast('Немає звʼязку з базою');
    setBusy(true);
    const res = await saveRelease(d, user.email ?? '', release);
    setBusy(false);
    if (!res.ok) return toast(res.message);
    setId(res.id);
    setSaved(await loadReleases(d));
    toast('Випуск збережено ✓', 'success');
  }

  async function toStock() {
    const d = db();
    if (!d) return toast('Немає звʼязку з базою');
    if (!id) return toast('Спершу збережіть випуск');
    setBusy(true);
    const res = await makeRestocks(d, user.email ?? '', { ...release, _id: id }, plan, names, new Date());
    setBusy(false);
    if (!res.ok) return toast(res.message);
    setSaved(await loadReleases(d));
    toast(`Створено приходів: ${res.made} ✓`, 'success');
  }

  const done = saved.find((r) => r._id === id)?.restockedAt || '';

  return (
    <div className="calc">
      {/* ---------- Збережені випуски ---------- */}
      {saved.length ? (
        <div className="calc__saved">
          <button type="button" className={'calc-chip' + (id ? '' : ' is-on')} onClick={fresh}>
            + новий
          </button>
          {saved.slice(0, 12).map((r) => {
            const back = paybackOf(r, planOf(r), orders, c, now);
            return (
              <button
                key={r._id}
                type="button"
                className={'calc-chip' + (id === r._id ? ' is-on' : '')}
                onClick={() => open(r)}
                title={`${r.at} · вкладено ${back.spent.toLocaleString('uk')} грн`}
              >
                {r.title || r.at}
                <i>{Math.round(back.ratio * 100)}%</i>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="calc__two">
        {/* ---------- Витрати ---------- */}
        <section className="ins__card">
          <header className="ins__card-head">
            <h3>Витрати випуску</h3>
            <span>як ви й рахуєте: усе разом, поділити на кількість</span>
          </header>

          <div className="calc__title">
            <input
              value={title}
              placeholder="Назва випуску — «Осінь 2026»"
              aria-label="Назва випуску"
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              type="date"
              value={at}
              aria-label="Дата випуску"
              onChange={(e) => setAt(e.target.value)}
            />
          </div>

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
                {/* Пряма витрата чи спільна. Тканина — на свій
                    товар, зйомка — на весь випуск. */}
                {items.length > 1 ? (
                  <select
                    className="calc-line__for"
                    value={l.for || ''}
                    aria-label="На який товар"
                    onChange={(e) => set(l.id, { for: e.target.value || undefined })}
                  >
                    <option value="">на весь випуск</option>
                    {items.map((x) => (
                      <option key={x.productId} value={x.productId}>
                        {names.get(x.productId) || x.productId}
                      </option>
                    ))}
                  </select>
                ) : null}
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
                readOnly={items.length > 0}
                title={items.length ? 'Рахується з товарів випуску' : ''}
                onChange={(e) => setLoose(Math.max(0, Number(e.target.value) || 0))}
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

          {/* ---------- Що вийшло ---------- */}
          <div className="calc__items">
            <div className="calc__items-head">
              <span>Що вийшло у випуску</span>
              {items.length > 1 ? (
                <button
                  type="button"
                  className="calc-line__mode"
                  onClick={() => setHowSplit(howSplit === 'units' ? 'models' : 'units')}
                  title="Як ділити спільні витрати — зйомку, пакування партією"
                >
                  спільне {howSplit === 'units' ? 'за штуками' : 'за моделями'}
                </button>
              ) : null}
            </div>

            {items.map((it, n) => {
              const share = plan.shares.find((x) => x.productId === it.productId);
              return (
                <div className="calc-item" key={it.productId + n}>
                  <span className="calc-item__name">{names.get(it.productId) || it.productId}</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    aria-label="Скільки одиниць"
                    value={unitsOf(it) || ''}
                    onChange={(e) =>
                      setItems((v) =>
                        v.map((x, i) =>
                          i === n ? { productId: x.productId, qty: Math.max(0, Number(e.target.value) || 0) } : x
                        )
                      )
                    }
                  />
                  <b>{share ? share.unit.toLocaleString('uk') + ' грн' : '—'}</b>
                  <button
                    type="button"
                    className="calc-line__drop"
                    aria-label="Прибрати товар"
                    onClick={() => setItems((v) => v.filter((_, i) => i !== n))}
                  >
                    ✕
                  </button>
                </div>
              );
            })}

            <select
              className="calc__pick"
              value=""
              onChange={(e) => {
                const pid = e.target.value;
                if (!pid || items.some((x) => x.productId === pid)) return;
                setItems((v) => [...v, { productId: pid, qty: 0 }]);
              }}
            >
              <option value="">+ додати товар випуску</option>
              {(c.products || [])
                .filter((p) => !items.some((x) => x.productId === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="calc__cost">
            <span>Собівартість одиниці</span>
            <b>{spend.unit.toLocaleString('uk')} грн</b>
            <i>
              у товар {spend.goods.toLocaleString('uk')}
              {spend.apart ? ` · окремо ${spend.apart.toLocaleString('uk')}` : ''}
            </i>
          </div>

          <div className="calc__acts">
            <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={keep}>
              {id ? 'Зберегти зміни' : 'Зберегти випуск'}
            </button>
            {/* Приходи створюються НЕ оприбуткованими: партія
                стане в чергу тоді, коли товар справді приїде. */}
            <button
              className="btn btn--primary btn--sm"
              type="button"
              disabled={busy || !id || !plan.shares.length || !!done}
              onClick={toStock}
              title={done ? 'Приходи з цього випуску вже створені ' + done : ''}
            >
              {done ? 'Приходи створені ✓' : 'Створити приходи'}
            </button>
          </div>
          {plan.shares.length && !done ? (
            <p className="calc__hint">
              Створить {plan.shares.length} приход
              {plan.shares.length === 1 ? '' : plan.shares.length < 5 ? 'и' : 'ів'} із уже
              порахованою собівартістю — набирати її вдруге не доведеться.
            </p>
          ) : null}
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

          {/* ---------- Скільки вже повернулось ---------- */}
          {id ? <Back release={{ ...release, _id: id }} orders={orders} c={c} now={now} /> : null}

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

/** Скільки з випуску вже повернулось. Зʼявляється лише в
 *  збереженого випуску: у щойно набраного повертатись нема чому. */
function Back({
  release,
  orders,
  c,
  now
}: {
  release: Release;
  orders: AdminOrder[];
  c: Catalogue;
  now: Date;
}) {
  const back = paybackOf(release, planOf(release), orders, c, now);
  if (!back.spent) return null;

  const percent = Math.round(back.ratio * 100);
  const left = Math.max(0, back.spent - back.back);

  return (
    <div className={'calc__back' + (percent >= 100 ? ' is-done' : '')}>
      <div className="calc__back-bar">
        <i style={{ width: Math.min(100, percent) + '%' }} />
      </div>
      <b>
        Випуск відбито на {percent}%
        {left ? <i> — лишилось {left.toLocaleString('uk')} грн</i> : <i> — своє повернули</i>}
      </b>
      <span>
        вкладено {back.spent.toLocaleString('uk')} · повернулось {back.back.toLocaleString('uk')} ·
        продано {back.sold} з {back.units} шт
      </span>
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
