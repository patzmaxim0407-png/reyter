'use client';

import Combobox from './Combobox';
import { useLang } from './LangProvider';
import {
  CARRIERS,
  COUNTRIES,
  branchAvailable,
  intlDivisions,
  intlSettlements,
  npCities,
  npWarehouses,
  regRequired,
  stateRequired,
  zipHint,
  type AddressForm,
  type CarrierId
} from '@/lib/address';

/* Поля доставки. Розмітка й класи ті самі, що в address.js:
   стилі перенесені як є, і дописувати CSS тут нема потреби. */

/* Поле форми → хвіст id у розмітці. Здебільшого це просто назва
   з великої літери, але countryCode малюється як «Country», тож
   зібрати id формулою не вийде. */
const FIELD_ID: Record<string, string> = {
  city: 'City',
  branch: 'Branch',
  countryCode: 'Country',
  countryOther: 'CountryOther',
  intlCity: 'IntlCity',
  intlBranch: 'IntlBranch',
  state: 'State',
  street: 'Street',
  building: 'Building',
  zip: 'Zip',
  regCity: 'RegCity',
  regStreet: 'RegStreet',
  regBuilding: 'RegBuilding',
  regZip: 'RegZip'
};

/** Перевести фокус у поле, якого бракує: у формі їх до девʼяти,
 *  і шукати червону рамку очима — зайва робота для покупця. */
export function focusAddressField(prefix: string, field: string): void {
  const el = document.getElementById(prefix + (FIELD_ID[field] ?? ''));
  el?.focus();
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export default function AddressFields({
  v,
  set,
  invalid,
  prefix = 'co'
}: {
  v: AddressForm;
  set(patch: Partial<AddressForm>): void;
  invalid?: keyof AddressForm | null;
  /* Той самий блок стоїть і в оформленні, і в адресній книзі
     кабінету. Якби id полів збігались, підпис клікав би не по
     тому полю, а браузер підставляв би збережене не туди. */
  prefix?: string;
}) {
  const { t, tf } = useLang();
  const intl = v.carrier === 'intl';
  const at = (name: string) => prefix + name;

  return (
    <div className="addr">
      <div className="field">
        <label htmlFor={at('Carrier')}>{t('addr.carrier')}</label>
        <select
          id={at('Carrier')}
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
          id={at('City')}
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
          id={at('Branch')}
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
          <label htmlFor={at('Country')}>{t('addr.country')}</label>
          <select
            id={at('Country')}
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
          <label htmlFor={at('CountryOther')}>{t('addr.countryOther')}</label>
          <input
            id={at('CountryOther')}
            className={invalid === 'countryOther' ? 'is-invalid' : undefined}
            placeholder={t('addr.countryOtherPh')}
            value={v.countryOther}
            onChange={(e) => set({ countryOther: e.target.value })}
          />
        </div>

        {/* Місто беремо з довідника перевізника, а не з голови:
            за ним же рахується вартість і підтягуються відділення.
            Довідник шукає латинкою. */}
        <Combobox
          id={at('IntlCity')}
          label={t('addr.intlCity')}
          value={v.intlCity}
          placeholder={t('addr.intlCityPh')}
          hint={t('addr.intlCityHint')}
          invalid={invalid === 'intlCity'}
          empty="addr.noCity"
          needFirst="addr.pickCountryFirst"
          search={async (q) => {
            if (!v.countryCode || v.countryCode === 'other') return null;
            const list = await intlSettlements(v.countryCode, q);
            return list.map((x) => ({ ref: x.id, text: x.label, value: x.name, note: '' }));
          }}
          onType={(intlCity) => set({ intlCity, intlCityId: '', intlBranch: '', intlBranchId: '' })}
          onPick={(it) =>
            set({
              intlCity: it.value,
              intlCityId: it.ref,
              intlBranch: '',
              intlBranchId: '',
              intlBranchType: ''
            })
          }
        />

        {/* Куди саме везти. У відділення дешевше й простіше —
            ані вулиці, ані індексу тоді не потрібно взагалі. */}
        <div className="field intl-mode" hidden={!branchAvailable(v.countryCode)}>
          <span className="field__label">{t('addr.intlMode')}</span>
          <div className="ochips">
            <label className="ochip">
              <input
                type="radio"
                name={at('IntlMode')}
                checked={v.intlMode === 'branch'}
                onChange={() => set({ intlMode: 'branch' })}
              />
              <span>{t('addr.modeBranch')}</span>
            </label>
            <label className="ochip">
              <input
                type="radio"
                name={at('IntlMode')}
                checked={v.intlMode === 'address'}
                onChange={() => set({ intlMode: 'address' })}
              />
              <span>{t('addr.modeAddress')}</span>
            </label>
          </div>
        </div>

        {v.intlMode === 'branch' && branchAvailable(v.countryCode) ? (
          <>
            <Combobox
              id={at('IntlBranch')}
              label={t('addr.intlBranch')}
              value={v.intlBranch}
              disabled={!v.intlCityId}
              openOnFocus
              minChars={0}
              placeholder={t('addr.branchPh')}
              hint={t('addr.intlBranchHint')}
              invalid={invalid === 'intlBranch'}
              empty="addr.noBranch"
              needFirst="addr.pickCityFirst"
              search={async (q) => {
                if (!v.intlCityId) return null;
                const list = await intlDivisions(v.countryCode, v.intlCityId, q);
                return list.map((x) => ({
                  ref: x.id,
                  text: x.label,
                  value: x.label,
                  note: x.type === 'Postomat' ? t('addr.postomat') : x.type === 'PUDO' ? t('addr.pudo') : ''
                }));
              }}
              onType={(intlBranch) => set({ intlBranch, intlBranchId: '' })}
              onPick={(it) => set({ intlBranch: it.value, intlBranchId: it.ref })}
            />
            <p className="field__hint">{t('addr.localPhone')}</p>
          </>
        ) : (
          <>
            {/* Штат обовʼязковий там, де без нього посилку не
                приймуть: США, Ірландія, Канада. */}
            <div className={'field' + (stateRequired(v.countryCode) ? ' is-required' : '')}>
              <label htmlFor={at('State')}>{t('addr.state')}</label>
              <input
                id={at('State')}
                className={invalid === 'state' ? 'is-invalid' : undefined}
                autoComplete="address-level1"
                value={v.state}
                onChange={(e) => set({ state: e.target.value })}
              />
            </div>

            {/* Вулиця й будинок — окремо: перевізник чекає саме
                назву вулиці, а номер бере власним полем. */}
            <div className="form-row form-row--street">
              <div className="field">
                <label htmlFor={at('Street')}>{t('addr.street')}</label>
                <input
                  id={at('Street')}
                  className={invalid === 'street' ? 'is-invalid' : undefined}
                  autoComplete="address-line1"
                  placeholder={t('addr.streetPh')}
                  maxLength={100}
                  value={v.street}
                  onChange={(e) => set({ street: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={at('Building')}>{t('addr.building')}</label>
                <input
                  id={at('Building')}
                  className={invalid === 'building' ? 'is-invalid' : undefined}
                  placeholder="12"
                  maxLength={100}
                  value={v.building}
                  onChange={(e) => set({ building: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label htmlFor={at('Flat')}>{t('addr.flat')}</label>
                <input
                  id={at('Flat')}
                  autoComplete="address-line2"
                  placeholder={t('addr.flatPh')}
                  /* у перевізника на це поле рівно десять знаків */
                  maxLength={10}
                  value={v.flat}
                  onChange={(e) => set({ flat: e.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor={at('Zip')}>{t('addr.zip')}</label>
                <input
                  id={at('Zip')}
                  className={invalid === 'zip' ? 'is-invalid' : undefined}
                  autoComplete="postal-code"
                  placeholder={zipHint(v.countryCode)}
                  maxLength={10}
                  value={v.zip}
                  onChange={(e) => set({ zip: e.target.value })}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor={at('Note')}>{t('addr.note')}</label>
              <input
                id={at('Note')}
                placeholder={t('addr.notePh')}
                maxLength={100}
                value={v.note}
                onChange={(e) => set({ note: e.target.value })}
              />
            </div>

            <p className="field__hint">{t('addr.intlHint')}</p>
          </>
        )}

        {/* Німеччина, Словаччина, Угорщина й Франція вимагають ще
            й адресу реєстрації отримувача. */}
        {regRequired(v.countryCode) ? (
          <fieldset className="addr-reg">
            <legend>{t('addr.reg')}</legend>
            <p className="field__hint">{t('addr.regHint')}</p>
            <div className="form-row">
              <div className="field">
                <label htmlFor={at('RegCity')}>{t('addr.intlCity')}</label>
                <input
                  id={at('RegCity')}
                  className={invalid === 'regCity' ? 'is-invalid' : undefined}
                  maxLength={100}
                  value={v.regCity}
                  onChange={(e) => set({ regCity: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={at('RegZip')}>{t('addr.zip')}</label>
                <input
                  id={at('RegZip')}
                  className={invalid === 'regZip' ? 'is-invalid' : undefined}
                  placeholder={zipHint(v.countryCode)}
                  maxLength={10}
                  value={v.regZip}
                  onChange={(e) => set({ regZip: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row form-row--street">
              <div className="field">
                <label htmlFor={at('RegStreet')}>{t('addr.street')}</label>
                <input
                  id={at('RegStreet')}
                  className={invalid === 'regStreet' ? 'is-invalid' : undefined}
                  maxLength={100}
                  value={v.regStreet}
                  onChange={(e) => set({ regStreet: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={at('RegBuilding')}>{t('addr.building')}</label>
                <input
                  id={at('RegBuilding')}
                  className={invalid === 'regBuilding' ? 'is-invalid' : undefined}
                  maxLength={100}
                  value={v.regBuilding}
                  onChange={(e) => set({ regBuilding: e.target.value })}
                />
              </div>
            </div>
          </fieldset>
        ) : null}

      </div>
    </div>
  );
}
