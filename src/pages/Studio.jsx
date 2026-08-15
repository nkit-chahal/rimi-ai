import React, { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense as ReactSuspense } from 'react';

import ToolComingSoon from '../components/studio/shared/ToolComingSoon';
import { COMING_SOON_TOOLS } from '../components/studio/shared/comingSoonTools';
import { resolveToolComponent } from '../router/toolRegistry';
import OnboardingBanner from '../components/OnboardingBanner';
import { CreditsProvider } from '../contexts/CreditsContext';
import { ProjectProvider } from '../contexts/ProjectContext';
import { t } from '../i18n/en-IN';
import { trackEvent } from '../observability';
import '../styles/studio-shell.css';

// Shared icons & helpers
import { I } from '../components/studio/shared/StudioIcons';
import { API, apiFetch, consumeStudioPrefetch, forceDownload, cacheFileAccessToken, mediaUrl } from '../components/studio/shared/helpers';
import ImageDropzone from '../components/studio/shared/ImageDropzone';
import { isImageFile } from '../components/studio/shared/imageUpload';
import { getModelTiming, resolveModelId, timedProgressPct } from '../components/studio/shared/modelTimings';
import BgTaskManager from '../components/studio/BgTaskManager';
import { useResultUrls } from '../stores/resultUrls';

const StudioCommandPalette = lazy(() => import('../components/studio/shared/StudioCommandPalette'));
const StudioBootSplash = lazy(() => import('../components/StudioBootSplash'));

const AdminShell = lazy(() => import('../components/studio/admin/AdminShell'));
const BillingPanel = lazy(() => import('../components/studio/billing/BillingPanel'));

const navLabel = (id) => t(`nav.${id}`) || id;

/** Tools that render their own upload/preview UI — hide the global compact dropzone. */
const COMPACT_UPLOAD_EXCLUDED_TOOLS = new Set([
    'dashboard', 'exports', 'billing', 'workspace',
    'pattern', 'inspire', 'seamless', 'mappings', 'vectorize', 'upscale', 'removebg', 'imagelayers',
    'colorways', 'colorway-manager', 'vectorpro', 'repeat',
]);

const NAV = [
    { section: '', items: [{ id: 'dashboard', label: 'Pipeline Studio', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' }] },
    {
        section: 'AI DESIGN TOOLS',
        items: [
            { id: 'pattern', label: 'Pattern Extraction', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z' },
            { id: 'seamless', label: 'Make Seamless', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z' },
            { id: 'repeat', label: 'Repeat Set', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
            { id: 'mappings', label: 'Mappings', icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z' },
            { id: 'inspire', label: 'Inspirations', icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.7 1.7-1.7h2c3.1 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z' },
            { id: 'vectorize', label: 'Vectorize', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z' },
            { id: 'upscale', label: 'Super Resolution', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
            { id: 'removebg', label: 'Remove Background', icon: 'M3 7h18M3 12h18M8 7v10M16 7v10M5 7V5a2 2 0 012-2h10a2 2 0 012 2v2' },
            { id: 'imagelayers', label: 'Qwen Studio', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', requiresPro: true },
            { id: 'colorways', label: 'Colorways', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z' },
            { id: 'colorway-manager', label: 'Colorway Manager', icon: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83' },
            { id: 'vectorpro', label: 'Vector Pro', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485' },
            { id: 'mockup3d', label: '3D Mockup', icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.3 7l8.7 5 8.7-5M12 22V12', requiresPro: true },
        ],
    },
    {
        section: 'ASSETS & LIBRARY',
        items: [
            { id: 'library', label: 'Brand Library', icon: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z', comingSoon: true },
            { id: 'measurement', label: 'Measurement', icon: 'M2 2h6v6H2zM16 2h6v6h-6zM2 16h6v6H2zM16 16h6v6h-6zM8 5h8M8 19h8M5 8v8M19 8v8', comingSoon: true },
            { id: 'exports', label: 'Exports', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3' },
            { id: 'billing', label: 'Billing', icon: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 6v12M8 10h6a2 2 0 010 4h-4a2 2 0 000 4h6' },
        ],
    },
];

const ADMIN_NAV = [
    {
        section: 'SUPERVISOR PANEL',
        items: [
            { id: 'admin-dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1' },
            { id: 'admin-users', label: 'User Management', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
            { id: 'admin-projects', label: 'Projects', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
            { id: 'admin-logs', label: 'Activity Logs', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
            { id: 'admin-credits', label: 'Credits & Billing', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
        ],
    },
];

const emptyState = {
    user: { name: '', initials: '', plan: '', creditsUsed: 0, creditsLimit: 1, resetDays: 0 },
    activeProject: { id: 1, name: 'Loading...', heroImageUrl: '/demo_floral.png' },
    projects: [],
    variations: [],
    metrics: { versions: 0, versionsDelta: 0, exports: 0, exportsDelta: 0, aiGenerations: 0, aiGenerationsDelta: 0, creditsUsed: 0, creditsDelta: 0 },
    health: { score: 0, label: '', tileSeamless: false, colorBalance: false, printReadiness: false, resolution: false, note: '' },
    controls: { gridSize: 2, scale: 100, rotation: 0, repeatType: 'block', colorCleanup: true, edgeMatch: true, backgroundClean: false, exportFormat: 'PNG', exportDpi: 300, hBrush: 8, vBrush: 8, printWidth: 12, printHeight: 12, fabricWidth: 54 },
    suggestion: '',
};

const BOOT_SPLASH_MIN_MS = 400;

export default function Studio({ onBack, currentUser, currentToken, onLogout, isBootEntry = false, onBootComplete }) {
    const adminTools = ['admin-dashboard', 'admin-users', 'admin-projects', 'admin-logs', 'admin-credits'];
    const userTools = ['dashboard', 'pattern', 'seamless', 'repeat', 'mappings', 'inspire', 'vectorize', 'upscale', 'removebg', 'imagelayers', 'colorways', 'colorway-manager', 'vectorpro', 'mockup3d', 'library', 'measurement', 'exports', 'billing', 'workspace'];
    const isAdmin = currentUser?.role === 'admin';

    useEffect(() => {
        if (isAdmin) import('../styles/admin.css');
    }, [isAdmin]);

    useEffect(() => {
        const robots = document.querySelector('meta[name="robots"]') || document.createElement('meta');
        robots.setAttribute('name', 'robots');
        const previous = robots.getAttribute('content');
        robots.setAttribute('content', 'noindex, nofollow');
        if (!robots.parentNode) document.head.appendChild(robots);
        return () => {
            if (previous) robots.setAttribute('content', previous);
            else robots.setAttribute('content', 'index, follow');
        };
    }, []);

    const readToolFromPath = useCallback(() => {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return parts[0] === 'studio' ? parts[1] : parts[0];
    }, []);

    const [tool, _setTool] = useState(() => {
        const fromPath = readToolFromPath();
        const allowed = isAdmin ? adminTools : userTools;
        if (allowed.includes(fromPath)) return fromPath;
        return isAdmin ? 'admin-dashboard' : 'pattern';
    });

    useEffect(() => {
        const allowed = isAdmin ? adminTools : userTools;
        const current = readToolFromPath();
        if (!allowed.includes(current)) {
            window.history.replaceState(null, '', `/studio/${tool}`);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps — sync once on mount

    const setTool = useCallback((t) => {
        const allowed = isAdmin ? adminTools : userTools;
        if (!allowed.includes(t)) t = isAdmin ? 'admin-dashboard' : 'pattern';
        _setTool(t);
        window.history.replaceState(null, '', `/studio/${t}`);
    }, [isAdmin]);

    useEffect(() => {
        const onPopState = () => {
            const fromPath = readToolFromPath();
            const allowed = isAdmin ? adminTools : userTools;
            if (allowed.includes(fromPath)) _setTool(fromPath);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [isAdmin, readToolFromPath]);

    const [state, setState] = useState(emptyState);
    const [activeProjectId, setActiveProjectId] = useState(1);
    const [showProjectDropdown, setShowProjectDropdown] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [workspaceProjectName, setWorkspaceProjectName] = useState('');
    const [editingProjectId, setEditingProjectId] = useState(null);
    const [editingProjectName, setEditingProjectName] = useState('');
    const [workspaceBusyId, setWorkspaceBusyId] = useState(null);
    const projectDropdownRef = useRef(null);
    const [uploads, setUploads] = useState({});
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [isLoadingState, setIsLoadingState] = useState(true);
    const [showBootSplash, setShowBootSplash] = useState(() => Boolean(isBootEntry));
    const bootStartedAtRef = useRef(Date.now());
    const bootCompletedRef = useRef(false);

    const hasLoadedControls = useRef(false);
    const lastSyncedControlsRef = useRef(null);
    const workspaceLoadIdRef = useRef(0);

    const [bgTasks, setBgTasks] = useState([]);
    const [showBgTasksDropdown, setShowBgTasksDropdown] = useState(false);

    // Prune completed/failed bg tasks older than 5 minutes (Phase 4a)
    useEffect(() => {
        const interval = setInterval(() => {
            setBgTasks(prev => {
                const now = Date.now();
                const pruned = prev.filter(t => t.status === 'running' || (t._ts && now - t._ts < 300000));
                return pruned.length !== prev.length ? pruned : prev;
            });
        }, 60000);
        return () => clearInterval(interval);
    }, []);

    const [isSidebarHidden, setIsSidebarHidden] = useState(false);
    const [showAccountDropdown, setShowAccountDropdown] = useState(false);
    const accountDropdownRef = useRef(null);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const [mobileNavOpen, setMobileNavOpen] = useState(false);

    const showNotice = useCallback((message) => {
        setNotice(message);
        window.setTimeout(() => setNotice(''), 4000);
    }, []);

    // Result URLs moved to zustand store (Phase 4b) — components subscribe only to what they need
    const resultUrls = useResultUrls();
    const enhUrl = resultUrls.enh;
    const seamlessUrl = resultUrls.seamless;
    const vecUrl = resultUrls.vec;
    const upscaleUrl = resultUrls.upscale;
    const removeBgUrl = resultUrls.removeBg;
    const cwUrl = resultUrls.cw;
    const repeatUrl = resultUrls.repeat;
    const setEnhUrl = useCallback((v) => resultUrls.setRaw('enh', v), [resultUrls]);
    const setSeamlessUrl = useCallback((v) => resultUrls.setRaw('seamless', v), [resultUrls]);
    const setVecUrl = useCallback((v) => resultUrls.setRaw('vec', v), [resultUrls]);
    const setUpscaleUrl = useCallback((v) => resultUrls.setRaw('upscale', v), [resultUrls]);
    const setRemoveBgUrl = useCallback((v) => resultUrls.setRaw('removeBg', v), [resultUrls]);
    const setCwUrl = useCallback((v) => resultUrls.setRaw('cw', v), [resultUrls]);
    const setRepeatUrl = useCallback((v) => resultUrls.setRaw('repeat', v), [resultUrls]);
    const qwenLaunch = resultUrls.qwenLaunch;
    const clearQwenLaunch = useCallback(() => resultUrls.clearQwenLaunch(), [resultUrls]);
    const setQwenLaunch = useCallback((v) => resultUrls.setQwenLaunch(v), [resultUrls]);
    const [isRepeat, setIsRepeat] = useState(false);
    const [rightPanelEl, setRightPanelEl] = useState(null);

    const addBgTask = (type, label, filename, triggerFn, options = {}) => {
        const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const modelId = resolveModelId(options.modelId, options.toolType || type);
        const timing = getModelTiming(modelId);
        const expectedMs = Math.max(
            800,
            (options.expectedMs ?? timing.expectedMs) * Math.max(1, options.multiplier || 1),
        );
        const newTask = {
            id: taskId,
            type,
            label,
            status: 'running',
            progress: 1,
            stage: timing.label || 'Processing…',
            modelId,
            expectedMs,
            filename: filename || 'design_input.png',
            resultUrl: null,
            resultUrls: null,
            error: null,
            createdAt: new Date().toLocaleTimeString(),
            _startedAt: Date.now(),
        };

        setBgTasks(prev => [newTask, ...prev].slice(0, 20));

        let serverProgress = 0;
        const reportProgress = (progressPct, stage) => {
            if (typeof progressPct === 'number') {
                serverProgress = Math.min(99, progressPct);
            }
            setBgTasks(prev => prev.map(t => t.id === taskId ? {
                ...t,
                progress: Math.min(99, Math.max(t.progress, serverProgress)),
                stage: stage ?? t.stage,
            } : t));
        };

        const tickId = window.setInterval(() => {
            setBgTasks(prev => prev.map(t => {
                if (t.id !== taskId || t.status !== 'running') return t;
                const elapsed = Date.now() - (t._startedAt || Date.now());
                const timed = timedProgressPct(elapsed, t.expectedMs || expectedMs);
                return {
                    ...t,
                    progress: Math.min(99, Math.max(timed, serverProgress, t.progress || 0)),
                };
            }));
        }, 120);

        triggerFn(reportProgress)
            .then((result) => {
                window.clearInterval(tickId);
                trackEvent('generation_complete', { tool: type, label, filename });
                setBgTasks(prev => prev.map(t => t.id === taskId ? {
                    ...t,
                    status: 'completed',
                    progress: 100,
                    resultUrl: result.url,
                    resultUrls: result.urls || null,
                    sessionId: result.sessionId || null,
                    fileAccessToken: result.fileAccessToken || null,
                    _ts: Date.now(),
                } : t).slice(0, 20));
            })
            .catch((err) => {
                window.clearInterval(tickId);
                setBgTasks(prev => prev.map(t => t.id === taskId ? {
                    ...t,
                    status: 'failed',
                    progress: 0,
                    error: err.message || 'Generation failed',
                    _ts: Date.now(),
                } : t).slice(0, 20));
            });
    };

    const stateUserMatchesCurrent = currentUser?.id && state.user?.id === currentUser.id;
    const user = currentUser
        ? {
            ...currentUser,
            creditsUsed: stateUserMatchesCurrent ? (state.user.creditsUsed ?? currentUser.creditsUsed) : currentUser.creditsUsed,
            creditsLimit: stateUserMatchesCurrent ? (state.user.creditsLimit ?? currentUser.creditsLimit) : currentUser.creditsLimit,
            resetDays: stateUserMatchesCurrent ? (state.user.resetDays ?? currentUser.resetDays) : currentUser.resetDays,
            plan: stateUserMatchesCurrent ? (state.user.plan ?? currentUser.plan) : currentUser.plan,
            isPro: stateUserMatchesCurrent ? (state.user.isPro ?? currentUser.isPro) : currentUser.isPro,
            tier: stateUserMatchesCurrent ? (state.user.tier ?? currentUser.tier) : currentUser.tier,
        }
        : state.user;

    const activeProject = state.activeProject;
    const userRemainingCredits = Math.max(0, (user.creditsLimit || 0) - (user.creditsUsed || 0));
    const hasLoadedUserCredits = !isLoadingState;
    const remainingCreditPercent = user.creditsLimit > 0
        ? Math.min(100, Math.round((userRemainingCredits / user.creditsLimit) * 100))
        : 0;

    const [creditPricing, setCreditPricing] = useState({});

    const repeatCreditCost = creditPricing.repeat || 5;
    const hasEnoughRepeatCredits = userRemainingCredits >= repeatCreditCost;

    const fetchCreditPricing = useCallback(() => {
        fetch(`${API}/api/credit-pricing`)
            .then(r => r.json())
            .then(d => { if (d.success && d.pricing) setCreditPricing(d.pricing); })
            .catch(() => { });
    }, []);

    useEffect(() => {
        fetchCreditPricing();
    }, [fetchCreditPricing]);

    const updateCreditsFromResponse = (responseData) => {
        if (responseData && (responseData.creditsUsed !== undefined || responseData.plan !== undefined || responseData.isPro !== undefined)) {
            setState(prev => ({
                ...prev,
                user: {
                    ...prev.user,
                    id: prev.user?.id ?? currentUser?.id,
                    creditsUsed: responseData.creditsUsed ?? prev.user?.creditsUsed ?? currentUser?.creditsUsed,
                    creditsLimit: responseData.creditsLimit ?? prev.user?.creditsLimit ?? currentUser?.creditsLimit,
                    ...(responseData.plan !== undefined ? { plan: responseData.plan } : {}),
                    ...(responseData.isPro !== undefined ? { isPro: responseData.isPro } : {}),
                    ...(responseData.tier !== undefined ? { tier: responseData.tier } : {}),
                }
            }));
        }
    };

    // Brand Palettes
    const [brandPalettes, setBrandPalettes] = useState([]);
    const [brandPalettesLoading, setBrandPalettesLoading] = useState(false);

    const fetchBrandPalettes = useCallback(() => {
        if (!activeProject?.id || !currentToken || isLoadingState) return;
        setBrandPalettesLoading(true);
        apiFetch(`/api/brand-palettes?projectId=${activeProject.id}`, {}, currentToken)
            .then((d) => {
                if (d.palettes) setBrandPalettes(d.palettes);
                setBrandPalettesLoading(false);
            })
            .catch(() => setBrandPalettesLoading(false));
    }, [activeProject?.id, currentToken, isLoadingState]);

    useEffect(() => {
        if (activeProject?.id && !isLoadingState) fetchBrandPalettes();
    }, [fetchBrandPalettes, activeProject?.id, isLoadingState]);

    // Admin state extracted to AdminShell.jsx (lazy-loaded only when an admin tool is active)
    // Billing state extracted to BillingPanel.jsx (lazy-loaded only when billing tool is active)

    const [budgetData, setBudgetData] = useState({ budget: 8.61, totalSpent: 0, remaining: 8.61 });
    const [budgetEditing, setBudgetEditing] = useState(false);
    const [budgetInput, setBudgetInput] = useState('');

    useEffect(() => {
        if (isAdmin && tool.startsWith('admin')) {
            fetch(`${API}/api/admin/budget`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
                .then(r => r.json())
                .then(d => {
                    if (d.success) setBudgetData({ budget: d.budget, totalSpent: d.totalSpent, remaining: d.remaining });
                })
                .catch(() => { });
        }
    }, [tool, currentToken, isAdmin]);

    const handleBudgetUpdate = () => {
        const val = parseFloat(budgetInput);
        if (isNaN(val) || val < 0) return;
        fetch(`${API}/api/admin/budget`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
            body: JSON.stringify({ budget: val }),
        })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    setBudgetData(prev => ({ ...prev, budget: d.budget, remaining: d.budget - prev.totalSpent }));
                    setBudgetEditing(false);
                }
            });
    };

    const uploaded = useMemo(() => uploads[tool]?.file || null, [uploads, tool]);
    const preview = useMemo(() => uploads[tool]?.url || null, [uploads, tool]);
    const uploadStatus = useMemo(() => uploads[tool]?.status || null, [uploads, tool]);
    const isUploading = uploadStatus === 'uploading';
    const controls = state.controls;

    // Dropdown listeners
    useEffect(() => {
        const handler = (e) => {
            if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target)) {
                setShowProjectDropdown(false);
            }
        };
        if (showProjectDropdown) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showProjectDropdown]);

    useEffect(() => {
        const handler = (e) => {
            if (accountDropdownRef.current && !accountDropdownRef.current.contains(e.target)) {
                setShowAccountDropdown(false);
            }
        };
        if (showAccountDropdown) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showAccountDropdown]);

    const applyStudioState = useCallback((studioState) => {
        hasLoadedControls.current = false;
        lastSyncedControlsRef.current = JSON.stringify(studioState.controls || {});
        (studioState.variations || []).forEach((v) => {
            if (v.fileAccessToken && v.imageUrl) {
                cacheFileAccessToken(v.imageUrl, v.fileAccessToken);
            }
        });
        setState(studioState);
        setActiveProjectId(studioState.activeProject.id);
        window.setTimeout(() => { hasLoadedControls.current = true; }, 0);
    }, []);

    const workspaceHydrated = state.activeProject?.name && state.activeProject.name !== 'Loading...';

    const loadStudioState = useCallback(async (projectId = activeProjectId, { silent = false } = {}) => {
        if (!currentToken) return;
        if (!silent) setError('');
        try {
            const d = await apiFetch(`/api/studio-state?projectId=${projectId}`, {}, currentToken);
            if (!d.success) throw new Error(d.error || 'Failed to load studio state');
            applyStudioState(d.state);
        } catch (err) {
            if (err.status !== 401) {
                if (!silent) setError(err.message || 'Failed to load workspace.');
            }
            console.warn('Studio state load failed:', err.message);
        } finally {
            if (!silent) setIsLoadingState(false);
        }
    }, [activeProjectId, applyStudioState, currentToken]);

    useEffect(() => {
        if (isAdmin) {
            setIsLoadingState(false);
            setShowBootSplash(false);
            return;
        }
        if (!currentToken) {
            setIsLoadingState(false);
            setShowBootSplash(false);
            return;
        }

        const loadId = ++workspaceLoadIdRef.current;
        const loadInitialWorkspace = async () => {
            setIsLoadingState(true);
            setError('');

            const prefetched = consumeStudioPrefetch();
            const prefetchedProjectId = prefetched?.state?.activeProject?.id;
            if (prefetched?.state) {
                applyStudioState(prefetched.state);
            }

            const loadingTimeout = window.setTimeout(() => {
                if (loadId === workspaceLoadIdRef.current) {
                    setIsLoadingState(false);
                }
            }, 12000);

            try {
                const projectQuery = prefetchedProjectId || activeProjectId || 1;
                const stateRes = await apiFetch(`/api/studio-state?projectId=${projectQuery}`, {}, currentToken);
                if (loadId !== workspaceLoadIdRef.current) return;

                if (stateRes?.success && stateRes.state) {
                    applyStudioState(stateRes.state);
                } else if (!prefetched?.state) {
                    throw new Error(stateRes?.error || 'Failed to load studio state');
                }

                fetch(`${API}/api/credit-pricing`)
                    .then((r) => r.json())
                    .then((pricingRes) => {
                        if (pricingRes?.success && pricingRes.pricing) {
                            setCreditPricing(pricingRes.pricing);
                        }
                    })
                    .catch(() => {});
            } catch (err) {
                if (loadId === workspaceLoadIdRef.current && err.status !== 401 && !prefetched?.state) {
                    setError(err.message || 'Failed to load workspace.');
                }
                console.warn('Initial studio load failed:', err.message);
            } finally {
                window.clearTimeout(loadingTimeout);
                if (loadId === workspaceLoadIdRef.current) {
                    setIsLoadingState(false);
                }
            }
        };

        loadInitialWorkspace();
        return () => { workspaceLoadIdRef.current += 1; };
    }, [applyStudioState, currentToken, isAdmin]);

    // Refresh credits/plan from server when the tab becomes visible again so admin
    // extend / limit edits appear without a hard reload.
    useEffect(() => {
        if (isAdmin || !currentToken) return undefined;

        const refreshOnFocus = () => {
            if (document.visibilityState && document.visibilityState !== 'visible') return;
            loadStudioState(activeProjectId, { silent: true });
        };

        window.addEventListener('focus', refreshOnFocus);
        document.addEventListener('visibilitychange', refreshOnFocus);
        return () => {
            window.removeEventListener('focus', refreshOnFocus);
            document.removeEventListener('visibilitychange', refreshOnFocus);
        };
    }, [activeProjectId, currentToken, isAdmin, loadStudioState]);

    const workspaceReady = workspaceHydrated && !isLoadingState;

    useEffect(() => {
        if (!showBootSplash || !workspaceReady) return undefined;

        const elapsed = Date.now() - bootStartedAtRef.current;
        const remaining = Math.max(0, BOOT_SPLASH_MIN_MS - elapsed);
        const timer = window.setTimeout(() => setShowBootSplash(false), remaining);
        return () => window.clearTimeout(timer);
    }, [showBootSplash, workspaceReady]);

    useEffect(() => {
        if (!showBootSplash) return undefined;
        const maxTimer = window.setTimeout(() => setShowBootSplash(false), 15000);
        return () => window.clearTimeout(maxTimer);
    }, [showBootSplash]);

    useEffect(() => {
        const onKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setPaletteOpen(true);
                setPaletteQuery('');
            }
            if (e.key === 'Escape') {
                setPaletteOpen(false);
                setMobileNavOpen(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const comingSoonToolIds = useMemo(() => {
        const ids = new Set();
        NAV.forEach((section) => {
            section.items.forEach((it) => {
                if (it.comingSoon) ids.add(it.id);
            });
        });
        return ids;
    }, []);

    const commandPaletteItems = useMemo(() => {
        const sections = isAdmin ? ADMIN_NAV : NAV;
        const items = sections.flatMap((section) =>
            section.items.map((it) => ({
                id: it.id,
                label: navLabel(it.id),
                icon: it.icon,
                section: section.section || 'Studio',
                comingSoon: Boolean(it.comingSoon),
            }))
        );
        if (!isAdmin) {
            items.push({
                id: 'workspace',
                label: navLabel('workspace'),
                icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
                section: 'Account',
            });
        }
        return items;
    }, [isAdmin]);

    const createWorkspaceProject = async (name) => {
        const trimmed = (name || '').trim();
        if (!trimmed) return;
        setWorkspaceBusyId('create');
        setError('');
        try {
            const d = await apiFetch('/api/projects', {
                method: 'POST',
                body: JSON.stringify({ name: trimmed }),
            }, currentToken);
            if (!d.success || !d.projectId) throw new Error(d.error || 'Unable to create project');
            setWorkspaceProjectName('');
            showNotice('Project created.');
            await loadStudioState(d.projectId);
        } catch (err) {
            if (err.status !== 401) setError(err.message || 'Project creation failed.');
        } finally {
            setWorkspaceBusyId(null);
        }
    };

    const renameWorkspaceProject = async (projectId, name) => {
        const trimmed = (name || '').trim();
        if (!trimmed) return;
        setWorkspaceBusyId(projectId);
        setError('');
        try {
            const d = await apiFetch(`/api/projects/${projectId}`, {
                method: 'PUT',
                body: JSON.stringify({ name: trimmed }),
            }, currentToken);
            if (!d.success) throw new Error(d.error || 'Unable to rename project');
            setEditingProjectId(null);
            setEditingProjectName('');
            showNotice('Project renamed.');
            await loadStudioState(projectId);
        } catch (err) {
            if (err.status !== 401) setError(err.message || 'Project rename failed.');
        } finally {
            setWorkspaceBusyId(null);
        }
    };

    const deleteWorkspaceProject = async (projectId) => {
        const project = state.projects.find((p) => p.id === projectId);
        if (state.projects.length <= 1) {
            setError('Create another project before deleting your last workspace project.');
            return;
        }
        if (!window.confirm(`Delete "${project?.name || 'this project'}" and its history? This cannot be undone.`)) return;
        setWorkspaceBusyId(projectId);
        setError('');
        try {
            const d = await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' }, currentToken);
            if (!d.success) throw new Error(d.error || 'Unable to delete project');
            const fallback = state.projects.find((p) => p.id !== projectId);
            showNotice('Project deleted.');
            await loadStudioState(fallback?.id || activeProjectId);
        } catch (err) {
            if (err.status !== 401) setError(err.message || 'Project deletion failed.');
        } finally {
            setWorkspaceBusyId(null);
        }
    };

    const updateControls = useCallback((patch) => {
        setState((current) => ({ ...current, controls: { ...current.controls, ...patch } }));
    }, []);

    useEffect(() => {
        if (!hasLoadedControls.current || isLoadingState || !activeProject?.id) return;
        const serialized = JSON.stringify(controls);
        if (lastSyncedControlsRef.current === serialized) return;

        const id = window.setTimeout(async () => {
            try {
                const d = await apiFetch(
                    `/api/projects/${activeProject.id}/controls`,
                    { method: 'PATCH', body: JSON.stringify(controls) },
                    currentToken,
                );
                if (d.success && d.state?.controls) {
                    const merged = { ...controls, ...d.state.controls };
                    lastSyncedControlsRef.current = JSON.stringify(merged);
                    setState((prev) => ({
                        ...prev,
                        controls: { ...prev.controls, ...d.state.controls },
                    }));
                }
            } catch {
                console.warn('Control sync failed.');
            }
        }, 500);
        return () => window.clearTimeout(id);
    }, [controls, activeProject?.id, currentToken, isLoadingState]);

    const handlePreUpload = (file) => {
        if (!file) return;
        if (!isImageFile(file)) {
            setError('Invalid file type. Supported: JPG, PNG, WEBP');
            return;
        }
        const url = URL.createObjectURL(file);
        setUploads(prev => ({ ...prev, [tool]: { file, url, status: 'uploading' } }));
        handleUpload(file);
    };

    const handleUpload = async (file) => {
        if (!file) return;
        setError('');
        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('projectId', activeProject.id);
            formData.append('userId', user.id);

            const r = await fetch(`${API}/api/upload`, {
                method: 'POST',
                headers: { ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}) },
                body: formData,
            });
            const d = await r.json();
            if (d.success) {
                if (d.fileAccessToken && d.filename) {
                    cacheFileAccessToken(d.filename, d.fileAccessToken);
                }
                setUploads(prev => ({
                    ...prev,
                    [tool]: {
                        file: {
                            ...file,
                            filename: d.filename,
                            originalName: file.name,
                        },
                        url: prev[tool]?.url,
                        status: 'ready',
                    },
                }));
                updateCreditsFromResponse(d);
                showNotice('Image uploaded');
            } else {
                setUploads(prev => ({
                    ...prev,
                    [tool]: prev[tool] ? { ...prev[tool], status: 'error' } : prev[tool],
                }));
                setError(d.error);
            }
        } catch {
            setUploads(prev => ({
                ...prev,
                [tool]: prev[tool] ? { ...prev[tool], status: 'error' } : prev[tool],
            }));
            setError('Backend upload failed.');
        }
    };

    // createRepeat handler moved to RepeatTool component
    // startRazorpayCheckout moved to BillingPanel.jsx

    const renderBudgetBanner = () => {
        if (!isAdmin) return null;
        return (
            <div className="admin-budget-banner" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '16px', padding: '16px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text)' }}>API Spend Protection Budget</h3>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>Prevent model runovers. Current limit: <strong>${budgetData.budget?.toFixed(2)}</strong>. Spent: <strong style={{ color: '#ef4444' }}>${budgetData.totalSpent?.toFixed(4)}</strong>.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {budgetEditing ? (
                        <>
                            <input
                                type="number"
                                step="0.01"
                                className="admin-input"
                                value={budgetInput}
                                onChange={e => setBudgetInput(e.target.value)}
                                style={{ width: '80px', padding: '6px 10px', fontSize: '13px' }}
                            />
                            <button className="admin-btn-primary" onClick={handleBudgetUpdate} style={{ padding: '6px 14px', fontSize: '13px' }}>Save</button>
                            <button className="st-btn" onClick={() => setBudgetEditing(false)} style={{ padding: '6px 12px', fontSize: '13px' }}>Cancel</button>
                        </>
                    ) : (
                        <button className="admin-btn-primary" onClick={() => { setBudgetInput(budgetData.budget.toString()); setBudgetEditing(true); }} style={{ padding: '6px 14px', fontSize: '13px' }}>Set Budget</button>
                    )}
                </div>
            </div>
        );
    };

    const renderWorkspaceManager = () => {
        const projects = state.projects || [];
        const thumbUrl = (url) => (url && url.startsWith('/') ? mediaUrl(url) : (url || '/demo_geometric.png'));

        return (
            <div className="st-workspace-manager">
                <div className="st-workspace-hero">
                    <div className="st-workspace-hero-copy">
                        <span className="st-workspace-kicker">Projects</span>
                        <h2>Workspace</h2>
                        <p>Create, rename, and switch between design projects. Each project keeps its own pipeline history, exports, and settings.</p>
                    </div>
                    <div className="st-workspace-hero-stats">
                        <div className="st-workspace-stat-pill">
                            <strong>{projects.length}</strong>
                            <span>Projects</span>
                        </div>
                        <div className="st-workspace-stat-pill accent">
                            <strong>{activeProject?.name || '—'}</strong>
                            <span>Active</span>
                        </div>
                    </div>
                </div>

                <section className="st-workspace-panel">
                    <div className="st-workspace-panel-head">
                        <div>
                            <h3>All projects</h3>
                            <p>Open a project to continue working, or create a new one for a fresh design.</p>
                        </div>
                        <form
                            className="st-workspace-create"
                            onSubmit={(e) => {
                                e.preventDefault();
                                createWorkspaceProject(workspaceProjectName);
                            }}
                        >
                            <input
                                type="text"
                                value={workspaceProjectName}
                                onChange={(e) => setWorkspaceProjectName(e.target.value)}
                                placeholder="New project name"
                            />
                            <button type="submit" disabled={!workspaceProjectName.trim() || workspaceBusyId === 'create'}>
                                {workspaceBusyId === 'create' ? 'Creating…' : 'Create'}
                            </button>
                        </form>
                    </div>
                    <div className="st-workspace-project-list">
                        {projects.length === 0 ? (
                            <div className="st-workspace-empty">
                                <I d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" s={28} />
                                <strong>No projects yet</strong>
                                <p>Create your first project to start designing.</p>
                            </div>
                        ) : (
                            projects.map((project) => {
                                const isActive = project.id === activeProject?.id;
                                const isEditing = editingProjectId === project.id;
                                const busy = workspaceBusyId === project.id;
                                return (
                                    <article key={project.id} className={`st-workspace-project ${isActive ? 'active' : ''}`}>
                                        <img src={thumbUrl(project.thumbnailUrl)} alt="" />
                                        <div className="st-workspace-project-main">
                                            {isEditing ? (
                                                <form
                                                    className="st-workspace-edit"
                                                    onSubmit={(e) => {
                                                        e.preventDefault();
                                                        renameWorkspaceProject(project.id, editingProjectName);
                                                    }}
                                                >
                                                    <input
                                                        type="text"
                                                        value={editingProjectName}
                                                        onChange={(e) => setEditingProjectName(e.target.value)}
                                                        autoFocus
                                                    />
                                                    <button type="submit" disabled={!editingProjectName.trim() || busy}>Save</button>
                                                    <button type="button" onClick={() => { setEditingProjectId(null); setEditingProjectName(''); }} disabled={busy}>Cancel</button>
                                                </form>
                                            ) : (
                                                <>
                                                    <div className="st-workspace-project-title">
                                                        <h3>{project.name}</h3>
                                                        {isActive && <span>Active</span>}
                                                    </div>
                                                    <p>{project.status || 'Draft'} · Updated {project.updatedLabel || 'recently'}</p>
                                                </>
                                            )}
                                        </div>
                                        {!isEditing && (
                                            <div className="st-workspace-project-actions">
                                                <button type="button" disabled={busy} onClick={() => loadStudioState(project.id)}>
                                                    {isActive ? 'Open' : 'Switch'}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => { setEditingProjectId(project.id); setEditingProjectName(project.name); }}
                                                >
                                                    Rename
                                                </button>
                                                <button
                                                    type="button"
                                                    className="danger"
                                                    disabled={busy || projects.length <= 1}
                                                    onClick={() => deleteWorkspaceProject(project.id)}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </article>
                                );
                            })
                        )}
                    </div>
                </section>
            </div>
        );
    };

    const renderCanvas = () => {
        // Shared props structure passed down to tool components
        const commonProps = {
            uploaded,
            preview,
            uploadStatus,
            isUploading,
            activeProject,
            user,
            controls,
            updateControls,
            setError,
            setNotice: showNotice,
            addBgTask,
            updateCreditsFromResponse,
            setUploads,
            tool,
            setTool,
            currentToken,
            state,
            setState,
            creditPricing,
            rightPanelEl,
            handleUpload,
            handlePreUpload,
            onUploadInvalid: setError,
            onUploadPaste: () => showNotice('Image pasted'),
            onExportComplete: (details) => trackEvent('export_complete', details),
            setEnhUrl,
            setSeamlessUrl,
            setRepeatUrl,
            setVecUrl,
            setUpscaleUrl,
            setRemoveBgUrl,
            setCwUrl,
            qwenLaunch,
            clearQwenLaunch,
            setQwenLaunch,
        };

        // Routing canvas rendering
        const LazyTool = resolveToolComponent(tool);
        if (LazyTool && tool.startsWith('admin-')) {
            return (
                <ReactSuspense fallback={<div className="tool-loading">Loading…</div>}>
                    <AdminShell
                        tool={tool}
                        setTool={setTool}
                        currentToken={currentToken}
                        renderBudgetBanner={renderBudgetBanner}
                        budgetData={budgetData}
                        currentUserId={currentUser?.id ?? null}
                    />
                </ReactSuspense>
            );
        }

        if (tool === 'workspace') return renderWorkspaceManager();
        if (tool === 'billing') {
            return (
                <ReactSuspense fallback={<div className="tool-loading">Loading…</div>}>
                    <BillingPanel
                        user={user}
                        userRemainingCredits={userRemainingCredits}
                        currentToken={currentToken}
                        updateCreditsFromResponse={updateCreditsFromResponse}
                        loadStudioState={loadStudioState}
                        activeProject={activeProject}
                    />
                </ReactSuspense>
            );
        }

        if (COMING_SOON_TOOLS[tool]) return <ToolComingSoon {...COMING_SOON_TOOLS[tool]} />;

        const toolExtras = {
            pattern: { enhUrl, setEnhUrl },
            seamless: { seamlessUrl, setSeamlessUrl },
            vectorize: { vecUrl, setVecUrl, upscaleUrl, setUpscaleUrl },
            upscale: { vecUrl, setVecUrl, upscaleUrl, setUpscaleUrl },
            removebg: { removeBgUrl, setRemoveBgUrl },
            colorways: { cwUrl, setCwUrl },
            vectorpro: { brandPalettes },
            repeat: { repeatUrl, setRepeatUrl, isRepeat, setIsRepeat },
            imagelayers: { setUploads },
        };
        const LazyUserTool = resolveToolComponent(tool);
        if (LazyUserTool) {
            return (
                <ReactSuspense fallback={<div className="tool-loading">Loading…</div>}>
                    <LazyUserTool {...commonProps} {...(toolExtras[tool] || {})} />
                </ReactSuspense>
            );
        }

        return null;
    };

    const toolLabel = useMemo(() => {
        if (tool === 'workspace') return navLabel('workspace');
        const items = [...NAV[0].items, ...NAV[1].items, ...NAV[2].items, ...ADMIN_NAV[0].items];
        return navLabel(items.find(it => it.id === tool)?.id || tool) || 'Studio';
    }, [tool]);

    const shouldShowPageHead = useMemo(() => (
        tool === 'exports'
        || tool === 'billing'
        || tool === 'workspace'
        || tool.startsWith('admin')
        || comingSoonToolIds.has(tool)
    ), [tool, comingSoonToolIds]);

    return (
        <ProjectProvider activeProject={activeProject} projects={state.projects} setActiveProjectId={setActiveProjectId}>
            <CreditsProvider creditPricing={creditPricing} refreshPricing={fetchCreditPricing}>
        <div className={`studio ${isSidebarHidden ? 'sidebar-hidden' : ''}`}>
            <ReactSuspense fallback={null}>
            <StudioBootSplash
                visible={showBootSplash}
                dataReady={workspaceReady}
                minDurationMs={BOOT_SPLASH_MIN_MS}
                onHidden={() => {
                    if (!bootCompletedRef.current) {
                        bootCompletedRef.current = true;
                        onBootComplete?.();
                    }
                }}
            />
            </ReactSuspense>
            {!isAdmin && (
                <OnboardingBanner
                    token={currentToken}
                    ready={workspaceHydrated && !isLoadingState}
                    onProjectCreated={(projectId) => {
                        setActiveProjectId(projectId);
                        loadStudioState(projectId);
                    }}
                />
            )}
            {/* Sidebar nav */}
            {!isSidebarHidden && (
                <aside className="st-sidebar">
                    <div className="st-sidebar-top">
                        <div className="st-sidebar-head">
                            <div className="st-logo" onClick={onBack} style={{ cursor: 'pointer' }}>
                                <span className="ln-logo-badge">RI</span> RIMI AI
                            </div>
                            <button
                                className="st-sidebar-toggle"
                                type="button"
                                aria-label="Hide sidebar"
                                title="Hide sidebar"
                                onClick={() => setIsSidebarHidden(true)}
                            >
                                <I d="M3 3h18v18H3zM9 3v18M15 9l-3 3 3 3" s={17} />
                            </button>
                        </div>

                        {user.role === 'admin' ? (
                            <>
                                {ADMIN_NAV.map((section, idx) => (
                                    <div key={idx}>
                                        {section.section && <div className="st-nav-section">{t('navSections.admin')}</div>}
                                        {section.items.map(it => (
                                            <button
                                                key={it.id}
                                                type="button"
                                                aria-current={tool === it.id ? 'page' : undefined}
                                                className={`st-nav-item ${tool === it.id ? 'active' : ''}${it.comingSoon ? ' coming-soon' : ''}`}
                                                onClick={() => { setTool(it.id); setError(''); }}
                                            >
                                                <I d={it.icon} s={18} />
                                                <span>{navLabel(it.id)}</span>
                                                {it.comingSoon && <span className="st-nav-soon-badge">Soon</span>}
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </>
                        ) : (
                            <>
                                {NAV.map((section, idx) => (
                                    <div key={idx}>
                                        {section.section && <div className="st-nav-section">{section.section === 'AI DESIGN TOOLS' ? t('navSections.aiTools') : section.section === 'ASSETS & LIBRARY' ? t('navSections.assets') : section.section}</div>}
                                        {section.items.map(it => (
                                            <button
                                                key={it.id}
                                                type="button"
                                                aria-current={tool === it.id ? 'page' : undefined}
                                                className={`st-nav-item ${tool === it.id ? 'active' : ''}${it.comingSoon ? ' coming-soon' : ''}`}
                                                onClick={() => { setTool(it.id); setError(''); }}
                                            >
                                                <I d={it.icon} s={18} />
                                                <span>{navLabel(it.id)}</span>
                                                {it.comingSoon && <span className="st-nav-soon-badge">Soon</span>}
                                                {it.requiresPro && !user?.isPro && <span className="st-nav-pro-badge">Pro</span>}
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>

                    <div className="st-sidebar-bottom">
                        {user.role === 'admin' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div className="st-credits-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1" s={14} />
                                    Replicate <span className="st-plan">Supervisor</span>
                                </div>
                                <div className="st-credits-text strong">${budgetData.totalSpent.toFixed(2)} <span>/ ${budgetData.budget.toFixed(2)}</span></div>
                                <div className="st-credits-bar">
                                    <div className="st-credits-fill" style={{ width: `${budgetData.budget > 0 ? Math.min(100, (budgetData.totalSpent / budgetData.budget) * 100) : 0}%` }} />
                                </div>
                                <div className="st-credits-text">${budgetData.remaining.toFixed(2)} remaining</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div className="st-credits-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1" s={14} />
                                    Credits Remaining
                                </div>
                                <div className="st-credits-text strong">
                                    {user.creditsLimit > 0 ? (
                                        <>{userRemainingCredits.toLocaleString()} <span>/ {user.creditsLimit.toLocaleString()}</span></>
                                    ) : user.creditsUsed > 0 ? (
                                        <span style={{ fontSize: '0.88rem' }}>No credits allocated</span>
                                    ) : (
                                        <>0 <span>/ 0</span></>
                                    )}
                                </div>
                                <div className="st-credits-bar">
                                    <div className="st-credits-fill" style={{ width: `${remainingCreditPercent}%` }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div className="st-credits-text" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <I d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" s={12} />
                                        {Number(user.creditsUsed || 0).toLocaleString()} used
                                    </div>
                                    {user.creditsLimit === 0 && user.creditsUsed > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setTool('billing')}
                                            style={{ border: 0, background: 'transparent', color: 'var(--primary-hover)', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                                        >
                                            Upgrade
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </aside>
            )}

            {/* Main Content Area */}
            <div className="st-main">
                <header className={`st-topbar ${isSidebarHidden ? 'sidebar-toggle-visible' : ''}`}>
                    <button
                        type="button"
                        className="st-mobile-menu-btn"
                        aria-label="Open navigation"
                        onClick={() => setMobileNavOpen(true)}
                    >
                        <I d="M4 6h16M4 12h16M4 18h16" s={18} />
                    </button>
                    {isSidebarHidden && (
                        <button
                            className="st-sidebar-toggle topbar"
                            type="button"
                            aria-label="Show sidebar"
                            title="Show sidebar"
                            onClick={() => setIsSidebarHidden(false)}
                        >
                            <I d="M3 3h18v18H3zM9 3v18M12 9l3 3-3 3" s={17} />
                        </button>
                    )}

                    {/* Project selector dropdown */}
                    <div className="st-project-dropdown-wrap" ref={projectDropdownRef} style={{ position: 'relative' }}>
                        <button
                            className="st-project-select"
                            type="button"
                            aria-expanded={showProjectDropdown}
                            aria-haspopup="listbox"
                            onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                        >
                            <span>{activeProject?.name || 'Project'}</span>
                            <I d="M6 9l6 6 6-6" s={14} />
                        </button>
                        {showProjectDropdown && (
                            <div className="st-project-dropdown-menu">
                                <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                                    {state.projects.map((p) => (
                                        <button
                                            key={p.id}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                width: '100%', padding: '10px 14px', border: 'none',
                                                background: p.id === activeProject?.id ? 'rgba(139,92,246,0.08)' : 'transparent',
                                                cursor: 'pointer', fontSize: '0.85rem', fontWeight: p.id === activeProject?.id ? 700 : 500,
                                                color: p.id === activeProject?.id ? '#7c3aed' : '#334155',
                                                transition: 'background 0.15s ease'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = p.id === activeProject?.id ? 'rgba(139,92,246,0.12)' : '#f8fafc'}
                                            onMouseLeave={e => e.currentTarget.style.background = p.id === activeProject?.id ? 'rgba(139,92,246,0.08)' : 'transparent'}
                                            onClick={() => { loadStudioState(p.id); setShowProjectDropdown(false); }}
                                        >
                                            <img
                                                src={p.thumbnailUrl && p.thumbnailUrl.startsWith('/') ? mediaUrl(p.thumbnailUrl) : (p.thumbnailUrl || '/demo_geometric.png')}
                                                alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', border: '1px solid #e2e8f0' }}
                                            />
                                            <span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span>
                                            {p.id === activeProject?.id && <I d="M5 13l4 4L19 7" s={14} />}
                                        </button>
                                    ))}
                                </div>
                                <div style={{ borderTop: '1px solid #e2e8f0', padding: '6px' }}>
                                    <form
                                        style={{ display: 'flex', gap: '6px' }}
                                        onSubmit={async (e) => {
                                            e.preventDefault();
                                            if (!newProjectName.trim()) return;
                                            try {
                                                const d = await apiFetch('/api/projects', {
                                                    method: 'POST',
                                                    body: JSON.stringify({ name: newProjectName.trim() }),
                                                }, currentToken);
                                                if (d.success && d.projectId) {
                                                    loadStudioState(d.projectId);
                                                    setNewProjectName('');
                                                    setShowProjectDropdown(false);
                                                    showNotice('Project created.');
                                                }
                                            } catch (err) {
                                                if (err.status !== 401) setError(err.message || 'Project creation failed.');
                                            }
                                        }}
                                    >
                                        <input
                                            type="text"
                                            value={newProjectName}
                                            onChange={e => setNewProjectName(e.target.value)}
                                            placeholder="Project name..."
                                            autoFocus
                                            style={{
                                                flex: 1, padding: '8px 10px', border: '1px solid #e2e8f0',
                                                borderRadius: '7px', fontSize: '0.82rem', outline: 'none'
                                            }}
                                            onFocus={e => e.target.style.borderColor = '#7c3aed'}
                                            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                        />
                                        <button
                                            type="submit"
                                            style={{
                                                padding: '8px 14px', background: '#7c3aed', color: '#fff',
                                                border: 'none', borderRadius: '7px', fontSize: '0.82rem',
                                                fontWeight: 700, cursor: 'pointer'
                                            }}
                                        >
                                            Create
                                        </button>
                                    </form>
                                </div>
                            </div>
                        )}
                    </div>

                    <div
                        className="st-search"
                        role="button"
                        tabIndex={0}
                        onClick={() => { setPaletteOpen(true); setPaletteQuery(''); }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setPaletteOpen(true);
                                setPaletteQuery('');
                            }
                        }}
                    >
                        <I d="M21 21l-4.3-4.3M10 18a8 8 0 100-16 8 8 0 000 16z" s={16} />
                        <input
                            placeholder="Search projects, patterns, tools..."
                            readOnly
                            aria-label="Open command palette"
                        />
                        <kbd>Ctrl K</kbd>
                    </div>

                    <div className="st-user-actions">
                        {/* Background Tasks Tray Widget */}
                        <BgTaskManager
                            bgTasks={bgTasks}
                            show={showBgTasksDropdown}
                            onToggle={setShowBgTasksDropdown}
                            setTool={setTool}
                            setResultUrl={resultUrls.set}
                            setQwenLaunch={setQwenLaunch}
                            currentToken={currentToken}
                        />

                        {/* Account dropdown */}
                        <div className="st-account-wrap" ref={accountDropdownRef}>
                            <button
                                className="st-account-trigger"
                                onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                                aria-expanded={showAccountDropdown}
                                aria-haspopup="menu"
                            >
                                <div className="st-avatar">{user?.initials || 'U'}</div>
                                <div className="st-user-meta"><strong>{user?.name || 'User'}</strong><span>{user?.plan || 'Free'}</span></div>
                                <I d="M6 9l6 6 6-6" s={13} />
                            </button>
                            {showAccountDropdown && (
                                <div className="st-account-dropdown" role="menu">
                                    <div className="st-account-dropdown-header">
                                        <div className="st-avatar st-avatar-lg">{user?.initials || 'U'}</div>
                                        <div className="st-account-dropdown-user">
                                            <strong>{user?.name || 'User'}</strong>
                                            <span>{user?.plan || 'Free'}</span>
                                        </div>
                                    </div>
                                    <div className="st-account-credits-card">
                                        <div className="st-account-credits-top">
                                            <span className="st-account-credits-label">
                                                <I d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" s={14} />
                                                Balance
                                            </span>
                                            <button
                                                type="button"
                                                className="st-account-upgrade-btn"
                                                onClick={() => { setTool('billing'); setShowAccountDropdown(false); }}
                                            >
                                                Upgrade
                                            </button>
                                        </div>
                                        {hasLoadedUserCredits ? (
                                            <>
                                                <div className="st-account-credits-grid">
                                                    <div className="st-account-credits-stat">
                                                        <em>Total</em>
                                                        <strong>{Number(user?.creditsLimit || 0).toLocaleString()}</strong>
                                                    </div>
                                                    <div className="st-account-credits-stat">
                                                        <em>Remaining</em>
                                                        <strong>{Number(userRemainingCredits || 0).toLocaleString()}</strong>
                                                    </div>
                                                </div>
                                                <div className="st-account-credits-bar" aria-hidden="true">
                                                    <span style={{ width: `${remainingCreditPercent}%` }} />
                                                </div>
                                                <p className="st-account-credits-foot">
                                                    {user.creditsLimit > 0
                                                        ? `${Number(user.creditsUsed || 0).toLocaleString()} used this cycle`
                                                        : user.creditsUsed > 0
                                                            ? `${Number(user.creditsUsed || 0).toLocaleString()} used · no credits allocated`
                                                            : 'No credits allocated yet'}
                                                </p>
                                            </>
                                        ) : (
                                            <p className="st-account-credits-foot">Loading balance…</p>
                                        )}
                                    </div>
                                    <div className="st-account-menu-actions">
                                        <button type="button" onClick={() => { setTool('workspace'); setShowAccountDropdown(false); }}>
                                            <I d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" s={16} />
                                            <span>Workspace</span>
                                            <em>{activeProject?.name || 'Projects'}</em>
                                        </button>
                                        <button type="button" onClick={() => { setTool('billing'); setShowAccountDropdown(false); }}>
                                            <I d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" s={16} />
                                            <span>Billing</span>
                                        </button>
                                        <button type="button" className="danger" onClick={onLogout}>
                                            <I d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" s={16} />
                                            <span>Sign out</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                {(error || notice) && (
                    <div className={`st-global-banner ${error ? 'error' : 'success'}`} role="alert">
                        <span>{error || notice}</span>
                        <button
                            type="button"
                            className="st-global-banner-dismiss"
                            onClick={() => { setError(''); setNotice(''); }}
                            aria-label="Dismiss message"
                        >
                            <I d="M6 18L18 6M6 6l12 12" s={14} />
                        </button>
                    </div>
                )}

                <div className={`st-workspace ${!['dashboard', 'repeat', 'vectorize', 'upscale', 'removebg', 'imagelayers'].includes(tool) ? 'full-width' : ''}`}>
                    <main className={`st-center ${tool === 'repeat' ? 'no-scroll' : ''}`}>
                        {shouldShowPageHead && (
                            <div className="st-page-head">
                                <div>
                                    <h1 className="st-title">
                                        {toolLabel}
                                        {comingSoonToolIds.has(tool) && <span className="st-nav-soon-badge st-title-soon-badge">Soon</span>}
                                    </h1>
                                    <p>{
                                        comingSoonToolIds.has(tool) ? 'This feature is in development and will be available in an upcoming release.'
                                            : tool === 'exports' ? 'View and download your recently exported assets.'
                                                : tool === 'billing' ? 'Buy AI credit packs through Razorpay Standard Checkout.'
                                                    : tool === 'workspace' ? 'Manage projects, switch workspaces, and organize your design pipeline.'
                                                        : tool.startsWith('admin') ? 'Manage users, view API billing logs, and adjust credit limits.'
                                                            : ''
                                    }</p>
                                </div>
                            </div>
                        )}

                        {!COMPACT_UPLOAD_EXCLUDED_TOOLS.has(tool) && !comingSoonToolIds.has(tool) && !tool.startsWith('admin') && (
                            <ImageDropzone
                                variant="compact"
                                preview={preview}
                                previewLabel={uploaded?.originalName || 'Image'}
                                uploadStatus={uploadStatus}
                                onFile={handlePreUpload}
                                onInvalidFile={setError}
                                onPasteSuccess={() => showNotice('Image pasted')}
                            />
                        )}

                        {renderCanvas()}
                    </main>
                    {['dashboard', 'repeat', 'vectorize', 'upscale', 'removebg', 'imagelayers'].includes(tool) && (
                        <aside className="st-right-panel" ref={setRightPanelEl} />
                    )}
                </div>
            </div>

            {mobileNavOpen && (
                <>
                    <div className="st-mobile-nav-overlay" onClick={() => setMobileNavOpen(false)} role="presentation" />
                    <nav className="st-mobile-nav-drawer" aria-label="Mobile navigation">
                        <div className="st-mobile-nav-head">
                            <span>RIMI AI</span>
                            <button
                                type="button"
                                className="st-mobile-nav-close"
                                onClick={() => setMobileNavOpen(false)}
                                aria-label="Close navigation"
                            >
                                <I d="M6 18L18 6M6 6l12 12" s={18} />
                            </button>
                        </div>
                        {(isAdmin ? ADMIN_NAV : NAV).map((section, idx) => (
                            <div key={idx}>
                                {section.section && <div className="st-mobile-nav-section">{section.section}</div>}
                                {section.items.map((it) => (
                                    <button
                                        key={it.id}
                                        type="button"
                                        aria-current={tool === it.id ? 'page' : undefined}
                                        className={`st-mobile-nav-item ${tool === it.id ? 'active' : ''}${it.comingSoon ? ' coming-soon' : ''}`}
                                        onClick={() => { setTool(it.id); setError(''); setMobileNavOpen(false); }}
                                    >
                                        <I d={it.icon} s={18} />
                                        <span>{navLabel(it.id)}</span>
                                        {it.comingSoon && <span className="st-nav-soon-badge">Soon</span>}
                                    </button>
                                ))}
                            </div>
                        ))}
                        {!isAdmin && (
                            <button
                                type="button"
                                className={`st-mobile-nav-item ${tool === 'workspace' ? 'active' : ''}`}
                                aria-current={tool === 'workspace' ? 'page' : undefined}
                                onClick={() => { setTool('workspace'); setError(''); setMobileNavOpen(false); }}
                            >
                                <I d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" s={18} />
                                <span>{navLabel('workspace')}</span>
                            </button>
                        )}
                    </nav>
                </>
            )}

            <ReactSuspense fallback={null}>
            <StudioCommandPalette
                open={paletteOpen}
                query={paletteQuery}
                onQueryChange={setPaletteQuery}
                onClose={() => setPaletteOpen(false)}
                items={commandPaletteItems}
                onSelect={(id) => { setTool(id); setError(''); }}
            />
            </ReactSuspense>
        </div>
            </CreditsProvider>
        </ProjectProvider>
    );
}
