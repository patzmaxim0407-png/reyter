/* ============================================================
   REYTER — i18n.js
   Дві мови: українська (за замовчуванням) та англійська.
   • R.t('key')        — рядок інтерфейсу
   • R.tx(text)        — переклад даних каталогу (назви, склад,
     догляд тощо) за словником фраз і слів
   • Мова зберігається в браузері та в адресі (?lang=en)
   ============================================================ */

(function () {
  'use strict';

  const R = window.REYTER;
  const KEY = 'reyter:lang';

  /* ---------- Рядки інтерфейсу ---------- */

  const UI = {
    uk: {
      'marquee': 'Міжнародна доставка&ensp;✦&ensp;International delivery&ensp;✦&ensp;Безкоштовна доставка на білизну по Україні від 1500 грн&ensp;✦&ensp;',

      'nav.about': 'Про нас',
      'nav.catalog': 'Позиції',
      'nav.size': 'Розмірна сітка',
      'nav.delivery': 'Доставка',
      'nav.contacts': 'Соц мережі',
      'nav.drop': 'New drop&ensp;·&ensp;15.08',
      'nav.account': 'Кабінет користувача',
      'nav.cart': 'Кошик',
      'nav.menu': 'Відкрити меню',
      'nav.top': 'REYTER — на початок сторінки',
      'nav.skip': 'Перейти до каталогу',
      'nav.scrollTop': 'Прокрутити догори',

      'hero.badge': 'Новий дроп — 15.08',
      'hero.title': 'Характер — це <span class="hero__brand">REYTER</span>',
      'hero.subtitle': '<strong>REYTER</strong> — чоловіча білизна українського виробництва. Комфорт, впевненість і власний стиль — з першого дотику тканини.',
      'hero.cta1': 'Дивитися позиції',
      'hero.cta2': 'Підібрати розмір',
      'hero.more': 'Читати більше про бренд',
      'hero.less': 'Приховати',
      'hero.p1': 'Ідея створити <strong>REYTER</strong> народилася з простої, але важливої думки: білизна має бути зручною для всіх. Ми шукали щось, що дарує комфорт, виглядає стильно і водночас відчувається природно на тілі. Але не знайшли. Тож вирішили створити власне.',
      'hero.p2': '<strong>REYTER</strong> — це не лише про тканини та лекала. Це про характер. Про внутрішню силу, що відчувається у кожному русі. Ми віримо: справжня сила починається зсередини — з комфорту, впевненості та власного стилю.',
      'hero.p3': 'Кожен чоловік має свій характер і силу. І ми тут, аби підтримати вас в цьому — з першого дотику тканини до тіла.',
      'hero.trust1': 'Безкоштовна доставка від 1500 грн',
      'hero.trust2': 'Відправка за 1–2 дні',
      'hero.trust3': 'Міжнародна доставка',
      'hero.alt': 'REYTER — український бренд чоловічої білизни',

      'fclub.title': 'Friendly Club ✨',
      'fclub.lead': 'Комʼюніті людей, які є частиною Reyter',
      'fclub.btn': 'Тут',
      'fclub.p1': '<strong>Friendly Club</strong> — це комʼюніті людей, які є частиною Reyter.',
      'fclub.p2': 'Тут ми ділимося: раннім доступом до нових дропів, емоціями, закуліссям бренду, спеціальними пропозиціями та іншими приємними бонусами 😊',
      'fclub.p3': 'Потрапити до Friendly Club можна не за заявкою, а природно — якщо ти регулярно обираєш Reyter, взаємодієш із брендом і залишаєшся частиною нашої спільноти 💙',
      'fclub.h2': 'Як формується Friendly Club 🙃',
      'fclub.p4': 'Ми запрошуємо людей, які:',
      'fclub.li1': 'регулярно обирають Reyter;',
      'fclub.li2': 'взаємодіють із брендом у соцмережах;',
      'fclub.li3': 'відмічають нас у своїх публікаціях або сторіс;',
      'fclub.li4': 'залишаються на звʼязку з нами та підтримують наше комʼюніті.',
      'fclub.note': '*Ми дивимося не лише на покупки, а й на справжній інтерес до бренду 🫂',

      'catalog.title': 'Наші позиції',
      'catalog.sub': 'Кожна модель — про комфорт і характер. Обирайте свою.',
      'catalog.noscript': 'Каталог працює з увімкненим JavaScript. Подивитися всі позиції можна також у нашому',

      'size.title': 'Розмірна сітка',
      'size.sub': 'Заміряйте талію та стегна — і знайдіть свій ідеальний розмір.',
      'size.col1': 'Розмір',
      'size.col2': 'Талія (см)',
      'size.col3': 'Стегна (см)',
      'size.caption': 'Натисніть на зображення, щоб збільшити',
      'size.alt': 'Як виміряти талію та стегна',

      'dlv.title': 'Оплата й доставка',
      'dlv.pay': 'Оплата',
      'dlv.payText': 'На рахунок або картку ФОП, чи PayPal',
      'dlv.fast': 'Швидка відправка',
      'dlv.fastText': 'Відправляємо замовлення протягом 1–2 днів',
      'dlv.carriers': 'Перевізники',
      'dlv.carriersText': 'Нова Пошта, Укрпошта та Meest',
      'dlv.intl': 'Міжнародна доставка',
      'dlv.intlText': 'Надсилаємо замовлення по всьому світу — за повної оплати',
      'dlv.prepay': 'Повна передоплата',
      'dlv.prepayText': 'Відправка лише за повної оплати замовлення',
      'dlv.return': 'Обмін і повернення',
      'dlv.returnText': 'Нижня білизна не підлягає поверненню чи обміну — згідно з постановою КМУ №172 від 19 березня 1994 року',

      'contacts.title': 'Соц мережі',
      'contacts.sub': 'Стежте за новинками й закулісся бренду.',
      'contacts.msgTitle': 'Спосіб звʼязку',
      'contacts.msgSub': 'Напишіть у зручний месенджер — відповімо швидко та допоможемо з будь-яким питанням.',

      'footer.slogan': 'Характер — це REYTER!',
      'footer.about': 'Чоловіча білизна українського виробництва.',
      'footer.offer': 'Публічна оферта',
      'footer.policy': 'Політика конфіденційності',
      'footer.copy': '© 2026 REYTER. Зроблено з ❤️ в Україні.',
      'footer.fop': 'Працюємо офіційно — ФОП Пац М.',

      'badge.sold': 'Продано',
      'badge.sale': 'Sale',
      'badge.low': 'Закінчується',

      'p.article': 'Артикул',
      'p.inStock': 'В наявності',
      'p.soldOut': 'Продано',
      'p.lowStock': 'Закінчується',
      'p.size': 'Розмір',
      'p.volume': 'Обʼєм',
      'p.sizeHelp': 'Як обрати розмір?',
      'p.addToCart': 'Додати в кошик',

      'p.fabric': 'Тканина',
      'p.material': 'Склад',
      'p.aroma': 'Аромат',
      'p.model': 'Параметри моделі',
      'p.features': 'Особливості',
      'p.care': 'Рекомендації щодо догляду',
      'p.careDefault': 'Прання навиворіт при температурі до 30 °C',
      'p.note1': '<strong>Нова Пошта</strong> — відправимо замовлення <em>вже сьогодні</em> при оформленні до 16:00',
      'p.note2': 'Доставка білизни по Україні <em>безкоштовна</em> від 1500 грн при оплаті 100%',
      'p.note3': 'Здійснюємо міжнародну доставку при оплаті 100%',
      'p.prev': 'Попереднє фото',
      'p.next': 'Наступне фото',
      'p.close': 'Закрити',
      'p.photos': 'Фото товару',
      'p.chooseSize': 'Оберіть розмір',
      'p.added': 'Додано в кошик ✓',
      'p.addedShort': 'Додано',
      'p.goToCart': 'Перейти в кошик',

      'cart.title': 'Кошик',
      'cart.empty': 'Кошик порожній',
      'cart.emptyNote': 'Оберіть щось із наших позицій — вони чекають 💙',
      'cart.goCatalog': 'Перейти до позицій',
      'cart.total': 'Разом',
      'cart.subtotal': 'Сума товарів',
      'cart.discount': 'Знижка',
      'promo.notFoundGuest': 'Промокод не знайдено. Персональні коди діють лише в акаунті — увійдіть і спробуйте ще раз',
      'promo.notYours': 'Цей промокод виданий для {email}. Увійдіть у цей акаунт, щоб ним скористатися',
      'promo.onAll': 'на весь кошик',
      'promo.onCats': 'на категорії: {cats}',
      'promo.onProducts': 'на обрані товари ({n})',
      'promo.fromSum': 'від {sum}',
      'promo.noSale': 'без SALE-товарів',
      'promo.till': 'до {date}',
      'promo.stLive': 'Діє',
      'promo.stOff': 'Вимкнено',
      'promo.stSoon': 'Ще не почався',
      'promo.stExpired': 'Термін минув',
      'promo.stUsed': 'Використано',
      'acc.myPromos': 'Мої знижки',
      'acc.promosNote': 'Персональні промокоди, видані саме вам. Натисніть «Застосувати» — код одразу підставиться в кошик.',
      'acc.noPromos': 'Персональних знижок поки немає',
      'acc.noPromosNote': 'Вони зʼявляться тут, щойно ми надамо вам персональний промокод.',
      'acc.promosGuest': 'Увійдіть в акаунт, щоб побачити свої персональні знижки.',
      'acc.applyPromo': 'Застосувати',
      'acc.copyPromo': 'Скопіювати код',
      'acc.promoCopied': 'Код скопійовано ✓',
      'promo.placeholder': 'Промокод',
      'promo.apply': 'Застосувати',
      'promo.applied': 'промокод застосовано',
      'promo.remove': 'Прибрати промокод',
      'promo.checking': 'Перевіряємо…',
      'promo.ok': 'Знижка {sum} 🎉',
      'promo.partial': 'Діє не на всі товари в кошику.',
      'promo.notFound': 'Промокод не знайдено — перевірте написання',
      'promo.inactive': 'Промокод більше не діє',
      'promo.notStarted': 'Промокод почне діяти {date}',
      'promo.expired': 'Термін дії промокоду закінчився {date}',
      'promo.exhausted': 'Промокод вичерпано — його вже використали максимальну кількість разів',
      'promo.minTotal': 'Промокод діє від {min} — додайте товарів ще на {need}',
      'promo.noItems': 'Цей промокод не діє на жоден товар із кошика',
      'promo.noItemsCats': 'Промокод діє лише на категорії: {cats}. У кошику таких товарів немає',
      'promo.noItemsProducts': 'Промокод діє лише на: {products}. У кошику таких товарів немає',
      'promo.noItemsSale': 'Промокод не діє на товари, що вже зі знижкою',
      'cart.checkout': 'Оформити замовлення',
      'cart.freeLeft': 'До <strong>безкоштовної доставки</strong> білизни по Україні ще',
      'cart.freeDone': '<strong>🎉 Безкоштовна доставка</strong> білизни по Україні (при оплаті 100%)',
      'cart.remove': 'Видалити',
      'cart.less': 'Менше',
      'cart.more': 'Більше',
      'cart.back': '← Назад до кошика',
      'cart.name': 'ПІБ отримувача *',
      'cart.namePh': 'Шевченко Тарас Григорович',
      'cart.phone': 'Телефон *',
      'cart.email': 'Email — надішлемо підтвердження замовлення',
      'addr.carrier': 'Спосіб доставки',
      'addr.city': 'Місто',
      'addr.cityPh': 'почніть вводити назву',
      'addr.cityHint': 'Оберіть населений пункт зі списку — далі підтягнуться його відділення.',
      'addr.branch': 'Відділення або поштомат',
      'addr.branchPh': 'номер або вулиця',
      'addr.branchHint': 'Спочатку відділення, потім поштомати. Можна шукати за номером.',
      'addr.nWarehouses': '{n} відділень',
      'addr.postomat': 'поштомат',
      'addr.noCity': 'Такого населеного пункту не знайдено',
      'addr.noBranch': 'Нічого не знайдено — спробуйте інший номер або вулицю',
      'addr.pickCityFirst': 'Спершу оберіть місто',
      'addr.offline': 'Не вдалося звʼязатися з Новою Поштою — впишіть адресу вручну',
      'addr.country': 'Країна',
      'addr.pickCountry': '— оберіть країну —',
      'addr.countryOther': 'Назва країни',
      'addr.countryOtherPh': 'напр.: Хорватія',
      'addr.intlCity': 'Місто',
      'addr.state': 'Штат / область / провінція',
      'addr.street': 'Вулиця, будинок',
      'addr.streetPh': 'напр.: Marszałkowska 12',
      'addr.extra': 'Квартира, поверх, офіс',
      'addr.extraPh': 'необовʼязково',
      'addr.zip': 'Поштовий індекс',
      'addr.intlHint': 'Пишіть адресу латиницею — так її прочитає пошта країни призначення. Відправляємо за повної оплати.',
      'addr.needCity': 'Оберіть місто',
      'addr.needBranch': 'Оберіть відділення або поштомат',
      'addr.needCountry': 'Оберіть країну',
      'addr.needStreet': 'Вкажіть вулицю та будинок',
      'addr.needZip': 'Вкажіть поштовий індекс',
      'addr.needState': 'Для цієї країни штат обовʼязковий',
      'cart.delivery': 'Доставка',
      'cart.city': 'Місто',
      'cart.branch': 'Відділення / адреса',
      'cart.confirmTitle': 'Як підтвердити замовлення',
      'cart.byCall': 'Дзвінок',
      'cart.byMessenger': 'Месенджер',
      'cart.whichMessenger': 'Який месенджер',
      'cart.contactPhone': 'Номер для звʼязку',
      'cart.samePhone': 'Той самий',
      'cart.otherPhone': 'Інший номер',
      'cart.tgLogin': 'Логін у Telegram',
      'cart.tgHint': 'Необовʼязково. Якщо номер прихований у налаштуваннях Telegram, за логіном ми знайдемо вас напевно.',
      'cart.comment': 'Коментар',
      'cart.commentPh': 'Побажання до замовлення (необовʼязково)',
      'cart.submit': 'Підтвердити замовлення',
      'cart.submitNote': 'Менеджер звʼяжеться з вами для підтвердження',
      'cart.fillNamePhone': 'Заповніть імʼя та телефон',
      'cart.checkEmail': 'Перевірте email',
      'cart.doneTitle': 'прийнято!',
      'cart.doneText': 'Дякуємо 💙 Найближчим часом менеджер звʼяжеться з вами для підтвердження замовлення.',
      'cart.doneMail': 'Підтвердження з номером замовлення надіслано на',
      'cart.myOrders': 'Мої замовлення',
      'cart.keepShopping': 'Продовжити покупки',
      'cart.copied': 'Скопійовано ✓',
      'cart.order': 'Замовлення',

      'acc.title': 'Мій кабінет',
      'acc.profile': 'Профіль',
      'acc.orders': 'Мої замовлення',
      'acc.authNote': 'Увійдіть, щоб профіль та історія замовлень зберігалися в акаунті й були доступні з будь-якого пристрою. Замовляти можна й без входу 😊',
      'acc.google': 'Увійти через Google',
      'acc.orEmail': 'або з email',
      'acc.password': 'Пароль',
      'acc.passwordPh': 'мінімум 6 символів',
      'acc.login': 'Увійти',
      'acc.register': 'Зареєструватися',
      'acc.noAccount': 'Немає акаунта?',
      'acc.hasAccount': 'Вже є акаунт?',
      'acc.forgot': 'Забули пароль?',
      'acc.welcome': 'З поверненням! 💙',
      'acc.created': 'Акаунт створено ✓',
      'acc.resetSent': 'Лист для зміни пароля надіслано ✓',
      'acc.enterEmailFirst': 'Спершу впишіть email у поле вище',
      'acc.enterEmailPass': 'Введіть email і пароль',
      'acc.yourAccount': 'Ваш акаунт',
      'acc.logout': 'Вийти',
      'acc.loggedOut': 'Ви вийшли з акаунта',
      'acc.profileNote': 'Профіль зберігається в акаунті та підставляється під час оформлення замовлення.',
      'acc.profileNoteLocal': 'Дані зберігаються лише у вашому браузері та автоматично підставляються під час оформлення замовлення.',
      'acc.name': 'ПІБ',
      'acc.namePh': 'Шевченко Тарас Григорович',
      'acc.phone': 'Телефон',
      'acc.save': 'Зберегти',
      'acc.saved': 'Профіль збережено ✓',
      'acc.noOrders': 'Замовлень поки немає',
      'acc.noOrdersNote': 'Ваші замовлення зʼявляться тут.',
      'acc.loading': 'Завантажуємо замовлення…',
      'acc.ordersNote': 'Замовлення з вашого акаунта. Статус оновлюється, щойно ним займається менеджер.',
      'acc.ordersLocalNote': 'Історія зберігається у вашому браузері.',
      'acc.cloudDown': 'Хмарна база поки недоступна — показуємо замовлення з цього браузера.',
      'acc.repeat': 'Повторити',
      'acc.copy': 'Скопіювати',
      'acc.clear': 'Очистити історію',
      'acc.clearConfirm': 'Видалити всю історію замовлень із цього браузера?',
      'acc.gone': 'Цих товарів уже немає в каталозі',
      'acc.ttn': 'ТТН',

      'st.new': 'Нове',
      'st.confirmed': 'Підтверджено',
      'st.shipped': 'Відправлено',
      'st.done': 'Виконано',
      'st.cancelled': 'Скасовано',
      'st.newHint': 'Замовлення отримано — скоро підтвердимо',
      'st.confirmedHint': 'Менеджер підтвердив замовлення',
      'st.shippedHint': 'Посилка вже в дорозі',
      'st.doneHint': 'Замовлення доставлено',
      'st.cancelledFull': 'Замовлення скасовано',

      'meta.title': 'REYTER — Чоловіча білизна українського бренду',
      'meta.desc': 'Купити чоловічу білизну онлайн від українського бренду REYTER. Стильна та комфортна білизна. Доставка по Україні та за кордон.'
    },

    en: {
      'marquee': 'International delivery&ensp;✦&ensp;Worldwide shipping&ensp;✦&ensp;Free underwear delivery within Ukraine on orders over UAH 1500&ensp;✦&ensp;',

      'nav.about': 'About',
      'nav.catalog': 'Shop',
      'nav.size': 'Size guide',
      'nav.delivery': 'Delivery',
      'nav.contacts': 'Socials',
      'nav.drop': 'New drop&ensp;·&ensp;15.08',
      'nav.account': 'Your account',
      'nav.cart': 'Cart',
      'nav.menu': 'Open menu',
      'nav.top': 'REYTER — back to top',
      'nav.skip': 'Skip to catalogue',
      'nav.scrollTop': 'Scroll to top',

      'hero.badge': 'New drop — 15.08',
      'hero.title': 'Character is <span class="hero__brand">REYTER</span>',
      'hero.subtitle': '<strong>REYTER</strong> — men\'s underwear made in Ukraine. Comfort, confidence and your own style — from the very first touch of the fabric.',
      'hero.cta1': 'Shop the collection',
      'hero.cta2': 'Find your size',
      'hero.more': 'Read more about the brand',
      'hero.less': 'Hide',
      'hero.p1': 'The idea behind <strong>REYTER</strong> was born from a simple but important thought: underwear should be comfortable for everyone. We were looking for something that feels good, looks stylish and sits naturally on the body. We never found it — so we created our own.',
      'hero.p2': '<strong>REYTER</strong> is not only about fabrics and patterns. It is about character. About the inner strength you feel in every movement. We believe real strength starts from within — with comfort, confidence and your own style.',
      'hero.p3': 'Every man has his own character and strength. We are here to support you in that — from the first touch of the fabric on your skin.',
      'hero.trust1': 'Free delivery over UAH 1500',
      'hero.trust2': 'Dispatch within 1–2 days',
      'hero.trust3': 'Worldwide shipping',
      'hero.alt': 'REYTER — Ukrainian men\'s underwear brand',

      'fclub.title': 'Friendly Club ✨',
      'fclub.lead': 'A community of people who are part of Reyter',
      'fclub.btn': 'Join',
      'fclub.p1': '<strong>Friendly Club</strong> is a community of people who are part of Reyter.',
      'fclub.p2': 'Here we share early access to new drops, emotions, behind-the-scenes of the brand, special offers and other pleasant bonuses 😊',
      'fclub.p3': 'You do not apply to join the Friendly Club — it happens naturally, if you regularly choose Reyter, engage with the brand and stay part of our community 💙',
      'fclub.h2': 'How the Friendly Club is formed 🙃',
      'fclub.p4': 'We invite people who:',
      'fclub.li1': 'regularly choose Reyter;',
      'fclub.li2': 'engage with the brand on social media;',
      'fclub.li3': 'tag us in their posts or stories;',
      'fclub.li4': 'stay in touch with us and support our community.',
      'fclub.note': '*We look not only at purchases, but at genuine interest in the brand 🫂',

      'catalog.title': 'Our collection',
      'catalog.sub': 'Every piece is about comfort and character. Choose yours.',
      'catalog.noscript': 'The catalogue needs JavaScript enabled. You can also see everything on our',

      'size.title': 'Size guide',
      'size.sub': 'Measure your waist and hips — and find your perfect size.',
      'size.col1': 'Size',
      'size.col2': 'Waist (cm)',
      'size.col3': 'Hips (cm)',
      'size.caption': 'Click the image to enlarge',
      'size.alt': 'How to measure your waist and hips',

      'dlv.title': 'Payment & delivery',
      'dlv.pay': 'Payment',
      'dlv.payText': 'Bank transfer, card or PayPal',
      'dlv.fast': 'Fast dispatch',
      'dlv.fastText': 'We ship your order within 1–2 days',
      'dlv.carriers': 'Carriers',
      'dlv.carriersText': 'Nova Poshta, Ukrposhta and Meest',
      'dlv.intl': 'Worldwide shipping',
      'dlv.intlText': 'We ship worldwide — with full prepayment',
      'dlv.prepay': 'Full prepayment',
      'dlv.prepayText': 'Orders are dispatched after full payment only',
      'dlv.return': 'Exchange & returns',
      'dlv.returnText': 'Underwear cannot be returned or exchanged — under Resolution No. 172 of the Cabinet of Ministers of Ukraine, 19 March 1994',

      'contacts.title': 'Socials',
      'contacts.sub': 'Follow new drops and what happens behind the scenes.',
      'contacts.msgTitle': 'Get in touch',
      'contacts.msgSub': 'Message us in any messenger — we reply fast and help with any question.',

      'footer.slogan': 'Character is REYTER!',
      'footer.about': 'Men\'s underwear made in Ukraine.',
      'footer.offer': 'Public offer',
      'footer.policy': 'Privacy policy',
      'footer.copy': '© 2026 REYTER. Made with ❤️ in Ukraine.',
      'footer.fop': 'Officially registered — FOP Pats M.',

      'badge.sold': 'Sold out',
      'badge.sale': 'Sale',
      'badge.low': 'Low stock',

      'p.article': 'SKU',
      'p.inStock': 'In stock',
      'p.soldOut': 'Sold out',
      'p.lowStock': 'Low stock',
      'p.size': 'Size',
      'p.volume': 'Volume',
      'p.sizeHelp': 'How to choose a size?',
      'p.addToCart': 'Add to cart',

      'p.fabric': 'Fabric',
      'p.material': 'Composition',
      'p.aroma': 'Scent',
      'p.model': 'Model measurements',
      'p.features': 'Features',
      'p.care': 'Care instructions',
      'p.careDefault': 'Wash inside out at up to 30 °C',
      'p.note1': '<strong>Nova Poshta</strong> — we dispatch <em>the same day</em> for orders placed before 16:00',
      'p.note2': 'Underwear delivery within Ukraine is <em>free</em> on orders over UAH 1500 with full prepayment',
      'p.note3': 'We ship worldwide with full prepayment',
      'p.prev': 'Previous photo',
      'p.next': 'Next photo',
      'p.close': 'Close',
      'p.photos': 'Product photos',
      'p.chooseSize': 'Choose a size',
      'p.added': 'Added to cart ✓',
      'p.addedShort': 'Added',
      'p.goToCart': 'Go to cart',

      'cart.title': 'Cart',
      'cart.empty': 'Your cart is empty',
      'cart.emptyNote': 'Pick something from our collection — it is waiting 💙',
      'cart.goCatalog': 'Browse the collection',
      'cart.total': 'Total',
      'cart.subtotal': 'Items total',
      'cart.discount': 'Discount',
      'promo.notFoundGuest': 'Promo code not found. Personal codes only work inside an account — sign in and try again',
      'promo.notYours': 'This code was issued for {email}. Sign in to that account to use it',
      'promo.onAll': 'on the whole cart',
      'promo.onCats': 'on categories: {cats}',
      'promo.onProducts': 'on selected items ({n})',
      'promo.fromSum': 'from {sum}',
      'promo.noSale': 'excluding sale items',
      'promo.till': 'until {date}',
      'promo.stLive': 'Active',
      'promo.stOff': 'Disabled',
      'promo.stSoon': 'Not started',
      'promo.stExpired': 'Expired',
      'promo.stUsed': 'Used',
      'acc.myPromos': 'My discounts',
      'acc.promosNote': 'Personal promo codes issued to you. Tap “Apply” and the code goes straight into your cart.',
      'acc.noPromos': 'No personal discounts yet',
      'acc.noPromosNote': 'They will appear here as soon as we issue you a personal promo code.',
      'acc.promosGuest': 'Sign in to see your personal discounts.',
      'acc.applyPromo': 'Apply',
      'acc.copyPromo': 'Copy code',
      'acc.promoCopied': 'Code copied ✓',
      'promo.placeholder': 'Promo code',
      'promo.apply': 'Apply',
      'promo.applied': 'promo code applied',
      'promo.remove': 'Remove promo code',
      'promo.checking': 'Checking…',
      'promo.ok': 'You save {sum} 🎉',
      'promo.partial': 'Applies to some items in your cart.',
      'promo.notFound': 'Promo code not found — please check the spelling',
      'promo.inactive': 'This promo code is no longer active',
      'promo.notStarted': 'This promo code starts on {date}',
      'promo.expired': 'This promo code expired on {date}',
      'promo.exhausted': 'This promo code has reached its usage limit',
      'promo.minTotal': 'Valid from {min} — add {need} more to your cart',
      'promo.noItems': 'This code does not apply to any item in your cart',
      'promo.noItemsCats': 'Valid only for: {cats}. Your cart has no such items',
      'promo.noItemsProducts': 'Valid only for: {products}. Your cart has no such items',
      'promo.noItemsSale': 'This promo code does not apply to items already on sale',
      'cart.checkout': 'Place order',
      'cart.freeLeft': 'Add a bit more for <strong>free delivery</strong> within Ukraine:',
      'cart.freeDone': '<strong>🎉 Free delivery</strong> within Ukraine (with full prepayment)',
      'cart.remove': 'Remove',
      'cart.less': 'Less',
      'cart.more': 'More',
      'cart.back': '← Back to cart',
      'cart.name': 'Recipient full name *',
      'cart.namePh': 'Taras Shevchenko',
      'cart.phone': 'Phone *',
      'cart.email': 'Email — we will send your order confirmation',
      'addr.carrier': 'Delivery method',
      'addr.city': 'City',
      'addr.cityPh': 'start typing the name',
      'addr.cityHint': 'Pick a settlement from the list — its branches will load next.',
      'addr.branch': 'Branch or parcel locker',
      'addr.branchPh': 'number or street',
      'addr.branchHint': 'Branches first, then parcel lockers. You can search by number.',
      'addr.nWarehouses': '{n} branches',
      'addr.postomat': 'parcel locker',
      'addr.noCity': 'No such settlement found',
      'addr.noBranch': 'Nothing found — try another number or street',
      'addr.pickCityFirst': 'Choose a city first',
      'addr.offline': 'Could not reach Nova Poshta — please type the address manually',
      'addr.country': 'Country',
      'addr.pickCountry': '— choose a country —',
      'addr.countryOther': 'Country name',
      'addr.countryOtherPh': 'e.g. Croatia',
      'addr.intlCity': 'City',
      'addr.state': 'State / region / province',
      'addr.street': 'Street and number',
      'addr.streetPh': 'e.g. Marszalkowska 12',
      'addr.extra': 'Apartment, floor, office',
      'addr.extraPh': 'optional',
      'addr.zip': 'Postal code',
      'addr.intlHint': 'Write the address in Latin script so the destination post office can read it. We ship on full prepayment.',
      'addr.needCity': 'Choose a city',
      'addr.needBranch': 'Choose a branch or parcel locker',
      'addr.needCountry': 'Choose a country',
      'addr.needStreet': 'Enter street and number',
      'addr.needZip': 'Enter the postal code',
      'addr.needState': 'This country requires a state',
      'cart.delivery': 'Delivery',
      'cart.city': 'City',
      'cart.branch': 'Branch / address',
      'cart.confirmTitle': 'How to confirm the order',
      'cart.byCall': 'Phone call',
      'cart.byMessenger': 'Messenger',
      'cart.whichMessenger': 'Which messenger',
      'cart.contactPhone': 'Number to reach you',
      'cart.samePhone': 'Same one',
      'cart.otherPhone': 'Another number',
      'cart.tgLogin': 'Telegram username',
      'cart.tgHint': 'Optional. If your number is hidden in Telegram settings, a username makes sure we find you.',
      'cart.comment': 'Comment',
      'cart.commentPh': 'Any wishes for your order (optional)',
      'cart.submit': 'Confirm order',
      'cart.submitNote': 'Our manager will contact you to confirm the order',
      'cart.fillNamePhone': 'Please fill in your name and phone',
      'cart.checkEmail': 'Please check your email',
      'cart.doneTitle': 'received!',
      'cart.doneText': 'Thank you 💙 Our manager will contact you shortly to confirm your order.',
      'cart.doneMail': 'A confirmation with your order number has been sent to',
      'cart.myOrders': 'My orders',
      'cart.keepShopping': 'Continue shopping',
      'cart.copied': 'Copied ✓',
      'cart.order': 'Order',

      'acc.title': 'My account',
      'acc.profile': 'Profile',
      'acc.orders': 'My orders',
      'acc.authNote': 'Sign in so your profile and order history are saved to your account and available on any device. You can also order without signing in 😊',
      'acc.google': 'Continue with Google',
      'acc.orEmail': 'or with email',
      'acc.password': 'Password',
      'acc.passwordPh': 'at least 6 characters',
      'acc.login': 'Sign in',
      'acc.register': 'Create account',
      'acc.noAccount': 'No account yet?',
      'acc.hasAccount': 'Already have an account?',
      'acc.forgot': 'Forgot your password?',
      'acc.welcome': 'Welcome back! 💙',
      'acc.created': 'Account created ✓',
      'acc.resetSent': 'Password reset email sent ✓',
      'acc.enterEmailFirst': 'Enter your email in the field above first',
      'acc.enterEmailPass': 'Enter your email and password',
      'acc.yourAccount': 'Your account',
      'acc.logout': 'Sign out',
      'acc.loggedOut': 'You have signed out',
      'acc.profileNote': 'Your profile is saved to your account and filled in automatically at checkout.',
      'acc.profileNoteLocal': 'Your details are stored only in this browser and filled in automatically at checkout.',
      'acc.name': 'Full name',
      'acc.namePh': 'Taras Shevchenko',
      'acc.phone': 'Phone',
      'acc.save': 'Save',
      'acc.saved': 'Profile saved ✓',
      'acc.noOrders': 'No orders yet',
      'acc.noOrdersNote': 'Your orders will appear here.',
      'acc.loading': 'Loading your orders…',
      'acc.ordersNote': 'Orders from your account. The status updates as soon as a manager handles it.',
      'acc.ordersLocalNote': 'History is stored in this browser.',
      'acc.cloudDown': 'The cloud is unavailable right now — showing orders from this browser.',
      'acc.repeat': 'Order again',
      'acc.copy': 'Copy',
      'acc.clear': 'Clear history',
      'acc.clearConfirm': 'Delete all order history from this browser?',
      'acc.gone': 'These items are no longer in the catalogue',
      'acc.ttn': 'Tracking',

      'st.new': 'New',
      'st.confirmed': 'Confirmed',
      'st.shipped': 'Shipped',
      'st.done': 'Completed',
      'st.cancelled': 'Cancelled',
      'st.newHint': 'Order received — we will confirm it shortly',
      'st.confirmedHint': 'Your order has been confirmed',
      'st.shippedHint': 'Your parcel is on its way',
      'st.doneHint': 'Order delivered',
      'st.cancelledFull': 'Order cancelled',

      'meta.title': 'REYTER — Men\'s underwear from a Ukrainian brand',
      'meta.desc': 'Buy men\'s underwear online from the Ukrainian brand REYTER. Stylish and comfortable. Delivery across Ukraine and worldwide.'
    }
  };

  /* ---------- Словник даних каталогу ----------
     Спершу пробуємо цілу фразу, потім — заміну окремих слів. */

  const PHRASES = {
    /* категорії */
    'Сорочки': 'Shirts',
    'Новинки': 'New arrivals',
    'Майки': 'Tank tops',
    'Джоки': 'Jockstraps',
    'Рубчик': 'Ribbed',
    'Бріфи': 'Briefs',
    'Комплекти': 'Sets',
    'Для неї': 'For her',

    /* тканини та склад */
    'Кулір': 'Cotton jersey',
    'Бавовна 95%, еластан 5%': 'Cotton 95%, elastane 5%',
    'Віскоза 95%, еластан 5%': 'Viscose 95%, elastane 5%',
    '100% бавовна': '100% cotton',
    'Бавовна 100%': 'Cotton 100%',
    'Еконіл 78%, спандекс 22%': 'Econyl 78%, spandex 22%',
    'Деревʼяний гніт, соєвий віск, натуральні аромаолії': 'Wooden wick, soy wax, natural fragrance oils',
    'Натуральна (косметична) аромаолія, база для аромадифузорів': 'Natural (cosmetic) fragrance oil, diffuser base',
    'Бренді & груша': 'Brandy & pear',

    /* особливості */
    'Еластичний матеріал': 'Stretchy fabric',
    'Комфортна посадка': 'Comfortable fit',
    'Міцна фурнітура': 'Durable hardware',
    'Мʼяка та дихаюча тканина': 'Soft, breathable fabric',
    'Приємна на дотик': 'Pleasant to the touch',
    'Довготривалий колір': 'Long-lasting colour',
    'Стійкість до хлору і солі': 'Chlorine and salt resistant',
    'Швидке висихання': 'Quick-drying',

    /* догляд */
    'Машинне прання 30 °C': 'Machine wash at 30 °C',
    'Делікатний режим': 'Delicate cycle',
    'Сушіння на повітрі': 'Air dry',
    'Прання в холодній воді': 'Cold water wash',
    'Не використовуйте пральну машину': 'Do not machine wash',
    'Сушіння вдалині від сонця': 'Dry away from sunlight',
    'Прання навиворіт при температурі до 30 °C': 'Wash inside out at up to 30 °C',

    /* примітки */
    'Білизна для басейну, пляжу та активного відпочинку.': 'Swimwear for the pool, beach and active leisure.',
    'Сімейні боксери — індивідуальна модель для щоденного комфорту.': 'Loose-fit boxers — a signature model for everyday comfort.',
    '*Мають мішечок для зручної посадки.': '*With a contour pouch for a comfortable fit.',
    '❗️Після кожного використання свічки з деревʼяним гнітом акуратно приберіть обгорілу частину гніту.': '❗️After each use, carefully trim the burnt part of the wooden wick.',
    'Економія 5% при покупці комплектом': 'Save 5% when buying the full set'
  };

  /* Заміна окремих слів — для назв товарів і мірок.
     Межі слова задані через \p{L}: \b у JS не працює з кирилицею. */
  const WORDS = [
    [/(^|[^\p{L}])Сорочка(?![\p{L}])/gu, '$1Shirt'],
    [/(^|[^\p{L}])Бріфи(?![\p{L}])/gu, '$1Briefs'],
    [/(^|[^\p{L}])Майка(?![\p{L}])/gu, '$1Tank top'],
    [/(^|[^\p{L}])Комплект(?![\p{L}])/gu, '$1Set'],
    [/(^|[^\p{L}])Свічка(?![\p{L}])/gu, '$1Candle'],
    [/\(подовжені\)/gu, '(long)'],
    [/(^|[^\p{L}])талія(?![\p{L}])/gu, '$1waist'],
    [/(^|[^\p{L}])груди(?![\p{L}])/gu, '$1chest'],
    [/(^|[^\p{L}])сідниці(?![\p{L}])/gu, '$1hips'],
    [/(^|[^\p{L}])см(?![\p{L}])/gu, '$1cm'],
    [/(^|[^\p{L}])кг(?![\p{L}])/gu, '$1kg'],
    [/(^|[^\p{L}])мл(?![\p{L}])/gu, '$1ml']
  ];

  /* ---------- Двигун ---------- */

  let lang = 'uk';

  function detect() {
    const url = new URLSearchParams(location.search).get('lang');
    if (url === 'en' || url === 'uk') return url;
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'en' || saved === 'uk') return saved;
    } catch (e) { /* приватний режим */ }
    return (navigator.language || '').toLowerCase().startsWith('uk') ? 'uk' : 'uk';
  }

  R.t = function (key) {
    const table = UI[lang] || UI.uk;
    return table[key] !== undefined ? table[key] : (UI.uk[key] !== undefined ? UI.uk[key] : key);
  };

  /* Переклад даних каталогу */
  R.tx = function (text) {
    if (lang === 'uk' || !text) return text || '';
    const raw = String(text).trim();
    if (PHRASES[raw]) return PHRASES[raw];

    let out = raw;
    WORDS.forEach(([re, to]) => { out = out.replace(re, to); });
    return out;
  };

  /* Поле з можливим ручним перекладом: name → nameEn */
  R.tf = function (obj, field) {
    if (!obj) return '';
    if (lang === 'en') {
      const manual = obj[field + 'En'];
      if (manual) return manual;
      return R.tx(obj[field]);
    }
    return obj[field] || '';
  };

  R.lang = function () {
    return lang;
  };

  /* ---------- Застосування до розмітки ---------- */

  function applyDOM() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.innerHTML = R.t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(';').forEach((pair) => {
        const [attr, key] = pair.split(':');
        if (attr && key) el.setAttribute(attr.trim(), R.t(key.trim()).replace(/<[^>]+>/g, ''));
      });
    });

    document.documentElement.lang = lang;
    document.title = R.t('meta.title');
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', R.t('meta.desc'));

    document.querySelectorAll('.lang-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.lang === lang);
    });
  }

  function setLang(next) {
    if (next === lang) return;
    lang = next;
    try { localStorage.setItem(KEY, lang); } catch (e) { /* ігноруємо */ }

    applyDOM();
    if (R.refreshCatalog) R.refreshCatalog();
    document.dispatchEvent(new CustomEvent('lang:changed', { detail: lang }));
  }

  R.setLang = setLang;

  R.initI18n = function () {
    lang = detect();
    applyDOM();

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.lang-btn');
      if (btn) setLang(btn.dataset.lang);
    });
  };
})();
