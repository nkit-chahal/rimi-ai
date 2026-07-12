import React from 'react';
import I from '../shared/StudioIcons';

function shortDay(iso) {
    if (!iso) return '';
    try {
        return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    } catch {
        return iso.slice(5);
    }
}

function BarChart({ labels, values, variant = 'default', emptyLabel = 'No data yet' }) {
    const max = Math.max(0, ...values.map((v) => Number(v) || 0));
    if (!values.length || max <= 0) {
        return <div className="admin-empty-chart">{emptyLabel}</div>;
    }
    // Show at most ~14 bars for readability on 30-day windows
    const step = values.length > 14 ? Math.ceil(values.length / 14) : 1;
    const points = [];
    for (let i = 0; i < values.length; i += step) {
        points.push({ label: labels[i], value: Number(values[i]) || 0 });
    }
    const localMax = Math.max(0, ...points.map((p) => p.value)) || 1;

    return (
        <div className="admin-bar-chart" role="img" aria-label="Bar chart">
            {points.map((p, i) => (
                <div key={`${p.label}-${i}`} className="admin-bar-col" title={`${p.label}: ${p.value}`}>
                    <div
                        className={`admin-bar-fill ${variant}`}
                        style={{ height: `${Math.max(4, (p.value / localMax) * 100)}%` }}
                    />
                    <span className="admin-bar-label">{shortDay(p.label)}</span>
                </div>
            ))}
        </div>
    );
}

function HorizontalBars({ items, valueKey, labelKey, formatValue, emptyLabel = 'No data yet' }) {
    if (!items?.length) {
        return <div className="admin-empty-chart">{emptyLabel}</div>;
    }
    const max = Math.max(0, ...items.map((item) => Number(item[valueKey]) || 0)) || 1;
    return (
        <div className="admin-hbar-list">
            {items.map((item) => {
                const value = Number(item[valueKey]) || 0;
                return (
                    <div key={item[labelKey]} className="admin-hbar-row">
                        <span className="admin-hbar-name" title={item[labelKey]}>{item[labelKey]}</span>
                        <div className="admin-hbar-track">
                            <div className="admin-hbar-fill" style={{ width: `${(value / max) * 100}%` }} />
                        </div>
                        <span className="admin-hbar-value">{formatValue(value)}</span>
                    </div>
                );
            })}
        </div>
    );
}

const PIE_COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#64748b'];

function shortModelName(name) {
    if (!name) return 'unknown';
    const parts = String(name).split('/');
    return parts[parts.length - 1] || name;
}

function PieChart({ items, labelKey, valueKey, formatValue, emptyLabel = 'No data yet' }) {
    const slices = (items || [])
        .map((item) => ({
            label: item[labelKey],
            value: Number(item[valueKey]) || 0,
        }))
        .filter((s) => s.value > 0)
        .slice(0, 8);
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    if (!slices.length || total <= 0) {
        return <div className="admin-empty-chart">{emptyLabel}</div>;
    }

    const size = 160;
    const radius = 68;
    const cx = size / 2;
    const cy = size / 2;
    let angle = -Math.PI / 2;
    const arcs = slices.map((slice, index) => {
        const sweep = (slice.value / total) * Math.PI * 2;
        const start = angle;
        angle += sweep;
        const end = angle;
        const large = sweep > Math.PI ? 1 : 0;
        const x1 = cx + radius * Math.cos(start);
        const y1 = cy + radius * Math.sin(start);
        const x2 = cx + radius * Math.cos(end);
        const y2 = cy + radius * Math.sin(end);
        const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
        return { ...slice, path, color: PIE_COLORS[index % PIE_COLORS.length] };
    });

    return (
        <div className="admin-pie-wrap">
            <svg className="admin-pie-svg" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Pie chart">
                {arcs.map((arc) => (
                    <path key={arc.label} d={arc.path} fill={arc.color} stroke="#fff" strokeWidth="2">
                        <title>{`${arc.label}: ${formatValue(arc.value)}`}</title>
                    </path>
                ))}
                <circle cx={cx} cy={cy} r="34" fill="#fff" />
                <text x={cx} y={cy - 4} textAnchor="middle" className="admin-pie-center-value">{formatValue(total)}</text>
                <text x={cx} y={cy + 12} textAnchor="middle" className="admin-pie-center-label">total</text>
            </svg>
            <ul className="admin-pie-legend">
                {arcs.map((arc) => (
                    <li key={arc.label}>
                        <span className="admin-pie-swatch" style={{ background: arc.color }} />
                        <span className="admin-pie-legend-label" title={arc.label}>{shortModelName(arc.label)}</span>
                        <span className="admin-pie-legend-value">{formatValue(arc.value)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

const AdminDashboard = ({
    adminStats,
    budgetData,
    adminUsers,
    adminBilling,
    adminAnalytics,
    adminAnalyticsLoading,
    setTool,
    renderBudgetBanner,
}) => {
    const summary = adminAnalytics?.summary || {};
    const billingSummary = adminBilling?.summary || {};

    return (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner && renderBudgetBanner()}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                {[
                    { label: 'Total Users', value: adminStats.totalUsers, icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z', color: '#6366f1' },
                    { label: 'Total Projects', value: adminStats.totalProjects, icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z', color: '#06b6d4' },
                    { label: 'API Calls (30d)', value: summary.apiCalls ?? adminStats.recentLogs.length, icon: 'M13 10V3L4 14h7v7l9-11h-7z', color: '#f59e0b' },
                    { label: 'Budget Remaining', value: `$${(budgetData?.remaining ?? 0).toFixed(2)}`, icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: (budgetData?.remaining ?? 0) < 2 ? '#ef4444' : '#22c55e' },
                    { label: 'Paid Orders (30d)', value: summary.paidOrders ?? billingSummary.paidOrders ?? 0, icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', color: '#8b5cf6' },
                    { label: 'Credits Spent', value: (billingSummary.totalCreditsSpent || 0).toLocaleString(), icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: '#0ea5e9' },
                ].map((stat, i) => (
                    <div key={i} className="admin-card glassmorphism-card" style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: `${stat.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <I d={stat.icon} s={18} style={{ color: stat.color }} />
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{stat.label}</span>
                        </div>
                        <div style={{ fontSize: '22px', fontWeight: 700 }}>{stat.value}</div>
                    </div>
                ))}
            </div>

            <div className="admin-charts-grid">
                <div className="admin-card glassmorphism-card admin-chart-card">
                    <h4>Feature usage</h4>
                    <p className="admin-chart-sub">Exports / tool runs by day (last {adminAnalytics?.days || 30} days)</p>
                    {adminAnalyticsLoading ? (
                        <div className="admin-empty-chart">Loading analytics…</div>
                    ) : (
                        <BarChart
                            labels={adminAnalytics?.labels || []}
                            values={adminAnalytics?.featureUsageByDay || []}
                            emptyLabel="No feature exports in this period"
                        />
                    )}
                </div>
                <div className="admin-card glassmorphism-card admin-chart-card">
                    <h4>API spend (USD)</h4>
                    <p className="admin-chart-sub">Replicate cost by day · total ${Number(summary.apiSpendUsd || 0).toFixed(4)}</p>
                    {adminAnalyticsLoading ? (
                        <div className="admin-empty-chart">Loading analytics…</div>
                    ) : (
                        <BarChart
                            labels={adminAnalytics?.labels || []}
                            values={adminAnalytics?.apiSpendByDay || []}
                            variant="spend"
                            emptyLabel="No API spend in this period"
                        />
                    )}
                </div>
                <div className="admin-card glassmorphism-card admin-chart-card">
                    <h4>Logins</h4>
                    <p className="admin-chart-sub">Sign-ins by day</p>
                    {adminAnalyticsLoading ? (
                        <div className="admin-empty-chart">Loading analytics…</div>
                    ) : (
                        <BarChart
                            labels={adminAnalytics?.labels || []}
                            values={adminAnalytics?.loginsByDay || []}
                            variant="login"
                            emptyLabel="No logins in this period"
                        />
                    )}
                </div>
                <div className="admin-card glassmorphism-card admin-chart-card">
                    <h4>AI model usage</h4>
                    <p className="admin-chart-sub">Calls by model name (pie)</p>
                    {adminAnalyticsLoading ? (
                        <div className="admin-empty-chart">Loading analytics…</div>
                    ) : (
                        <PieChart
                            items={adminAnalytics?.usageByModel || adminAnalytics?.costByModel || []}
                            labelKey="model"
                            valueKey="count"
                            formatValue={(v) => Number(v).toLocaleString()}
                            emptyLabel="No model usage yet"
                        />
                    )}
                </div>
                <div className="admin-card glassmorphism-card admin-chart-card">
                    <h4>Features by tool</h4>
                    <p className="admin-chart-sub">Export / tool_type share (pie)</p>
                    {adminAnalyticsLoading ? (
                        <div className="admin-empty-chart">Loading analytics…</div>
                    ) : (
                        <PieChart
                            items={adminAnalytics?.featureUsageByTool || []}
                            labelKey="tool"
                            valueKey="count"
                            formatValue={(v) => Number(v).toLocaleString()}
                            emptyLabel="No feature usage yet"
                        />
                    )}
                </div>
                <div className="admin-card glassmorphism-card admin-chart-card">
                    <h4>Cost by model</h4>
                    <p className="admin-chart-sub">Top models by Replicate spend</p>
                    {adminAnalyticsLoading ? (
                        <div className="admin-empty-chart">Loading analytics…</div>
                    ) : (
                        <HorizontalBars
                            items={adminAnalytics?.costByModel || []}
                            labelKey="model"
                            valueKey="costUsd"
                            formatValue={(v) => `$${Number(v).toFixed(4)}`}
                            emptyLabel="No model spend yet"
                        />
                    )}
                </div>
            </div>

            <div className="admin-card glassmorphism-card" style={{ marginBottom: '16px' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '14px' }}>Users</strong>
                    <button className="admin-btn-primary" style={{ padding: '4px 14px', fontSize: '12px' }} onClick={() => setTool('admin-users')}>Manage →</button>
                </div>
                <div style={{ padding: '12px 20px' }}>
                    {adminUsers.slice(0, 5).map((u) => (
                        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: u.role === 'admin' ? '#6366f1' : '#06b6d4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600, color: '#fff' }}>{u.initials}</div>
                                <div>
                                    <div style={{ fontSize: '13px', fontWeight: 500 }}>{u.name}</div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{u.email}</div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <span className={`admin-status-pill ${(u.status || 'active') === 'suspended' ? 'suspended' : 'active'}`}>
                                    {(u.status || 'active') === 'suspended' ? 'Blocked' : 'Active'}
                                </span>
                                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: u.role === 'admin' ? '#6366f120' : 'var(--bg-tertiary)', color: u.role === 'admin' ? '#6366f1' : 'var(--text-secondary)' }}>{u.role}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="admin-card glassmorphism-card">
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '14px' }}>Recent API Activity</strong>
                    <button className="admin-btn-primary" style={{ padding: '4px 14px', fontSize: '12px' }} onClick={() => setTool('admin-logs')}>View All →</button>
                </div>
                <div style={{ padding: '8px 20px' }}>
                    {adminStats.recentLogs.length === 0 ? (
                        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>No API calls yet</div>
                    ) : adminStats.recentLogs.map((log, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: '12px' }}>
                            <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{log.model_name}</span>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <span>{log.duration?.toFixed(1)}s</span>
                                <span style={{ color: '#ef4444', fontWeight: 600 }}>${log.cost_usd?.toFixed(4)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
