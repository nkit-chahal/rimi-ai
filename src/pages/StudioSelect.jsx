import { useEffect } from 'react';
import { DOMAIN_ORDER, STUDIO_DOMAINS, getDomainAccess } from '../components/studio/shared/studioDomains';
import { EmbroideryArt, PrintArt, WovenArt } from '../components/studio/shared/StudioArt';
import { I } from '../components/studio/shared/StudioIcons';
import { t } from '../i18n/en-IN';
import '../styles/studio-select.css';

const TOOL_PREVIEW_LIMIT = 4;
const LOCK_ICON = 'M6 11V8a6 6 0 1112 0v3M5 11h14v10H5z';
const ARROW_ICON = 'M5 12h14M13 6l6 6-6 6';
const CHECK_ICON = 'M5 13l4 4L19 7';
const CREDITS_ICON = 'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6';
const SWITCH_ICON = 'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4';

const ART = { print: PrintArt, embroidery: EmbroideryArt, woven: WovenArt };

const HIGHLIGHTS = [
    { icon: CHECK_ICON, text: 'Print has every current AI design tool' },
    { icon: CREDITS_ICON, text: 'One credit balance across all studios' },
    { icon: SWITCH_ICON, text: 'Switch studios any time from the sidebar' },
];

function planLabelFor(user) {
    if (user?.role === 'admin') return 'Admin';
    if (user?.isPro) return 'Pro';
    const plan = String(user?.plan || '').trim();
    return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Basic';
}

function DomainCard({ domain, access, onSelect, index }) {
    const locked = access.state === 'locked';
    const preview = access.state === 'preview';
    const Art = ART[domain.id];
    const toolNames = domain.toolIds.map((toolId) => t(`nav.${toolId}`));
    const shownTools = toolNames.slice(0, TOOL_PREVIEW_LIMIT);
    const extraCount = toolNames.length - shownTools.length;

    const badgeClass = locked ? 'is-pro' : preview ? 'is-preview' : 'is-available';
    const badgeText = locked ? 'Pro' : preview ? (domain.status === 'early_access' ? 'Early access' : 'Coming soon') : 'Available';
    const ctaText = locked ? 'Locked on your plan' : preview ? (domain.status === 'early_access' ? 'Open early access' : 'Preview studio') : 'Open studio';

    return (
        <article
            className={`ss-card${locked ? ' is-locked' : ''}${preview ? ' is-preview' : ''}`}
            style={{ '--ss-accent': domain.accent, '--ss-accent-ink': domain.accentText || domain.accent, '--ss-index': index }}
            data-domain={domain.id}
        >
            <button
                type="button"
                className="ss-card-hit"
                onClick={() => { if (!locked) onSelect(domain.id); }}
                disabled={locked}
                aria-disabled={locked}
                aria-label={locked ? `${domain.label} studio is locked on your plan` : `Open ${domain.label} studio`}
            >
                <div className="ss-card-media">
                    {Art ? <Art /> : null}
                    <span className={`ss-badge ${badgeClass}`}>{badgeText}</span>
                    {locked && (
                        <span className="ss-media-lock" aria-hidden="true">
                            <I d={LOCK_ICON} s={14} />
                            Pro plan
                        </span>
                    )}
                </div>

                <div className="ss-card-body">
                    <div className="ss-card-titlerow">
                        <span className="ss-card-icon" aria-hidden="true"><I d={domain.icon} s={18} /></span>
                        <h2 className="ss-card-title">{domain.label}</h2>
                    </div>
                    <p className="ss-card-tagline">{domain.tagline}</p>
                    <p className="ss-card-desc">{domain.description}</p>
                    <ul className="ss-card-tools" aria-label={`${domain.label} tools`}>
                        {shownTools.map((name) => <li key={name}>{name}</li>)}
                        {extraCount > 0 && <li className="is-more">+{extraCount} more</li>}
                    </ul>
                    <span className="ss-card-cta">
                        {ctaText}
                        {!locked && <I d={ARROW_ICON} s={16} />}
                    </span>
                </div>
            </button>

            {locked && (
                <div className="ss-card-lock">
                    <span className="ss-card-lock-copy">
                        <I d={LOCK_ICON} s={15} />
                        {access.reason}
                    </span>
                    <button
                        type="button"
                        className="ss-upgrade-btn"
                        onClick={() => onSelect('print', { tool: 'billing' })}
                    >
                        View Pro plans
                    </button>
                </div>
            )}
        </article>
    );
}

/**
 * Studio picker shown between login and the workspace.
 * Lets the user choose Print, Embroidery or Woven; locked studios stay visible so the plan upgrade path is obvious.
 */
export default function StudioSelect({ user, onSelect, onLogout }) {
    useEffect(() => {
        const previous = document.title;
        document.title = 'Choose a studio · RIMI AI';
        return () => { document.title = previous; };
    }, []);

    const firstName = String(user?.name || '').trim().split(/\s+/)[0] || '';

    return (
        <div className="ss-portal">
            <header className="ss-topbar">
                <div className="ss-brand">
                    <span className="ln-logo-badge">RI</span> RIMI AI
                </div>
                <div className="ss-account">
                    <span className="ss-plan-chip">{planLabelFor(user)}</span>
                    {(user?.name || user?.email) && <span className="ss-user">{user.name || user.email}</span>}
                    {typeof onLogout === 'function' && (
                        <button type="button" className="ss-link-btn" onClick={onLogout}>Sign out</button>
                    )}
                </div>
            </header>

            <main className="ss-main">
                <div className="ss-intro">
                    <div className="ss-intro-copy">
                        <p className="ss-eyebrow">{firstName ? `Welcome, ${firstName}` : 'Welcome'}</p>
                        <h1 className="ss-title">Choose your studio</h1>
                        <p className="ss-subtitle">
                            Pick the pipeline you want to design in today. Each studio has its own tools, and they all share your projects and credits.
                        </p>
                    </div>
                    <ul className="ss-highlights" aria-label="Good to know">
                        {HIGHLIGHTS.map((item) => (
                            <li key={item.text}>
                                <span className="ss-highlight-icon" aria-hidden="true"><I d={item.icon} s={14} /></span>
                                {item.text}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="ss-grid">
                    {DOMAIN_ORDER.map((domainId, index) => (
                        <DomainCard
                            key={domainId}
                            index={index}
                            domain={STUDIO_DOMAINS[domainId]}
                            access={getDomainAccess(domainId, user)}
                            onSelect={onSelect}
                        />
                    ))}
                </div>

                <p className="ss-footnote">
                    Embroidery and Woven are included with Pro and Scale plans. Woven is still in development; Pro members can preview its tools as they land.
                </p>
            </main>
        </div>
    );
}
