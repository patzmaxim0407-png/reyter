'use client';

import { useMemo, useState } from 'react';
import AddressFields, { focusAddressField } from './AddressFields';
import { useToast } from './Toasts';
import * as cart from '@/lib/cart';
import * as fb from '@/lib/firebase';
import {
  addressLine,
  checkAddress,
  createAddrBook,
  fromForm,
  toForm,
  EMPTY_FORM,
  type AddressForm,
  type SavedAddress
} from '@/lib/address';
import { t } from '@/lib/i18n';

/* Адресна книга профілю.

   Замовляють на різні відділення — собі, на роботу, рідним.
   Тут їх зберігають, а в оформленні обирають зі списку. */

export default function AddressBook() {
  /* Хмара оновлюється лише для залогінених: писати профіль
     анонімного покупця нікуди — і нікому потім не віддати */
  const book = useMemo(
    () =>
      createAddrBook({
        get: () => cart.getProfile(),
        save: (p) => {
          cart.saveProfile(p);
          const u = fb.auth()?.currentUser;
          if (u) void fb.saveCloudProfile(u.uid, u.email ?? '', p);
        }
      }),
    []
  );

  /* Книга живе в localStorage, а не в стані React. Лічильник
     змушує перечитати її після кожного запису. */
  const [tick, setTick] = useState(0);
  const list = useMemo(() => book.list(), [book, tick]);
  const defaultId = useMemo(() => book.defaultId(), [book, tick]);
  const refresh = () => setTick((n) => n + 1);

  /* null — редактор закритий, '' — нова адреса, id — правимо наявну */
  const [editId, setEditId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [form, setForm] = useState<AddressForm>(EMPTY_FORM);
  const [bad, setBad] = useState<keyof AddressForm | null>(null);
  const toast = useToast();

  function openEditor(a: SavedAddress | null) {
    setEditId(a ? a.id : '');
    setLabel(a?.label ?? '');
    setForm(toForm(a));
    setBad(null);
  }

  function save() {
    const problem = checkAddress(form);
    if (problem) {
      setBad(problem.field);
      toast(t(problem.key));
      focusAddressField('ad', problem.field);
      return;
    }
    book.save(fromForm(form), {
      id: editId || '',
      label: label.trim(),
      // перша адреса стає основною сама — вибирати нема з чого
      makeDefault: !list.length
    });
    setEditId(null);
    refresh();
    toast(t('adr.saved'), 'success');
  }

  return (
    <div className="addrbook">
      <h5 className="addrbook__title">{t('adr.title')}</h5>

      {list.length ? (
        list.map((a) => (
          <article className={'addrcard' + (a.id === defaultId ? ' is-default' : '')} key={a.id}>
            <div className="addrcard__top">
              <b>{book.title(a)}</b>
              {a.id === defaultId ? <span className="addrcard__badge">{t('adr.default')}</span> : null}
            </div>
            <p className="addrcard__line">{addressLine(a)}</p>
            <div className="addrcard__actions">
              {a.id === defaultId ? null : (
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => {
                    book.setDefault(a.id);
                    refresh();
                    toast(t('adr.defaultSet'), 'success');
                  }}
                >
                  {t('adr.makeDefault')}
                </button>
              )}
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => openEditor(a)}>
                {t('adr.edit')}
              </button>
              <button
                className="btn btn--ghost btn--sm addrcard__del"
                type="button"
                aria-label={t('adr.remove')}
                onClick={() => {
                  book.remove(a.id);
                  if (editId === a.id) setEditId(null);
                  refresh();
                  toast(t('adr.removed'));
                }}
              >
                ✕
              </button>
            </div>
          </article>
        ))
      ) : (
        <p className="account-note">{t('adr.empty')}</p>
      )}

      {editId === null ? (
        <button
          className="btn btn--ghost btn--sm addrbook__add"
          type="button"
          onClick={() => openEditor(null)}
        >
          + {t('adr.add')}
        </button>
      ) : (
        <div className="addrform">
          <h5>{t(editId ? 'adr.editTitle' : 'adr.newTitle')}</h5>
          <div className="field">
            <label htmlFor="adLabel">{t('adr.label')}</label>
            <input
              id="adLabel"
              autoComplete="off"
              placeholder={t('adr.labelPh')}
              value={label}
              autoFocus
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {/* Свій префікс: той самий блок стоїть і в оформленні */}
          <AddressFields prefix="ad" v={form} set={(patch) => setForm((f) => ({ ...f, ...patch }))} invalid={bad} />

          <div className="addrform__actions">
            <button className="btn btn--primary btn--sm" type="button" onClick={save}>
              {t('adr.save')}
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setEditId(null)}>
              {t('adr.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
