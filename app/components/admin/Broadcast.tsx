'use client';

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../Toasts';
import { useAsk } from './AskProvider';
import { LOYALS, SEGMENTS, byLoyal, type Client, type Loyal, type Segment } from '@/lib/admin/clients';
import { inClub } from '@/lib/admin/loyalty-db';
import {
  CONTACTS_MAX,
  EMPTY_LETTER,
  contactsOf,
  manyLetters,
  overLimit,
  reachable,
  saveRun,
  sendBroadcast,
  type Letter,
  type MailRun
} from '@/lib/admin/mailing';
import { db } from '@/lib/firebase';

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
  onSent,
  workerUrl,
  workerKey
}: {
  clients: Client[];
  /** Людина, з чиєї картки натиснули «написати». */
  picked: Client | null;
  onPicked(): void;
  /** Розсилка пішла — звіт має про це дізнатись. */
  onSent(): void;
  workerUrl: string;
  workerKey: string;
}) {
  const toast = useToast();
  const ask = useAsk();
  const cab = useMemo(() => ({ workerUrl, adminKey: workerKey }), [workerUrl, workerKey]);

  const [who, setWho] = useState<Segment | typeof ALL>(ALL);
  const [loyal, setLoyal] = useState<Loyal>('any');
  const [letter, setLetter] = useState<Letter>(EMPTY_LETTER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /* Людина прийшла з картки конкретного клієнта — лист буде їй
     одній. Групу в такому разі не питаємо. */
  const one = picked;

  /* Два незалежні зрізи: стан клієнта і програма лояльності.
     «Постійні» і «третій рівень» — різні питання про ту саму
     людину, і зводити їх в один перелік означало б показувати
     сімнадцять кнопок замість восьми. */
  const chosen = useMemo(() => {
    if (one) return [one];
    const byState = who === ALL ? clients : clients.filter((x) => x.segment === who);
    return byLoyal(byState, loyal, (m) => inClub(m));
  }, [clients, who, loyal, one]);

  const people = useMemo(() => reachable(chosen), [chosen]);
  const tooMany = overLimit(people.length);
  /* Скільки лишилось за бортом — і чому. Мовчазна різниця між
     «обрано 340» і «піде 300» була б найгіршим, що тут можна
     зробити. */
  const noMail = chosen.length - people.length;

  async function send(now: boolean) {
    if (!people.length) {
      toast('Нема кому писати: у цих людей немає пошти');
      return;
    }
    if (tooMany) {
      toast(`Безкоштовний тариф вміщає ${CONTACTS_MAX} контактів, а тут ${people.length}`);
      return;
    }
    if (!letter.subject.trim() || !letter.text.trim()) {
      toast('Потрібні тема й текст листа');
      return;
    }
    const yes = await ask({
      title: now ? 'Надіслати зараз?' : 'Поставити в чергу?',
      text:
        `Лист «${letter.subject}» піде ${manyLetters(people.length)}.\n\n` +
        'Скасувати надіслане неможливо. Перевірте тему й текст ще раз.',
      okText: now ? 'Надіслати' : 'Запланувати'
    });
    if (yes !== true) return;

    setBusy(true);
    try {
      /* Один запит робить усе: заводить групу, зводить її рівно
         до цього добору й відправляє. Раніше тут було три кроки
         руками — вони існували не для людини, а тому, що так
         влаштований Resend.

         «in 15 min» — природна мова, яку Resend розуміє сам.
         Чверть години це не запізнення, а можливість передумати:
         єдина дія в адмінці, якої не відкотити. */
      const r = await sendBroadcast(cab, contactsOf(people), letter, now ? '' : 'in 15 min');
      if (!r.ok) {
        toast(r.error || 'Resend не прийняв розсилку');
        return;
      }
      toast(
        (now ? 'Розсилка пішла ✓' : 'Розсилка піде за 15 хвилин ✓') +
          (r.failed ? ` · ${r.failed} адрес Resend не прийняв` : ''),
        'success'
      );

      /* Запамʼятовуємо, кому саме пішов лист. Без цього переліку
         конверсію не порахувати ніяк: замовлення не знає, що
         йому передувала розсилка. */
      const d = db();
      if (d) {
        const run: Omit<MailRun, '_id'> = {
          id: String(r.id || ''),
          subject: letter.subject,
          audience: one ? one.email : labelOf(who) + (loyal === 'any' ? '' : ' · ' + labelOfLoyal(loyal)),
          at: new Date(Date.now() + (now ? 0 : 15 * 60_000)).toISOString(),
          to: people.map((x) => x.email),
          by: ''
        };
        await saveRun(d, run).catch(() => {});
        onSent();
      }

      setLetter(EMPTY_LETTER);
      onPicked();
    } finally {
      setBusy(false);
    }
  }

  function labelOf(id: Segment | typeof ALL): string {
    if (id === ALL) return 'усі клієнти';
    return SEGMENTS.find((s) => s.id === id)?.title || String(id);
  }

  function labelOfLoyal(id: Loyal): string {
    return LOYALS.find((l) => l.id === id)?.title || String(id);
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

        {/* Другий зріз — програма лояльності. Незалежний від
            першого: «постійні» і «третій рівень» це різні
            питання про ту саму людину. */}
        {one ? null : (
          <div className="cl-segs mk-loyal">
            {LOYALS.map((l) => (
              <button
                key={l.id}
                type="button"
                title={l.hint}
                className={'cl-seg' + (loyal === l.id ? ' is-on' : '')}
                onClick={() => setLoyal(l.id)}
              >
                {l.title}
              </button>
            ))}
          </div>
        )}

        <p className={'mk-count' + (tooMany ? ' is-bad' : '')}>
          Піде <b>{manyLetters(people.length)}</b>
          {noMail ? ` · ${noMail} без пошти — їм написати нічим` : ''}
          {tooMany
            ? ` · це більше за ${CONTACTS_MAX}, які вміщає безкоштовний тариф: Resend відмовить усій розсилці, а не зайвим`
            : ''}
        </p>
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
            disabled={busy || !people.length || tooMany}
            onClick={() => void send(true)}
          >
            {busy ? 'Надсилаємо…' : 'Надіслати ' + manyLetters(people.length)}
          </button>
          <button
            className="btn btn--ghost"
            type="button"
            disabled={busy || !people.length || tooMany}
            onClick={() => void send(false)}
          >
            Через 15 хвилин
          </button>
        </div>
        <p className="mk-note">
          Розсилки не витрачають добову межу в 100 листів — вона лише для листів про замовлення.
          Тут обмежений розмір бази: {CONTACTS_MAX} контактів. Групу в Resend воркер бере сам і
          щоразу зводить її рівно до обраних — заводити чи чистити щось руками не треба.
        </p>
      </section>

    </div>
  );
}
