'use client';

import { useCallback, useEffect, useState } from 'react';
import { getStorage } from 'firebase/storage';
import AdminBar from './AdminBar';
import SettingsDialog from './SettingsDialog';
import CategoryList from './CategoryList';
import ProductList from './ProductList';
import ProductEditor, { type EditorSave } from './ProductEditor';
import PublishDialog from './PublishDialog';
import { useNewOrders } from './PublishControl';
import { useAdminUser } from './AdminGate';
import { useAsk } from './AskProvider';
import { useToast } from '../Toasts';
import { db } from '@/lib/firebase';
import { EMPTY_DRAFT, watchDraft, type Draft } from '@/lib/admin/store';
import {
  addCategory,
  applyProductSave,
  checkCategoryDelete,
  deleteCategory,
  maxOrder,
  planProductSave,
  renameCategory,
  reorderCategories,
  persistCatOrder,
  saveProduct
} from '@/lib/admin/draft';
import {
  draftDiffers,
  housekeeping,
  loadPublished,
  type PublishedDoc,
  type ScheduledDoc
} from '@/lib/admin/publish';
import { migratePhotos, uploadPhotos } from '@/lib/admin/photos';
import { doc, deleteDoc, updateDoc } from 'firebase/firestore';
import type { Category, Product } from '@/lib/types';

/* ============================================================
   Каталог в адмінці
   ------------------------------------------------------------
   Усе, що тут редагується, лягає в чернетку — покупець бачить
   опублікований знімок. Тому небезпечна дія тут не «псує сайт»,
   а псує дані: саме тому кожна з них проходить через перевірку
   з lib/admin/draft.ts.
   ============================================================ */

export default function CatalogAdmin() {
  const user = useAdminUser();
  const ask = useAsk();
  const toast = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const newOrders = useNewOrders();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [current, setCurrent] = useState('all');
  const [published, setPublished] = useState<PublishedDoc | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledDoc | null>(null);
  const [editing, setEditing] = useState<{ product: Product | null } | null>(null);
  const [pubOpen, setPubOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  /* Чернетка приходить підпискою: магазин ведуть удвох, і зміна
     з телефона має зʼявитись на ноутбуці сама */
  useEffect(
    () =>
      watchDraft(setDraft, () =>
        toast('Не вдалося прочитати чернетку — перевірте права доступу')
      ),
    [toast]
  );

  /* Прибирання при вході адміна робить дві потрібні речі:
     застосовує прострочений розклад і, якщо публікацій ще не
     було, фіксує поточний стан. Без другого покупець бачив би
     порожній каталог: сайт читає published/catalog, а його
     просто не існувало б. Чекаємо на чернетку — саме з неї
     береться перший знімок. */
  const [tidied, setTidied] = useState(false);
  useEffect(() => {
    if (tidied || !draft.seeded) return;
    setTidied(true);
    void loadPublished(db()).then(async (pair) => {
      if (!pair) return;
      const next = await housekeeping({
        db: db(),
        user: { email: user.email ?? '' },
        draft,
        seeded: draft.seeded,
        published: pair.published,
        scheduled: pair.scheduled,
        /* Разова міграція старих фото з репозиторію у Storage.
           Маркер у базі спільний зі старою адмінкою, тож якщо
           вона вже пройшла — це порожній прохід. */
        migrations: [
          async () => {
            const d = db();
            if (!d) return;
            const res = await migratePhotos({
              db: d,
              storage: getStorage(),
              user,
              seeded: draft.seeded,
              products: draft.products
            });
            if (res.outcome === 'partial') {
              toast(`Не перенеслось фото: ${res.failed} з ${res.total}`);
            }
          }
        ]
      });
      setPublished(next.published);
      setScheduled(next.scheduled);
    });
  }, [draft, tidied, user, toast]);

  /* Обрана категорія могла зникнути — інакше список показував би
     порожнечу без жодного пояснення */
  useEffect(() => {
    if (current !== 'all' && !draft.categories.some((c) => c.id === current)) setCurrent('all');
  }, [draft.categories, current]);

  const need = useCallback(() => {
    const d = db();
    if (!d) toast('Немає звʼязку з базою');
    return d;
  }, [toast]);

  /* ---------- Категорії ---------- */

  async function onAddCategory(name: string) {
    const d = need();
    if (!d) return;
    try {
      await addCategory(d, draft.categories, name);
    } catch {
      toast('Не вдалося створити категорію — перевірте права');
    }
  }

  async function onRenameCategory(cat: Category) {
    const name = await ask({
      title: 'Перейменувати категорію',
      text: 'Нова назва буде видна покупцям після публікації.',
      label: 'Назва',
      input: cat.title
    });
    if (typeof name !== 'string' || !name.trim()) return;
    const d = need();
    if (!d) return;
    try {
      await renameCategory(d, cat.id, name.trim());
    } catch {
      toast('Не вдалося перейменувати');
    }
  }

  async function onDeleteCategory(cat: Category) {
    const check = checkCategoryDelete(draft.products, cat.id);
    if (!check.ok) {
      await ask({ title: 'Категорія не порожня', text: check.message, okText: 'Зрозуміло' });
      return;
    }
    const yes = await ask({
      title: 'Видалити категорію?',
      text: `«${cat.title}» зникне зі списку.\n\nПокупці побачать це після публікації.`,
      okText: 'Видалити',
      danger: true
    });
    if (yes !== true) return;
    const d = need();
    if (!d) return;
    try {
      await deleteCategory(d, cat.id);
      if (current === cat.id) setCurrent('all');
    } catch {
      toast('Не вдалося видалити');
    }
  }

  async function onReorder(from: number, to: number) {
    const ids = draft.categories.map((c) => c.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);

    const plan = reorderCategories(draft.categories, ids);
    if (!plan.ok || !plan.changed) return;

    // малюємо новий порядок одразу: підписка підтвердить його за мить
    setDraft((v) => ({ ...v, categories: plan.categories }));
    const d = need();
    if (!d) return;
    try {
      await persistCatOrder(d, draft.categories, ids);
    } catch {
      toast('Порядок не збережено — перевірте права');
    }
  }

  /* ---------- Товари ---------- */

  async function onAct(act: 'edit' | 'dup' | 'toggle' | 'del', p: Product) {
    if (act === 'edit') return setEditing({ product: p });

    if (act === 'dup') {
      /* Копія відкривається одразу, але артикул лишається
         порожнім: два товари з однаковим id — це один документ,
         і другий мовчки затер би перший. */
      return setEditing({
        product: { ...p, id: '', name: p.name + ' (копія)', order: maxOrder(draft.products) + 10 }
      });
    }

    const d = need();
    if (!d) return;

    if (act === 'toggle') {
      try {
        await updateDoc(doc(d, 'catalog_products', p.id), { hidden: !p.hidden });
      } catch {
        toast('Не вдалося змінити видимість');
      }
      return;
    }

    /* Товар може бути складником комплекту. Не забороняємо —
       попереджаємо: інакше прибрати його можна було б лише
       вручну перебравши всі комплекти, а це та сама робота,
       тільки довша. */
    const inSets = draft.products.filter((x) => (x.set ?? []).includes(p.id));
    const warn = inSets.length
      ? `\n\nВін входить у комплект${inSets.length > 1 ? 'и' : ''}: ` +
        inSets.map((x) => `«${x.name}»`).join(', ') +
        `. Без нього ${inSets.length > 1 ? 'вони перестануть' : 'він перестане'} ` +
        'продаватися, поки ви не поправите склад комплекту.'
      : '';

    const yes = await ask({
      title: 'Видалити товар?',
      text: `«${p.name}» (${p.id}) зникне з чернетки.${warn}\n\nПокупці побачать це після публікації.`,
      okText: 'Видалити',
      danger: true
    });
    if (yes !== true) return;
    try {
      await deleteDoc(doc(d, 'catalog_products', p.id));
    } catch {
      toast('Не вдалося видалити');
    }
  }

  async function onSaveProduct(v: EditorSave) {
    const d = need();
    if (!d) return;

    const res = planProductSave({
      product: v.product,
      products: draft.products,
      editingId: editing?.product?.id ?? null,
      isSetOn: v.isSetOn,
      setRows: v.setRows
    });
    if (!res.ok) {
      toast(res.message);
      return;
    }

    setBusy(true);
    try {
      await saveProduct(d, res.plan);
      // список оновиться підпискою, але без цього кадру картка
      // на мить показала б старі дані
      setDraft((s) => ({ ...s, products: applyProductSave(s.products, res.plan) }));
      setEditing(null);
      toast('Збережено ✓', 'success');
    } catch {
      toast('Не вдалося зберегти — перевірте права доступу');
    } finally {
      setBusy(false);
    }
  }

  /* ---------- Фото ---------- */

  const onUpload = useCallback(
    async (files: FileList, article: string) => {
      if (!article) {
        toast('Спершу вкажіть артикул — за ним називаються файли');
        return [];
      }
      const res = await uploadPhotos(
        { storage: getStorage(), user },
        Array.from(files),
        article,
        (p) => setUploadStatus(p.kind === 'photo' ? '' : p.text)
      );
      if (!res.ok) toast(res.error);
      else setUploadStatus(`Готово: ${res.urls.length}`);
      return res.urls;
    },
    [user, toast]
  );

  /* Крапка на кнопці означає «є що публікувати», а не «щось
     колись публікували» — інакше вона світилася б завжди */
  const hasDraft = !!scheduled || draftDiffers(draft, published, draft.seeded);

  return (
    <>
      <AdminBar
        user={user}
        hasDraft={hasDraft}
        newOrders={newOrders}
        /* Поки чернетка не приїхала, публікувати нічого: знімок
           порожнього каталогу стер би вітрину повністю */
        onPublish={draft.seeded ? () => setPubOpen(true) : undefined}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="admin-wrap">
        <CategoryList
          categories={draft.categories}
          products={draft.products}
          current={current}
          onPick={setCurrent}
          onAdd={(n) => void onAddCategory(n)}
          onRename={(c) => void onRenameCategory(c)}
          onDelete={(c) => void onDeleteCategory(c)}
          onReorder={(a, b) => void onReorder(a, b)}
        />

        <main className="a-main">
          <div className="a-toolbar">
            <h2>
              {current === 'all'
                ? 'Всі товари'
                : (draft.categories.find((c) => c.id === current)?.title ?? current)}
            </h2>
            <button
              className="btn btn--primary"
              type="button"
              disabled={!draft.categories.length}
              onClick={() => setEditing({ product: null })}
            >
              + Новий товар
            </button>
          </div>

          <div className="a-list">
            <ProductList
              categories={draft.categories}
              products={draft.products}
              current={current}
              onAct={(a, p) => void onAct(a, p)}
            />
          </div>
        </main>
      </div>

      <ProductEditor
        open={!!editing}
        product={editing?.product ?? null}
        categories={draft.categories}
        products={draft.products}
        busy={busy}
        uploadStatus={uploadStatus}
        onClose={() => setEditing(null)}
        onSave={(v) => void onSaveProduct(v)}
        onUpload={(files, article) => onUpload(files, article)}
      />

      <PublishDialog
        open={pubOpen}
        onClose={() => setPubOpen(false)}
        draft={draft}
        seeded={draft.seeded}
        published={published}
        scheduled={scheduled}
        user={user}
        onChanged={(next) => {
          if ('published' in next) setPublished(next.published ?? null);
          if ('scheduled' in next) setScheduled(next.scheduled ?? null);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user.email ?? ''}
      />
    </>
  );
}
