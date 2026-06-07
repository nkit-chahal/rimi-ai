import React, { useState } from 'react';
import I from '../shared/StudioIcons';
import { API } from '../shared/helpers';

const AdminUsers = ({
    renderBudgetBanner,
    adminUsersLoading,
    adminUsers,
    currentToken,
    fetchAdminUsers
}) => {
    const [showCreateUserModal, setShowCreateUserModal] = useState(false);
    const [createUserForm, setCreateUserForm] = useState({ email: '', password: '', name: '', role: 'user', plan: 'Business Studio', creditsLimit: '25000', freeGenerations: '10' });
    const [createUserFeedback, setCreateUserFeedback] = useState('');
    const [deleteFeedback, setDeleteFeedback] = useState('');

    const handleCreateUser = () => {
        const { email, password, name, role, plan, creditsLimit, freeGenerations } = createUserForm;
        if (!email || !password || !name) { setCreateUserFeedback('All fields are required'); return; }
        fetch(`${API}/api/admin/create-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ email, password, name, role, plan, creditsLimit: parseInt(creditsLimit), freeGenerations: parseInt(freeGenerations) }),
        })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    setCreateUserFeedback('✓ ' + d.message);
                    setShowCreateUserModal(false);
                    setCreateUserForm({ email: '', password: '', name: '', role: 'user', plan: 'Business Studio', creditsLimit: '25000', freeGenerations: '10' });
                    fetchAdminUsers();
                } else {
                    setCreateUserFeedback('✗ ' + (d.error || 'Failed'));
                }
            });
        setTimeout(() => setCreateUserFeedback(''), 5000);
    };

    const handleDeleteUser = (userId, userName) => {
        if (!window.confirm(`Delete user "${userName}"? This cannot be undone.`)) return;
        fetch(`${API}/api/admin/delete-user/${userId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${currentToken}` } })
            .then(r => r.json())
            .then(d => {
                if (d.success) fetchAdminUsers();
                else {
                    setDeleteFeedback('✗ ' + (d.error || 'Failed to delete user'));
                    setTimeout(() => setDeleteFeedback(''), 5000);
                }
            });
    };

    return (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner && renderBudgetBanner()}
            {createUserFeedback && <div style={{ padding: '8px 16px', marginBottom: '12px', borderRadius: '8px', background: createUserFeedback.startsWith('✓') ? '#22c55e20' : '#ef444420', color: createUserFeedback.startsWith('✓') ? '#22c55e' : '#ef4444', fontSize: '13px', fontWeight: 500 }}>{createUserFeedback}</div>}
            {deleteFeedback && <div style={{ padding: '8px 16px', marginBottom: '12px', borderRadius: '8px', background: deleteFeedback.startsWith('✓') ? '#22c55e20' : '#ef444420', color: deleteFeedback.startsWith('✓') ? '#22c55e' : '#ef4444', fontSize: '13px', fontWeight: 500 }}>{deleteFeedback}</div>}
            <div className="admin-card glassmorphism-card replicate-logs-section">
                <div className="admin-card-header" style={{ justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <I d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" s={20} />
                        <h3>User Management</h3>
                    </div>
                    <button className="admin-btn-primary" style={{ padding: '6px 16px', fontSize: '12px' }} onClick={() => setShowCreateUserModal(true)}>
                        <I d="M12 6v6m0 0v6m0-6h6m-6 0H6" s={14} /> Create User
                    </button>
                </div>
                <div className="admin-table-container">
                    {adminUsersLoading ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>Loading users...</div>
                    ) : adminUsers.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>No users found.</div>
                    ) : (
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Email</th>
                                    <th>Role</th>
                                    <th>Plan</th>
                                    <th>Credits</th>
                                    <th>Free Gens</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {adminUsers.map((u) => (
                                    <tr key={u.id}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: u.role === 'admin' ? '#6366f1' : '#06b6d4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: '#fff', flexShrink: 0 }}>{u.initials}</div>
                                                <strong>{u.name}</strong>
                                            </div>
                                        </td>
                                        <td style={{ fontSize: '12px' }}>{u.email}</td>
                                        <td><span className={`model-tag ${u.role === 'admin' ? 'admin' : ''}`}>{u.role}</span></td>
                                        <td><span className="model-tag">{u.plan}</span></td>
                                        <td style={{ fontSize: '12px' }}>{u.creditsUsed?.toLocaleString()} / {u.creditsLimit?.toLocaleString()}</td>
                                        <td style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e' }}>{u.freeGenerations || 0}</td>
                                        <td>
                                            <button style={{ padding: '3px 10px', fontSize: '11px', background: '#ef444420', color: '#ef4444', border: '1px solid #ef444440', borderRadius: '6px', cursor: 'pointer' }} onClick={() => handleDeleteUser(u.id, u.name)}>Delete</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
            {/* Create User Modal */}
            {showCreateUserModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowCreateUserModal(false)}>
                    <div className="admin-card glassmorphism-card" style={{ width: '440px', maxHeight: '90vh', overflow: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginBottom: '16px' }}>Create New User</h3>
                        {[
                            { label: 'Full Name', key: 'name', type: 'text', placeholder: 'John Doe' },
                            { label: 'Email', key: 'email', type: 'email', placeholder: 'john@company.com' },
                            { label: 'Password', key: 'password', type: 'password', placeholder: '••••••••' },
                            { label: 'Credit Limit', key: 'creditsLimit', type: 'number', placeholder: '25000' },
                            { label: 'Free Generations', key: 'freeGenerations', type: 'number', placeholder: '10' },
                        ].map(f => (
                            <div key={f.key} style={{ marginBottom: '12px' }}>
                                <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>{f.label}</label>
                                <input className="admin-input" type={f.type} placeholder={f.placeholder} value={createUserForm[f.key]} onChange={e => setCreateUserForm(prev => ({ ...prev, [f.key]: e.target.value }))} style={{ width: '100%', padding: '8px 12px', fontSize: '13px' }} />
                            </div>
                        ))}
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Role</label>
                            <select className="admin-input" value={createUserForm.role} onChange={e => setCreateUserForm(prev => ({ ...prev, role: e.target.value }))} style={{ width: '100%', padding: '8px 12px', fontSize: '13px' }}>
                                <option value="user">User</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Plan</label>
                            <select className="admin-input" value={createUserForm.plan} onChange={e => setCreateUserForm(prev => ({ ...prev, plan: e.target.value }))} style={{ width: '100%', padding: '8px 12px', fontSize: '13px' }}>
                                <option value="Business Studio">Business Studio</option>
                                <option value="Enterprise Pro">Enterprise Pro</option>
                                <option value="Free Trial">Free Trial</option>
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button style={{ padding: '8px 16px', fontSize: '13px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => setShowCreateUserModal(false)}>Cancel</button>
                            <button className="admin-btn-primary" style={{ padding: '8px 20px', fontSize: '13px' }} onClick={handleCreateUser}>Create User</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminUsers;
