import React from 'react';
import I from '../shared/StudioIcons';

const AdminLogs = ({
    renderBudgetBanner,
    replicateLogsLoading,
    replicateLogs
}) => {
    return (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner && renderBudgetBanner()}
            <div className="admin-card glassmorphism-card replicate-logs-section">
                <div className="admin-card-header" style={{ justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <I d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" s={20} />
                        <h3>Activity Logs (Replicate API Billing)</h3>
                    </div>
                    <span className="admin-live-badge"><span className="pulse"></span> BILLING FEED</span>
                </div>
                <div className="admin-table-container">
                    {replicateLogsLoading ? (
                        <div className="st-error" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>Loading activity logs...</div>
                    ) : replicateLogs.length === 0 ? (
                        <div className="st-error" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No activity logs yet. Logs will appear here once AI tools are used.</div>
                    ) : (
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
                                        <td>
                                            <span className="model-tag">{log.model_name}</span>
                                        </td>
                                        <td>{Number(log.duration).toFixed(1)}s</td>
                                        <td className="strong">{log.credits} credits</td>
                                        <td className="cost-tag replicate">${Number(log.cost_usd).toFixed(5)}</td>
                                        <td className="time-tag">{log.created_at}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminLogs;
