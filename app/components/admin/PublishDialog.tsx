'use client';

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { SITE_CONFIG } from '@/lib/site-config';
import { SHOP_URL } from './AdminBar';
import { useToast } from '../Toasts';
import {
  KEY_TOKEN,
  backupDataJs,
  buildDataJs,
  cancelSchedule,
  checkScheduleTime,
  defaultScheduleAt,
  diffSummary,
  draftDiffers,
  fmtWhen,
  publishNow,
  schedulePublish,
  scheduledStale,
  snapshotDraft,
  toLocalInput,
  type Draft,
  type PublishedDoc,
  type ScheduledDoc,
  type StatusLine
} from '@/lib/admin/publish';

/* ============================================================
   Публікація
   ------------------------------------------------------------
   Адмінка редагує чернетку; покупець бачить зафіксований знімок.
   Цей діалог — єдине місце, де одне стає другим.

   Розмітка й класи ті самі, що в admin.html.
   ============================================================ */

export default function PublishDialog({
  open,
  onClose,
  draft,
  seeded,
  published,
  scheduled,
  onChanged,
  user
}: {
  open: boolean;
  onClose(): void;
  draft: Draft;
  seeded: boolean;
  published: PublishedDoc | null;
  scheduled: ScheduledDoc | null;
  onChanged(next: { published?: PublishedDoc | null; scheduled?: ScheduledDoc | null }): void;
  user: User;
}) {
  const [status, setStatus] = useState<StatusLine | null>(null);
  const [when, setWhen] = useState('');
  const [showWhen, setShowWhen] = useState(false);
  const [token, setToken] = useState('');
  const [backupNote, setBackupNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const saveToken = (v: string) => {
    setToken(v);
    try {
      if (v) localStorage.setItem(KEY_TOKEN, v);
      else localStorage.removeItem(KEY_TOKEN);
    } catch {
      /* приватний режим */
    }
  };

  /* Токен GitHub лежить лише в цьому браузері — у базу він
     не потрапляє навіть випадково */
  useEffect(() => {
    try {
      setToken(localStorage.getItem(KEY_TOKEN) ?? '');
    } catch {
      /* приватний режим */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setBackupNote('');
    setShowWhen(false);
    setWhen(
      toLocalInput(
        scheduled?.publishAt ? new Date(scheduled.publishAt) : defaultScheduleAt(new Date())
      )
    );
  }, [open, scheduled]);

  if (!open) return null;

  /* Поки каталог не імпортовано в базу, чернетка — це просто
     вміст data.js, і «змінами» вона не рахується */
  const differs = draftDiffers(draft, published, seeded);
  const stale = scheduledStale(draft, scheduled);

  const deps = {
    db: db(),
    user: { email: user.email ?? '' },
    onStatus: setStatus,
    backup: (snap: Draft) => {
      /* Токен не перевіряємо тут: без нього backupDataJs скаже
         про це сама, і адмін побачить, що резервної копії немає.
         Мовчазний вихід виглядав би як успіх. */
      void backupDataJs(snap, {
        token,
        /* Конфіг мусить лягти в резервний файл незміненим: його
           досі читає СТАРИЙ сайт, і для нього data.js — єдине
           місце, де живуть розмірна сітка, статуси й соцмережі.
           Порожній обʼєкт тут затер би їх усі. */
        config: SITE_CONFIG,
        now: new Date(),
        onNote: setBackupNote,
        rememberToken: saveToken,
        // токен без прав не має тихо провалювати кожну публікацію
        forgetToken: () => saveToken('')
      });
    }
  };

  async function run(fn: () => Promise<{ ok: boolean; toast?: string; published?: PublishedDoc | null; scheduled?: ScheduledDoc | null }>) {
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        const next: { published?: PublishedDoc | null; scheduled?: ScheduledDoc | null } = {};
        if ('published' in res) next.published = res.published;
        if ('scheduled' in res) next.scheduled = res.scheduled;
        onChanged(next);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="a-modal" role="dialog" aria-modal="true">
      <div className="a-modal__backdrop" onClick={onClose} />
      <div className="a-modal__panel a-modal__panel--sm">
        <header className="a-modal__head">
          <h3>Публікація змін</h3>
          <button className="a-modal__close" type="button" aria-label="Закрити" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="a-publish">
          <div>
            {!published ? (
              <p className="a-pub__lead">
                Перша публікація: чернетка стане версією, яку бачать покупці.
              </p>
            ) : !differs ? (
              <p className="a-pub__lead is-ok">
                ✓ Сайт показує актуальну версію — неопублікованих змін немає.
              </p>
            ) : (
              <>
                <p className="a-pub__lead">Неопубліковані зміни:</p>
                <ul className="a-pub__diff">
                  {diffSummary(draft, published).map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {scheduled ? (
            <div className="a-pub__sched">
              Заплановано на <b>{fmtWhen(scheduled.publishAt)}</b>
              {/* Розклад зберіг стару чернетку: після планування
                  каталог правили далі, і в призначений час поїде
                  не те, що зараз на екрані */}
              {stale ? (
                <>
                  <br />
                  <span className="is-warn">
                    Чернетку змінили після планування — у призначений час опублікується
                    попередній варіант. Заплануйте ще раз, щоб оновити.
                  </span>
                </>
              ) : null}
              <button
                className="a-linklike"
                type="button"
                disabled={busy}
                onClick={() => void run(() => cancelSchedule(deps))}
              >
                Скасувати
              </button>
            </div>
          ) : null}

          <div className="field a-pub__when" hidden={!showWhen}>
            <label htmlFor="pubWhen">Коли опублікувати</label>
            <input
              type="datetime-local"
              id="pubWhen"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <p className="field__hint">
              Час — за годинником цього пристрою. У вибраний момент сайт сам перейде на
              нову версію: тримати адмінку відкритою не потрібно.
            </p>
          </div>

          <details className="a-pub__adv">
            <summary>Резервна копія та чернетка</summary>
            <p className="field__hint">
              Після публікації файл <code>new/js/data.js</code> у репозиторії
              оновлюється автоматично. Для цього потрібен GitHub-токен (Fine-grained,
              доступ лише до репозиторію <b>reyter</b>, дозвіл{' '}
              <b>Contents: Read and write</b>). Токен зберігається тільки у вашому
              браузері.
            </p>
            <div className="field">
              <label htmlFor="ghToken">GitHub-токен</label>
              <input
                id="ghToken"
                type="password"
                placeholder="github_pat_… або ghp_…"
                autoComplete="off"
                value={token}
                onChange={(e) => saveToken(e.target.value)}
              />
            </div>
            {backupNote ? <p className="field__hint">{backupNote}</p> : null}

            {/* Дві речі, доступні й без GitHub: подивитись на
                чернетку очима покупця та забрати data.js собі
                на диск, якщо токена немає. */}
            <div className="a-pub__links">
              <a
                href={SHOP_URL + '/?preview=draft'}
                target="_blank"
                rel="noopener"
              >
                Переглянути чернетку на сайті ↗
              </a>
              <button
                className="a-linklike"
                type="button"
                onClick={() => {
                  const text = buildDataJs(snapshotDraft(draft), SITE_CONFIG, new Date());
                  const url = URL.createObjectURL(
                    new Blob([text], { type: 'text/javascript;charset=utf-8' })
                  );
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'data.js';
                  a.click();
                  URL.revokeObjectURL(url);
                  toast('Файл data.js завантажено', 'success');
                }}
              >
                Завантажити data.js
              </button>
            </div>
          </details>

          {status ? (
            <div className={'a-publish__status is-' + status.kind}>{status.text}</div>
          ) : null}
        </div>

        <footer className="a-modal__foot">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Закрити
          </button>
          <button
            className="btn btn--ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!showWhen) {
                setShowWhen(true);
                return;
              }
              const check = checkScheduleTime(when, new Date());
              if (!check.ok) {
                setStatus(check.status);
                return;
              }
              void run(() => schedulePublish(draft, check.ts, deps));
            }}
          >
            {showWhen ? 'Зберегти розклад' : 'Запланувати…'}
          </button>
          <button
            className="btn btn--primary"
            type="button"
            /* Публікувати те саме вдруге нема сенсу: змінилася б
               лише дата публікації, а резервна копія пішла б
               у GitHub іще раз */
            disabled={busy || (!differs && !scheduled)}
            onClick={() => void run(() => publishNow(draft, deps))}
          >
            Опублікувати зараз
          </button>
        </footer>
      </div>
    </div>
  );
}
