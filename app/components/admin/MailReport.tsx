'use client';

import { useEffect, useState } from 'react';
import { useAsk } from './AskProvider';
import { db } from '@/lib/firebase';
import {
  WINDOW,
  dropRun,
  loadRuns,
  manyLetters,
  reportOf,
  watchedDays,
  type MailRun
} from '@/lib/admin/mailing';
import type { AdminOrder } from '@/lib/admin/orders';

/* ============================================================
   Що дали розсилки
   ------------------------------------------------------------
   Окремим екраном, а не хвостом під формою листа. Це різні
   заняття: писати лист і розбиратись, чи спрацював попередній.
   Поки звіт висів під формою, він плутався під ногами саме тоді,
   коли людина набирала текст.

   Resend знає, скільком лист дійшов. Але власник питає не про це,
   а «а купили?» — і на це не відповість жоден поштовий сервіс,
   бо покупки живуть у нас.
   ============================================================ */

export default function MailReport({
  orders,
  reload
}: {
  orders: AdminOrder[];
  /** Міняється, коли пішла нова розсилка, — щоб перечитати. */
  reload: number;
}) {
  const ask = useAsk();
  const [runs, setRuns] = useState<MailRun[]>([]);

  useEffect(() => {
    const d = db();
    if (d) void loadRuns(d).then(setRuns);
  }, [reload]);

  async function forget(run: MailRun) {
    const yes = await ask({
      title: 'Прибрати звіт?',
      text: `Звіт про «${run.subject}» зникне. Сам лист уже надіслано — його це не скасує.`,
      okText: 'Прибрати',
      danger: true
    });
    if (yes !== true) return;
    const d = db();
    if (!d) return;
    await dropRun(d, run._id).catch(() => {});
    void loadRuns(d).then(setRuns);
  }

  if (!runs.length) {
    return (
      <div className="a-empty">
        Розсилок ще не було. Щойно надішлете першу — тут зʼявиться, скільки людей після неї
        замовили й на яку суму.
      </div>
    );
  }

  return (
    <div className="mk">
      <p className="mk-note">
        Замовлення отримувачів за {WINDOW} днів після листа. Це не доказ, що купили саме через
        нього — тому поруч стоїть те, з чим порівнювати: скільки ті самі люди купували за такий
        самий час до розсилки.
      </p>

      <ul className="mk-runs">
        {runs.map((run) => {
          const rep = reportOf(run, orders);
          const days = watchedDays(run);
          return (
            <li key={run._id}>
              <div className="mk-run__head">
                <b>{run.subject || 'без теми'}</b>
                <span>
                  {run.audience} · {manyLetters(rep.sent)} ·{' '}
                  {new Date(run.at).toLocaleDateString('uk', { day: 'numeric', month: 'long' })}
                </span>
                <button
                  className="btn btn--ghost btn--sm ao-danger"
                  type="button"
                  onClick={() => void forget(run)}
                >
                  Прибрати
                </button>
              </div>

              <div className="mk-run__nums">
                <span>
                  <b>{Math.round(rep.rate * 100)}%</b>
                  <i>
                    замовили — {rep.buyers} із {rep.sent}
                  </i>
                </span>
                <span>
                  <b>{rep.revenue.toLocaleString('uk')} грн</b>
                  <i>виручка з {rep.orders} замовлень</i>
                </span>
                <span>
                  <b>{rep.avg.toLocaleString('uk')} грн</b>
                  <i>середній чек</i>
                </span>
                {/* Головне число: наскільки більше, ніж ті самі
                    люди купували без листа. Без нього конверсія
                    вміє переконати в чому завгодно. */}
                <span className={rep.lift !== null && rep.lift > 0 ? 'is-up' : ''}>
                  <b>
                    {rep.lift === null
                      ? '—'
                      : (rep.lift > 0 ? '+' : '') + Math.round(rep.lift * 100) + '%'}
                  </b>
                  <i>
                    {rep.lift === null
                      ? 'до листа не купував ніхто'
                      : `до листа було ${rep.wasRevenue.toLocaleString('uk')} грн`}
                  </i>
                </span>
              </div>

              {days < WINDOW ? (
                <p className="mk-note">
                  Минуло {days} із {WINDOW} днів — звіт ще збирається, числа зростатимуть.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
