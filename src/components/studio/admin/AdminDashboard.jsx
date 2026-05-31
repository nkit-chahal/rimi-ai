import React from 'react';
import I from '../shared/StudioIcons';

const AdminDashboard = ({
    adminStats,
    budgetData,
    adminUsers,
    setTool,
    renderBudgetBanner
}) => {
    const costByModel = {};
    adminStats.recentLogs.forEach(log => {
        costByModel[log.model_name] = (costByModel[log.model_name] || 0) + (log.cost_usd || 0);
    });

    return (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner && renderBudgetBanner()}
            {/* Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                {[
                    { label: 'Total Users', value: adminStats.totalUsers, icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z', color: '#6366f1' },
                    { label: 'Total Projects', value: adminStats.totalProjects, icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z', color: '#06b6d4' },
                    { label: 'API Calls (Recent)', value: adminStats.recentLogs.length, icon: 'M13 10V3L4 14h7v7l9-11h-7z', color: '#f59e0b' },
                    { label: 'Budget Remaining', value: `$${budgetData.remaining.toFixed(2)}`, icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: budgetData.remaining < 2 ? '#ef4444' : '#22c55e' },
                ].map((stat, i) => (
                    <div key={i} className="admin-card glassmorphism-card" style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: `${stat.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <I d={stat.icon} s={18} style={{ color: stat.color }} />
                            </div>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{stat.label}</span>
                        </div>
                        <div style={{ fontSize: '24px', fontWeight: 700 }}>{stat.value}</div>
                    </div>
                ))}
            </div>
            {/* Users Quick View */}
            <div className="admin-card glassmorphism-card" style={{ marginBottom: '16px' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '14px' }}>Users</strong>
                    <button className="admin-btn-primary" style={{ padding: '4px 14px', fontSize: '12px' }} onClick={() => setTool('admin-users')}>Manage →</button>
                </div>
                <div style={{ padding: '12px 20px' }}>
                    {adminUsers.slice(0, 5).map(u => (
                        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: u.role === 'admin' ? '#6366f1' : '#06b6d4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600, color: '#fff' }}>{u.initials}</div>
                                <div><div style={{ fontSize: '13px', fontWeight: 500 }}>{u.name}</div><div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{u.email}</div></div>
                            </div>
                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: u.role === 'admin' ? '#6366f120' : 'var(--bg-tertiary)', color: u.role === 'admin' ? '#6366f1' : 'var(--text-secondary)' }}>{u.role}</span>
                        </div>
                    ))}
                </div>
            </div>
            {/* Recent Activity */}
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
