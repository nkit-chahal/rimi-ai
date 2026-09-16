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
        label: 'Print Design Studio',
        blurb: 'Extract a repeat, make it seamless, build colourways and preview it on 31 products.',
        cta: 'Open Print Studio',
        tool: 'pattern',
        tone: 'violet',
        icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z',
        live: true,
    },
    {
        id: 'embroidery',
        label: 'Embroidery Studio',
        blurb: 'Placement, motif library, thread shade matching and stitch rendering.',
        cta: 'Coming soon',
        tone: 'coral',
        icon: 'M3 12l3-4 3 8 3-8 3 8 3-8 3 4',
        live: false,
    },
    {
        id: 'woven',
        label: 'Woven Design Studio',
        blurb: 'Checks and stripes, dobby and jacquard drafting, yarn libraries.',
        cta: 'Coming soon',
        tone: 'emerald',
        icon: 'M4 6h16M4 12h16M4 18h16M6 4v16M12 4v16M18 4v16',
        live: false,
    },
];

// Quick Start is the subset of tools a new user is most likely to reach for first, in the order
// the workflow actually runs. Ids must exist in the studio's tool registry.
const QUICK_START = ['pattern', 'seamless', 'inspire', 'colorways', 'repeat', 'vectorize', 'mappings', 'imagelayers'];

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
    const remaining = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));

    const quick = useMemo(() => {
        const byId = new Map(quickTools.map((t) => [t.id, t]));
        return QUICK_START.map((id) => byId.get(id)).filter(Boolean);
    }, [quickTools]);

    const recent = useMemo(() => [...projects].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))), [projects]);

    return (
        <div className="hm">
            <div className="hm-main">
                <header className="hm-greet">
                    <h1>{greeting}{name ? `, ${name}` : ''}<span aria-hidden="true"> 👋</span></h1>
                    <p>What would you like to design today?</p>
                </header>

                <section className="hm-studios" aria-label="Studios">
                    {STUDIOS.map((s) => (
                        <article key={s.id} className={`hm-studio tone-${s.tone} ${s.live ? '' : 'is-soon'}`}>
                            <div className="hm-studio-art" aria-hidden="true"><I d={s.icon} s={30} /></div>
                            <div className="hm-studio-body">
                                <h3>{s.label}{!s.live && <span className="hm-soon">Coming soon</span>}</h3>
                                <p>{s.blurb}</p>
                                {s.live ? (
                                    <button type="button" className="hm-studio-cta" onClick={() => setTool?.(s.tool)}>
                                        {s.cta} <I d="M5 12h14M13 6l6 6-6 6" s={14} />
                                    </button>
                                ) : (
                                    <span className="hm-studio-cta is-disabled" aria-disabled="true">In development</span>
                                )}
                            </div>
                        </article>
                    ))}
                </section>

                <section className="hm-block" aria-labelledby="hm-quick-title">
                    <div className="hm-block-head">
                        <h2 id="hm-quick-title">Quick start</h2>
                        <span className="hm-block-note">Print studio</span>
                    </div>
                    <div className="hm-quick">
                        {quick.map((t) => (
                            <button key={t.id} type="button" className="hm-quick-tile" onClick={() => setTool?.(t.id)}>
                                <span className="hm-quick-icon" aria-hidden="true"><I d={t.icon} s={22} /></span>
                                <span className="hm-quick-label">{t.label}</span>
                                {t.requiresPro && <span className="hm-pro">Pro</span>}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="hm-block" aria-labelledby="hm-projects-title">
                    <div className="hm-block-head">
                        <h2 id="hm-projects-title">Projects</h2>
                        <button type="button" className="hm-link-btn" onClick={onNewProject}>
                            <I d="M12 5v14M5 12h14" s={14} /> New project
                        </button>
                    </div>
                    {recent.length === 0 ? (
                        <div className="hm-empty">
                            <p>No projects yet.</p>
                            <button type="button" className="hm-studio-cta" onClick={onNewProject}>Create your first project</button>
                        </div>
                    ) : (
                        <div className="hm-projects">
                            <button type="button" className="hm-project hm-project-new" onClick={onNewProject}>
                                <span className="hm-project-new-icon" aria-hidden="true"><I d="M12 5v14M5 12h14" s={22} /></span>
                                <span>New project</span>
                            </button>
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
            </div>

            <aside className="hm-rail" aria-label="Quick actions">
                <section className="hm-card">
                    <h3>Working in</h3>
                    <p className="hm-current">{activeProject?.name || 'No project selected'}</p>
                    <p className="hm-muted">{activeProject?.updatedLabel || 'Pick a project or create one.'}</p>
                </section>

                <section className="hm-card">
                    <h3>Quick actions</h3>
                    <ul className="hm-actions">
                        <li><button type="button" onClick={() => setTool?.('pattern')}><I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={16} /> Upload artwork</button></li>
                        <li><button type="button" onClick={onNewProject}><I d="M12 5v14M5 12h14" s={16} /> Create new project</button></li>
                        <li><button type="button" onClick={() => setTool?.('seamless')}><I d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z" s={16} /> Make a tile seamless</button></li>
                        <li><button type="button" onClick={() => setTool?.('colorways')}><I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" s={16} /> Build colourways</button></li>
                        <li><button type="button" onClick={() => setTool?.('exports')}><I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={16} /> Export designs</button></li>
                    </ul>
                </section>

                <section className="hm-card hm-plan">
                    <h3>Your plan</h3>
                    <p className="hm-current">{user?.plan || '—'}</p>
                    <p className="hm-muted">{remaining.toLocaleString()} credits remaining</p>
                    <button type="button" className="hm-link-btn" onClick={() => setTool?.('billing')}>
                        Manage billing <I d="M5 12h14M13 6l6 6-6 6" s={14} />
                    </button>
                </section>
            </aside>
        </div>
    );
}
