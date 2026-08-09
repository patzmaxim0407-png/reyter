/* ============================================================
   REYTER — дані сайту
   ------------------------------------------------------------
   Єдине джерело правди для каталогу.
   Щоб додати товар — додайте обʼєкт у REYTER.products.
   Щоб тимчасово сховати товар — поставте hidden: true.
   ============================================================ */

window.REYTER = window.REYTER || {};

REYTER.config = {
  siteUrl: 'https://reyter.men',
  socials: {
    tiktok:    'https://www.tiktok.com/@reyter.ua5',
    instagram: 'https://www.instagram.com/reyter.ua/',
    threads:   'https://www.threads.com/@reyter.ua',
    x:         'https://twitter.com/reyter_ua'
  },
  allSizes: ['XS', 'S', 'M', 'L', 'XL'],
  freeDeliveryFrom: 1500,
  /* Розмірна сітка — одне джерело для секції на сторінці
     і для підказки всередині картки товару */
  sizeChart: [
    { size: 'XS', waist: '80–84', hips: '95–99' },
    { size: 'S',  waist: '84–88', hips: '99–103' },
    { size: 'M',  waist: '88–92', hips: '103–107' },
    { size: 'L',  waist: '92–96', hips: '107–111' }
  ],
  /* Життєвий цикл замовлення (панель в адмінці + трекер у кабінеті) */
  orderStatuses: [
    { id: 'new',       title: 'Нове',         hint: 'Замовлення отримано — скоро підтвердимо' },
    { id: 'confirmed', title: 'Підтверджено', hint: 'Менеджер підтвердив замовлення' },
    { id: 'shipped',   title: 'Відправлено',  hint: 'Посилка вже в дорозі' },
    { id: 'done',      title: 'Виконано',     hint: 'Замовлення доставлено' },
    { id: 'cancelled', title: 'Скасовано',    hint: 'Замовлення скасовано' }
  ]
};

/* Категорії показуються в цьому ж порядку */
REYTER.categories = [
  { id: 'new',    title: 'New drop',  titleEn: 'New drop' },
  { id: 'briefs', title: 'Бріфи',     titleEn: 'Briefs' },
  { id: 'slips',  title: 'Сліпи',     titleEn: 'Slips' },
  { id: 'ribbed', title: 'Рубчик',    titleEn: 'Ribbed' },
  { id: 'boxers', title: 'Бокси',     titleEn: 'Boxers' },
  { id: 'jocks',  title: 'Jockstrap', titleEn: 'Jockstrap' },
  { id: 'swim',   title: 'Swimwear',  titleEn: 'Swimwear' },
  { id: 'tanks',  title: 'Майки',     titleEn: 'Tanks' },
  { id: 'royal',  title: 'Shorts',    titleEn: 'Shorts' },
  { id: 'sets',   title: 'Комплекти', titleEn: 'Sets' }
];

/* ------------------------------------------------------------
   Поля товару:
   id        — артикул (унікальний)
   category  — id категорії зі списку вище
   name      — назва
   price     — ціна в грн; oldPrice — стара ціна (для SALE)
   priceUsd  — орієнтовна ціна в доларах
   status    — 'in-stock' | 'sold-out'
   lowStock  — розміри, що закінчуються, напр. ['L']
   sale      — true → бейдж знижки
   colors    — кольорові крапки на картці
   sizes     — доступні розміри (порожньо, якщо товар без розмірів)
   volume    — обʼєм (для свічок/дифузорів, замість розмірів)
   fabric    — тканина; material — склад
   aroma     — аромат (для home collection)
   model     — параметри моделі на фото
   notes     — додаткові рядки опису
   characteristics / care — списки для блоків «Особливості» та «Догляд»
   images    — шляхи до фото (перше — обкладинка, друге — hover)
   hidden    — true → не показувати на сайті
   set       — артикули товарів, з яких зібраний комплект.
               Комплект не має власних розмірів і залишків:
               покупець обирає розмір кожного складника, а на
               складі кількість комплектів рахується за
               найдефіцитнішим із них.
   ------------------------------------------------------------ */

REYTER.products = [

  /* ---------- Home collection ---------- */
  {
    id: 'CRH-001',
    hidden: true,
    category: 'home',
    name: 'Candle Reyter',
    price: 465, priceUsd: 11,
    status: 'in-stock',
    volume: '250 мл',
    aroma: 'Бренді & груша',
    material: 'Деревʼяний гніт, соєвий віск, натуральні аромаолії',
    notes: [
      '❗️Після кожного використання свічки з деревʼяним гнітом акуратно приберіть обгорілу частину гніту.'
    ],
    images: [
      '../assets/images/home/Home04.webp',
      '../assets/images/home/Home05.webp'
    ]
  },
  {
    id: 'DUF-001',
    hidden: true,
    category: 'home',
    name: 'Duffuser',
    price: 750, priceUsd: 18,
    status: 'in-stock',
    volume: '50 мл',
    aroma: 'Бренді & груша',
    material: 'Натуральна (косметична) аромаолія, база для аромадифузорів',
    images: ['../assets/images/home/Duffuser.webp'],
    hidden: true
  },

  /* ---------- Сорочки ---------- */
  {
    id: 'EO-001',
    hidden: true,
    category: 'shirts',
    name: 'Сорочка Electric Oversized',
    price: 2190, priceUsd: 49,
    status: 'in-stock',
    colors: ['#014AAD'],
    sizes: ['M', 'L'],
    material: '100% бавовна',
    images: [
      '../assets/images/Jule2026/1.webp',
      '../assets/images/Jule2026/2.webp',
      '../assets/images/Jule2026/5.webp'
    ]
  },
  {
    id: 'BO-001',
    hidden: true,
    category: 'shirts',
    name: 'Сорочка Basmin Oversized',
    price: 2190, priceUsd: 49,
    status: 'in-stock',
    colors: ['#a7d6d3'],
    sizes: ['M', 'L'],
    material: '100% бавовна',
    images: [
      '../assets/images/Jule2026/3.webp',
      '../assets/images/Jule2026/4.webp',
      '../assets/images/Jule2026/6.webp'
    ]
  },

  /* ---------- Новинки ---------- */
  {
    id: 'WHJOCK-001',
    category: 'jocks',
    name: 'White Jockstrap',
    price: 820, priceUsd: 19,
    status: 'in-stock',
    colors: ['#ffffff'],
    sizes: ['S', 'M', 'L'],
    material: 'Бавовна 95%, еластан 5%',
    model: '181 см, 96 кг, талія 86 см',
    images: [
      '../assets/images/spring2026/21.webp',
      '../assets/images/spring2026/16.webp',
      '../assets/images/spring2026/19.webp',
      '../assets/images/spring2026/25.webp'
    ]
  },
  {
    id: 'WW-001',
    category: 'slips',
    name: 'Wave white',
    price: 750, priceUsd: 18,
    status: 'in-stock',
    colors: ['#ffffff'],
    sizes: ['S', 'M', 'L'],
    material: 'Віскоза 95%, еластан 5%',
    model: '181 см, груди 102 см, сідниці 99 см, талія 83 см',
    characteristics: ['Еластичний матеріал', 'Комфортна посадка', 'Міцна фурнітура'],
    care: ['Машинне прання 30 °C', 'Делікатний режим', 'Сушіння на повітрі'],
    images: [
      '../assets/images/spring2026/17.webp',
      '../assets/images/spring2026/18.webp'
    ]
  },
  {
    id: 'RBK-001',
    category: 'ribbed',
    name: 'Ribbed black',
    price: 700, priceUsd: 17,
    status: 'in-stock',
    colors: ['#0a0a0a'],
    sizes: ['S', 'M', 'L'],
    material: 'Віскоза 95%, еластан 5%',
    characteristics: ['Мʼяка та дихаюча тканина', 'Приємна на дотик', 'Довготривалий колір'],
    care: ['Машинне прання 30 °C', 'Делікатний режим', 'Сушіння на повітрі'],
    images: [
      '../assets/images/spring2026/1.webp',
      '../assets/images/spring2026/6.webp',
      '../assets/images/spring2026/7.webp',
      '../assets/images/spring2026/23.webp',
      '../assets/images/spring2026/24.webp'
    ]
  },
  {
    id: 'BCLBL-001',
    category: 'briefs',
    name: 'Бріфи classic Black',
    price: 750, priceUsd: 18,
    status: 'in-stock',
    colors: ['#000000'],
    sizes: ['S', 'M', 'L', 'XL'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/spring2026/5.webp',
      '../assets/images/spring2026/2.webp',
      '../assets/images/spring2026/3.webp',
      '../assets/images/spring2026/4.webp'
    ]
  },
  {
    id: 'SWBK-001',
    category: 'swim',
    categories: ['swim', 'new'],
    name: 'Swimwear black',
    price: 880, priceUsd: 21,
    status: 'in-stock',
    colors: ['#000000'],
    sizes: ['S', 'M', 'L'],
    material: 'Еконіл 78%, спандекс 22%',
    notes: ['Білизна для басейну, пляжу та активного відпочинку.'],
    characteristics: ['Стійкість до хлору і солі', 'Швидке висихання', 'Еластичний матеріал'],
    care: ['Прання в холодній воді', 'Не використовуйте пральну машину', 'Сушіння вдалині від сонця'],
    images: [
      '../assets/images/spring2026/10.webp',
      '../assets/images/spring2026/11.webp',
      '../assets/images/spring2026/12.webp',
      '../assets/images/spring2026/15.webp'
    ]
  },
  {
    id: 'SW-003',
    category: 'swim',
    categories: ['swim', 'new'],
    name: 'Swimwear rich',
    price: 880, priceUsd: 21,
    status: 'sold-out',
    colors: ['#09543a'],
    sizes: [],
    material: 'Еконіл 78%, спандекс 22%',
    notes: ['Білизна для басейну, пляжу та активного відпочинку.'],
    characteristics: ['Стійкість до хлору і солі', 'Швидке висихання', 'Еластичний матеріал'],
    care: ['Прання в холодній воді', 'Не використовуйте пральну машину', 'Сушіння вдалині від сонця'],
    images: [
      '../assets/images/boxers/sr1.webp',
      '../assets/images/boxers/sr2.webp',
      '../assets/images/boxers/sr3.webp'
    ]
  },

  /* ---------- Майки ---------- */
  {
    id: 'MM-001',
    category: 'tanks',
    name: 'Майка milk',
    price: 560, priceUsd: 14,
    status: 'in-stock',
    colors: ['#f6f7f8'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/tank_top/m4.webp',
      '../assets/images/tank_top/m5.webp',
      '../assets/images/tank_top/m6.webp',
      '../assets/images/tank_top/m7.webp',
      '../assets/images/tank_top/m8.webp',
      '../assets/images/tank_top/m9.webp',
      '../assets/images/tank_top/m10.webp'
    ]
  },
  {
    id: 'MBL-001',
    category: 'tanks',
    name: 'Майка black',
    price: 560, priceUsd: 14,
    status: 'in-stock',
    colors: ['#0c0c0c'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/sets/sb7.webp',
      '../assets/images/sets/sb8.webp',
      '../assets/images/sets/sb9.webp'
    ]
  },
  {
    id: 'MME-002',
    category: 'tanks',
    name: 'Майка menthol',
    price: 560, priceUsd: 14,
    status: 'in-stock',
    colors: ['#4bc5e7'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/sets/sbi5.webp',
      '../assets/images/sets/sbi6.webp'
    ]
  },

  /* ---------- Джоки ---------- */
  {
    id: 'RDJOCK-002',
    category: 'jocks',
    name: 'Red Jockstrap',
    price: 960, priceUsd: 23,
    status: 'sold-out',
    colors: ['#c10000'],
    sizes: [],
    material: 'Бавовна 95%, еластан 5%',
    model: '181 см, 96 кг, талія 86 см',
    images: [
      '../assets/images/jocks/01.02.2026-1.webp',
      '../assets/images/jocks/01.02.2026-2.webp',
      '../assets/images/jocks/01.02.2026-3.webp'
    ]
  },
  {
    id: 'BLJOCK-001',
    category: 'jocks',
    name: 'Black Jockstrap',
    price: 850, priceUsd: 20,
    status: 'sold-out',
    colors: ['#000000'],
    sizes: [],
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/jocks/jocksB01.webp',
      '../assets/images/jocks/jocksB02.webp',
      '../assets/images/jocks/jocksB03.webp'
    ]
  },

  /* ---------- Рубчик ---------- */
  {
    id: 'BG-001',
    category: 'ribbed',
    name: 'Beige underwear',
    price: 700, priceUsd: 17,
    status: 'in-stock',
    lowStock: ['XS'],
    colors: ['#f2eede'],
    sizes: ['XS', 'M', 'L', 'XL'],
    material: 'Віскоза 95%, еластан 5%',
    characteristics: ['Еластичний матеріал', 'Комфортна посадка', 'Міцна фурнітура'],
    care: ['Машинне прання 30 °C', 'Делікатний режим', 'Сушіння на повітрі'],
    images: [
      '../assets/images/boxers/Oc1.webp',
      '../assets/images/boxers/Oc2.webp',
      '../assets/images/boxers/Oc3.webp'
    ]
  },
  {
    id: 'PW-002',
    category: 'ribbed',
    name: 'Powder underwear',
    price: 700, priceUsd: 17,
    status: 'in-stock',
    colors: ['#fdd6c7'],
    sizes: ['S', 'M', 'L'],
    material: 'Віскоза 95%, еластан 5%',
    characteristics: ['Мʼяка та дихаюча тканина', 'Приємна на дотик', 'Довготривалий колір'],
    care: ['Машинне прання 30 °C', 'Делікатний режим', 'Сушіння на повітрі'],
    images: [
      '../assets/images/boxers/pa1.webp',
      '../assets/images/boxers/pa2.webp',
      '../assets/images/boxers/pa3.webp'
    ]
  },

  /* ---------- Royal shorts ---------- */
  {
    id: 'RSM-001',
    category: 'royal',
    name: 'Royal shorts mint',
    price: 1090, priceUsd: 26,
    status: 'in-stock',
    colors: ['#c7fde7'],
    sizes: ['S', 'M', 'L'],
    material: 'Бавовна 100%',
    notes: ['Сімейні боксери — індивідуальна модель для щоденного комфорту.'],
    images: [
      '../assets/images/boxers/rs1.webp',
      '../assets/images/boxers/rs2.webp',
      '../assets/images/boxers/rs3.webp'
    ]
  },
  {
    id: 'RH-001',
    category: 'royal',
    name: 'Royal shorts',
    price: 1150, priceUsd: 28,
    status: 'in-stock',
    colors: ['#21098e'],
    sizes: ['S', 'M', 'L'],
    material: 'Бавовна 100%',
    notes: ['Сімейні боксери — індивідуальна модель для щоденного комфорту.'],
    images: [
      '../assets/images/boxers/rsh1.webp',
      '../assets/images/boxers/rsh2.webp',
      '../assets/images/boxers/rsh3.webp'
    ]
  },

  /* ---------- Бріфи ---------- */
  {
    id: 'BCL-001',
    category: 'briefs',
    name: 'Бріфи classic',
    price: 550, oldPrice: 770, priceUsd: 14,
    status: 'in-stock',
    sale: true,
    colors: ['#3004d1', '#ed1505'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/boxers/bl5.webp',
      '../assets/images/boxers/bl6.webp',
      '../assets/images/boxers/bl7.webp'
    ]
  },
  {
    id: 'BRW-001',
    category: 'slips',
    name: 'Бріфи red wave',
    price: 550, oldPrice: 735, priceUsd: 14,
    status: 'in-stock',
    sale: true,
    colors: ['#ed1505'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/boxers/r4.webp',
      '../assets/images/boxers/r5.webp',
      '../assets/images/boxers/r6.webp'
    ]
  },
  {
    id: 'BCL-002',
    category: 'briefs',
    name: 'Бріфи classic',
    price: 550, oldPrice: 770, priceUsd: 14,
    status: 'in-stock',
    sale: true,
    colors: ['#ed1505', '#3004d1'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/boxers/rw5.webp',
      '../assets/images/boxers/rw6.webp'
    ]
  },
  {
    id: 'BM-001',
    category: 'briefs',
    name: 'Бріфи milk',
    price: 550, oldPrice: 730, priceUsd: 14,
    status: 'in-stock',
    sale: true,
    colors: ['#fdfcfc'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/boxers/w4.webp',
      '../assets/images/boxers/w5.webp',
      '../assets/images/boxers/w6.webp'
    ]
  },
  {
    id: 'BDW-001',
    category: 'slips',
    name: 'Бріфи dark wave',
    price: 550, oldPrice: 735, priceUsd: 14,
    status: 'in-stock',
    sale: true,
    colors: ['#0a0101'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/boxers/b5.webp',
      '../assets/images/boxers/b6.webp',
      '../assets/images/boxers/b7.webp'
    ]
  },
  {
    id: 'BME-001',
    category: 'slips',
    name: 'Бріфи menthol',
    price: 690, oldPrice: 760, priceUsd: 16,
    status: 'in-stock',
    sale: true,
    colors: ['#62d4fa'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/boxers/g5.webp',
      '../assets/images/boxers/g6.webp'
    ]
  },
  {
    id: 'BSP-001',
    category: 'boxers',
    name: 'Boxers sport (подовжені)',
    price: 720, oldPrice: 920, priceUsd: 19,
    status: 'in-stock',
    sale: true,
    colors: ['#3004d1'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    notes: ['*Мають мішечок для зручної посадки.'],
    images: [
      '../assets/images/boxers/bld1.webp',
      '../assets/images/boxers/bld2.webp',
      '../assets/images/boxers/bld3.webp'
    ]
  },
  {
    id: 'BXS-001',
    category: 'boxers',
    name: 'Boxers sport (подовжені)',
    price: 720, oldPrice: 920, priceUsd: 19,
    status: 'in-stock',
    lowStock: ['L'],
    sale: true,
    colors: ['#030303'],
    sizes: ['L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    notes: ['*Мають мішечок для зручної посадки.'],
    images: [
      '../assets/images/boxers/bldb1.webp',
      '../assets/images/boxers/bldb2.webp',
      '../assets/images/boxers/bldb3.webp'
    ]
  },

  /* ---------- Комплекти ---------- */
  {
    id: 'CME-003',
    category: 'sets',
    name: 'Комплект menthol',
    price: 1250, oldPrice: 1320, priceUsd: 30,
    status: 'in-stock',
    sale: true,
    saleNote: 'Економія 5% при покупці комплектом',
    colors: ['#4bc5e7'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/sets/sbi5.webp',
      '../assets/images/sets/sbi6.webp',
      '../assets/images/sets/sbi7.webp'
    ]
  },
  {
    id: 'CBLE-001',
    category: 'sets',
    name: 'Комплект black',
    price: 1100, oldPrice: 1320, priceUsd: 27,
    status: 'in-stock',
    sale: true,
    saleNote: 'Економія 5% при покупці комплектом',
    colors: ['#0c0c0c'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/sets/sb7.webp',
      '../assets/images/sets/sb8.webp',
      '../assets/images/sets/sb9.webp'
    ]
  },
  {
    id: 'CBLEB-001',
    category: 'sets',
    name: 'Комплект black box',
    price: 1280, oldPrice: 1480, priceUsd: 31,
    status: 'in-stock',
    sale: true,
    saleNote: 'Економія 5% при покупці комплектом',
    colors: ['#0c0c0c'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/sets/bldb1.webp',
      '../assets/images/sets/bldb2.webp',
      '../assets/images/sets/bldb3.webp'
    ]
  },
  {
    id: 'CCL-001',
    category: 'sets',
    name: 'Комплект classic',
    price: 1165, priceUsd: 27,
    status: 'in-stock',
    colors: ['#0c0c0c'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/spring2026/9.webp',
      '../assets/images/spring2026/8.webp'
    ],
    hidden: true
  },

  /* ---------- Для неї ---------- */
  {
    id: 'MBLE-003',
    hidden: true,
    category: 'her',
    name: 'Майка black',
    price: 560, priceUsd: 14,
    status: 'in-stock',
    colors: ['#020202'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/she/bl1.webp',
      '../assets/images/she/bl2.webp',
      '../assets/images/she/bl3.webp',
      '../assets/images/she/bl4.webp',
      '../assets/images/she/bl5.webp'
    ]
  },
  {
    id: 'MMIL-001',
    hidden: true,
    category: 'her',
    name: 'Майка milk',
    price: 560, priceUsd: 14,
    status: 'in-stock',
    colors: ['#f6f7f8'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/she/m1.webp',
      '../assets/images/she/m2.webp',
      '../assets/images/she/m3.webp'
    ]
  },
  {
    id: 'MAME-004',
    hidden: true,
    category: 'her',
    name: 'Майка menthol',
    price: 560, priceUsd: 14,
    status: 'in-stock',
    colors: ['#4bc5e7'],
    sizes: ['S', 'M', 'L'],
    fabric: 'Кулір',
    material: 'Бавовна 95%, еластан 5%',
    images: [
      '../assets/images/she/mbi1.webp',
      '../assets/images/she/mbi2.webp',
      '../assets/images/she/mbi3.webp',
      '../assets/images/she/mbi4.webp'
    ]
  }
];
