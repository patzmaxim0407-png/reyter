import { HISTORY_FROM, LEVELS } from './loyalty';
import type { Lang } from './types';

/* ============================================================
   REYTER — умови програми лояльності, як їх читає покупець
   ------------------------------------------------------------
   Окремий файл, а не рядки у словнику: тут не підписи до кнопок,
   а документ, який людина читає, коли їй щось незрозуміло або
   коли вона з чимось не згодна. Такий текст пишеться суцільно,
   абзацами, і правиться теж суцільно.

   ЧИСЛА БЕРУТЬСЯ З САМИХ ПРАВИЛ. Пороги, відсотки й дата
   зарахування історії підставляються з lib/loyalty.ts, а не
   набираються руками. Умови, які розійшлися з програмою, гірші
   за відсутні: за ними покупець рахує своє й має рацію.

   Порядок пунктів — за частотою питань, а не за важливістю:
   спершу «скільки я отримаю», потім «за що», і аж потім тонкощі.
   ============================================================ */

export interface Term {
  title: string;
  /** Абзаци. Порожній рядок не потрібен — розділяє сам список. */
  body: string[];
}

const uk = (n: number) => n.toLocaleString('uk');
const en = (n: number) => n.toLocaleString('en');

function ladder(lang: Lang): string {
  const f = lang === 'en' ? en : uk;
  return LEVELS.map((l) =>
    `${lang === 'en' ? 'Level' : 'Рівень'} ${l.level}: ${f(l.from)}${
      l.to === null ? '+' : '–' + f(l.to)
    } — ${l.percent}%`
  ).join('; ');
}

function day(lang: Lang): string {
  const d = new Date(HISTORY_FROM);
  return Number.isNaN(d.getTime())
    ? HISTORY_FROM
    : d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'uk-UA');
}

export function loyaltyTerms(lang: Lang): Term[] {
  return lang === 'en' ? english() : ukrainian();
}

function ukrainian(): Term[] {
  return [
    {
      title: 'Як заробляються бали',
      body: [
        'Одна гривня покупки — один бал. Бали рахуються від суми, яку ви справді заплатили: після всіх знижок і без вартості доставки.',
        'Бали зараховуються, коли замовлення виконане — тобто коли ви його отримали. Доти вони не нараховуються: замовлення ще можна скасувати або не викупити.',
        'Копійки в балах не враховуються: 999,90 грн дають 999 балів.'
      ]
    },
    {
      title: 'Рівні та знижка',
      body: [
        'Чим більше балів — тим вищий рівень, а рівень дає постійну знижку на все.',
        ladder('uk') + '.',
        'Рівень підвищується сам, щойно набралось потрібно балів. Перестрибнути через рівень можна: одне велике замовлення може підняти одразу на два.'
      ]
    },
    {
      title: 'Скільки часу дається на рівень',
      body: [
        'На кожен рівень дається рік. Відлік починає перше замовлення, зроблене на цьому рівні, — а не день реєстрації, і не наступні замовлення.',
        'Якщо за рік ви не набрали на наступний рівень, бали повертаються до початку вашого рівня, а сам рівень лишається з вами. Наприклад, на другому рівні бали скидаються до 6 000, і ваші чотири відсотки нікуди не діваються.',
        'Після скидання відлік зупиняється. Новий рік почнеться з наступного вашого замовлення — доки ви не купуєте, ви нічого не втрачаєте.',
        'Четвертий рівень безстроковий: вище рухатись нікуди, тож і термін йому ні до чого.'
      ]
    },
    {
      title: 'Як діє знижка в кошику',
      body: [
        'Знижка застосовується сама, але ви можете її вимкнути одним перемикачем у кошику.',
        'Вимикати її іноді вигідно. Бали рахуються від сплаченої суми, тож застосована знижка зменшує їх рівно на свою величину. Коли до наступного рівня лишилось трохи, вигідніше заплатити повну ціну й перейти туди, де знижка більша назавжди.',
        'Знижка рівня складається з промокодом. Але в магазину є межа сумарної знижки, і коли обидві разом її перевищують, зменшується саме знижка рівня — промокод лишається цілим.',
        'Знижка рівня може не діяти на товари з бейджем SALE та в окремих категоріях. Якщо так — у кошику це видно за сумою.'
      ]
    },
    {
      title: 'Friendly Club',
      body: [
        'Friendly Club відчиняється з третього рівня. Це не окрема програма, а її верхня частина.',
        'Щоб зайти, вкажіть у кабінеті свій Instagram. Знижку рівень дає й без цього, а от закриті товари — лише учасникам клубу.',
        'Що дає клуб: товари, яких немає у відкритому каталозі, і ранній доступ до нових запусків.'
      ]
    },
    {
      title: 'Повернення та скасування',
      body: [
        'Якщо ви повернули замовлення, бали за нього знімаються.',
        'Рівень при цьому може знизитись — він завжди відповідає балам, які у вас є насправді.'
      ]
    },
    {
      title: 'Минулі замовлення',
      body: [
        `Замовлення, зроблені до вступу в програму, теж рахуються — від ${day('uk')}.`,
        'Зараховуються лише виконані замовлення на ту саму пошту, що й ваш акаунт. Це відбувається автоматично, невдовзі після вступу.',
        'Річний відлік від такої історії не починається: він почнеться з вашого першого замовлення після вступу.'
      ]
    },
    {
      title: 'Що балами зробити не можна',
      body: [
        'Балами не можна розрахуватися за замовлення. Вони існують лише для того, щоб відкривати рівні, а рівень дає відсоткову знижку.',
        'Бали не передаються іншій людині й не обмінюються на гроші.',
        'Програма живе на вашому акаунті й привʼязана до пошти, якою ви входите.'
      ]
    }
  ];
}

function english(): Term[] {
  return [
    {
      title: 'How points are earned',
      body: [
        'One hryvnia spent — one point. Points are counted from what you actually paid: after every discount and without the delivery cost.',
        'Points are credited once the order is completed — that is, once you have received it. Not before: an order can still be cancelled or left uncollected.',
        'Kopiykas do not count: ₴999.90 earns 999 points.'
      ]
    },
    {
      title: 'Levels and discount',
      body: [
        'More points mean a higher level, and a level gives a permanent discount on everything.',
        ladder('en') + '.',
        'The level rises on its own as soon as you have enough points. Skipping a level is possible: one large order can lift you two at once.'
      ]
    },
    {
      title: 'How long you have for a level',
      body: [
        'Each level gives you a year. The countdown starts with the first order you place on that level — not on the day you registered, and not with later orders.',
        'If you do not reach the next level within the year, your points return to the start of your level, and the level itself stays with you. On level 2, for instance, points reset to 6,000 and your four per cent remain.',
        'After a reset the countdown stops. A new year begins with your next order — while you are not buying, you are not losing anything.',
        'Level 4 has no time limit: there is nowhere higher to go.'
      ]
    },
    {
      title: 'How the discount works in the cart',
      body: [
        'The discount applies automatically, but you can switch it off in the cart.',
        'Switching it off is sometimes worth it. Points are counted from what you paid, so an applied discount reduces them by exactly its own amount. When the next level is close, paying full price to reach a permanently larger discount is the better deal.',
        'The level discount stacks with a promo code. The shop has a cap on total discounts, and when the two together exceed it, the level discount is the one reduced — the promo code stays whole.',
        'The level discount may not apply to SALE items or in certain categories. If so, you will see it in the cart total.'
      ]
    },
    {
      title: 'Friendly Club',
      body: [
        'The Friendly Club opens from level 3. It is not a separate programme but the top part of this one.',
        'To enter, add your Instagram in your account. The level gives you the discount either way; private items require the club.',
        'What the club gives: items that are not in the open catalogue, and early access to new drops.'
      ]
    },
    {
      title: 'Returns and cancellations',
      body: [
        'If you return an order, the points for it are removed.',
        'Your level may drop with them — it always matches the points you actually hold.'
      ]
    },
    {
      title: 'Past orders',
      body: [
        `Orders placed before you joined count too — from ${day('en')}.`,
        'Only completed orders on the same email as your account are credited. It happens automatically, shortly after you join.',
        'The yearly countdown does not start from that history: it starts with your first order after joining.'
      ]
    },
    {
      title: 'What points cannot do',
      body: [
        'Points cannot be used to pay for an order. They exist only to unlock levels, and a level gives a percentage discount.',
        'Points are not transferable to another person and are not exchangeable for money.',
        'The programme lives on your account and is tied to the email you sign in with.'
      ]
    }
  ];
}
