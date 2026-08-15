'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import PublishControl from './PublishControl';
import SettingsDialog from './SettingsDialog';
import MemberRow from './MemberRow';
import { useAdminUser } from './AdminGate';
import { useAsk } from './AskProvider';
import { useToast } from '../Toasts';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { watchDraft, EMPTY_DRAFT, type Draft } from '@/lib/admin/store';
import { watchMembers, watchOrders, type Doc } from '@/lib/admin/live';
import {
  DEFAULT_RULES,
  LEVELS,
  deadlineOf,
  isFriendly,
  ladderRows,
  levelsOf,
  type DiscountRules,
  type LadderRow
} from '@/lib/loyalty';
import {
  MEMBERS_COL,
  findMembers,
  inClub,
  loadRules,
  planHistoryDone,
  planManual,
  saveRules,
  sweepHistory,
  statsOf,
  writeMove,
  type HistorySource,
  type MemberDoc
} from '@/lib/admin/loyalty-db';

/* ============================================================
   Програма лояльності
   ------------------------------------------------------------
   Три речі на одному екрані, бо всі три про одне: скільки
   магазин винен покупцям і кому саме.

   УЧАСНИКИ — перелік із пошуком. Зверху ті, хто чекає на
   зарахування історії: це єдина дія, якої програма справді
   потребує від людини, і відкладати її нема сенсу.

   ПРАВКИ роблять із обовʼязковою причиною. Через півроку на
   питання «звідки в нього ці дві тисячі» має бути чим
   відповісти, і памʼять тут не помічник.

   НАЛАШТУВАННЯ лежать у settings/public — там же, звідки їх
   бере сайт і воркер при виставленні рахунку. Одне джерело на
   трьох, інакше кошик показував би одну знижку, а банк просив
   іншу суму.
   ============================================================ */

type Tab = 'members' | 'rules';
/** Кого показувати: усі, за рівнем, у клубі, «рівень дозволив,
 *  але Instagram не вписано», черга на зарахування. */
type Only = 'all' | '1' | '2' | '3' | '4' | 'club' | 'ready' | 'wait';
type Sort = 'points' | 'level' | 'new' | 'soon';

export default function LoyaltyAdmin() {
  const user = useAdminUser();
  const ask = useAsk();
  const toast = useToast();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [orders, setOrders] = useState<HistorySource[]>([]);
  const [rules, setRules] = useState<DiscountRules>(DEFAULT_RULES);
  const [tab, setTab] = useState<Tab>('members');
  const [find, setFind] = useState('');
  const [only, setOnly] = useState<Only>('all');
  const [sort, setSort] = useState<Sort>('points');
  const [busy, setBusy] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* Один прохід на одне відкриття екрана. Без цього кожна нова
     порція даних із бази запускала б зарахування наново. */
  const swept = useRef(false);

  const need = () => {
    const d = db();
    if (!d) toast('Немає звʼязку з базою');
    return d;
  };

  useEffect(() => {
    const offDraft = watchDraft(setDraft);
    const offMembers = watchMembers((list) => setMembers(list as unknown as MemberDoc[]));
    /* Замовлення потрібні лише для зарахування історії, зате всі:
       рахувати минуле за половиною списку означало б недоплатити
       балами саме найдавнішим покупцям. */
    const offOrders = watchOrders((list: Doc[]) => setOrders(list as unknown as HistorySource[]));
    const d = db();
    if (d) void loadRules(d).then(setRules);
    return () => {
      offDraft();
      offMembers();
      offOrders();
    };
  }, []);

  /* Зарахування історії — автоматичне.

     Учасник вступає сам, але порахувати свої минулі покупки не
     може: бали пише лише адмін. Тому це робить адмінка, щойно її
     відкрили. Чекати, поки менеджер натисне кнопку, означало б
     тримати людину з порожнім рахунком невідомо скільки.

     Чекаємо саме на замовлення: доки вони не приїхали, історія
     виглядала б порожньою, і ми чесно записали б «нічого не
     знайшлось», знявши прапорець назавжди. */
  useEffect(() => {
    if (swept.current) return;
    if (!orders.length) return;
    const queue = members.filter((m) => m.historyPending);
    if (!queue.length) return;

    swept.current = true;
    const d = db();
    if (!d) return;
    void sweepHistory(d, queue, orders, user.email ?? '').then(({ done, points }) => {
      if (!done) return;
      toast(
        points
          ? `Зараховано історію: ${done} учасникам, ${points.toLocaleString('uk')} балів ✓`
          : `Опрацьовано ${done} — минулих замовлень не знайшлось`,
        'success'
      );
    });
  }, [members, orders, user, toast]);

  const stats = useMemo(
    () => statsOf(members, orders as { loyaltyOff?: number }[]),
    [members, orders]
  );

  /* Відбір і порядок.

     Черга на зарахування завжди зверху — хоч би що обрали: це
     єдина незакрита справа, і ховати її за сортуванням було б
     дивно.

     «Скоро згорять» — найкорисніший порядок із усіх: він
     показує тих, у кого рік добігає кінця, а до наступного рівня
     не вистачає. Саме їм варто написати, і саме про них ніхто
     ніколи не згадає сам. */
  const view = useMemo(() => {
    let list = findMembers(members, find);

    if (only === 'club') list = list.filter((m) => inClub(m));
    else if (only === 'ready') list = list.filter((m) => isFriendly(m.level) && !m.instagram);
    else if (only === 'wait') list = list.filter((m) => m.historyPending);
    else if (only !== 'all') list = list.filter((m) => String(m.level) === only);

    const till = (m: MemberDoc) => deadlineOf(m) ?? '9999-99-99';

    return [...list].sort((a, b) => {
      if (!!a.historyPending !== !!b.historyPending) return a.historyPending ? -1 : 1;
      if (sort === 'level') return b.level - a.level || b.points - a.points;
      if (sort === 'new') return String(b.joinedAt || '').localeCompare(String(a.joinedAt || ''));
      if (sort === 'soon') return till(a).localeCompare(till(b));
      return b.points - a.points;
    });
  }, [members, find, only, sort]);

  async function creditHistory(m: MemberDoc) {
    const d = need();
    if (!d) return;
    setBusy(m.who);
    try {
      const plan = planHistoryDone(m, orders, user.email ?? '');
      await writeMove(d, plan);
      toast(
        plan.move.points
          ? `Зараховано ${plan.move.points.toLocaleString('uk')} балів ✓`
          : 'Минулих замовлень не знайшлось — прапорець знято',
        'success'
      );
    } catch {
      toast('Не вдалося зарахувати');
    } finally {
      setBusy('');
    }
  }

  async function creditAll() {
    const queue = members.filter((m) => m.historyPending);
    if (!queue.length) return;
    const yes = await ask({
      title: 'Зарахувати минулі замовлення?',
      text:
        `Учасників у черзі: ${queue.length}. Кожному зарахуються його виконані ` +
        'замовлення з тією ж поштою. Дія записується в журнал і скасувати її можна лише правкою.',
      okText: 'Зарахувати всім'
    });
    if (yes !== true) return;

    const d = need();
    if (!d) return;
    setBusy('all');
    let done = 0;
    for (const m of queue) {
      try {
        await writeMove(d, planHistoryDone(m, orders, user.email ?? ''));
        done += 1;
      } catch {
        /* один невдалий не має спиняти решту: наступного разу він
           знову буде в черзі, бо прапорець лишиться */
      }
    }
    setBusy('');
    toast(`Опрацьовано ${done} із ${queue.length}`, done ? 'success' : 'plain');
  }

  async function adjust(m: MemberDoc) {
    const raw = await ask({
      title: 'Правка балів',
      text: `${m.who} · зараз ${m.points.toLocaleString('uk')} балів. Скільки додати? Відʼємне число — зняти.`,
      input: '',
      label: 'Скільки балів',
      placeholder: 'напр.: 500 або -200',
      okText: 'Далі'
    });
    const points = Math.round(Number(String(raw ?? '').replace(',', '.')) || 0);
    if (!points) return;

    /* Причина обовʼязкова. Правка без пояснення через півроку
       нічим не відрізняється від помилки. */
    const note = await ask({
      title: 'Причина правки',
      text: `${points > 0 ? 'Додаємо' : 'Знімаємо'} ${Math.abs(points).toLocaleString('uk')} балів. Напишіть, за що — це побачить наступний менеджер.`,
      input: '',
      label: 'Причина',
      placeholder: 'напр.: компенсація за втрачену посилку',
      okText: 'Записати'
    });
    if (typeof note !== 'string' || !note.trim()) return;

    const d = need();
    if (!d) return;
    setBusy(m.who);
    try {
      const plan = planManual(m, points, note.trim(), user.email ?? '');
      if (plan) await writeMove(d, plan);
      toast('Записано ✓', 'success');
    } catch {
      toast('Не вдалося записати');
    } finally {
      setBusy('');
    }
  }

  /** Клуб руками. Причини не питаємо: рішення власника, і воно
   *  видно в самому рядку — «Friendly · руками». */
  async function toggleClub(m: MemberDoc) {
    const on = !m.clubManual;
    const yes = await ask({
      title: on ? 'Дати Friendly Club?' : 'Забрати Friendly Club?',
      text: on
        ? `${m.who} отримає доступ до закритих товарів незалежно від рівня.`
        : `${m.who} втратить доступ до закритих товарів. Якщо рівень дозволяє клуб, доступ лишиться за рівнем.`,
      okText: on ? 'Дати' : 'Забрати'
    });
    if (yes !== true) return;

    const d = need();
    if (!d) return;
    setBusy(m.who);
    try {
      await setDoc(doc(d, MEMBERS_COL, m.who), { clubManual: on }, { merge: true });
      toast(on ? 'Клуб відкрито ✓' : 'Клуб закрито', on ? 'success' : 'plain');
    } catch {
      toast('Не вдалося змінити');
    } finally {
      setBusy('');
    }
  }

  async function keepRules(next: DiscountRules) {
    const d = need();
    if (!d) return;
    setRules(next);
    try {
      await saveRules(d, next);
      toast('Налаштування збережено ✓', 'success');
    } catch {
      toast('Не вдалося зберегти');
    }
  }

  return (
    <>
      <PublishControl user={user} onSettings={() => setSettingsOpen(true)} />

      <div className="a-page">
        <div className="a-page__head a-page__head--row">
          <div>
            <h2>Програма лояльності</h2>
            <p>
              Бали нараховуються самі, коли замовлення стає «Виконано». Тут — учасники,
              зарахування минулих замовлень і межі знижки.
            </p>
          </div>
          {stats.pending ? (
            /* Зарахування й так іде саме, щойно екран відкрито.
               Кнопка лишається на випадок, коли треба зараз: коли
               замовлення щойно перевели у «Виконано» й чекати
               наступного відкриття адмінки не хочеться. */
            <button
              className="btn btn--ghost"
              type="button"
              disabled={busy === 'all'}
              onClick={() => void creditAll()}
            >
              {busy === 'all' ? 'Зараховуємо…' : `Зарахувати зараз (${stats.pending})`}
            </button>
          ) : null}
        </div>

        <div className="a-orders a-orders--page">
          <div className="ao-stats">
            <div className="ao-stat">
              <b>{stats.members}</b>
              <span>учасників</span>
            </div>
            <div className="ao-stat">
              <b>{stats.inClub}</b>
              <span>
                у Friendly Club
                {stats.friendlyReady > stats.inClub ? (
                  /* Різниця між «рівень дозволив» і «справді в клубі» —
                     це рівно ті, кому лишилось вписати Instagram. */
                  <i className="ao-stat__hint"> · {stats.friendlyReady - stats.inClub} без Instagram</i>
                ) : null}
              </span>
            </div>
            <div className="ao-stat">
              <b>{stats.points.toLocaleString('uk')}</b>
              <span>балів на руках</span>
            </div>
            <div className="ao-stat">
              <b>{stats.given.toLocaleString('uk')} грн</b>
              <span>віддано знижок</span>
            </div>
          </div>

          <div className="ao-toolbar">
            <div className="ao-chips">
              <button
                className={'ao-chip' + (tab === 'members' ? ' is-on' : '')}
                type="button"
                onClick={() => setTab('members')}
              >
                Учасники
              </button>
              <button
                className={'ao-chip' + (tab === 'rules' ? ' is-on' : '')}
                type="button"
                onClick={() => setTab('rules')}
              >
                Межі знижки
              </button>
            </div>
            {tab === 'members' ? (
              <>
                <select
                  className="ao-select"
                  value={only}
                  aria-label="Кого показувати"
                  onChange={(e) => setOnly(e.target.value as Only)}
                >
                  <option value="all">Усі учасники</option>
                  <option value="wait">Чекають зарахування</option>
                  <option value="club">У Friendly Club</option>
                  <option value="ready">Рівень дозволив, без Instagram</option>
                  {LEVELS.map((l) => (
                    <option key={l.level} value={String(l.level)}>
                      Рівень {l.level} · −{l.percent}%
                    </option>
                  ))}
                </select>
                <select
                  className="ao-select"
                  value={sort}
                  aria-label="Порядок"
                  onChange={(e) => setSort(e.target.value as Sort)}
                >
                  <option value="points">Спершу з більшими балами</option>
                  <option value="level">Спершу вищий рівень</option>
                  <option value="new">Спершу нові</option>
                  <option value="soon">Спершу ті, у кого скоро згорять</option>
                </select>
                <input
                  className="ao-search"
                  value={find}
                  placeholder="пошта, номер або Instagram"
                  autoComplete="off"
                  onChange={(e) => setFind(e.target.value)}
                />
              </>
            ) : null}
          </div>

          {/* Скільки на кожному рівні — окремим рядком, бо це
              найкорисніша цифра для рішення «а чи не завелика
              в нас верхня ставка». */}
          {tab === 'members' ? (
            <div className="loy-levels">
              {LEVELS.map((l) => (
                <span key={l.level} className={l.friendly ? 'is-club' : ''}>
                  <b>{stats.byLevel[l.level - 1]}</b> рівень {l.level} · −{l.percent}%
                </span>
              ))}
            </div>
          ) : null}

          {tab === 'members' ? (
            !view.length ? (
              <div className="a-empty">
                {members.length
                  ? 'За цим запитом нікого не знайшлось.'
                  : 'Учасників поки немає. Вони зʼявляться, коли покупці вступлять у програму зі свого кабінету.'}
              </div>
            ) : (
              <div className="ao-list">
                {view.map((m) => (
                  <MemberRow
                    key={m.who}
                    m={m}
                    busy={busy === m.who}
                    onHistory={() => void creditHistory(m)}
                    onAdjust={() => void adjust(m)}
                    onClub={() => void toggleClub(m)}
                  />
                ))}
              </div>
            )
          ) : (
            <Rules rules={rules} cats={draft.categories} onSave={keepRules} />
          )}
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user.email ?? ''}
      />
    </>
  );
}

/* ============================================================
   Межі знижки
   ------------------------------------------------------------
   Знижка рівня складається з промокодом, і без запобіжників
   акційна субота дасть мінус півціни. Тут вони й стоять.
   ============================================================ */

function Rules({
  rules,
  cats,
  onSave
}: {
  rules: DiscountRules;
  cats: { id: string; title: string }[];
  onSave(next: DiscountRules): void;
}) {
  const [cap, setCap] = useState(String(rules.cap));

  useEffect(() => {
    setCap(String(rules.cap));
  }, [rules.cap]);

  const flip = (id: string) => {
    const has = rules.skipCats.includes(id);
    onSave({
      ...rules,
      skipCats: has ? rules.skipCats.filter((x) => x !== id) : [...rules.skipCats, id]
    });
  };

  const levels = levelsOf(rules);

  const setRow = (i: number, patch: Partial<LadderRow>) => {
    const rows = ladderRows(levels).map((r, k) => (k === i ? { ...r, ...patch } : r));
    onSave({ ...rules, levels: rows });
  };

  return (
    <div className="loy-rules">
      {/* ---------- Драбина ---------- */}
      <div className="field">
        <span className="field__label">Рівні: скільки балів і скільки відсотків</span>
        <div className="loy-ladder">
          {levels.map((l, i) => (
            <div className="loy-ladder__row" key={l.level}>
              <span className="loy-ladder__no">Рівень {l.level}</span>
              <label>
                <span>від, балів</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={l.from}
                  /* Перший рівень починається з нуля завжди: у
                     програмі не буває людини, яка ще не в ній. */
                  disabled={i === 0}
                  onChange={(e) => setRow(i, { from: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
              <label>
                <span>знижка, %</span>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={l.percent}
                  onChange={(e) =>
                    setRow(i, { percent: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })
                  }
                />
              </label>
              <label className="a-check loy-ladder__club">
                <input
                  type="checkbox"
                  checked={l.friendly}
                  onChange={(e) => setRow(i, { friendly: e.target.checked })}
                />{' '}
                Friendly Club
              </label>
            </div>
          ))}
        </div>
        <p className="field__hint">
          Пороги мусять зростати: рівень, у який не можна ввійти, програма не прийме — лишиться
          попередня драбина. Верхня межа кожного рівня рахується з наступного порога, тож дірок
          між рівнями не буває.
        </p>
        <p className="field__hint">
          <b>Змінюйте ставки, коли в магазині тихо.</b> Кошик, правила бази й банк читають ці
          числа окремо. Покупець, який набрав кошик до зміни й оформлює після неї, отримає
          відмову — його знижка вже не збігатиметься з новою драбиною. Уночі такого покупця
          просто немає.
        </p>
      </div>

      <div className="field">
        <label htmlFor="loyCap">Стеля сумарної знижки, %</label>
        <input
          id="loyCap"
          type="number"
          min={0}
          max={100}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          onBlur={() => onSave({ ...rules, cap: Math.max(0, Math.min(100, Number(cap) || 0)) })}
        />
        <p className="field__hint">
          Більше за це промокод і знижка рівня разом не дадуть. Нуль — без межі. Коли стеля
          спрацьовує, зменшується саме знижка рівня: промокод — обіцянка, названа числом, яку
          покупець уже прочитав.
        </p>
      </div>

      <label className="a-check">
        <input
          type="checkbox"
          checked={rules.skipSale}
          onChange={(e) => onSave({ ...rules, skipSale: e.target.checked })}
        />
        Знижка рівня не діє на товари з бейджем SALE
      </label>

      <div className="field">
        <span className="field__label">Категорії, де знижка рівня не діє</span>
        <div className="a-sizes">
          {cats.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={rules.skipCats.includes(c.id)}
                onChange={() => flip(c.id)}
              />{' '}
              {c.title}
            </label>
          ))}
        </div>
        <p className="field__hint">
          Ці межі читає не лише кошик, а й воркер, який виставляє рахунок у банку. Тому міняти їх
          можна будь-коли: обидва рахують за одним джерелом і не розійдуться.
        </p>
      </div>
    </div>
  );
}
