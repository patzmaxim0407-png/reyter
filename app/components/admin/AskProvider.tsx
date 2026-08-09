'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';

/* ============================================================
   Діалог адмінки
   ------------------------------------------------------------
   Порт R.ask. Замінює alert/confirm/prompt браузера: ті не
   стилізуються, а на мобільному ще й показують адресу сайту —
   у вікні, яке питає «видалити товар?», це виглядає як шахрайство.

   Розмітка й класи ті самі, що в admin.html.

   Повертає:
   • true / false            — звичайне підтвердження;
   • рядок або null          — коли є поле вводу;
   • { reason, note } | null — коли є список причин;
   • 'alt'                   — коли натиснули третю кнопку.
   ============================================================ */

export interface AskOption {
  id: string;
  title: string;
}

export interface AskOpts {
  title?: string;
  text?: string;
  okText?: string;
  cancelText?: string;
  /** Третя кнопка — для питань із двома різними «так». */
  altText?: string;
  danger?: boolean;
  /** Наявність поля вводу; '' — порожнє поле. */
  input?: string;
  label?: string;
  placeholder?: string;
  select?: { label?: string; options: AskOption[]; value?: string };
}

export type AskResult = boolean | string | 'alt' | { reason: string; note: string } | null;

type Ask = (opts: AskOpts) => Promise<AskResult>;

const Ctx = createContext<Ask | null>(null);

export function useAsk(): Ask {
  const ask = useContext(Ctx);
  if (!ask) throw new Error('useAsk поза AskProvider');
  return ask;
}

interface Pending {
  opts: AskOpts;
  resolve: (v: AskResult) => void;
}

export default function AskProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>(
    (opts) =>
      new Promise((resolve) => {
        setText(opts.input ?? '');
        setReason(opts.select?.value ?? opts.select?.options[0]?.id ?? '');
        setPending({ opts, resolve });
      }),
    []
  );

  const opts = pending?.opts;
  const wantsInput = opts?.input !== undefined;
  const wantsSelect = !!opts?.select;

  /* Фокус ставимо туди, де людина одразу почне діяти: у список,
     у поле, або на головну кнопку — щоб Enter спрацював без миші */
  useEffect(() => {
    if (!pending) return;
    const el = wantsSelect ? selectRef.current : wantsInput ? inputRef.current : okRef.current;
    const id = setTimeout(() => el?.focus(), 60);
    return () => clearTimeout(id);
  }, [pending, wantsInput, wantsSelect]);

  /* Поки діалог відкритий, сторінка під ним не має скролитись */
  useEffect(() => {
    if (!pending) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pending]);

  const close = useCallback(
    (result: AskResult) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending]
  );

  function confirm() {
    if (!opts) return;
    if (wantsSelect) return close({ reason, note: text.trim() });
    if (wantsInput) return close(text.trim());
    close(true);
  }

  return (
    <Ctx.Provider value={ask}>
      {children}

      <div className="a-modal a-ask" role="dialog" aria-modal="true" hidden={!pending}>
        <div className="a-modal__backdrop" onClick={() => close(wantsInput ? null : false)} />
        <div className="a-modal__panel a-modal__panel--sm">
          <header className="a-modal__head">
            <h3>{opts?.title || 'Підтвердження'}</h3>
            <button
              className="a-modal__close"
              type="button"
              aria-label="Закрити"
              onClick={() => close(wantsInput ? null : false)}
            >
              ✕
            </button>
          </header>

          <div className="a-ask__body">
            {/* Порожній рядок між абзацами робить питання читабельним:
                у діалозі часто пояснюють наслідки дії */}
            <p>
              {String(opts?.text ?? '')
                .split('\n\n')
                .map((para, i) => (
                  <span key={i}>
                    {para.split('\n').map((line, k) => (
                      <span key={k}>
                        {k ? <br /> : null}
                        {line}
                      </span>
                    ))}
                  </span>
                ))}
            </p>

            <div className="field" hidden={!wantsSelect}>
              <label htmlFor="askSelect">{opts?.select?.label ?? ''}</label>
              <select
                id="askSelect"
                ref={selectRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {(opts?.select?.options ?? []).map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" hidden={!wantsInput && !wantsSelect}>
              <label htmlFor="askInput">{opts?.label ?? ''}</label>
              <input
                id="askInput"
                ref={inputRef}
                autoComplete="off"
                placeholder={opts?.placeholder ?? ''}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    confirm();
                  }
                }}
              />
            </div>
          </div>

          <footer className="a-modal__foot">
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => close(wantsInput ? null : false)}
            >
              {opts?.cancelText || 'Скасувати'}
            </button>
            {opts?.altText ? (
              <button className="btn btn--ghost" type="button" onClick={() => close('alt')}>
                {opts.altText}
              </button>
            ) : null}
            <button
              className={'btn ' + (opts?.danger ? 'btn--danger' : 'btn--primary')}
              type="button"
              ref={okRef}
              onClick={confirm}
            >
              {opts?.okText || 'Гаразд'}
            </button>
          </footer>
        </div>
      </div>
    </Ctx.Provider>
  );
}
