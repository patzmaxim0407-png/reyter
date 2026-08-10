/* ============================================================
   REYTER — блокування прокрутки під оверлеями
   ------------------------------------------------------------
   На iOS самого overflow: hidden замало — сторінка все одно
   «протягується» під модалкою. Попередній сайт фіксував body
   і повертав позицію назад; повторюємо те саме.

   Лічильник потрібен тому, що оверлеї накладаються: із картки
   товару відкривається лайтбокс, і коли він закриється, знімати
   блокування ще зарано — модалка лишилась.
   ============================================================ */

let depth = 0;
let savedScroll = 0;

export function lockScroll(): void {
  if (depth++ > 0) return;
  savedScroll = window.scrollY || window.pageYOffset || 0;
  document.body.style.top = -savedScroll + 'px';
  document.body.classList.add('no-scroll');
}

export function unlockScroll(): void {
  if (depth === 0 || --depth > 0) return;
  document.body.classList.remove('no-scroll');
  document.body.style.top = '';
  // миттєво, без плавної прокрутки — інакше сторінка «їде»
  const behavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, savedScroll);
  document.documentElement.style.scrollBehavior = behavior;
}

/** Позиція сторінки під оверлеєм. Потрібна закриттю картки
 *  товару: воно міняє адресу, і Next інакше поставив би
 *  каталог на початок. */
export function lockedScrollY(): number {
  return depth > 0 ? savedScroll : window.scrollY || window.pageYOffset || 0;
}
