import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../components/studio/shared/helpers';
import '../styles/company-intro.css';
import '../styles/pricing.css';

const FALLBACK_PLANS = [
  {
    id: 'starter',
    label: 'Starter',
    track: 'basic',
    description: 'Small production runs and evaluation.',
    credits: 3960,
    priceLabel: '₹528',
    badge: '',
    features: [
      '3,960 AI credits',
      'Normal AI models',
      'Core Print Studio workflow',
    ],
  },
  {
    id: 'creator',
    label: 'Creator',
    track: 'basic',
    description: 'Best value for active textile workflows.',
    credits: 14520,
    priceLabel: '₹1,936',
    badge: 'Popular',
    features: [
      '14,520 AI credits',
      'Normal models and mapping mockups',
      'Built for active design work',
    ],
  },
  {
    id: 'pro',
    label: 'Pro',
    track: 'pro',
    description: 'Unlock Pro models and Pro-only studio tools.',
    credits: 65340,
    priceLabel: '₹8,712',
    badge: '',
    features: [
      '65,340 AI credits',
      'GPT Image 2 and Flux 2 Pro',
      'Qwen Studio and 3D Mockup',
    ],
  },
  {
    id: 'scale',
    label: 'Scale',
    track: 'pro',
    description: 'For agencies and high-volume Pro teams.',
    credits: 197340,
    priceLabel: '₹26,312',
    badge: '',
    features: [
      '197,340 AI credits',
      'All Pro models and tools',
      'Priority support',
    ],
  },
];

const FAQS = [
  {
    question: 'Is this a subscription?',
    answer: 'No. These are one-time credit packs. You choose a pack whenever your workflow needs more capacity.',
  },
  {
    question: 'How long do credits remain available?',
    answer: 'A purchase opens or extends a 30-day credit window. Buying again before the current window ends adds another 30 days from the existing expiry.',
  },
  {
    question: 'What is included with Pro and Scale?',
    answer: 'Pro and Scale open 30 days of Pro access, including Pro AI models, Qwen Studio and 3D Mockup. An early renewal stacks onto the remaining Pro window.',
  },
  {
    question: 'Will a Starter top-up remove active Pro access?',
    answer: 'No. Starter and Creator add credits without shortening or replacing an active Pro window.',
  },
  {
    question: 'Can I purchase a custom amount?',
    answer: 'Yes. Signed-in users can create a custom top-up from ₹100 to ₹1,00,000 inside Billing.',
  },
  {
    question: 'How are payments processed?',
    answer: 'Checkout uses Razorpay. Credits are granted after the payment is verified by the server.',
  },
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
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

export default function PricingPage({ currentUser }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [plans, setPlans] = useState(FALLBACK_PLANS);

  useEffect(() => {
    document.title = 'Pricing — RIMI AI';
    const controller = new AbortController();

    fetch(API + '/api/billing/plans', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Pricing unavailable')))
      .then((data) => {
        const paidPlans = (data.plans || []).filter((plan) => plan.id !== 'free');
        if (paidPlans.length) setPlans(paidPlans);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          // The embedded catalogue keeps the public page useful while the API is offline.
        }
      });

    return () => controller.abort();
  }, []);

  const openBilling = () => {
    navigate(currentUser ? '/studio/billing' : '/login?redirect=/studio/billing');
  };

  return (
    <div className="mk-page pr-page">
      <a className="mk-skip-link" href="#pricing-content">Skip to pricing</a>

      <header className="mk-header pr-header">
        <div className="mk-shell mk-header-inner">
          <a className="mk-brand-link" href="/" aria-label="RIMI AI home">
            <Brand />
          </a>

          <button
            className="mk-menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="pricing-navigation"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MenuIcon open={menuOpen} />
          </button>

          <nav id="pricing-navigation" className={menuOpen ? 'mk-nav is-open' : 'mk-nav'} aria-label="Main navigation">
            <a href="/#platform">Platform</a>
            <a href="/#workflow">Workflow</a>
            <a href="/#studios">Studios</a>
            <a href="/#for-teams">For teams</a>
            <a className="is-current" href="/pricing" aria-current="page">Pricing</a>
          </nav>

          <div className="mk-header-actions">
            {!currentUser && (
              <button className="mk-text-button" type="button" onClick={() => navigate('/login')}>
                Sign in
              </button>
            )}
            <button className="mk-button mk-button-small" type="button" onClick={openBilling}>
              {currentUser ? 'Open Billing' : 'Start creating'}
              <ArrowIcon />
            </button>
          </div>
        </div>
      </header>

      <main id="pricing-content">
        <section className="pr-hero">
          <div className="pr-grid" aria-hidden="true" />
          <div className="mk-shell pr-hero-content">
            <p className="mk-eyebrow"><span /> Simple, usage-based pricing</p>
            <h1>Buy the creative capacity you need.</h1>
            <p>
              No recurring subscription. Choose a one-time credit pack, work across Print Studio,
              and recharge when the next collection begins.
            </p>
            <div className="pr-hero-points">
              <span><CheckIcon /> One-time payment</span>
              <span><CheckIcon /> 30-day credit window</span>
              <span><CheckIcon /> Custom top-ups available</span>
            </div>
          </div>
        </section>

        <section className="pr-plans" aria-labelledby="plans-title">
          <div className="mk-shell">
            <div className="pr-section-heading">
              <div>
                <p className="mk-kicker">Credit packs</p>
                <h2 id="plans-title">Start small. Scale when the work does.</h2>
              </div>
              <p>Every pack works across the same project workspace. Pro packs add higher-end models and Pro-only tools.</p>
            </div>

            <div className="pr-plan-grid">
              {plans.map((plan) => {
                const popular = Boolean(plan.badge);
                const pro = plan.track === 'pro';
                return (
                  <article key={plan.id} className={'pr-plan-card' + (popular ? ' is-popular' : '') + (pro ? ' is-pro' : '')}>
                    <div className="pr-plan-topline">
                      <span>{pro ? 'Pro access' : 'Core access'}</span>
                      {plan.badge && <b>{plan.badge}</b>}
                    </div>
                    <h3>{plan.label}</h3>
                    <p className="pr-plan-description">{plan.description}</p>
                    <div className="pr-price">
                      <strong>{plan.priceLabel}</strong>
                      <span>one-time</span>
                    </div>
                    <p className="pr-credit-count">{Number(plan.credits).toLocaleString('en-IN')} AI credits</p>
                    <button type="button" onClick={openBilling}>
                      Choose {plan.label} <ArrowIcon />
                    </button>
                    <ul>
                      {(plan.features || []).map((feature) => (
                        <li key={feature}><CheckIcon /> <span>{feature}</span></li>
                      ))}
                      {pro && <li><CheckIcon /> <span>30 days of Pro access</span></li>}
                    </ul>
                  </article>
                );
              })}
            </div>

            <div className="pr-custom-note">
              <div>
                <span>Need an exact amount?</span>
                <strong>Custom top-ups begin at ₹100.</strong>
              </div>
              <button type="button" onClick={openBilling}>Open Billing <ArrowIcon /></button>
            </div>
          </div>
        </section>

        <section className="pr-comparison" aria-labelledby="comparison-title">
          <div className="mk-shell">
            <div className="pr-section-heading">
              <div>
                <p className="mk-kicker">Compare access</p>
                <h2 id="comparison-title">Choose credits or unlock the full studio.</h2>
              </div>
              <p>Starter and Creator cover the core Print workflow. Pro and Scale add the premium model and tool layer.</p>
            </div>

            <div className="pr-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Capability</th>
                    <th scope="col">Starter / Creator</th>
                    <th scope="col">Pro / Scale</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Pattern Extraction', 'Included', 'Included'],
                    ['Make Seamless, Repeat Set and Colourways', 'Included', 'Included'],
                    ['Mappings and Vectorize', 'Included', 'Included'],
                    ['Flux Schnell, Grok and Nano Banana', 'Included', 'Included'],
                    ['GPT Image 2 and Flux 2 Pro', '—', 'Included'],
                    ['Seedream 4.5 for Inspire and Extract', '—', 'Included'],
                    ['Qwen Studio and 3D Mockup', '—', 'Included'],
                    ['Pro access window', '—', '30 days'],
                  ].map(([capability, basic, pro]) => (
                    <tr key={capability}>
                      <th scope="row">{capability}</th>
                      <td>{basic === 'Included' ? <span className="pr-included"><CheckIcon /> Included</span> : basic}</td>
                      <td>{pro === 'Included' ? <span className="pr-included"><CheckIcon /> Included</span> : pro}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="pr-faq" aria-labelledby="faq-title">
          <div className="mk-shell pr-faq-layout">
            <div>
              <p className="mk-kicker">Pricing questions</p>
              <h2 id="faq-title">Clear before you create.</h2>
              <p>Everything important about credits, Pro access and checkout.</p>
            </div>
            <div className="pr-faq-list">
              {FAQS.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}<span aria-hidden="true">+</span></summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="pr-final">
          <div className="mk-shell">
            <p className="mk-eyebrow"><span /> Begin with Print Studio</p>
            <h2>Choose a pack when you are ready to make.</h2>
            <p>Explore RIMI AI first, then purchase securely from Billing inside your account.</p>
            <button className="mk-button mk-button-primary" type="button" onClick={openBilling}>
              {currentUser ? 'Open Billing' : 'Create your account'} <ArrowIcon />
            </button>
          </div>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-shell mk-footer-grid">
          <div>
            <Brand />
            <p>AI-assisted textile design, from inspiration to production.</p>
          </div>
          <div>
            <strong>Platform</strong>
            <a href="/#workflow">Workflow</a>
            <a href="/#studios">Studios</a>
            <a href="/#for-teams">For teams</a>
          </div>
          <div>
            <strong>Product</strong>
            <a href="/pricing">Pricing</a>
            <button type="button" onClick={openBilling}>Billing</button>
            <span>Embroidery — soon</span>
          </div>
          <div>
            <strong>Account</strong>
            {!currentUser && <button type="button" onClick={() => navigate('/login')}>Sign in</button>}
            <button type="button" onClick={openBilling}>{currentUser ? 'Open Billing' : 'Start creating'}</button>
          </div>
        </div>
        <div className="mk-shell mk-footer-bottom">
          <span>© {new Date().getFullYear()} RIMI AI</span>
          <span>Secure checkout through Razorpay.</span>
        </div>
      </footer>
    </div>
  );
}
