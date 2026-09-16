import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TextileCompareSlider from '../components/TextileCompareSlider';
import '../styles/company-intro.css';

const WORKFLOW = [
  {
    number: '01',
    title: 'Extract the idea',
    copy: 'Start from artwork or an image. Isolate the strongest motif and prepare it for pattern work.',
  },
  {
    number: '02',
    title: 'Build the repeat',
    copy: 'Create a seamless tile, refine the repeat and explore colour directions without rebuilding the artwork.',
  },
  {
    number: '03',
    title: 'Preview and export',
    copy: 'Map the design onto products, check the result in context and prepare the final design file.',
  },
];

const PRODUCT_FEATURES = [
  {
    icon: 'inspiration',
    title: 'Multiple Inspirations from One Thing',
    copy: 'Generate hundreds of design variations from a single image, sketch or idea.',
  },
  {
    icon: 'colourways',
    title: 'Colourways',
    copy: 'Create beautiful, on-trend colour palettes and explore unlimited colour variations.',
  },
  {
    icon: 'seamless',
    title: 'Seamless & Repeat Set Print',
    copy: 'Automatically create seamless and repeating patterns for any fabric type.',
  },
  {
    icon: 'vector',
    title: 'Vector Print',
    copy: 'Convert designs to clean, editable vector files for scalable, high-quality production.',
  },
  {
    icon: 'mapping',
    title: '3-D Mapping',
    copy: 'Visualize your prints on real products in 3D — see how they look on garments, home décor and accessories before production.',
  },
  {
    icon: 'export',
    title: 'Printable File',
    copy: 'Export production-ready files in multiple formats (AI, PSD, PNG, TIFF) with correct colour profiles and dimensions.',
  },
];

const IMPACT_STATS = [
  { value: '92%', label: 'of designers create multiple inspirations from a single image' },
  { value: '85%', label: 'faster colourway creation and design exploration' },
  { value: '88%', label: 'time saved on creating seamless & repeat pattern sets' },
  { value: '83%', label: 'reduced sampling cost with 3D product mapping & visualization' },
  { value: '62%', label: 'faster conversion to vector & production-ready files' },
  { value: '14%', label: 'higher design productivity and faster time-to-market' },
];

const TESTIMONIALS = [
  {
    name: 'Tanushri Roy',
    role: 'Independent Textile Designer',
    quote: 'RIMI AI has completely transformed my design workflow. From one inspiration I can create multiple prints, colourways and seamless patterns in minutes. It\'s like having a creative partner 24/7!',
  },
  {
    name: 'Stefania Scrivani',
    role: 'Design Director, Fashion Brand',
    quote: 'The AI colourway and vector export features save us weeks of manual work. We can explore more ideas, present better options to our clients and take designs to production faster than ever.',
  },
  {
    name: 'Emanuel Morelli',
    role: 'Founder, Home Textiles Brand',
    quote: 'RIMI AI bridges creativity and production. The 3D mapping and product visualisation help us showcase designs on real products before sampling, reducing cost and time significantly.',
  },
];

const AUDIENCES = [
  ['Textile designers', 'Move from reference to repeat with one connected toolkit.'],
  ['Fashion brands', 'Develop print directions and review them on product.'],
  ['Home textiles', 'Explore coordinated prints for cushions, bedding and décor.'],
  ['Print houses', 'Prepare cleaner artwork before production handoff.'],
  ['Export houses', 'Organise iterations and present client-ready directions.'],
  ['Creative teams', 'Keep projects, tools and output decisions in one workspace.'],
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function FeatureIcon({ type }) {
  const icons = {
    inspiration: <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />,
    colourways: <path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />,
    seamless: <><path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></>,
    vector: <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />,
    mapping: <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />,
    export: <path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {icons[type]}
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mk-quote-icon" aria-hidden="true">
      <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" fill="currentColor" />
    </svg>
  );
}

function MenuIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {open ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

function Brand() {
  return (
    <span className="mk-brand" aria-label="RIMI AI">
      <span className="mk-brand-mark">RI</span>
      <span className="mk-brand-name">RIMI AI</span>
    </span>
  );
}

function BotanicalMotif() {
  return (
    <svg className="mk-botanical-motif" viewBox="0 0 240 240" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M121 206c-2-38 0-75 4-110" />
        <path d="M123 148c-20-7-35-20-45-39M124 167c20-8 35-22 44-42" />
        <path d="M79 109c-19 0-34-10-42-28 21-4 38 6 42 28ZM167 125c19-2 35 7 44 24-20 6-38-2-44-24Z" />
      </g>
      <g className="mk-botanical-petals">
        <ellipse cx="122" cy="64" rx="23" ry="42" />
        <ellipse cx="122" cy="64" rx="23" ry="42" transform="rotate(72 122 64)" />
        <ellipse cx="122" cy="64" rx="23" ry="42" transform="rotate(144 122 64)" />
        <ellipse cx="122" cy="64" rx="23" ry="42" transform="rotate(216 122 64)" />
        <ellipse cx="122" cy="64" rx="23" ry="42" transform="rotate(288 122 64)" />
        <circle cx="122" cy="64" r="13" />
      </g>
    </svg>
  );
}

export default function LandingPage({ currentUser }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTestimonial, setActiveTestimonial] = useState(0);

  useEffect(() => {
    document.title = 'RIMI AI — Textile design from inspiration to production';
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveTestimonial((prev) => (prev + 1) % TESTIMONIALS.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const openStudio = () => {
    navigate(currentUser ? '/studio' : '/login?redirect=/studio');
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="mk-page">
      <a className="mk-skip-link" href="#main-content">Skip to content</a>

      <header className="mk-header">
        <div className="mk-shell mk-header-inner">
          <a className="mk-brand-link" href="#top" onClick={closeMenu}>
            <Brand />
          </a>

          <button
            className="mk-menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="marketing-navigation"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MenuIcon open={menuOpen} />
          </button>

          <nav id="marketing-navigation" className={menuOpen ? 'mk-nav is-open' : 'mk-nav'} aria-label="Main navigation">
            <a href="#platform" onClick={closeMenu}>Platform</a>
            <a href="#workflow" onClick={closeMenu}>Workflow</a>
            <a href="#studios" onClick={closeMenu}>Studios</a>
            <a href="#for-teams" onClick={closeMenu}>For teams</a>
            <a href="/pricing" onClick={closeMenu}>Pricing</a>
          </nav>

          <div className="mk-header-actions">
            {!currentUser && (
              <button className="mk-text-button" type="button" onClick={() => navigate('/login')}>
                Sign in
              </button>
            )}
            <button className="mk-button mk-button-small" type="button" onClick={openStudio}>
              {currentUser ? 'Open Studio' : 'Start creating'}
              <ArrowIcon />
            </button>
          </div>
        </div>
      </header>

      <main id="main-content">
        <section id="top" className="mk-hero">
          <div className="mk-hero-grid" aria-hidden="true" />
          <div className="mk-shell mk-hero-layout">
            <div className="mk-hero-copy">
              <p className="mk-eyebrow"><span /> Built in India. Made for creative teams.</p>
              <h1>India&rsquo;s First AI Platform for <em>Textile / Fashion</em> Industry.</h1>
              <p className="mk-hero-capabilities">
                Original prints <i /> Seamless designs <i /> Colourways <i /> 3D mapping <i /> Production-ready files <i /> One-stop solution
              </p>

              <div className="mk-hero-actions">
                <button className="mk-button mk-button-primary" type="button" onClick={openStudio}>
                  Start creating <ArrowIcon />
                </button>
              </div>

              <div className="mk-hero-stats" aria-label="RIMI AI product facts">
                <div>
                  <strong>13+</strong>
                  <span>Purpose-built Print Studio tools</span>
                </div>
                <div>
                  <strong>3</strong>
                  <span>Studios: one live, two coming next</span>
                </div>
                <div>
                  <strong>1</strong>
                  <span>Connected idea-to-output workflow</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="studios" className="mk-section mk-studios">
          <div className="mk-shell">
            <div className="mk-section-heading">
              <p className="mk-kicker">Three textile disciplines</p>
              <h2>Choose the studio that fits the work.</h2>
              <p>Print is ready today. Embroidery and Woven are the next focused environments in the RIMI platform.</p>
            </div>

            <div className="mk-studio-grid">
              <article className="mk-studio-card is-active">
                <img src="/studio-card-print.webp" alt="Layered floral print fabrics" loading="lazy" />
                <div className="mk-studio-overlay" />
                <div className="mk-studio-top"><span>01</span><b>Available now</b></div>
                <div className="mk-studio-copy">
                  <p>Surface and print design</p>
                  <h3>Print Studio</h3>
                  <span>Extract motifs, build repeats, create colourways and preview on products.</span>
                  <button type="button" onClick={openStudio}>Open studio <ArrowIcon /></button>
                </div>
              </article>

              <article className="mk-studio-card">
                <img src="/studio-card-embroidery.webp" alt="Detailed floral embroidery on fabric" loading="lazy" />
                <div className="mk-studio-overlay" />
                <div className="mk-studio-top"><span>02</span><b>Coming soon</b></div>
                <div className="mk-studio-copy">
                  <p>Motifs, threads and placement</p>
                  <h3>Embroidery Studio</h3>
                  <span>Plan placement, motif libraries, thread shades and stitch-led visualisation.</span>
                </div>
              </article>

              <article className="mk-studio-card">
                <img src="/studio-card-woven.webp" alt="Woven blue checked textile" loading="lazy" />
                <div className="mk-studio-overlay" />
                <div className="mk-studio-top"><span>03</span><b>Coming soon</b></div>
                <div className="mk-studio-copy">
                  <p>Checks, dobby and jacquard</p>
                  <h3>Woven Studio</h3>
                  <span>Develop woven structures, yarn-led colour and cloth visualisation.</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section id="platform" className="mk-capability-bar" aria-label="Print Studio capabilities">
          <div className="mk-shell mk-capability-list">
            {['Pattern extraction', 'Seamless repeats', 'Colourways', 'Product mapping', 'Production export'].map((item, index) => (
              <span key={item}><b>{String(index + 1).padStart(2, '0')}</b>{item}</span>
            ))}
          </div>
        </section>

        <section id="workflow" className="mk-section mk-workflow">
          <div className="mk-shell">
            <div className="mk-section-heading mk-section-heading-split">
              <div>
                <p className="mk-kicker">From idea to impact</p>
                <h2>One print workflow.<br />No disconnected handoffs.</h2>
              </div>
              <p>Move from a source image to a refined repeat and a product preview while keeping the creative decisions together.</p>
            </div>

            <div className="mk-workflow-layout">
              <div className="mk-workflow-image">
                <img
                  src="/assets/marketing/rimi-print-workflow.webp"
                  alt="A coordinated textile workflow showing a floral motif, colour palette, repeat print and fabric sample"
                  width="1536"
                  height="1024"
                />
                <span>Artwork → Repeat → Fabric</span>
              </div>
              <div className="mk-workflow-steps">
                {WORKFLOW.map((step) => (
                  <article key={step.number}>
                    <span>{step.number}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.copy}</p>
                    </div>
                  </article>
                ))}
                <button className="mk-button mk-button-dark" type="button" onClick={openStudio}>
                  Explore Print Studio <ArrowIcon />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="examples" className="mk-section mk-examples">
          <div className="mk-shell">
            <div className="mk-section-heading mk-section-heading-split">
              <div>
                <p className="mk-kicker">See the tools in action</p>
                <h2>More than repeats.<br />Finish the artwork too.</h2>
              </div>
              <p>Improve resolution, explore colour directions and prepare isolated artwork without taking the design out of its project.</p>
            </div>

            <div className="mk-example-grid">
              <article className="mk-example-card mk-example-resolution">
                <div className="mk-example-copy">
                  <span className="mk-example-number">01 / Detail</span>
                  <h3>Super Resolution</h3>
                  <p>Upscale source artwork at 2x or 4x when the design needs more resolution for larger print output.</p>
                  <div className="mk-example-pills" aria-label="Available upscale options">
                    <span>2x upscale</span><span>4x upscale</span><span>Print detail</span>
                  </div>
                </div>
                <div className="mk-example-compare">
                  <TextileCompareSlider
                    beforeSrc="/assets/marketing/rimi-print-workflow.webp"
                    afterSrc="/assets/marketing/rimi-print-workflow.webp"
                    beforeLabel="Original"
                    afterLabel="4x detail"
                    beforeAlt="A deliberately softened floral textile artwork preview before upscaling"
                    description="Drag to inspect the difference between the softer source preview and restored detail."
                    beforeImageClassName="mk-compare-image-soft"
                    ariaLabel="Compare original artwork with a super-resolution preview"
                  />
                </div>
              </article>

              <article className="mk-example-card mk-example-colourways">
                <div className="mk-example-copy">
                  <span className="mk-example-number">02 / Colour</span>
                  <h3>Colorway Manager</h3>
                  <p>See distinct palette directions side by side before choosing what moves forward.</p>
                </div>
                <div className="mk-colourway-board" aria-label="Four colourway preview examples">
                  {['Indigo rose', 'Sage clay', 'Mineral blue', 'Plum dusk'].map((name, index) => (
                    <figure key={name} className={`mk-colourway-sample is-tone-${index + 1}`}>
                      <img src="/assets/marketing/rimi-seamless-after.webp" alt="" loading="lazy" />
                      <figcaption><i aria-hidden="true" />{name}</figcaption>
                    </figure>
                  ))}
                </div>
              </article>

              <article className="mk-example-card mk-example-cutout">
                <div className="mk-example-copy">
                  <span className="mk-example-number">03 / Prepare</span>
                  <h3>Remove Background</h3>
                  <p>Separate a motif from its surroundings, then continue into repeat, mapping or vector work.</p>
                </div>
                <div className="mk-cutout-flow" aria-label="Background removal example">
                  <div className="mk-cutout-stage is-source">
                    <span>Source</span>
                    <BotanicalMotif />
                  </div>
                  <ArrowIcon />
                  <div className="mk-cutout-stage is-transparent">
                    <span>Transparent</span>
                    <BotanicalMotif />
                  </div>
                </div>
              </article>
            </div>

            <div className="mk-example-more">
              <p><b>Continue in the same project</b> with production-focused tools.</p>
              <div>
                {['Vectorize', 'Vector Pro', 'Mappings', '3D Mockup', 'Qwen Studio', 'Exports'].map((tool) => (
                  <span key={tool}>{tool}</span>
                ))}
              </div>
              <button className="mk-button mk-button-dark" type="button" onClick={openStudio}>
                Explore all tools <ArrowIcon />
              </button>
            </div>
          </div>
        </section>

        {/* ── Product Showcase ── */}
        <section id="product" className="mk-section mk-product-showcase">
          <div className="mk-shell">
            <div className="mk-product-layout">
              <div className="mk-product-intro">
                <p className="mk-kicker">Our Product</p>
                <h2>Print <em>Studio</em></h2>
                <p className="mk-product-desc">Turn inspiration into production-ready prints with AI. From multiple concepts to colourways, repeats, vectors and 3D product mapping — all in one place.</p>

                <div className="mk-product-features">
                  {PRODUCT_FEATURES.map((feat) => (
                    <article key={feat.title} className="mk-product-feat">
                      <div className="mk-product-feat-icon">
                        <FeatureIcon type={feat.icon} />
                      </div>
                      <div>
                        <h3>{feat.title}</h3>
                        <p>{feat.copy}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="mk-product-preview">
                <img
                  src="/assets/marketing/rimi-print-studio-ui.jpg"
                  alt="RIMI AI Print Studio interface showing pattern generation, design grid and 3D garment preview"
                  width="1400"
                  height="900"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Impact Stats ── */}
        <section id="impact" className="mk-section mk-impact">
          <div className="mk-shell">
            <div className="mk-impact-layout">
              <div className="mk-impact-grid">
                {IMPACT_STATS.map((stat) => (
                  <article key={stat.value + stat.label} className="mk-impact-card">
                    <strong>{stat.value}</strong>
                    <p>{stat.label}</p>
                  </article>
                ))}
                <div className="mk-impact-cta">
                  <button className="mk-button mk-button-primary" type="button" onClick={openStudio}>
                    Try for Free <ArrowIcon />
                  </button>
                </div>
              </div>
              <div className="mk-impact-visual">
                <img
                  src="/assets/marketing/rimi-cushion-display.jpg"
                  alt="Elegant blue and white floral cushions on a dark display pedestal"
                  width="800"
                  height="800"
                  loading="lazy"
                />
                <span className="mk-impact-tagline">From idea<br />to anything</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Testimonials ── */}
        <section id="testimonials" className="mk-section mk-testimonials">
          <div className="mk-shell">
            <div className="mk-testimonials-header">
              <div>
                <p className="mk-kicker">Creators · Brands · Manufacturers · All love RIMI AI</p>
                <h2>Designers <em>love</em> RIMI AI!</h2>
                <p>Real stories from creative minds who are designing faster, smarter and better with AI.</p>
              </div>
            </div>

            <div className="mk-testimonials-grid">
              {TESTIMONIALS.map((t, index) => (
                <article key={t.name} className={`mk-testimonial-card ${index === activeTestimonial ? 'is-active' : ''}`}>
                  <QuoteIcon />
                  <blockquote>{t.quote}</blockquote>
                  <div className="mk-testimonial-author">
                    <div className="mk-testimonial-avatar">{t.name.charAt(0)}</div>
                    <div>
                      <strong>{t.name}</strong>
                      <span>{t.role}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="mk-testimonials-controls">
              <div className="mk-testimonials-nav">
                <button type="button" aria-label="Previous testimonial" onClick={() => setActiveTestimonial((prev) => (prev - 1 + TESTIMONIALS.length) % TESTIMONIALS.length)}>
                  <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                </button>
                <button type="button" aria-label="Next testimonial" onClick={() => setActiveTestimonial((prev) => (prev + 1) % TESTIMONIALS.length)}>
                  <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                </button>
              </div>
              <div className="mk-testimonials-progress">
                {TESTIMONIALS.map((_, i) => (
                  <button key={i} className={`mk-progress-dot ${i === activeTestimonial ? 'is-active' : ''}`} type="button" onClick={() => setActiveTestimonial(i)} aria-label={`Go to testimonial ${i + 1}`} />
                ))}
              </div>
              <span className="mk-testimonials-counter">{String(activeTestimonial + 1).padStart(2, '0')} / {String(TESTIMONIALS.length).padStart(2, '0')}</span>
            </div>
          </div>
        </section>

        {/* ── Enterprise Trust ── */}
        <section id="trust" className="mk-section mk-trust">
          <div className="mk-shell">
            <div className="mk-trust-header-row">
              <div className="mk-trust-heading">
                <p className="mk-kicker">Trusted by the industry</p>
                <h2>Enterprise-grade trust &amp; <em>security</em></h2>
                <p className="mk-trust-sub">Your creativity. Always protected.</p>
              </div>
              <img
                src="/assets/marketing/rimi-floral-drape.jpg"
                alt="Blue floral fabric drape"
                className="mk-trust-decor"
                width="400"
                height="260"
                loading="lazy"
              />
            </div>
            <div className="mk-trust-grid">
              {[
                ['Design Ownership', 'You own what you create.', 'shield'],
                ['Data Privacy', 'Your data stays confidential.', 'lock'],
                ['Secure Infrastructure', 'Cloud-powered, globally scalable.', 'cloud'],
                ['Production-Ready Workflows', 'Built for enterprise scale.', 'gear'],
              ].map(([title, copy, icon]) => (
                <article key={title} className="mk-trust-card">
                  <div className="mk-trust-icon">
                    {icon === 'shield' && <ShieldIcon />}
                    {icon === 'lock' && <LockIcon />}
                    {icon === 'cloud' && <CloudIcon />}
                    {icon === 'gear' && <GearIcon />}
                  </div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                  <span className="mk-trust-arrow"><ArrowIcon /></span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="for-teams" className="mk-section mk-audiences">
          <div className="mk-shell">
            <div className="mk-section-heading mk-section-heading-split">
              <div>
                <p className="mk-kicker">Built for the industry</p>
                <h2>Made for people who turn pattern into product.</h2>
              </div>
              <p>RIMI AI is shaped around the practical work between a creative reference and a design that can be reviewed, refined and handed forward.</p>
            </div>

            <div className="mk-audience-layout">
              <div className="mk-audience-grid">
                {AUDIENCES.map(([title, copy], index) => (
                  <article key={title}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </article>
                ))}
              </div>
              <figure>
                <img
                  src="/assets/marketing/rimi-home-textiles.webp"
                  alt="Coordinated floral cushions, folded textiles and printed fabric rolls in a light studio"
                  width="1536"
                  height="1024"
                  loading="lazy"
                />
                <figcaption>From a single print direction to a coordinated textile story.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="mk-final-cta">
          <div className="mk-final-image" aria-hidden="true" />
          <div className="mk-shell mk-final-content">
            <p className="mk-eyebrow"><span /> From ideas to impact</p>
            <h2>Turn weeks of design work into <em>minutes.</em></h2>
            <p>Join thousands of designers and businesses creating with AI.</p>
            <div className="mk-final-buttons">
              <button className="mk-button mk-button-primary" type="button" onClick={openStudio}>
                {currentUser ? 'Open Print Studio' : 'Start creating'} <ArrowIcon />
              </button>
              <button className="mk-button mk-button-outline" type="button" onClick={() => { document.getElementById('product')?.scrollIntoView({ behavior: 'smooth' }); }}>
                Explore the tools
              </button>
            </div>
            <div className="mk-final-badges">
              <span>✓ Built in India</span>
              <span>✓ Trusted by industry experts</span>
              <span>✓ Made for creative teams</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-shell mk-footer-grid">
          <div>
            <Brand />
            <p>Built in India.<br />For a more creative world.</p>
          </div>
          <div>
            <strong>Product</strong>
            <button type="button" onClick={openStudio}>AI Design</button>
            <a href="#product">3D Mapping</a>
            <a href="#product">Colourways</a>
            <a href="#product">Export</a>
          </div>
          <div>
            <strong>Company</strong>
            <a href="#for-teams">About</a>
            <a href="#for-teams">Careers</a>
            <a href="#for-teams">Contact</a>
          </div>
          <div>
            <strong>Resources</strong>
            <a href="#workflow">Blog</a>
            <a href="/pricing">FAQ</a>
            <a href="#trust">Privacy Policy</a>
            <a href="#trust">Terms of Use</a>
          </div>
        </div>
        <div className="mk-shell mk-footer-bottom">
          <span>© {new Date().getFullYear()} RIMI AI</span>
          <span>Designed for textile and fashion workflows.</span>
        </div>
      </footer>
    </div>
  );
}
