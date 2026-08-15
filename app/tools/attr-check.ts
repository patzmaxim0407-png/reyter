/* Перевірка визначення джерела: помилка тут — це реклама, яку
   визнали марною, або марна, яку визнали успішною. */
import { channelOf, touchFrom, remember } from '../lib/attribution.ts';

let failed = 0;
const ok = (n: string, c: boolean, e = '') => { if (!c) failed++; console.log(`${c ? '✓' : '✗'} ${n}${e ? ' — ' + e : ''}`); };

const t = (url: string, ref = '') => touchFrom(url, ref, '2026-08-16');

ok('gclid — це Google Реклама', t('https://reyter.men/?gclid=abc')?.channel === 'Google Реклама');
ok('fbclid — це Meta Реклама', t('https://reyter.men/?fbclid=xyz')?.channel === 'Meta Реклама');
ok('utm google cpc — реклама',
   t('https://reyter.men/?utm_source=google&utm_medium=cpc')?.channel === 'Google Реклама');
ok('перехід із пошуку без мітки — органіка',
   t('https://reyter.men/', 'https://www.google.com/search?q=reyter')?.channel === 'Google Пошук');
ok('Instagram упізнається за реферером',
   t('https://reyter.men/', 'https://l.instagram.com/')?.channel === 'Instagram');
ok('utm без реклами — соцмережа, а не реклама',
   t('https://reyter.men/?utm_source=instagram&utm_medium=social')?.channel === 'Instagram');
ok('чужий сайт — перехід із домену',
   t('https://reyter.men/', 'https://blog.example.com/post')?.channel === 'Перехід з blog.example.com');

/* Найважливіше: ходіння власним сайтом не має стирати рекламу,
   яка привела людину пʼять хвилин тому. */
ok('свій же реферер новим дотиком не вважається',
   t('https://reyter.men/p/ABC', 'https://reyter.men/') === null);
ok('без міток і без реферера — теж нічого нового',
   t('https://reyter.men/checkout') === null);
ok('крива адреса не ламає', t('не адреса') === null);

ok('кампанія зберігається',
   t('https://reyter.men/?utm_source=google&utm_medium=cpc&utm_campaign=summer')?.campaign === 'summer');

/* Памʼять: перший дотик не переписується ніколи. */
const store: Record<string, string> = {};
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; }
};
remember('https://reyter.men/?utm_source=instagram&utm_medium=social', '');
const after = remember('https://reyter.men/', 'https://www.google.com/');
ok('перший дотик лишається першим', after?.first.channel === 'Instagram', after?.first.channel);
ok('останній оновлюється', after?.last.channel === 'Google Пошук', after?.last.channel);
const same = remember('https://reyter.men/checkout', 'https://reyter.men/');
ok('ходіння сайтом нічого не змінює',
   same?.first.channel === 'Instagram' && same?.last.channel === 'Google Пошук');

console.log('\n' + (failed ? `розбіжностей: ${failed}` : 'усе зійшлося'));
if (failed) process.exit(1);
