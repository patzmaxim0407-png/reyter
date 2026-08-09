import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/* Кеш ISR тримає сам воркер у памʼяті інстансу: каталог
   перечитується раз на хвилину, і зовнішнє сховище під це
   заводити ні до чого — Firestore і так поруч. */
export default defineCloudflareConfig();
