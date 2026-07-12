import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { API } from '../shared/helpers';
import { resolveToolComponent } from '../../../router/toolRegistry';

const ReactSuspense = Suspense;

export default function AdminShell({ tool, setTool, currentToken, renderBudgetBanner, budgetData, currentUserId = null }) {
    const [adminUsers, setAdminUsers] = useState([]);
    const [adminUsersLoading, setAdminUsersLoading] = useState(false);
    const [adminSelectedUserId, setAdminSelectedUserId] = useState(null);
    const [replicateLogs, setReplicateLogs] = useState([]);
    const [loginEvents, setLoginEvents] = useState([]);
    const [adminAuditEvents, setAdminAuditEvents] = useState([]);
    const [replicateLogsLoading, setReplicateLogsLoading] = useState(false);
    const [adminBilling, setAdminBilling] = useState({
        summary: { totalUsers: 0, totalApiCalls: 0, totalCreditsSpent: 0, totalRechargeCredits: 0, totalOrders: 0, paidOrders: 0, paidAmount: 0, paidCredits: 0 },
        users: [], payments: [], transactions: [],
    });
    const [adminBillingLoading, setAdminBillingLoading] = useState(false);
    const [adminPricing, setAdminPricing] = useState([]);
    const [adminPricingLoading, setAdminPricingLoading] = useState(false);
    const [adminProjects, setAdminProjects] = useState([]);
    const [adminProjectsLoading, setAdminProjectsLoading] = useState(false);
    const [adminStats, setAdminStats] = useState({ totalUsers: 0, totalProjects: 0, recentLogs: [] });
    const [adminAnalytics, setAdminAnalytics] = useState(null);
    const [adminAnalyticsLoading, setAdminAnalyticsLoading] = useState(false);

    const fetchAdminUsers = useCallback(() => {
        setAdminUsersLoading(true);
        fetch(`${API}/api/admin/users`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
            .then(r => r.json())
            .then(d => {
                if (d.success && d.users) {
                    setAdminUsers(d.users);
                    if (!adminSelectedUserId && d.users.length > 0) {
                        setAdminSelectedUserId(d.users[0].id);
                    }
                }
            })
            .catch(err => console.error('Failed to fetch admin users:', err))
            .finally(() => setAdminUsersLoading(false));
    }, [adminSelectedUserId, currentToken]);

    const fetchAdminBilling = useCallback(() => {
        setAdminBillingLoading(true);
        fetch(`${API}/api/admin/billing-overview`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    setAdminBilling({
                        summary: d.summary || { totalUsers: 0, totalApiCalls: 0, totalCreditsSpent: 0, totalRechargeCredits: 0, totalOrders: 0, paidOrders: 0, paidAmount: 0, paidCredits: 0 },
                        users: d.users || [],
                        payments: d.payments || [],
                        transactions: d.transactions || [],
                    });
                    if (!adminSelectedUserId && d.users?.length > 0) setAdminSelectedUserId(d.users[0].id);
                }
            })
            .catch(err => console.error('Failed to fetch admin billing:', err))
            .finally(() => setAdminBillingLoading(false));
    }, [adminSelectedUserId, currentToken]);

    const fetchAdminPricing = useCallback(() => {
        setAdminPricingLoading(true);
        fetch(`${API}/api/admin/credit-pricing`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
            .then(r => r.json())
            .then(d => {
                if (d.success && d.pricing) setAdminPricing(d.pricing);
            })
            .catch(err => console.error('Failed to fetch credit pricing:', err))
            .finally(() => setAdminPricingLoading(false));
    }, [currentToken]);

    const fetchAdminAnalytics = useCallback(() => {
        setAdminAnalyticsLoading(true);
        fetch(`${API}/api/admin/analytics?days=30`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
            .then(r => r.json())
            .then(d => {
                if (d.success) setAdminAnalytics(d);
            })
            .catch(err => console.error('Failed to fetch admin analytics:', err))
            .finally(() => setAdminAnalyticsLoading(false));
    }, [currentToken]);

    useEffect(() => {
        if (tool === 'admin-users' || tool === 'admin-credits') fetchAdminUsers();
    }, [tool, fetchAdminUsers]);

    useEffect(() => {
        if (tool === 'admin-credits' || tool === 'admin-dashboard') fetchAdminBilling();
    }, [tool, fetchAdminBilling]);

    useEffect(() => {
        if (tool === 'admin-dashboard') {
            fetchAdminAnalytics();
            Promise.all([
                fetch(`${API}/api/admin/users`, { headers: { 'Authorization': `Bearer ${currentToken}` } }).then(r => r.json()),
                fetch(`${API}/api/admin/projects`, { headers: { 'Authorization': `Bearer ${currentToken}` } }).then(r => r.json()),
                fetch(`${API}/api/admin/logs`, { headers: { 'Authorization': `Bearer ${currentToken}` } }).then(r => r.json()),
            ]).then(([usersData, projectsData, logsData]) => {
                setAdminStats({
                    totalUsers: usersData.success ? usersData.users.length : 0,
                    totalProjects: projectsData.success ? projectsData.projects.length : 0,
                    recentLogs: logsData.success ? logsData.replicateLogs.slice(0, 8) : [],
                });
                if (usersData.success) setAdminUsers(usersData.users);
            }).catch(() => { });
        }
    }, [tool, currentToken, fetchAdminAnalytics]);

    useEffect(() => {
        if (tool === 'admin-projects') {
            setAdminProjectsLoading(true);
            fetch(`${API}/api/admin/projects`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
                .then(r => r.json())
                .then(d => { if (d.success) setAdminProjects(d.projects); })
                .catch(() => { })
                .finally(() => setAdminProjectsLoading(false));
        }
    }, [tool, currentToken]);

    useEffect(() => {
        if (tool === 'admin-credits') fetchAdminPricing();
    }, [tool, fetchAdminPricing]);

    useEffect(() => {
        if (tool === 'admin-logs') {
            setReplicateLogsLoading(true);
            fetch(`${API}/api/admin/logs`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
                .then(r => r.json())
                .then(d => {
                    if (d.success && d.replicateLogs) {
                        setReplicateLogs(d.replicateLogs);
                        setLoginEvents(d.loginEvents || []);
                        setAdminAuditEvents(d.adminAuditEvents || []);
                    }
                })
                .catch(err => console.error('Failed to fetch admin logs:', err))
                .finally(() => setReplicateLogsLoading(false));
        }
    }, [tool, currentToken]);

    const adminProps = {
        'admin-dashboard': {
            adminStats,
            budgetData,
            adminUsers,
            adminBilling,
            adminAnalytics,
            adminAnalyticsLoading,
            setTool,
            renderBudgetBanner,
        },
        'admin-users': {
            renderBudgetBanner,
            adminUsersLoading,
            adminUsers,
            currentToken,
            fetchAdminUsers,
            currentUserId,
        },
        'admin-projects': { renderBudgetBanner, adminProjectsLoading, adminProjects },
        'admin-logs': { renderBudgetBanner, replicateLogsLoading, replicateLogs, loginEvents, adminAuditEvents },
        'admin-credits': {
            renderBudgetBanner,
            adminUsers,
            adminSelectedUserId,
            setAdminSelectedUserId,
            adminUsersLoading,
            currentToken,
            fetchAdminUsers,
            adminPricing,
            adminPricingLoading,
            fetchAdminPricing,
            adminBilling,
            adminBillingLoading,
        },
    }[tool];

    const LazyTool = resolveToolComponent(tool);
    if (!LazyTool || !adminProps) return null;

    return (
        <ReactSuspense fallback={<div className="tool-loading">Loading…</div>}>
            <LazyTool {...adminProps} />
        </ReactSuspense>
    );
}
