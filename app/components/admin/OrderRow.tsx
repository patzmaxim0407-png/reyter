'use client';

import { useState } from 'react';
import { fmt } from '@/lib/catalog';

/* ============================================================
   Рядок замовлення
   ------------------------------------------------------------
   Один і той самий у черзі й в архіві — навмисно. Менеджер
   переходить між екранами десятки разів на день, і якщо
   замовлення виглядає там і там по-різному, очі щоразу
   пристосовуються наново.

   У рядку рівно те, що потрібно для рішення: хто, куди, скільки
   й одна прикмета стану. Усе інше — під ним, за дотиком.
   ============================================================ */

/* Адреса відділення буває на півтора рядки: «Відділення №250
   (до 10 кг): вул. Євгена Чикаленка, 45/2 (м. "Площа
   Українських Героїв")». У списку з неї потрібні дві речі —
   місто й номер; решта є в картці й у підказці. */
function коротко(place: string): string {
  const частини = place.split(',').map((x) => x.trim());
  const місто = частини[0] || '';
  const пункт = частини[1] || '';
  const номер = пункт.match(/№\s*\d+/);
  const тип = /поштомат/i.test(пункт) ? 'Поштомат' : /відділен/i.test(пункт) ? 'Відділення' : '';
  if (номер && тип) return місто + ' · ' + тип + ' ' + номер[0].replace(/\s+/, '');
  return частини.slice(0, 2).join(', ');
}

export default function OrderRow({
  num,
  name,
  place,
  meta,
  badge,
  parcel,
  sum,
  tone = 0,
  action,
  picked,
  onPick,
  open,
  onToggle
}: {
  num: string;
  name: string;
  place: string;
  /** Чому воно тут: «чекає 3 год», «лежить 5 дн.», «10 серп.». */
  meta: string;
  /** Статус замовлення кольоровим значком. */
  badge?: { id: string; title: string };
  /** Що каже перевізник — другим значком. */
  parcel?: { text: string; tone: 0 | 1 | 2 };
  sum: number;
  /** 0 — спокій, 1 — увага, 2 — горить. */
  tone?: 0 | 1 | 2;
  action?: { label: string; onClick(): void; busy?: boolean };
  picked?: boolean;
  onPick?(on: boolean): void;
  open?: boolean;
  onToggle(): void;
}) {
  const [скопійовано, setСкопійовано] = useState(false);

  return (
    <div className={'aq-row u-' + tone + (open ? ' is-open' : '')}>
      {onPick ? (
        <label className="aq-row__pick" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={!!picked} onChange={(e) => onPick(e.target.checked)} />
        </label>
      ) : null}

      <button className="aq-row__main" type="button" onClick={onToggle} aria-expanded={!!open}>
        <span className="aq-row__who">
          <b>{name || '—'}</b>
          {/* Номер копіюється дотиком: його щодня переносять у
              Telegram, у кабінет перевізника й у пошук — а всередині
              кнопки виділити його мишею неможливо.

              Клік сюди не розкриває рядок: людина хотіла номер, а не
              подробиці. */}
          <em
            className="aq-row__num"
            title="Скопіювати номер"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard
                ?.writeText(num)
                .then(() => {
                  setСкопійовано(true);
                  setTimeout(() => setСкопійовано(false), 1200);
                })
                .catch(() => {});
            }}
          >
            {скопійовано ? 'скопійовано ✓' : '№' + num}
          </em>
        </span>
        <span className="aq-row__where" title={place}>
          {коротко(place) || '—'}
        </span>
        <span className="aq-row__why">
          {badge ? <b className={'aq-badge st-' + badge.id}>{badge.title}</b> : null}
          {parcel ? <b className={'aq-badge np-' + parcel.tone}>{parcel.text}</b> : null}
          {meta ? <span>{meta}</span> : null}
        </span>
        <span className="aq-row__sum">{fmt(sum || 0)} грн</span>
        <span className="aq-row__chev" aria-hidden="true">
          {open ? '⌃' : '⌄'}
        </span>
      </button>

      {action ? (
        <button
          className="btn btn--primary btn--sm aq-row__act"
          type="button"
          disabled={action.busy}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
