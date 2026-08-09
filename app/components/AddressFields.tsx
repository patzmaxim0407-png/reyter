'use client';

import Combobox from './Combobox';
import {
  CARRIERS,
  COUNTRIES,
  npCities,
  npWarehouses,
  stateRequired,
  zipHint,
  type AddressForm,
  type CarrierId
} from '@/lib/address';
import { t, tf } from '@/lib/i18n';

/* Поля доставки. Розмітка й класи ті самі, що в address.js:
   стилі перенесені як є, і дописувати CSS тут нема потреби. */

export default function AddressFields({
  v,
  set,
  invalid
}: {
  v: AddressForm;
  set(patch: Partial<AddressForm>): void;
  invalid?: keyof AddressForm | null;
}) {
  const intl = v.carrier === 'intl';

  return (
    <div className="addr">
      <div className="field">
        <label htmlFor="coCarrier">{t('addr.carrier')}</label>
        <select
          id="coCarrier"
          value={v.carrier}
          onChange={(e) => set({ carrier: e.target.value as CarrierId })}
        >
          {CARRIERS.map((x) => (
            <option value={x.id} key={x.id}>
              {tf(x, 'title')}
            </option>
          ))}
        </select>
      </div>

      <div className="addr__np" hidden={intl}>
        <Combobox
          id="coCity"
          label={t('addr.city')}
          value={v.city}
          placeholder={t('addr.cityPh')}
          hint={t('addr.cityHint')}
          invalid={invalid === 'city'}
          empty="addr.noCity"
          search={async (q) => {
            const list = await npCities(q);
            return list.map((x) => ({
              ref: x.ref,
              text: x.label,
              // у поле кладемо коротку назву, а не «м. Львів, Львівська обл.»
              value: x.name,
              note: x.warehouses ? t('addr.nWarehouses').replace('{n}', String(x.warehouses)) : ''
            }));
          }}
          onType={(city) => set({ city, cityRef: '' })}
          onPick={(it) =>
            /* Разом із містом скидаємо відділення: інакше
               лишилася б пара «нове місто + чуже відділення» */
            set({ city: it.value, cityRef: it.ref, branch: '', branchRef: '' })
          }
        />

        <Combobox
          id="coBranch"
          label={t('addr.branch')}
          value={v.branch}
          disabled={!v.cityRef}
          openOnFocus
          minChars={0}
          placeholder={t('addr.branchPh')}
          hint={t('addr.branchHint')}
          invalid={invalid === 'branch'}
          empty="addr.noBranch"
          needFirst="addr.pickCityFirst"
          search={async (q) => {
            if (!v.cityRef) return null;
            const list = await npWarehouses(v.cityRef, q);
            return list.map((x) => ({
              ref: x.ref,
              text: x.label,
              value: x.label,
              note: x.postomat ? t('addr.postomat') : ''
            }));
          }}
          onType={(branch) => set({ branch, branchRef: '' })}
          onPick={(it) => set({ branch: it.value, branchRef: it.ref })}
        />
      </div>

      <div className="addr__intl" hidden={!intl}>
        <div className="field">
          <label htmlFor="coCountry">{t('addr.country')}</label>
          <select
            id="coCountry"
            className={invalid === 'countryCode' ? 'is-invalid' : undefined}
            value={v.countryCode}
            onChange={(e) => set({ countryCode: e.target.value })}
          >
            <option value="">{t('addr.pickCountry')}</option>
            {COUNTRIES.map((x) => (
              <option value={x.code} key={x.code}>
                {tf(x, 'title')}
              </option>
            ))}
          </select>
        </div>

        {/* Країни поза списком вписують текстом — напрямків
            більше, ніж ми готові перелічити наперед */}
        <div className="field" hidden={v.countryCode !== 'other'}>
          <label htmlFor="coCountryOther">{t('addr.countryOther')}</label>
          <input
            id="coCountryOther"
            className={invalid === 'countryOther' ? 'is-invalid' : undefined}
            placeholder={t('addr.countryOtherPh')}
            value={v.countryOther}
            onChange={(e) => set({ countryOther: e.target.value })}
          />
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="coIntlCity">{t('addr.intlCity')}</label>
            <input
              id="coIntlCity"
              className={invalid === 'intlCity' ? 'is-invalid' : undefined}
              autoComplete="address-level2"
              value={v.intlCity}
              onChange={(e) => set({ intlCity: e.target.value })}
            />
          </div>

          {/* Для США, Канади й Австралії без штату посилку не приймуть */}
          <div className={'field' + (stateRequired(v.countryCode) ? ' is-required' : '')}>
            <label htmlFor="coState">{t('addr.state')}</label>
            <input
              id="coState"
              className={invalid === 'state' ? 'is-invalid' : undefined}
              autoComplete="address-level1"
              value={v.state}
              onChange={(e) => set({ state: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="coStreet">{t('addr.street')}</label>
          <input
            id="coStreet"
            className={invalid === 'street' ? 'is-invalid' : undefined}
            autoComplete="address-line1"
            placeholder={t('addr.streetPh')}
            value={v.street}
            onChange={(e) => set({ street: e.target.value })}
          />
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="coExtra">{t('addr.extra')}</label>
            <input
              id="coExtra"
              autoComplete="address-line2"
              placeholder={t('addr.extraPh')}
              value={v.extra}
              onChange={(e) => set({ extra: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="coZip">{t('addr.zip')}</label>
            <input
              id="coZip"
              className={invalid === 'zip' ? 'is-invalid' : undefined}
              autoComplete="postal-code"
              placeholder={zipHint(v.countryCode)}
              value={v.zip}
              onChange={(e) => set({ zip: e.target.value })}
            />
          </div>
        </div>

        <p className="field__hint">{t('addr.intlHint')}</p>
      </div>
    </div>
  );
}
