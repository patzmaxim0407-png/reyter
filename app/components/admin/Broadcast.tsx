'use client';

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../Toasts';
import { useAsk } from './AskProvider';
import { SEGMENTS, type Client, type Segment } from '@/lib/admin/clients';
import {
  CONTACTS_MAX,
  EMPTY_LETTER,
  SEGMENTS_MAX,
  contactsOf,
  loadSegments,
  loadSent,
  overLimit,
  reachable,
  sendBroadcast,
  syncPeople,
  type Letter,
  type MailSegment,
  type SentMail
} from '@/lib/admin/mailing';

/* ============================================================
   Розсилки
   ------------------------------------------------------------
   Шлях рівно один і в один бік: обрати кому → написати що →
   надіслати. Кожен крок видно згори, і на кожному видно число
   людей: розсилка — єдина дія в адмінці, яку не можна відкотити,
   і людина має бачити масштаб до натискання, а не після.

   ЛИСТ ЗБИРАЄ ВОРКЕР. Звідси йдуть тема, заголовок, абзаци й
   кнопка — не HTML. Через це лист завжди схожий на REYTER і
   завжди має посилання на відписку: Resend його сам НЕ додає,
   а лист без нього — це скарги на спам, після яких псується
   доставність усіх листів магазину, зокрема й про замовлення.
   ============================================================ */

const ALL = 'all';

export default function Broadcast({
  clients,
  picked,
  onPicked,
  workerUrl,
  workerKey
}: {
  clients: Client[];
  /** Людина, з чиєї картки натиснули «написати». */
  picked: Client | null;
  onPicked(): void;
  workerUrl: string;
  workerKey: string;
}) {
  const toast = useToast();
  const ask = useAsk();
  const cab = useMemo(() => ({ workerUrl, adminKey: workerKey }), [workerUrl, workerKey]);

  const [who, setWho] = useState<Segment | typeof ALL>(ALL);
  const [letter, setLetter] = useState<Letter>(EMPTY_LETTER);
  const [segments, setSegments] = useState<MailSegment[]>([]);
  const [segment, setSegment] = useState('');
  const [sent, setSent] = useState<SentMail[]>([]);
  const [busy, setBusy] = useState('');
  const [ready, setReady] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadSegments(cab).then((r) => {
      if (r.ok) setSegments(r.segments || []);
      else setError(r.error || '');
    });
    void loadSent(cab).then((r) => {
      if (r.ok) setSent(r.sent || []);
    });
  }, [cab]);

  /* Людина прийшла з картки конкретного клієнта — лист буде їй
     одній. Групу в такому разі не питаємо. */
  const one = picked;

  const chosen = useMemo(() => {
    if (one) return [one];
    return who === ALL ? clients : clients.filter((x) => x.segment === who);
  }, [clients, who, one]);

  const people = useMemo(() => reachable(chosen), [chosen]);
  const tooMany = overLimit(people.length);
  /* Скільки лишилось за бортом — і чому. Мовчазна різниця між
     «обрано 340» і «піде 300» була б найгіршим, що тут можна
     зробити. */
  const noMail = chosen.length - people.length;

  async function collect() {
    if (!people.length) {
      toast('Нема кому писати: у цих людей немає пошти');
      return;
    }
    if (tooMany) {
      toast(`Безкоштовний тариф вміщає ${CONTACTS_MAX} контактів, а тут ${people.length}`);
      return;
    }
    setBusy('sync');
    try {
      const name = one ? 'REYTER · окремі листи' : 'REYTER · ' + labelOf(who);
      const r = await syncPeople(cab, name, segment, contactsOf(people));
      if (!r.ok) {
        toast(r.error || 'Не вдалося зібрати групу');
        return;
      }
      if (r.segmentId) setSegment(r.segmentId);
      setReady(r.added || 0);
      toast(
        `У групі ${r.added} ${r.failed ? `· не вдалося ${r.failed}` : ''}`.trim(),
        'success'
      );
      void loadSegments(cab).then((s) => s.ok && setSegments(s.segments || []));
    } finally {
      setBusy('');
    }
  }

  async function send(now: boolean) {
    if (!segment) {
      toast('Спершу зберіть групу отримувачів');
      return;
    }
    if (!letter.subject.trim() || !letter.text.trim()) {
      toast('Потрібні тема й текст листа');
      return;
    }
    const yes = await ask({
      title: now ? 'Надіслати зараз?' : 'Поставити в чергу?',
      text:
        `Лист «${letter.subject}» піде ${ready || people.length} людям.\n\n` +
        'Скасувати надіслане неможливо. Перевірте тему й текст ще раз.',
      okText: now ? 'Надіслати' : 'Запланувати'
    });
    if (yes !== true) return;

    setBusy('send');
    try {
      /* «in 15 min» — природна мова, яку Resend розуміє сам.
         Чверть години це не запізнення, а можливість передумати:
         єдина дія в адмінці, якої не відкотити. */
      const r = await sendBroadcast(cab, segment, letter, now ? '' : 'in 15 min');
      if (!r.ok) {
        toast(r.error || 'Resend не прийняв розсилку');
        return;
      }
      toast(now ? 'Розсилка пішла ✓' : 'Розсилка піде за 15 хвилин ✓', 'success');
      setLetter(EMPTY_LETTER);
      onPicked();
      void loadSent(cab).then((s) => s.ok && setSent(s.sent || []));
    } finally {
      setBusy('');
    }
  }

  function labelOf(id: Segment | typeof ALL): string {
    if (id === ALL) return 'усі клієнти';
    return SEGMENTS.find((s) => s.id === id)?.title || String(id);
  }

  const set = (p: Partial<Letter>) => setLetter((v) => ({ ...v, ...p }));

  return (
    <div className="mk">
      {error ? <p className="ao-note ao-error">{error}</p> : null}

      {/* ---------- 1. Кому ---------- */}
      <section className="mk-step">
        <h4>
          <i>1</i> Кому
        </h4>
        {one ? (
          <p className="mk-one">
            Окремий лист для <b>{one.name || one.email}</b> · {one.email}
            <button className="btn btn--ghost btn--sm" type="button" onClick={onPicked}>
              обрати групу натомість
            </button>
          </p>
        ) : (
          <div className="cl-segs">
            <button
              type="button"
              className={'cl-seg' + (who === ALL ? ' is-on' : '')}
              onClick={() => setWho(ALL)}
            >
              Усі <i>{clients.length}</i>
            </button>
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.hint}
                className={'cl-seg cl-' + s.id + (who === s.id ? ' is-on' : '')}
                onClick={() => setWho(s.id)}
              >
                {s.title} <i>{clients.filter((x) => x.segment === s.id).length}</i>
              </button>
            ))}
          </div>
        )}

        <p className={'mk-count' + (tooMany ? ' is-bad' : '')}>
          Піде <b>{people.length}</b> листів
          {noMail ? ` · ${noMail} без пошти — їм написати нічим` : ''}
          {tooMany
            ? ` · це більше за ${CONTACTS_MAX}, які вміщає безкоштовний тариф: Resend відмовить усій розсилці, а не зайвим`
            : ''}
        </p>

        <div className="mk-acts">
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={busy === 'sync' || !people.length || tooMany}
            onClick={() => void collect()}
          >
            {busy === 'sync' ? 'Збираємо…' : 'Зібрати групу'}
          </button>
          {segments.length ? (
            <select
              className="ao-select"
              value={segment}
              aria-label="Готова група"
              onChange={(e) => setSegment(e.target.value)}
            >
              <option value="">нова група</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          {ready ? <span className="mk-ok">у групі {ready}</span> : null}
        </div>
        {segments.length >= SEGMENTS_MAX ? (
          <p className="mk-note">
            Груп уже {segments.length} — більше безкоштовний тариф не дає. Обирайте наявну зі
            списку або приберіть зайву в кабінеті Resend.
          </p>
        ) : null}
      </section>

      {/* ---------- 2. Що ---------- */}
      <section className="mk-step">
        <h4>
          <i>2</i> Що написати
        </h4>
        <div className="mk-form">
          <label className="ao-field">
            <span>Тема листа</span>
            <input
              value={letter.subject}
              maxLength={180}
              placeholder="напр.: Нова колекція вже в наявності"
              onChange={(e) => set({ subject: e.target.value })}
            />
          </label>
          <label className="ao-field">
            <span>Заголовок у листі</span>
            <input
              value={letter.title}
              maxLength={120}
              placeholder="можна лишити порожнім"
              onChange={(e) => set({ title: e.target.value })}
            />
          </label>
          <label className="ao-field ao-field--wide">
            <span>
              Текст <em>абзаци розділяйте порожнім рядком</em>
            </span>
            <textarea
              value={letter.text}
              rows={7}
              maxLength={4000}
              placeholder={'Ми зробили те, чого ви просили…\n\nДругий абзац.'}
              onChange={(e) => set({ text: e.target.value })}
            />
          </label>
          <label className="ao-field">
            <span>Напис на кнопці</span>
            <input
              value={letter.button}
              maxLength={60}
              placeholder="Перейти до магазину"
              onChange={(e) => set({ button: e.target.value })}
            />
          </label>
          <label className="ao-field">
            <span>Куди веде кнопка</span>
            <input
              value={letter.url}
              maxLength={300}
              placeholder="https://reyter.men/"
              onChange={(e) => set({ url: e.target.value })}
            />
          </label>
          <label className="ao-field">
            <span>Промокод</span>
            <input
              value={letter.code}
              maxLength={30}
              placeholder="без нього — просто лишіть порожнім"
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="ao-field">
            <span>Умови промокоду</span>
            <input
              value={letter.codeNote}
              maxLength={120}
              placeholder="напр.: −10% до 31 серпня"
              onChange={(e) => set({ codeNote: e.target.value })}
            />
          </label>
          <label className="ao-field ao-field--wide">
            <span>
              Картинка згори <em>пряме посилання на зображення</em>
            </span>
            <input
              value={letter.image}
              maxLength={400}
              placeholder="https://reyter.men/assets/images/…"
              onChange={(e) => set({ image: e.target.value })}
            />
          </label>
        </div>

        <p className="mk-note">
          Звертання на імʼя, шапку, підвал і посилання на відписку лист отримає сам. Без відписки
          його не буде надіслано — це не примха, а те, від чого залежить, чи дійдуть узагалі всі
          інші листи магазину.
        </p>
      </section>

      {/* ---------- 3. Надіслати ---------- */}
      <section className="mk-step">
        <h4>
          <i>3</i> Надіслати
        </h4>
        <div className="mk-acts">
          <button
            className="btn btn--primary"
            type="button"
            disabled={busy === 'send' || !segment}
            onClick={() => void send(true)}
          >
            {busy === 'send' ? 'Надсилаємо…' : 'Надіслати зараз'}
          </button>
          <button
            className="btn btn--ghost"
            type="button"
            disabled={busy === 'send' || !segment}
            onClick={() => void send(false)}
          >
            Через 15 хвилин
          </button>
        </div>
        <p className="mk-note">
          Розсилки не витрачають добову межу в 100 листів — вона лише для листів про замовлення.
          Тут обмежений розмір бази: {CONTACTS_MAX} контактів.
        </p>
      </section>

      {/* ---------- Що вже пішло ---------- */}
      {sent.length ? (
        <section className="mk-step">
          <h4>Уже надіслано</h4>
          <ul className="mk-sent">
            {sent.map((s) => (
              <li key={s.id}>
                <b>{s.name || 'без назви'}</b>
                <span>{s.status}</span>
                <i>{s.at ? new Date(s.at).toLocaleString('uk') : ''}</i>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
