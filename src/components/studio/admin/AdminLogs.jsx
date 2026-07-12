import React, { useMemo, useState } from 'react';
import I from '../shared/StudioIcons';
import AdminPagination, { useClientPagination } from './AdminPagination';

const TABS = [
    { id: 'replicate', label: 'API Billing' },
    { id: 'logins', label: 'Logins' },
    { id: 'audit', label: 'Admin Audit' },
];

const AdminLogs = ({
    renderBudgetBanner,
    replicateLogsLoading,
    replicateLogs = [],
    loginEvents = [],
    adminAuditEvents = [],
    logsPage = 1,
    setLogsPage,
    logsPageSize = 25,
    replicateTotal = 0,
}) => {
    const [tab, setTab] = useState('replicate');
    const loginPager = useClientPagination(loginEvents, 20);
    const auditPager = useClientPagination(adminAuditEvents, 20);

    const replicateTotalPages = Math.max(1, Math.ceil((replicateTotal || 0) / logsPageSize));
    const replicateRange = useMemo(() => {
        const total = replicateTotal || 0;
        if (!total) return { start: 0, end: 0 };
        const start = (logsPage - 1) * logsPageSize + 1;
        const end = Math.min(logsPage * logsPageSize, total);
        return { start, end };
    }, [logsPage, logsPageSize, replicateTotal]);

    return (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner && renderBudgetBanner()}
            <div className="admin-card glassmorphism-card replicate-logs-section">
                <div className="admin-card-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <I d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" s={20} />
                        <h3>Activity Logs</h3>
                    </div>
                    <div className="admin-log-tabs" role="tablist" aria-label="Log sections">
                        {TABS.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={tab === item.id}
                                className={tab === item.id ? 'active' : ''}
                                onClick={() => setTab(item.id)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="admin-table-container">
                    {replicateLogsLoading ? (
                        <div className="st-error" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>Loading activity logs...</div>
                    ) : tab === 'replicate' ? (
                        replicateLogs.length === 0 ? (
                            <div className="st-error" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No API billing logs yet.</div>
                        ) : (
                            <>
                                <table className="admin-table">
                                    <thead>
                                        <tr>
                                            <th>AI Model Name</th>
                                            <th>Execution Duration</th>
                                            <th>Credits Charged</th>
                                            <th>Replicate API Cost</th>
                                            <th>Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {replicateLogs.map((log, index) => (
                                            <tr key={log.id || index}>
                                                <td><span className="model-tag">{log.model_name}</span></td>
                                                <td>{Number(log.duration).toFixed(1)}s</td>
                                                <td className="strong">{log.credits} credits</td>
                                                <td className="cost-tag replicate">${Number(log.cost_usd).toFixed(5)}</td>
                                                <td className="time-tag">{log.created_at}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <AdminPagination
                                    page={logsPage}
                                    totalPages={replicateTotalPages}
                                    total={replicateTotal}
                                    rangeStart={replicateRange.start}
                                    rangeEnd={replicateRange.end}
                                    onPageChange={setLogsPage}
                                    label="API calls"
                                />
                            </>
                        )
                    ) : tab === 'logins' ? (
                        loginEvents.length === 0 ? (
                            <div className="st-error" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No login events yet.</div>
                        ) : (
                            <>
                                <table className="admin-table">
                                    <thead>
                                        <tr>
                                            <th>User</th>
                                            <th>Email</th>
                                            <th>Provider</th>
                                            <th>IP</th>
                                            <th>Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loginPager.pageItems.map((ev, index) => (
                                            <tr key={ev.id || index}>
                                                <td><strong>{ev.user_name || '—'}</strong></td>
                                                <td style={{ fontSize: '12px' }}>{ev.user_email || '—'}</td>
                                                <td><span className="model-tag">{ev.provider || 'email'}</span></td>
                                                <td className="time-tag">{ev.ip_address || '—'}</td>
                                                <td className="time-tag">{ev.created_at}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <AdminPagination
                                    page={loginPager.page}
                                    totalPages={loginPager.totalPages}
                                    total={loginPager.total}
                                    rangeStart={loginPager.rangeStart}
                                    rangeEnd={loginPager.rangeEnd}
                                    onPageChange={loginPager.setPage}
                                    label="logins"
                                />
                            </>
                        )
                    ) : (
                        adminAuditEvents.length === 0 ? (
                            <div className="st-error" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No admin audit events yet.</div>
                        ) : (
                            <>
                                <table className="admin-table">
                                    <thead>
                                        <tr>
                                            <th>Action</th>
                                            <th>Admin</th>
                                            <th>Target</th>
                                            <th>Details</th>
                                            <th>Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {auditPager.pageItems.map((ev, index) => (
                                            <tr key={ev.id || index}>
                                                <td><span className="model-tag">{ev.action || '—'}</span></td>
                                                <td style={{ fontSize: '12px' }}>{ev.admin_name || ev.admin_email || '—'}</td>
                                                <td style={{ fontSize: '12px' }}>{ev.target_user_name || ev.target_user_email || '—'}</td>
                                                <td className="time-tag" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={ev.details_json || ''}>
                                                    {ev.details_json || '—'}
                                                </td>
                                                <td className="time-tag">{ev.created_at}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <AdminPagination
                                    page={auditPager.page}
                                    totalPages={auditPager.totalPages}
                                    total={auditPager.total}
                                    rangeStart={auditPager.rangeStart}
                                    rangeEnd={auditPager.rangeEnd}
                                    onPageChange={auditPager.setPage}
                                    label="events"
                                />
                            </>
                        )
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminLogs;
