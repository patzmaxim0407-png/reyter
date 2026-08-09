'use client';

import { useEffect, useRef, useState } from 'react';
import OrderCard, { type OrderView } from './OrderCard';
import { useToast } from './Toasts';
import { copyText } from '@/lib/copy';
import { trackFind, type TrackFailReason } from '@/lib/track';
import { t } from '@/lib/i18n';

/* Відстеження без акаунта.

   Замовлення можна оформити гостем — тоді історії в кабінеті
   немає. Щоб покупець усе одно бачив рух, шукаємо запис за
   номером і телефоном: разом вони працюють як ключ до окремої
   публічної колекції, де немає ні адрес, ні чужих телефонів. */

const WHY: Record<TrackFailReason, string> = {
  no_num: 'trk.needNum',
  no_phone: 'trk.needPhone',
  not_found: 'trk.notFound',
  offline: 'trk.offline'
};

export default function TrackForm({ divider = true }: { divider?: boolean }) {
  const [num, setNum] = useState('');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'found' | 'fail'>('idle');
  const [found, setFound] = useState<OrderView | null>(null);
  const [why, setWhy] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();

  /* У кабінеті форма стоїть під панеллю входу — знахідка інакше
     лишається за екраном, і покупець вирішує, що нічого не сталось */
  useEffect(() => {
    if (state === 'found') box.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [state]);

  async function find() {
    setState('busy');
    const res = await trackFind(num, phone);

    if (!res.ok) {
      setFound(null);
      setWhy(t(WHY[res.reason] ?? 'trk.notFound'));
      setState('fail');
      return;
    }

    const o = res.order;
    setFound({
      num: o.num,
      date: o.date,
      status: o.status,
      total: o.total,
      ttn: o.ttn,
      // у записі відстеження склад лежить уже готовими рядками
      itemLines: (o.items || []).map((i) => ({
        name: i.name,
        size: i.size || undefined,
        qty: i.qty || 1,
        parts: i.parts
      })),
      where: [o.carrier, o.city].filter(Boolean).join(', ')
    });
    setWhy('');
    setState('found');
  }

  return (
    <>
      {divider ? (
        <div className="auth-divider">
          <span>{t('trk.divider')}</span>
        </div>
      ) : null}

      <form
        className="form-grid"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <div className="field">
          <label htmlFor="trkNum">{t('trk.num')}</label>
          <input
            id="trkNum"
            autoComplete="off"
            spellCheck={false}
            placeholder="R-260808-799"
            value={num}
            onChange={(e) => setNum(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="trkPhone">{t('trk.phone')}</label>
          <input
            id="trkPhone"
            type="tel"
            autoComplete="tel"
            placeholder="+380…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <button className="btn btn--ghost" type="submit" disabled={state === 'busy'}>
          {t('trk.find')}
        </button>
      </form>

      <div ref={box}>
        {state === 'busy' ? <p className="account-note">{t('trk.searching')}</p> : null}
        {state === 'fail' ? <p className="account-note account-note--warn">{why}</p> : null}
        {state === 'found' && found ? (
          <OrderCard
            o={found}
            showStatus
            onCopyTtn={() =>
              void copyText(found.ttn ?? '').then((done) =>
                toast(t(done ? 'cart.copied' : 'cart.copyFail'), done ? 'success' : 'plain')
              )
            }
          />
        ) : null}
      </div>
    </>
  );
}
