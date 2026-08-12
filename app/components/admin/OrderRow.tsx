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
/* Значок перевізника — його власний знак із чотирьох стрілок,
   тільки червоний: на світлому тлі значка білий був би невидимий.

   Рамка обрізана по самому знаку (звідси не нульовий viewBox):
   у вихідному файлі навколо нього ще половина порожнього поля, і
   з ним значок у рядку висів би завбільшки з два рядки тексту. */
function NpMark() {
  return (
    <svg className="np-mark" viewBox="9.5 7.2 21 20.6" aria-hidden="true" focusable="false">
      <path
        d="M21.837 23.98v-4.32h-3.673v4.32h-2.808l3.406 3.406a1.75 1.75 0 0 0 2.477 0l3.406-3.406h-2.808Zm-8.317-1.836v-9.288l-3.406 3.406a1.75 1.75 0 0 0 0 2.476l3.406 3.406Zm4.644-11.124v4.32h3.673v-4.32h2.808l-3.406-3.406a1.75 1.75 0 0 0-2.477 0l-3.406 3.406h2.808Zm11.722 5.242-3.406-3.406v9.288l3.406-3.406a1.75 1.75 0 0 0 0-2.476Z"
        fill="#da291c"
      />
    </svg>
  );
}

function shortLabel(place: string): string {
  const parts = place.split(',').map((x) => x.trim());
  const city = parts[0] || '';
  const point = parts[1] || '';
  const num = point.match(/№\s*\d+/);
  const kind = /поштомат/i.test(point) ? 'Поштомат' : /відділен/i.test(point) ? 'Відділення' : '';
  if (num && kind) return city + ' · ' + kind + ' ' + num[0].replace(/\s+/, '');
  return parts.slice(0, 2).join(', ');
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
  /** Що каже перевізник — другим значком. state фарбує значок за
   *  станом посилки, tone додає тривоги, коли час її бити. */
  parcel?: { text: string; tone: 0 | 1 | 2; state?: string };
  sum: number;
  /** 0 — спокій, 1 — увага, 2 — горить. */
  tone?: 0 | 1 | 2;
  action?: { label: string; onClick(): void; busy?: boolean };
  picked?: boolean;
  onPick?(on: boolean): void;
  open?: boolean;
  onToggle(): void;
}) {
  const [copied, setCopied] = useState(false);

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
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                })
                .catch(() => {});
            }}
          >
            {copied ? 'скопійовано ✓' : '№' + num}
          </em>
        </span>
        <span className="aq-row__where" title={place}>
          {shortLabel(place) || '—'}
        </span>
        <span className="aq-row__why">
          {badge ? <b className={'aq-badge st-' + badge.id}>{badge.title}</b> : null}
          {parcel ? (
            <b
              className={
                'aq-badge np np-' + (parcel.state || 'pickup') + (parcel.tone === 2 ? ' is-hot' : '')
              }
            >
              {parcel.state ? <NpMark /> : null}
              {parcel.text}
            </b>
          ) : null}
          {meta ? <span>{meta}</span> : null}
        </span>
        <span className="aq-row__sum">{fmt(sum || 0)} грн</span>
        {/* Один гліф, що повертається: два різні (⌃ і ⌄) мають
            різні метрики, і рядок смикався на піксель у мить
            розкриття. */}
        <span className="aq-row__chev" aria-hidden="true">
          ›
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
