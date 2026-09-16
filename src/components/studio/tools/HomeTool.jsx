import { useMemo, useState } from 'react';
import { I } from '../shared/StudioIcons';
import MediaImg from '../shared/MediaImg';
import '../../../styles/tools/home.css';

/**
 * Home — the first screen after login.
 *
 * Shows only what the product can actually do today. Print is the live studio; Embroidery and
 * Woven are marked "Coming soon" because they exist on a feature branch, not here. Nothing on
 * this screen invents a feature (tasks, moodboards, collections) that the backend cannot back.
 */

const STUDIOS = [
    {
        id: 'print',
        shortLabel: 'Print',
        label: 'Print Design Studio',
        category: 'Surface and print design',
        blurb: 'Extract a repeat, make it seamless, build colourways and preview it on 31 products.',
        cta: 'Open Print Studio',
        tool: 'pattern',
        tone: 'violet',
        preview: '/studio-card-print.webp',
        previewAlt: 'Floral surface print preview',
        tagline: 'Turn ideas into beautiful prints',
        capabilities: ['Pattern Extraction', 'Make Seamless', 'Repeat Set', 'Mappings', '+9 more'],
        icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z',
        live: true,
    },
    {
        id: 'embroidery',
        shortLabel: 'Embroidery',
        label: 'Embroidery Studio',
        category: 'Motifs, threads and placement',
        blurb: 'Placement, motif library, thread shade matching and stitch rendering.',
        cta: 'Coming soon',
        tone: 'coral',
        preview: '/studio-card-embroidery.webp',
        previewAlt: 'Botanical embroidery motif preview',
        tagline: 'Craft details that matter',
        capabilities: ['Placement', 'Motif Library', 'Thread Shades', 'Stitch Rendering'],
        icon: 'M3 12l3-4 3 8 3-8 3 8 3-8 3 4',
        live: false,
    },
    {
        id: 'woven',
        shortLabel: 'Woven',
        label: 'Woven Design Studio',
        category: 'Checks, dobby and jacquard',
        blurb: 'Checks and stripes, dobby and jacquard drafting, yarn libraries.',
        cta: 'Coming soon',
        tone: 'emerald',
        preview: '/studio-card-woven.webp',
        previewAlt: 'Geometric woven textile preview',
        tagline: 'Weave new possibilities',
        capabilities: ['Checks & Stripes', 'Dobby Drafting', 'Jacquard', 'Yarn Library'],
        icon: 'M4 6h16M4 12h16M4 18h16M6 4v16M12 4v16M18 4v16',
        live: false,
    },
];

// Quick Start is the subset of tools a new user is most likely to reach for first, in the order
// the workflow actually runs. Ids must exist in the studio's tool registry.
const QUICK_START = ['pattern', 'seamless', 'inspire', 'colorways', 'repeat', 'vectorize', 'mappings', 'imagelayers'];

const QUICK_DESCRIPTIONS = {
    pattern: 'Turn any image into a pattern',
    seamless: 'Create tileable repeats in one click',
    inspire: 'Explore styles and trends',
    colorways: 'Generate beautiful colour variations',
    repeat: 'Adjust and refine pattern repeats',
    vectorize: 'Convert artwork to clean vectors',
    mappings: 'Visualize designs on products',
    imagelayers: 'Separate and edit artwork with AI',
};

function greetingFor(date = new Date()) {
    const h = date.getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function firstName(user) {
    const n = (user?.name || '').trim();
    if (!n) return '';
    return n.split(/\s+/)[0];
}

function ProjectCard({ project, active, token, busy, onOpen, onRename, onDelete, canDelete }) {
    const [menu, setMenu] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(project.name);
    // New projects are stamped with a /demo_* placeholder by the backend. That is not the user's
    // artwork, so it does not get shown as if it were.
    const hasThumb = Boolean(project.thumbnailUrl) && !/^\/demo_/.test(project.thumbnailUrl);

    const commit = async () => {
        const next = draft.trim();
        setEditing(false);
        if (next && next !== project.name) await onRename(project.id, next);
        else setDraft(project.name);
    };

    return (
        <article className={`hm-project ${active ? 'is-active' : ''}`} aria-current={active ? 'true' : undefined}>
            <button type="button" className="hm-project-hit" onClick={() => onOpen(project.id)} aria-label={`Open ${project.name}`}>
                <div className="hm-project-thumb">
                    {hasThumb ? (
                        <MediaImg src={project.thumbnailUrl} alt="" token={token} />
                    ) : (
                        // No artwork yet. Show the initial rather than a demo image that pretends to be theirs.
                        <span className="hm-project-blank" aria-hidden="true">{(project.name || '?').trim().charAt(0).toUpperCase()}</span>
                    )}
                    {active && <span className="hm-project-active">Open now</span>}
                </div>
            </button>
            <div className="hm-project-meta">
                {editing ? (
                    <input
                        className="hm-project-rename"
                        value={draft}
                        autoFocus
                        maxLength={80}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commit();
                            if (e.key === 'Escape') { setDraft(project.name); setEditing(false); }
                        }}
                        aria-label="Project name"
                    />
                ) : (
                    <h4 title={project.name}>{project.name}</h4>
                )}
                <div className="hm-project-sub">
                    <span className="hm-tag">Print</span>
                    <span>{project.updatedLabel || ''}</span>
                </div>
                <div className="hm-project-menu-wrap">
                    <button
                        type="button"
                        className="hm-project-menu-btn"
                        aria-haspopup="menu"
                        aria-expanded={menu}
                        aria-label={`More actions for ${project.name}`}
                        disabled={busy}
                        onClick={() => setMenu((v) => !v)}
                    >
                        <I d="M12 5h.01M12 12h.01M12 19h.01" s={16} />
                    </button>
                    {menu && (
                        <div className="hm-project-menu" role="menu" onMouseLeave={() => setMenu(false)}>
                            <button type="button" role="menuitem" onClick={() => { setMenu(false); onOpen(project.id); }}>Open</button>
                            <button type="button" role="menuitem" onClick={() => { setMenu(false); setEditing(true); }}>Rename</button>
                            <button
                                type="button"
                                role="menuitem"
                                className="danger"
                                disabled={!canDelete}
                                title={canDelete ? undefined : 'Create another project before deleting your last one'}
                                onClick={() => { setMenu(false); onDelete(project.id); }}
                            >
                                Delete
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}

export default function HomeTool({
    user,
    activeProject,
    projects = [],
    quickTools = [],
    setTool,
    onNewProject,
    openProject,
    renameProject,
    deleteProject,
    workspaceBusyId,
    currentToken,
}) {
    const name = firstName(user);
    const greeting = greetingFor();
    const [quickFilter, setQuickFilter] = useState('all');

    const quick = useMemo(() => {
        const byId = new Map(quickTools.map((t) => [t.id, t]));
        return QUICK_START.map((id) => byId.get(id)).filter(Boolean);
    }, [quickTools]);

    const recent = useMemo(() => [...projects].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))), [projects]);

    return (
        <div className="hm">
            <div className="hm-main">
                <nav className="hm-studio-tabs" aria-label="Design studios">
                    {STUDIOS.map((studio) => (
                        <button
                            key={studio.id}
                            type="button"
                            className={`hm-studio-tab tone-${studio.tone} ${studio.id === 'print' ? 'is-active' : ''}`}
                            disabled={!studio.live}
                            aria-current={studio.id === 'print' ? 'page' : undefined}
                            onClick={() => setQuickFilter('print')}
                        >
                            <I d={studio.icon} s={19} />
                            <span>{studio.shortLabel}</span>
                            {!studio.live && <span className="hm-tab-soon">Soon</span>}
                        </button>
                    ))}
                </nav>

                <div className="hm-welcome">
                    <header className="hm-greet">
                        <span className="hm-greet-kicker">{greeting}</span>
                        <h1>Hi there{name ? `, ${name}` : ''}</h1>
                        <p>What would you like to design today?</p>
                    </header>
                    <p className="hm-manifesto">Design a more<br />colorful tomorrow.</p>
                </div>

                <section className="hm-studios" aria-label="Studios">
                    {STUDIOS.map((s, index) => (
                        <article key={s.id} className={`hm-studio tone-${s.tone} ${s.live ? '' : 'is-soon'}`}>
                            <div className="hm-studio-preview">
                                <img
                                    src={s.preview}
                                    alt={s.previewAlt}
                                    width="640"
                                    height="320"
                                    loading={index === 0 ? 'eager' : 'lazy'}
                                    decoding="async"
                                />
                                <span className={`hm-studio-status ${s.live ? 'is-live' : ''}`}>
                                    {s.live ? 'Available' : 'Coming soon'}
                                </span>
                            </div>
                            <div className="hm-studio-body">
                                <div className="hm-studio-title">
                                    <span className="hm-studio-title-icon" aria-hidden="true"><I d={s.icon} s={19} /></span>
                                    <h3>{s.label}</h3>
                                </div>
                                <strong className="hm-studio-category">{s.category}</strong>
                                <p>{s.blurb}</p>
                                <div className="hm-studio-capabilities" aria-label={`${s.shortLabel} capabilities`}>
                                    {s.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
                                </div>
                                {s.live ? (
                                    <button type="button" className="hm-studio-cta" onClick={() => setTool?.(s.tool)}>
                                        {s.cta} <I d="M5 12h14M13 6l6 6-6 6" s={14} />
                                    </button>
                                ) : (
                                    <span className="hm-studio-cta is-disabled" aria-disabled="true">In development</span>
                                )}
                                <span className="hm-studio-tagline">{s.tagline}</span>
                            </div>
                        </article>
                    ))}
                </section>

                <section className="hm-block" aria-labelledby="hm-quick-title">
                    <div className="hm-block-head">
                        <h2 id="hm-quick-title">Quick start</h2>
                        <div className="hm-filter-tabs" role="group" aria-label="Filter quick tools">
                            <button type="button" className={quickFilter === 'all' ? 'is-active' : ''} onClick={() => setQuickFilter('all')}>All</button>
                            <button type="button" className={quickFilter === 'print' ? 'is-active' : ''} onClick={() => setQuickFilter('print')}>Print</button>
                            <button type="button" disabled title="Embroidery Studio is coming soon">Embroidery</button>
                            <button type="button" disabled title="Woven Design Studio is coming soon">Woven</button>
                        </div>
                    </div>
                    <div className="hm-quick">
                        {quick.map((t) => (
                            <button key={t.id} type="button" className="hm-quick-tile" onClick={() => setTool?.(t.id)}>
                                <span className="hm-quick-icon" aria-hidden="true"><I d={t.icon} s={22} /></span>
                                <span className="hm-quick-label">{t.label}</span>
                                <span className="hm-quick-description">{QUICK_DESCRIPTIONS[t.id]}</span>
                                {t.requiresPro && <span className="hm-pro">Pro</span>}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="hm-block" aria-labelledby="hm-projects-title">
                    <div className="hm-block-head">
                        <h2 id="hm-projects-title">Recent projects</h2>
                        <div className="hm-project-actions">
                            <button type="button" className="hm-link-btn" onClick={onNewProject}>
                                <I d="M12 5v14M5 12h14" s={14} /> New project
                            </button>
                            <button type="button" className="hm-link-btn" onClick={() => setTool?.('workspace')}>View all</button>
                        </div>
                    </div>
                    {recent.length === 0 ? (
                        <div className="hm-empty">
                            <p>No projects yet.</p>
                            <button type="button" className="hm-studio-cta" onClick={onNewProject}>Create your first project</button>
                        </div>
                    ) : (
                        <div className="hm-projects">
                            {recent.map((p) => (
                                <ProjectCard
                                    key={p.id}
                                    project={p}
                                    active={p.id === activeProject?.id}
                                    token={currentToken}
                                    busy={workspaceBusyId === p.id}
                                    canDelete={projects.length > 1}
                                    onOpen={openProject}
                                    onRename={renameProject}
                                    onDelete={deleteProject}
                                />
                            ))}
                        </div>
                    )}
                </section>

                <section className="hm-ai-banner" aria-label="RIMI AI tools">
                    <div>
                        <h2>Design better, faster with RIMI AI</h2>
                        <p>Explore AI-powered tools that support your creative workflow from artwork to production.</p>
                    </div>
                    <div className="hm-ai-orbit" aria-hidden="true"><span /><span /><span /></div>
                    <button type="button" onClick={() => setTool?.('inspire')}>
                        Explore AI tools <I d="M5 12h14M13 6l6 6-6 6" s={15} />
                    </button>
                </section>
            </div>
        </div>
    );
}
