import React, { useMemo, useState } from 'react';
import I from '../shared/StudioIcons';
import { API } from '../shared/helpers';
import AdminPagination, { useClientPagination } from './AdminPagination';

const PLAN_OPTIONS = [
    'Free Trial',
    'Starter',
    'Creator',
    'Pro',
    'Scale',
    'Business Studio',
    'Business Pro',
    'Enterprise',
    'Enterprise Pro',
];

const emptyCreateForm = {
    email: '',
    password: '',
    name: '',
    role: 'user',
    plan: 'Free Trial',
    creditsLimit: '200',
    freeGenerations: '0',
};

function emptyEditForm(user) {
    return {
        email: user?.email || '',
        password: '',
        name: user?.name || '',
        role: user?.role || 'user',
        plan: user?.plan || 'Free Trial',
        creditsLimit: String(user?.creditsLimit ?? 0),
        status: user?.status || 'active',
    };
}

const AdminUsers = ({
    renderBudgetBanner,
    adminUsersLoading,
    adminUsers,
    currentToken,
    fetchAdminUsers,
    currentUserId = null,
}) => {
    const [showCreateUserModal, setShowCreateUserModal] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [createUserForm, setCreateUserForm] = useState(emptyCreateForm);
    const [editUserForm, setEditUserForm] = useState(emptyEditForm());
    const [feedback, setFeedback] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [busyUserId, setBusyUserId] = useState(null);

    const showFeedback = (message) => {
        setFeedback(message);
        setTimeout(() => setFeedback(''), 5000);
    };

    const filteredUsers = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return adminUsers;
        return adminUsers.filter((u) => {
            const hay = `${u.name || ''} ${u.email || ''} ${u.plan || ''} ${u.role || ''}`.toLowerCase();
            return hay.includes(q);
        });
    }, [adminUsers, searchQuery]);

    const pager = useClientPagination(filteredUsers, 20);

    const canBlockUser = (u) => {
        if (!u) return false;
        if (u.role === 'admin') return false;
        if (currentUserId != null && Number(u.id) === Number(currentUserId)) return false;
        return true;
    };

    const handleCreateUser = () => {
        const { email, password, name, role, plan, creditsLimit, freeGenerations } = createUserForm;
        if (!email || !password || !name) {
            showFeedback('✗ All fields are required');
            return;
        }
        fetch(`${API}/api/admin/create-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
            body: JSON.stringify({
                email,
                password,
                name,
                role,
                plan,
                creditsLimit: parseInt(creditsLimit, 10),
                freeGenerations: parseInt(freeGenerations, 10) || 0,
            }),
        })
            .then((r) => r.json())
            .then((d) => {
                if (d.success) {
                    showFeedback('✓ ' + d.message);
                    setShowCreateUserModal(false);
                    setCreateUserForm(emptyCreateForm);
                    fetchAdminUsers();
                } else {
                    showFeedback('✗ ' + (d.error || 'Failed'));
                }
            })
            .catch(() => showFeedback('✗ Failed to create user'));
    };

    const openEdit = (user) => {
        setEditingUser(user);
        setEditUserForm(emptyEditForm(user));
    };

    const handleUpdateUser = () => {
        if (!editingUser) return;
        const { email, password, name, role, plan, creditsLimit, status } = editUserForm;
        if (!email || !name) {
            showFeedback('✗ Email and name are required');
            return;
        }
        const body = {
            email,
            name,
            role,
            plan,
            status,
            creditsLimit: parseInt(creditsLimit, 10),
        };
        if (password) body.password = password;

        setBusyUserId(editingUser.id);
        fetch(`${API}/api/admin/users/${editingUser.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
            body: JSON.stringify(body),
        })
            .then((r) => r.json())
            .then((d) => {
                if (d.success) {
                    showFeedback('✓ ' + d.message);
                    setEditingUser(null);
                    fetchAdminUsers();
                } else {
                    showFeedback('✗ ' + (d.error || 'Failed to update user'));
                }
            })
            .catch(() => showFeedback('✗ Failed to update user'))
            .finally(() => setBusyUserId(null));
    };

    const handleToggleBlock = (user) => {
        const suspended = (user.status || 'active') === 'suspended';
        if (!suspended && !canBlockUser(user)) {
            showFeedback('✗ Cannot block this account');
            return;
        }
        const action = suspended ? 'Unblock' : 'Block';
        const detail = suspended
            ? `Unblock "${user.name}" so they can sign in again?`
            : `Block "${user.name}"? They will not be able to sign in. You can unblock later.`;
        if (!window.confirm(detail)) return;

        const path = suspended
            ? `/api/admin/unsuspend-user/${user.id}`
            : `/api/admin/suspend-user/${user.id}`;

        setBusyUserId(user.id);
        fetch(`${API}${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${currentToken}` },
        })
            .then((r) => r.json())
            .then((d) => {
                if (d.success) {
                    showFeedback(`✓ ${action}ed ${user.name}`);
                    fetchAdminUsers();
                } else {
                    showFeedback('✗ ' + (d.error || `Failed to ${action.toLowerCase()} user`));
                }
            })
            .catch(() => showFeedback(`✗ Failed to ${action.toLowerCase()} user`))
            .finally(() => setBusyUserId(null));
    };

    const handleDeleteUser = (userId, userName) => {
        if (!window.confirm(`Permanently delete user "${userName}"? This cannot be undone. Prefer Block to revoke access temporarily.`)) return;
        setBusyUserId(userId);
        fetch(`${API}/api/admin/delete-user/${userId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${currentToken}` },
        })
            .then((r) => r.json())
            .then((d) => {
                if (d.success) {
                    showFeedback(`✓ Deleted ${userName}`);
                    fetchAdminUsers();
                } else {
                    showFeedback('✗ ' + (d.error || 'Failed to delete user'));
                }
            })
            .catch(() => showFeedback('✗ Failed to delete user'))
            .finally(() => setBusyUserId(null));
    };

    const handleExtendExpiry = (user) => {
        if (!window.confirm(`Extend expiry for "${user.name}" by 30 days?`)) return;
        setBusyUserId(user.id);
        fetch(`${API}/api/admin/extend-expiry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
            body: JSON.stringify({ userId: user.id }),
        })
            .then((r) => r.json())
            .then((d) => {
                if (d.success) {
                    const daysLabel = d.resetDays != null ? ` (${d.resetDays}d left)` : '';
                    showFeedback(`✓ Extended expiry for ${user.name}${daysLabel}`);
                    fetchAdminUsers();
                } else {
                    showFeedback('✗ ' + (d.error || 'Failed to extend expiry'));
                }
            })
            .catch(() => showFeedback('✗ Failed to extend expiry'))
            .finally(() => setBusyUserId(null));
    };

    const renderUserFormFields = (form, setForm, { passwordRequired }) => (
        <>
            {[
                { label: 'Full Name', key: 'name', type: 'text', placeholder: 'John Doe' },
                { label: 'Email', key: 'email', type: 'email', placeholder: 'john@company.com' },
                {
                    label: passwordRequired ? 'Password' : 'New Password (optional)',
                    key: 'password',
                    type: 'password',
                    placeholder: '••••••••',
                },
                { label: 'Credit Limit', key: 'creditsLimit', type: 'number', placeholder: '200' },
            ].map((f) => (
                <div key={f.key} className="admin-field" style={{ marginBottom: '12px' }}>
                    <label>{f.label}</label>
                    <input
                        className="admin-input"
                        type={f.type}
                        placeholder={f.placeholder}
                        value={form[f.key]}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        style={{ width: '100%', padding: '8px 12px', fontSize: '13px' }}
                    />
                </div>
            ))}
            <div className="admin-field" style={{ marginBottom: '12px' }}>
                <label>Role</label>
                <select
                    className="admin-input"
                    value={form.role}
                    onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', fontSize: '13px' }}
                >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <div className="admin-field" style={{ marginBottom: form.status !== undefined ? '12px' : '16px' }}>
                <label>Plan</label>
                <select
                    className="admin-input"
                    value={form.plan}
                    onChange={(e) => setForm((prev) => ({ ...prev, plan: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', fontSize: '13px' }}
                >
                    {PLAN_OPTIONS.map((plan) => (
                        <option key={plan} value={plan}>{plan}</option>
                    ))}
                </select>
            </div>
            {form.status !== undefined && (
                <div className="admin-field" style={{ marginBottom: '16px' }}>
                    <label>Status</label>
                    <select
                        className="admin-input"
                        value={form.status}
                        onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                        style={{ width: '100%', padding: '8px 12px', fontSize: '13px' }}
                    >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended (blocked)</option>
                    </select>
                </div>
            )}
        </>
    );

    return (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner && renderBudgetBanner()}
            {feedback && (
                <div
                    className={`admin-feedback-badge ${feedback.startsWith('✗') ? 'error' : ''}`}
                    style={{
                        background: feedback.startsWith('✓') ? '#22c55e20' : '#ef444420',
                        color: feedback.startsWith('✓') ? '#22c55e' : '#ef4444',
                        border: 'none',
                    }}
                >
                    {feedback}
                </div>
            )}
            <div className="admin-card glassmorphism-card replicate-logs-section">
                <div className="admin-card-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <I d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" s={20} />
                        <h3>User Management</h3>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <input
                            className="admin-input"
                            type="search"
                            placeholder="Search name or email…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ minWidth: '200px', padding: '6px 12px', fontSize: '12px' }}
                        />
                        <button className="admin-btn-primary" style={{ padding: '6px 16px', fontSize: '12px' }} onClick={() => setShowCreateUserModal(true)}>
                            <I d="M12 6v6m0 0v6m0-6h6m-6 0H6" s={14} /> Create User
                        </button>
                    </div>
                </div>
                <div className="admin-table-container">
                    {adminUsersLoading ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>Loading users...</div>
                    ) : filteredUsers.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                            {adminUsers.length === 0 ? 'No users found.' : 'No users match your search.'}
                        </div>
                    ) : (
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Email</th>
                                    <th>Role</th>
                                    <th>Plan</th>
                                    <th>Status</th>
                                    <th>Credits</th>
                                    <th>Expires</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pager.pageItems.map((u) => {
                                    const status = u.status || 'active';
                                    const suspended = status === 'suspended';
                                    const busy = busyUserId === u.id;
                                    const resetDays = Number(u.resetDays) || 0;
                                    const expired = resetDays <= 0;
                                    let expiryDate = '';
                                    if (u.resetAt) {
                                        try {
                                            expiryDate = new Date(u.resetAt).toLocaleDateString(undefined, {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric',
                                            });
                                        } catch {
                                            expiryDate = '';
                                        }
                                    }
                                    return (
                                        <tr key={u.id} className={suspended ? 'admin-user-row-suspended' : ''}>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: u.role === 'admin' ? '#6366f1' : '#06b6d4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: '#fff', flexShrink: 0 }}>{u.initials}</div>
                                                    <strong>{u.name}</strong>
                                                </div>
                                            </td>
                                            <td style={{ fontSize: '12px' }}>{u.email}</td>
                                            <td><span className={`model-tag ${u.role === 'admin' ? 'admin' : ''}`}>{u.role}</span></td>
                                            <td><span className="model-tag">{u.plan}</span></td>
                                            <td>
                                                <span className={`admin-status-pill ${suspended ? 'suspended' : 'active'}`}>
                                                    {suspended ? 'Blocked' : 'Active'}
                                                </span>
                                            </td>
                                            <td style={{ fontSize: '12px' }}>{u.creditsUsed?.toLocaleString()} / {u.creditsLimit?.toLocaleString()}</td>
                                            <td style={{ fontSize: '12px' }}>
                                                <span className={`admin-status-pill ${expired ? 'suspended' : 'active'}`}>
                                                    {expired ? 'Expired' : `${resetDays}d left`}
                                                </span>
                                                {expiryDate ? (
                                                    <div style={{ marginTop: 4, opacity: 0.7, fontSize: 11 }}>{expiryDate}</div>
                                                ) : null}
                                            </td>
                                            <td>
                                                <div className="admin-user-actions">
                                                    <button type="button" className="admin-action-btn edit" disabled={busy} onClick={() => openEdit(u)}>Edit</button>
                                                    <button
                                                        type="button"
                                                        className="admin-action-btn extend"
                                                        disabled={busy}
                                                        onClick={() => handleExtendExpiry(u)}
                                                        title="Extend credit expiry by 30 days"
                                                    >
                                                        Extend
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`admin-action-btn ${suspended ? 'unblock' : 'block'}`}
                                                        disabled={busy || (!suspended && !canBlockUser(u))}
                                                        onClick={() => handleToggleBlock(u)}
                                                        title={!suspended && !canBlockUser(u) ? 'Cannot block this account' : undefined}
                                                    >
                                                        {suspended ? 'Unblock' : 'Block'}
                                                    </button>
                                                    <button type="button" className="admin-action-btn delete" disabled={busy || u.role === 'admin'} onClick={() => handleDeleteUser(u.id, u.name)}>Delete</button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    {!adminUsersLoading && filteredUsers.length > 0 && (
                        <AdminPagination
                            page={pager.page}
                            totalPages={pager.totalPages}
                            total={pager.total}
                            rangeStart={pager.rangeStart}
                            rangeEnd={pager.rangeEnd}
                            onPageChange={pager.setPage}
                            label="users"
                        />
                    )}
                </div>
            </div>

            {showCreateUserModal && (
                <div className="admin-modal-backdrop" onClick={() => setShowCreateUserModal(false)}>
                    <div className="admin-card glassmorphism-card admin-modal-card" onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ marginBottom: '16px' }}>Create New User</h3>
                        {renderUserFormFields(createUserForm, setCreateUserForm, { passwordRequired: true })}
                        <div className="admin-field" style={{ marginBottom: '16px' }}>
                            <label>Free Generations (display only)</label>
                            <input
                                className="admin-input"
                                type="number"
                                value={createUserForm.freeGenerations}
                                onChange={(e) => setCreateUserForm((prev) => ({ ...prev, freeGenerations: e.target.value }))}
                                style={{ width: '100%', padding: '8px 12px', fontSize: '13px' }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" className="admin-action-btn" onClick={() => setShowCreateUserModal(false)}>Cancel</button>
                            <button type="button" className="admin-btn-primary" style={{ padding: '8px 20px', fontSize: '13px' }} onClick={handleCreateUser}>Create User</button>
                        </div>
                    </div>
                </div>
            )}

            {editingUser && (
                <div className="admin-modal-backdrop" onClick={() => setEditingUser(null)}>
                    <div className="admin-card glassmorphism-card admin-modal-card" onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ marginBottom: '16px' }}>Edit User — {editingUser.name}</h3>
                        {renderUserFormFields(editUserForm, setEditUserForm, { passwordRequired: false })}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" className="admin-action-btn" onClick={() => setEditingUser(null)}>Cancel</button>
                            <button type="button" className="admin-btn-primary" style={{ padding: '8px 20px', fontSize: '13px' }} disabled={busyUserId === editingUser.id} onClick={handleUpdateUser}>
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminUsers;
