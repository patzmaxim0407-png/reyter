'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ColorPicker from './ColorPicker';
import { ALL_SIZES, NOTES } from '@/lib/catalog';
import {
  adminColors,
  inCat,
  lines,
  normalizeHex,
  packColors,
  pickedSet,
  planProductSave,
  slugify,
  type CheckField
} from '@/lib/admin/draft';
import type { Category, Color, NoteId, Product } from '@/lib/types';

/* ============================================================
   Редактор товару
   ------------------------------------------------------------
   Розмітка й класи ті самі, що в admin.html, тож admin.css
   підходить без правок.

   Форма тримає власний стан і нічого не пише сама: збереження
   рахує planProductSave, а записує сторінка. Так перевірки
   лишаються там, де їх можна прогнати без браузера.
   ============================================================ */

/** Порожня картка нового товару. */
function blank(categories: Category[]): Product {
  return {
    id: '',
    name: '',
    price: 0,
    category: categories[0]?.id ?? '',
    images: [],
    sizes: []
  };
}

export interface EditorSave {
  product: Product;
  isSetOn: boolean;
  setRows: string[];
}

export default function ProductEditor({
  open,
  product,
  categories,
  products,
  onClose,
  onSave,
  onUpload,
  busy,
  uploadStatus
}: {
  open: boolean;
  /** null — новий товар. */
  product: Product | null;
  categories: Category[];
  products: Product[];
  onClose(): void;
  onSave(v: EditorSave): void;
  onUpload(files: FileList, article: string, startAt: number): Promise<string[]>;
  busy?: boolean;
  uploadStatus?: string;
}) {
  const [p, setP] = useState<Product>(() => product ?? blank(categories));
  const [isSetOn, setIsSetOn] = useState(false);
  const [setRows, setSetRows] = useState<string[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [notes, setNotes] = useState('');
  const [chars, setChars] = useState('');
  const [care, setCare] = useState('');
  /* Які з трьох приміток товар ховає. Порожньо — показує всі. */
  const [noteOff, setNoteOff] = useState<NoteId[]>([]);
  const [lowStock, setLowStock] = useState('');
  const [bad, setBad] = useState<{ field: CheckField; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* Заповнюємо форму при кожному ВІДКРИТТІ — і лише при ньому.
     Це не дрібниця в списку залежностей, а те, через що набране
     зникало.

     Каталог приходить живою підпискою, і кожен її кадр створює
     НОВІ обʼєкти: інший product, інший масив categories. Доки
     вони стояли в залежностях, будь-яка зміна каталогу — свій
     же запис, оприбуткований прихід, який переписує собівартість,
     робота другого адміністратора — переписувала форму заново,
     затираючи все, чого ще не зберегли.

     Найчастіше під це потрапляла саме собівартість: її вписують
     останньою, і вона встигала прожити найменше. Виглядало це
     так, наче поле взагалі не приймає числа.

     Тому стежимо за артикулом, а не за обʼєктом: відкрили іншу
     картку — форма заповнилась, оновився каталог — ні. */
  const productRef = useRef(product);
  productRef.current = product;
  const catsRef = useRef(categories);
  catsRef.current = categories;

  useEffect(() => {
    if (!open) return;
    const src = productRef.current ?? blank(catsRef.current);
    setP(src);
    setIsSetOn(!!src.set?.length);
    setSetRows(src.set ?? []);
    setColors(adminColors(src));
    setNotes((src.notes ?? []).join('\n'));
    setChars((src.characteristics ?? []).join('\n'));
    setCare((src.care ?? []).join('\n'));
    setNoteOff(src.noteOff ?? []);
    setLowStock((src.lowStock ?? []).join(', '));
    setBad(null);
  }, [open, product?.id]);

  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP((x) => ({ ...x, [k]: v }));

  /* Складники обираємо лише серед НЕ-комплектів: комплект
     усередині комплекту — це рекурсія, яку нічим не порахувати */
  const setChoices = useMemo(
    () => products.filter((x) => !x.set?.length && x.id !== p.id),
    [products, p.id]
  );

  /* Привʼязка кольору веде на картку того самого товару в іншому
     відтінку. Кандидата шукаємо за БУДЬ-ЯКОЮ його категорією:
     товар, для якого ця категорія додаткова, теж належить родині,
     а за головною він би зі списку зник. */
  const colorChoices = useMemo(
    () => products.filter((x) => x.id !== p.id && inCat(x, p.category)),
    [products, p.category, p.id]
  );

  if (!open) return null;

  function collect(): EditorSave {
    return {
      product: {
        ...p,
        name: p.name.trim(),
        price: Number(p.price) || 0,
        colors: packColors(colors),
        notes: lines(notes),
        characteristics: lines(chars),
        care: lines(care),
        /* Порожньо — undefined, а не порожній масив: у документі
           не має зʼявлятись поле, яке нічого не означає. */
        noteOff: noteOff.length ? noteOff : undefined,
        lowStock: lowStock
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
        /* Розміри лишаємо, навіть коли ввімкнено «комплект»:
           сайт їх у комплекта все одно не читає, а збереження
           перезаписує документ цілком — порожній масив стер би
           сітку назавжди, і зняти галочку вже не допомогло б. */
        sizes: p.sizes ?? [],
        /* Порожні рядки прибираємо, повтори зливаємо. Сирі рядки
           їдуть окремо: саме за різницею довжин планувальник
           помічає, що товар додали двічі, — інакше склад мовчки
           вийшов би коротшим за задуманий. */
        set: isSetOn ? pickedSet(setRows) : undefined
      },
      isSetOn,
      setRows
    };
  }

  function save() {
    const v = collect();
    const res = planProductSave({
      product: v.product,
      products,
      editingId: product?.id ?? null,
      isSetOn: v.isSetOn,
      setRows: v.setRows
    });
    if (!res.ok) {
      setBad({ field: res.field, message: res.message });
      document.getElementById('f' + res.field.charAt(0).toUpperCase() + res.field.slice(1))?.focus();
      return;
    }
    setBad(null);
    onSave(v);
  }

  const invalid = (f: CheckField) => (bad?.field === f ? 'is-invalid' : undefined);


  /* Значок на картці рівно один: «Продано» переважує «Sale» —
     знижка на те, чого немає, покупцеві ні до чого. */
  const badges: [string, string][] =
    p.status === 'sold-out'
      ? [['badge--sold', 'Продано']]
      : p.sale
        ? [['badge--sale', 'Sale']]
        : [];

  return (
    <div className="a-modal" role="dialog" aria-modal="true">
      <div className="a-modal__backdrop" onClick={onClose} />
      <div className="a-modal__panel">
        <header className="a-modal__head">
          <h3>{product ? 'Товар' : 'Новий товар'}</h3>
          <button className="a-modal__close" type="button" aria-label="Закрити" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="a-editor">
          <form className="a-form" noValidate onSubmit={(e) => e.preventDefault()}>
            <div className="a-grid-2">
              <div className="field">
                <label htmlFor="fId">Артикул *</label>
                <input
                  id="fId"
                  className={invalid('id')}
                  placeholder="ABC-001"
                  autoComplete="off"
                  value={p.id}
                  /* Регістр не чіпаємо: у наявного товару з малими
                     літерами будь-яка правка виглядала б для
                     planProductSave як перейменування артикулу —
                     зі зміною id документа й правкою комплектів */
                  onChange={(e) => set('id', e.target.value.trim())}
                />
              </div>
              <div className="field">
                <label htmlFor="fCategory">Головна категорія *</label>
                <select
                  id="fCategory"
                  className={invalid('category')}
                  value={p.category}
                  onChange={(e) => set('category', e.target.value)}
                >
                  {categories.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>Показувати також у</label>
              <div className="a-sizes">
                {categories
                  .filter((c) => c.id !== p.category)
                  .map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={(p.categories ?? []).includes(c.id)}
                        onChange={(e) =>
                          set(
                            'categories',
                            e.target.checked
                              ? [...(p.categories ?? []), c.id]
                              : (p.categories ?? []).filter((x) => x !== c.id)
                          )
                        }
                      />{' '}
                      {c.title}
                    </label>
                  ))}
              </div>
              <p className="field__hint">
                Необовʼязково. Товар зʼявиться і в цих категоріях теж — зручно для добірок
                на кшталт «New drop». Склад і статистика рахуються за головною категорією.
              </p>
            </div>

            <div className="field">
              <label htmlFor="fName">Назва *</label>
              <input
                id="fName"
                className={invalid('name')}
                placeholder="Назва товару"
                autoComplete="off"
                value={p.name}
                onChange={(e) => set('name', e.target.value)}
                onBlur={() => {
                  // артикул придумується сам із назви — але лише
                  // новому товару: у наявного це поламало б посилання
                  if (!product && !p.id && p.name.trim()) {
                    set('id', slugify(p.name, categories));
                  }
                }}
              />
            </div>

            <div className="a-grid-3">
              <div className="field">
                <label htmlFor="fPrice">Ціна, грн *</label>
                <input
                  id="fPrice"
                  className={invalid('price')}
                  type="number"
                  min="0"
                  value={p.price || ''}
                  onChange={(e) => set('price', Number(e.target.value) || 0)}
                />
              </div>
              <div className="field">
                <label htmlFor="fOldPrice">Стара ціна, грн</label>
                <input
                  id="fOldPrice"
                  type="number"
                  min="0"
                  placeholder="—"
                  value={p.oldPrice || ''}
                  onChange={(e) => set('oldPrice', Number(e.target.value) || undefined)}
                />
              </div>
              <div className="field">
                <label htmlFor="fPriceUsd">Ціна, $</label>
                <input
                  id="fPriceUsd"
                  type="number"
                  min="0"
                  placeholder="—"
                  value={p.priceUsd || ''}
                  onChange={(e) => set('priceUsd', Number(e.target.value) || undefined)}
                />
              </div>
            </div>

            {/* ---------- Собівартість ----------
                Руками її тут більше не вписують, і це не обмеження
                заради обмеження.

                Собівартість живе партіями: прийшло десять пар по
                300, потім пʼять по 330 — і кожна наступна продажа
                бере ціну тієї партії, з якої йде товар. Число в
                картці — лише вершина цієї черги. Правка його
                руками нічого не міняла в самих партіях, зате тихо
                розходилась із ними: звіт рахував одне, а черга
                собівартості — інше, і зрозуміти, котре з двох
                правда, було вже нічим.

                Тому міняється вона там, де змінюється насправді:
                у приході (нова партія — нова ціна) або в
                калькуляторі випуску (де вона й народжується з
                рахунків за пошив, тканину та зйомку). */}
            <div className="a-grid-2">
              <div className="field">
                <span className="field__label">Собівартість</span>
                <p className="a-cost">
                  {p.cost ? (
                    <>
                      <b>{Math.round(p.cost).toLocaleString('uk')} грн</b>
                      {p.price ? (
                        <span>
                          маржа {Math.max(0, Math.round(p.price - p.cost)).toLocaleString('uk')} грн
                          {' · '}
                          {Math.round(((p.price - p.cost) / p.price) * 100)}%
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <b className="is-quiet">не вказана</b>
                      <span>без неї маржа й поради в аналітиці рахуються не для цього товару</span>
                    </>
                  )}
                </p>
                <p className="field__hint">
                  Задається приходом або калькулятором випуску — там, де вона й змінюється
                  насправді. У каталог на сайт не потрапляє. У виконаних замовленнях зафіксована
                  на момент продажу, тож звіти за минулі місяці від нової партії не змінюються.
                </p>
              </div>
            </div>

            <div className="a-grid-2">
              <div className="field">
                <label htmlFor="fStatus">Наявність</label>
                <select
                  id="fStatus"
                  value={p.status ?? 'in-stock'}
                  onChange={(e) => set('status', e.target.value as Product['status'])}
                >
                  <option value="in-stock">В наявності</option>
                  <option value="sold-out">Продано</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="fLowStock">Закінчується (розміри через кому)</label>
                <input
                  id="fLowStock"
                  placeholder="напр.: L або S, M"
                  autoComplete="off"
                  value={lowStock}
                  onChange={(e) => setLowStock(e.target.value)}
                />
              </div>
            </div>

            {/* Комплект власних розмірів не має — сітку ховаємо */}
            <div className="field" hidden={isSetOn}>
              <span className="field__label">Розміри в наявності</span>
              <div className="a-sizes">
                {ALL_SIZES.map((s) => (
                  <label key={s}>
                    <input
                      type="checkbox"
                      checked={(p.sizes ?? []).includes(s)}
                      onChange={(e) =>
                        set(
                          'sizes',
                          e.target.checked
                            ? ALL_SIZES.filter((x) => x === s || (p.sizes ?? []).includes(x))
                            : (p.sizes ?? []).filter((x) => x !== s)
                        )
                      }
                    />{' '}
                    {s}
                  </label>
                ))}
              </div>
            </div>

            <div className="field a-setfield">
              <label className="a-check">
                <input
                  type="checkbox"
                  checked={isSetOn}
                  onChange={(e) => setIsSetOn(e.target.checked)}
                />{' '}
                Це комплект із кількох товарів
              </label>

              <div hidden={!isSetOn}>
                <div className="a-setlist">
                  {setRows.map((id, i) => (
                    <div className="a-setitem" key={i}>
                      <select
                        className={invalid('set')}
                        value={id}
                        onChange={(e) =>
                          setSetRows((rows) => rows.map((x, k) => (k === i ? e.target.value : x)))
                        }
                      >
                        <option value="">— оберіть товар —</option>
                        {setChoices.map((x) => (
                          <option value={x.id} key={x.id}>
                            {x.name} · {x.id}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="a-color__del"
                        aria-label="Прибрати зі складу"
                        onClick={() => setSetRows((rows) => rows.filter((_, k) => k !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => setSetRows((rows) => [...rows, ''])}
                >
                  + Додати товар у комплект
                </button>
                <p className="field__hint">
                  Складники беруться з будь-яких категорій. Власних розмірів і залишків
                  комплект не має: покупець обирає розмір кожного складника окремо, а
                  кількість комплектів на складі рахується за найдефіцитнішим із них.
                </p>
              </div>
            </div>

            <div className="a-grid-2">
              <label className="a-check">
                <input
                  type="checkbox"
                  checked={!!p.sale}
                  onChange={(e) => set('sale', e.target.checked)}
                />{' '}
                Бейдж SALE
              </label>
              <label className="a-check">
                <input
                  type="checkbox"
                  checked={!!p.hidden}
                  onChange={(e) => set('hidden', e.target.checked)}
                />{' '}
                Сховати з сайту
              </label>
            </div>

            {/* Позначка й доступ — різні рішення, і тому це два
                окремі перемикачі. Товар може бути відкритий усім
                і при цьому помічений як клубний: це натяк, чого
                коштує вступити. */}
            <label className="a-check">
              <input
                type="checkbox"
                checked={!!p.friendlyMark}
                onChange={(e) => set('friendlyMark', e.target.checked)}
              />{' '}
              Позначка Friendly (видно всім)
            </label>
            <p className="field__hint">
              Товар лишається у відкритому каталозі, просто з клубною позначкою на картці.
              Доступу це не обмежує нічим.
            </p>

            <label className="a-check">
              <input
                type="checkbox"
                checked={!!p.friendly}
                onChange={(e) => set('friendly', e.target.checked)}
              />{' '}
              Тільки для Friendly Club
            </label>
            <p className="field__hint">
              А це вже доступ. Такий товар публікується <b>в окремий документ</b>, куди правила
              бази пускають лише учасників клубу: у відкритому каталозі його немає зовсім — ні в
              розмітці сторінок, ні в карті сайту, ні у відповіді для стороннього браузера. Хто не
              в клубі, той його не побачить і не купить: рахунок на такий товар банк теж не
              виставить. Позначку такий товар отримує сам, окремо вмикати не треба.
            </p>

            <div className="field">
              <label htmlFor="fSaleNote">Примітка до знижки</label>
              <input
                id="fSaleNote"
                placeholder="напр.: Економія 5% при покупці комплектом"
                autoComplete="off"
                value={p.saleNote ?? ''}
                onChange={(e) => set('saleNote', e.target.value)}
              />
            </div>

            <div className="a-grid-2">
              <div className="field">
                <label htmlFor="fFabric">Тканина</label>
                <input
                  id="fFabric"
                  placeholder="напр.: Кулір"
                  autoComplete="off"
                  value={p.fabric ?? ''}
                  onChange={(e) => set('fabric', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="fMaterial">Склад</label>
                <input
                  id="fMaterial"
                  placeholder="напр.: Бавовна 95%, еластан 5%"
                  autoComplete="off"
                  value={p.material ?? ''}
                  onChange={(e) => set('material', e.target.value)}
                />
              </div>
            </div>

            <div className="a-grid-2">
              <div className="field">
                <label htmlFor="fVolume">Обʼєм (для свічок)</label>
                <input
                  id="fVolume"
                  placeholder="напр.: 250 мл"
                  autoComplete="off"
                  value={p.volume ?? ''}
                  onChange={(e) => set('volume', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="fAroma">Аромат</label>
                <input
                  id="fAroma"
                  placeholder="напр.: Бренді & груша"
                  autoComplete="off"
                  value={p.aroma ?? ''}
                  onChange={(e) => set('aroma', e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="fModel">Параметри моделі</label>
              <input
                id="fModel"
                placeholder="напр.: 181 см, 96 кг, талія 86 см"
                autoComplete="off"
                value={p.model ?? ''}
                onChange={(e) => set('model', e.target.value)}
              />
            </div>

            <div className="field">
              <span className="field__label">Кольори</span>
              <div className="a-colors">
                {colors.map((c, i) => (
                  <div className="a-color" key={i}>
                    <input
                      type="color"
                      value={c.hex || '#014AAD'}
                      onChange={(e) =>
                        setColors((list) =>
                          list.map((x, k) =>
                            k === i ? { ...x, hex: normalizeHex(e.target.value) } : x
                          )
                        )
                      }
                    />
                    <ColorPicker
                      value={c.id}
                      choices={colorChoices}
                      emptyNote={`У категорії «${
                        categories.find((x) => x.id === p.category)?.title ?? p.category
                      }» немає інших товарів.`}
                      onPick={(id) => {
                        /* Підтягуємо відтінок самого товару: інакше
                           в родину кольорів поїхав би дефолтний
                           синій, і syncColorLinks рознесе його по
                           всіх картках. Немає кольорів — не чіпаємо. */
                        const target = products.find((x) => x.id === id);
                        const hex = target ? normalizeHex(adminColors(target)[0]?.hex ?? '') : '';
                        setColors((list) =>
                          list.map((x, k) => (k === i ? { ...x, id, hex: hex || x.hex } : x))
                        );
                      }}
                    />
                    <button
                      type="button"
                      className="a-color__del"
                      title="Прибрати колір"
                      aria-label="Прибрати колір"
                      onClick={() => setColors((list) => list.filter((_, k) => k !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => setColors((list) => [...list, { hex: '#014aad', id: '' }])}
              >
                + Колір
              </button>
            </div>

            <div className="field">
              <span className="field__label">Фото *</span>
              <div className={'a-photos ' + (invalid('images') ?? '')}>
                {p.images.map((src, i) => (
                  <div className="a-photo" key={src + i}>
                    <img src={src} alt="" loading="lazy" />
                    <div className="a-photo__tools">
                      <button
                        type="button"
                        aria-label="Лівіше"
                        disabled={i === 0}
                        onClick={() =>
                          set(
                            'images',
                            p.images.map((x, k) =>
                              k === i - 1 ? p.images[i] : k === i ? p.images[i - 1] : x
                            )
                          )
                        }
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        aria-label="Правіше"
                        disabled={i === p.images.length - 1}
                        onClick={() =>
                          set(
                            'images',
                            p.images.map((x, k) =>
                              k === i + 1 ? p.images[i] : k === i ? p.images[i + 1] : x
                            )
                          )
                        }
                      >
                        →
                      </button>
                      <button
                        type="button"
                        className="danger"
                        aria-label="Прибрати фото"
                        onClick={() => set('images', p.images.filter((_, k) => k !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="a-upload">
                <label className="btn btn--ghost btn--sm a-upload__btn">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    ref={fileRef}
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (!files?.length) return;
                      const urls = await onUpload(files, p.id, p.images.length);
                      if (urls.length) set('images', [...p.images, ...urls]);
                      if (fileRef.current) fileRef.current.value = '';
                    }}
                  />
                  ⬆ Завантажити фото
                </label>
                <span className="a-upload__status">{uploadStatus ?? ''}</span>
              </div>
              <p className="field__hint">
                Фото зберігаються у хмарному сховищі й самі стискаються у WebP. Перше —
                обкладинка картки, друге показується при наведенні; порядок міняється
                стрілками на мініатюрах.
              </p>
            </div>

            {/* Примітки під кнопкою «Додати в кошик». Три на весь
                магазин — тут вирішується, які з них показує саме
                цей товар. Прибирають зазвичай одну: «доставка
                БІЛИЗНИ безкоштовна» на свічці чи сорочці читається
                як обіцянка, якої ніхто не давав. */}
            <div className="field">
              <span className="field__label">Примітки в картці товару</span>
              <div className="a-sizes">
                {NOTES.map((n) => (
                  <label key={n.id}>
                    <input
                      type="checkbox"
                      checked={!noteOff.includes(n.id)}
                      onChange={(e) =>
                        setNoteOff((v) =>
                          e.target.checked ? v.filter((x) => x !== n.id) : [...v, n.id]
                        )
                      }
                    />{' '}
                    {n.title}
                  </label>
                ))}
              </div>
              <p className="field__hint">
                Три картки під кнопкою «Додати в кошик». Знята галочка ховає примітку саме в
                цього товару — на решті вона лишається. Сам текст і поріг безкоштовної доставки
                спільні для магазину й задаються в налаштуваннях.
              </p>
            </div>

            <div className="field">
              <label htmlFor="fNotes">Додаткові рядки опису (по одному в рядку)</label>
              <textarea
                id="fNotes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="a-grid-2">
              <div className="field">
                <label htmlFor="fCharacteristics">Особливості (по одній в рядку)</label>
                <textarea
                  id="fCharacteristics"
                  rows={3}
                  value={chars}
                  onChange={(e) => setChars(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="fCare">Догляд (по одному в рядку)</label>
                <textarea
                  id="fCare"
                  rows={3}
                  value={care}
                  onChange={(e) => setCare(e.target.value)}
                />
              </div>
            </div>
          </form>

          <aside className="a-preview">
            <h4>Попередній перегляд</h4>
            {/* Картка тут така сама, як у каталозі: і класи, і теги.
                Інакше «попередній перегляд» показував би не те, що
                побачить покупець. */}
            <div
              className={
                'pcard' +
                (p.sale ? ' pcard--sale' : '') +
                (p.status === 'sold-out' ? ' pcard--sold' : '')
              }
            >
              <span className="pcard__media">
                {p.images[0] ? <img src={p.images[0]} alt="" /> : null}
                {badges.length ? (
                  <span className="pcard__badges">
                    {badges.map(([cls, text]) => (
                      <span className={'badge ' + cls} key={cls}>
                        {text}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              <span className="pcard__body">
                <span className="pcard__title">
                  {p.name || 'Назва товару'}
                  {(p.colors ?? []).map((col, i) => {
                    const hex = typeof col === 'string' ? col : col?.hex;
                    return hex ? (
                      <span className="dot" style={{ backgroundColor: hex }} key={hex + i} />
                    ) : null;
                  })}
                </span>
                <span className="pcard__price">
                  <span className="price__now">{(p.price || 0).toLocaleString('uk-UA')} грн</span>
                  {p.oldPrice ? (
                    <del className="price__old">{p.oldPrice.toLocaleString('uk-UA')} грн</del>
                  ) : null}
                </span>
              </span>
            </div>
          </aside>
        </div>

        <footer className="a-modal__foot">
          {bad ? <span className="a-publish__status is-err">{bad.message}</span> : null}
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn btn--primary" type="button" disabled={busy} onClick={save}>
            Зберегти товар
          </button>
        </footer>
      </div>
    </div>
  );
}
