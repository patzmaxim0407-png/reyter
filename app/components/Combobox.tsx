'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLang } from './LangProvider';

/** Скільки пунктів показуємо щонайбільше. Довший список ніхто не
 *  гортає — його уточнюють запитом; головне сказати, що він є. */
const CAP = 100;

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
  const { t, lang } = useLang();
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
  /* Скільки знайшлось насправді, коли показано не все. Нуль —
     показано все. */
  const [more, setMore] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);

  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const typedHere = useRef(false);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopFade = () => {
    if (fade.current) clearTimeout(fade.current);
    fade.current = null;
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (fade.current) clearTimeout(fade.current);
    },
    []
  );

  function run(query: string, force = false) {
    if (timer.current) clearTimeout(timer.current);
    stopFade();
    if (!force && query.trim().length < minChars) {
      setItems([]);
      setNote('');
      setOpen(false);
      return;
    }
    const my = ++seq.current;
    // з чого починали: поле під курсором чи його заповнили ззовні
    typedHere.current = !!input.current && document.activeElement === input.current;
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
      setActive(-1);

      /* Поки відповідь ішла, покупець уже пішов із поля — тоді
         список розкривати не можна. Саме так і вилазило
         «Не вдалося звʼязатися з Новою Поштою» над уже
         заповненою адресою: людина дописувала місто, одразу
         бралася за наступне поле, а запізніла відповідь сама
         розкривала список — і закрити його вже не було кому.

         Питаємо лише про поля, у яких справді набирали: коли
         значення підставили ззовні, курсор і не мав тут бути. */
      if (typedHere.current && document.activeElement !== input.current) {
        setOpen(false);
        setItems([]);
        setNote('');
        return;
      }
      setOpen(true);

      if (failed) {
        setItems([]);
        setNote(t('addr.offline'));
        /* Це не підказка, а звістка про невдачу: прочитали — і
           годі. Дві секунди, і рядок гасне сам, щоб не висів над
           формою, поки покупець вписує адресу руками. */
        stopFade();
        fade.current = setTimeout(() => {
          if (my === seq.current) setNote('');
        }, 2000);
        return;
      }
      if (res === null) {
        setItems([]);
        setMore(0);
        setNote(t(needFirst || empty));
        return;
      }
      /* Список ріжеться на сотні — і доти про це не казав ніхто.
         Мовчазний зріз гірший за будь-яку пагінацію: людина бачить
         рівно стільки, скільки їй показали, і вважає, що це все.
         Найдорожче це коштує там, де шукають відділення: набрав
         місто, потрібного відділення в переліку немає — висновок
         «його не існує», хоча воно сто перше за ліком. */
      const list = res.slice(0, CAP);
      setItems(list);
      setMore(res.length > CAP ? res.length : 0);
      setNote(list.length ? '' : t(empty));
    }, 260);
  }

  /* Вибрали пункт — усе, що ще в дорозі, більше не потрібне.
     Без цього відкладений запит за останніми літерами приходив
     ПІСЛЯ вибору й сам розкривав список наново: у полі стоїть
     «Львів», відділення вже підтяглись, а зверху висить
     «Не вдалося звʼязатися з Новою Поштою». Саме це й бачив
     власник. Тому глушимо таймер, знецінюємо відповідь і
     прибираємо підпис. */
  function choose(item: ComboItem) {
    if (timer.current) clearTimeout(timer.current);
    stopFade();
    seq.current++;
    setBusy(false);
    setNote('');
    setItems([]);
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
          ref={input}
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
          {!busy && more ? (
            <li className="acombo__msg acombo__more">
              {lang === 'en'
                ? `showing first ${CAP} of ${more} — refine your search`
                : `показано перші ${CAP} із ${more} — уточніть запит`}
            </li>
          ) : null}
        </ul>
      </div>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}
