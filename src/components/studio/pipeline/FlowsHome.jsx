import React, { useMemo, useState } from 'react';
import { I } from '../shared/StudioIcons';
import { PIPELINE_TEMPLATES } from './pipelineTemplates';

function formatRelativeDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString();
}

export default function FlowsHome({
    workflows = [],
    runs = [],
    onNewFlow,
    onOpenTemplate,
    onOpenWorkflow,
    onDuplicateWorkflow,
    onDeleteWorkflow,
}) {
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('updated');

    const recentItems = useMemo(() => {
        const wfItems = workflows.map((w) => ({
            id: `wf_${w.id}`,
            workflowId: w.id,
            name: w.name,
            updatedAt: w.updatedAt || w.createdAt,
            stepCount: w.steps?.length || w.graph?.nodes?.length || 0,
            kind: 'workflow',
            graph: w.graph,
            steps: w.steps,
            settings: w.settings,
        }));
        const runItems = runs.map((r) => ({
            id: `run_${r.id}`,
            name: r.name,
            updatedAt: r.completedAt || r.createdAt,
            stepCount: r.steps?.length || 0,
            kind: 'run',
            status: r.status,
        }));
        let items = [...wfItems, ...runItems];
        if (search.trim()) {
            const q = search.toLowerCase();
            items = items.filter((i) => i.name.toLowerCase().includes(q));
        }
        items.sort((a, b) => {
            if (sort === 'name') return a.name.localeCompare(b.name);
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
        return items;
    }, [workflows, runs, search, sort]);

    return (
        <div className="st-flows-home">
            <div className="st-flows-home-header">
                <div>
                    <h1>Flows <span className="st-flows-alpha">Beta</span></h1>
                    <p>Build visual AI pipelines for textile production workflows.</p>
                </div>
                <button type="button" className="st-flows-new-btn" onClick={onNewFlow}>
                    <I d="M12 5v14M5 12h14" s={18} /> New Flow
                </button>
            </div>

            <section className="st-flows-section">
                <h2>Inspiration</h2>
                <div className="st-flows-inspiration-scroll">
                    {PIPELINE_TEMPLATES.map((tmpl) => (
                        <button
                            key={tmpl.id}
                            type="button"
                            className="st-flows-inspiration-card"
                            onClick={() => onOpenTemplate(tmpl)}
                        >
                            <div className="st-flows-inspiration-preview">
                                <img src={tmpl.preview} alt="" />
                            </div>
                            <strong>{tmpl.name}</strong>
                            <span>{tmpl.desc}</span>
                        </button>
                    ))}
                </div>
            </section>

            <section className="st-flows-section">
                <div className="st-flows-recent-head">
                    <h2>Recent flows</h2>
                    <div className="st-flows-recent-controls">
                        <div className="st-flows-search">
                            <I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" s={16} />
                            <input
                                type="search"
                                placeholder="Search flows…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        <label className="st-flows-sort">
                            Sort by
                            <select value={sort} onChange={(e) => setSort(e.target.value)}>
                                <option value="updated">Last edited</option>
                                <option value="name">Name</option>
                            </select>
                        </label>
                    </div>
                </div>

                {recentItems.length === 0 ? (
                    <div className="st-flows-empty">
                        <p>No flows yet. Start from a template or create a new flow.</p>
                    </div>
                ) : (
                    <div className="st-flows-grid">
                        {recentItems.map((item) => (
                            <div key={item.id} className="st-flows-card">
                                <button
                                    type="button"
                                    className="st-flows-card-main"
                                    onClick={() => item.kind === 'workflow' && onOpenWorkflow(item)}
                                    disabled={item.kind === 'run'}
                                >
                                    <div className="st-flows-card-preview">
                                        <I d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" s={32} />
                                    </div>
                                    <strong>{item.name}</strong>
                                    <span>
                                        {item.kind === 'run' ? `Run · ${item.status}` : `${item.stepCount} nodes`}
                                        {' · '}
                                        {formatRelativeDate(item.updatedAt)}
                                    </span>
                                </button>
                                {item.kind === 'workflow' && (
                                    <div className="st-flows-card-actions">
                                        <button type="button" title="Duplicate" onClick={() => onDuplicateWorkflow(item)}>
                                            <I d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" s={14} />
                                        </button>
                                        <button type="button" title="Delete" className="danger" onClick={() => onDeleteWorkflow(item.workflowId)}>
                                            <I d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" s={14} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
