'use client';

import { useEffect, useState } from 'react';
import { useAsk } from './AskProvider';
import { useToast } from '../Toasts';
import { copyText } from '@/lib/copy';
import { db, forgetNotifySettings } from '@/lib/firebase';
import {
  KEY_WORKER,
  FOUNDERS,
  WIPE_TG_ASK,
  addAdmin,
  checkAdminEmail,
  checkWorker,
  detectChats,
  loadAdmins,
  openSettings,
  removeAdmin,
  removeAdminAsk,
  saveSettings,
  settingsForTest,
  settingsFromForm,
  testEmail,
  testTelegram,
  wipeLegacyTg,
  type AdminEntry,
  type DetectedChat,
  type LegacyTg,
  type SettingsFormValues
} from '@/lib/admin/settings';
import type { StatusLine } from '@/lib/admin/publish';

/* ============================================================
   Налаштування
   ------------------------------------------------------------
   Дві вкладки: сповіщення й адміністратори.

   Токен Telegram і ключ Resend тут не редагуються — вони живуть
   у змінних воркера, і в базу не потрапляють. Ключ адміністратора
   воркера зберігається лише в цьому браузері.
   ============================================================ */

export default function SettingsDialog({
  open,
  onClose,
  user
}: {
  open: boolean;
  onClose(): void;
  /** Пошта того, хто додає: вона лягає в документ адміністратора. */
  user: string;
}) {
  const ask = useAsk();
  const toast = useToast();

  const [tab, setTab] = useState<'notify' | 'admins'>('notify');
  const [values, setValues] = useState<SettingsFormValues>({ workerUrl: '', fsEmail: '' });
  const [legacy, setLegacy] = useState<LegacyTg | null>(null);
  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [newAdmin, setNewAdmin] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [testTo, setTestTo] = useState('');
  const [status, setStatus] = useState<StatusLine | null>(null);
  const [chats, setChats] = useState<{ text: string; value: string; list: DetectedChat[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setChats(null);
    try {
      setAdminKey(localStorage.getItem(KEY_WORKER) ?? '');
    } catch {
      /* приватний режим */
    }
    const d = db();
    if (!d) return;
    void openSettings(d).then((screen) => {
      setValues(screen.values);
      setLegacy(screen.legacy);
    });
    void loadAdmins(d).then(setAdmins);
  }, [open]);

  if (!open) return null;

  const form = settingsFromForm(values);
  const test = settingsForTest(form, legacy);

  function rememberKey(v: string) {
    setAdminKey(v);
    try {
      if (v) localStorage.setItem(KEY_WORKER, v);
      else localStorage.removeItem(KEY_WORKER);
    } catch {
      /* приватний режим */
    }
  }

  async function run(fn: () => Promise<StatusLine | { kind: StatusLine['kind']; text: string }>) {
    setBusy(true);
    try {
      setStatus(await fn());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="a-modal" role="dialog" aria-modal="true">
      <div className="a-modal__backdrop" onClick={onClose} />
      <div className="a-modal__panel a-modal__panel--sm">
        <header className="a-modal__head">
          <h3>Налаштування</h3>
          <button className="a-modal__close" type="button" aria-label="Закрити" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="a-settings__tabs" role="tablist">
          <button
            className={'ao-chip' + (tab === 'notify' ? ' is-active' : '')}
            type="button"
            onClick={() => setTab('notify')}
          >
            Сповіщення
          </button>
          <button
            className={'ao-chip' + (tab === 'admins' ? ' is-active' : '')}
            type="button"
            onClick={() => setTab('admins')}
          >
            Адміністратори
          </button>
        </div>

        <div className="a-settings">
          {tab === 'notify' ? (
            <>
              <div className="field">
                <label htmlFor="stWorkerUrl">Адреса Cloudflare Worker</label>
                <input
                  id="stWorkerUrl"
                  autoComplete="off"
                  placeholder="reyter-notify.…workers.dev"
                  value={values.workerUrl}
                  onChange={(e) => setValues((v) => ({ ...v, workerUrl: e.target.value }))}
                />
                <p className="field__hint">
                  Воркер тримає в себе ключ Resend і токен Telegram — із коду сайту їх не
                  прочитати.
                </p>
              </div>

              <div className="field">
                <label htmlFor="stWorkerKey">Ключ адміністратора воркера</label>
                <input
                  id="stWorkerKey"
                  type="password"
                  autoComplete="off"
                  placeholder="значення змінної ADMIN_KEY"
                  value={adminKey}
                  onChange={(e) => rememberKey(e.target.value)}
                />
                <p className="field__hint">Зберігається лише у вашому браузері.</p>
              </div>

              <div className="field">
                <label htmlFor="stFsEmail">Пошта магазину</label>
                <input
                  id="stFsEmail"
                  type="email"
                  autoComplete="off"
                  value={values.fsEmail}
                  onChange={(e) => setValues((v) => ({ ...v, fsEmail: e.target.value }))}
                />
              </div>

              <div className="a-settings__actions">
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const res = await checkWorker(form.workerUrl, adminKey);
                      if (res.kind === 'no-url') return { kind: 'err' as const, text: res.status };
                      const r = res.report;
                      if (!r.ok) return { kind: 'err' as const, text: r.error };
                      /* Кожен рядок звіту — окрема річ, яку треба
                         або ввімкнути, або дописати у воркер */
                      return {
                        kind: r.tone === 'ok' ? ('ok' as const) : ('err' as const),
                        text: r.lines
                          .map((l) => `${l.state === 'on' ? '✓' : '✕'} ${l.label}${l.extra ? ' — ' + l.extra : ''}`)
                          .join(' · ')
                      };
                    })
                  }
                >
                  Перевірити воркер
                </button>

                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const res = await detectChats(test, adminKey);
                      setChats(res.chats.length ? { text: res.text, value: res.value, list: res.chats } : null);
                      return { kind: res.kind, text: res.text };
                    })
                  }
                >
                  Показати Chat ID
                </button>

                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => testTelegram(test, adminKey))}
                >
                  Тест Telegram
                </button>
              </div>

              {chats ? (
                <div className="a-wstatus is-ok">
                  <p>
                    Впишіть це у змінну <code>TG_CHAT</code> вашого воркера й натисніть{' '}
                    <b>Deploy</b>:
                  </p>
                  <div className="a-legacy">
                    <div>
                      <code>{chats.value}</code>
                      <button
                        type="button"
                        onClick={async () => {
                          const done = await copyText(chats.value);
                          toast(done ? 'Скопійовано ✓' : 'Не вдалося скопіювати', done ? 'success' : 'plain');
                        }}
                      >
                        Копіювати
                      </button>
                    </div>
                  </div>
                  <ul>
                    {chats.list.map((c) => (
                      <li key={c.id}>
                        {c.id} — {c.name}
                        {c.isGroup ? <b> (група)</b> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="field">
                <label htmlFor="fsTestEmail">Тестовий лист на</label>
                <input
                  id="fsTestEmail"
                  type="email"
                  autoComplete="off"
                  placeholder="you@example.com"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                />
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => testEmail(test, testTo, adminKey))}
                >
                  Надіслати тест
                </button>
              </div>

              {/* Старий токен у базі — його треба прибрати, а не
                  лишати лежати: саме заради цього все й переносили */}
              {legacy ? (
                <div className="a-legacy">
                  <p className="field__hint">
                    У базі ще лежить токен Telegram зі старої схеми. Перенесіть його у змінні
                    воркера й приберіть звідси.
                  </p>
                  <button
                    className="btn btn--ghost btn--sm ao-danger"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const yes = await ask({
                        title: 'Прибрати токен із бази?',
                        text: WIPE_TG_ASK,
                        okText: 'Прибрати',
                        danger: true
                      });
                      if (yes !== true) return;
                      const d = db();
                      if (!d) return;
                      await run(async () => {
                        const res = await wipeLegacyTg(d);
                        if (res.kind === 'ok') {
                          forgetNotifySettings();
                          setLegacy(null);
                        }
                        return res;
                      });
                    }}
                  >
                    Прибрати токен із бази
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="stNewAdmin">Додати адміністратора</label>
                <input
                  id="stNewAdmin"
                  type="email"
                  autoComplete="off"
                  placeholder="email@example.com"
                  value={newAdmin}
                  onChange={(e) => setNewAdmin(e.target.value)}
                />
                <button
                  className="btn btn--primary btn--sm"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const check = checkAdminEmail(newAdmin, admins);
                      if (!check.ok) return { kind: 'err' as const, text: check.message };
                      const d = db();
                      if (!d) return { kind: 'err' as const, text: 'Немає звʼязку з базою' };
                      const res = await addAdmin(d, check.email, user);
                      if (res.ok) {
                        setNewAdmin('');
                        setAdmins(await loadAdmins(d));
                      }
                      return { kind: res.ok ? ('ok' as const) : ('err' as const), text: res.toast };
                    })
                  }
                >
                  Додати
                </button>
              </div>

              <div className="a-admins">
                {/* Засновників не прибрати: якби колекція
                    спорожніла, зайти й полагодити її було б нікому.
                    Тому вони показані окремо й без кнопки. */}
                {FOUNDERS.map((email) => (
                  <div className="a-admin" key={email}>
                    <span>
                      {email} <i className="ao-tag">засновник</i>
                    </span>
                  </div>
                ))}

                {admins.map((a) => (
                  <div className="a-admin" key={a.email}>
                    <span>
                      {a.email}
                      {a.by ? <i className="ao-tag">додав {a.by.split('@')[0]}</i> : null}
                    </span>
                    {(
                      <button
                        className="btn btn--ghost btn--sm ao-danger"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          const yes = await ask({
                            title: 'Прибрати доступ?',
                            text: removeAdminAsk(a.email),
                            okText: 'Прибрати',
                            danger: true
                          });
                          if (yes !== true) return;
                          const d = db();
                          if (!d) return;
                          await run(async () => {
                            const res = await removeAdmin(d, a.email);
                            if (res.ok) setAdmins(await loadAdmins(d));
                            return { kind: res.ok ? ('ok' as const) : ('err' as const), text: res.toast };
                          });
                        }}
                      >
                        Прибрати
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {status ? <div className={'a-wstatus is-' + status.kind}>{status.text}</div> : null}
        </div>

        <footer className="a-modal__foot">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Закрити
          </button>
          {tab === 'notify' ? (
            <button
              className="btn btn--primary"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const d = db();
                  if (!d) return { kind: 'err' as const, text: 'Немає звʼязку з базою' };
                  const res = await saveSettings(d, form);
                  if (res.kind === 'ok') {
                    // наступне читання має побачити нову адресу воркера
                    forgetNotifySettings();
                    toast('Налаштування збережено ✓', 'success');
                  }
                  return res;
                })
              }
            >
              Зберегти
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
