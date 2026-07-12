import React from 'react';
import I from '../shared/StudioIcons';
import AdminPagination, { useClientPagination } from './AdminPagination';

const AdminProjects = ({
    renderBudgetBanner,
    adminProjectsLoading,
    adminProjects
}) => {
    const pager = useClientPagination(adminProjects, 20);

    return (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner && renderBudgetBanner()}
            <div className="admin-card glassmorphism-card">
                <div className="admin-card-header">
                    <I d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" s={20} />
                    <h3>All Projects</h3>
                </div>
                {adminProjectsLoading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading projects...</div>
                ) : adminProjects.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>No projects found</div>
                ) : (
                    <>
                        <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>Project</th>
                                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>Status</th>
                                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>Assigned To</th>
                                    <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>Updated</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pager.pageItems.map(p => (
                                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '10px 16px', fontSize: '13px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <img src={p.thumbnailUrl} alt="" style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} />
                                                <strong>{p.name}</strong>
                                            </div>
                                        </td>
                                        <td style={{ padding: '10px 16px' }}>
                                            <span style={{ fontSize: '11px', padding: '2px 10px', borderRadius: '10px', background: p.status === 'Completed' ? '#22c55e20' : p.status === 'In Progress' ? '#6366f120' : 'var(--bg-tertiary)', color: p.status === 'Completed' ? '#22c55e' : p.status === 'In Progress' ? '#6366f1' : 'var(--text-secondary)' }}>{p.status}</span>
                                        </td>
                                        <td style={{ padding: '10px 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>{p.userName || 'Unassigned'}</td>
                                        <td style={{ padding: '10px 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <AdminPagination
                            page={pager.page}
                            totalPages={pager.totalPages}
                            total={pager.total}
                            rangeStart={pager.rangeStart}
                            rangeEnd={pager.rangeEnd}
                            onPageChange={pager.setPage}
                            label="projects"
                        />
                    </>
                )}
            </div>
        </div>
    );
};

export default AdminProjects;
