'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from './CartProvider';
import AddressFields from './AddressFields';
import PromoField from './PromoField';
import * as cart from '@/lib/cart';
import * as fb from '@/lib/firebase';
import { catTitle, getProduct, uah } from '@/lib/catalog';
import {
  EMPTY_FORM,
  checkAddress,
  createAddrBook,
  fromForm,
  toForm,
  type AddressForm
} from '@/lib/address';
import { buildOrder, checkCustomer, MESSENGERS, type Confirm, type Customer } from '@/lib/order';
import { orderPlaced } from '@/lib/notify';
import { t } from '@/lib/i18n';
import type { Promo } from '@/lib/promo';

/* ============================================================
   Оформлення замовлення
   ------------------------------------------------------------
   Сторінка, а не крок у панелі кошика: на неї можна повернутись
   назад, кинути посилання й побачити її в історії браузера.

   Порядок дій при відправці той самий, що й був, і саме в такому
   порядку: перевірити поля → перечитати промокод із бази →
   перевірити адресу → зберегти профіль → створити замовлення.
   ============================================================ */

const EMPTY_CONFIRM: Confirm = {
  method: 'call',
  messenger: 'telegram',
  phoneMode: 'main',
  altPhone: ''
};

export default function CheckoutForm() {
  const { c, lines, subtotal, clear } = useCart();
  const router = useRouter();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(EMPTY_CONFIRM);
  const [tg, setTg] = useState('');
  const [addr, setAddr] = useState<AddressForm>(EMPTY_FORM);
  const [saveAddr, setSaveAddr] = useState(true);

  const [promo, setPromo] = useState<Promo | null>(null);
  const [discount, setDiscount] = useState(0);

  const [bad, setBad] = useState<{ field: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  /* Профіль підставляємо після монтування: на сервері його немає,
     і поля, заповнені одразу, розійшлися б із розміткою */
  useEffect(() => {
    const p = cart.getProfile();
    setName(String(p.name || ''));
    setPhone(String(p.phone || ''));
    setEmail(String(p.email || ''));
    setAddr(toForm(p));
    const saved = p.confirm as Confirm | undefined;
    if (saved) {
      setConfirm({ ...EMPTY_CONFIRM, ...saved });
      setTg(String(saved.telegram || ''));
    }
  }, []);

  /* Пошту залогіненого покупця підставляємо, якщо в профілі
     її ще немає — питати те, що ми вже знаємо, зайве */
  useEffect(
    () =>
      fb.watchAuth((u) => {
        if (u?.email) setEmail((v) => v || u.email || '');
      }),
    []
  );

  const total = Math.max(0, subtotal - discount);

  const canSubmit = lines.length > 0 && !sending;

  async function submit() {
    if (!canSubmit) return;
    setBad(null);

    const who = checkCustomer({ name, phone, email });
    if (who) {
      setBad({ field: who.field, text: t(who.key) });
      const map = { name: nameRef, phone: phoneRef, email: emailRef };
      map[who.field].current?.focus();
      return;
    }

    setSending(true);
    try {
      /* Промокод перечитуємо з бази саме зараз: між застосуванням
         і натисканням «Підтвердити» його могли вимкнути, вичерпати
         або він міг протермінуватись. Інакше замовлення пішло б
         зі знижкою, яку база вже не визнає. */
      let code = '';
      let off = 0;
      if (promo) {
        const { promoCheck, promoMessage, promoSaveCode } = await import('@/lib/promo');
        const who = fb.auth()?.currentUser?.email ?? '';
        const fresh = (await fb.promoFetch(promo.code ?? '')) as Promo | null;
        // пошту передаємо й тут: без неї персональний код власника
        // не пройшов би останню перевірку, хоч щойно був прийнятий
        const res = promoCheck(fresh, cart.forPromo(c), null, who);
        if (!res.ok) {
          setPromo(null);
          setDiscount(0);
          promoSaveCode('');
          setBad({
            field: 'promo',
            text: promoMessage(res, fresh, {
              t,
              categoryTitle: (id) => catTitle(c, id),
              productName: (id) => c.products.find((x) => x.id === id)?.name ?? '',
              guest: !who
            })
          });
          return;
        }
        code = promo.code ?? '';
        off = res.discount ?? 0;
        setDiscount(off);
      }

      const problem = checkAddress(addr);
      if (problem) {
        setBad({ field: problem.field, text: t(problem.key) });
        return;
      }

      const customer: Customer = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        ...fromForm(addr),
        comment: comment.trim(),
        confirm: {
          ...confirm,
          messenger: confirm.method === 'messenger' ? confirm.messenger : '',
          altPhone: confirm.phoneMode === 'other' ? confirm.altPhone.trim() : '',
          ...(confirm.messenger === 'telegram' && tg.trim()
            ? { telegram: tg.trim().replace(/^@+/, '') }
            : {})
        }
      };

      /* Профіль запамʼятовуємо мерджем: у ньому лежить адресна
         книга, і перезапис обʼєктом покупця стер би її */
      cart.saveProfile({ ...cart.getProfile(), ...customer, comment: '' });

      if (saveAddr) {
        const book = createAddrBook({
          get: () => cart.getProfile(),
          save: (p) => cart.saveProfile(p)
        });
        // перша збережена адреса стає адресою за замовчуванням
        book.save(fromForm(addr), { makeDefault: !book.list().length });
      }

      const order = buildOrder({
        c,
        lines,
        customer,
        subtotal,
        discount: off,
        promoCode: code,
        now: new Date(),
        t
      });

      /* Спершу база — це єдине, що не можна втратити. Решта
         (лист, Telegram, лічильник промокоду) вже необовʼязкова:
         замовлення видно в адмінці й без них. */
      const id = await fb.createOrder(order as unknown as Record<string, unknown>);

      const saved = cart.getOrders();
      saved.unshift({ ...order, _id: id } as never);
      cart.saveOrders(saved.slice(0, 50));

      if (code) void fb.promoConsume(code);
      void fb
        .loadNotifySettings()
        .then((s) => orderPlaced(s as { workerUrl?: string } | null, order, 'uk', t));

      clear();
      const { promoSaveCode } = await import('@/lib/promo');
      promoSaveCode('');

      // Номер потрібен на сторінці подяки, а стан між сторінками
      // не переживе перезавантаження — передаємо адресою
      router.push(`/thanks?num=${encodeURIComponent(order.num)}`);
    } finally {
      setSending(false);
    }
  }

  const summary = useMemo(
    () =>
      lines.map((i) => ({
        key: i.idx,
        name: i.p.name,
        size: i.size,
        qty: i.qty,
        sum: i.sum,
        cat: catTitle(c, i.p.category),
        parts: (i.parts || []).map((x) => {
          const sp = getProduct(c, x.id);
          return [catTitle(c, sp?.category), sp?.name ?? x.id, x.size].filter(Boolean).join(' · ');
        })
      })),
    [lines, c]
  );

  if (!lines.length) {
    return (
      <div className="empty-state">
        <strong>{t('cart.empty')}</strong>
        {t('cart.emptyNote')}
        <Link className="btn btn--primary" href="/#catalog">
          {t('cart.goCatalog')}
        </Link>
      </div>
    );
  }

  return (
    <div className="checkout">
      <h1 className="section-title">{t('cart.checkout')}</h1>

      <div className="checkout-summary">
        {summary.map((i) => (
          <div key={i.key}>
            <span>
              {i.name}
              {i.size ? ` (${i.size})` : ''} × {i.qty}
              {i.cat ? <em className="checkout-parts">{i.cat}</em> : null}
              {i.parts.length ? <em className="checkout-parts">{i.parts.join(' · ')}</em> : null}
            </span>
            <span>{uah(i.sum)}</span>
          </div>
        ))}

        {discount ? (
          <>
            <div>
              <span>{t('cart.subtotal')}</span>
              <span>{uah(subtotal)}</span>
            </div>
            <div className="is-off">
              <span>{t('cart.discount')} · {promo?.code}</span>
              <span>−{uah(discount)}</span>
            </div>
          </>
        ) : null}

        <div className="sum">
          <span>{t('cart.total')}</span>
          <span>{uah(total)}</span>
        </div>
      </div>

      <PromoField
        c={c}
        onChange={(p, off) => {
          setPromo(p);
          setDiscount(off);
        }}
      />

      <form
        className="form-grid"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="coName">{t('cart.name')}</label>
          <input
            id="coName"
            ref={nameRef}
            className={bad?.field === 'name' ? 'is-invalid' : undefined}
            autoComplete="name"
            placeholder={t('cart.namePh')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="coPhone">{t('cart.phone')}</label>
          <input
            id="coPhone"
            ref={phoneRef}
            className={bad?.field === 'phone' ? 'is-invalid' : undefined}
            type="tel"
            autoComplete="tel"
            placeholder="+380..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="coEmail">{t('cart.email')}</label>
          <input
            id="coEmail"
            ref={emailRef}
            className={bad?.field === 'email' ? 'is-invalid' : undefined}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <AddressFields
          v={addr}
          set={(patch) => setAddr((a) => ({ ...a, ...patch }))}
          invalid={
            bad && bad.field in EMPTY_FORM ? (bad.field as keyof AddressForm) : null
          }
        />

        <label className="checkout-savepick">
          <input
            type="checkbox"
            checked={saveAddr}
            onChange={(e) => setSaveAddr(e.target.checked)}
          />{' '}
          {t('adr.saveToProfile')}
        </label>

        {/* Як підтвердити замовлення. Дзвінок беруть не всі —
            месенджер тут не примха, а спосіб взагалі дочекатись
            відповіді */}
        <div className="field co-confirm">
          <label>{t('cart.confirmTitle')}</label>

          <div className="ochips">
            <label className="ochip">
              <input
                type="radio"
                name="co-method"
                checked={confirm.method === 'call'}
                onChange={() => setConfirm((v) => ({ ...v, method: 'call' }))}
              />
              <span>{t('cart.byCall')}</span>
            </label>
            <label className="ochip">
              <input
                type="radio"
                name="co-method"
                checked={confirm.method === 'messenger'}
                onChange={() => setConfirm((v) => ({ ...v, method: 'messenger' }))}
              />
              <span>{t('cart.byMessenger')}</span>
            </label>
          </div>

          <div className="co-confirm__part" hidden={confirm.method !== 'messenger'}>
            <span className="co-confirm__label">{t('cart.whichMessenger')}</span>
            <div className="ochips">
              {MESSENGERS.map((m) => (
                <label className={'ochip ochip--' + m.id} key={m.id}>
                  <input
                    type="radio"
                    name="co-messenger"
                    checked={confirm.messenger === m.id}
                    onChange={() => setConfirm((v) => ({ ...v, messenger: m.id }))}
                  />
                  <span>{m.title}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="co-confirm__part">
            <span className="co-confirm__label">{t('cart.contactPhone')}</span>
            <div className="ochips">
              <label className="ochip">
                <input
                  type="radio"
                  name="co-phone-mode"
                  checked={confirm.phoneMode === 'main'}
                  onChange={() => setConfirm((v) => ({ ...v, phoneMode: 'main' }))}
                />
                <span>{t('cart.samePhone')}</span>
              </label>
              <label className="ochip">
                <input
                  type="radio"
                  name="co-phone-mode"
                  checked={confirm.phoneMode === 'other'}
                  onChange={() => setConfirm((v) => ({ ...v, phoneMode: 'other' }))}
                />
                <span>{t('cart.otherPhone')}</span>
              </label>
            </div>
            <input
              type="tel"
              inputMode="tel"
              placeholder="+380..."
              hidden={confirm.phoneMode !== 'other'}
              value={confirm.altPhone}
              onChange={(e) => setConfirm((v) => ({ ...v, altPhone: e.target.value }))}
            />
          </div>

          {/* Логін питаємо лише для Telegram: якщо номер прихований
              налаштуваннями, без нього ми покупця не знайдемо */}
          <div
            className="co-confirm__part"
            hidden={!(confirm.method === 'messenger' && confirm.messenger === 'telegram')}
          >
            <span className="co-confirm__label">{t('cart.tgLogin')}</span>
            <input
              placeholder="@username"
              autoComplete="off"
              spellCheck={false}
              value={tg}
              onChange={(e) => setTg(e.target.value)}
            />
            <p className="co-confirm__hint">{t('cart.tgHint')}</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="coComment">{t('cart.comment')}</label>
          <textarea
            id="coComment"
            placeholder={t('cart.commentPh')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        {bad ? (
          <p className="promo__hint is-err" role="alert">
            {bad.text}
          </p>
        ) : null}

        <button className="btn btn--primary btn--order" type="submit" disabled={!canSubmit}>
          {sending ? t('cart.sending') : t('cart.submit')}
        </button>
        <p className="pinfo__order-note">{t('cart.submitNote')}</p>
      </form>
    </div>
  );
}
