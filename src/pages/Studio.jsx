import React, { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense as ReactSuspense } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

// Admin panel imports
import AdminDashboard from '../components/studio/admin/AdminDashboard';
import AdminUsers from '../components/studio/admin/AdminUsers';
import AdminProjects from '../components/studio/admin/AdminProjects';
import AdminLogs from '../components/studio/admin/AdminLogs';
import AdminCredits from '../components/studio/admin/AdminCredits';

// Tool panel imports
import DashboardTool from '../components/studio/tools/DashboardTool';
import ExportsTool from '../components/studio/tools/ExportsTool';
import PatternTool from '../components/studio/tools/PatternTool';
import SeamlessTool from '../components/studio/tools/SeamlessTool';
import ToolComingSoon from '../components/studio/shared/ToolComingSoon';
import { COMING_SOON_TOOLS } from '../components/studio/shared/comingSoonTools';
import ImageLayersTool from '../components/studio/tools/ImageLayersTool';
import VectorizeTool from '../components/studio/tools/VectorizeTool';
import RemoveBgTool from '../components/studio/tools/RemoveBgTool';
import InspireTool from '../components/studio/tools/InspireTool';
import ColorwaysTool from '../components/studio/tools/ColorwaysTool';
import ColorwayManagerTool from '../components/studio/tools/ColorwayManagerTool';
import VectorProTool from '../components/studio/tools/VectorProTool';
import RepeatTool from '../components/studio/tools/RepeatTool';
import MappingsTool from '../components/studio/tools/MappingsTool';

// Shared icons & helpers
import { I } from '../components/studio/shared/StudioIcons';
import { API, apiFetch, consumeStudioPrefetch, forceDownload } from '../components/studio/shared/helpers';
import { loadRazorpay } from '../components/studio/shared/loadRazorpay';
import ImageDropzone from '../components/studio/shared/ImageDropzone';
import { isImageFile } from '../components/studio/shared/imageUpload';
import StudioCommandPalette from '../components/studio/shared/StudioCommandPalette';
import StudioBootSplash from '../components/StudioBootSplash';

const GarmentPreview3D = lazy(() => import('../components/GarmentPreview3D'));

// Pre-API fallback plans. Must mirror BILLING_PLANS in backend/routes/billing.py.
// Pricing: 4 credits per INR 1  ->  ~57% gross margin / ~54% after Razorpay.
// Live plan list arrives via /api/billing/overview and overrides this.
const BILLING_PLAN_FALLBACK = [
    { id: 'free', label: 'Free Trial', description: 'Trial credits for testing the studio.', credits: 50, amount: 0, priceLabel: 'Free', badge: '', features: ['50 starting credits', 'Try cheap models (Flux Schnell, Vectorize Local)', 'Razorpay recharge anytime'], checkoutEnabled: false },
    { id: 'starter', label: 'Starter', description: 'Small production runs and evaluation.', credits: 1996, amount: 49900, priceLabel: '₹499', badge: '', features: ['1,996 AI credits', '~13 Pattern Extractions (GPT Image 2)', '~34 Make-Seamless / Mockup runs'], checkoutEnabled: true },
    { id: 'creator', label: 'Creator', description: 'Best value for active textile workflows.', credits: 3996, amount: 99900, priceLabel: '₹999', badge: 'Popular', features: ['3,996 AI credits', '~27 Pattern Extractions, ~68 Seamless runs', 'Recommended for active studios'], checkoutEnabled: true },
    { id: 'pro', label: 'Pro', description: 'For frequent studio use and client work.', credits: 11996, amount: 299900, priceLabel: '₹2,999', badge: '', features: ['11,996 AI credits', 'High-volume generation buffer', 'All AI tools unlocked'], checkoutEnabled: true },
    { id: 'scale', label: 'Scale', description: 'Large credit top-up for production teams.', credits: 27996, amount: 699900, priceLabel: '₹6,999', badge: '', features: ['27,996 AI credits', 'Best per-credit rate', 'Designed for team production usage'], checkoutEnabled: true },
    { id: 'enterprise', label: 'Enterprise', description: 'For agencies and high-volume teams.', credits: 59996, amount: 1499900, priceLabel: '₹14,999', badge: '', features: ['59,996 AI credits', 'Priority support', 'Bulk seat licensing on request'], checkoutEnabled: true },
];

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
            { id: 'imagelayers', label: 'Image Layers', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
            { id: 'colorways', label: 'Colorways', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z' },
            { id: 'colorway-manager', label: 'Colorway Manager', icon: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83' },
            { id: 'vectorpro', label: 'Vector Pro', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485' },
            { id: 'mockup3d', label: '3D Mockup', icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.3 7l8.7 5 8.7-5M12 22V12', comingSoon: true },
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

const BOOT_SPLASH_MIN_MS = 2200;

export default function Studio({ onBack, currentUser, currentToken, onLogout, isBootEntry = false, onBootComplete }) {
    const adminTools = ['admin-dashboard', 'admin-users', 'admin-projects', 'admin-logs', 'admin-credits'];
    const userTools = ['dashboard', 'pattern', 'seamless', 'repeat', 'mappings', 'inspire', 'vectorize', 'upscale', 'removebg', 'imagelayers', 'colorways', 'colorway-manager', 'vectorpro', 'mockup3d', 'library', 'measurement', 'exports', 'billing', 'workspace'];
    const isAdmin = currentUser?.role === 'admin';

    const [tool, _setTool] = useState(() => {
        const hash = window.location.hash.replace('#', '');
        const allowed = isAdmin ? adminTools : userTools;
        if (allowed.includes(hash)) return hash;
        return isAdmin ? 'admin-dashboard' : 'pattern';
    });

    const setTool = useCallback((t) => {
        const allowed = isAdmin ? adminTools : userTools;
        if (!allowed.includes(t)) t = isAdmin ? 'admin-dashboard' : 'pattern';
        _setTool(t);
        window.location.hash = t;
    }, [isAdmin]);

    const [state, setState] = useState(emptyState);
    const [activeProjectId, setActiveProjectId] = useState(1);
    const [showProjectDropdown, setShowProjectDropdown] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [workspaceProjectName, setWorkspaceProjectName] = useState('');
    const [editingProjectId, setEditingProjectId] = useState(null);
    const [editingProjectName, setEditingProjectName] = useState('');
    const [workspaceBusyId, setWorkspaceBusyId] = useState(null);
    const projectDropdownRef = useRef(null);
    const [controlTab, setControlTab] = useState('controls');
    const [uploads, setUploads] = useState({});
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [isLoadingState, setIsLoadingState] = useState(true);
    const [showBootSplash, setShowBootSplash] = useState(isBootEntry);
    const bootStartedAtRef = useRef(Date.now());
    const bootCompletedRef = useRef(false);
    const [paymentStatus, setPaymentStatus] = useState({ loadingPackId: null, message: '', error: '' });
    const [razorpayKeyId, setRazorpayKeyId] = useState(import.meta.env.VITE_RAZORPAY_KEY_ID || '');

    const [billingOverview, setBillingOverview] = useState({
        loading: false,
        plans: BILLING_PLAN_FALLBACK,
        usage: null,
        payments: [],
        razorpayConfigured: false,
    });

    const hasLoadedControls = useRef(false);

    const [bgTasks, setBgTasks] = useState([]);
    const [showBgTasksDropdown, setShowBgTasksDropdown] = useState(false);
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

    // Synchronized state urls for task manager view trigger
    const [enhUrl, setEnhUrl] = useState(null);
    const [seamlessUrl, setSeamlessUrl] = useState(null);
    const [vecUrl, setVecUrl] = useState(null);
    const [upscaleUrl, setUpscaleUrl] = useState(null);
    const [removeBgUrl, setRemoveBgUrl] = useState(null);
    const [cwUrl, setCwUrl] = useState(null);
    const [repeatUrl, setRepeatUrl] = useState(null);
    const [isRepeat, setIsRepeat] = useState(false);
    const [rightPanelEl, setRightPanelEl] = useState(null);

    const addBgTask = (type, label, filename, triggerFn) => {
        const taskId = Date.now().toString();
        const newTask = {
            id: taskId,
            type,
            label,
            status: 'running',
            progress: 5,
            filename: filename || 'design_input.png',
            resultUrl: null,
            resultUrls: null,
            error: null,
            createdAt: new Date().toLocaleTimeString(),
        };

        setBgTasks(prev => [newTask, ...prev]);

        let progressVal = 5;
        const interval = setInterval(() => {
            progressVal = Math.min(95, progressVal + Math.floor(Math.random() * 6) + 2);
            setBgTasks(prev => prev.map(t => t.id === taskId ? { ...t, progress: progressVal } : t));
        }, 1200);

        triggerFn()
            .then((result) => {
                clearInterval(interval);
                setBgTasks(prev => prev.map(t => t.id === taskId ? {
                    ...t,
                    status: 'completed',
                    progress: 100,
                    resultUrl: result.url,
                    resultUrls: result.urls || null
                } : t));
            })
            .catch((err) => {
                clearInterval(interval);
                setBgTasks(prev => prev.map(t => t.id === taskId ? {
                    ...t,
                    status: 'failed',
                    progress: 0,
                    error: err.message || 'Generation failed'
                } : t));
            });
    };

    const stateUserMatchesCurrent = currentUser?.id && state.user?.id === currentUser.id;
    const user = currentUser
        ? {
            ...currentUser,
            creditsUsed: stateUserMatchesCurrent ? (state.user.creditsUsed ?? currentUser.creditsUsed) : currentUser.creditsUsed,
            creditsLimit: stateUserMatchesCurrent ? (state.user.creditsLimit ?? currentUser.creditsLimit) : currentUser.creditsLimit,
            resetDays: stateUserMatchesCurrent ? (state.user.resetDays ?? currentUser.resetDays) : currentUser.resetDays,
        }
        : state.user;

    const activeProject = state.activeProject;
    const userRemainingCredits = Math.max(0, (user.creditsLimit || 0) - (user.creditsUsed || 0));
    const hasLoadedUserCredits = !isLoadingState;
    const remainingCreditPercent = user.creditsLimit > 0
        ? Math.min(100, Math.round((userRemainingCredits / user.creditsLimit) * 100))
        : 0;

    // Dynamic Credit Pricing  (fallback values mirror DEFAULT_CREDIT_PRICING in
    // backend/db.py at the 4 credits/INR pricing tier, ~57% gross margin).
    // The live values come from /api/credit-pricing on mount.
    const [creditPricing, setCreditPricing] = useState({
        upload: 0, extract: 148, seamless: 58, repeat: 5, upscale: 23,
        vectorize: 12, vectorizeLocal: 3, export: 0, inspire: 148,
        mappings: 148, imageLayers: 69, imageLayerEdit: 35,
        colorways: 3, recolor: 3, colorReduction: 3,
        layerExport: 2, techPack: 2,
        removeBg: 2, styleTransfer: 23, seamless_texture: 84,
    });

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
        if (responseData && responseData.creditsUsed !== undefined) {
            setState(prev => ({
                ...prev,
                user: {
                    ...prev.user,
                    id: prev.user?.id ?? currentUser?.id,
                    creditsUsed: responseData.creditsUsed,
                    creditsLimit: responseData.creditsLimit ?? prev.user?.creditsLimit ?? currentUser?.creditsLimit,
                }
            }));
        }
    };

    // Brand Palettes
    const [brandPalettes, setBrandPalettes] = useState([]);
    const [brandPalettesLoading, setBrandPalettesLoading] = useState(false);

    const fetchBrandPalettes = useCallback(() => {
        if (!activeProject?.id) return;
        setBrandPalettesLoading(true);
        apiFetch(`/api/brand-palettes?projectId=${activeProject.id}`, {}, currentToken)
            .then((d) => {
                if (d.palettes) setBrandPalettes(d.palettes);
                setBrandPalettesLoading(false);
            })
            .catch(() => setBrandPalettesLoading(false));
    }, [activeProject?.id, currentToken]);

    useEffect(() => {
        if (activeProject?.id) fetchBrandPalettes();
    }, [fetchBrandPalettes, activeProject?.id]);

    // Admin state
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

    useEffect(() => {
        if (isAdmin && (tool === 'admin-users' || tool === 'admin-credits')) fetchAdminUsers();
    }, [tool, fetchAdminUsers, isAdmin]);

    useEffect(() => {
        if (isAdmin && (tool === 'admin-credits' || tool === 'admin-dashboard')) fetchAdminBilling();
    }, [tool, fetchAdminBilling, isAdmin]);

    const fetchBillingOverview = useCallback(() => {
        if (!currentToken) return;
        setBillingOverview(prev => ({ ...prev, loading: true }));
        fetch(`${API}/api/billing/overview`, {
            headers: { 'Authorization': `Bearer ${currentToken}` },
        })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    setBillingOverview({
                        loading: false,
                        plans: d.plans?.length ? d.plans : BILLING_PLAN_FALLBACK,
                        usage: d.usage || null,
                        payments: d.payments || [],
                        razorpayConfigured: Boolean(d.razorpayConfigured),
                    });
                    if (d.usage) {
                        updateCreditsFromResponse({
                            creditsUsed: d.usage.creditsUsed,
                            creditsLimit: d.usage.creditsLimit,
                        });
                    }
                } else {
                    throw new Error(d.error || 'Unable to load billing overview.');
                }
            })
            .catch((err) => {
                setBillingOverview(prev => ({ ...prev, loading: false }));
                setPaymentStatus({ loadingPackId: null, message: '', error: err.message || 'Unable to load billing overview.' });
            });
    }, [currentToken]);

    useEffect(() => {
        if (tool !== 'billing' || !currentToken) return;
        fetchBillingOverview();
        loadRazorpay().catch(() => {});
        fetch(`${API}/api/billing/razorpay-config`, {
            headers: { 'Authorization': `Bearer ${currentToken}` },
        })
            .then(r => r.json())
            .then(d => {
                if (d.success && d.keyId) {
                    setRazorpayKeyId(d.keyId);
                } else if (d.success && !d.configured) {
                    setPaymentStatus({ loadingPackId: null, message: '', error: 'Razorpay is not configured on the backend.' });
                }
            })
            .catch(() => setPaymentStatus({ loadingPackId: null, message: '', error: 'Unable to load Razorpay configuration.' }));
    }, [tool, currentToken, fetchBillingOverview]);

    useEffect(() => {
        if (isAdmin && tool === 'admin-credits') fetchAdminPricing();
    }, [tool, fetchAdminPricing, isAdmin]);

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
        setState(studioState);
        setActiveProjectId(studioState.activeProject.id);
        window.setTimeout(() => { hasLoadedControls.current = true; }, 0);
    }, []);

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

        let cancelled = false;

        const loadInitialWorkspace = async () => {
            setIsLoadingState(true);
            setError('');

            const prefetched = consumeStudioPrefetch();
            if (prefetched?.state) {
                applyStudioState(prefetched.state);
            }

            try {
                const requests = [
                    apiFetch(`/api/studio-state?projectId=1`, {}, currentToken),
                    fetch(`${API}/api/credit-pricing`).then((r) => r.json()).catch(() => null),
                ];
                const [stateRes, pricingRes] = await Promise.all(requests);
                if (cancelled) return;

                if (stateRes?.success && stateRes.state) {
                    applyStudioState(stateRes.state);
                } else if (!prefetched?.state) {
                    throw new Error(stateRes?.error || 'Failed to load studio state');
                }

                if (pricingRes?.success && pricingRes.pricing) {
                    setCreditPricing(pricingRes.pricing);
                }
            } catch (err) {
                if (!cancelled && err.status !== 401 && !prefetched?.state) {
                    setError(err.message || 'Failed to load workspace.');
                }
                console.warn('Initial studio load failed:', err.message);
            } finally {
                if (!cancelled) setIsLoadingState(false);
            }
        };

        loadInitialWorkspace();
        return () => { cancelled = true; };
    }, [applyStudioState, currentToken, isAdmin]);

    useEffect(() => {
        if (!showBootSplash || isLoadingState) return undefined;

        const elapsed = Date.now() - bootStartedAtRef.current;
        const remaining = Math.max(0, BOOT_SPLASH_MIN_MS - elapsed);
        const timer = window.setTimeout(() => setShowBootSplash(false), remaining);
        return () => window.clearTimeout(timer);
    }, [showBootSplash, isLoadingState]);

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
                label: it.label,
                icon: it.icon,
                section: section.section || 'Studio',
                comingSoon: Boolean(it.comingSoon),
            }))
        );
        if (!isAdmin) {
            items.push({
                id: 'workspace',
                label: 'Workspace',
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
        if (!hasLoadedControls.current) return;
        const id = window.setTimeout(async () => {
            try {
                const d = await apiFetch(
                    `/api/projects/${activeProject.id}/controls`,
                    { method: 'PATCH', body: JSON.stringify(controls) },
                    currentToken,
                );
                if (d.success && d.state) {
                    setState(prev => ({
                        ...prev,
                        ...d.state,
                        controls: { ...prev.controls, ...d.state.controls },
                    }));
                }
            } catch {
                console.warn('Control sync failed.');
            }
        }, 350);
        return () => window.clearTimeout(id);
    }, [controls, activeProject?.id, currentToken]);

    const handlePreUpload = (file) => {
        if (!file) return;
        if (!isImageFile(file)) {
            setError('Invalid file type. Supported: JPG, PNG, WEBP');
            return;
        }
        const url = URL.createObjectURL(file);
        setUploads(prev => ({ ...prev, [tool]: { file, url } }));
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
                setUploads(prev => ({
                    ...prev,
                    [tool]: {
                        file: {
                            ...file,
                            filename: d.filename,
                            originalName: file.name
                        },
                        url: prev[tool]?.url
                    }
                }));
                updateCreditsFromResponse(d);
            } else setError(d.error);
        } catch {
            setError('Backend upload failed.');
        }
    };

    // createRepeat handler moved to RepeatTool component

    const startRazorpayCheckout = async (pack) => {
        setPaymentStatus({ loadingPackId: pack.id, message: '', error: '' });

        if (!razorpayKeyId) {
            setPaymentStatus({ loadingPackId: null, message: '', error: 'Razorpay key id is not configured.' });
            return;
        }

        try {
            const Razorpay = await loadRazorpay();
            const orderRes = await fetch(`${API}/api/create-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                body: JSON.stringify({
                    receipt: `rimi_${user?.id || 'guest'}_${pack.id}_${Date.now()}`,
                    packId: pack.id,
                }),
            });
            const orderData = await orderRes.json().catch(() => ({}));
            if (!orderRes.ok || !orderData.success) {
                throw new Error(orderData.error || 'Unable to create payment order.');
            }

            const checkout = new Razorpay({
                key: orderData.key_id || razorpayKeyId,
                amount: orderData.amount,
                currency: orderData.currency,
                name: 'RIMI AI',
                description: `${pack.credits.toLocaleString()} AI credits`,
                order_id: orderData.order_id,
                prefill: {
                    name: user?.name || '',
                    email: user?.email || '',
                },
                theme: { color: '#6366f1' },
                modal: {
                    ondismiss: () => {
                        setPaymentStatus({ loadingPackId: null, message: '', error: 'Payment cancelled.' });
                    },
                },
                handler: async (response) => {
                    try {
                        setPaymentStatus({ loadingPackId: pack.id, message: 'Verifying payment...', error: '' });
                        const verifyRes = await fetch(`${API}/api/verify-payment`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                            }),
                        });
                        const verifyData = await verifyRes.json().catch(() => ({}));
                        if (!verifyRes.ok || !verifyData.success) {
                            throw new Error(verifyData.error || 'Payment verification failed.');
                        }
                        setPaymentStatus({
                            loadingPackId: null,
                            message: `Payment verified for ${pack.credits.toLocaleString()} credits.`,
                            error: '',
                        });
                        updateCreditsFromResponse(verifyData);
                        fetchBillingOverview();
                        await loadStudioState(activeProject.id);
                    } catch (err) {
                        setPaymentStatus({
                            loadingPackId: null,
                            message: '',
                            error: err.message || 'Payment verification failed.',
                        });
                    }
                },
            });

            checkout.on('payment.failed', (response) => {
                setPaymentStatus({
                    loadingPackId: null,
                    message: '',
                    error: response?.error?.description || 'Payment failed. Please try again.',
                });
            });

            checkout.open();
        } catch (err) {
            setPaymentStatus({
                loadingPackId: null,
                message: '',
                error: err.message || 'Unable to start payment.',
            });
        }
    };

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
        const thumbUrl = (url) => (url && url.startsWith('/') ? `${API}${url}` : (url || '/demo_geometric.png'));

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

    const renderBilling = () => {
        const usage = billingOverview.usage || {
            plan: user.plan || 'Free Trial',
            creditsUsed: user.creditsUsed || 0,
            creditsLimit: user.creditsLimit || 0,
            creditsRemaining: userRemainingCredits,
            usagePct: user.creditsLimit ? Math.min(100, Math.round(((user.creditsUsed || 0) / user.creditsLimit) * 100)) : 0,
        };
        const plans = billingOverview.plans?.length ? billingOverview.plans : BILLING_PLAN_FALLBACK;
        const currentPlanName = (usage.plan || user.plan || 'Free').toLowerCase();
        const formatDate = (value) => {
            if (!value) return 'Pending';
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        };

        return (
            <div className="st-billing-page">
                <div className="st-billing-header">
                    <div>
                        <div className="st-billing-kicker">Subscription</div>
                        <h2>Credits and Billing</h2>
                        <p>Recharge AI credits through Razorpay Standard Checkout. Credits are added to your available limit after payment verification.</p>
                    </div>
                    <button className="st-billing-refresh" onClick={fetchBillingOverview} disabled={billingOverview.loading}>
                        <I d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" s={16} />
                        {billingOverview.loading ? 'Refreshing' : 'Refresh'}
                    </button>
                </div>

                <div className="st-billing-tabs" aria-label="Billing sections">
                    <button className="active">RIMI Studio</button>
                    <button disabled>API</button>
                    <button disabled>Enterprise</button>
                </div>

                <div className="st-billing-summary-grid">
                    <section className="st-billing-usage-card">
                        <div className="st-billing-usage-row">
                            <span>Credits used</span>
                            <strong>{Number(usage.creditsUsed || 0).toLocaleString()} / {Number(usage.creditsLimit || 0).toLocaleString()} credits</strong>
                        </div>
                        <div className="st-billing-progress" aria-label={`${usage.usagePct || 0}% credits used`}>
                            <span style={{ width: `${Math.min(100, usage.usagePct || 0)}%` }} />
                        </div>
                        <div className="st-billing-usage-foot">
                            <span>{Number(usage.creditsRemaining || 0).toLocaleString()} credits remaining</span>
                            <span>{usage.usagePct || 0}% used</span>
                        </div>
                    </section>

                    <section className="st-billing-current-card">
                        <div>
                            <span>Current plan</span>
                            <strong>{usage.plan || 'Free Trial'}</strong>
                        </div>
                        <div className={`st-billing-status ${billingOverview.razorpayConfigured ? 'ready' : 'missing'}`}>
                            <I d={billingOverview.razorpayConfigured ? 'M20 6L9 17l-5-5' : 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'} s={14} />
                            {billingOverview.razorpayConfigured ? 'Razorpay ready' : 'Razorpay not configured'}
                        </div>
                    </section>
                </div>

                {(paymentStatus.message || paymentStatus.error) && (
                    <div className={`st-billing-alert ${paymentStatus.error ? 'error' : 'success'}`}>
                        {paymentStatus.error || paymentStatus.message}
                    </div>
                )}

                <div className="st-billing-controls">
                    <div className="st-billing-currency">
                        <span>INR</span>
                        <strong>India billing</strong>
                    </div>
                    <div className="st-billing-cycle">
                        <button className="active">Credit packs</button>
                        <button disabled>Monthly</button>
                    </div>
                </div>

                <div className="st-billing-plans">
                    {plans.map((pack) => {
                        const isLoading = paymentStatus.loadingPackId === pack.id;
                        const amount = Number(pack.amount || 0);
                        const isCurrent = currentPlanName.includes((pack.label || '').toLowerCase());
                        const priceLabel = pack.priceLabel || (amount ? `₹${(amount / 100).toLocaleString('en-IN')}` : '₹0');
                        return (
                            <article key={pack.id} className={`st-billing-plan ${pack.badge ? 'highlighted' : ''}`}>
                                <div className="st-billing-plan-top">
                                    <div>
                                        <h3>{pack.label}</h3>
                                        <p>{pack.description}</p>
                                    </div>
                                    {pack.badge && <span className="st-billing-badge">{pack.badge}</span>}
                                </div>
                                <div className="st-billing-price">
                                    <strong>{priceLabel}</strong>
                                    <span>{amount ? 'one-time' : 'trial'}</span>
                                </div>
                                <button
                                    className={`st-billing-pay ${pack.badge ? 'primary' : ''}`}
                                    type="button"
                                    onClick={() => startRazorpayCheckout(pack)}
                                    disabled={isLoading || !pack.checkoutEnabled || !billingOverview.razorpayConfigured}
                                >
                                    {isLoading ? 'Processing...' : isCurrent && !pack.checkoutEnabled ? 'Current plan' : pack.checkoutEnabled ? 'Pay with Razorpay' : 'Included'}
                                </button>
                                <div className="st-billing-credit-line">
                                    <strong>{Number(pack.credits || 0).toLocaleString()}</strong>
                                    <span>AI credits</span>
                                </div>
                                <ul>
                                    {(pack.features || []).map((feature) => (
                                        <li key={feature}><I d="M20 6L9 17l-5-5" s={14} /> {feature}</li>
                                    ))}
                                </ul>
                            </article>
                        );
                    })}
                </div>

                <section className="st-billing-history">
                    <div className="st-billing-section-head">
                        <div>
                            <h3>Payment history</h3>
                            <p>Recent Razorpay orders and credit recharges.</p>
                        </div>
                    </div>
                    {billingOverview.payments?.length ? (
                        <div className="st-billing-table">
                            {billingOverview.payments.map((payment) => (
                                <div className="st-billing-row" key={payment.id}>
                                    <div>
                                        <strong>{payment.packLabel}</strong>
                                        <span>{payment.orderId}</span>
                                    </div>
                                    <div>{Number(payment.credits || 0).toLocaleString()} credits</div>
                                    <div>₹{(Number(payment.amount || 0) / 100).toLocaleString('en-IN')}</div>
                                    <div><span className={`st-billing-pill ${payment.status}`}>{payment.status}</span></div>
                                    <div>{formatDate(payment.paidAt || payment.createdAt)}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="st-billing-empty">No Razorpay payments yet.</div>
                    )}
                </section>
            </div>
        );
    };

    const renderCanvas = () => {
        // Shared props structure passed down to tool components
        const commonProps = {
            uploaded,
            preview,
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
        };

        // Routing canvas rendering
        if (tool === 'admin-dashboard') return <AdminDashboard adminStats={state.metrics} budgetData={budgetData} adminUsers={adminUsers} setTool={setTool} renderBudgetBanner={renderBudgetBanner} />;
        if (tool === 'admin-users') return <AdminUsers renderBudgetBanner={renderBudgetBanner} adminUsersLoading={adminUsersLoading} adminUsers={adminUsers} currentToken={currentToken} fetchAdminUsers={fetchAdminUsers} />;
        if (tool === 'admin-projects') return <AdminProjects renderBudgetBanner={renderBudgetBanner} adminProjectsLoading={state.projectsLoading} adminProjects={state.projects} />;
        if (tool === 'admin-logs') return <AdminLogs renderBudgetBanner={renderBudgetBanner} replicateLogsLoading={replicateLogsLoading} replicateLogs={replicateLogs} loginEvents={loginEvents} adminAuditEvents={adminAuditEvents} />;
        if (tool === 'admin-credits') return <AdminCredits renderBudgetBanner={renderBudgetBanner} adminUsers={adminUsers} adminSelectedUserId={adminSelectedUserId} setAdminSelectedUserId={setAdminSelectedUserId} adminUsersLoading={adminUsersLoading} currentToken={currentToken} fetchAdminUsers={fetchAdminUsers} />;

        if (tool === 'workspace') return renderWorkspaceManager();
        if (tool === 'billing') return renderBilling();

        if (tool === 'dashboard') return <DashboardTool {...commonProps} />;
        if (tool === 'exports') return <ExportsTool {...commonProps} />;
        if (tool === 'pattern') return <PatternTool {...commonProps} enhUrl={enhUrl} setEnhUrl={setEnhUrl} />;
        if (tool === 'seamless') return <SeamlessTool {...commonProps} seamlessUrl={seamlessUrl} setSeamlessUrl={setSeamlessUrl} />;
        if (COMING_SOON_TOOLS[tool]) return <ToolComingSoon {...COMING_SOON_TOOLS[tool]} />;
        if (tool === 'imagelayers') return <ImageLayersTool {...commonProps} />;
        if (tool === 'vectorize' || tool === 'upscale') return <VectorizeTool {...commonProps} vecUrl={vecUrl} setVecUrl={setVecUrl} upscaleUrl={upscaleUrl} setUpscaleUrl={setUpscaleUrl} />;
        if (tool === 'removebg') return <RemoveBgTool {...commonProps} removeBgUrl={removeBgUrl} setRemoveBgUrl={setRemoveBgUrl} />;
        if (tool === 'inspire') return <InspireTool {...commonProps} />;
        if (tool === 'colorways') return <ColorwaysTool {...commonProps} cwUrl={cwUrl} setCwUrl={setCwUrl} />;
        if (tool === 'colorway-manager') return <ColorwayManagerTool {...commonProps} />;
        if (tool === 'vectorpro') return <VectorProTool {...commonProps} brandPalettes={brandPalettes} />;
        if (tool === 'mappings') return <MappingsTool {...commonProps} />;
        if (tool === 'repeat') return <RepeatTool {...commonProps} repeatUrl={repeatUrl} setRepeatUrl={setRepeatUrl} isRepeat={isRepeat} setIsRepeat={setIsRepeat} />;

        return null;
    };

    const toolLabel = useMemo(() => {
        if (tool === 'workspace') return 'Workspace';
        const items = [...NAV[0].items, ...NAV[1].items, ...NAV[2].items, ...ADMIN_NAV[0].items];
        return items.find(it => it.id === tool)?.label || 'Studio';
    }, [tool]);

    return (
        <div className={`studio ${isSidebarHidden ? 'sidebar-hidden' : ''}`}>
            <StudioBootSplash
                visible={showBootSplash}
                dataReady={!isLoadingState}
                minDurationMs={BOOT_SPLASH_MIN_MS}
                onHidden={() => {
                    if (!bootCompletedRef.current) {
                        bootCompletedRef.current = true;
                        onBootComplete?.();
                    }
                }}
            />
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
                                        {section.section && <div className="st-nav-section">{section.section}</div>}
                                        {section.items.map(it => (
                                            <button
                                                key={it.id}
                                                className={`st-nav-item ${tool === it.id ? 'active' : ''}${it.comingSoon ? ' coming-soon' : ''}`}
                                                onClick={() => { setTool(it.id); setError(''); }}
                                            >
                                                <I d={it.icon} s={18} />
                                                <span>{it.label}</span>
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
                                        {section.section && <div className="st-nav-section">{section.section}</div>}
                                        {section.items.map(it => (
                                            <button
                                                key={it.id}
                                                className={`st-nav-item ${tool === it.id ? 'active' : ''}${it.comingSoon ? ' coming-soon' : ''}`}
                                                onClick={() => { setTool(it.id); setError(''); }}
                                            >
                                                <I d={it.icon} s={18} />
                                                <span>{it.label}</span>
                                                {it.comingSoon && <span className="st-nav-soon-badge">Soon</span>}
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
                                                src={p.thumbnailUrl && p.thumbnailUrl.startsWith('/') ? `${API}${p.thumbnailUrl}` : (p.thumbnailUrl || '/demo_geometric.png')}
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
                        <div className="st-bg-tasks-container" style={{ position: 'relative' }}>
                            <button
                                className={`st-icon-btn ${bgTasks.some(t => t.status === 'running') ? 'active-pulse' : ''}`}
                                onClick={() => setShowBgTasksDropdown(!showBgTasksDropdown)}
                                title="AI Background Queue Manager"
                                style={{
                                    position: 'relative',
                                    background: showBgTasksDropdown ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                                    color: bgTasks.some(t => t.status === 'running') ? '#6366f1' : '#64748b'
                                }}
                            >
                                <I d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" s={18} />
                                {bgTasks.filter(t => t.status === 'running').length > 0 && (
                                    <span className="st-bg-tasks-badge" style={{
                                        position: 'absolute',
                                        top: '-2px',
                                        right: '-2px',
                                        background: '#6366f1',
                                        color: '#fff',
                                        borderRadius: '50%',
                                        width: '14px',
                                        height: '14px',
                                        fontSize: '8px',
                                        fontWeight: 800,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        boxShadow: '0 2px 6px rgba(99, 102, 241, 0.4)'
                                    }}>
                                        {bgTasks.filter(t => t.status === 'running').length}
                                    </span>
                                )}
                            </button>

                            {showBgTasksDropdown && (
                                <div className="st-bg-tasks-dropdown st-glassmorphic-dropdown" style={{
                                    position: 'absolute',
                                    top: '100%',
                                    right: 0,
                                    marginTop: '6px',
                                    width: '320px',
                                    background: '#fff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '10px',
                                    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.16)',
                                    zIndex: 9999,
                                    padding: '12px'
                                }}>
                                    <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>Background Tasks</span>
                                        <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>{bgTasks.length} total</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                                        {bgTasks.length === 0 ? (
                                            <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>No background tasks active</div>
                                        ) : (
                                            bgTasks.map(t => (
                                                <div key={t.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>{t.label}</span>
                                                        <span style={{
                                                            fontSize: '0.65rem',
                                                            fontWeight: 800,
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            textTransform: 'uppercase',
                                                            background: t.status === 'completed' ? '#dcfce7' : t.status === 'failed' ? '#fee2e2' : '#e0e7ff',
                                                            color: t.status === 'completed' ? '#15803d' : t.status === 'failed' ? '#b91c1c' : '#4338ca',
                                                        }}>{t.status}</span>
                                                    </div>
                                                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Input: {t.filename}</div>
                                                    {t.status === 'running' && (
                                                        <div style={{ width: '100%' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#6366f1', fontWeight: 700, marginBottom: '2px' }}>
                                                                <span>Processing...</span>
                                                                <span>{t.progress}%</span>
                                                            </div>
                                                            <div style={{ width: '100%', height: '4px', background: '#e2e8f0', borderRadius: '99px', overflow: 'hidden' }}>
                                                                <div style={{ width: `${t.progress}%`, height: '100%', background: 'linear-gradient(90deg, #6366f1, #ec4899)' }} />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {t.status === 'completed' && t.resultUrl && (
                                                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                                                            <div style={{ width: '32px', height: '32px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                <img src={t.resultUrl.startsWith('http') ? t.resultUrl : `${API}${t.resultUrl}`} alt="Result" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '6px', flex: 1, justifyContent: 'flex-end' }}>
                                                                <button onClick={() => {
                                                                    setTool(t.type);
                                                                    if (t.type === 'pattern') setEnhUrl(t.resultUrls || t.resultUrl);
                                                                    if (t.type === 'seamless') setSeamlessUrl(t.resultUrl);
                                                                    if (t.type === 'vectorize') setVecUrl(t.resultUrl);
                                                                    if (t.type === 'upscale') setUpscaleUrl(t.resultUrl);
                                                                    if (t.type === 'removebg') setRemoveBgUrl(t.resultUrl);
                                                                    setShowBgTasksDropdown(false);
                                                                }} style={{ padding: '4px 10px', fontSize: '0.72rem', background: 'rgba(99, 102, 241, 0.08)', color: '#6366f1', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}>View</button>
                                                                <a href={t.resultUrl.startsWith('http') ? t.resultUrl : `${API}${t.resultUrl}`} download onClick={(e) => forceDownload(e, t.resultUrl.startsWith('http') ? t.resultUrl : `${API}${t.resultUrl}`)} style={{ padding: '4px 10px', fontSize: '0.72rem', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', color: '#fff', borderRadius: '6px', fontWeight: 700, textDecoration: 'none', textAlign: 'center' }}>Download</a>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

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
                        <div className="st-page-head">
                            <div>
                                <h1 className="st-title">
                                    {toolLabel}
                                    {comingSoonToolIds.has(tool) && <span className="st-nav-soon-badge st-title-soon-badge">Soon</span>}
                                </h1>
                                {tool !== 'inspire' && <p>{
                                    comingSoonToolIds.has(tool) ? 'This feature is in development and will be available in an upcoming release.'
                                        : tool === 'dashboard' ? 'Build, customize, and run AI pipelines to transform your artwork into production-ready patterns.'
                                            : tool === 'pattern' ? 'Extract clean, seamless patterns using the power of multiple AI models.'
                                                : tool === 'exports' ? 'View and download your recently exported assets.'
                                                    : tool === 'billing' ? 'Buy AI credit packs through Razorpay Standard Checkout.'
                                                        : tool === 'workspace' ? 'Manage projects, switch workspaces, and organize your design pipeline.'
                                                            : tool === 'colorway-manager' ? 'Generate systematic production colorways with color theory strategies.'
                                                                : tool === 'removebg' ? 'Remove backgrounds instantly and download transparent PNGs for print-ready assets.'
                                                                    : tool.startsWith('admin') ? 'Manage users, view API billing logs, and adjust credit limits.'
                                                                        : 'Upload artwork and generate print-ready assets.'
                                }</p>}
                            </div>
                        </div>

                        {(tool !== 'dashboard' && tool !== 'exports' && tool !== 'billing' && tool !== 'workspace' && tool !== 'pattern' && tool !== 'inspire' && tool !== 'seamless' && tool !== 'mappings' && tool !== 'vectorize' && tool !== 'upscale' && tool !== 'removebg' && tool !== 'imagelayers' && !comingSoonToolIds.has(tool) && !tool.startsWith('admin')) && (
                            <ImageDropzone
                                variant="compact"
                                preview={preview}
                                previewLabel={uploaded?.originalName || 'Image'}
                                onFile={handlePreUpload}
                                onInvalidFile={setError}
                                onPasteSuccess={() => showNotice('Image pasted')}
                            />
                        )}

                        {isLoadingState && !showBootSplash ? (
                            <div className="st-loading-layout" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '320px', gap: '1rem' }}>
                                <div className="st-spinner" style={{ width: '36px', height: '36px', borderWidth: '3px' }} />
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>Loading workspace…</span>
                            </div>
                        ) : (
                            renderCanvas()
                        )}
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
                                        className={`st-mobile-nav-item ${tool === it.id ? 'active' : ''}${it.comingSoon ? ' coming-soon' : ''}`}
                                        onClick={() => { setTool(it.id); setError(''); setMobileNavOpen(false); }}
                                    >
                                        <I d={it.icon} s={18} />
                                        <span>{it.label}</span>
                                        {it.comingSoon && <span className="st-nav-soon-badge">Soon</span>}
                                    </button>
                                ))}
                            </div>
                        ))}
                        {!isAdmin && (
                            <button
                                type="button"
                                className={`st-mobile-nav-item ${tool === 'workspace' ? 'active' : ''}`}
                                onClick={() => { setTool('workspace'); setError(''); setMobileNavOpen(false); }}
                            >
                                <I d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" s={18} />
                                <span>Workspace</span>
                            </button>
                        )}
                    </nav>
                </>
            )}

            <StudioCommandPalette
                open={paletteOpen}
                query={paletteQuery}
                onQueryChange={setPaletteQuery}
                onClose={() => setPaletteOpen(false)}
                items={commandPaletteItems}
                onSelect={(id) => { setTool(id); setError(''); }}
            />
        </div>
    );
}
