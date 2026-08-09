'use client';

import { useEffect, useMemo, useState } from 'react';
import { uah } from '@/lib/catalog';
import { promoMessage, type Promo, type PromoScope, type PromoType } from '@/lib/promo';
import { pcCollect, pcPreview, promoForm, type PromoForm } from '@/lib/admin/promos';
import { t } from '@/lib/i18n';
import type { Category, Product } from '@/lib/types';

/* ============================================================
   Редактор промокоду
   ------------------------------------------------------------
   Приклад унизу рахується на живому каталозі-чернетці: адмін
   бачить, що код зробить насправді, а не на вигаданих товарах.

   Розмітка й класи ті самі, що в старій панелі.
   ============================================================ */

export default function PromoEditor({
  open,
  promo,
  categories,
  products,
  userEmail,
  onClose,
  onSave
}: {
  open: boolean;
  promo: Promo | null;
  categories: Category[];
  products: Product[];
  userEmail: string;
  onClose(): void;
  onSave(p: Promo): void;
}) {
  const [f, setF] = useState<PromoForm>(() => promoForm(null));
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) setF(promoForm(promo));
  }, [open, promo]);

  const set = <K extends keyof PromoForm>(k: K, v: PromoForm[K]) => setF((x) => ({ ...x, [k]: v }));

  const collected = useMemo(() => pcCollect(f, categories), [f, categories]);
  const preview = useMemo(
    () => pcPreview(collected, products, new Date(), userEmail),
    [collected, products, userEmail]
  );

  const shownProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => !q || (p.name + ' ' + p.id).toLowerCase().includes(q));
  }, [products, search]);

  if (!open) return null;

  return (
    <div className="a-modal" role="dialog" aria-modal="true">
      <div className="a-modal__backdrop" onClick={onClose} />
      <div className="a-modal__panel">
        <header className="a-modal__head">
          <h3>{promo ? 'Промокод ' + promo.code : 'Новий промокод'}</h3>
          <button className="a-modal__close" type="button" aria-label="Закрити" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="a-editor">
          <form className="a-form" noValidate onSubmit={(e) => e.preventDefault()}>
            <div className="a-grid-2">
              <div className="field">
                <label htmlFor="pcCode">Код *</label>
                <input
                  id="pcCode"
                  autoComplete="off"
                  placeholder="SUMMER10"
                  /* Код — це id документа: у наявного його не
                     міняємо, інакше зʼявився б другий, а старий
                     лишився б жити з тим самим лічильником */
                  disabled={!!promo}
                  value={f.code}
                  onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s+/g, ''))}
                />
                <span className="field__hint">3–24 символи: латиниця, цифри, дефіс</span>
              </div>

              <div className="a-grid-2">
                <div className="field">
                  <label htmlFor="pcType">Тип</label>
                  <select
                    id="pcType"
                    value={f.type}
                    onChange={(e) => set('type', e.target.value as PromoType)}
                  >
                    <option value="percent">Відсоток</option>
                    <option value="fixed">Сума, грн</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="pcValue">Знижка *</label>
                  <input
                    id="pcValue"
                    type="number"
                    min="0"
                    value={f.value}
                    onChange={(e) => set('value', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="field">
              <label htmlFor="pcScope">На що діє</label>
              <select
                id="pcScope"
                value={f.scope}
                onChange={(e) => set('scope', e.target.value as PromoScope)}
              >
                <option value="all">Весь кошик</option>
                <option value="categories">Обрані категорії</option>
                <option value="products">Обрані товари</option>
              </select>
            </div>

            {f.scope === 'categories' ? (
              <div className="field">
                <span className="field__label">Категорії</span>
                <div className="a-sizes">
                  {categories.map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={f.categories.includes(c.id)}
                        onChange={(e) =>
                          set(
                            'categories',
                            e.target.checked
                              ? [...f.categories, c.id]
                              : f.categories.filter((x) => x !== c.id)
                          )
                        }
                      />{' '}
                      {c.title}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {f.scope === 'products' ? (
              <div className="field">
                <span className="field__label">Товари ({f.products.length})</span>
                <input
                  placeholder="пошук за назвою або артикулом"
                  autoComplete="off"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="a-pclist">
                  {shownProducts.map((p) => (
                    <label className="a-check" key={p.id}>
                      <input
                        type="checkbox"
                        checked={f.products.includes(p.id)}
                        onChange={(e) =>
                          set(
                            'products',
                            e.target.checked
                              ? [...f.products, p.id]
                              : f.products.filter((x) => x !== p.id)
                          )
                        }
                      />{' '}
                      {p.name} · {p.id}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="a-grid-2">
              <div className="field">
                <label htmlFor="pcMin">Мінімальна сума, грн</label>
                <input
                  id="pcMin"
                  type="number"
                  min="0"
                  placeholder="—"
                  value={f.minTotal}
                  onChange={(e) => set('minTotal', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="pcLimit">Ліміт використань</label>
                <input
                  id="pcLimit"
                  type="number"
                  min="0"
                  placeholder="без ліміту"
                  value={f.usageLimit}
                  onChange={(e) => set('usageLimit', e.target.value)}
                />
              </div>
            </div>

            <div className="a-grid-2">
              <div className="field">
                <label htmlFor="pcFrom">Діє з</label>
                <input
                  id="pcFrom"
                  type="date"
                  value={f.startsAt}
                  onChange={(e) => set('startsAt', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="pcTo">Діє до</label>
                <input
                  id="pcTo"
                  type="date"
                  value={f.endsAt}
                  onChange={(e) => set('endsAt', e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="pcEmail">Персональний — лише для цієї пошти</label>
              <input
                id="pcEmail"
                type="email"
                placeholder="необовʼязково"
                autoComplete="off"
                value={f.email}
                onChange={(e) => set('email', e.target.value.trim().toLowerCase())}
              />
              <span className="field__hint">
                Такий код прочитає лише власник цієї пошти — правила бази не дають його стороннім.
              </span>
            </div>

            <div className="a-grid-2">
              <label className="a-check">
                <input
                  type="checkbox"
                  checked={f.excludeSale}
                  onChange={(e) => set('excludeSale', e.target.checked)}
                />{' '}
                Не діє на SALE-товари
              </label>
              <label className="a-check">
                <input
                  type="checkbox"
                  checked={f.active}
                  onChange={(e) => set('active', e.target.checked)}
                />{' '}
                Увімкнений
              </label>
            </div>

            <div className="field">
              <label htmlFor="pcNote">Нотатка для себе</label>
              <input
                id="pcNote"
                autoComplete="off"
                placeholder="напр.: для блогерки з Instagram"
                value={f.note}
                onChange={(e) => set('note', e.target.value)}
              />
            </div>
          </form>

          <aside className="a-preview">
            <h4>Приклад на живому каталозі</h4>
            {!preview ? (
              <p className="ao-note">Вкажіть розмір знижки — і тут зʼявиться приклад.</p>
            ) : (
              <div className="a-pcpreview">
                <p className="ao-muted">{preview.items.join(', ') || '—'}</p>
                <div className="ao-sumline">
                  <span>Товари</span>
                  <span>{uah(preview.sum)}</span>
                </div>
                {preview.ok ? (
                  <>
                    <div className="ao-sumline is-off">
                      <span>Знижка</span>
                      <span>−{uah(preview.discount)}</span>
                    </div>
                    <div className="ao-sumline is-total">
                      <span>До сплати</span>
                      <span>{uah(preview.total)}</span>
                    </div>
                  </>
                ) : (
                  <p className="ao-note">{promoMessage(preview.result, collected, { t })}</p>
                )}
              </div>
            )}
          </aside>
        </div>

        <footer className="a-modal__foot">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn btn--primary" type="button" onClick={() => onSave(collected)}>
            Зберегти промокод
          </button>
        </footer>
      </div>
    </div>
  );
}
