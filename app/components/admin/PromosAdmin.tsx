'use client';

import { useEffect, useMemo, useState } from 'react';
import PublishControl from './PublishControl';
import SettingsDialog from './SettingsDialog';
import PromoCard from './PromoCard';
import PromoEditor from './PromoEditor';
import { useAdminUser } from './AdminGate';
import { useAsk } from './AskProvider';
import { useToast } from '../Toasts';
import { copyText } from '@/lib/copy';
import { db } from '@/lib/firebase';
import { watchDraft, EMPTY_DRAFT, type Draft } from '@/lib/admin/store';
import { watchOrders, type Doc } from '@/lib/admin/live';
import {
  planPromoSave,
  promoState,
  promoScopeText,
  promoUsed,
  promoValueText,
  promosErrorText,
  savePromo,
  watchPromos,
  type PromoOrder
} from '@/lib/admin/promos';
import { doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { sendPromoLetter } from '@/lib/notify';
import { loadNotifySettings } from '@/lib/firebase';
import { promoTerms } from '@/lib/promo';
import { t } from '@/lib/i18n';
import type { Promo } from '@/lib/promo';

/* ============================================================
   Промокоди
   ------------------------------------------------------------
   Скільки разів кодом скористались, рахується не з поля usedCount,
   а з самих замовлень: лічильник збільшує браузер покупця, і
   довіряти йому як єдиному джерелу не можна.
   ============================================================ */

export default function PromosAdmin() {
  const user = useAdminUser();
  const ask = useAsk();
  const toast = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [promos, setPromos] = useState<Promo[]>([]);
  const [orders, setOrders] = useState<PromoOrder[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<{ promo: Promo | null } | null>(null);
  const [error, setError] = useState('');

  useEffect(
    () =>
      watchPromos(
        setPromos,
        (e) => setError(promosErrorText(e))
      ),
    []
  );
  useEffect(() => watchOrders((list) => setOrders(list as unknown as PromoOrder[])), []);
  useEffect(() => watchDraft(setDraft), []);

  const view = useMemo(
    () =>
      promos.map((p) => ({
        p,
        state: promoState(p, promos, orders),
        used: promoUsed(p.code ?? '', promos, orders)
      })),
    [promos, orders]
  );

  const live = view.filter((x) => x.state.cls === 'is-on').length;
  const uses = view.reduce((s, x) => s + x.used, 0);

  function need() {
    const d = db();
    if (!d) toast('Немає звʼязку з базою');
    return d;
  }

  async function onSave(form: Promo) {
    const d = need();
    if (!d) return;
    const res = planPromoSave({
      promo: form,
      promos,
      editingCode: editing?.promo?.code ?? null,
      userEmail: user.email
    });
    if (!res.ok) {
      toast(res.message);
      return;
    }
    try {
      await savePromo(d, res.plan);
      setEditing(null);
      toast('Промокод збережено ✓', 'success');
    } catch {
      toast('Не вдалося зберегти — перевірте права доступу');
    }
  }

  return (
    <>
      <PublishControl user={user} onSettings={() => setSettingsOpen(true)} />

      {/* Розкладка сторінки — та сама, що в admin.html: .admin-wrap
          це дві колонки каталогу з бічним списком категорій, і
          сторінці промокодів вона не підходить. */}
      <div className="a-page">
        <div className="a-page__head a-page__head--row">
          <div>
            <h2>Промокоди</h2>
            <p>
              Знижки для клієнтів: на весь кошик, на окремі категорії або конкретні товари.
              Покупець вводить код у кошику й одразу бачить суму знижки.
            </p>
          </div>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => setEditing({ promo: null })}
          >
            + Новий промокод
          </button>
        </div>

        <div className="a-orders a-orders--page">
          <div className="ao-stats">
            <div className="ao-stat">
              <b>{promos.length}</b>
              <span>усього промокодів</span>
            </div>
            <div className="ao-stat">
              <b>{live}</b>
              <span>діють зараз</span>
            </div>
            <div className="ao-stat">
              <b>{uses}</b>
              <span>використань</span>
            </div>
          </div>

          {error ? <p className="ao-note">{error}</p> : null}

          <div className="ao-list">
          {!promos.length && !error ? (
            <div className="a-empty">
              Промокодів ще немає. Натисніть «+ Новий промокод», щоб створити першу знижку.
            </div>
          ) : (
            view.map(({ p, state, used }) => (
              <PromoCard
                key={p.code}
                p={p as never}
                view={{
                  cls: state.cls,
                  label: state.label,
                  value: promoValueText(p),
                  scope: promoScopeText(p, draft.categories, draft.products),
                  used
                }}
                onEdit={() => setEditing({ promo: p })}
                onToggle={async () => {
                  const d = need();
                  if (!d) return;
                  try {
                    await updateDoc(doc(d, 'promos', p.code ?? ''), { active: p.active === false });
                  } catch {
                    toast('Не вдалося змінити стан');
                  }
                }}
                onCopy={async () => {
                  const done = await copyText(p.code ?? '');
                  toast(done ? 'Скопійовано ✓' : 'Не вдалося скопіювати', done ? 'success' : 'plain');
                }}
                onMail={
                  p.email
                    ? async () => {
                        const settings = await loadNotifySettings();
                        const res = await sendPromoLetter(settings as { workerUrl?: string } | null, {
                          to: p.email ?? '',
                          code: p.code ?? '',
                          value: promoValueText(p),
                          terms: promoTerms(p, {
                            t,
                            categoryTitle: (id) =>
                              draft.categories.find((x) => x.id === id)?.title ?? id,
                            productName: (id) =>
                              draft.products.find((x) => x.id === id)?.name ?? id
                          })
                        });
                        toast(
                          res.ok
                            ? `Лист із промокодом надіслано на ${p.email} ✓`
                            : 'Не вдалося надіслати: ' + res.error,
                          res.ok ? 'success' : 'plain'
                        );
                      }
                    : undefined
                }
                onDelete={async () => {
                  const yes = await ask({
                    title: 'Видалити промокод?',
                    text:
                      `«${p.code}» зникне назавжди.\n\n` +
                      'Замовлення, у яких він уже застосований, не зміняться.',
                    okText: 'Видалити',
                    danger: true
                  });
                  if (yes !== true) return;
                  const d = need();
                  if (!d) return;
                  try {
                    await deleteDoc(doc(d, 'promos', p.code ?? ''));
                  } catch {
                    toast('Не вдалося видалити');
                  }
                }}
              />
            ))
          )}
          </div>
        </div>
      </div>

      <PromoEditor
        open={!!editing}
        promo={editing?.promo ?? null}
        categories={draft.categories}
        products={draft.products}
        userEmail={user.email ?? ''}
        onClose={() => setEditing(null)}
        onSave={(f) => void onSave(f)}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user.email ?? ''}
      />
    </>
  );
}
