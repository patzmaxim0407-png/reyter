'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import AdminBar from './AdminBar';
import PublishDialog from './PublishDialog';
import { useToast } from '../Toasts';
import { db } from '@/lib/firebase';
import { EMPTY_DRAFT, watchDraft, type Draft } from '@/lib/admin/store';
import { watchOrders } from '@/lib/admin/live';
import {
  draftDiffers,
  loadPublished,
  type PublishedDoc,
  type ScheduledDoc
} from '@/lib/admin/publish';

/* ============================================================
   Шапка адмінки з публікацією
   ------------------------------------------------------------
   У старій панелі «Опублікувати» стояло в спільній шапці й було
   на всіх чотирьох розділах: адміністратор міг правити склад чи
   замовлення, а тоді одним рухом викласти каталог. Тут кнопка
   опинилась лише на сторінці каталогу — з решти розділів
   опублікувати було нічим.

   Тому шапка й діалог публікації живуть разом, і кожен розділ
   малює саме цей компонент, а не AdminBar напряму.

   Прибирання (housekeeping) сюди не переїхало навмисно: воно
   застосовує прострочений розклад і робить перший знімок, і
   робити це має рівно одне місце — сторінка каталогу.
   ============================================================ */

/** Скільки замовлень чекають на обробку. Значок на вкладці має
 *  бути на всіх розділах, а не лише там, де список уже відкритий. */
export function useNewOrders(): number {
  const [n, setN] = useState(0);
  useEffect(
    () =>
      watchOrders((list) =>
        setN(list.filter((o) => ((o as { status?: string }).status ?? 'new') === 'new').length)
      ),
    []
  );
  return n;
}

export default function PublishControl({
  user,
  onSettings,
  children
}: {
  user: User;
  onSettings(): void;
  /** Чернетка сторінки каталогу — щоб не тримати другу підписку
   *  там, де вона вже є. */
  children?: ReactNode;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [published, setPublished] = useState<PublishedDoc | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledDoc | null>(null);
  const [open, setOpen] = useState(false);
  const newOrders = useNewOrders();

  useEffect(
    () =>
      watchDraft(setDraft, () =>
        toast('Не вдалося прочитати чернетку — перевірте права доступу')
      ),
    [toast]
  );

  useEffect(() => {
    void loadPublished(db()).then((pair) => {
      if (!pair) return;
      setPublished(pair.published);
      setScheduled(pair.scheduled);
    });
  }, []);

  const hasDraft = !!scheduled || draftDiffers(draft, published, draft.seeded);

  return (
    <>
      <AdminBar
        user={user}
        hasDraft={hasDraft}
        newOrders={newOrders}
        /* Поки чернетки немає, публікувати нічого: кнопка була б
           обіцянкою, за якою порожній каталог */
        onPublish={draft.seeded ? () => setOpen(true) : undefined}
        onSettings={onSettings}
      />
      {children}
      <PublishDialog
        open={open}
        onClose={() => setOpen(false)}
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
    </>
  );
}
