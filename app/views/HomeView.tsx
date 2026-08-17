import ProductCard from '@/components/ProductCard';
import FriendlyShelf from '@/components/FriendlyShelf';
import { FriendlyClub, HomeEffects, ReadMore, SizeGuideImage, ToTop } from '@/components/HomeInteractive';
import { loadCatalog, loadDraftCatalog, loadStock } from '@/lib/firestore';
import { freeFromOf, inCategory, visibleProducts, withFree } from '@/lib/catalog';
import { t, tf } from '@/lib/i18n';
import { SITE_CONFIG } from '@/lib/site-config';
import type { Lang } from '@/lib/types';

const social = [
  ['fab fa-tiktok', 'TikTok', 'https://www.tiktok.com/@reyter.ua5', ''],
  ['fab fa-instagram', 'Instagram', 'https://www.instagram.com/reyter.ua/', ''],
  ['fab fa-threads', 'Threads', 'https://www.threads.com/@reyter.ua', ''],
  ['fab fa-x-twitter', 'X', 'https://twitter.com/reyter_ua', '']
];
const messengers = [
  ['fab fa-whatsapp', 'WhatsApp', 'https://wa.me/message/PB4QREH6QHZOB1', 'soc-card--wa'],
  ['fab fa-viber', 'Viber', 'https://viber.me/380501794378', 'soc-card--vb'],
  ['fab fa-telegram', 'Telegram', 'https://t.me/reyter_store', 'soc-card--tg']
];

const delivery = [
  ['dlv.pay', 'dlv.payText', <><rect key="a" x="2" y="5" width="20" height="14" rx="2"/><line key="b" x1="2" y1="10" x2="22" y2="10"/></>],
  ['dlv.fast', 'dlv.fastText', <><path key="a" d="M5 18H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h11v12"/><path key="b" d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-2"/><circle key="c" cx="7.5" cy="18" r="2"/><circle key="d" cx="17.5" cy="18" r="2"/></>],
  ['dlv.carriers', 'dlv.carriersText', <><path key="a" d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z"/><path key="b" d="M3 8.5 12 14l9-5.5"/><line key="c" x1="12" y1="14" x2="12" y2="21"/></>],
  ['dlv.intl', 'dlv.intlText', <><circle key="a" cx="12" cy="12" r="9"/><path key="b" d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z"/></>],
  ['dlv.prepay', 'dlv.prepayText', <><path key="a" d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6l-8-3Z"/><path key="b" d="m9 12 2 2 4-4"/></>],
  ['dlv.return', 'dlv.returnText', <><circle key="a" cx="12" cy="12" r="9"/><line key="b" x1="12" y1="8" x2="12" y2="13"/><circle key="c" cx="12" cy="16.5" r=".5" fill="currentColor"/></>]
] as const;

export default async function HomeView({ lang, previewDraft = false }: { lang: Lang; previewDraft?: boolean }) {
  const [catalog, stock] = await Promise.all([previewDraft ? loadDraftCatalog() : loadCatalog(), loadStock()]);
  const c = { products: catalog.products, stock, freeFrom: catalog.freeFrom };
  const shown = visibleProducts(c);
  const sections = catalog.categories.map((cat) => ({ cat, items: shown.filter((p) => inCategory(p, cat.id)) })).filter((section) => section.items.length);
  let eagerLeft = 8;

  return <>
    <section className="hero" id="about"><div className="container hero__grid">
      <div className="hero__content reveal">
        <p className="hero__eyebrow"><span className="pill pill--drop">{t('hero.badge', lang)}</span></p>
        <h1 className="hero__title" dangerouslySetInnerHTML={{ __html: t('hero.title', lang) }} />
        <p className="hero__subtitle" dangerouslySetInnerHTML={{ __html: t('hero.subtitle', lang) }} />
        <div className="hero__actions"><a className="btn btn--primary" href="#catalog">{t('hero.cta1', lang)}</a><a className="btn btn--ghost" href="#size-guide">{t('hero.cta2', lang)}</a></div>
        <ReadMore lang={lang} />
        <ul className="hero__trust"><li>{withFree(t('hero.trust1', lang), freeFromOf(c))}</li><li>{t('hero.trust2', lang)}</li><li>{t('hero.trust3', lang)}</li></ul>
      </div>
      <div className="hero__media reveal"><div className="hero__frame"><img src="/assets/images/Jule2026/Head.webp" alt={t('hero.alt', lang)} fetchPriority="high" /></div></div>
    </div></section>

    <FriendlyClub lang={lang} />

    <section className="catalog" id="catalog">
      <div className="container"><header className="section-head reveal"><h2 className="section-title">{t('catalog.title', lang)}</h2><p className="section-sub">{t('catalog.sub', lang)}</p></header></div>
      <nav className="cat-chips" aria-label={t('nav.catalog', lang)}>{sections.map(({ cat }) => <a key={cat.id} className="chip" href={`#cat-${cat.id}`}>{tf(cat, 'title', lang)}</a>)}</nav>
      <div className="container">{sections.map(({ cat, items }) => <section className="category" id={`cat-${cat.id}`} key={cat.id}>
        <header className="category__head reveal"><h2 className="category__title">{tf(cat, 'title', lang)}</h2><span className="category__count">{items.length}</span><span className="category__rule" /></header>
        <div className="pgrid">{items.map((p) => { const eager = eagerLeft-- > 0; return <ProductCard key={p.id} c={c} p={p} eager={eager} lang={lang} />; })}</div>
      </section>)}</div>

      {/* Закриті товари клубу домальовує браузер учасника — прямо
          в сітки цих самих категорій. Компонент стоїть тут, у
          каталозі, бо тут його місце: те, що не вмістилось у
          жодну намальовану категорію, ляже полицею одразу під
          нею, а не під підвалом сторінки. */}
      <FriendlyShelf />
    </section>

    <section className="size-guide" id="size-guide"><div className="container">
      <header className="section-head reveal"><h2 className="section-title">{t('size.title', lang)}</h2><p className="section-sub">{t('size.sub', lang)}</p></header>
      <div className="size-guide__grid reveal"><div className="size-guide__table" role="region" aria-label={t('size.title', lang)} tabIndex={0}><table><thead><tr><th>{t('size.col1', lang)}</th><th>{t('size.col2', lang)}</th><th>{t('size.col3', lang)}</th></tr></thead><tbody>{SITE_CONFIG.sizeChart.map((row) => <tr key={row.size}><td>{row.size}</td><td>{row.waist}</td><td>{row.hips}</td></tr>)}</tbody></table></div><SizeGuideImage lang={lang} /></div>
    </div></section>

    <section className="delivery" id="delivery"><div className="container">
      <header className="section-head reveal"><h2 className="section-title">{t('dlv.title', lang)}</h2></header>
      <div className="delivery__grid">{delivery.map(([title, body, icon], index) => <article className={'dlv-card reveal' + (index === delivery.length - 1 ? ' dlv-card--note' : '')} key={title}><div className="dlv-card__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icon}</svg></div><h3>{t(title, lang)}</h3><p dangerouslySetInnerHTML={{ __html: t(body, lang) }} />{index === 0 ? <div className="dlv-card__pay"><img src="/assets/images/visa.svg" alt="Visa" loading="lazy"/><img src="/assets/images/master-card.svg" alt="Mastercard" loading="lazy"/></div> : null}</article>)}</div>
    </div></section>

    <section className="contacts" id="contacts"><div className="container">
      <header className="section-head reveal"><h2 className="section-title">{t('contacts.title', lang)}</h2><p className="section-sub">{t('contacts.sub', lang)}</p></header>
      <div className="contacts__grid reveal">{social.map(([icon, name, href]) => <a className="soc-card" href={href} target="_blank" rel="noopener" key={name}><i className={icon} aria-hidden="true"/><span>{name}</span></a>)}</div>
      <header className="section-head section-head--sub reveal"><h3 className="section-title section-title--sm">{t('contacts.msgTitle', lang)}</h3><p className="section-sub">{t('contacts.msgSub', lang)}</p></header>
      <div className="contacts__grid contacts__grid--msg reveal">{messengers.map(([icon, name, href, extra]) => <a className={`soc-card ${extra}`} href={href} target="_blank" rel="noopener" key={name}><i className={icon} aria-hidden="true"/><span>{name}</span></a>)}</div>
    </div></section>

    {/* Закриті товари. Малює їх браузер учасника — сервер не
        знає, хто відкрив сторінку, і рендерить її раз на всіх. */}
    <HomeEffects categoryIds={sections.map(({ cat }) => cat.id)} />
    <ToTop lang={lang} />
    {previewDraft ? <div className="draft-pill">{lang === 'en' ? 'Draft — this is how the site will look after publishing' : 'Чернетка — так виглядатиме сайт після публікації'}</div> : null}
  </>;
}
