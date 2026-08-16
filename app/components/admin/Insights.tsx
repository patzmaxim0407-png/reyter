'use client';

import { useMemo, useState } from 'react';
import {
  QUADRANTS,
  SPANS,
  bcgOf,
  byCategory,
  channelOf,
  cityOf,
  discountByProduct,
  grainFor,
  growth,
  knownSource,
  kpiOf,
  marginPercent,
  previous,
  rangeOf,
  rowsOf,
  seriesOf,
  sliceBy,
  spentOn,
  type Bcg,
  type BcgPoint,
  type Point,
  type Quadrant,
  type Row,
  type Slice,
  type Span
} from '@/lib/admin/insights';
import Pricing from './Pricing';
import { tipsFor, type Context, type Tip } from '@/lib/admin/advice';
import { availability, productSizes } from '@/lib/catalog';
import type { AdminOrder } from '@/lib/admin/orders';
import type { Catalogue } from '@/lib/catalog';

/* ============================================================
   Аналітика магазину
   ------------------------------------------------------------
   Екран, з якого ухвалюють рішення: що закупити, що зняти з
   полиці, куди подіти знижку. Тому тут немає жодного числа
   «просто щоб було» — кожне відповідає на питання, яке власник
   ставить собі сам.

   ПОРЯДОК НЕ ВИПАДКОВИЙ. Спершу шість чисел: скільки заробили і
   куди це рухається. Далі лінія часу — бо «двісті тисяч» без
   форми кривої не означає нічого. Далі матриця товарів: саме
   вона перетворює перелік на рішення. І аж потім переліки —
   товари, категорії, міста, — куди дивляться, коли вже знають,
   що шукають.

   МАЛЮЄМО САМІ, БЕЗ БІБЛІОТЕК. Графіків тут чотири види, і
   кожен — десяток рядків SVG. Бібліотека коштувала б сотні
   кілобайт у сторінці, яку відкривають зі складу з телефона, і
   принесла б власний вигляд, який усе одно довелося б
   перефарбовувати під магазин.

   ЧОГО ТУТ НЕМАЄ. Прогнозів. Магазину з піврічною історією
   передбачати нічого — будь-яка лінія тренду тут буде красивою
   вигадкою, за якою хтось замовить товар.
   ============================================================ */

const BLUE = '#014AAD';
const INK = '#062B5C';
const GREEN = '#15803D';
const MUTED = '#6E6A5E';

export default function Insights({ orders, c }: { orders: AdminOrder[]; c: Catalogue }) {
  /* Два екрани під однією вкладкою: показники — це «що вже
     сталося», калькулятор — «що робити далі». Розділяти їх на
     дві вкладки не варто: думають про них одночасно. */
  const [screen, setScreen] = useState<'stats' | 'calc'>('stats');
  const [span, setSpan] = useState<Span>('30');
  const now = useMemo(() => new Date(), []);

  const view = useMemo(() => {
    const { from, to } = rangeOf(span, now);
    const kpi = kpiOf(orders, c, from, to);
    const back = previous(span, now);
    const was = back ? kpiOf(orders, c, back.from, back.to) : null;
    const rows = rowsOf(orders, c, from, to);
    const titles = new Map((c.categories || []).map((x) => [x.id, x.title]));

    return {
      kpi,
      was,
      rows,
      cats: byCategory(rows, titles),
      bcg: bcgOf(rows),
      line: seriesOf(orders, c, from, to, grainFor(span, orders)),
      cities: sliceBy(orders, from, to, cityOf).slice(0, 8),
      /* Гроші за джерелами, а не замовлення: канал, який дає
         два дорогі замовлення, вартіший за той, що дає пʼять
         дешевих, і в переліку по штуках це видно навпаки. */
      channels: sliceBy(orders, from, to, channelOf, (o) =>
        (o.items || []).reduce((s2, i) => s2 + (Number(i.price) || 0) * (Number(i.qty) || 0), 0) -
        Math.max(0, Number(o.discount) || 0)
      ).filter((x) => x.id !== '—'),
      known: knownSource(orders, from, to),
      /* Контекст для порад: усе, з чого вони роблять висновки —
         залишок, розміри, знижка на сам товар, медіани категорії.
         Без цього поради були б настроєм, а не аналітикою. */
      advice: adviceFor(rows, bcgOf(rows), orders, c, from, to),
      sources: sliceBy(orders, from, to, (o) => String(o.source || 'Сайт')),
      pays: sliceBy(orders, from, to, (o) =>
        o.payInvoiceId ? 'Картка онлайн' : 'При отриманні'
      )
    };
  }, [orders, c, span, now]);

  const { kpi, was } = view;

  return (
    <div className="ins">
      <div className="ins__screens">
        <button
          type="button"
          className={'ins__screen' + (screen === 'stats' ? ' is-on' : '')}
          onClick={() => setScreen('stats')}
        >
          Показники
        </button>
        <button
          type="button"
          className={'ins__screen' + (screen === 'calc' ? ' is-on' : '')}
          onClick={() => setScreen('calc')}
        >
          Калькулятор випуску
        </button>
      </div>

      {screen === 'calc' ? <Pricing orders={orders} c={c} /> : null}

      {/* Обгортка мусить сама бути сіткою: інакше проміжки між
          картками зникають — вони належать батьківському .ins, а
          для нього все це стало одним елементом. */}
      <div className="ins__stats" hidden={screen !== 'stats'}>
      <header className="ins__head">
        <div className="ins__spans">
          {SPANS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={'ins__span' + (span === s.id ? ' is-on' : '')}
              onClick={() => setSpan(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>
        {/* Наскільки маржі взагалі можна вірити. Мовчати про це
            не можна: половина без собівартості — це половина
            маржі, якої ніхто не рахував. */}
        <span className={'ins__cover' + (kpi.covered < 0.9 ? ' is-warn' : '')}>
          {kpi.covered >= 0.999
            ? 'собівартість відома для всього проданого'
            : `маржа порахована для ${Math.round(kpi.covered * 100)}% виручки — решті товарів не вписана собівартість`}
        </span>
      </header>

      <div className="ins__kpis">
        <Kpi title="Виручка" value={kpi.revenue} was={was?.revenue} money big />
        <Kpi title="Маржа" value={kpi.margin} was={was?.margin} money tone="green" />
        <Kpi title="Замовлень" value={kpi.orders} was={was?.orders} />
        <Kpi title="Середній чек" value={kpi.average} was={was?.average} money />
        <Kpi title="Знижок віддано" value={kpi.discounts} was={was?.discounts} money tone="warn" invert />
        <Kpi title="Скасовано" value={kpi.cancelled} was={was?.cancelled} tone="warn" invert
             note={kpi.cancelledSum ? kpi.cancelledSum.toLocaleString('uk') + ' грн' : ''} />
      </div>

      <section className="ins__card">
        <header className="ins__card-head">
          <h3>Виручка й маржа</h3>
          <span>{kpi.buyers} покупців{kpi.repeat ? `, ${kpi.repeat} повернулись` : ''}</span>
        </header>
        <Line points={view.line} />
      </section>

      <section className="ins__card">
        <header className="ins__card-head">
          <h3>Матриця товарів</h3>
          <span>
            {view.bcg.axis === 'margin'
              ? 'маржа з одиниці · скільки штук продано'
              : 'ціна · скільки штук продано — впишіть собівартість, і тут буде маржа'}
          </span>
        </header>
        <Matrix bcg={view.bcg} advice={view.advice} />
        <div className="ins__quads">
          {(Object.keys(QUADRANTS) as Quadrant[]).map((q) => (
            <div key={q} className={'ins__quad ins__quad--' + q}>
              <b>
                {QUADRANTS[q].title}
                <i>{view.bcg.counts[q]}</i>
              </b>
              <span>{QUADRANTS[q].hint}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Що робити ---------- */}
      <Todo rows={view.rows} advice={view.advice} names={new Map(view.rows.map((r) => [r.id, r.name]))} />

      <div className="ins__two">
        <section className="ins__card">
          <header className="ins__card-head">
            <h3>Товари</h3>
            <span>за виручкою</span>
          </header>
          <Table rows={view.rows.slice(0, 14)} />
        </section>

        <section className="ins__card">
          <header className="ins__card-head">
            <h3>Категорії</h3>
            <span>виручка · витрати на товар · маржа</span>
          </header>
          <Cats rows={view.cats} />
        </section>
      </div>

      <div className="ins__two">
        <section className="ins__card">
          <header className="ins__card-head">
            <h3>Звідки клієнти</h3>
            <span>за грошима, які принесли</span>
          </header>
          {view.channels.length ? (
            <>
              <Slices list={view.channels} />
              {view.known < 0.999 ? (
                <p className="ins__foot">
                  Джерело відоме для {Math.round(view.known * 100)}% замовлень періоду: воно
                  записується з дня, коли зʼявилась ця вкладка, і в старих замовленнях його немає.
                </p>
              ) : null}
            </>
          ) : (
            <p className="ins__empty">
              Джерела ще не накопичились. Вони записуються з першого візиту після оновлення —
              реклама, пошук, Instagram, прямий захід.
            </p>
          )}
        </section>

        <section className="ins__card">
          <header className="ins__card-head">
            <h3>Куди возимо</h3>
          </header>
          <Slices list={view.cities} />
        </section>
      </div>

      <div className="ins__two">
        <section className="ins__card">
          <header className="ins__card-head">
            <h3>Як платять і звідки приходять</h3>
          </header>
          <Slices list={view.pays} />
          <Slices list={view.sources} />
        </section>
      </div>
      </div>
    </div>
  );
}

/* ---------- Число з порівнянням ---------- */

function Kpi({
  title,
  value,
  was,
  money,
  big,
  tone,
  invert,
  note
}: {
  title: string;
  value: number;
  was?: number;
  money?: boolean;
  big?: boolean;
  tone?: 'green' | 'warn';
  /** Для витрат зростання — погана новина, а не добра. */
  invert?: boolean;
  note?: string;
}) {
  const diff = was === undefined ? null : growth(value, was);
  const good = diff === null ? null : invert ? diff <= 0 : diff >= 0;

  return (
    <div className={'ins-kpi' + (big ? ' is-big' : '') + (tone ? ' is-' + tone : '')}>
      <span className="ins-kpi__title">{title}</span>
      <b className="ins-kpi__value">
        {value.toLocaleString('uk')}
        {money ? <i> грн</i> : null}
      </b>
      <span className="ins-kpi__foot">
        {diff === null ? (
          note || <span className="is-quiet">немає з чим порівняти</span>
        ) : (
          <>
            <em className={good ? 'is-up' : 'is-down'}>
              {diff > 0 ? '↑' : diff < 0 ? '↓' : '='} {Math.abs(diff)}%
            </em>{' '}
            <span className="is-quiet">до попереднього періоду</span>
          </>
        )}
      </span>
    </div>
  );
}

/* ---------- Лінія часу ---------- */

function Line({ points }: { points: Point[] }) {
  const [at, setAt] = useState(-1);
  if (!points.length) return <Empty />;

  const W = 1000;
  const H = 190;
  const pad = { l: 8, r: 8, t: 12, b: 16 };
  const top = Math.max(1, ...points.map((p) => p.revenue));
  const step = points.length > 1 ? (W - pad.l - pad.r) / (points.length - 1) : 0;
  const x = (i: number) => pad.l + i * step;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);

  const path = (pick: (p: Point) => number) =>
    points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(pick(p)).toFixed(1)).join(' ');

  const area =
    path((p) => p.revenue) +
    ` L ${x(points.length - 1).toFixed(1)} ${H - pad.b} L ${x(0).toFixed(1)} ${H - pad.b} Z`;

  /* Без наведення показуємо ПІДСУМОК періоду, а не останню
     точку. Остання — це сьогодні, і майже завжди вона нульова:
     під графіком із двома сплесками стояло «0 грн, 0 замовлень»,
     і перше враження від екрана було «нічого не продано». */
  const sum = points.reduce(
    (a, p) => ({
      at: '',
      revenue: a.revenue + p.revenue,
      margin: a.margin + Math.max(0, p.margin),
      orders: a.orders + p.orders
    }),
    { at: '', revenue: 0, margin: 0, orders: 0 }
  );
  const shown = at >= 0 ? points[at] : sum;

  return (
    <div className="ins-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Виручка за періодами">
        <defs>
          <linearGradient id="insFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BLUE} stopOpacity="0.18" />
            <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((k) => (
          <line
            key={k}
            x1={pad.l}
            x2={W - pad.r}
            y1={y(top * k)}
            y2={y(top * k)}
            stroke="rgba(23,27,38,.08)"
            strokeDasharray="4 6"
          />
        ))}

        <path d={area} fill="url(#insFill)" />
        <path d={path((p) => p.revenue)} fill="none" stroke={BLUE} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        <path
          d={path((p) => Math.max(0, p.margin))}
          fill="none"
          stroke={GREEN}
          strokeWidth="2"
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />

        {at >= 0 ? (
          <line x1={x(at)} x2={x(at)} y1={pad.t} y2={H - pad.b} stroke={INK} strokeOpacity=".35" />
        ) : null}
        {points.map((p, i) => (
          <rect
            key={p.at}
            x={x(i) - step / 2}
            y={0}
            width={Math.max(step, 6)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setAt(i)}
            onMouseLeave={() => setAt(-1)}
          />
        ))}
      </svg>

      <div className="ins-chart__legend">
        <b>{at >= 0 ? dayText(shown.at) : 'За період'}</b>
        <span>
          <i className="dot" style={{ background: BLUE }} />
          <b>{shown.revenue.toLocaleString('uk')}</b> грн
        </span>
        <span>
          <i className="dot" style={{ background: GREEN }} />
          маржа <b>{Math.max(0, shown.margin).toLocaleString('uk')}</b> грн
        </span>
        <span className="is-quiet">{shown.orders} замовл.</span>
      </div>
    </div>
  );
}

/* ---------- Матриця ---------- */

function Matrix({ bcg, advice }: { bcg: Bcg; advice: Map<string, Tip[]> }) {
  const [pick, setPick] = useState<BcgPoint | null>(null);
  if (!bcg.points.length) return <Empty />;

  const W = 1000;
  const H = 380;
  const pad = { l: 46, r: 18, t: 16, b: 38 };
  const maxX = Math.max(1, ...bcg.points.map((p) => p.x)) * 1.08;
  const maxY = Math.max(1, ...bcg.points.map((p) => p.y)) * 1.12;
  const x = (v: number) => pad.l + (W - pad.l - pad.r) * (v / maxX);
  const y = (v: number) => H - pad.b - (H - pad.t - pad.b) * (v / maxY);

  const mx = x(bcg.midX);
  const my = y(bcg.midY);

  /* Підписи, які не налазять одне на одного.

     Кілька товарів у одній точці — не рідкість: однакові маржа й
     кількість трапляються постійно. Їхні назви складались у
     нечитабельну кашу, де не прочитати жодної.

     Тому підпис дістається тому, кому вистачило місця: йдемо від
     найпомітніших — більше продано, вища маржа — і пропускаємо
     тих, чия назва перекрила б уже намальовану. Решту видно
     наведенням, і це чесніше за кашу. */
  const labels = new Set<string>();
  {
    const placed: { x: number; y: number; w: number }[] = [];
    for (const p of [...bcg.points].sort((a, b) => b.y - a.y || b.x - a.x)) {
      const cx = x(p.x);
      const cy = y(p.y);
      const w = Math.min(p.name.length, 22) * 6.4;
      const clash = placed.some(
        (o) => Math.abs(o.y - cy) < 16 && Math.abs(o.x - cx) < (o.w + w) / 2 + 10
      );
      if (clash) continue;
      placed.push({ x: cx, y: cy, w });
      labels.add(p.id);
    }
  }

  return (
    <div className="ins-matrix">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Матриця товарів">
        {/* Чверті — ледь помітним тлом: підказка, а не малюнок. */}
        <rect x={mx} y={pad.t} width={W - pad.r - mx} height={my - pad.t} fill={GREEN} opacity=".07" />
        <rect x={pad.l} y={pad.t} width={mx - pad.l} height={my - pad.t} fill={BLUE} opacity=".06" />
        <rect x={mx} y={my} width={W - pad.r - mx} height={H - pad.b - my} fill="#B45309" opacity=".06" />

        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="rgba(23,27,38,.18)" />
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} stroke="rgba(23,27,38,.18)" />
        <line x1={mx} x2={mx} y1={pad.t} y2={H - pad.b} stroke={INK} strokeOpacity=".38" strokeDasharray="6 6" />
        <line x1={pad.l} x2={W - pad.r} y1={my} y2={my} stroke={INK} strokeOpacity=".38" strokeDasharray="6 6" />

        <text x={W - pad.r} y={H - pad.b + 26} textAnchor="end" fontSize="13" fill={MUTED}>
          {bcg.axis === 'margin' ? 'маржа з одиниці, грн' : 'ціна, грн'}
        </text>
        <text x={pad.l - 8} y={pad.t + 10} textAnchor="end" fontSize="13" fill={MUTED}>
          шт.
        </text>

        {bcg.points.map((p) => (
          <g
            key={p.id}
            className="ins-dot"
            onMouseEnter={() => setPick(p)}
            onMouseLeave={() => setPick(null)}
          >
            <circle
              cx={x(p.x)}
              cy={y(p.y)}
              r={pick?.id === p.id ? 10 : 7}
              fill={
                p.quadrant === 'star' ? GREEN
                : p.quadrant === 'cow' ? BLUE
                : p.quadrant === 'question' ? '#B45309'
                : '#9AA0AA'
              }
              opacity={pick && pick.id !== p.id ? 0.35 : 0.92}
            />
            {/* Підписуємо лише помітні: інакше двадцять назв
                злипаються в сіру смугу, з якої не прочитати
                жодної. */}
            {labels.has(p.id) ? (
              <text x={x(p.x)} y={y(p.y) - 12} textAnchor="middle" fontSize="12" fill={INK}>
                {p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name}
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      <div className="ins-matrix__note">
        {pick ? (
          <>
            <b>{pick.name}</b>
            <span>{pick.qty} шт · {pick.revenue.toLocaleString('uk')} грн</span>
            <span>
              {pick.cost === null
                ? 'собівартість не вписана'
                : `маржа ${Math.round(pick.margin).toLocaleString('uk')} грн · ${pick.price - pick.cost} грн з одиниці`}
            </span>
            <span className="is-quiet">{QUADRANTS[pick.quadrant].title}</span>
          </>
        ) : (
          <span className="is-quiet">
            Лінії — медіани: половина товарів праворуч, половина вище. Наведіть на крапку.
          </span>
        )}
      </div>

      {/* Поради саме про той товар, на який дивляться. Порожньо —
          коли з ним усе гаразд, і це теж відповідь. */}
      {pick && advice.get(pick.id)?.length ? (
        <div className="ins-tips">
          {advice.get(pick.id)!.slice(0, 3).map((tip) => (
            <TipCard key={tip.kind} tip={tip} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Переліки ---------- */

function Table({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="ins-table">
      {rows.map((r) => (
        <div className="ins-row" key={r.id}>
          <span className="ins-row__name">
            <b>{r.name}</b>
            <i>{r.qty} шт · {r.orders} замовл.</i>
          </span>
          <span className="ins-row__bar">
            <i style={{ width: Math.max(2, Math.round(r.share * 100)) + '%' }} />
          </span>
          <span className="ins-row__sum">
            <b>{r.revenue.toLocaleString('uk')}</b>
            <i>{r.cost === null ? 'без собівартості' : Math.round(r.margin).toLocaleString('uk') + ' маржі'}</i>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Категорії з витратами.
 *
 *  Смуга показує не саму лише виручку, а її склад: скільки з неї
 *  пішло на закупівлю товару й скільки лишилось магазину. Так
 *  видно те, чого не видно в переліку виручки — категорія може
 *  бути першою за грошима й останньою за тим, що вона приносить.
 *
 *  Витрати тут — лише на ТОВАР. Реклама, пакування, комісія
 *  банку сюди не входять: за категоріями їх ніхто не веде, і
 *  чесно розкласти їх нема як. */
function Cats({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty />;
  const top = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <div className="ins-cats">
      {rows.map((r) => {
        const spent = spentOn(r);
        const percent = marginPercent(r);
        const width = Math.max(2, Math.round((r.revenue / top) * 100));
        const costPart = r.revenue > 0 ? Math.round((spent / r.revenue) * 100) : 0;
        return (
          <div className="ins-cat" key={r.id}>
            <span className="ins-cat__name">
              {r.name}
              {r.costed < r.revenue ? (
                <i title="Не всім товарам категорії вписана собівартість">·</i>
              ) : null}
            </span>
            <span className="ins-cat__track" style={{ width: width + '%' }}>
              <i className="ins-cat__cost" style={{ width: costPart + '%' }} />
            </span>
            <span className="ins-cat__nums">
              <b>{r.revenue.toLocaleString('uk')}</b>
              {spent ? <em>−{spent.toLocaleString('uk')}</em> : null}
              {percent === null ? (
                <i className="is-quiet">без собівартості</i>
              ) : (
                <i>{r.margin.toLocaleString('uk')} · {percent}%</i>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Slices({ list }: { list: Slice[] }) {
  if (!list.length) return <Empty />;
  return (
    <div className="ins-slices">
      {list.map((s) => (
        <div className="ins-slice" key={s.id}>
          <span>{s.name}</span>
          <span className="ins-slice__track">
            <i style={{ width: Math.max(2, Math.round(s.share * 100)) + '%' }} />
          </span>
          <b>{Math.round(s.share * 100)}%</b>
        </div>
      ))}
    </div>
  );
}

/** «2026-08-16» під графіком читається повільніше, ніж «16 серп.»
 *  Місяць у ряду теж називаємо словом. */
function dayText(at: string): string {
  const parts = at.split('-');
  if (parts.length === 2) {
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
  }
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? at
    : d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

/* ============================================================
   ПОРАДИ
   ------------------------------------------------------------
   Збираємо для кожного товару все, з чого можна зробити висновок:
   скільки лежить на складі, яких розмірів немає, скільки з'їдає
   знижка саме на ньому, як він виглядає проти сусідів по
   категорії. Самі висновки — у lib/admin/advice.ts, і вони чисті:
   те, що можна перевірити прогоном, не має жити в компоненті.
   ============================================================ */
function adviceFor(
  rows: Row[],
  bcg: Bcg,
  orders: AdminOrder[],
  c: Catalogue,
  from: Date,
  to: Date
): Map<string, Tip[]> {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  const discounts = discountByProduct(orders, c, from, to);
  const quadrants = new Map(bcg.points.map((p) => [p.id, p.quadrant]));

  /* Знижка по магазину — база для порівняння. Товар зі знижкою
     18% при середніх 7% і той самий товар при середніх 17% — дві
     різні новини. */
  const all = [...discounts.values()];
  const shopDiscount = all.length ? all.reduce((n, x) => n + x, 0) / all.length : 0;

  /* Медіани категорії рахуємо один раз на категорію, а не на
     товар: інакше на тридцяти товарах це тридцять однакових
     обходів. */
  const cats = new Map<string, { margins: number[]; prices: number[]; qty: number[] }>();
  for (const r of rows) {
    const box = cats.get(r.category) || { margins: [], prices: [], qty: [] };
    if (r.cost !== null && r.costed > 0) box.margins.push(r.margin / r.costed);
    if (r.price > 0) box.prices.push(r.price);
    box.qty.push(r.qty);
    cats.set(r.category, box);
  }
  const mid = (list: number[]) => {
    if (!list.length) return 0;
    const s = [...list].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const out = new Map<string, Tip[]>();
  for (const r of rows) {
    const p = (c.products || []).find((x) => x.id === r.id);
    const av = p ? availability(c, p) : null;
    const sizes = p ? productSizes(p) : [];
    /* Розміри, яких немає — лише з тих, які товар узагалі має:
       інакше в «немає» потрапили б XS і XXL, яких не шили. */
    const gone = p && av && !p.volume ? sizes.filter((s2) => !av.sizes.includes(s2)) : [];
    const box = cats.get(r.category) || { margins: [], prices: [], qty: [] };

    const ctx: Context = {
      stock: av ? Math.max(0, av.total) : 0,
      gone: av?.soldOut ? [] : gone,
      sizes: sizes.length,
      days,
      catMargin: box.margins.length >= 2 ? mid(box.margins) : 0,
      catPrice: box.prices.length >= 3 ? mid(box.prices) : 0,
      /* Скільки продає середній товар категорії. Без цього
         «мало» й «багато» — це відчуття, а не число. */
      catQty: box.qty.length >= 3 ? Math.max(1, Math.round(mid(box.qty))) : 0,
      discount: discounts.get(r.id) || 0,
      shopDiscount,
      sale: !!p?.sale,
      quadrant: quadrants.get(r.id) || 'dog'
    };
    const tips = tipsFor(r, ctx);
    if (tips.length) out.set(r.id, tips);
  }
  return out;
}

/** Перелік справ по всьому магазину.
 *
 *  Впорядкований ГРОШИМА, а не тривогою: зверху не найгучніше, а
 *  найдорожче. Власник не читає двадцять пунктів — він читає
 *  перші три, і саме вони мусять бути тими, що коштують найбільше.
 *
 *  По одній пораді на товар: якщо в речі три біди, найдорожча з
 *  них однаково вирішується першою, а решта підтягнеться. */
function Todo({
  rows,
  advice,
  names
}: {
  rows: Row[];
  advice: Map<string, Tip[]>;
  names: Map<string, string>;
}) {
  /* Перелік мусить бути РІЗНИЙ.

     Спершу я брав у кожного товару найпершу пораду — і екран
     заповнювався шістьма однаковими «дошити розміри». Це не шість
     проблем, а одне правило, що спрацювало шість разів: читати
     такий перелік марно, бо він не каже, що робити ЗАРАЗ.

     Тому: по дві поради одного роду щонайбільше, і в кожного
     товару беремо ту, яка ще не набридла. Так у шести рядках
     опиняються шість різних важелів — ціна, собівартість, показ,
     наявність. */
  const all = rows
    .flatMap((r) => (advice.get(r.id) || []).map((tip) => ({ id: r.id, tip })))
    .filter((x) => x.tip.urgency > 0 || x.tip.money > 0)
    .sort((a, b) => b.tip.urgency - a.tip.urgency || b.tip.money - a.tip.money);

  const list: { id: string; tip: Tip }[] = [];
  const perKind = new Map<string, number>();
  const seen = new Set<string>();

  for (const x of all) {
    if (list.length >= 6) break;
    if (seen.has(x.id)) continue;
    const used = perKind.get(x.tip.kind) || 0;
    if (used >= 2) continue;
    perKind.set(x.tip.kind, used + 1);
    seen.add(x.id);
    list.push(x);
  }

  if (!list.length) return null;

  return (
    <section className="ins__card">
      <header className="ins__card-head">
        <h3>Що робити</h3>
        <span>спершу те, що коштує найбільше</span>
      </header>
      <div className="ins-todo">
        {list.map(({ id, tip }) => (
          <div className={'ins-todo__row is-u' + tip.urgency} key={id}>
            <span className="ins-todo__who">
              <b>{names.get(id) || id}</b>
              <i>{tip.title}</i>
            </span>
            <span className="ins-todo__what">
              <span>{tip.what}</span>
              <em>{tip.todo}</em>
            </span>
            {tip.money > 0 ? <span className="ins-todo__money">{tip.money.toLocaleString('uk')} грн</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Порада одним блоком. */
function TipCard({ tip }: { tip: Tip }) {
  return (
    <div className={'ins-tip is-u' + tip.urgency}>
      <b>{tip.title}</b>
      <span>{tip.what}</span>
      <em>{tip.todo}</em>
    </div>
  );
}

function Empty() {
  return <p className="ins__empty">За цей період продажів не було.</p>;
}
