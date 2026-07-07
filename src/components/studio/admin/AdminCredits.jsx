import React, { useEffect, useState } from 'react';
import I from '../shared/StudioIcons';
import { API } from '../shared/helpers';

const AdminCredits = ({
    renderBudgetBanner,
    adminUsers,
    adminSelectedUserId,
    setAdminSelectedUserId,
    adminUsersLoading,
    currentToken,
    fetchAdminUsers,
    adminPricing = [],
    adminPricingLoading = false,
    fetchAdminPricing,
}) => {
    const [creditAdjustmentAmount, setCreditAdjustmentAmount] = useState(5000);
    const [creditFeedback, setCreditFeedback] = useState('');
    const [pricingFeedback, setPricingFeedback] = useState('');
    const [editedCredits, setEditedCredits] = useState({});
    const [qwenBurn, setQwenBurn] = useState(null);

    useEffect(() => {
        if (!currentToken) return;
        fetch(`${API}/api/admin/qwen-burn`, { headers: { Authorization: `Bearer ${currentToken}` } })
            .then((r) => r.json())
            .then((d) => { if (d.success) setQwenBurn(d); })
            .catch(() => {});
    }, [currentToken]);

    useEffect(() => {
        const next = {};
        adminPricing.forEach((row) => {
            next[row.tool_key] = row.credits;
        });
        setEditedCredits(next);
    }, [adminPricing]);

    const handleAdjustCredits = (e) => {
        e.preventDefault();
        const selectedUser = adminUsers.find(u => u.id === adminSelectedUserId);
        if (!selectedUser) return;
        const amount = parseInt(creditAdjustmentAmount);
        if (isNaN(amount)) return;

        const newLimit = selectedUser.creditsLimit + amount;
        setCreditFeedback('');

        fetch(`${API}/api/admin/adjust-credits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ userId: selectedUser.id, creditsLimit: newLimit }),
        })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    setCreditFeedback(`Successfully updated credits for ${selectedUser.name}! New limit: ${newLimit.toLocaleString()}`);
                    fetchAdminUsers();
                } else {
                    setCreditFeedback(`Error: ${d.error || 'Failed to update credits'}`);
                }
            })
            .catch(err => {
                setCreditFeedback(`Error: ${err.message}`);
            });
        setTimeout(() => setCreditFeedback(''), 5000);
    };

    const handlePricingUpdate = (row) => {
        const credits = parseInt(editedCredits[row.tool_key], 10);
        if (Number.isNaN(credits) || credits < 0) {
            setPricingFeedback('Credits must be zero or greater.');
            return;
        }
        setPricingFeedback('');
        fetch(`${API}/api/admin/credit-pricing/${encodeURIComponent(row.tool_key)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({
                label: row.label,
                apiName: row.api_name,
                credits,
                pricingType: row.pricing_type,
                isActive: row.is_active,
            }),
        })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    setPricingFeedback(`Updated pricing for ${row.label}.`);
                    fetchAdminPricing?.();
                } else {
                    setPricingFeedback(d.error || 'Failed to update pricing.');
                }
            })
            .catch((err) => setPricingFeedback(err.message || 'Failed to update pricing.'));
        setTimeout(() => setPricingFeedback(''), 4000);
    };

    const selectedUser = adminUsers.find(u => u.id === adminSelectedUserId);

    return (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner && renderBudgetBanner()}
            {qwenBurn && (
                <div className="admin-card glassmorphism-card" style={{ maxWidth: '600px', margin: '0 auto 24px' }}>
                    <div className="admin-card-header">
                        <I d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" s={20} />
                        <h3>Qwen Burn</h3>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '0 4px 8px' }}>
                        <div><small style={{ color: 'var(--text-muted)' }}>Total API cost</small><div style={{ fontWeight: 700 }}>${qwenBurn.totalCostUsd?.toFixed(2)}</div></div>
                        <div><small style={{ color: 'var(--text-muted)' }}>Last 7 days</small><div style={{ fontWeight: 700 }}>${qwenBurn.burnLast7DaysUsd?.toFixed(2)}</div></div>
                        <div><small style={{ color: 'var(--text-muted)' }}>Credits burned</small><div style={{ fontWeight: 700 }}>{qwenBurn.totalCredits?.toLocaleString()}</div></div>
                        <div><small style={{ color: 'var(--text-muted)' }}>Output volume</small><div style={{ fontWeight: 700 }}>{(qwenBurn.totalOutputBytes / (1024 * 1024)).toFixed(1)} MB</div></div>
                        <div><small style={{ color: 'var(--text-muted)' }}>Sessions</small><div style={{ fontWeight: 700 }}>{qwenBurn.sessionCount}</div></div>
                        <div><small style={{ color: 'var(--text-muted)' }}>Layer versions</small><div style={{ fontWeight: 700 }}>{qwenBurn.versionCount}</div></div>
                    </div>
                </div>
            )}
            <div className="admin-card glassmorphism-card" style={{ maxWidth: '600px', margin: '0 auto 24px' }}>
                <div className="admin-card-header">
                    <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" s={20} />
                    <h3>AI Credits Adjustment</h3>
                </div>
                {adminUsersLoading ? (
                    <div className="st-error" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>Loading users...</div>
                ) : adminUsers.length === 0 ? (
                    <div className="st-error" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>No users found.</div>
                ) : (
                    <form onSubmit={handleAdjustCredits} className="admin-form">
                        {creditFeedback && (
                            <div className={`admin-feedback-badge ${creditFeedback.startsWith('Error') ? 'error' : ''}`}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    {creditFeedback.startsWith('Error') ? (
                                        <><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></>
                                    ) : (
                                        <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></>
                                    )}
                                </svg>
                                <span>{creditFeedback}</span>
                            </div>
                        )}
                        <div className="admin-field">
                            <label>Select User</label>
                            <select
                                value={adminSelectedUserId || ''}
                                onChange={(e) => setAdminSelectedUserId(Number(e.target.value))}
                                className="admin-select"
                            >
                                {adminUsers.map(u => (
                                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                                ))}
                            </select>
                        </div>
                        {selectedUser && (
                            <div className="admin-user-info-bar">
                                <div>
                                    <strong>Current Limit:</strong> {selectedUser.creditsLimit.toLocaleString()} credits
                                </div>
                                <div>
                                    <strong>Used:</strong> {selectedUser.creditsUsed.toLocaleString()} credits ({Math.round((selectedUser.creditsUsed / selectedUser.creditsLimit) * 100)}%)
                                </div>
                            </div>
                        )}
                        <div className="admin-field">
                            <label>Adjust Credits Limit (Add or subtract)</label>
                            <div className="admin-input-group">
                                <input
                                    type="number"
                                    value={creditAdjustmentAmount}
                                    onChange={(e) => setCreditAdjustmentAmount(e.target.value)}
                                    className="admin-input"
                                    placeholder="e.g. 5000"
                                />
                                <button type="submit" className="admin-btn-primary">
                                    Update Limit
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </div>

            <div className="admin-card glassmorphism-card">
                <div className="admin-card-header">
                    <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" s={20} />
                    <h3>Credit Pricing</h3>
                    {fetchAdminPricing && (
                        <button type="button" className="admin-btn-primary" style={{ marginLeft: 'auto' }} onClick={fetchAdminPricing} disabled={adminPricingLoading}>
                            {adminPricingLoading ? 'Refreshing…' : 'Refresh'}
                        </button>
                    )}
                </div>
                {pricingFeedback && <div className="admin-feedback-badge">{pricingFeedback}</div>}
                {adminPricingLoading && adminPricing.length === 0 ? (
                    <div className="st-error" style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', textAlign: 'center', padding: '24px 0' }}>Loading pricing…</div>
                ) : (
                    <div className="admin-pricing-table">
                        {adminPricing.map((row) => (
                            <div key={row.tool_key} className="admin-pricing-row">
                                <div>
                                    <strong>{row.label}</strong>
                                    <span>{row.tool_key}</span>
                                </div>
                                <input
                                    type="number"
                                    className="admin-input"
                                    value={editedCredits[row.tool_key] ?? row.credits}
                                    onChange={(e) => setEditedCredits((prev) => ({ ...prev, [row.tool_key]: e.target.value }))}
                                    style={{ width: '88px' }}
                                />
                                <button type="button" className="admin-btn-primary" onClick={() => handlePricingUpdate(row)}>Save</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminCredits;
