'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLang } from './LangProvider';

/* ============================================================
   Поле з підказками (місто, відділення)
   ------------------------------------------------------------
   Порт R.attachCombo. Розмітка й класи ті самі, що в address.js,
   тому стилі підходять без дописування.

   Дрібниці тут не косметичні:
   • затримка 260 мс — інакше кожна літера летить в API;
   • лічильник запитів — відповідь на «Льв» не має перезаписати
     список для «Львів», якщо прийшла пізніше;
   • вибір по mousedown, а не click — click приходить уже після
     blur, і список на той момент закритий;
   • Enter спрацьовує лише коли щось підсвічено, інакше він
     відправляв би форму замість вибору.
   ============================================================ */

export interface ComboItem {
  ref: string;
  /** Що показати в списку. */
  text: string;
  /** Що покласти в поле після вибору — для міста це коротка
   *  назва, а не «м. Львів, Львівська обл.». */
  value: string;
  /** Позначка збоку: «Поштомат», «12 відділень». */
  note?: string;
  /** Додатковий клас рядка. Адмінка малює товари з фото — рядок
   *  вищий і має власне оформлення. */
  cls?: string;
  /** Готова розмітка рядка замість text + note. */
  node?: ReactNode;
}

export default function Combobox(props: {
  id: string;
  label: string;
  value: string;
  /* Адмінка ставить це поле в рядок форми, де підпису над ним
     немає, а обране показує чіпом із фото — щоб два товари з
     майже однаковою назвою не переплутати. */
  className?: string;
  chip?: ReactNode;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  invalid?: boolean;
  minChars?: number;
  openOnFocus?: boolean;
  /** Ключ тексту, коли пошук нічого не дав. */
  empty: string;
  /** Ключ тексту, коли шукати ще рано (не обрано місто). */
  needFirst?: string;
  /** null — шукати ще рано. */
  search(query: string): Promise<ComboItem[] | null>;
  onPick(item: ComboItem): void;
  onType(value: string): void;
}) {
  const { t } = useLang();
  const {
    id,
    label,
    value,
    className,
    chip,
    placeholder,
    hint,
    disabled,
    invalid,
    minChars = 2,
    openOnFocus,
    empty,
    needFirst,
    search,
    onPick,
    onType
  } = props;

  const [items, setItems] = useState<ComboItem[]>([]);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);

  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function run(query: string, force = false) {
    if (timer.current) clearTimeout(timer.current);
    if (!force && query.trim().length < minChars) {
      setItems([]);
      setNote('');
      setOpen(false);
      return;
    }
    const my = ++seq.current;
    setBusy(true);
    timer.current = setTimeout(async () => {
      let res: ComboItem[] | null = [];
      let failed = false;
      try {
        res = await search(query);
      } catch {
        failed = true;
      }
      // поки чекали, покупець набрав далі — ця відповідь застаріла
      if (my !== seq.current) return;

      setBusy(false);
      setOpen(true);
      setActive(-1);

      if (failed) {
        setItems([]);
        setNote(t('addr.offline'));
        return;
      }
      if (res === null) {
        setItems([]);
        setNote(t(needFirst || empty));
        return;
      }
      const list = res.slice(0, 100);
      setItems(list);
      setNote(list.length ? '' : t(empty));
    }, 260);
  }

  function choose(item: ComboItem) {
    onPick(item);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || !items.length) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // по колу: з кінця списку вниз — знову на початок
      const down = e.key === 'ArrowDown';
      setActive((a) => {
        const n = items.length;
        if (down) return a >= n - 1 ? 0 : a + 1;
        return a <= 0 ? n - 1 : a - 1;
      });
      return;
    }
    if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(items[active]);
    }
  }

  const listOpen = open && (busy || !!note || items.length > 0);

  return (
    <div className={className ?? 'field acombo'}>
      {label ? <label htmlFor={id}>{label}</label> : null}
      <div className="acombo__box">
        {chip}
        <input
          id={id}
          className={invalid ? 'is-invalid' : undefined}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={listOpen}
          aria-autocomplete="list"
          onChange={(e) => {
            onType(e.target.value);
            run(e.target.value);
          }}
          onFocus={() => {
            if (openOnFocus) run(value, true);
          }}
          onKeyDown={onKeyDown}
          // Закриваємо із затримкою: інакше blur встигає раніше
          // за вибір пункту й список зникає під пальцем
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
        <span className="acombo__spin" hidden={!busy} />
        <ul className="acombo__list" role="listbox" hidden={!listOpen}>
          {note && !busy ? <li className="acombo__msg">{note}</li> : null}
          {!busy &&
            items.map((it, n) => (
              <li
                key={it.ref}
                role="option"
                aria-selected={n === active}
                className={
                  'acombo__opt' + (it.cls ? ' ' + it.cls : '') + (n === active ? ' is-active' : '')
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(it);
                }}
                onMouseEnter={() => setActive(n)}
              >
                {it.node ?? (
                  <>
                    <span>{it.text}</span>
                    {it.note ? <i>{it.note}</i> : null}
                  </>
                )}
              </li>
            ))}
        </ul>
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}
