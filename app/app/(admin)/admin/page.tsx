import CatalogAdmin from '@/components/admin/CatalogAdmin';

/* Каталог адмінки. Дані сюди не приходять із сервера навмисно:
   чернетку читає сам браузер підпискою, під правами того, хто
   увійшов. Так сервер не бачить нічого, що йому не належить, і
   двоє адміністраторів бачать зміни одне одного одразу. */
export default function AdminCatalogPage() {
  return <CatalogAdmin />;
}
