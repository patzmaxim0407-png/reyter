/* ============================================================
   REYTER — дві мови
   ------------------------------------------------------------
   Українська за замовчуванням, англійська — лише за явним
   вибором (див. detectLang). Тут немає DOM і немає стану: мову
   передають аргументом, тож ті самі функції працюють і в
   серверному рендері, і в браузері.

   Три різні задачі перекладу:
   • t()  — статичні рядки інтерфейсу з таблиць нижче;
   • tf() — поле каталогу, у якого може бути ручний переклад
            (name → nameEn);
   • tx() — те саме поле, якщо ручного перекладу немає: словник
            фраз, а далі заміна окремих слів.

   Портовано з js/i18n.js один в один — поки старий сайт живий
   поруч, сторінки мають читатися однаково.
   ============================================================ */

import type { Lang } from './types';

export const LANGS: readonly Lang[] = ['uk', 'en'];

/* ---------- Рядки інтерфейсу ----------
   Плейсхолдери на кшталт {date} чи {sum} підставляє той, хто
   викликає: t() навмисно нічого не форматує — так робив і
   оригінал, і місця підстановки лишаються видимими в коді.

   Значення містять HTML (<strong>, &ensp;) — рядки вставляються
   як розмітка, а не як текст. */

const uk = {
  'marquee': 'Міжнародна доставка&ensp;✦&ensp;International delivery&ensp;✦&ensp;Безкоштовна доставка на білизну по Україні від 1500 грн&ensp;✦&ensp;',

  'nav.about': 'Про нас',
  'nav.catalog': 'Позиції',
  'nav.size': 'Розмірна сітка',
  'nav.delivery': 'Доставка',
  'nav.contacts': 'Соц мережі',
  'nav.drop': 'New drop',
  'nav.account': 'Кабінет користувача',
  'nav.cart': 'Кошик',
  'nav.menu': 'Відкрити меню',
  'nav.top': 'REYTER — на початок сторінки',
  'nav.skip': 'Перейти до каталогу',
  'nav.scrollTop': 'Прокрутити догори',

  'hero.badge': 'New drop',
  'hero.title': 'Характер — це <span class="hero__brand">REYTER</span>',
  'hero.subtitle': '<strong>REYTER</strong> — чоловіча білизна українського виробництва. Комфорт, впевненість і власний стиль — з першого дотику тканини.',
  'hero.cta1': 'Дивитися позиції',
  'hero.cta2': 'Підібрати розмір',
  'hero.more': 'Читати більше про бренд',
  'hero.less': 'Приховати',
  'hero.p1': 'Ідея створити <strong>REYTER</strong> народилася з простої, але важливої думки: білизна має бути зручною для всіх. Ми шукали щось, що дарує комфорт, виглядає стильно і водночас відчувається природно на тілі. Але не знайшли. Тож вирішили створити власне.',
  'hero.p2': '<strong>REYTER</strong> — це не лише про тканини та лекала. Це про характер. Про внутрішню силу, що відчувається у кожному русі. Ми віримо: справжня сила починається зсередини — з комфорту, впевненості та власного стилю.',
  'hero.p3': 'Кожен чоловік має свій характер і силу. І ми тут, аби підтримати вас в цьому — з першого дотику тканини до тіла.',
  /* Саме «білизни по Україні»: поріг не діє ні на домашній
     одяг, ні за кордон, і коротший напис обіцяв зайве. */
  /* Оплата карткою */
  'pay.waiting': 'Перевіряємо оплату…',
  'pay.again': 'Оплатити замовлення',
  'pay.opening': 'Відкриваємо оплату…',
  'pay.pendingTitle': 'Замовлення №{n} чекає на оплату',
  'pay.pendingText': 'Оплата не завершилась — товар за вами не закріплений, поки гроші не надійдуть. Замовлення збережено, оплатити можна зараз.',
  'pay.done': 'Оплату отримано',
  'pay.back': 'Кошти за цим замовленням повернуто.',
  'pay.failed': 'Оплата не пройшла.',
  'pay.failedNext': 'Замовлення збережено — ми надішлемо посилання на оплату ще раз.',
  'hero.trust1': 'Безкоштовна доставка білизни по Україні від 1500 грн',
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
  'fclub.play': 'Відтворити відео',

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
  'dlv.intlText': 'Надсилаємо замовлення по всьому світу — <strong>Nova Post</strong> або <strong>Meest</strong>, за повної оплати',
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
  'footer.address': 'Київ, вул. Магнітогорська, 1а',

  'badge.sold': 'Продано',
  'badge.sale': 'Sale',
  'badge.low': 'Закінчується',

  'p.article': 'Артикул',
  'p.inStock': 'В наявності',
  'p.soldOut': 'Продано',
  'p.lowStock': 'Закінчується',
  'p.size': 'Розмір',
  'p.color': 'Колір',
  'p.thisColor': 'поточний колір',
  'p.volume': 'Обʼєм',
  'p.sizeHelp': 'Як обрати розмір?',
  'p.addToCart': 'Додати в кошик',

  'p.notFound': 'Товар не знайдено',
  'p.metaDelivery': 'Доставка по Україні та за кордон.',
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
  'p.setSizes': 'Складники комплекту',
  'p.setParts': 'Складники комплекту',
  'p.goCart': 'Перейти в кошик',
  'p.fewLeft': 'Залишилось мало — устигніть забрати',
  'p.setNote': 'Оберіть розмір для кожної речі — комплект збереться саме під вас.',
  'p.chooseSetSizes': 'Оберіть розмір для кожної речі комплекту',
  'p.onePiece': 'один розмір',
  'eta.expected': 'Очікується ~{date}',
  'eta.expectedSize': 'Розмір {size}: очікується ~{date}',
  'eta.noDate': 'Цього розміру зараз немає',
  'eta.noDateAll': 'Товар тимчасово розпроданий',
  'eta.notify': 'Повідомити, коли зʼявиться',
  'eta.emailPh': 'ваша пошта',
  'eta.done': 'Повідомимо на {email}, щойно зʼявиться ✓',
  'eta.badEmail': 'Перевірте пошту — щось не так із адресою',
  'eta.fail': 'Не вдалося зберегти — спробуйте ще раз',
  'p.added': 'Додано в кошик ✓',
  'p.addedShort': 'Додано',
  'p.goToCart': 'Перейти в кошик',

  'cart.title': 'Кошик',
  'cart.empty': 'Кошик порожній',
  'cart.emptyNote': 'Оберіть позицію — вона зʼявиться тут.',
  'cart.goCatalog': 'До каталогу',
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
  'promo.dropped': 'Промокод більше не діє — перевірте суму замовлення',
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
  'cart.email': 'Email * — надішлемо підтвердження замовлення',
  'admin.noProduct': 'Товар не знайдено — спробуйте артикул',
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
  'addr.intlCityPh': 'напр.: Warsaw',
  'addr.intlCityHint': 'Пишіть латиницею — так місто знайдеться в довіднику Nova Post.',
  'addr.intlMode': 'Куди доставити',
  'addr.modeBranch': 'У відділення або поштомат',
  'addr.modeAddress': 'Курʼєром на адресу',
  'addr.intlBranch': 'Відділення, поштомат або пункт видачі',
  'addr.intlBranchHint': 'Оберіть пункт зі списку — вулиця й індекс тоді не потрібні. У великих містах їх тисячі, тож найпевніше шукати за номером.',
  'addr.pudo': 'пункт видачі',
  'addr.localPhone': 'Для видачі потрібен місцевий номер отримувача: український приймають лише у власних відділеннях Nova Post.',
  'addr.building': 'Будинок',
  'addr.flat': 'Квартира',
  'addr.flatPh': 'до 10 знаків',
  'addr.note': 'Коментар курʼєру',
  'addr.notePh': 'необовʼязково',
  'addr.reg': 'Адреса реєстрації отримувача',
  'addr.regHint': 'Ця країна вимагає її окремо — без неї посилку не приймуть.',
  'addr.needBuilding': 'Вкажіть номер будинку',
  'addr.pickFromList': 'Оберіть зі списку — так перевізник знатиме, куди везти',
  'addr.noCountry': 'Такої країни в списку немає — оберіть «Інша країна»',
  'addr.noStreet': 'Такої вулиці в довіднику немає — впишіть її як є',
  'addr.needLatin': 'Пишіть латиницею — цього вимагає перевізник',
  'addr.needRegCity': 'Вкажіть місто реєстрації',
  'addr.needRegStreet': 'Вкажіть вулицю реєстрації',
  'addr.pickCountryFirst': 'Спершу оберіть країну',
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
  'co.who': 'Отримувач',
  'co.order': 'Замовлення',
  'co.authTitle': 'Зберігайте замовлення в кабінеті',
  'co.authNote': 'Один клік: новий акаунт створиться автоматично, а якщо він уже є — ви просто увійдете.',
  'co.authGoogle': 'Продовжити з Google',
  'co.authBusy': 'Відкриваємо Google…',
  'co.authSuccess': 'Акаунт готовий — замовлення збережеться в кабінеті ✓',
  'cart.delivery': 'Доставка',
  'dlv.branch': 'Оплачу у відділенні при отриманні',
  'dlv.order': 'Оплачу разом із замовленням',
  'dlv.who': 'Хто платить за доставку',
  'dlv.free': 'Безкоштовно',
  'dlv.about': 'орієнтовно',
  'dlv.pick': 'Оберіть місто й відділення — і побачите вартість',
  'dlv.pickIntl': 'Оберіть країну й місто — і побачимо вартість',
  'dlv.atBranch': 'оплата у відділенні',
  'dlv.intlNote': 'Доставку за кордон оплачує відправник, тож вона входить у суму замовлення. Остаточну суму підтвердимо перед відправленням.',
  'cart.city': 'Місто',
  'cart.branch': 'Відділення / адреса',
  'cart.confirmTitle': 'Спосіб звʼязку для підтвердження замовлення',
  'co.noContact': 'Не потрібно звʼязуватись — підтверджую замовлення',
  'co.noContactHint': 'Ми лише надішлемо лист із підтвердженням і номером накладної.',
  'co.contactHow': 'Як із вами звʼязатись',
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
  /* Кнопка каже, що буде далі: не «підтвердити», а перехід на
     оплату. Людина має знати про списання ДО того, як натисне. */
  'cart.submit': 'Онлайн оплата',
  'cart.submitNote': 'Далі — захищена сторінка Monobank. Замовлення підтвердимо після оплати',
  'cart.sending': 'Надсилаємо…',
  'cart.fillNamePhone': 'Заповніть імʼя та телефон',
  'cart.checkEmail': 'Вкажіть email — на нього прийде підтвердження',
  'cart.doneTitle': 'прийнято!',
  'cart.doneText': 'Дякуємо 💙 Найближчим часом менеджер звʼяжеться з вами для підтвердження замовлення.',
  'cart.doneMail': 'Підтвердження з номером замовлення надіслано на',
  'cart.myOrders': 'Мої замовлення',
  'cart.keepShopping': 'Продовжити покупки',
  'cart.copied': 'Скопійовано ✓',
  'cart.copyFail': 'Не вдалося скопіювати — виділіть текст вручну',
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
  'acc.verify': 'Перевірте пошту й підтвердіть адресу — інакше замовлення, оформлені до реєстрації, і персональні знижки лишаться невидимими',
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
  'adr.title': 'Мої адреси',
  'adr.empty': 'Збережених адрес поки немає. Додайте — і в кошику зможете обрати її одним дотиком.',
  'adr.add': 'Додати адресу',
  'adr.newTitle': 'Нова адреса',
  'adr.editTitle': 'Редагування адреси',
  'adr.label': 'Назва (для себе)',
  'adr.labelPh': 'напр.: Дім, Робота, Мамі',
  'adr.save': 'Зберегти адресу',
  'adr.cancel': 'Скасувати',
  'adr.saved': 'Адресу збережено ✓',
  'adr.removed': 'Адресу прибрано',
  'adr.remove': 'Прибрати адресу',
  'adr.edit': 'Змінити',
  'adr.default': 'основна',
  'adr.makeDefault': 'Зробити основною',
  'adr.defaultSet': 'Основну адресу змінено ✓',
  'adr.where': 'Куди доставити',
  'adr.newHere': 'Інша адреса',
  'adr.newHint': 'ввести вручну',
  'adr.saveToProfile': 'Зберегти цю адресу в профіль',
  'adr.editHere': 'Змінити адресу для цього замовлення',
  'trk.divider': 'Замовляли без акаунта?',
  'trk.num': 'Номер замовлення',
  'trk.phone': 'Телефон із замовлення',
  'trk.find': 'Знайти замовлення',
  'trk.searching': 'Шукаємо…',
  'trk.needNum': 'Вкажіть номер замовлення — він є в листі-підтвердженні.',
  'trk.needPhone': 'Вкажіть телефон, який ви залишили при оформленні.',
  'trk.notFound': 'Замовлення не знайдено. Перевірте номер і телефон — вони мають бути ті самі, що й при оформленні.',
  'trk.offline': 'Не вдалося звʼязатися з базою. Спробуйте ще раз за хвилину.',
  'cart.trackNote': 'Збережіть номер: за ним і телефоном можна відстежити замовлення в кабінеті, навіть без реєстрації.',
  'acc.ordersLocalNote': 'Історія зберігається у вашому браузері.',
  'acc.cloudDown': 'Хмарна база поки недоступна — показуємо замовлення з цього браузера.',
  'acc.repeat': 'Повторити',
  'acc.copy': 'Скопіювати',
  'acc.gone': 'Цих товарів уже немає в каталозі',
  'acc.ttn': 'ТТН',

  /* Шапка кабінету */
  'acc.guest': 'Вітаємо!',
  'acc.guestSub': 'Увійдіть, щоб побачити профіль, знижки та історію замовлень.',
  'acc.since': 'З нами з {date}',
  'acc.statOrders': 'Замовлень',
  'acc.statSpent': 'На суму',
  'acc.statPromos': 'Знижок напоготові',
  'acc.navHint': 'Розділи кабінету',

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
};

/** Ключі беруться з української таблиці: вона еталонна.
 *  Через це англійська нижче не збереться, якщо в ній
 *  загубиться або зайвим виявиться хоч один ключ. */
export type UIKey = keyof typeof uk;
export type UITable = Readonly<Record<UIKey, string>>;

const en: Record<UIKey, string> = {
  'marquee': 'International delivery&ensp;✦&ensp;Worldwide shipping&ensp;✦&ensp;Free underwear delivery within Ukraine on orders over UAH 1500&ensp;✦&ensp;',

  'nav.about': 'About',
  'nav.catalog': 'Shop',
  'nav.size': 'Size guide',
  'nav.delivery': 'Delivery',
  'nav.contacts': 'Socials',
  'nav.drop': 'New drop',
  'nav.account': 'Your account',
  'nav.cart': 'Cart',
  'nav.menu': 'Open menu',
  'nav.top': 'REYTER — back to top',
  'nav.skip': 'Skip to catalogue',
  'nav.scrollTop': 'Scroll to top',

  'hero.badge': 'New drop',
  'hero.title': 'Character is <span class="hero__brand">REYTER</span>',
  'hero.subtitle': '<strong>REYTER</strong> — men\'s underwear made in Ukraine. Comfort, confidence and your own style — from the very first touch of the fabric.',
  'hero.cta1': 'Shop the collection',
  'hero.cta2': 'Find your size',
  'hero.more': 'Read more about the brand',
  'hero.less': 'Hide',
  'hero.p1': 'The idea behind <strong>REYTER</strong> was born from a simple but important thought: underwear should be comfortable for everyone. We were looking for something that feels good, looks stylish and sits naturally on the body. We never found it — so we created our own.',
  'hero.p2': '<strong>REYTER</strong> is not only about fabrics and patterns. It is about character. About the inner strength you feel in every movement. We believe real strength starts from within — with comfort, confidence and your own style.',
  'hero.p3': 'Every man has his own character and strength. We are here to support you in that — from the first touch of the fabric on your skin.',
  'pay.waiting': 'Checking your payment…',
  'pay.again': 'Pay for this order',
  'pay.opening': 'Opening payment…',
  'pay.pendingTitle': 'Order No. {n} is awaiting payment',
  'pay.pendingText': 'The payment was not completed — the items are not reserved until the money arrives. Your order is saved, you can pay now.',
  'pay.done': 'Payment received',
  'pay.back': 'This order has been refunded.',
  'pay.failed': 'The payment did not go through.',
  'pay.failedNext': 'Your order is saved — we will send a new payment link.',
  'hero.trust1': 'Free underwear delivery in Ukraine over UAH 1500',
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
  'fclub.play': 'Play video',

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
  'dlv.intlText': 'We ship worldwide — <strong>Nova Post</strong> or <strong>Meest</strong>, with full prepayment',
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
  'footer.address': 'Kyiv, 1a Mahnitohorska St.',

  'badge.sold': 'Sold out',
  'badge.sale': 'Sale',
  'badge.low': 'Low stock',

  'p.article': 'SKU',
  'p.inStock': 'In stock',
  'p.soldOut': 'Sold out',
  'p.lowStock': 'Low stock',
  'p.size': 'Size',
  'p.color': 'Colour',
  'p.thisColor': 'current colour',
  'p.volume': 'Volume',
  'p.sizeHelp': 'How to choose a size?',
  'p.addToCart': 'Add to cart',

  'p.notFound': 'Product not found',
  'p.metaDelivery': 'Delivery across Ukraine and worldwide.',
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
  'p.setSizes': 'Items in this set',
  'p.setParts': 'Set contents',
  'p.goCart': 'Go to cart',
  'p.fewLeft': 'Only a few left — grab yours',
  'p.setNote': 'Pick a size for each item — the set is assembled to fit you.',
  'p.chooseSetSizes': 'Choose a size for every item in the set',
  'p.onePiece': 'one size',
  'eta.expected': 'Expected ~{date}',
  'eta.expectedSize': 'Size {size}: expected ~{date}',
  'eta.noDate': 'This size is out of stock',
  'eta.noDateAll': 'Temporarily sold out',
  'eta.notify': 'Notify me when available',
  'eta.emailPh': 'your email',
  'eta.done': 'We will email {email} as soon as it arrives ✓',
  'eta.badEmail': 'Please check the email address',
  'eta.fail': 'Could not save — please try again',
  'p.added': 'Added to cart ✓',
  'p.addedShort': 'Added',
  'p.goToCart': 'Go to cart',

  'cart.title': 'Cart',
  'cart.empty': 'Your cart is empty',
  'cart.emptyNote': 'Choose an item and it will appear here right away.',
  'cart.goCatalog': 'Browse catalogue',
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
  'promo.dropped': 'The promo code is no longer valid — please check the total',
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
  'cart.email': 'Email * — we will send your order confirmation',
  'admin.noProduct': 'No product found — try the article number',
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
  'addr.intlCityPh': 'e.g. Warsaw',
  'addr.intlCityHint': 'Use Latin letters — that is how Nova Post finds the city.',
  'addr.intlMode': 'Where to deliver',
  'addr.modeBranch': 'Branch or parcel locker',
  'addr.modeAddress': 'Courier to the address',
  'addr.intlBranch': 'Branch, parcel locker or pickup point',
  'addr.intlBranchHint': 'Pick a point from the list — no street or postcode needed. Big cities have thousands, so search by number.',
  'addr.pudo': 'pickup point',
  'addr.localPhone': 'Pickup abroad needs a local phone number; a Ukrainian one works only at Nova Post own branches.',
  'addr.building': 'Building',
  'addr.flat': 'Apartment',
  'addr.flatPh': 'up to 10 characters',
  'addr.note': 'Note for the courier',
  'addr.notePh': 'optional',
  'addr.reg': "Recipient's registered address",
  'addr.regHint': 'This country requires it separately — the parcel will not be accepted without it.',
  'addr.needBuilding': 'Enter the building number',
  'addr.pickFromList': 'Pick from the list so the carrier knows where to deliver',
  'addr.noCountry': 'No such country in the list — choose "Other country"',
  'addr.noStreet': 'Not in the directory — just type it in',
  'addr.needLatin': 'Use Latin letters — the carrier requires it',
  'addr.needRegCity': 'Enter the city of registration',
  'addr.needRegStreet': 'Enter the street of registration',
  'addr.pickCountryFirst': 'Choose a country first',
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
  'co.who': 'Recipient',
  'co.order': 'Your order',
  'co.authTitle': 'Keep your orders in your account',
  'co.authNote': 'One click: a new account is created automatically, or you are signed in if it already exists.',
  'co.authGoogle': 'Continue with Google',
  'co.authBusy': 'Opening Google…',
  'co.authSuccess': 'Your account is ready — this order will be saved there ✓',
  'cart.delivery': 'Delivery',
  'dlv.branch': "I'll pay at the branch on pickup",
  'dlv.order': "I'll pay together with the order",
  'dlv.who': 'Who pays for delivery',
  'dlv.free': 'Free',
  'dlv.about': 'approx.',
  'dlv.pick': 'Choose a city and branch to see the cost',
  'dlv.pickIntl': 'Choose a country and city to see the cost',
  'dlv.atBranch': 'paid at the branch',
  'dlv.intlNote': 'International delivery is paid by the sender, so it is included in the order total. We will confirm the final amount before shipping.',
  'cart.city': 'City',
  'cart.branch': 'Branch / address',
  'cart.confirmTitle': 'How we confirm your order',
  'co.noContact': "No need to contact me — I confirm the order",
  'co.noContactHint': 'We will only email you the confirmation and the tracking number.',
  'co.contactHow': 'How to reach you',
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
  'cart.submit': 'Online payment',
  'cart.submitNote': 'Next is a secure Monobank page. We confirm the order once it is paid',
  'cart.sending': 'Sending…',
  'cart.fillNamePhone': 'Please fill in your name and phone',
  'cart.checkEmail': 'Enter your email — the confirmation goes there',
  'cart.doneTitle': 'received!',
  'cart.doneText': 'Thank you 💙 Our manager will contact you shortly to confirm your order.',
  'cart.doneMail': 'A confirmation with your order number has been sent to',
  'cart.myOrders': 'My orders',
  'cart.keepShopping': 'Continue shopping',
  'cart.copied': 'Copied ✓',
  'cart.copyFail': 'Could not copy — please select the text manually',
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
  'acc.verify': 'Check your inbox and confirm your address — otherwise orders placed before signing up and personal discounts stay invisible',
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
  'adr.title': 'My addresses',
  'adr.empty': 'No saved addresses yet. Add one and you will be able to pick it at checkout in a single tap.',
  'adr.add': 'Add address',
  'adr.newTitle': 'New address',
  'adr.editTitle': 'Edit address',
  'adr.label': 'Name (for yourself)',
  'adr.labelPh': 'e.g. Home, Work, Mum',
  'adr.save': 'Save address',
  'adr.cancel': 'Cancel',
  'adr.saved': 'Address saved ✓',
  'adr.removed': 'Address removed',
  'adr.remove': 'Remove address',
  'adr.edit': 'Edit',
  'adr.default': 'default',
  'adr.makeDefault': 'Make default',
  'adr.defaultSet': 'Default address changed ✓',
  'adr.where': 'Deliver to',
  'adr.newHere': 'Another address',
  'adr.newHint': 'enter manually',
  'adr.saveToProfile': 'Save this address to my profile',
  'adr.editHere': 'Change the address for this order',
  'trk.divider': 'Ordered as a guest?',
  'trk.num': 'Order number',
  'trk.phone': 'Phone from the order',
  'trk.find': 'Find my order',
  'trk.searching': 'Searching…',
  'trk.needNum': 'Enter the order number — you will find it in the confirmation email.',
  'trk.needPhone': 'Enter the phone number you left at checkout.',
  'trk.notFound': 'Order not found. Check the number and the phone — they must match the ones used at checkout.',
  'trk.offline': 'Could not reach the database. Please try again in a minute.',
  'cart.trackNote': 'Keep the number: together with your phone it lets you track the order in your account, even without signing up.',
  'acc.ordersLocalNote': 'History is stored in this browser.',
  'acc.cloudDown': 'The cloud is unavailable right now — showing orders from this browser.',
  'acc.repeat': 'Order again',
  'acc.copy': 'Copy',
  'acc.gone': 'These items are no longer in the catalogue',
  'acc.ttn': 'Tracking',

  'acc.guest': 'Welcome!',
  'acc.guestSub': 'Sign in to view your profile, discounts and order history.',
  'acc.since': 'With us since {date}',
  'acc.statOrders': 'Orders',
  'acc.statSpent': 'Total',
  'acc.statPromos': 'Discounts ready',
  'acc.navHint': 'Account sections',

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
};

export const UI: Readonly<Record<Lang, UITable>> = { uk, en };

/* ---------- Словник даних каталогу ----------
   Назви, склад, догляд тощо пишуться в адмінці українською.
   Спершу пробуємо цілу фразу, потім — заміну окремих слів. */

const PHRASES: Readonly<Record<string, string>> = {
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
const WORDS: ReadonlyArray<readonly [RegExp, string]> = [
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

/* ============================================================
   ДВИГУН
   ============================================================ */

export function isLang(v: unknown): v is Lang {
  return v === 'uk' || v === 'en';
}

/** Пошук у таблиці за ключем, якого може не бути.
 *  Ключі UI типізовані, але t() приймає й довільний рядок —
 *  каталог і статуси збирають ключі на льоту ('st.' + status). */
function lookup(table: UITable, key: string): string | undefined {
  return (table as Readonly<Record<string, string | undefined>>)[key];
}

/** Рядок інтерфейсу.
 *  Якщо ключа немає ніде, повертаємо сам ключ: на сторінці видно
 *  'cart.title' — це помітно одразу, на відміну від порожнечі. */
export function t(key: UIKey | (string & {}), lang: Lang = 'uk'): string {
  // Мова могла прийти з адреси чи localStorage — там буває що завгодно.
  const table = UI[lang] ?? UI.uk;
  const hit = lookup(table, key);
  if (hit !== undefined) return hit;

  // Порожній рядок теж вважається перекладом: звіряємось із undefined,
  // а не з truthy — інакше '' підмінявся б українським текстом.
  const fallback = lookup(UI.uk, key);
  return fallback !== undefined ? fallback : key;
}

/* ---------- Дані каталогу ---------- */

/** Переклад тексту, набраного в адмінці українською. */
export function tx(text: string | null | undefined, lang: Lang = 'uk'): string {
  // Українською віддаємо як є — навіть із пробілами по краях.
  // Обрізаємо лише перед пошуком у словнику, щоб зайвий пробіл
  // не завадив знайти фразу.
  if (lang === 'uk' || !text) return text || '';

  // String() лишився з оригіналу: у Firestore поле може виявитись
  // і числом, і типи описують бажане, а не гарантоване.
  const raw = String(text).trim();
  const phrase = PHRASES[raw];
  if (phrase) return phrase;

  let out = raw;
  for (const [re, to] of WORDS) out = out.replace(re, to);
  return out;
}

/** Поле каталогу з можливим ручним перекладом: name → nameEn.
 *  Ручний переклад завжди важливіший за словниковий; порожній
 *  nameEn вважається «перекладу немає» і віддає роботу tx(). */
export function tf<K extends string>(
  obj: Partial<Record<K | `${K}En`, string>> | null | undefined,
  field: K,
  lang: Lang = 'uk'
): string {
  if (!obj) return '';

  if (lang === 'en') {
    const manual = obj[`${field}En` as `${K}En`];
    if (manual) return manual;
    return tx(obj[field], lang);
  }
  return obj[field] || '';
}

/* ---------- Вибір мови ---------- */

export const LANG_KEY = 'reyter:lang';

/** Звідки читати ?lang=: рядок запиту, готовий URLSearchParams
 *  або searchParams серверного компонента. */
export type SearchInput =
  | string
  | URLSearchParams
  | Readonly<Record<string, string | string[] | undefined>>
  | null;

function searchLang(search: SearchInput | undefined): Lang | null {
  if (!search) return null;

  let raw: string | string[] | null | undefined;
  // URLSearchParams сам відкидає початковий '?', тож рядок
  // передаємо як є.
  if (typeof search === 'string') raw = new URLSearchParams(search).get('lang');
  else if (search instanceof URLSearchParams) raw = search.get('lang');
  else raw = search.lang;

  const one = Array.isArray(raw) ? raw[0] : raw;
  return isLang(one) ? one : null;
}

/** Збережений вибір мови. У приватному режимі Safari кидає вже
 *  на доступі до localStorage, тому під try весь блок. */
export function readStoredLang(storage?: Pick<Storage, 'getItem'>): Lang | null {
  try {
    const store = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    if (!store) return null;
    const saved = store.getItem(LANG_KEY);
    return isLang(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Запамʼятати вибір. Якщо сховище недоступне — мовчки нічого:
 *  вибір діє до перезавантаження, і це краще за помилку. */
export function storeLang(lang: Lang, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const store = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    store?.setItem(LANG_KEY, lang);
  } catch {
    /* приватний режим */
  }
}

export interface DetectOptions {
  /** ?lang=en у адресі — має найвищий пріоритет: за посиланням
   *  сторінка відкривається тією мовою, яку в ньому вказали. */
  search?: SearchInput;
  /** Збережений вибір. undefined — прочитати сховище самим,
   *  null — вважати, що збереженого немає. */
  stored?: Lang | string | null;
  storage?: Pick<Storage, 'getItem'>;
  /** navigator.language або Accept-Language. */
  navigator?: string | null;
}

function browserLanguage(): string {
  return typeof navigator === 'undefined' ? '' : navigator.language || '';
}

export function detectLang(opts: DetectOptions = {}): Lang {
  const fromUrl = searchLang(opts.search);
  if (fromUrl) return fromUrl;

  const saved =
    opts.stored !== undefined
      ? isLang(opts.stored)
        ? opts.stored
        : null
      : readStoredLang(opts.storage);
  if (saved) return saved;

  /* Мова браузера НЕ вмикає англійську: обидві гілки дають 'uk'.
     Так було в оригіналі й змінювати не можна — англійська це
     свідомий вибір кнопкою, а не здогадка по налаштуваннях.
     Гілку лишаємо як є: у ній видно намір, і саме сюди дописують
     правило, якщо колись вирішать вгадувати мову. */
  const nav = (opts.navigator ?? browserLanguage()).toLowerCase();
  return nav.startsWith('uk') ? 'uk' : 'uk';
}
