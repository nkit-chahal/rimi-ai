import React, { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense as ReactSuspense } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import * as fabric from 'fabric';

const GarmentPreview3D = lazy(() => import('../components/GarmentPreview3D'));

async function getCroppedImg(imageElement, crop, fileName) {
    const canvas = document.createElement('canvas');
    const scaleX = imageElement.naturalWidth / imageElement.width;
    const scaleY = imageElement.naturalHeight / imageElement.height;
    canvas.width = crop.width * scaleX;
    canvas.height = crop.height * scaleY;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
        imageElement,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0, 0,
        crop.width * scaleX,
        crop.height * scaleY
    );
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (!blob) { resolve(null); return; }
            resolve(new File([blob], fileName, { type: 'image/png' }));
        }, 'image/png');
    });
}

const localApiHosts = new Set(['localhost', '127.0.0.1']);
const API = import.meta.env.VITE_API_URL || (localApiHosts.has(window.location.hostname) ? 'http://localhost:3001' : '');

const forceDownload = async (e, url) => {
    e.preventDefault();
    if (!url) return;

    try {
        // Determine the proxy URL
        let downloadUrl = url;
        if (!(url.startsWith('/') && !url.startsWith('/results/') && !url.startsWith('/uploads/'))) {
            downloadUrl = `${API}/api/download?url=${encodeURIComponent(url)}`;
        }

        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error('Download failed');

        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;

        // Attempt to get filename from headers
        const disposition = res.headers.get('content-disposition');
        let filename = 'rim_ai_export.png';
        if (disposition && disposition.includes('filename=')) {
            filename = disposition.split('filename=')[1].replace(/"/g, '');
        } else {
            const parts = url.split('/');
            const last = parts[parts.length - 1];
            if (last && !last.includes('?')) filename = last;
        }

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
        console.error('Forced download failed, falling back:', err);
        // Fallback: open in new tab
        window.open(url, '_blank');
    }
};

const I = ({ d, s = 18 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
    </svg>
);

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
            { id: 'imagelayers', label: 'Image Layers', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
            { id: 'colorways', label: 'Colorways', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z' },
            { id: 'colorway-manager', label: 'Colorway Manager', icon: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83' },
            { id: 'print-advisor', label: 'Print Advisor', icon: 'M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z' },
            { id: 'vectorpro', label: 'Vector Pro', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485' },
            { id: 'mockup3d', label: '3D Mockup', icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.3 7l8.7 5 8.7-5M12 22V12' },
        ],
    },
    {
        section: 'ASSETS & LIBRARY',
        items: [
            { id: 'library', label: 'Brand Library', icon: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z' },
            { id: 'measurement', label: 'Measurement', icon: 'M2 2h6v6H2zM16 2h6v6h-6zM2 16h6v6H2zM16 16h6v6h-6zM8 5h8M8 19h8M5 8v8M19 8v8' },
            { id: 'exports', label: 'Exports', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3' },
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
    controls: { gridSize: 2, scale: 100, rotation: 0, repeatType: 'block', colorCleanup: true, edgeMatch: true, backgroundClean: false, exportFormat: 'PNG', exportDpi: 300, hBrush: 8, vBrush: 8, printWidth: 12 },
    suggestion: '',
};

export default function Studio({ onBack, currentUser, currentToken, onLogout }) {
    const adminTools = ['admin-dashboard', 'admin-users', 'admin-projects', 'admin-logs', 'admin-credits'];
    const userTools = ['dashboard', 'pattern', 'seamless', 'repeat', 'mappings', 'inspire', 'vectorize', 'upscale', 'imagelayers', 'colorways', 'colorway-manager', 'print-advisor', 'vectorpro', 'mockup3d', 'library', 'measurement', 'exports'];
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
    const [controlTab, setControlTab] = useState('controls');
    const [uploads, setUploads] = useState({});
    const [isDrag, setIsDrag] = useState(false);
    const [error, setError] = useState('');
    const [isLoadingState, setIsLoadingState] = useState(true);

    const fileRef = useRef(null);
    const canvasRef = useRef(null);
    const hasLoadedControls = useRef(false);

    const [bgTasks, setBgTasks] = useState([]);
    const [showBgTasksDropdown, setShowBgTasksDropdown] = useState(false);

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

        // Slow and premium progress bar simulation for AI timing
        let progressVal = 5;
        const interval = setInterval(() => {
            progressVal = Math.min(95, progressVal + Math.floor(Math.random() * 6) + 2);
            setBgTasks(prev => prev.map(t => t.id === taskId ? { ...t, progress: progressVal } : t));
        }, 1200);

        // Execute the Promise task in background
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

    const user = currentUser || state.user;
    const activeProject = state.activeProject;

    // ===== DYNAMIC CREDIT PRICING =====
    const [creditPricing, setCreditPricing] = useState({ upload: 0, extract: 50, seamless: 80, repeat: 10, upscale: 60, vectorize: 100, export: 0, inspire: 50, mappings: 50 });

    useEffect(() => {
        fetch(`${API}/api/credit-pricing`)
            .then(r => r.json())
            .then(d => { if (d.success && d.pricing) setCreditPricing(d.pricing); })
            .catch(() => { });
    }, []);

    // Update user credits from any generation API response
    const updateCreditsFromResponse = (responseData) => {
        if (responseData && responseData.creditsUsed !== undefined) {
            setState(prev => ({
                ...prev,
                user: { ...prev.user, creditsUsed: responseData.creditsUsed, creditsLimit: responseData.creditsLimit }
            }));
        }
    };

    // ===== BRAND PALETTES STATE =====
    const [brandPalettes, setBrandPalettes] = useState([]);
    const [brandPalettesLoading, setBrandPalettesLoading] = useState(false);
    const [newPaletteName, setNewPaletteName] = useState('');
    const [newPaletteColors, setNewPaletteColors] = useState(['#000000', '#ffffff']);
    const [isSavingPalette, setIsSavingPalette] = useState(false);

    const fetchBrandPalettes = useCallback(() => {
        if (!activeProject?.id) return;
        setBrandPalettesLoading(true);
        fetch(`${API}/api/brand-palettes?projectId=${activeProject.id}`)
            .then(r => r.json())
            .then(d => {
                if (d.palettes) setBrandPalettes(d.palettes);
                setBrandPalettesLoading(false);
            })
            .catch(() => setBrandPalettesLoading(false));
    }, [activeProject?.id]);

    useEffect(() => {
        if (activeProject?.id) fetchBrandPalettes();
    }, [fetchBrandPalettes, activeProject?.id]);

    const saveBrandPalette = async () => {
        if (!newPaletteName.trim() || newPaletteColors.length === 0) return;
        setIsSavingPalette(true);
        try {
            const res = await fetch(`${API}/api/brand-palettes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: activeProject.id,
                    name: newPaletteName,
                    colors: newPaletteColors
                })
            });
            const data = await res.json();
            if (data.success) {
                setNewPaletteName('');
                setNewPaletteColors(['#000000', '#ffffff']);
                fetchBrandPalettes();
            } else {
                setError(data.error || 'Failed to save palette');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setIsSavingPalette(false);
        }
    };

    const deleteBrandPalette = async (id) => {
        if (!window.confirm('Delete this brand palette?')) return;
        try {
            const res = await fetch(`${API}/api/brand-palettes/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                fetchBrandPalettes();
            } else {
                setError(data.error || 'Failed to delete palette');
            }
        } catch (e) {
            setError(e.message);
        }
    };

    // ===== ADMIN WORKSPACE STATE =====
    const [adminUsers, setAdminUsers] = useState([]);
    const [adminUsersLoading, setAdminUsersLoading] = useState(false);
    const [adminSelectedUserId, setAdminSelectedUserId] = useState(null);
    const [creditAdjustmentAmount, setCreditAdjustmentAmount] = useState(5000);
    const [creditFeedback, setCreditFeedback] = useState('');
    const [replicateLogs, setReplicateLogs] = useState([]);
    const [replicateLogsLoading, setReplicateLogsLoading] = useState(false);

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
    }, [adminSelectedUserId]);

    useEffect(() => {
        if (isAdmin && (tool === 'admin-users' || tool === 'admin-credits')) fetchAdminUsers();
    }, [tool, fetchAdminUsers]);

    useEffect(() => {
        if (tool === 'admin-logs') {
            setReplicateLogsLoading(true);
            fetch(`${API}/api/admin/logs`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
                .then(r => r.json())
                .then(d => {
                    if (d.success && d.replicateLogs) {
                        setReplicateLogs(d.replicateLogs);
                    }
                })
                .catch(err => console.error('Failed to fetch admin logs:', err))
                .finally(() => setReplicateLogsLoading(false));
        }
    }, [tool]);

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
    }, [tool]);

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

    const [prompt, setPrompt] = useState('');
    const [creativity, setCreativity] = useState(3);
    const [variants, setVariants] = useState(3);
    const [inspireColors, setInspireColors] = useState(['#94b09e', '#e7dec2', '#dca5a2']);
    const [inspireStyle, setInspireStyle] = useState('All Styles');
    const [generatedVariations, setGeneratedVariations] = useState([]);
    const [analysis, setAnalysis] = useState(null);
    const [isDesc, setIsDesc] = useState(false);
    const [isGen, setIsGen] = useState(false);

    const [enhScale, setEnhScale] = useState(4);
    const [isEnh, setIsEnh] = useState(false);
    const [enhUrl, setEnhUrl] = useState(null);

    const [vecEngine, setVecEngine] = useState('api');
    const [vecColors, setVecColors] = useState(32);
    const [vecIsolate, setVecIsolate] = useState(false);
    const [isVec, setIsVec] = useState(false);
    const [vecUrl, setVecUrl] = useState(null);

    const [repeatUrl, setRepeatUrl] = useState(null);
    const [repeatMaskUrl, setRepeatMaskUrl] = useState(null);
    const [isRepeat, setIsRepeat] = useState(false);

    const [upscaleFactor, setUpscaleFactor] = useState('x4');
    const [isUpscaling, setIsUpscaling] = useState(false);
    const [upscaleUrl, setUpscaleUrl] = useState(null);

    const [isSeamless, setIsSeamless] = useState(false);
    const [seamlessProgress, setSeamlessProgress] = useState(0);
    const [seamlessStatus, setSeamlessStatus] = useState('');

    useEffect(() => {
        if (isSeamless) {
            setSeamlessProgress(0);
            setSeamlessStatus('Assessing seams...');
            const startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                let progress = 0;
                let status = '';
                if (elapsed < 2) {
                    progress = (elapsed / 2) * 5;
                    status = 'Assessing seams...';
                } else if (elapsed < 5) {
                    progress = 5 + ((elapsed - 2) / 3) * 10;
                    status = 'Applying geometric fixes...';
                } else if (elapsed < 35) {
                    progress = 15 + ((elapsed - 5) / 30) * 40;
                    status = 'Generating AI patches (Tier 1)...';
                } else if (elapsed < 65) {
                    progress = 55 + ((elapsed - 35) / 30) * 35;
                    status = 'Refining seams (Tier 2)...';
                } else {
                    progress = 90 + Math.min(9, (elapsed - 65) / 10);
                    status = 'Finalizing guarantee step...';
                }
                setSeamlessProgress(Math.min(99, progress));
                setSeamlessStatus(status);
            }, 200);
            return () => clearInterval(interval);
        } else {
            setSeamlessProgress(100);
            setSeamlessStatus('Complete!');
            const t = setTimeout(() => {
                setSeamlessProgress(0);
                setSeamlessStatus('');
            }, 2000);
            return () => clearTimeout(t);
        }
    }, [isSeamless]);
    const [seamlessUrl, setSeamlessUrl] = useState(null);
    const [seamlessMode, setSeamlessMode] = useState('generate'); // 'generate' (FSTL text-to-image) or 'fix' (offset+inpaint)
    const [seamlessPrompt, setSeamlessPrompt] = useState('');
    const [seamlessTiles, setSeamlessTiles] = useState([]);

    // ===== COLORWAYS =====
    const [cwExtractedPalette, setCwExtractedPalette] = useState([]);
    const [cwTargetPalette, setCwTargetPalette] = useState([]);
    const [cwUrl, setCwUrl] = useState(null);
    const [isCwExtracting, setIsCwExtracting] = useState(false);
    const [isCwRecoloring, setIsCwRecoloring] = useState(false);
    const [cwVariations, setCwVariations] = useState([]);

    // ===== PRINT ADVISOR =====
    const [printAdvisorResult, setPrintAdvisorResult] = useState(null);
    const [isPrintAdvisorLoading, setIsPrintAdvisorLoading] = useState(false);
    const [printAdvisorFabric, setPrintAdvisorFabric] = useState('cotton');
    const [printAdvisorVolume, setPrintAdvisorVolume] = useState(500);

    const analyzePrintMethod = async () => {
        if (!uploaded) return;
        setIsPrintAdvisorLoading(true);
        setPrintAdvisorResult(null);
        setError('');
        try {
            const res = await fetch(`${API}/api/print-advisor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    fabricType: printAdvisorFabric,
                    productionVolume: printAdvisorVolume,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                setPrintAdvisorResult(d.analysis);
            } else {
                throw new Error(d.error || 'Analysis failed');
            }
        } catch (e) {
            setError(e.message || 'Print analysis failed');
        } finally {
            setIsPrintAdvisorLoading(false);
        }
    };

    // ===== COLORWAY MANAGER =====
    const [cwmPalette, setCwmPalette] = useState([]);
    const [cwmColorways, setCwmColorways] = useState([]);
    const [cwmLockedColors, setCwmLockedColors] = useState(new Set());
    const [cwmStrategy, setCwmStrategy] = useState('complementary');
    const [isCwmGenerating, setIsCwmGenerating] = useState(false);
    const [isCwmExporting, setIsCwmExporting] = useState(false);

    const cwmExtractPalette = async () => {
        if (!uploaded) return;
        setIsCwmGenerating(true);
        setError('');
        try {
            const res = await fetch(`${API}/api/extract-palette`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: uploaded.filename, numColors: 6 }),
            });
            const d = await res.json();
            if (d.success) {
                setCwmPalette(d.palette);
                setCwmColorways([]);
                setCwmLockedColors(new Set());
            }
        } catch (e) {
            setError('Failed to extract palette');
        } finally {
            setIsCwmGenerating(false);
        }
    };

    const cwmGenerateColorways = async () => {
        if (!uploaded || cwmPalette.length === 0) return;
        setIsCwmGenerating(true);
        setError('');
        try {
            const res = await fetch(`${API}/api/colorways/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    palette: cwmPalette.map(p => p.hex),
                    lockedIndices: Array.from(cwmLockedColors),
                    strategy: cwmStrategy,
                    count: 4,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                setCwmColorways(d.colorways);
                updateCreditsFromResponse(d);
            } else {
                throw new Error(d.error || 'Generation failed');
            }
        } catch (e) {
            setError(e.message || 'Colorway generation failed');
        } finally {
            setIsCwmGenerating(false);
        }
    };

    const cwmExportLineCard = async () => {
        if (cwmColorways.length === 0) return;
        setIsCwmExporting(true);
        try {
            const res = await fetch(`${API}/api/colorways/export-linecard`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded?.filename,
                    colorways: cwmColorways,
                    basePalette: cwmPalette.map(p => p.hex),
                    projectId: activeProject.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                const link = document.createElement('a');
                link.href = `${API}${d.pdfUrl}`;
                link.download = 'colorway_linecard.pdf';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        } catch (e) {
            setError('Export failed');
        } finally {
            setIsCwmExporting(false);
        }
    };

    // ===== MEASUREMENT TOOL =====
    const [measureUnit, setMeasureUnit] = useState('inches');
    const [measureDpi, setMeasureDpi] = useState(300);
    const [measureShowRuler, setMeasureShowRuler] = useState(true);
    const [measureShowGrid, setMeasureShowGrid] = useState(false);

    // ===== MAPPINGS =====
    const MAPPING_CATEGORIES = [
        { id: 'home', label: 'Home', desc: 'Bedding, decor, kitchen', icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
        { id: 'apparel', label: 'Apparel', desc: 'Clothing, fashion, wear', icon: 'M20.38 3.46L16 2 12 5.5 8 2 3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47c.06.37.29.7.62.89L8 12.75V21h8v-8.25l4.52-2.7c.33-.19.56-.52.62-.89l.58-3.47a2 2 0 00-1.34-2.23z' },
        { id: 'accessories', label: 'Accessories', desc: 'Bags, cases, small items', icon: 'M20 7h-4V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v3H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM10 4h4v3h-4V4z' },
        { id: 'wall_art', label: 'Wall Art', desc: 'Frames, canvases, decor', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
        { id: 'other', label: 'Other', desc: 'Custom products', icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
    ];
    const MAPPING_PRODUCTS = {
        home: [
            { id: 'bed_sheet', name: 'Bed Sheet', image: '/products/bed_sheet.png' },
            { id: 'pillow_cover', name: 'Pillow Cover', image: '/products/pillow_cover.png' },
            { id: 'comforter', name: 'Comforter', image: '/products/comforter.png' },
            { id: 'cushion', name: 'Cushion', image: '/products/cushion.png' },
        ],
        apparel: [
            { id: 'tshirt', name: 'T-Shirt', image: '/products/tshirt.png' },
        ],
        accessories: [
            { id: 'tote_bag', name: 'Tote Bag', image: '/products/tote_bag.png' },
        ],
        wall_art: [
            { id: 'cushion', name: 'Canvas Print', image: '/products/cushion.png' },
        ],
        other: [],
    };

    const [mappingStep, setMappingStep] = useState(1);
    const [mappingPrint, setMappingPrint] = useState(null); // { file, filename, url }
    const [mappingPrintPreview, setMappingPrintPreview] = useState(null);
    const [mappingCategory, setMappingCategory] = useState('home');
    const [mappingSelectedProducts, setMappingSelectedProducts] = useState(new Set());
    const [mappingControls, setMappingControls] = useState({ scale: 120, posX: 10, posY: -5, rotate: 0, flipH: false, flipV: false });
    const [mappingResults, setMappingResults] = useState([]);
    const [isMappingGenerating, setIsMappingGenerating] = useState(false);
    const [mappingProductSearch, setMappingProductSearch] = useState('');
    const mapFileRef = useRef(null);

    const handleMappingUpload = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => setMappingPrintPreview(e.target.result);
        reader.readAsDataURL(file);
        const fd = new FormData();
        fd.append('image', file);
        fetch(`${API}/api/upload`, { method: 'POST', body: fd })
            .then(r => r.json())
            .then(d => {
                if (d.success) setMappingPrint({ file, filename: d.filename, url: d.url });
            })
            .catch(() => setError('Upload failed'));
    };

    const toggleMappingProduct = (productId) => {
        setMappingSelectedProducts(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId); else next.add(productId);
            return next;
        });
    };

    const generateMockups = async () => {
        if (!mappingPrint?.filename || mappingSelectedProducts.size === 0) return;
        setIsMappingGenerating(true);
        setMappingResults([]);
        setError('');

        const trigger = async () => {
            const r = await fetch(`${API}/api/generate-mockups-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patternFilename: mappingPrint.filename,
                    products: Array.from(mappingSelectedProducts),
                    category: mappingCategory,
                    projectId: activeProject.id,
                }),
            });
            const d = await r.json();
            if (d.success && d.mockups) {
                setMappingResults(d.mockups);
                setMappingStep(4);
                setIsMappingGenerating(false);
                return { url: d.mockups[0]?.mockupUrl, urls: d.mockups.map(m => m.mockupUrl) };
            } else {
                setIsMappingGenerating(false);
                throw new Error(d.error || 'Failed to generate mockups');
            }
        };

        addBgTask('mappings', `Apparel Mapping: ${mappingSelectedProducts.size} item(s)`, mappingPrint.filename, trigger);
    };
    // ===== END MAPPINGS =====

    // ===== COLORWAYS FUNCTIONS =====
    const extractColors = async () => {
        if (!uploaded) return;
        setIsCwExtracting(true);
        try {
            const res = await fetch(`${API}/api/extract-palette`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: uploaded.filename, numColors: 5 }),
            });
            const d = await res.json();
            if (d.success) {
                setCwExtractedPalette(d.palette);
                setCwTargetPalette(d.palette.map(p => ({ old: p.hex, new: p.hex })));
            } else {
                throw new Error(d.error);
            }
        } catch (e) {
            setError(e.message || 'Failed to extract colors');
        } finally {
            setIsCwExtracting(false);
        }
    };

    const generateColorway = async () => {
        if (!uploaded || cwTargetPalette.length === 0) return;
        setIsCwRecoloring(true);
        setError('');

        const trigger = async () => {
            const r = await fetch(`${API}/api/recolor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    colorMapping: cwTargetPalette,
                    projectId: activeProject.id,
                    userId: user.id
                }),
            });
            const d = await r.json();
            if (d.success) {
                setCwUrl(d.resultUrl);
                updateCreditsFromResponse(d);
                setCwVariations(prev => [{ url: d.resultUrl, targetPalette: [...cwTargetPalette] }, ...prev]);
                return { url: d.resultUrl };
            } else {
                throw new Error(d.error || 'Recolor failed');
            }
        };
        addBgTask('colorways', 'Colorway Generation', uploaded.filename, trigger);
        setIsCwRecoloring(false);
    };
    // ===== END COLORWAYS FUNCTIONS =====

    // ===== VECTOR PRO (Pantone / Color Reduction) =====
    const [vpTab, setVpTab] = useState('reduce');
    const [vpNumColors, setVpNumColors] = useState(6);
    const [vpReducedUrl, setVpReducedUrl] = useState(null);
    const [vpPalette, setVpPalette] = useState([]);
    const [isVpReducing, setIsVpReducing] = useState(false);
    const [vpLookupHex, setVpLookupHex] = useState('#ff6f61');
    const [vpLookupResults, setVpLookupResults] = useState([]);
    const [isVpLooking, setIsVpLooking] = useState(false);
    const [vpBrandPaletteId, setVpBrandPaletteId] = useState('');

    const reduceColors = async () => {
        if (!uploaded) return;
        setIsVpReducing(true);
        setError('');
        try {
            const res = await fetch(`${API}/api/color-reduce`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    numColors: vpNumColors,
                    projectId: activeProject.id,
                    userId: user.id,
                    brandPaletteId: vpBrandPaletteId ? parseInt(vpBrandPaletteId) : null
                }),
            });
            const d = await res.json();
            if (d.success) {
                setVpReducedUrl(d.resultUrl);
                setVpPalette(d.palette);
                updateCreditsFromResponse(d);
            } else {
                throw new Error(d.error);
            }
        } catch (e) {
            setError(e.message || 'Color reduction failed');
        } finally {
            setIsVpReducing(false);
        }
    };

    const lookupPantone = async (hexVal) => {
        setIsVpLooking(true);
        try {
            const res = await fetch(`${API}/api/pantone-match`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hex: hexVal }),
            });
            const d = await res.json();
            if (d.success) {
                setVpLookupResults(d.matches);
            }
        } catch (e) {
            setError('Pantone lookup failed');
        } finally {
            setIsVpLooking(false);
        }
    };
    const [layerExportLoading, setLayerExportLoading] = useState(null);
    const exportLayers = async (format) => {
        if (!uploaded) return;
        setLayerExportLoading(format);
        setError('');
        try {
            const res = await fetch(`${API}/api/layer-export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    numColors: vpNumColors,
                    format,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                updateCreditsFromResponse(d);
                const link = document.createElement('a');
                link.href = `${API}${d.resultUrl}`;
                link.download = `layers_${uploaded.filename.replace(/\.[^.]+$/, '')}.${format === 'zip' ? 'zip' : 'tiff'}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                throw new Error(d.error);
            }
        } catch (e) {
            setError(e.message || 'Layer export failed');
        } finally {
            setLayerExportLoading(null);
        }
    };
    // ===== END VECTOR PRO =====

    // ===== IMAGE LAYERS (Interactive Editor) =====
    const [imageLayersResults, setImageLayersResults] = useState([]);
    const [isImageLayering, setIsImageLayering] = useState(false);
    const [imageLayersNumLayers, setImageLayersNumLayers] = useState(4);
    const [imageLayersDescription, setImageLayersDescription] = useState('auto');

    // New states for interactive editor
    const fabricCanvasRef = useRef(null);
    const canvasInstanceRef = useRef(null);
    const baseCanvasLayoutRef = useRef(null);
    const [layersList, setLayersList] = useState([]);
    const [selectedLayerId, setSelectedLayerId] = useState(null);
    const [layerCanvasZoom, setLayerCanvasZoom] = useState(1);
    const [layerDragState, setLayerDragState] = useState({ draggingId: null, overId: null, position: null });
    const [isExportingLayers, setIsExportingLayers] = useState(false);
    const [isLayerMaskMode, setIsLayerMaskMode] = useState(false);
    const [layerMaskBrushSize, setLayerMaskBrushSize] = useState(32);
    const [isInpaintingLayer, setIsInpaintingLayer] = useState(false);
    const [isImageLayersFullscreen, setIsImageLayersFullscreen] = useState(false);

    // AI Edit states
    const [layerEditPrompt, setLayerEditPrompt] = useState('');
    const [isEditingLayer, setIsEditingLayer] = useState(false);
    const [editType, setEditType] = useState('recolor'); // recolor | revise | replace | freeform

    // Qwen recursive decomposition
    const [recursiveLayerCount, setRecursiveLayerCount] = useState(4);
    const [isProcessingAI, setIsProcessingAI] = useState(false);
    const [aiProcessingText, setAiProcessingText] = useState('');
    const qwenLayerDemoActions = [
        {
            label: 'Edit Text',
            type: 'revise',
            prompt: 'Change the selected text to "Qwen-Image"',
            icon: 'M4 7V4h16v3M9 20h6M12 4v16',
        },
        {
            label: 'Replace',
            type: 'replace',
            prompt: 'Replace the selected object with a friendly dog',
            icon: 'M7 7h10v10H7zM3 12h4M17 12h4M12 3v4M12 17v4',
        },
        {
            label: 'Recolor',
            type: 'recolor',
            prompt: 'Recolor the selected layer to cyan and violet',
            icon: 'M12 22a7 7 0 007-7c0-5-7-13-7-13S5 10 5 15a7 7 0 007 7z',
        },
        {
            label: 'Remove',
            type: 'remove',
            prompt: '',
            icon: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
        },
        {
            label: 'Decompose',
            type: 'decompose',
            prompt: '',
            icon: 'M12 2L2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5',
        },
        {
            label: 'Inpaint',
            type: 'inpaint',
            prompt: 'Change only the painted area',
            icon: 'M3 21v-4l11-11 4 4L7 21H3zM14 6l2-2a2 2 0 012.8 0l1.2 1.2a2 2 0 010 2.8l-2 2',
        },
    ];

    const generateImageLayers = async () => {
        if (!uploaded) return;
        setIsImageLayering(true);
        setImageLayersResults([]);
        setLayersList([]);
        if (canvasInstanceRef.current) {
            canvasInstanceRef.current.clear();
        }
        setError('');

        const trigger = async () => {
            const r = await fetch(`${API}/api/image-layers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    numLayers: imageLayersNumLayers,
                    description: imageLayersDescription || 'auto',
                    outputFormat: 'png',
                    projectId: activeProject.id,
                    userId: user.id
                }),
            });
            const d = await r.json();
            if (d.success) {
                setImageLayersResults(d.layers);
                updateCreditsFromResponse(d);

                // Auto-caption layers in background
                const initialLayersList = d.layers.map((l, i) => ({
                    id: l.index,
                    name: `Layer ${l.index + 1}`,
                    url: l.url,
                    filename: l.filename,
                    x: l.x || 0,
                    y: l.y || 0,
                    width: l.width,
                    height: l.height,
                    sourceWidth: l.sourceWidth,
                    sourceHeight: l.sourceHeight,
                    visible: true,
                    locked: false,
                    fabricId: null,
                    loadingName: true
                }));
                setLayersList(initialLayersList);

                // Load into Fabric canvas
                setTimeout(() => {
                    initFabricCanvas(d.layers);
                }, 100);
                setIsImageLayering(false);

                // Fetch captions async
                d.layers.forEach(async (layer) => {
                    try {
                        const capRes = await fetch(`${API}/api/caption-layer`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename: layer.filename })
                        });
                        const capData = await capRes.json();
                        if (capData.success) {
                            setLayersList(prev => prev.map(pl =>
                                pl.id === layer.index ? { ...pl, name: capData.name, loadingName: false } : pl
                            ));
                        }
                    } catch (e) {
                        console.error("Caption error", e);
                        setLayersList(prev => prev.map(pl =>
                            pl.id === layer.index ? { ...pl, loadingName: false } : pl
                        ));
                    }
                });

                return { url: d.layers[0]?.url, urls: d.layers.map(l => l.url) };
            } else {
                setIsImageLayering(false);
                throw new Error(d.error || 'Image layer decomposition failed');
            }
        };
        addBgTask('imagelayers', `Image Layers: ${imageLayersNumLayers} layers`, uploaded.filename, trigger);
    };

    const initFabricCanvas = (layers) => {
        if (!fabricCanvasRef.current) return;
        if (canvasInstanceRef.current) {
            canvasInstanceRef.current.dispose();
        }

        const parent = fabricCanvasRef.current.parentElement;
        const w = parent ? parent.clientWidth : 800;
        const h = parent ? parent.clientHeight : 600;

        const canvas = new fabric.Canvas(fabricCanvasRef.current, {
            width: w,
            height: h,
            preserveObjectStacking: true, // Keep z-index when selected
        });
        canvasInstanceRef.current = canvas;
        setLayerCanvasZoom(1);
        setIsLayerMaskMode(false);

        const centerLoadedLayerGroup = () => {
            const imageObjects = canvas.getObjects().filter(obj => obj.type === 'image');
            if (!imageObjects.length) return;

            const bounds = imageObjects.reduce((acc, obj) => {
                const rect = obj.getBoundingRect();
                return {
                    minX: Math.min(acc.minX, rect.left),
                    minY: Math.min(acc.minY, rect.top),
                    maxX: Math.max(acc.maxX, rect.left + rect.width),
                    maxY: Math.max(acc.maxY, rect.top + rect.height),
                };
            }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

            if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return;

            const groupWidth = bounds.maxX - bounds.minX;
            const groupHeight = bounds.maxY - bounds.minY;
            const offsetX = (canvas.getWidth() - groupWidth) / 2 - bounds.minX;
            const offsetY = (canvas.getHeight() - groupHeight) / 2 - bounds.minY;

            imageObjects.forEach((obj) => {
                obj.set({
                    left: obj.left + offsetX,
                    top: obj.top + offsetY,
                    initialLeft: obj.left + offsetX,
                    initialTop: obj.top + offsetY,
                    initialScaleX: obj.scaleX,
                    initialScaleY: obj.scaleY,
                    initialAngle: obj.angle || 0,
                });
                obj.setCoords();
            });
        };

        canvas.on('mouse:wheel', (opt) => {
            const delta = opt.e.deltaY;
            let zoom = canvas.getZoom();
            zoom *= 0.999 ** delta;
            zoom = Math.max(0.25, Math.min(zoom, 5));
            canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            setLayerCanvasZoom(Number(zoom.toFixed(2)));
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });
        // Selection sync
        canvas.on('selection:created', (e) => {
            if (e.selected && e.selected.length > 0) {
                setSelectedLayerId(e.selected[0].customId);
            }
        });
        canvas.on('selection:updated', (e) => {
            if (e.selected && e.selected.length > 0) {
                setSelectedLayerId(e.selected[0].customId);
            }
        });
        canvas.on('selection:cleared', () => {
            setSelectedLayerId(null);
        });
        canvas.on('path:created', (e) => {
            if (e.path) {
                e.path.set({
                    customType: 'inpaintMask',
                    selectable: false,
                    evented: false,
                    excludeFromExport: true,
                    stroke: 'rgba(103, 232, 249, 0.55)',
                    fill: null,
                });
                e.path.setCoords();
                canvas.renderAll();
            }
        });

        const sourceWidth = Math.max(...layers.map(l => l.sourceWidth || l.width || 1), 1);
        const sourceHeight = Math.max(...layers.map(l => l.sourceHeight || l.height || 1), 1);
        const bounds = layers.reduce((acc, layer) => {
            const x = Number.isFinite(Number(layer.x)) ? Number(layer.x) : 0;
            const y = Number.isFinite(Number(layer.y)) ? Number(layer.y) : 0;
            const width = Math.max(1, Number(layer.width || layer.sourceWidth || 1));
            const height = Math.max(1, Number(layer.height || layer.sourceHeight || 1));
            return {
                minX: Math.min(acc.minX, x),
                minY: Math.min(acc.minY, y),
                maxX: Math.max(acc.maxX, x + width),
                maxY: Math.max(acc.maxY, y + height),
            };
        }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const contentLeft = Number.isFinite(bounds.minX) ? bounds.minX : 0;
        const contentTop = Number.isFinite(bounds.minY) ? bounds.minY : 0;
        const contentWidth = Math.max(1, (Number.isFinite(bounds.maxX) ? bounds.maxX : sourceWidth) - contentLeft);
        const contentHeight = Math.max(1, (Number.isFinite(bounds.maxY) ? bounds.maxY : sourceHeight) - contentTop);
        const padding = 40;
        const baseScale = Math.min((w - padding) / contentWidth, (h - padding) / contentHeight, 1);
        const baseLeft = (w - contentWidth * baseScale) / 2 - contentLeft * baseScale;
        const baseTop = (h - contentHeight * baseScale) / 2 - contentTop * baseScale;
        baseCanvasLayoutRef.current = { sourceWidth, sourceHeight, contentLeft, contentTop, contentWidth, contentHeight, baseScale, baseLeft, baseTop };
        // Load images
        let loadedCount = 0;
        layers.forEach((layer) => {
            fabric.Image.fromURL(`${API}${layer.url}`, { crossOrigin: 'anonymous' }).then((img) => {
                if (!canvasInstanceRef.current) return;
                const layerLeft = baseLeft + (layer.x || 0) * baseScale;
                const layerTop = baseTop + (layer.y || 0) * baseScale;

                img.set({
                    customId: layer.index,
                    left: layerLeft,
                    top: layerTop,
                    scaleX: baseScale,
                    scaleY: baseScale,
                    initialLeft: layerLeft,
                    initialTop: layerTop,
                    initialScaleX: baseScale,
                    initialScaleY: baseScale,
                    initialAngle: 0,
                    transparentCorners: false,
                    cornerColor: 'rgba(139, 92, 246, 0.8)',
                    borderColor: 'rgba(139, 92, 246, 0.8)',
                    cornerSize: 8,
                });

                canvas.add(img);
                img.setCoords();

                setLayersList(prev => prev.map(pl =>
                    pl.id === layer.index ? { ...pl, fabricId: img } : pl
                ));

                loadedCount++;
                if (loadedCount === layers.length) {
                    // Ensure they are ordered by index
                    const objs = canvas.getObjects();
                    objs.sort((a, b) => a.customId - b.customId);
                    objs.forEach(o => { canvas.remove(o); canvas.add(o); });
                    centerLoadedLayerGroup();
                    canvas.renderAll();
                }
            }).catch(err => console.error("Error loading fabric image", err));
        });
    };

    const handleEditLayer = async () => {
        if (!selectedLayerId && selectedLayerId !== 0) return;
        if (editType === 'inpaint') {
            handleInpaintLayer();
            return;
        }
        if (editType === 'remove') {
            applyCanvasTransform('delete');
            setLayerEditPrompt('');
            return;
        }
        if (editType === 'decompose') {
            handleRecursiveDecompose();
            return;
        }
        if (!layerEditPrompt) return;

        const layerData = layersList.find(l => l.id === selectedLayerId);
        if (!layerData) return;

        setIsEditingLayer(true);
        try {
            const res = await fetch(`${API}/api/edit-layer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: layerData.filename,
                    prompt: layerEditPrompt,
                    editType: editType,
                    projectId: activeProject.id,
                    userId: user.id
                })
            });
            const d = await res.json();
            if (d.success) {
                updateCreditsFromResponse(d);
                // Replace image on canvas
                const canvas = canvasInstanceRef.current;
                const objToReplace = canvas.getObjects().find(o => o.customId === selectedLayerId);
                if (objToReplace) {
                    const oldZIndex = canvas.getObjects().indexOf(objToReplace);
                    fabric.Image.fromURL(`${API}${d.resultUrl}?t=${Date.now()}`, { crossOrigin: 'anonymous' }).then((newImg) => {
                        newImg.set({
                            customId: selectedLayerId,
                            left: objToReplace.left,
                            top: objToReplace.top,
                            scaleX: objToReplace.scaleX,
                            scaleY: objToReplace.scaleY,
                            angle: objToReplace.angle,
                            flipX: objToReplace.flipX,
                            flipY: objToReplace.flipY,
                            initialLeft: objToReplace.initialLeft,
                            initialTop: objToReplace.initialTop,
                            initialScaleX: objToReplace.initialScaleX,
                            initialScaleY: objToReplace.initialScaleY,
                            initialAngle: objToReplace.initialAngle || 0,
                            transparentCorners: false,
                            cornerColor: 'rgba(139, 92, 246, 0.8)',
                            borderColor: 'rgba(139, 92, 246, 0.8)',
                            cornerSize: 8,
                        });
                        canvas.remove(objToReplace);
                        canvas.insertAt(oldZIndex, newImg);
                        canvas.setActiveObject(newImg);
                        canvas.renderAll();

                        // Update layers list url
                        setLayersList(prev => prev.map(pl =>
                            pl.id === selectedLayerId ? { ...pl, url: d.resultUrl, filename: d.resultUrl.split('/').pop() } : pl
                        ));
                    }).catch(err => console.error("Error editing fabric layer", err));
                }
            } else {
                alert(d.error || 'Layer edit failed');
            }
        } catch (e) {
            console.error(e);
            alert('Error editing layer');
        } finally {
            setIsEditingLayer(false);
        }
    };

    const handleRecursiveDecompose = async () => {
        if (!selectedLayerId && selectedLayerId !== 0) {
            alert('Select a layer to decompose further.');
            return;
        }
        const layerData = layersList.find(l => l.id === selectedLayerId);
        const canvas = canvasInstanceRef.current;
        const sourceObj = canvas?.getObjects().find(o => o.customId === selectedLayerId);
        if (!layerData || !canvas || !sourceObj) return;
        setIsProcessingAI(true);
        setAiProcessingText(`Qwen is decomposing "${layerData.name}" into ${recursiveLayerCount} layers...`);
        try {
            const res = await fetch(`${API}/api/image-layers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: layerData.filename,
                    numLayers: recursiveLayerCount,
                    description: imageLayersDescription || layerData.name || 'auto',
                    outputFormat: 'png',
                    projectId: activeProject.id,
                    userId: user.id
                })
            });
            const d = await res.json();
            if (!d.success) throw new Error(d.error || 'Recursive decomposition failed');
            updateCreditsFromResponse(d);
            const oldZIndex = canvas.getObjects().indexOf(sourceObj);
            const baseId = Math.max(0, ...layersList.map(l => l.id)) + 1;
            const childLayers = d.layers.map((layer, i) => ({
                id: baseId + i,
                name: `${layerData.name || 'Layer'} ${i + 1}`,
                url: layer.url,
                filename: layer.filename,
                x: layer.x || 0,
                y: layer.y || 0,
                width: layer.width,
                height: layer.height,
                sourceWidth: layer.sourceWidth,
                sourceHeight: layer.sourceHeight,
                visible: true,
                locked: false,
                fabricId: null,
                loadingName: true,
                parentId: selectedLayerId
            }));
            canvas.remove(sourceObj);
            setLayersList(prev => [...prev.filter(l => l.id !== selectedLayerId), ...childLayers]);
            setSelectedLayerId(childLayers[0]?.id ?? null);
            let loaded = 0;
            childLayers.forEach((child, i) => {
                fabric.Image.fromURL(`${API}${child.url}?t=${Date.now()}`, { crossOrigin: 'anonymous' }).then((img) => {
                    const childLeft = sourceObj.left + (child.x || 0) * sourceObj.scaleX;
                    const childTop = sourceObj.top + (child.y || 0) * sourceObj.scaleY;
                    img.set({
                        customId: child.id,
                        left: childLeft,
                        top: childTop,
                        scaleX: sourceObj.scaleX,
                        scaleY: sourceObj.scaleY,
                        angle: sourceObj.angle,
                        flipX: sourceObj.flipX,
                        flipY: sourceObj.flipY,
                        opacity: sourceObj.opacity,
                        initialLeft: childLeft,
                        initialTop: childTop,
                        initialScaleX: sourceObj.scaleX,
                        initialScaleY: sourceObj.scaleY,
                        initialAngle: sourceObj.angle,
                        transparentCorners: false,
                        cornerColor: 'rgba(103, 232, 249, 0.9)',
                        borderColor: 'rgba(103, 232, 249, 0.9)',
                        cornerSize: 8,
                    });
                    canvas.insertAt(oldZIndex + i, img);
                    loaded += 1;
                    if (loaded === childLayers.length) {
                        const firstChild = canvas.getObjects().find(o => o.customId === childLayers[0].id);
                        if (firstChild) canvas.setActiveObject(firstChild);
                        canvas.renderAll();
                    }
                    setLayersList(prev => prev.map(pl => pl.id === child.id ? { ...pl, fabricId: img } : pl));
                }).catch(err => console.error('Error loading recursive layer', err));
                fetch(`${API}/api/caption-layer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: child.filename })
                })
                    .then(r => r.json())
                    .then(capData => {
                        if (capData.success) {
                            setLayersList(prev => prev.map(pl =>
                                pl.id === child.id ? { ...pl, name: capData.name, loadingName: false } : pl
                            ));
                        }
                    })
                    .catch(() => {
                        setLayersList(prev => prev.map(pl =>
                            pl.id === child.id ? { ...pl, loadingName: false } : pl
                        ));
                    });
            });
        } catch (e) {
            console.error(e);
            alert(e.message || 'Error during recursive decomposition');
        } finally {
            setIsProcessingAI(false);
        }
    };
    const setImageLayerZoom = (nextZoom) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const zoom = Math.max(0.25, Math.min(nextZoom, 5));
        canvas.zoomToPoint({ x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 }, zoom);
        setLayerCanvasZoom(Number(zoom.toFixed(2)));
    };
    const resetImageLayerView = () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        setLayerCanvasZoom(1);
        canvas.renderAll();
    };
    const resetLayersToBase = () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        canvas.getObjects().forEach((obj) => {
            if (obj.type === 'image') {
                obj.set({
                    left: obj.initialLeft ?? obj.left,
                    top: obj.initialTop ?? obj.top,
                    scaleX: obj.initialScaleX ?? obj.scaleX,
                    scaleY: obj.initialScaleY ?? obj.scaleY,
                    angle: obj.initialAngle ?? 0,
                    flipX: false,
                    flipY: false,
                });
                obj.setCoords();
            }
        });
        canvas.discardActiveObject();
        setSelectedLayerId(null);
        canvas.renderAll();
    };

    useEffect(() => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;

        canvas.isDrawingMode = isLayerMaskMode;
        if (isLayerMaskMode) {
            const brush = new fabric.PencilBrush(canvas);
            brush.color = 'rgba(103, 232, 249, 0.55)';
            brush.width = layerMaskBrushSize;
            canvas.freeDrawingBrush = brush;
            canvas.discardActiveObject();
            canvas.selection = false;
        } else {
            canvas.selection = true;
        }
        canvas.renderAll();
    }, [isLayerMaskMode, layerMaskBrushSize]);

    const clearLayerMask = () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        canvas.getObjects()
            .filter(obj => obj.customType === 'inpaintMask')
            .forEach(obj => canvas.remove(obj));
        canvas.renderAll();
    };

    const resizeImageLayerCanvas = useCallback(() => {
        const canvas = canvasInstanceRef.current;
        const el = fabricCanvasRef.current;
        const parent = el?.parentElement;
        if (!canvas || !parent) return;

        const nextWidth = Math.max(320, parent.clientWidth);
        const nextHeight = Math.max(280, parent.clientHeight);
        const prevWidth = canvas.getWidth();
        const prevHeight = canvas.getHeight();
        const dx = (nextWidth - prevWidth) / 2;
        const dy = (nextHeight - prevHeight) / 2;

        canvas.setDimensions({ width: nextWidth, height: nextHeight });
        canvas.getObjects().forEach((obj) => {
            obj.set({
                left: (obj.left || 0) + dx,
                top: (obj.top || 0) + dy,
            });
            if (obj.initialLeft !== undefined) obj.initialLeft += dx;
            if (obj.initialTop !== undefined) obj.initialTop += dy;
            obj.setCoords();
        });
        canvas.renderAll();
    }, []);

    useEffect(() => {
        if (!canvasInstanceRef.current) return;
        const raf = requestAnimationFrame(resizeImageLayerCanvas);
        return () => cancelAnimationFrame(raf);
    }, [isImageLayersFullscreen, resizeImageLayerCanvas]);

    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape') setIsImageLayersFullscreen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', resizeImageLayerCanvas);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', resizeImageLayerCanvas);
        };
    }, [resizeImageLayerCanvas]);

    const exportLayerMaskDataUrl = () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return null;
        const maskObjects = canvas.getObjects().filter(obj => obj.customType === 'inpaintMask');
        if (!maskObjects.length) return null;

        const viewportTransform = canvas.viewportTransform ? [...canvas.viewportTransform] : [1, 0, 0, 1, 0, 0];
        const snapshots = canvas.getObjects().map(obj => ({
            obj,
            visible: obj.visible,
            stroke: obj.stroke,
            opacity: obj.opacity,
            globalCompositeOperation: obj.globalCompositeOperation,
        }));

        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.backgroundColor = '#000000';
        canvas.getObjects().forEach((obj) => {
            if (obj.customType === 'inpaintMask') {
                obj.set({ visible: true, stroke: '#ffffff', opacity: 1, globalCompositeOperation: 'source-over' });
            } else {
                obj.set({ visible: false });
            }
        });
        canvas.renderAll();

        const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 1 });

        snapshots.forEach(({ obj, visible, stroke, opacity, globalCompositeOperation }) => {
            obj.set({ visible, stroke, opacity, globalCompositeOperation });
        });
        canvas.backgroundColor = '';
        canvas.setViewportTransform(viewportTransform);
        canvas.renderAll();

        return dataUrl;
    };

    const syncLayersListToCanvasOrder = (canvas) => {
        const orderedIds = canvas.getObjects()
            .filter(o => o.customId !== undefined && o.customId !== null)
            .map(o => o.customId);

        setLayersList(prev => [...prev].sort((a, b) => {
            const aIndex = orderedIds.indexOf(a.id);
            const bIndex = orderedIds.indexOf(b.id);
            return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
                (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
        }));
    };

    const reorderLayerStack = (dragId, targetId, position = 'before') => {
        if (dragId === null || targetId === null || dragId === targetId) return;

        const canvas = canvasInstanceRef.current;
        const displayOrder = [...layersList].reverse();
        const draggedLayer = displayOrder.find(layer => layer.id === dragId);
        if (!draggedLayer || !displayOrder.some(layer => layer.id === targetId)) return;

        const remainingDisplayOrder = displayOrder.filter(layer => layer.id !== dragId);
        const targetIndex = remainingDisplayOrder.findIndex(layer => layer.id === targetId);
        if (targetIndex === -1) return;

        const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
        const nextDisplayOrder = [
            ...remainingDisplayOrder.slice(0, insertIndex),
            draggedLayer,
            ...remainingDisplayOrder.slice(insertIndex),
        ];
        const nextCanvasOrder = [...nextDisplayOrder].reverse();

        setLayersList(nextCanvasOrder);
        setSelectedLayerId(dragId);

        if (canvas) {
            const objectMap = new Map(canvas.getObjects()
                .filter(o => o.customId !== undefined && o.customId !== null)
                .map(o => [o.customId, o]));

            nextCanvasOrder.forEach((layer) => {
                const obj = objectMap.get(layer.id);
                if (obj) {
                    canvas.remove(obj);
                    canvas.add(obj);
                }
            });

            const activeObj = objectMap.get(dragId);
            if (activeObj) canvas.setActiveObject(activeObj);
            canvas.renderAll();
        }
    };

    const handleInpaintLayer = async () => {
        if (!selectedLayerId && selectedLayerId !== 0) return;
        if (!layerEditPrompt.trim()) {
            alert('Enter an inpaint instruction first.');
            return;
        }

        const canvas = canvasInstanceRef.current;
        const layerData = layersList.find(l => l.id === selectedLayerId);
        const objToReplace = canvas?.getObjects().find(o => o.customId === selectedLayerId);
        const maskDataUrl = exportLayerMaskDataUrl();

        if (!canvas || !layerData || !objToReplace) return;
        if (!maskDataUrl) {
            alert('Paint a mask on the canvas first.');
            return;
        }

        setIsInpaintingLayer(true);
        setIsProcessingAI(true);
        setAiProcessingText('Qwen is inpainting the painted mask...');

        try {
            const res = await fetch(`${API}/api/inpaint-layer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: layerData.filename,
                    prompt: layerEditPrompt,
                    mask: maskDataUrl,
                    canvasWidth: Math.round(canvas.getWidth()),
                    canvasHeight: Math.round(canvas.getHeight()),
                    transform: {
                        x: objToReplace.left || 0,
                        y: objToReplace.top || 0,
                        scaleX: objToReplace.scaleX || 1,
                        scaleY: objToReplace.scaleY || 1,
                        angle: objToReplace.angle || 0,
                        flipX: !!objToReplace.flipX,
                        flipY: !!objToReplace.flipY,
                        opacity: objToReplace.opacity ?? 1,
                    },
                    projectId: activeProject.id,
                    userId: user.id
                })
            });
            const d = await res.json();
            if (!d.success) throw new Error(d.error || 'Layer inpaint failed');
            updateCreditsFromResponse(d);

            const oldZIndex = canvas.getObjects().indexOf(objToReplace);

            fabric.Image.fromURL(`${API}${d.resultUrl}?t=${Date.now()}`, { crossOrigin: 'anonymous' }).then((newImg) => {
                newImg.set({
                    customId: selectedLayerId,
                    left: 0,
                    top: 0,
                    scaleX: 1,
                    scaleY: 1,
                    angle: 0,
                    flipX: false,
                    flipY: false,
                    initialLeft: 0,
                    initialTop: 0,
                    initialScaleX: 1,
                    initialScaleY: 1,
                    initialAngle: 0,
                    transparentCorners: false,
                    cornerColor: 'rgba(139, 92, 246, 0.8)',
                    borderColor: 'rgba(139, 92, 246, 0.8)',
                    cornerSize: 8,
                });
                canvas.remove(objToReplace);
                canvas.insertAt(oldZIndex, newImg);
                canvas.setActiveObject(newImg);
                clearLayerMask();
                canvas.renderAll();

                setLayersList(prev => prev.map(pl =>
                    pl.id === selectedLayerId
                        ? { ...pl, url: d.resultUrl, filename: d.resultUrl.split('/').pop(), width: d.width, height: d.height }
                        : pl
                ));
            }).catch(err => console.error('Error loading inpainted layer', err));
        } catch (e) {
            console.error(e);
            alert(e.message || 'Layer inpaint failed');
        } finally {
            setIsInpaintingLayer(false);
            setIsProcessingAI(false);
            setAiProcessingText('');
        }
    };

    const handleComposeLayers = async () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;

        const layerMap = new Map(layersList.map(layer => [layer.id, layer]));
        const payloadLayers = canvas.getObjects()
            .filter(obj => obj.customId !== undefined && obj.customId !== null)
            .map((obj) => {
                const layer = layerMap.get(obj.customId);
                return {
                    id: obj.customId,
                    name: layer?.name,
                    filename: layer?.filename,
                    x: obj.left || 0,
                    y: obj.top || 0,
                    scaleX: obj.scaleX || 1,
                    scaleY: obj.scaleY || 1,
                    angle: obj.angle || 0,
                    flipX: !!obj.flipX,
                    flipY: !!obj.flipY,
                    opacity: obj.opacity ?? 1,
                    visible: obj.visible !== false,
                };
            })
            .filter(layer => layer.filename);

        if (!payloadLayers.length) return;

        setIsExportingLayers(true);
        try {
            const res = await fetch(`${API}/api/compose-layers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    layers: payloadLayers,
                    width: Math.round(canvas.getWidth()),
                    height: Math.round(canvas.getHeight()),
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Layer export failed');
            updateCreditsFromResponse(data);

            const link = document.createElement('a');
            link.href = `${API}${data.resultUrl}`;
            link.download = data.resultUrl.split('/').pop() || 'composed_layers.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (e) {
            console.error(e);
            alert(e.message || 'Layer export failed');
        } finally {
            setIsExportingLayers(false);
        }
    };

    const applyCanvasTransform = (transformType) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const obj = canvas.getActiveObject();
        if (!obj) return;

        if (transformType === 'flipH') {
            obj.set('flipX', !obj.flipX);
        } else if (transformType === 'flipV') {
            obj.set('flipY', !obj.flipY);
        } else if (transformType === 'rotRight') {
            obj.rotate((obj.angle || 0) + 90);
        } else if (transformType === 'rotLeft') {
            obj.rotate((obj.angle || 0) - 90);
        } else if (transformType === 'delete') {
            canvas.remove(obj);
            setLayersList(prev => prev.filter(l => l.id !== obj.customId));
        } else if (transformType === 'front') {
            canvas.remove(obj);
            canvas.add(obj);
            syncLayersListToCanvasOrder(canvas);
        } else if (transformType === 'back') {
            canvas.remove(obj);
            canvas.insertAt(0, obj);
            syncLayersListToCanvasOrder(canvas);
        }
        canvas.renderAll();
    };

    const toggleLayerVisibility = (id) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const obj = canvas.getObjects().find(o => o.customId === id);
        if (obj) {
            const isVisible = obj.visible !== false;
            obj.set('visible', !isVisible);
            canvas.renderAll();
            setLayersList(prev => prev.map(l => l.id === id ? { ...l, visible: !isVisible } : l));
        }
    };

    const toggleLayerLock = (id) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const obj = canvas.getObjects().find(o => o.customId === id);
        if (obj) {
            const isLocked = obj.lockMovementX === true;
            obj.set({
                lockMovementX: !isLocked,
                lockMovementY: !isLocked,
                lockRotation: !isLocked,
                lockScalingX: !isLocked,
                lockScalingY: !isLocked,
                selectable: !isLocked,
                evented: !isLocked
            });
            if (!isLocked) canvas.discardActiveObject();
            canvas.renderAll();
            setLayersList(prev => prev.map(l => l.id === id ? { ...l, locked: !isLocked } : l));
        }
    };

    const selectLayerFromPanel = (id) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const obj = canvas.getObjects().find(o => o.customId === id);
        if (obj && !obj.lockMovementX) {
            canvas.setActiveObject(obj);
            canvas.renderAll();
        }
        setSelectedLayerId(id);
    };

    const applyQwenLayerDemo = (demo) => {
        setEditType(demo.type);
        setLayerEditPrompt(demo.prompt);

        if (selectedLayerId !== null || layersList.length === 0) return;

        const fallbackLayer = [...layersList].reverse().find(layer => layer.visible !== false && !layer.locked) || [...layersList].reverse()[0];
        if (fallbackLayer) selectLayerFromPanel(fallbackLayer.id);
    };
    // ===== END IMAGE LAYERS =====

    // ===== 3D MOCKUP =====
    const [mockup3dGarment, setMockup3dGarment] = useState('tshirt');
    const [mockup3dTileX, setMockup3dTileX] = useState(4);
    const [mockup3dTileY, setMockup3dTileY] = useState(4);
    const [mockup3dAutoRotate, setMockup3dAutoRotate] = useState(true);
    // ===== END 3D MOCKUP =====

    const [exportsList, setExportsList] = useState([]);
    const [isLoadingExports, setIsLoadingExports] = useState(false);
    const [selectedExports, setSelectedExports] = useState(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [exportsFilter, setExportsFilter] = useState('all'); // 'all' | 'image' | 'vector'
    const [exportsPage, setExportsPage] = useState(1);

    // Crop State
    const [cropFile, setCropFile] = useState(null);
    const [cropSrc, setCropSrc] = useState(null);
    const [cropConfig, setCropConfig] = useState();
    const [cropAction, setCropAction] = useState(null);
    const cropImageRef = useRef(null);

    const handlePreUpload = (file, actionType) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            setCropSrc(e.target.result);
            setCropFile(file);
            setCropAction(actionType);
            setCropConfig(undefined);
        };
        reader.readAsDataURL(file);
        if (fileRef.current) fileRef.current.value = '';
        if (pipelineFileRef.current) pipelineFileRef.current.value = '';
    };

    const applyCrop = async () => {
        if (cropImageRef.current && cropConfig?.width && cropConfig?.height) {
            const croppedFile = await getCroppedImg(cropImageRef.current, cropConfig, cropFile.name);
            if (cropAction === 'pipeline') handlePipelineUpload(croppedFile);
            else handleUpload(croppedFile);
        } else {
            if (cropAction === 'pipeline') handlePipelineUpload(cropFile);
            else handleUpload(cropFile);
        }
        cancelCrop();
    };

    const cancelCrop = () => {
        setCropSrc(null);
        setCropFile(null);
        setCropAction(null);
    };

    const filteredExports = useMemo(() => {
        if (exportsFilter === 'all') return exportsList;
        return exportsList.filter(f => f.type === exportsFilter);
    }, [exportsList, exportsFilter]);

    const loadExports = useCallback(() => {
        setIsLoadingExports(true);
        Promise.all([
            fetch(`${API}/api/exports`).then(res => res.json()),
            fetch(`${API}/api/pipeline-runs?project_id=${activeProject?.id || 1}`).then(res => res.json())
        ])
            .then(([exportsData, runsData]) => {
                if (exportsData.success) {
                    setExportsList(exportsData.exports);
                    setSelectedExports(new Set());
                    setExportsPage(1);
                }
                if (runsData.success) {
                    setPipelineRuns(runsData.runs);
                }
            })
            .catch(err => {
                console.error("Error loading exports or runs:", err);
                fetch(`${API}/api/exports`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            setExportsList(data.exports);
                            setSelectedExports(new Set());
                            setExportsPage(1);
                        }
                    });
            })
            .finally(() => setIsLoadingExports(false));
    }, [activeProject?.id]);

    useEffect(() => {
        if (tool === 'exports') loadExports();
    }, [tool, loadExports]);

    const toggleExportSelect = (id) => {
        setSelectedExports(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const selectAllExports = () => {
        const ids = filteredExports.map(f => f.id);
        if (ids.every(id => selectedExports.has(id))) {
            setSelectedExports(new Set());
        } else {
            setSelectedExports(new Set(ids));
        }
    };

    const deleteExports = async (filenames) => {
        if (!filenames.length) return;
        if (!window.confirm(`Delete ${filenames.length} file${filenames.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
        setIsDeleting(true);
        try {
            await fetch(`${API}/api/exports`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames }),
            });
            loadExports();
        } catch {
            setError('Failed to delete files.');
        } finally {
            setIsDeleting(false);
        }
    };

    const [techPackLoading, setTechPackLoading] = useState(null);
    const generateTechPack = async (filename) => {
        setTechPackLoading(filename);
        setError('');
        try {
            const res = await fetch(`${API}/api/tech-pack`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                updateCreditsFromResponse(d);
                // Trigger PDF download
                const link = document.createElement('a');
                link.href = `${API}${d.resultUrl}`;
                link.download = `techpack_${filename.replace(/\.[^.]+$/, '')}.pdf`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                throw new Error(d.error || 'Failed to generate tech pack');
            }
        } catch (e) {
            setError(e.message || 'Tech Pack generation failed');
        } finally {
            setTechPackLoading(null);
        }
    };

    // ===== PIPELINE STUDIO =====
    const STEP_TYPES = [
        { type: 'upload', label: 'Upload Artwork', desc: 'PNG, JPG up to 10MB', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12', credits: 0 },
        { type: 'extract', label: 'Pattern Extraction', desc: 'AI cleans & extracts pattern elements', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z', credits: 20 },
        { type: 'seamless', label: 'Seamless Fix', desc: 'Creates seamless, tileable pattern', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z', credits: 30 },
        { type: 'repeat', label: 'Repeat Set', desc: 'Generates repeat variations', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', credits: 10 },
        { type: 'upscale', label: 'High Resolution', desc: 'Upscale to 600 DPI print quality', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', credits: 40 },
        { type: 'vectorize', label: 'Vectorize', desc: 'Convert to scalable vector artwork', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', credits: 50 },
        { type: 'export', label: 'Export', desc: 'Choose formats & download', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', credits: 0 },
    ];

    const PIPELINE_TEMPLATES = [
        { id: 'extract', name: 'Pattern Extraction', desc: 'Extract patterns and clean artwork.', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z', steps: ['upload', 'extract', 'export'] },
        { id: 'seamless', name: 'Make Seamless', desc: 'Remove seams and create tileable patterns.', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z', steps: ['upload', 'seamless', 'export'] },
        { id: 'repeat', name: 'Repeat Set', desc: 'Generate half drop, brick, and more.', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', steps: ['upload', 'repeat', 'export'] },
        { id: 'upscale', name: 'Super Resolution', desc: 'Upscale for print with AI.', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', steps: ['upload', 'upscale', 'export'] },
        { id: 'vectorize', name: 'Vectorize', desc: 'Convert to scalable vector artwork.', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', steps: ['upload', 'vectorize', 'export'] },
        { id: 'full', name: 'Full Print Pipeline', desc: 'End-to-end workflow for print ready files.', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', steps: ['upload', 'extract', 'seamless', 'repeat', 'upscale', 'export'] },
    ];

    const getDefaultSettingsForStep = (type) => {
        if (type === 'repeat') return { gridSize: 3, repeatType: 'block' };
        if (type === 'upscale') return { upscaleFactor: 'x4' };
        if (type === 'export') return { outputFormat: 'PNG', resolution: 300 };
        return {};
    };

    const [pipelineSteps, setPipelineSteps] = useState(() => [
        { id: 'step_default_upload', type: 'upload', status: 'pending', resultUrl: null, settings: {} },
        { id: 'step_default_export', type: 'export', status: 'pending', resultUrl: null, settings: { outputFormat: 'PNG', resolution: 300 } }
    ]);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [pipelineRunning, setPipelineRunning] = useState(false);
    const [pipelineCurrentStep, setPipelineCurrentStep] = useState(-1);
    const [pipelineResults, setPipelineResults] = useState([]);
    const [pipelinePreview, setPipelinePreview] = useState(null);
    const [pipelineRuns, setPipelineRuns] = useState([]);
    const [pipelineFile, setPipelineFile] = useState(null); // uploaded file for pipeline
    const pipelineFileRef = useRef(null);
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [pipelineName, setPipelineName] = useState('My Custom Pipeline');
    const [savedProfiles, setSavedProfiles] = useState([]);
    const [dashboardTab, setDashboardTab] = useState('run'); // 'run' or 'build'
    const [showSettingsModal, setShowSettingsModal] = useState(false);

    // Load pipeline runs and saved profiles on mount
    useEffect(() => {
        if (tool === 'dashboard' && activeProject?.id) {
            fetch(`${API}/api/pipeline-runs?project_id=${activeProject.id}`).then(r => r.json()).then(d => {
                if (d.success) setPipelineRuns(d.runs);
            }).catch(() => { });
            fetch(`${API}/api/workflows`).then(r => r.json()).then(d => {
                if (d.success) setSavedProfiles(d.workflows);
            }).catch(() => { });
        }
    }, [tool, activeProject?.id]);

    const loadProfile = (profile) => {
        const steps = profile.steps.map((type, i) => ({
            id: `step_${i}_${Date.now()}`,
            type,
            status: 'pending',
            resultUrl: null,
            settings: profile.settings[type] || getDefaultSettingsForStep(type),
        }));
        setPipelineSteps(steps);
        setPipelineResults([]);
        setPipelinePreview(null);
        setPipelineCurrentStep(-1);
        setPipelineName(profile.name);
    };

    const deleteProfile = async (id) => {
        if (!window.confirm('Are you sure you want to delete this profile?')) return;
        try {
            const r = await fetch(`${API}/api/workflows/${id}`, { method: 'DELETE' });
            const d = await r.json();
            if (d.success) {
                setSavedProfiles(prev => prev.filter(p => p.id !== id));
            }
        } catch { }
    };

    const runProfile = (profile) => {
        loadProfile(profile);
        setTimeout(() => {
            const el = document.querySelector('.st-pl-run-btn');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    };

    const selectTemplate = (tmpl) => {
        setSelectedTemplate(tmpl.id);
        const steps = tmpl.steps.map((type, i) => ({
            id: `step_${i}_${Date.now()}`,
            type,
            status: 'pending',
            resultUrl: null,
            settings: getDefaultSettingsForStep(type),
        }));
        setPipelineSteps(steps);
        setPipelineResults([]);
        setPipelinePreview(null);
        setPipelineCurrentStep(-1);
    };

    const addPipelineStep = (type) => {
        setError('');
        if (pipelineSteps.length === 0 && type !== 'upload') {
            setError('The first step in a pipeline must be an Upload step.');
            return;
        }
        if (type === 'upload' && pipelineSteps.length > 0) {
            setError('Upload must be the very first step.');
            return;
        }
        const hasVectorize = pipelineSteps.findIndex(s => s.type === 'vectorize');
        if (hasVectorize !== -1 && type === 'upscale') {
            setError('Invalid sequence: You cannot upscale a vectorized (SVG) image.');
            return;
        }

        setPipelineSteps(prev => {
            const copy = [...prev];
            const exportIdx = copy.findIndex(s => s.type === 'export');
            const newStep = {
                id: `step_${copy.length}_${Date.now()}`,
                type, status: 'pending', resultUrl: null, settings: getDefaultSettingsForStep(type),
            };
            if (exportIdx !== -1) {
                copy.splice(exportIdx, 0, newStep);
            } else {
                copy.push(newStep);
            }
            return copy;
        });
    };

    const removePipelineStep = (id) => {
        setPipelineSteps(prev => prev.filter(s => s.id !== id));
    };

    const updateStepSetting = (id, key, val) => {
        setPipelineSteps(prev => prev.map(s => s.id === id ? { ...s, settings: { ...s.settings, [key]: val } } : s));
    };

    const estimatedCredits = useMemo(() => {
        return pipelineSteps.reduce((sum, s) => {
            return sum + (creditPricing[s.type] || 0);
        }, 0);
    }, [pipelineSteps, creditPricing]);

    const handlePipelineUpload = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => setPipelinePreview(e.target.result);
        reader.readAsDataURL(file);
        const fd = new FormData();
        fd.append('image', file);
        fetch(`${API}/api/upload`, { method: 'POST', body: fd })
            .then(r => r.json())
            .then(d => { if (d.success) setPipelineFile(d); })
            .catch(() => setError('Upload failed'));
    };

    const runPipeline = async () => {
        if (pipelineSteps.length === 0) return;
        setError('');

        const hasUpload = pipelineSteps[0]?.type === 'upload';
        if (!hasUpload) {
            setError('Pipeline must start with an Upload step.');
            return;
        }
        if (hasUpload && !pipelineFile) {
            setError('Please upload an image first.');
            return;
        }

        const vecIdx = pipelineSteps.findIndex(s => s.type === 'vectorize');
        const upIdx = pipelineSteps.findIndex(s => s.type === 'upscale');
        if (vecIdx !== -1 && upIdx !== -1 && upIdx > vecIdx) {
            setError('Invalid pipeline: You cannot upscale a vectorized (SVG) image. Please upscale before vectorizing.');
            return;
        }

        setPipelineRunning(true);
        setError('');
        const results = [];
        let currentInput = pipelineFile?.filename || '';

        const exportStep = pipelineSteps.find(s => s.type === 'export');
        const outFormat = exportStep?.settings?.outputFormat || 'PNG';
        const outDpi = exportStep?.settings?.resolution || 300;

        // Create run record
        let runId = null;
        try {
            const rr = await fetch(`${API}/api/pipeline-runs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: activeProject.id,
                    name: PIPELINE_TEMPLATES.find(t => t.id === selectedTemplate)?.name || 'Custom Pipeline',
                    steps: pipelineSteps.map(s => s.type),
                    settings: pipelineSteps.reduce((acc, s) => ({ ...acc, [s.type]: s.settings }), {}),
                }),
            });
            const rd = await rr.json();
            if (rd.success) runId = rd.runId;
        } catch { }

        // Step-by-step execution
        for (let i = 0; i < pipelineSteps.length; i++) {
            const step = pipelineSteps[i];
            setPipelineCurrentStep(i);
            setPipelineSteps(prev => prev.map((s, idx) =>
                idx === i ? { ...s, status: 'running' } : s
            ));

            try {
                let resultUrl = null;
                if (step.type === 'upload') {
                    // Already handled by handlePipelineUpload
                    resultUrl = pipelineFile ? `${API}/uploads/${pipelineFile.filename}` : null;
                } else if (step.type === 'extract') {
                    const r = await fetch(`${API}/api/extract-design`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: activeProject.id, filename: currentInput, userId: currentUser?.id }),
                    });
                    const d = await r.json();
                    if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); updateCreditsFromResponse(d); }
                    else throw new Error(d.error || 'Extraction failed');
                } else if (step.type === 'seamless') {
                    const r = await fetch(`${API}/api/make-seamless`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: activeProject.id, filename: currentInput, userId: currentUser?.id }),
                    });
                    const d = await r.json();
                    if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); updateCreditsFromResponse(d); }
                    else throw new Error(d.error || 'Seamless failed');
                } else if (step.type === 'repeat') {
                    const r = await fetch(`${API}/api/create-repeat-set`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            projectId: activeProject.id, filename: currentInput, userId: currentUser?.id,
                            gridSize: step.settings?.gridSize || 3, scale: 100,
                            repeatType: step.settings?.repeatType || 'block',
                            dpi: outDpi, format: outFormat,
                        }),
                    });
                    const d = await r.json();
                    if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); updateCreditsFromResponse(d); }
                    else throw new Error(d.error || 'Repeat failed');
                } else if (step.type === 'upscale') {
                    const r = await fetch(`${API}/api/upscale`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: activeProject.id, filename: currentInput, factor: step.settings?.upscaleFactor || 'x4', userId: currentUser?.id }),
                    });
                    const d = await r.json();
                    if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); updateCreditsFromResponse(d); }
                    else throw new Error(d.error || 'Upscale failed');
                } else if (step.type === 'vectorize') {
                    const r = await fetch(`${API}/api/vectorize`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: activeProject.id, filename: currentInput, userId: currentUser?.id }),
                    });
                    const d = await r.json();
                    if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); updateCreditsFromResponse(d); }
                    else throw new Error(d.error || 'Vectorize failed');
                } else if (step.type === 'export') {
                    // Export is just the final download
                    resultUrl = currentInput ? `${API}/results/${currentInput}` : null;
                }

                results.push({ step: i, type: step.type, status: 'done', resultUrl });
                setPipelineResults([...results]);
                if (resultUrl) setPipelinePreview(resultUrl);
                setPipelineSteps(prev => prev.map((s, idx) =>
                    idx === i ? { ...s, status: 'done', resultUrl } : s
                ));
            } catch (err) {
                results.push({ step: i, type: step.type, status: 'error', error: err.message });
                setPipelineResults([...results]);
                setPipelineSteps(prev => prev.map((s, idx) =>
                    idx === i ? { ...s, status: 'error' } :
                        idx > i ? { ...s, status: 'skipped' } : s
                ));
                setError(`Step "${STEP_TYPES.find(d => d.type === step.type)?.label}" failed: ${err.message}`);
                break;
            }
        }

        // Update run record
        const finalStatus = results.every(r => r.status === 'done') ? 'completed' : 'failed';
        if (runId) {
            fetch(`${API}/api/pipeline-runs/${runId}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: finalStatus, results }),
            }).catch(() => { });
        }
        // Refresh runs list
        fetch(`${API}/api/pipeline-runs`).then(r => r.json()).then(d => {
            if (d.success) setPipelineRuns(d.runs);
        }).catch(() => { });

        // Auto-download the final result if pipeline completed successfully
        const finalResult = results[results.length - 1];
        if (finalStatus === 'completed' && finalResult?.resultUrl) {
            try {
                const resp = await fetch(finalResult.resultUrl);
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const ext = outFormat?.toLowerCase() || 'png';
                a.download = `rimi_pipeline_result_${Date.now()}.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (e) {
                console.error('Auto-download failed:', e);
            }
        }

        setPipelineRunning(false);
        setPipelineCurrentStep(-1);
    };

    const savePipelineProfile = async () => {
        if (!pipelineName.trim()) {
            alert('Please enter a name for your pipeline profile.');
            return;
        }
        try {
            const rr = await fetch(`${API}/api/workflows`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: pipelineName.trim(),
                    steps: pipelineSteps.map(s => s.type),
                    settings: pipelineSteps.reduce((acc, s) => ({ ...acc, [s.type]: s.settings }), {}),
                }),
            });
            const rd = await rr.json();
            if (rd.success) {
                alert('Pipeline profile saved successfully!');
                setSavedProfiles([{
                    id: rd.workflowId,
                    name: pipelineName.trim(),
                    steps: pipelineSteps.map(s => s.type),
                    settings: pipelineSteps.reduce((acc, s) => ({ ...acc, [s.type]: s.settings }), {}),
                }, ...savedProfiles]);
            } else {
                alert('Failed to save pipeline profile.');
            }
        } catch (err) {
            alert('Error connecting to server.');
        }
    };
    // ===== END PIPELINE =====

    const [repeatTab, setRepeatTab] = useState('canvas');
    const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
    const [canvasZoom, setCanvasZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const [showTileBoundary, setShowTileBoundary] = useState(true);

    const handleWheel = (e) => {
        setCanvasZoom(z => Math.max(0.1, Math.min(5, z - e.deltaY * 0.001)));
    };
    const handleMouseDown = (e) => {
        setIsPanning(true);
        setPanStart({ x: e.clientX - canvasPan.x, y: e.clientY - canvasPan.y });
    };
    const handleMouseMove = (e) => {
        if (!isPanning) return;
        setCanvasPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    };
    const handleMouseUp = () => setIsPanning(false);

    const loadStudioState = useCallback(async (projectId = activeProjectId) => {
        setError('');
        try {
            const uid = currentUser?.id || '';
            const r = await fetch(`${API}/api/studio-state?projectId=${projectId}${uid ? `&userId=${uid}` : ''}`);
            const d = await r.json();
            if (!d.success) throw new Error(d.error || 'Failed to load studio state');
            hasLoadedControls.current = false;
            setState(d.state);
            setActiveProjectId(d.state.activeProject.id);
            window.setTimeout(() => { hasLoadedControls.current = true; }, 0);
        } catch {
            setError('Backend is not connected. Start Flask on port 3001 so dashboard data can sync from SQLite.');
        } finally {
            setIsLoadingState(false);
        }
    }, [activeProjectId]);

    useEffect(() => {
        if (!isAdmin) loadStudioState(1);
        else setIsLoadingState(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const updateControls = useCallback((patch) => {
        setState((current) => ({ ...current, controls: { ...current.controls, ...patch } }));
    }, []);

    useEffect(() => {
        if (!hasLoadedControls.current) return;
        const id = window.setTimeout(async () => {
            try {
                const r = await fetch(`${API}/api/projects/${activeProject.id}/controls`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(controls),
                });
                const d = await r.json();
                if (d.success) setState(d.state);
            } catch {
                setError('Control changes are local only because the SQLite API is offline.');
            }
        }, 350);
        return () => window.clearTimeout(id);
    }, [controls, activeProject.id]);

    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            // Use full source image resolution for crisp preview
            const tw = img.width;
            const th = img.height;
            c.width = tw * controls.gridSize;
            c.height = th * controls.gridSize;
            ctx.fillStyle = '#fbfaf7';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.save();
            ctx.translate(c.width / 2, c.height / 2);
            ctx.rotate((controls.rotation * Math.PI) / 180);
            ctx.translate(-c.width / 2, -c.height / 2);
            const drawW = tw * (controls.scale / 100);
            const drawH = th * (controls.scale / 100);

            const expand = 2;
            if (controls.repeatType === 'half_brick') {
                for (let r = -expand; r < controls.gridSize + expand; r += 1) {
                    const offset = Math.abs(r) % 2 ? Math.floor(tw / 2) : 0;
                    for (let col = -expand; col <= controls.gridSize + expand; col += 1) ctx.drawImage(img, col * tw + offset, r * th, drawW, drawH);
                }
            } else if (controls.repeatType === 'half_drop') {
                for (let col = -expand; col < controls.gridSize + expand; col += 1) {
                    const offset = Math.abs(col) % 2 ? Math.floor(th / 2) : 0;
                    for (let r = -expand; r <= controls.gridSize + expand; r += 1) ctx.drawImage(img, col * tw, r * th + offset, drawW, drawH);
                }
            } else if (controls.repeatType === 'mirror') {
                for (let r = -expand; r < controls.gridSize + expand; r += 1) {
                    for (let col = -expand; col < controls.gridSize + expand; col += 1) {
                        ctx.save();
                        ctx.translate(
                            col * tw + (Math.abs(col) % 2 ? drawW : 0),
                            r * th + (Math.abs(r) % 2 ? drawH : 0)
                        );
                        ctx.scale(Math.abs(col) % 2 ? -1 : 1, Math.abs(r) % 2 ? -1 : 1);
                        ctx.drawImage(img, 0, 0, drawW, drawH);
                        ctx.restore();
                    }
                }
            } else {
                for (let r = -expand; r < controls.gridSize + expand; r += 1) {
                    for (let col = -expand; col < controls.gridSize + expand; col += 1) {
                        ctx.drawImage(img, col * tw, r * th, drawW, drawH);
                    }
                }
            }

            // Draw visual mask for seam brushes to give user feedback
            if (controls.edgeMatch && (controls.hBrush > 0 || controls.vBrush > 0)) {
                ctx.fillStyle = 'rgba(99, 102, 241, 0.35)'; // Purple/Indigo overlay

                // hBrush and vBrush are now percentages (0-25) representing Tile Overlap
                // We calculate the pixel width relative to the scaled tile width/height
                const displayHBrush = tw * (controls.hBrush / 100);
                const displayVBrush = th * (controls.vBrush / 100);

                // Ensure we draw the grid seams over the entire expanded area
                for (let r = -expand; r <= controls.gridSize + expand; r += 1) {
                    if (displayHBrush > 0) {
                        // Horizontal seams (between rows)
                        // Adjust for staggered layouts
                        if (controls.repeatType === 'half_drop') {
                            for (let col = -expand; col <= controls.gridSize + expand; col += 1) {
                                const offset = Math.abs(col) % 2 ? Math.floor(th / 2) : 0;
                                const y = r * th + offset;
                                ctx.fillRect(col * tw, y - displayHBrush / 2, tw, displayHBrush);
                            }
                        } else {
                            const y = r * th;
                            ctx.fillRect(-expand * tw, y - displayHBrush / 2, (controls.gridSize + expand * 2) * tw, displayHBrush);
                        }
                    }
                }
                for (let col = -expand; col <= controls.gridSize + expand; col += 1) {
                    if (displayVBrush > 0) {
                        // Vertical seams (between cols)
                        if (controls.repeatType === 'half_brick') {
                            for (let r = -expand; r <= controls.gridSize + expand; r += 1) {
                                const offset = Math.abs(r) % 2 ? Math.floor(tw / 2) : 0;
                                const x = col * tw + offset;
                                ctx.fillRect(x - displayVBrush / 2, r * th, displayVBrush, th);
                            }
                        } else {
                            const x = col * tw;
                            ctx.fillRect(x - displayVBrush / 2, -expand * th, displayVBrush, (controls.gridSize + expand * 2) * th);
                        }
                    }
                }
            }

            ctx.restore();
        };
        const imgSrc = preview;
        if (!imgSrc) {
            // No uploaded image â€” show blank canvas
            c.width = 980;
            c.height = 680;
            ctx.fillStyle = '#fbfaf7';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '16px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Upload an image to preview your repeat set', c.width / 2, c.height / 2);
            return;
        }
        img.src = imgSrc;
    }, [controls, preview]);

    const handleUpload = useCallback(async (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => setUploads((p) => ({ ...p, [tool]: { ...p[tool], url: e.target.result } }));
        reader.readAsDataURL(file);
        const fd = new FormData();
        fd.append('image', file);
        try {
            const r = await fetch(`${API}/api/upload`, { method: 'POST', body: fd });
            const d = await r.json();
            if (d.success) setUploads((p) => ({ ...p, [tool]: { file: d, url: p[tool]?.url || null } }));
            else setError(d.error || 'Upload failed');
        } catch {
            setError('Backend is not reachable. Start Flask on port 3001.');
        }
    }, [tool]);

    const descImg = async () => {
        if (!uploaded?.filename) return;
        setIsDesc(true);
        setError('');
        try {
            const r = await fetch(`${API}/api/describe-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    projectId: activeProject.id,
                    creativity
                })
            });
            const d = await r.json();
            if (d.success) {
                setAnalysis(d.analysis);
                setPrompt(d.description);
            } else setError(d.error);
        } catch {
            setError('Backend is not reachable. Start Flask on port 3001.');
        } finally {
            setIsDesc(false);
        }
    };

    const generate = async () => {
        if (!prompt.trim()) {
            setError('Enter a prompt');
            return;
        }
        setIsGen(true);
        setError('');
        setGeneratedVariations([]);

        const activeUrl = preview || activeProject.heroImageUrl;
        let safeFilename = uploaded?.filename;
        let safeUrl = !uploaded ? activeUrl : null;

        if (!safeFilename && safeUrl && safeUrl.includes('/uploads/')) {
            safeFilename = safeUrl.split('/').pop();
            safeUrl = null;
        }

        try {
            let finalPrompt = prompt;
            if (inspireStyle !== 'All Styles' && !finalPrompt.toLowerCase().includes(inspireStyle.toLowerCase())) {
                finalPrompt += `, ${inspireStyle} style`;
            }
            if (inspireColors.length > 0) {
                finalPrompt += `, color palette: ${inspireColors.join(', ')}`;
            }

            const r = await fetch(`${API}/api/generate-inspirations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    creativity,
                    count: variants,
                    projectId: activeProject.id,
                    filename: safeFilename,
                    imageUrl: safeUrl,
                    userId: currentUser?.id
                })
            });
            const d = await r.json();
            if (d.success) {
                setGeneratedVariations(d.variations);
                updateCreditsFromResponse(d);
            } else setError(d.error);
        } catch {
            setError('Backend is not reachable. Start Flask on port 3001.');
        } finally {
            setIsGen(false);
        }
    };

    const createRepeat = async () => {
        if (!uploaded && !preview) {
            setError('Upload an image first to export a repeat set.');
            return;
        }

        let safeFilename = uploaded?.filename || '';
        let safeUrl = '';

        // If no filename from upload response, try to extract from preview URL
        if (!safeFilename && preview) {
            if (preview.startsWith('data:')) {
                // It's a base64 data URL from FileReader â€” we need the server filename
                setError('Image is still uploading. Please wait and try again.');
                return;
            } else if (preview.startsWith('http')) {
                safeUrl = preview;
            } else {
                // Local path like /uploads/xxx.png or /results/xxx.png
                safeFilename = preview.split('/').pop();
            }
        }

        if (!safeFilename && !safeUrl) {
            setError('No valid image to export. Please upload an image.');
            return;
        }

        setIsRepeat(true);
        setError('');
        setRepeatUrl(null);
        try {
            const r = await fetch(`${API}/api/create-repeat-set`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: activeProject.id,
                    filename: safeFilename,
                    imageUrl: safeUrl,
                    gridSize: controls.gridSize,
                    scale: controls.scale,
                    repeatType: controls.repeatType,
                    dpi: controls.exportDpi,
                    format: controls.exportFormat,
                }),
            });
            const d = await r.json();
            if (d.success) {
                const fullUrl = `${API}${d.resultUrl}`;
                setRepeatUrl(fullUrl);
                // Force a real download using fetch+blob
                forceDownload({ preventDefault: () => { } }, fullUrl);
            } else setError(d.error);
        } catch {
            setError('Backend is not reachable. Start Flask on port 3001.');
        } finally {
            setIsRepeat(false);
        }
    };

    const extractDesign = async () => {
        const activeUrl = preview || activeProject.heroImageUrl;
        if (!uploaded && !activeUrl) {
            setError('Upload an image first');
            return;
        }

        let safeFilename = uploaded?.filename;
        let safeUrl = !uploaded ? activeUrl : null;

        if (!safeFilename && safeUrl && !safeUrl.startsWith('http')) {
            safeFilename = safeUrl.split('/').pop();
            safeUrl = null;
        }

        setIsEnh(true);
        setError('');
        setEnhUrl(null);

        const trigger = async () => {
            const r = await fetch(`${API}/api/extract-design`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: safeFilename, imageUrl: safeUrl, projectId: activeProject.id, userId: currentUser?.id })
            });
            const d = await r.json();
            if (d.success) {
                setEnhUrl(d.resultUrls);
                setIsEnh(false);
                updateCreditsFromResponse(d);
                return { url: d.resultUrls[0], urls: d.resultUrls };
            } else {
                setIsEnh(false);
                throw new Error(d.error || 'Extraction failed');
            }
        };

        addBgTask('pattern', 'Design Extraction', safeFilename || 'design.png', trigger);
    };

    const vectorize = async () => {
        const activeUrl = preview || activeProject.heroImageUrl;
        if (!uploaded && !activeUrl) {
            setError('Upload an image first');
            return;
        }

        let safeFilename = uploaded?.filename;
        let safeUrl = !uploaded ? activeUrl : null;

        // Extract filename from local URLs (/uploads/xxx.png or /demo_floral.png)
        if (!safeFilename && safeUrl && !safeUrl.startsWith('http')) {
            safeFilename = safeUrl.split('/').pop();
            safeUrl = null;
        }

        setIsVec(true);
        setError('');
        setVecUrl(null);

        const trigger = async () => {
            const r = await fetch(`${API}/api/vectorize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: safeFilename, imageUrl: safeUrl, engine: vecEngine, numColors: vecColors, removeBg: vecIsolate, projectId: activeProject.id, userId: currentUser?.id })
            });
            const d = await r.json();
            if (d.success) {
                const fullUrl = `${API}${d.resultUrl}`;
                setVecUrl(fullUrl);
                setIsVec(false);
                updateCreditsFromResponse(d);
                return { url: fullUrl };
            } else {
                setIsVec(false);
                throw new Error(d.error || 'Vectorization failed');
            }
        };

        addBgTask('vectorize', 'Bezier Vectorization', safeFilename || 'vector.png', trigger);
    };

    const upscale = async () => {
        if (!uploaded) {
            setError('Upload first');
            return;
        }
        setIsUpscaling(true);
        setError('');
        setUpscaleUrl(null);

        const trigger = async () => {
            const r = await fetch(`${API}/api/upscale`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: uploaded.filename, upscaleFactor, projectId: activeProject.id, userId: currentUser?.id })
            });
            const d = await r.json();
            if (d.success) {
                const fullUrl = `${API}${d.resultUrl}`;
                setUpscaleUrl(fullUrl);
                setIsUpscaling(false);
                updateCreditsFromResponse(d);
                return { url: fullUrl };
            } else {
                setIsUpscaling(false);
                throw new Error(d.error || 'Upscaling failed');
            }
        };

        addBgTask('upscale', `Super Resolution (${upscaleFactor})`, uploaded.filename, trigger);
    };

    const makeSeamless = async () => {
        const activeUrl = preview || activeProject.heroImageUrl;
        if (!uploaded && !activeUrl) {
            setError('Upload an image first');
            return;
        }

        let safeFilename = uploaded?.filename;
        let safeUrl = !uploaded ? activeUrl : null;

        if (!safeFilename && safeUrl && !safeUrl.startsWith('http')) {
            safeFilename = safeUrl.split('/').pop();
            safeUrl = null;
        }

        setIsSeamless(true);
        setError('');
        setSeamlessUrl(null);

        const trigger = async () => {
            const r = await fetch(`${API}/api/make-seamless`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: safeFilename,
                    imageUrl: safeUrl,
                    projectId: activeProject.id,
                    hBrushPct: controls.hBrush,
                    vBrushPct: controls.vBrush,
                    userId: currentUser?.id
                })
            });
            const d = await r.json();
            if (d.success) {
                const fullUrl = `${API}${d.resultUrl}`;
                setSeamlessUrl(fullUrl);
                updateCreditsFromResponse(d);
                await loadStudioState(activeProject.id);
                setIsSeamless(false);
                return { url: fullUrl };
            } else {
                setIsSeamless(false);
                throw new Error(d.error || 'Seamless generation failed');
            }
        };

        addBgTask('seamless', 'Make Seamless Pattern', safeFilename || 'pattern.png', trigger);
    };

    const generateSeamless = async () => {
        if (!seamlessPrompt.trim()) {
            setError('Enter a description of the pattern you want to generate');
            return;
        }
        setIsSeamless(true);
        setError('');
        setSeamlessUrl(null);
        setSeamlessTiles([]);

        const trigger = async () => {
            const r = await fetch(`${API}/api/generate-seamless`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: seamlessPrompt,
                    count: 4,
                    creativity,
                    projectId: activeProject.id,
                    filename: uploaded?.filename || '',
                    imageUrl: '',
                    userId: currentUser?.id
                })
            });
            const d = await r.json();
            if (d.success) {
                setSeamlessTiles(d.tiles || []);
                let bestUrl = '';
                if (d.bestUrl) {
                    bestUrl = `${API}${d.bestUrl}`;
                    setSeamlessUrl(bestUrl);
                }
                updateCreditsFromResponse(d);
                await loadStudioState(activeProject.id);
                setIsSeamless(false);
                return { url: bestUrl, urls: d.tiles ? d.tiles.map(t => `${API}${t}`) : null };
            } else {
                setIsSeamless(false);
                throw new Error(d.error || 'Text-to-pattern failed');
            }
        };

        addBgTask('seamless', `Text-to-Pattern: "${seamlessPrompt.substring(0, 20)}..."`, uploaded?.filename || 'text_input.png', trigger);
    };

    const toolLabel = {
        dashboard: 'Pipeline Studio',
        pattern: 'Pattern Extraction',
        seamless: 'Make Seamless',
        repeat: 'Repeat Set',
        mappings: 'Create New Mapping',
        inspire: 'Inspirations',
        vectorize: 'Vectorize',
        upscale: 'Super Resolution',
        library: 'Brand Library',
        exports: 'Exports',
        'admin-users': 'User Management',
        'admin-logs': 'Activity Logs',
        'admin-credits': 'Credits & Billing',
        'colorway-manager': 'Colorway Manager',
        'print-advisor': 'Print Method Advisor',
        'measurement': 'Measurement & Scale',
    }[tool] || tool;

    const metrics = [
        ['Versions', state.metrics.versions, state.metrics.versionsDelta],
        ['Exports', state.metrics.exports, state.metrics.exportsDelta],
        ['AI Generations', state.metrics.aiGenerations, state.metrics.aiGenerationsDelta],
        ['Credits Used', state.metrics.creditsUsed, state.metrics.creditsDelta],
    ];

    const renderVariations = (isSidebar = false) => {
        if (state.variations.length === 0) return null;
        return (
            <section className={`st-variations ${isSidebar ? 'st-side-variations' : ''}`}>
                <div className="st-section-title">Pattern Variations</div>
                <div className="st-variation-row">
                    {state.variations.map((v) => (
                        <button
                            key={v.id}
                            className={`st-variation ${v.isSelected ? 'active' : ''}`}
                            onClick={() => {
                                setState(s => ({
                                    ...s,
                                    variations: s.variations.map(item => ({ ...item, isSelected: item.id === v.id })),
                                    activeProject: { ...s.activeProject, heroImageUrl: v.imageUrl }
                                }));
                                setUploads(p => ({ ...p, [tool]: { file: null, url: v.imageUrl } }));
                            }}
                        >
                            <img src={v.imageUrl} alt="" />
                            <span>{v.name}</span>
                        </button>
                    ))}
                    <button className="st-generate-more"><span>+</span><small>Generate More</small></button>
                </div>
            </section>
        );
    };

    const renderControls = () => {
        if (tool === 'repeat') {
            return (
                <div className="st-ctrl">
                    <div className="st-settings-group">
                        <div className="st-group-title">TILE SETTINGS</div>
                        <label className="st-label">Grid Size</label>
                        <div className="st-btn-row">
                            {['2x2', '3x3', '4x4', '5x5', '6x6'].map((n, i) => (
                                <button key={n} className={`st-grid-btn ${controls.gridSize === i + 2 ? 'active' : ''}`} onClick={() => updateControls({ gridSize: i + 2 })}>{n}</button>
                            ))}
                        </div>

                        <label className="st-label">Scale</label>
                        <div className="st-scale-row">
                            <button onClick={() => updateControls({ scale: Math.max(50, controls.scale - 10) })}>-</button>
                            <span style={{ flex: 1, textAlign: 'center' }}>{controls.scale}%</span>
                            <button onClick={() => updateControls({ scale: Math.min(200, controls.scale + 10) })}>+</button>
                        </div>

                        <label className="st-label">Rotation</label>
                        <div className="st-scale-row">
                            <button onClick={() => updateControls({ rotation: (controls.rotation - 15 + 360) % 360 })}>0&deg;</button>
                            <span style={{ flex: 1, textAlign: 'center' }}>{controls.rotation}&deg;</span>
                            <button onClick={() => updateControls({ rotation: (controls.rotation + 15) % 360 })}>+</button>
                        </div>

                        <label className="st-label">Mirror</label>
                        <div className="st-btn-row">
                            <button className={`st-sym-btn ${controls.repeatType === 'block' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'block' })} title="None"><I d="M3 3h18v18H3z" s={14} /></button>
                            <button className={`st-sym-btn ${controls.repeatType === 'mirror' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'mirror' })} title="Horizontal"><I d="M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4" s={14} /></button>
                            <button className={`st-sym-btn ${controls.repeatType === 'half_drop' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'half_drop' })} title="Vertical"><I d="M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4" s={14} /></button>
                        </div>
                    </div>
                    <div className="st-settings-group">
                        <div className="st-group-title">EXPORT OPTIONS</div>
                        <div className="st-export-grid">
                            <div><label className="st-label-sm">Format</label><select value={controls.exportFormat} onChange={(e) => updateControls({ exportFormat: e.target.value })} className="st-select"><option>PNG</option><option>JPG</option><option>TIFF</option></select></div>
                            <div><label className="st-label-sm">Resolution</label><select value={controls.exportDpi} onChange={(e) => updateControls({ exportDpi: +e.target.value })} className="st-select"><option value={150}>150 DPI</option><option value={300}>300 DPI</option><option value={600}>600 DPI</option></select></div>
                        </div>
                    </div>
                    <button className="st-export-btn" onClick={() => createRepeat()} disabled={isRepeat || (!uploaded && !preview)}>{isRepeat ? 'Processing...' : 'Export Repeat Set'}</button>
                    {renderVariations(true)}
                </div>
            );
        }
        if (tool === 'inspire') return (
            <div className="st-ctrl" style={{ padding: '0.25rem' }}>

                <div className="st-inspire-sidebar-group">
                    <div className="st-inspire-sidebar-label">Creativity <I d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" s={14} /></div>
                    <input type="range" min="1" max="5" value={creativity} onChange={(e) => setCreativity(+e.target.value)} className="st-range" />
                    <div className="st-range-labels"><span>Safe</span><span>Wild</span></div>
                </div>

                <div className="st-inspire-sidebar-group">
                    <div className="st-inspire-sidebar-label">Variants <I d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" s={14} /></div>
                    <div className="st-btn-row">
                        {[1, 3, 5, 7].map((n) => <button key={n} className={`st-grid-btn ${variants === n ? 'active' : ''}`} onClick={() => setVariants(n)}>{n}</button>)}
                    </div>
                </div>

                <div className="st-inspire-sidebar-group">
                    <div className="st-inspire-sidebar-label">Color Mood <I d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" s={14} /></div>
                    <div className="st-color-mood">
                        <button className="st-color-btn" onClick={() => {
                            const hex = prompt('Enter a hex color code (e.g. #ff0000):');
                            if (hex && /^#[0-9A-F]{6}$/i.test(hex.trim())) {
                                setInspireColors([...inspireColors, hex.trim()]);
                            } else if (hex) {
                                alert('Please enter a valid 6-digit hex code starting with #');
                            }
                        }} title="Add Color"><I d="M12 5v14M5 12h14" s={16} /></button>
                        {inspireColors.map((c, i) => (
                            <div
                                key={i}
                                className="st-color-circle"
                                style={{ background: c, cursor: 'pointer' }}
                                onClick={() => setInspireColors(inspireColors.filter((_, idx) => idx !== i))}
                                title="Click to remove"
                            />
                        ))}
                    </div>
                </div>

                <div className="st-inspire-sidebar-group">
                    <div className="st-inspire-sidebar-label">Style <I d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm-1-11v6h2v-6h-2zm0-4v2h2V7h-2z" s={14} /></div>
                    <div className="st-style-tags">
                        {['All Styles', 'Hand Painted', 'Minimal', 'Line Art', 'Vintage', 'Geometric'].map(s => (
                            <button
                                key={s}
                                className={`st-style-tag ${inspireStyle === s ? 'active' : ''}`}
                                onClick={() => setInspireStyle(s)}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ marginTop: '2rem' }}>
                    <button className="st-generate-btn-lg" onClick={generate} disabled={isGen}>
                        <I d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" s={18} />
                        {isGen ? 'Generating...' : 'Generate Variations'}
                    </button>
                    <p className="st-generate-hint"><I d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" s={12} /> Uses ~{(creditPricing.inspire || 50) * variants} credits</p>
                </div>
            </div>
        );
        if (tool === 'vectorize') return (
            <div className="st-ctrl">
                <label className="st-label" style={{ color: '#6b7280', fontSize: '0.8rem', marginBottom: '1rem', display: 'block' }}>
                    Using High-Fidelity Cloud Vectorization (API)
                </label>
                <div className="st-toggle-row"><span>Isolate Motif</span><label className="st-toggle"><input type="checkbox" checked={vecIsolate} onChange={(e) => setVecIsolate(e.target.checked)} /><span className="st-toggle-slider" /></label></div>
                <button className="st-export-btn" onClick={vectorize} disabled={isVec || !uploaded}>{isVec ? 'Vectorizing...' : 'Vectorize Image'}</button>
            </div>
        );
        if (tool === 'upscale') return (
            <div className="st-ctrl">
                <label className="st-label">Resolution Factor</label>
                <div className="st-btn-row">
                    <button className={`st-grid-btn ${upscaleFactor === 'x2' ? 'active' : ''}`} onClick={() => setUpscaleFactor('x2')}>2x</button>
                    <button className={`st-grid-btn ${upscaleFactor === 'x4' ? 'active' : ''}`} onClick={() => setUpscaleFactor('x4')}>4x</button>
                </div>
                <button className="st-export-btn" onClick={upscale} disabled={isUpscaling || !uploaded}>
                    {isUpscaling ? 'Upscaling...' : 'Enhance Resolution'}
                </button>
            </div>
        );
        if (tool === 'imagelayers') return (
            <div className="st-ctrl">
                <div className="st-qwen-side-card">
                    <div className="st-qwen-eyebrow">Qwen model stack</div>
                    <strong>Layered decomposition + Qwen layer editing</strong>
                    <p>Qwen-native layer decomposition and isolated natural-language edits power this workspace.</p>
                </div>
                <div className="st-settings-group">
                    <div className="st-group-title">QWEN DEMO ACTIONS</div>
                    <div className="st-qwen-demo-grid compact">
                        {qwenLayerDemoActions.map((demo) => (
                            <button
                                key={demo.label}
                                className={`st-qwen-demo-card ${editType === demo.type ? 'active' : ''}`}
                                onClick={() => applyQwenLayerDemo(demo)}
                            >
                                <I d={demo.icon} s={14} />
                                <span>{demo.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="st-settings-group">
                    <div className="st-group-title">LAYER SETTINGS</div>
                    <label className="st-label">Number of Layers</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input type="range" min="2" max="10" value={imageLayersNumLayers} onChange={(e) => setImageLayersNumLayers(+e.target.value)} className="st-range" style={{ flex: 1 }} />
                        <span style={{ fontWeight: 600, fontSize: '1rem', color: '#6366f1', minWidth: '24px', textAlign: 'center' }}>{imageLayersNumLayers}</span>
                    </div>
                    <div className="st-range-labels"><span>2 layers</span><span>10 layers</span></div>
                </div>
                <div className="st-settings-group" style={{ marginTop: '0.75rem' }}>
                    <label className="st-label">Description</label>
                    <input
                        type="text"
                        value={imageLayersDescription}
                        onChange={(e) => setImageLayersDescription(e.target.value)}
                        placeholder="'auto' for AI caption, or describe the image"
                        style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', fontFamily: 'inherit', background: '#f8fafc' }}
                    />
                    <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem' }}>Use "auto" to let AI describe the image, or provide your own description for better results.</p>
                </div>
                <div className="st-qwen-side-features">
                    <span><I d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" s={13} /> Variable layer count</span>
                    <span><I d="M4 4h16v16H4zM9 9h6v6H9z" s={13} /> Recursive decomposition</span>
                    <span><I d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" s={13} /> Recolor, revise, replace</span>
                    <span><I d="M5 9l7-7 7 7M5 15l7 7 7-7" s={13} /> Move and resize layers</span>
                </div>
                <button className="st-export-btn" onClick={generateImageLayers} disabled={isImageLayering || !uploaded} style={{ marginTop: '1rem' }}>
                    {isImageLayering ? 'Qwen Decomposing...' : `Qwen Decompose into ${imageLayersNumLayers} Layers`}
                </button>
                <p className="st-generate-hint"><I d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" s={12} /> Uses ~{creditPricing.imageLayers || 100} credits</p>
            </div>
        );
        if (tool === 'seamless') return (
            <div className="st-pattern-right">
                <div className="st-pattern-right-title">
                    <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z" s={20} />
                    Seamless Pattern
                </div>
                <div className="st-btn-row" style={{ marginBottom: '0.75rem' }}>
                    <button className={`st-grid-btn ${seamlessMode === 'generate' ? 'active' : ''}`} onClick={() => setSeamlessMode('generate')} style={{ flex: 1 }}>âœ¨ Generate New</button>
                    <button className={`st-grid-btn ${seamlessMode === 'fix' ? 'active' : ''}`} onClick={() => setSeamlessMode('fix')} style={{ flex: 1 }}>ðŸ”§ Fix Existing</button>
                </div>

                {seamlessMode === 'generate' ? (
                    <>
                        <p className="st-pattern-right-desc" style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                            Generate natively seamless tiles from a text description. Uses AI with circular padding â€” tiles are seamless by construction.
                        </p>
                        <textarea
                            value={seamlessPrompt}
                            onChange={e => setSeamlessPrompt(e.target.value)}
                            placeholder="Describe the pattern... e.g. 'watercolor roses on cream linen background' or 'geometric art deco gold lines on navy'"
                            style={{ width: '100%', minHeight: '70px', padding: '0.6rem', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit', background: '#f8fafc' }}
                        />
                        {uploaded?.filename && (
                            <p style={{ fontSize: '0.75rem', color: '#6366f1', margin: '0.3rem 0' }}>ðŸ“Ž Reference image will guide the style</p>
                        )}
                    </>
                ) : (
                    <p className="st-pattern-right-desc">
                        Upload a tile and let AI fix the edges using offset + inpaint. Best for images that are almost seamless already.
                    </p>
                )}

                {isSeamless || seamlessProgress > 0 ? (
                    <div style={{ marginTop: '1rem', width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 500 }}>
                            <span>{seamlessStatus}</span>
                            <span>{Math.round(seamlessProgress)}%</span>
                        </div>
                        <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${seamlessProgress}%`, height: '100%', background: '#6366f1', transition: 'width 0.2s linear' }} />
                        </div>
                    </div>
                ) : seamlessMode === 'generate' ? (
                    <button className="st-pattern-right-btn" onClick={generateSeamless} disabled={!seamlessPrompt.trim()} style={{ marginTop: '0.5rem' }}>
                        <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={16} />
                        Generate Seamless Tiles
                    </button>
                ) : (
                    <button className="st-pattern-right-btn" onClick={makeSeamless} disabled={(!uploaded && !preview && !activeProject?.heroImageUrl)}>
                        <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z" s={16} />
                        Fix Uploaded Tile
                    </button>
                )}

                {seamlessTiles.length > 0 && (
                    <div style={{ marginTop: '1rem' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#334155' }}>Generated Tiles (click to select)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                            {seamlessTiles.map((tile, i) => (
                                <div key={i} onClick={() => { setSeamlessUrl(`${API}${tile.url}`); setUploads(prev => ({ ...prev, [tool]: { ...prev[tool], url: `${API}${tile.url}` } })); }}
                                    style={{ cursor: 'pointer', border: seamlessUrl === `${API}${tile.url}` ? '2px solid #6366f1' : '2px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
                                    <img src={`${API}${tile.url}`} alt={`Tile ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
                                    <div style={{ position: 'absolute', bottom: 4, right: 4, background: tile.score >= 0.9 ? '#22c55e' : tile.score >= 0.75 ? '#eab308' : '#ef4444', color: '#fff', fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                        {Math.round(tile.score * 100)}%
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
        if (tool === 'pattern') return (
            <div className="st-pattern-right">
                <div className="st-pattern-right-title">
                    <I d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" s={20} />
                    Design Extraction
                </div>
                <p className="st-pattern-right-desc">
                    AI analyzes your outfit or fabric image and extracts a clean, seamless, print-ready repeating pattern.
                </p>
                <button className="st-pattern-right-btn" onClick={extractDesign} disabled={isEnh || (!uploaded && !preview && !activeProject?.heroImageUrl)}>
                    <I d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" s={16} />
                    {isEnh ? 'Extracting...' : 'Extract Design'}
                </button>
                <div className="st-pattern-features-title">What you get</div>
                <div className="st-pattern-feature">
                    <div className="st-pattern-feature-icon"><I d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z" s={18} /></div>
                    <div className="st-pattern-feature-text">
                        <h4>Seamless output</h4>
                        <p>Perfectly tileable patterns with no visible seams.</p>
                    </div>
                </div>
                <div className="st-pattern-feature">
                    <div className="st-pattern-feature-icon"><I d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8z" s={18} /></div>
                    <div className="st-pattern-feature-text">
                        <h4>Print-ready</h4>
                        <p>High-quality files optimized for digital and physical printing.</p>
                    </div>
                </div>
                <div className="st-pattern-feature">
                    <div className="st-pattern-feature-icon"><I d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z M8 10v4 M12 10v4 M16 10v4" s={18} /></div>
                    <div className="st-pattern-feature-text">
                        <h4>High-resolution</h4>
                        <p>Crisp, high-resolution results suitable for any scale.</p>
                    </div>
                </div>
                <div className="st-pattern-security">
                    <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" s={16} />
                    <p>Your designs are private and secure. Only you can access your projects.</p>
                </div>
            </div>
        );
    };

    // ===== MAPPINGS RENDER =====
    const renderMappings = () => {
        const STEPS = ['Upload Print', 'Select Category', 'Choose Products', 'Map & Preview'];
        const currentProducts = MAPPING_PRODUCTS[mappingCategory] || [];
        const filteredProducts = mappingProductSearch
            ? currentProducts.filter(p => p.name.toLowerCase().includes(mappingProductSearch.toLowerCase()))
            : currentProducts;

        return (
            <div className="st-map-wizard">
                {/* Step indicator */}
                <div className="st-map-steps">
                    {STEPS.map((label, i) => (
                        <React.Fragment key={i}>
                            <div
                                className={`st-map-step ${mappingStep === i + 1 ? 'active' : ''} ${mappingStep > i + 1 ? 'completed' : ''}`}
                                onClick={() => { if (i + 1 < mappingStep || (i + 1 === 2 && mappingPrint)) setMappingStep(i + 1); }}
                            >
                                <div className="st-map-step-num">
                                    {mappingStep > i + 1 ? 'âœ“' : i + 1}
                                </div>
                                <span className="st-map-step-label">{label}</span>
                            </div>
                            {i < STEPS.length - 1 && (
                                <div className={`st-map-step-line ${mappingStep > i + 1 ? 'done' : ''}`} />
                            )}
                        </React.Fragment>
                    ))}
                </div>

                {/* Step 1: Upload Print */}
                {mappingStep >= 1 && (
                    <div className="st-map-section">
                        <h2 className="st-map-section-title">Upload Your Print</h2>
                        <p className="st-map-section-desc">Upload a high quality print or pattern</p>
                        <div className="st-map-upload-row">
                            <div
                                className={`st-map-upload-zone ${mappingPrintPreview ? 'has-image' : ''}`}
                                onClick={() => !mappingPrintPreview && mapFileRef.current?.click()}
                                onDrop={(e) => { e.preventDefault(); handleMappingUpload(e.dataTransfer.files[0]); }}
                                onDragOver={(e) => e.preventDefault()}
                            >
                                {mappingPrintPreview ? (
                                    <>
                                        <div className="st-map-upload-icon" style={{ background: '#dcfce7', color: '#16a34a' }}>
                                            <I d="M5 13l4 4L19 7" s={24} />
                                        </div>
                                        <h3>Print uploaded successfully!</h3>
                                        <p>{mappingPrint?.file?.name || 'pattern.png'}</p>
                                    </>
                                ) : (
                                    <>
                                        <div className="st-map-upload-icon">
                                            <I d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" s={24} />
                                        </div>
                                        <h3>Drag & drop your image here</h3>
                                        <p>or</p>
                                        <button className="st-map-upload-btn" type="button">Upload Image</button>
                                        <p className="st-map-upload-formats">Supports: PNG, JPG, SVG (Max 50MB)</p>
                                    </>
                                )}
                            </div>
                            <input ref={mapFileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.svg" hidden onChange={(e) => handleMappingUpload(e.target.files[0])} />

                            <div className="st-map-print-preview">
                                <div className="st-map-print-preview-title">Print Preview</div>
                                {mappingPrintPreview ? (
                                    <>
                                        <img className="st-map-print-img" src={mappingPrintPreview} alt="Print Preview" />
                                        <div className="st-map-print-info">
                                            <div className="st-map-print-name">
                                                Print Name
                                                <span>{mappingPrint?.file?.name || 'pattern.png'}</span>
                                            </div>
                                            <button className="st-map-replace-btn" onClick={() => mapFileRef.current?.click()}>Replace</button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="st-map-print-empty">
                                        <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={32} />
                                        <span>Upload a print to preview</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 2: Select Category */}
                {mappingStep >= 1 && (
                    <div className="st-map-section">
                        <h2 className="st-map-section-title">Select Category</h2>
                        <p className="st-map-section-desc">Choose the category that best fits your print</p>
                        <div className="st-map-categories">
                            {MAPPING_CATEGORIES.map(cat => (
                                <div
                                    key={cat.id}
                                    className={`st-map-category ${mappingCategory === cat.id ? 'active' : ''}`}
                                    onClick={() => { setMappingCategory(cat.id); setMappingSelectedProducts(new Set()); if (mappingStep < 2) setMappingStep(2); }}
                                >
                                    <div className="st-map-category-icon"><I d={cat.icon} s={22} /></div>
                                    <div className="st-map-category-name">{cat.label}</div>
                                    <div className="st-map-category-desc">{cat.desc}</div>
                                    <div className="st-map-category-check">âœ“</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 3: Choose Products */}
                {mappingStep >= 1 && (
                    <div className="st-map-section">
                        <h2 className="st-map-section-title">Choose Products</h2>
                        <p className="st-map-section-desc">Select the products you want to map this print on</p>

                        <div className="st-map-products-header">
                            <div className="st-map-selected-count">{mappingSelectedProducts.size} product{mappingSelectedProducts.size !== 1 ? 's' : ''} selected</div>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                <div className="st-map-products-search">
                                    <I d="M21 21l-4.3-4.3M10 18a8 8 0 100-16 8 8 0 000 16z" s={16} />
                                    <input placeholder="Search products..." value={mappingProductSearch} onChange={e => setMappingProductSearch(e.target.value)} />
                                </div>
                                {mappingSelectedProducts.size > 0 && (
                                    <button className="st-map-clear-btn" onClick={() => setMappingSelectedProducts(new Set())}>Clear All</button>
                                )}
                            </div>
                        </div>

                        <div className="st-map-products-grid">
                            {filteredProducts.map(product => (
                                <div
                                    key={product.id}
                                    className={`st-map-product ${mappingSelectedProducts.has(product.id) ? 'selected' : ''}`}
                                    onClick={() => { toggleMappingProduct(product.id); if (mappingStep < 3) setMappingStep(3); }}
                                >
                                    <div className="st-map-product-check">
                                        <I d="M5 13l4 4L19 7" s={14} />
                                    </div>
                                    <img className="st-map-product-img" src={product.image} alt={product.name} />
                                    <div className="st-map-product-name">{product.name}</div>
                                </div>
                            ))}
                            {filteredProducts.length === 0 && (
                                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                                    No products available in this category yet.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 4: Map & Preview (results) */}
                {mappingStep >= 4 && mappingResults.length > 0 && (
                    <div className="st-map-section">
                        <h2 className="st-map-section-title">Map Your Print</h2>
                        <p className="st-map-section-desc">AI-generated product mockups with your pattern</p>
                        <div className="st-map-results">
                            <div className="st-map-results-grid">
                                {mappingResults.map((result, idx) => (
                                    <div key={idx} className="st-map-result-card">
                                        <img src={`${API}${result.mockupUrl}`} alt={result.productType} />
                                        <div className="st-map-result-info">
                                            <span className="st-map-result-name">{result.productType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                                            <a className="st-map-result-dl" href={`${API}${result.mockupUrl}`} download onClick={(e) => forceDownload(e, `${API}${result.mockupUrl}`)}>
                                                <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={14} />
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Loading state */}
                {isMappingGenerating && (
                    <div className="st-map-section" style={{ textAlign: 'center', padding: '3rem' }}>
                        <div className="st-spinner" style={{ margin: '0 auto 1rem' }} />
                        <p style={{ fontWeight: 600, color: '#374151' }}>Generating AI mockups...</p>
                        <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>This may take 30-60 seconds per product</p>
                    </div>
                )}

                {/* Footer */}
                <div className="st-map-footer">
                    <div className="st-map-footer-left">
                        <button onClick={() => {
                            setMappingStep(1);
                            setMappingPrint(null);
                            setMappingPrintPreview(null);
                            setMappingSelectedProducts(new Set());
                            setMappingResults([]);
                            setMappingControls({ scale: 120, posX: 10, posY: -5, rotate: 0, flipH: false, flipV: false });
                        }}>Cancel</button>
                    </div>
                    <div className="st-map-footer-right">
                        <button className="st-map-draft-btn">Save as Draft</button>
                        <button
                            className="st-map-primary-btn"
                            disabled={!mappingPrint || mappingSelectedProducts.size === 0 || isMappingGenerating}
                            onClick={generateMockups}
                        >
                            {isMappingGenerating ? (
                                <><div className="st-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Generating...</>
                            ) : (
                                <>Map & Preview <I d="M5 12h14M12 5l7 7-7 7" s={16} /></>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
    };
    // ===== ADMIN WORKSPACE RENDER =====
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

    // Admin Projects & Dashboard state
    const [adminProjects, setAdminProjects] = useState([]);
    const [adminProjectsLoading, setAdminProjectsLoading] = useState(false);
    const [showCreateUserModal, setShowCreateUserModal] = useState(false);
    const [createUserForm, setCreateUserForm] = useState({ email: '', password: '', name: '', role: 'user', plan: 'Business Studio', creditsLimit: '25000', freeGenerations: '10' });
    const [createUserFeedback, setCreateUserFeedback] = useState('');
    const [adminStats, setAdminStats] = useState({ totalUsers: 0, totalProjects: 0, recentLogs: [] });

    useEffect(() => {
        if (tool === 'admin-dashboard') {
            // Fetch summary stats
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
    }, [tool]);

    useEffect(() => {
        if (tool === 'admin-projects') {
            setAdminProjectsLoading(true);
            fetch(`${API}/api/admin/projects`, { headers: { 'Authorization': `Bearer ${currentToken}` } })
                .then(r => r.json())
                .then(d => { if (d.success) setAdminProjects(d.projects); })
                .catch(() => { })
                .finally(() => setAdminProjectsLoading(false));
        }
    }, [tool]);

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
                    setCreateUserFeedback('âœ“ ' + d.message);
                    setShowCreateUserModal(false);
                    setCreateUserForm({ email: '', password: '', name: '', role: 'user', plan: 'Business Studio', creditsLimit: '25000', freeGenerations: '10' });
                    fetchAdminUsers();
                } else {
                    setCreateUserFeedback('âœ— ' + (d.error || 'Failed'));
                }
            });
        setTimeout(() => setCreateUserFeedback(''), 5000);
    };

    const handleDeleteUser = (userId, userName) => {
        if (!confirm(`Delete user "${userName}"? This cannot be undone.`)) return;
        fetch(`${API}/api/admin/delete-user/${userId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${currentToken}` } })
            .then(r => r.json())
            .then(d => {
                if (d.success) fetchAdminUsers();
                else alert(d.error || 'Failed to delete user');
            });
    };

    const renderAdminDashboard = () => {
        const costByModel = {};
        adminStats.recentLogs.forEach(log => {
            costByModel[log.model_name] = (costByModel[log.model_name] || 0) + (log.cost_usd || 0);
        });
        return (
            <div className="admin-workspace-panel animate-fade-in">
                {renderBudgetBanner()}
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
                        <button className="admin-btn-primary" style={{ padding: '4px 14px', fontSize: '12px' }} onClick={() => setTool('admin-users')}>Manage â†’</button>
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
                        <button className="admin-btn-primary" style={{ padding: '4px 14px', fontSize: '12px' }} onClick={() => setTool('admin-logs')}>View All â†’</button>
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

    const renderAdminProjects = () => (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner()}
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
                            {adminProjects.map(p => (
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
                                    <td style={{ padding: '10px 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : 'â€”'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );

    const renderBudgetBanner = () => {
        const pct = budgetData.budget > 0 ? Math.min(100, (budgetData.totalSpent / budgetData.budget) * 100) : 0;
        const isLow = budgetData.remaining < 2;
        const isCritical = budgetData.remaining < 0.5;
        return (
            <div className={`admin-card glassmorphism-card`} style={{ marginBottom: '16px', padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" s={18} />
                        <strong style={{ fontSize: '14px' }}>Replicate Account Balance</strong>
                    </div>
                    {!budgetEditing ? (
                        <button className="admin-btn-primary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => { setBudgetInput(String(budgetData.budget)); setBudgetEditing(true); }}>
                            Update Balance
                        </button>
                    ) : (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <input type="number" step="0.01" value={budgetInput} onChange={e => setBudgetInput(e.target.value)} className="admin-input" style={{ width: '100px', padding: '4px 8px', fontSize: '12px' }} placeholder="$" />
                            <button className="admin-btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={handleBudgetUpdate}>Save</button>
                            <button style={{ padding: '4px 10px', fontSize: '12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => setBudgetEditing(false)}>Cancel</button>
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '24px', fontSize: '13px', marginBottom: '8px' }}>
                    <div><span style={{ color: 'var(--text-secondary)' }}>Budget:</span> <strong>${budgetData.budget.toFixed(2)}</strong></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>Spent:</span> <strong style={{ color: '#ff6b6b' }}>${budgetData.totalSpent.toFixed(4)}</strong></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>Remaining:</span> <strong style={{ color: isCritical ? '#ff4444' : isLow ? '#ffa726' : '#4caf50' }}>${budgetData.remaining.toFixed(2)}</strong></div>
                </div>
                <div style={{ width: '100%', height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: isCritical ? '#ff4444' : isLow ? '#ffa726' : 'linear-gradient(90deg, #4caf50, #66bb6a)', borderRadius: '3px', transition: 'width 0.5s ease' }} />
                </div>
                {isCritical && <div style={{ color: '#ff4444', fontSize: '12px', marginTop: '6px', fontWeight: 600 }}>âš  Critical: Balance very low! Top up your Replicate account.</div>}
                {isLow && !isCritical && <div style={{ color: '#ffa726', fontSize: '12px', marginTop: '6px' }}>âš  Low balance â€” consider topping up soon.</div>}
            </div>
        );
    };

    const renderAdminUsers = () => (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner()}
            {createUserFeedback && <div style={{ padding: '8px 16px', marginBottom: '12px', borderRadius: '8px', background: createUserFeedback.startsWith('âœ“') ? '#22c55e20' : '#ef444420', color: createUserFeedback.startsWith('âœ“') ? '#22c55e' : '#ef4444', fontSize: '13px', fontWeight: 500 }}>{createUserFeedback}</div>}
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
                            { label: 'Password', key: 'password', type: 'password', placeholder: 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢' },
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

    const renderAdminLogs = () => (
        <div className="admin-workspace-panel animate-fade-in">
            {renderBudgetBanner()}
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

    const renderAdminCredits = () => {
        const selectedUser = adminUsers.find(u => u.id === adminSelectedUserId);
        return (
            <div className="admin-workspace-panel animate-fade-in">
                {renderBudgetBanner()}
                <div className="admin-card glassmorphism-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
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
            </div>
        );
    };
    // ===== END ADMIN RENDER =====

    const renderColorways = () => {
        return (
            <div className="st-tool-content st-colorways">
                <div className="st-canvas-container" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>

                    <div className="st-panel st-panel-left" style={{ flex: '1 1 300px', maxWidth: '400px', backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1.5rem', color: 'var(--text)' }}>Color Palette</h3>

                        {!cwExtractedPalette.length ? (
                            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                                <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>Extract colors from your uploaded image to get started.</p>
                                <button
                                    className="st-btn primary"
                                    onClick={extractColors}
                                    disabled={!uploaded || isCwExtracting}
                                    style={{ width: '100%' }}
                                >
                                    {isCwExtracting ? 'Extracting...' : 'Extract Colors'}
                                </button>
                            </div>
                        ) : (
                            <div className="st-cw-palette-editor">
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Color Mapping</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {cwTargetPalette.map((mapping, idx) => (
                                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                                    <span style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: mapping.old, border: '1px solid var(--border)' }}></span>
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{mapping.old}</span>
                                                </div>
                                                <I d="M14 5l7 7m0 0l-7 7m7-7H3" s={14} />
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                                    <input
                                                        type="color"
                                                        value={mapping.new}
                                                        onChange={(e) => {
                                                            const newPalette = [...cwTargetPalette];
                                                            newPalette[idx].new = e.target.value;
                                                            setCwTargetPalette(newPalette);
                                                        }}
                                                        style={{ width: '30px', height: '30px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                                    />
                                                    <input
                                                        type="text"
                                                        value={mapping.new}
                                                        onChange={(e) => {
                                                            const newPalette = [...cwTargetPalette];
                                                            newPalette[idx].new = e.target.value;
                                                            setCwTargetPalette(newPalette);
                                                        }}
                                                        style={{ width: '70px', fontSize: '0.8rem', fontFamily: 'monospace', padding: '0.25rem', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '4px' }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        className="st-btn"
                                        onClick={() => setCwTargetPalette(cwExtractedPalette.map(p => ({ old: p.hex, new: p.hex })))}
                                        style={{ flex: 1 }}
                                    >
                                        Reset
                                    </button>
                                    <button
                                        className="st-btn primary"
                                        onClick={generateColorway}
                                        disabled={isCwRecoloring}
                                        style={{ flex: 2 }}
                                    >
                                        {isCwRecoloring ? 'Generating...' : 'Generate (10 cr)'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="st-panel st-panel-right" style={{ flex: '2 1 500px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        {cwUrl ? (
                            <div className="st-preview-card" style={{ backgroundColor: 'var(--card-bg)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                                <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Latest Colorway</h3>
                                <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', backgroundColor: 'var(--bg)', borderRadius: '8px', overflow: 'hidden' }}>
                                    <img src={`${API}${cwUrl}`} alt="Recolored" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                </div>
                                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                                    <a href={`${API}${cwUrl}`} onClick={(e) => forceDownload(e, `${API}${cwUrl}`)} className="st-dl-btn">
                                        <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={16} /> Download
                                    </a>
                                </div>
                            </div>
                        ) : uploaded ? (
                            <div className="st-preview-card" style={{ backgroundColor: 'var(--card-bg)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                                <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Original Artwork</h3>
                                <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', backgroundColor: 'var(--bg)', borderRadius: '8px', overflow: 'hidden' }}>
                                    <img src={preview} alt="Original" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: '16px' }}>
                                Upload an image to start recoloring
                            </div>
                        )}

                        {cwVariations.length > 0 && (
                            <div className="st-variations-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem' }}>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text)', fontSize: '1.1rem' }}>Recent Variations</h3>
                                </div>
                                {cwVariations.map((v, i) => (
                                    <div key={i} style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => { setCwUrl(v.url); setCwTargetPalette([...v.targetPalette]); }}>
                                        <img src={`${API}${v.url}`} alt={`Variation ${i}`} style={{ width: '100%', display: 'block', aspectRatio: '1/1', objectFit: 'cover' }} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        );
    };

    const renderVectorPro = () => {
        return (
            <div className="st-tool-content st-vectorpro">
                {/* Tab bar */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                    <button className={`st-btn ${vpTab === 'reduce' ? 'primary' : ''}`} onClick={() => setVpTab('reduce')} style={{ flex: 1 }}>
                        <I d="M4 6h16M4 12h10M4 18h6" s={16} /> Color Reduce
                    </button>
                    <button className={`st-btn ${vpTab === 'lookup' ? 'primary' : ''}`} onClick={() => setVpTab('lookup')} style={{ flex: 1 }}>
                        <I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" s={16} /> Pantone Lookup
                    </button>
                </div>

                {vpTab === 'reduce' ? (
                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        {/* Controls */}
                        <div style={{ flex: '1 1 280px', maxWidth: '360px', backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Reduce Colors</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                                Quantize your design to a fixed number of colors for screen printing, then auto-match each to the nearest Pantone.
                            </p>

                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                Target Colors: <strong style={{ color: 'var(--text)' }}>{vpBrandPaletteId ? 'Brand Palette Enforced' : vpNumColors}</strong>
                            </label>
                            {!vpBrandPaletteId && (
                                <input
                                    type="range"
                                    min={2} max={16} step={1}
                                    value={vpNumColors}
                                    onChange={(e) => setVpNumColors(Number(e.target.value))}
                                    style={{ width: '100%', marginBottom: '1.5rem', accentColor: 'var(--primary)' }}
                                />
                            )}

                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                Brand Style Enforcement
                            </label>
                            <select
                                className="st-input"
                                value={vpBrandPaletteId}
                                onChange={e => setVpBrandPaletteId(e.target.value)}
                                style={{ width: '100%', marginBottom: '1.5rem', cursor: 'pointer' }}
                            >
                                <option value="">None (Auto-Extract)</option>
                                {brandPalettes.map(p => (
                                    <option key={p.id} value={p.id}>{p.name} ({p.colors.length} colors)</option>
                                ))}
                            </select>

                            <button
                                className="st-btn primary"
                                onClick={reduceColors}
                                disabled={!uploaded || isVpReducing}
                                style={{ width: '100%' }}
                            >
                                {isVpReducing ? 'Reducing...' : `Reduce & Match (10 cr)`}
                            </button>

                            {/* Layer Export buttons â€” show after reduction */}
                            {vpPalette.length > 0 && (
                                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        className="st-btn"
                                        onClick={() => exportLayers('zip')}
                                        disabled={!!layerExportLoading}
                                        style={{ flex: 1, fontSize: '0.8rem', padding: '0.5rem' }}
                                    >
                                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={13} />
                                        {layerExportLoading === 'zip' ? '...' : 'Layers ZIP'}
                                    </button>
                                    <button
                                        className="st-btn"
                                        onClick={() => exportLayers('tiff')}
                                        disabled={!!layerExportLoading}
                                        style={{ flex: 1, fontSize: '0.8rem', padding: '0.5rem' }}
                                    >
                                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={13} />
                                        {layerExportLoading === 'tiff' ? '...' : 'Layers TIFF'}
                                    </button>
                                </div>
                            )}
                            {vpPalette.length > 0 && (
                                <div style={{ marginTop: '1.5rem' }}>
                                    <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: 'var(--text)' }}>Matched Palette</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {vpPalette.map((color, idx) => (
                                            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.5rem', backgroundColor: 'var(--bg)', borderRadius: '8px' }}>
                                                <span style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundColor: color.hex, border: '1px solid var(--border)', flexShrink: 0 }}></span>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text)' }}>{color.hex.toUpperCase()}</span>
                                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{(color.weight * 100).toFixed(1)}%</span>
                                                    </div>
                                                    {color.pantoneMatches && color.pantoneMatches.length > 0 && (
                                                        <div style={{ marginTop: '0.25rem' }}>
                                                            <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                                                                {color.pantoneMatches[0].name}
                                                            </span>
                                                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                                                                Î”E {color.pantoneMatches[0].deltaE}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Preview */}
                        <div style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {vpReducedUrl ? (
                                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                                    <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Quantized Result ({vpNumColors} colors)</h3>
                                    <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', backgroundColor: 'var(--bg)', borderRadius: '8px', overflow: 'hidden' }}>
                                        <img src={`${API}${vpReducedUrl}`} alt="Quantized" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                    </div>
                                    <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                                        <a href={`${API}${vpReducedUrl}`} onClick={(e) => forceDownload(e, `${API}${vpReducedUrl}`)} className="st-dl-btn">
                                            <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={16} /> Download
                                        </a>
                                    </div>
                                </div>
                            ) : uploaded ? (
                                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                                    <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Original Artwork</h3>
                                    <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', backgroundColor: 'var(--bg)', borderRadius: '8px', overflow: 'hidden' }}>
                                        <img src={preview} alt="Original" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: '16px' }}>
                                    Upload an image to start reducing colors
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* Pantone Lookup Tab */
                    <div style={{ maxWidth: '600px' }}>
                        <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Pantone Color Lookup</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                                Enter any hex color to find the closest Pantone TCX matches using Delta-E 2000 perceptual distance.
                            </p>
                            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                <input
                                    type="color"
                                    value={vpLookupHex}
                                    onChange={(e) => setVpLookupHex(e.target.value)}
                                    style={{ width: '48px', height: '40px', padding: 0, border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                                />
                                <input
                                    type="text"
                                    value={vpLookupHex}
                                    onChange={(e) => setVpLookupHex(e.target.value)}
                                    placeholder="#ff6f61"
                                    className="st-input"
                                    style={{ flex: 1, fontFamily: 'monospace' }}
                                />
                                <button
                                    className="st-btn primary"
                                    onClick={() => lookupPantone(vpLookupHex)}
                                    disabled={isVpLooking || vpLookupHex.length < 4}
                                >
                                    {isVpLooking ? '...' : 'Match'}
                                </button>
                            </div>

                            {vpLookupResults.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Top Matches</h4>
                                    {vpLookupResults.map((m, idx) => (
                                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg)', borderRadius: '10px', border: idx === 0 ? '2px solid var(--primary)' : '1px solid var(--border)' }}>
                                            <span style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: m.hex, border: '1px solid var(--border)', flexShrink: 0 }}></span>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>{m.name}</div>
                                                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.2rem' }}>
                                                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{m.hex.toUpperCase()}</span>
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>RGB({m.rgb.join(', ')})</span>
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: m.deltaE < 5 ? '#22c55e' : m.deltaE < 10 ? '#eab308' : '#ef4444' }}>
                                                    {m.deltaE}
                                                </div>
                                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Î”E 2000</div>
                                            </div>
                                        </div>
                                    ))}
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.5rem 0 0 0' }}>
                                        Î”E {'<'} 2 = imperceptible Â· Î”E {'<'} 5 = close match Â· Î”E {'>'} 10 = different color
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ===== RENDER PRINT ADVISOR =====
    const renderPrintAdvisor = () => {
        const fabricTypes = [
            { id: 'cotton', label: 'Cotton', icon: 'ðŸŒ¿' },
            { id: 'polyester', label: 'Polyester', icon: 'ðŸ§µ' },
            { id: 'silk', label: 'Silk', icon: 'âœ¨' },
            { id: 'linen', label: 'Linen', icon: 'ðŸŒ¾' },
            { id: 'nylon', label: 'Nylon', icon: 'ðŸ”—' },
            { id: 'rayon', label: 'Rayon', icon: 'ðŸ’§' },
        ];
        const methodColors = {
            'Screen Printing': '#22c55e',
            'Digital Printing': '#3b82f6',
            'Rotary Printing': '#f59e0b',
            'Sublimation': '#a855f7',
            'Block Printing': '#ec4899',
            'Discharge Printing': '#14b8a6',
        };
        return (
            <div className="st-tool-content" style={{ maxWidth: '1100px', margin: '0 auto' }}>
                {/* Configuration */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                        <div className="st-group-title">FABRIC TYPE</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginTop: '0.75rem' }}>
                            {fabricTypes.map(f => (
                                <button key={f.id} className={`st-btn ${printAdvisorFabric === f.id ? 'primary' : ''}`}
                                    onClick={() => setPrintAdvisorFabric(f.id)}
                                    style={{ flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 0.5rem', fontSize: '0.8rem' }}>
                                    <span style={{ fontSize: '1.2rem' }}>{f.icon}</span>{f.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                        <div className="st-group-title">PRODUCTION VOLUME</div>
                        <div style={{ marginTop: '0.75rem' }}>
                            <label className="st-label">Estimated yards/meters</label>
                            <input type="number" value={printAdvisorVolume} onChange={e => setPrintAdvisorVolume(Math.max(1, parseInt(e.target.value) || 0))}
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '1rem' }} />
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                                {[50, 200, 500, 1000, 5000, 10000].map(v => (
                                    <button key={v} className={`st-btn ${printAdvisorVolume === v ? 'primary' : ''}`}
                                        onClick={() => setPrintAdvisorVolume(v)} style={{ fontSize: '0.75rem', padding: '0.4rem 0.75rem' }}>
                                        {v.toLocaleString()}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <button className="st-btn primary" onClick={analyzePrintMethod}
                            disabled={!uploaded || isPrintAdvisorLoading}
                            style={{ width: '100%', marginTop: '1.25rem', padding: '0.85rem', fontWeight: 600, fontSize: '0.9rem' }}>
                            {isPrintAdvisorLoading ? <><div className="st-spinner" style={{ width: 16, height: 16 }} /> Analyzing Pattern...</> : <><I d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" s={16} /> Analyze Print Method</>}
                        </button>
                    </div>
                </div>

                {/* Results */}
                {printAdvisorResult && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        {/* Pattern Analysis Summary */}
                        <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <div className="st-group-title">PATTERN ANALYSIS</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1rem' }}>
                                {[
                                    ['Colors', printAdvisorResult.colorCount, printAdvisorResult.colorCount <= 8 ? '#22c55e' : printAdvisorResult.colorCount <= 16 ? '#f59e0b' : '#ef4444'],
                                    ['Detail', printAdvisorResult.detailLevel, '#3b82f6'],
                                    ['Gradients', printAdvisorResult.hasGradients ? 'Yes' : 'No', printAdvisorResult.hasGradients ? '#f59e0b' : '#22c55e'],
                                    ['Min Feature', `${printAdvisorResult.minFeatureSize}px`, '#a855f7'],
                                ].map(([label, value, color]) => (
                                    <div key={label} style={{ textAlign: 'center', padding: '1rem', borderRadius: '12px', background: `${color}15`, border: `1px solid ${color}30` }}>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Recommendations */}
                        <div className="st-group-title" style={{ marginBottom: '-0.5rem' }}>RECOMMENDED PRINT METHODS</div>
                        {printAdvisorResult.recommendations?.map((rec, i) => (
                            <div key={rec.method} style={{
                                backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px',
                                border: i === 0 ? `2px solid ${methodColors[rec.method] || '#3b82f6'}` : '1px solid var(--border)',
                                position: 'relative'
                            }}>
                                {i === 0 && <div style={{ position: 'absolute', top: '-10px', left: '1rem', backgroundColor: methodColors[rec.method] || '#3b82f6', color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '2px 10px', borderRadius: '10px', textTransform: 'uppercase' }}>Best Match</div>}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                            <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{rec.method}</span>
                                            <div style={{ backgroundColor: `${methodColors[rec.method] || '#3b82f6'}20`, color: methodColors[rec.method] || '#3b82f6', padding: '2px 8px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600 }}>
                                                Score: {rec.score}/100
                                            </div>
                                        </div>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.5rem 0', lineHeight: 1.5 }}>{rec.reasoning}</p>
                                    </div>
                                    <div style={{ textAlign: 'right', minWidth: '140px' }}>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: methodColors[rec.method] || '#3b82f6' }}>{rec.costEstimate}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>per yard est.</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Min: {rec.minOrder}</div>
                                    </div>
                                </div>
                                {/* Progress bar */}
                                <div style={{ marginTop: '0.75rem', height: '6px', borderRadius: '3px', backgroundColor: 'var(--bg)', overflow: 'hidden' }}>
                                    <div style={{ width: `${rec.score}%`, height: '100%', borderRadius: '3px', backgroundColor: methodColors[rec.method] || '#3b82f6', transition: 'width 0.5s ease' }} />
                                </div>
                                {rec.filePrep && (
                                    <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '10px', backgroundColor: 'var(--bg)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        <strong style={{ color: 'var(--text)' }}>File Prep:</strong> {rec.filePrep}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // ===== RENDER COLORWAY MANAGER =====
    const renderColorwayManager = () => {
        const strategies = [
            { id: 'complementary', label: 'Complementary', desc: 'Opposite colors on the wheel' },
            { id: 'analogous', label: 'Analogous', desc: 'Adjacent colors, harmonious' },
            { id: 'triadic', label: 'Triadic', desc: 'Three evenly spaced colors' },
            { id: 'monochrome', label: 'Monochrome', desc: 'Variations of a single hue' },
            { id: 'seasonal_warm', label: 'Warm Season', desc: 'Autumn/spring warm palette' },
            { id: 'seasonal_cool', label: 'Cool Season', desc: 'Winter/summer cool palette' },
        ];
        return (
            <div className="st-tool-content" style={{ maxWidth: '1200px', margin: '0 auto' }}>
                {/* Palette Extraction */}
                {cwmPalette.length === 0 ? (
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '2.5rem', borderRadius: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>ðŸŽ¨</div>
                        <h3 style={{ color: 'var(--text)', margin: '0 0 0.5rem 0' }}>Extract Base Palette</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Upload a pattern above, then extract its color palette to generate production colorways.</p>
                        <button className="st-btn primary" onClick={cwmExtractPalette} disabled={!uploaded || isCwmGenerating}
                            style={{ padding: '0.85rem 2rem', fontWeight: 600 }}>
                            {isCwmGenerating ? <><div className="st-spinner" style={{ width: 16, height: 16 }} /> Extracting...</> : 'Extract Palette from Image'}
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Base Palette + Lock Controls */}
                        <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <div className="st-group-title" style={{ margin: 0 }}>BASE PALETTE</div>
                                <button className="st-btn" onClick={cwmExtractPalette} style={{ fontSize: '0.75rem' }}>Re-extract</button>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                {cwmPalette.map((c, i) => (
                                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
                                        <div style={{ width: '56px', height: '56px', borderRadius: '12px', backgroundColor: c.hex, border: '2px solid var(--border)', cursor: 'pointer', position: 'relative' }}
                                            title={`${c.hex} (${(c.weight * 100).toFixed(1)}%)`}>
                                            {cwmLockedColors.has(i) && (
                                                <div style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <I d="M12 17v-2m-4 4h8m-4-14a4 4 0 014 4v2a2 2 0 01-2 2H10a2 2 0 01-2-2V9a4 4 0 014-4z" s={10} />
                                                </div>
                                            )}
                                        </div>
                                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{c.hex}</span>
                                        <button className="st-btn" onClick={() => setCwmLockedColors(prev => {
                                            const next = new Set(prev);
                                            next.has(i) ? next.delete(i) : next.add(i);
                                            return next;
                                        })} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                                            {cwmLockedColors.has(i) ? 'ðŸ”’ Locked' : 'ðŸ”“ Lock'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Strategy Picker */}
                        <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', marginBottom: '1.25rem' }}>
                            <div className="st-group-title">COLOR STRATEGY</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginTop: '0.75rem' }}>
                                {strategies.map(s => (
                                    <button key={s.id} className={`st-btn ${cwmStrategy === s.id ? 'primary' : ''}`}
                                        onClick={() => setCwmStrategy(s.id)}
                                        style={{ flexDirection: 'column', gap: '0.15rem', padding: '0.75rem', textAlign: 'left', alignItems: 'flex-start' }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{s.label}</span>
                                        <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{s.desc}</span>
                                    </button>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                                <button className="st-btn primary" onClick={cwmGenerateColorways} disabled={isCwmGenerating}
                                    style={{ flex: 1, padding: '0.85rem', fontWeight: 600 }}>
                                    {isCwmGenerating ? <><div className="st-spinner" style={{ width: 16, height: 16 }} /> Generating...</> : 'ðŸŽ¨ Generate 4 Colorways'}
                                </button>
                                {cwmColorways.length > 0 && (
                                    <button className="st-btn" onClick={cwmExportLineCard} disabled={isCwmExporting}
                                        style={{ padding: '0.85rem 1.5rem' }}>
                                        {isCwmExporting ? 'Exporting...' : 'ðŸ“„ Export Line Card PDF'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Generated Colorways Grid */}
                        {cwmColorways.length > 0 && (
                            <div>
                                <div className="st-group-title">GENERATED COLORWAYS</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem', marginTop: '0.75rem' }}>
                                    {cwmColorways.map((cw, i) => (
                                        <div key={i} style={{ backgroundColor: 'var(--card-bg)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                            {cw.resultUrl && (
                                                <div style={{ aspectRatio: '1', overflow: 'hidden' }}>
                                                    <img src={`${API}${cw.resultUrl}`} alt={`Colorway ${i + 1}`}
                                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                </div>
                                            )}
                                            <div style={{ padding: '1rem' }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)', marginBottom: '0.5rem' }}>
                                                    Colorway {i + 1} â€” {cw.strategy || cwmStrategy}
                                                </div>
                                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                    {cw.colors?.map((hex, j) => (
                                                        <div key={j} style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: hex, border: '1px solid var(--border)' }} title={hex} />
                                                    ))}
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                                    {cw.resultUrl && <button className="st-btn" onClick={(e) => forceDownload(e, `${API}${cw.resultUrl}`)} style={{ fontSize: '0.75rem', flex: 1 }}>Download</button>}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    };

    // ===== RENDER MEASUREMENT TOOL =====
    const renderMeasurement = () => {
        const imgWidth = uploaded ? (uploaded.width || 1024) : 1024;
        const imgHeight = uploaded ? (uploaded.height || 1024) : 1024;
        const pxPerUnit = measureUnit === 'inches' ? measureDpi : measureDpi / 2.54;
        const realWidth = (imgWidth / pxPerUnit).toFixed(2);
        const realHeight = (imgHeight / pxPerUnit).toFixed(2);
        const repeatWidth = (controls.printWidth || 12);
        const scaleFactor = (controls.scale || 100) / 100;
        const effectiveRepeatW = (repeatWidth * scaleFactor).toFixed(2);
        const motifsPerYard = measureUnit === 'inches' ? (36 / parseFloat(realHeight)).toFixed(1) : ((91.44 / 2.54) / parseFloat(realHeight)).toFixed(1);

        return (
            <div className="st-tool-content" style={{ maxWidth: '1100px', margin: '0 auto' }}>
                {/* Settings */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                        <div className="st-group-title">UNITS</div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                            {['inches', 'cm'].map(u => (
                                <button key={u} className={`st-btn ${measureUnit === u ? 'primary' : ''}`}
                                    onClick={() => setMeasureUnit(u)} style={{ flex: 1, textTransform: 'capitalize' }}>{u}</button>
                            ))}
                        </div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                        <div className="st-group-title">DPI</div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                            {[72, 150, 300, 600].map(d => (
                                <button key={d} className={`st-btn ${measureDpi === d ? 'primary' : ''}`}
                                    onClick={() => setMeasureDpi(d)} style={{ flex: 1, fontSize: '0.8rem' }}>{d}</button>
                            ))}
                        </div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                        <div className="st-group-title">OVERLAYS</div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                            <button className={`st-btn ${measureShowRuler ? 'primary' : ''}`} onClick={() => setMeasureShowRuler(!measureShowRuler)} style={{ flex: 1, fontSize: '0.8rem' }}>ðŸ“ Ruler</button>
                            <button className={`st-btn ${measureShowGrid ? 'primary' : ''}`} onClick={() => setMeasureShowGrid(!measureShowGrid)} style={{ flex: 1, fontSize: '0.8rem' }}>ðŸ“ Grid</button>
                        </div>
                    </div>
                </div>

                {/* Dimensions Display */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                    {[
                        ['Tile Width', `${realWidth} ${measureUnit}`, '#3b82f6', `${imgWidth}px`],
                        ['Tile Height', `${realHeight} ${measureUnit}`, '#22c55e', `${imgHeight}px`],
                        ['Print Width', `${effectiveRepeatW} ${measureUnit}`, '#f59e0b', `Scale: ${controls.scale}%`],
                        ['Repeats/Yard', motifsPerYard, '#a855f7', 'vertical repeats'],
                    ].map(([label, value, color, sub]) => (
                        <div key={label} style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: `1px solid ${color}30`, textAlign: 'center' }}>
                            <div style={{ fontSize: '1.8rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', marginTop: '0.5rem' }}>{label}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{sub}</div>
                        </div>
                    ))}
                </div>

                {/* Visual Preview with Rulers */}
                <div style={{ backgroundColor: 'var(--card-bg)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', position: 'relative' }}>
                    {/* Top ruler */}
                    {measureShowRuler && (
                        <div style={{ height: '28px', backgroundColor: 'var(--bg)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-end', paddingLeft: '28px', overflow: 'hidden' }}>
                            {Array.from({ length: Math.ceil(parseFloat(realWidth)) + 1 }, (_, i) => (
                                <div key={i} style={{ position: 'relative', flex: `0 0 ${100 / (parseFloat(realWidth) || 1)}%`, borderLeft: '1px solid var(--text-muted)', height: '100%' }}>
                                    <span style={{ position: 'absolute', top: '2px', left: '4px', fontSize: '0.6rem', color: 'var(--text-muted)' }}>{i}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    <div style={{ display: 'flex' }}>
                        {/* Left ruler */}
                        {measureShowRuler && (
                            <div style={{ width: '28px', backgroundColor: 'var(--bg)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                                {Array.from({ length: Math.ceil(parseFloat(realHeight)) + 1 }, (_, i) => (
                                    <div key={i} style={{ position: 'relative', flex: `0 0 ${100 / (parseFloat(realHeight) || 1)}%`, borderTop: '1px solid var(--text-muted)' }}>
                                        <span style={{ position: 'absolute', top: '2px', left: '3px', fontSize: '0.6rem', color: 'var(--text-muted)', writingMode: 'vertical-rl' }}>{i}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Image with grid overlay */}
                        <div style={{ flex: 1, position: 'relative', minHeight: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                            {preview ? (
                                <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '500px' }}>
                                    <img src={preview.startsWith('http') || preview.startsWith('/') ? `${API}${preview}` : preview} alt="Pattern"
                                        style={{ maxWidth: '100%', maxHeight: '500px', objectFit: 'contain', borderRadius: '8px' }} />
                                    {measureShowGrid && (
                                        <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent calc(100% / ${controls.gridSize || 2} - 1px), rgba(255,255,255,0.15) calc(100% / ${controls.gridSize || 2} - 1px), rgba(255,255,255,0.15) calc(100% / ${controls.gridSize || 2})), repeating-linear-gradient(90deg, transparent, transparent calc(100% / ${controls.gridSize || 2} - 1px), rgba(255,255,255,0.15) calc(100% / ${controls.gridSize || 2} - 1px), rgba(255,255,255,0.15) calc(100% / ${controls.gridSize || 2}))`, pointerEvents: 'none', borderRadius: '8px' }} />
                                    )}
                                </div>
                            ) : (
                                <div className="st-empty-canvas"><p>Upload an image to see measurements</p></div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Production Warnings */}
                {uploaded && (
                    <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {measureDpi < 150 && (
                            <div style={{ padding: '0.75rem 1rem', borderRadius: '12px', backgroundColor: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: '0.85rem' }}>
                                âš ï¸ <strong>Low DPI Warning:</strong> {measureDpi} DPI is below the minimum for production printing (150 DPI). Consider upscaling your image.
                            </div>
                        )}
                        {parseFloat(realWidth) < 2 && (
                            <div style={{ padding: '0.75rem 1rem', borderRadius: '12px', backgroundColor: '#f59e0b20', border: '1px solid #f59e0b40', color: '#f59e0b', fontSize: '0.85rem' }}>
                                âš ï¸ <strong>Small Tile:</strong> Your tile is only {realWidth} {measureUnit} wide. Most fabric prints need at least 4-6 inches for visible motif detail.
                            </div>
                        )}
                        {measureDpi >= 300 && parseFloat(realWidth) >= 4 && (
                            <div style={{ padding: '0.75rem 1rem', borderRadius: '12px', backgroundColor: '#22c55e20', border: '1px solid #22c55e40', color: '#22c55e', fontSize: '0.85rem' }}>
                                âœ… <strong>Print Ready:</strong> Resolution and dimensions meet production quality requirements.
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderCanvas = () => {
        if (tool === 'admin-dashboard') return renderAdminDashboard();
        if (tool === 'admin-users') return renderAdminUsers();
        if (tool === 'admin-projects') return renderAdminProjects();
        if (tool === 'admin-logs') return renderAdminLogs();
        if (tool === 'admin-credits') return renderAdminCredits();
        if (tool === 'mappings') return renderMappings();
        if (tool === 'colorways') return renderColorways();
        if (tool === 'vectorpro') return renderVectorPro();
        if (tool === 'print-advisor') return renderPrintAdvisor();
        if (tool === 'colorway-manager') return renderColorwayManager();
        if (tool === 'measurement') return renderMeasurement();
        if (tool === 'mockup3d') {
            const garments = [
                { id: 'tshirt', label: 'T-Shirt', icon: 'M20.38 3.46L16 2 12 3.5 8 2 3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47c.06.37.29.68.62.84L8 12v8a1 1 0 001 1h6a1 1 0 001-1v-8l4.52-2a1 1 0 00.62-.84l.58-3.47a2 2 0 00-1.34-2.23z' },
                { id: 'dress', label: 'Dress', icon: 'M6.5 2h11l1 4H19l-3 14H8L5 6h.5l1-4zM12 2v4' },
                { id: 'totebag', label: 'Tote Bag', icon: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0' },
            ];
            return (
                <div className="st-tool-content" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', height: '100%' }}>
                    {/* Controls panel */}
                    <div style={{ flex: '1 1 260px', maxWidth: '320px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Garment Type</h3>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {garments.map(g => (
                                    <button
                                        key={g.id}
                                        className={`st-btn ${mockup3dGarment === g.id ? 'primary' : ''}`}
                                        onClick={() => setMockup3dGarment(g.id)}
                                        style={{ flex: 1, flexDirection: 'column', gap: '0.3rem', padding: '0.75rem 0.5rem' }}
                                    >
                                        <I d={g.icon} s={20} />
                                        <span style={{ fontSize: '0.75rem' }}>{g.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Pattern Tiling</h3>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Horizontal Repeat: <strong style={{ color: 'var(--text)' }}>{mockup3dTileX}x</strong>
                            </label>
                            <input type="range" min={1} max={8} step={1} value={mockup3dTileX}
                                onChange={e => setMockup3dTileX(Number(e.target.value))}
                                style={{ width: '100%', marginBottom: '1rem', accentColor: 'var(--primary)' }}
                            />
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                Vertical Repeat: <strong style={{ color: 'var(--text)' }}>{mockup3dTileY}x</strong>
                            </label>
                            <input type="range" min={1} max={8} step={1} value={mockup3dTileY}
                                onChange={e => setMockup3dTileY(Number(e.target.value))}
                                style={{ width: '100%', accentColor: 'var(--primary)' }}
                            />
                        </div>

                        <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text)' }}>
                                <input type="checkbox" checked={mockup3dAutoRotate} onChange={e => setMockup3dAutoRotate(e.target.checked)}
                                    style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }}
                                />
                                Auto-Rotate
                            </label>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                Drag to rotate manually Â· Scroll to zoom
                            </p>
                        </div>
                    </div>

                    {/* 3D Canvas */}
                    <div style={{ flex: '2 1 400px', backgroundColor: 'var(--card-bg)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', minHeight: '500px', position: 'relative' }}>
                        {preview ? (
                            <ReactSuspense fallback={
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                                    <div className="st-spinner" style={{ marginRight: '0.75rem' }} /> Loading 3D engine...
                                </div>
                            }>
                                <GarmentPreview3D
                                    patternUrl={preview}
                                    garmentType={mockup3dGarment}
                                    tileX={mockup3dTileX}
                                    tileY={mockup3dTileY}
                                    autoRotate={mockup3dAutoRotate}
                                />
                            </ReactSuspense>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '1rem', padding: '2rem', textAlign: 'center' }}>
                                <I d="M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" s={48} />
                                <p>Upload a pattern image to see it applied to a 3D garment mockup</p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        if (tool === 'dashboard') {
            return (
                <div className="st-pipeline-studio">
                    <div className="st-pl-tabs">
                        <button className={`st-pl-tab ${dashboardTab === 'run' ? 'active' : ''}`} onClick={() => setDashboardTab('run')}>
                            <I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={18} /> My Workflows
                        </button>
                        <button className={`st-pl-tab ${dashboardTab === 'build' ? 'active' : ''}`} onClick={() => setDashboardTab('build')}>
                            <I d="M12 5v14M5 12h14" s={18} /> Workflow Builder
                        </button>
                    </div>

                    {/* Saved Profiles */}
                    {dashboardTab === 'run' && savedProfiles.length > 0 && (
                        <div className="st-pl-section" style={{ marginBottom: '1.25rem' }}>
                            <h2 className="st-pl-section-num">Saved Workflows</h2>
                            <div className="st-pl-templates">
                                {savedProfiles.map(profile => (
                                    <div
                                        key={profile.id}
                                        className="st-pl-template-card profile-card"
                                        onClick={() => loadProfile(profile)}
                                    >
                                        <div className="st-pl-template-icon"><I d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" s={22} /></div>
                                        <strong>{profile.name}</strong>
                                        <span>{profile.steps.length} steps configured</span>
                                        <div className="st-pl-profile-actions">
                                            <button onClick={(e) => { e.stopPropagation(); runProfile(profile); }} title="Run"><I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={14} /></button>
                                            <button onClick={(e) => { e.stopPropagation(); loadProfile(profile); }} title="Edit"><I d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" s={14} /></button>
                                            <button className="danger" onClick={(e) => { e.stopPropagation(); deleteProfile(profile.id); }} title="Delete"><I d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" s={14} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {dashboardTab === 'run' && savedProfiles.length === 0 && (
                        <div className="st-pl-section" style={{ marginBottom: '1.25rem', textAlign: 'center', padding: '3rem 1rem' }}>
                            <h2 style={{ color: '#344054', marginBottom: '0.5rem' }}>No workflows found</h2>
                            <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Go to the Workflow Builder tab to create and save a custom pipeline!</p>
                        </div>
                    )}

                    {/* Section 1: Available Tools */}
                    {dashboardTab === 'build' && (
                        <div className="st-pl-section" style={{ marginBottom: '1.25rem' }}>
                            <h2 className="st-pl-section-num">Add Tools to Pipeline</h2>
                            <div className="st-pl-templates">
                                {STEP_TYPES.filter(t => t.type !== 'upload' && t.type !== 'export').map(toolDef => (
                                    <div
                                        key={toolDef.type}
                                        className="st-pl-template-card draggable"
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('stepType', toolDef.type);
                                        }}
                                        onClick={() => addPipelineStep(toolDef.type)}
                                    >
                                        <div className="st-pl-template-icon"><I d={toolDef.icon} s={22} /></div>
                                        <strong>{toolDef.label}</strong>
                                        <span>{toolDef.desc}</span>
                                        <div className="st-pl-drag-hint"><I d="M12 5v14M5 12h14" s={14} /> Add</div>
                                    </div>
                                ))}
                            </div>
                            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '1rem', textAlign: 'center' }}>
                                Click a tool or drag it into the builder below to insert it into your pipeline.
                            </p>
                        </div>
                    )}

                    {/* Section 2: Build Your Pipeline */}
                    <div className="st-pl-section">
                        <h2 className="st-pl-section-num">{dashboardTab === 'build' ? 'Build Your Pipeline' : 'Pipeline Configuration'}</h2>
                        <div
                            className={`st-pl-builder ${isDraggingOver && dashboardTab === 'build' ? 'drag-over' : ''}`}
                            onDragOver={dashboardTab === 'build' ? (e) => { e.preventDefault(); setIsDraggingOver(true); } : undefined}
                            onDragLeave={dashboardTab === 'build' ? () => setIsDraggingOver(false) : undefined}
                            onDrop={dashboardTab === 'build' ? (e) => {
                                e.preventDefault();
                                setIsDraggingOver(false);
                                const type = e.dataTransfer.getData('stepType');
                                if (type) addPipelineStep(type);
                            } : undefined}
                        >
                            {pipelineSteps.map((step, i) => {
                                const def = STEP_TYPES.find(d => d.type === step.type);
                                const isUploadStep = step.type === 'upload';
                                const uploadDone = isUploadStep && pipelineFile;
                                return (
                                    <React.Fragment key={step.id}>
                                        {i > 0 && <div className={`st-pl-connector ${step.status === 'done' || (i === 1 && uploadDone) ? 'done' : ''}`}><I d="M9 5l7 7-7 7" s={14} /></div>}
                                        <div
                                            className={`st-pl-step ${uploadDone ? 'done' : step.status}`}
                                            onClick={() => {
                                                if (isUploadStep) pipelineFileRef.current?.click();
                                                else if (step.resultUrl) setPipelinePreview(step.resultUrl);
                                            }}
                                        >
                                            <div className="st-pl-step-icon"><I d={def?.icon || ''} s={20} /></div>
                                            <div className="st-pl-step-label">{def?.label}</div>
                                            <div className="st-pl-step-desc">
                                                {isUploadStep && pipelineFile ? pipelineFile.originalName || 'Uploaded' : def?.desc}
                                                {step.type === 'repeat' && (
                                                    <select className="st-pl-step-select" disabled={dashboardTab === 'run'} onClick={e => e.stopPropagation()} value={step.settings?.gridSize || 3} onChange={e => updateStepSetting(step.id, 'gridSize', parseInt(e.target.value))}>
                                                        <option value="2">2x2 Grid</option>
                                                        <option value="3">3x3 Grid</option>
                                                        <option value="4">4x4 Grid</option>
                                                        <option value="6">6x6 Grid</option>
                                                    </select>
                                                )}
                                                {step.type === 'upscale' && (
                                                    <select className="st-pl-step-select" disabled={dashboardTab === 'run'} onClick={e => e.stopPropagation()} value={step.settings?.upscaleFactor || 'x4'} onChange={e => updateStepSetting(step.id, 'upscaleFactor', e.target.value)}>
                                                        <option value="x2">2x Upscale</option>
                                                        <option value="x4">4x Upscale</option>
                                                    </select>
                                                )}
                                                {step.type === 'export' && (
                                                    <select className="st-pl-step-select" disabled={dashboardTab === 'run'} onClick={e => e.stopPropagation()} value={step.settings?.outputFormat || 'PNG'} onChange={e => updateStepSetting(step.id, 'outputFormat', e.target.value)}>
                                                        <option value="PNG">PNG Output</option>
                                                        <option value="JPG">JPG Output</option>
                                                        <option value="TIFF">TIFF Output</option>
                                                    </select>
                                                )}
                                            </div>
                                            {(uploadDone || step.status === 'done') && <div className="st-pl-step-badge done"><I d="M5 13l4 4L19 7" s={12} /></div>}
                                            {step.status === 'running' && <div className="st-pl-step-badge running"><div className="st-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /></div>}
                                            {step.status === 'error' && <div className="st-pl-step-badge error"><I d="M6 18L18 6M6 6l12 12" s={12} /></div>}
                                            {!pipelineRunning && !isUploadStep && step.type !== 'export' && dashboardTab === 'build' && (
                                                <button className="st-pl-step-remove" onClick={(e) => { e.stopPropagation(); removePipelineStep(step.id); }}>Ã—</button>
                                            )}
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                            {/* {!pipelineRunning && (
                <div className="st-pl-add-wrapper">
                  <button className="st-pl-add-btn" onClick={() => setShowAddMenu(!showAddMenu)}>
                    <I d="M12 5v14M5 12h14" s={16} /> Add Step
                  </button>
                  {showAddMenu && (
                    <div className="st-pl-add-menu">
                      {STEP_TYPES.filter(t => t.type !== 'upload' && t.type !== 'export').map(t => (
                        <button key={t.type} className="st-pl-add-item" onClick={() => { addPipelineStep(t.type); setShowAddMenu(false); }}>
                          <I d={t.icon} s={16} /> {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )} */}
                        </div>
                    </div>

                    {/* Section 3: Run Pipeline */}
                    <div className="st-pl-run-section">
                        {dashboardTab === 'build' ? (
                            <input
                                type="text"
                                className="st-pl-name-input"
                                value={pipelineName}
                                onChange={e => setPipelineName(e.target.value)}
                                placeholder="Name your pipeline..."
                            />
                        ) : <div style={{ flex: 1 }} />}
                        <div className="st-pl-run-area">
                            <div className="st-pl-credits">Estimated Credits: <strong>{estimatedCredits}</strong></div>
                            {dashboardTab === 'build' && (
                                <button className="st-pl-save-btn" onClick={savePipelineProfile} disabled={pipelineRunning || pipelineSteps.length <= 2}>
                                    <I d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" s={18} /> Save Profile
                                </button>
                            )}
                            <button className="st-pl-run-btn" disabled={pipelineRunning || pipelineSteps.length === 0} onClick={runPipeline}>
                                {pipelineRunning ? <><div className="st-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Running...</> : <><I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={18} /> Run Pipeline</>}
                            </button>
                        </div>
                    </div>

                    {/* Pipeline upload for first step */}
                    {pipelineSteps.length > 0 && pipelineSteps[0]?.type === 'upload' && !pipelineFile && (
                        <div className="st-pl-upload-prompt" onClick={() => pipelineFileRef.current?.click()}>
                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={24} />
                            <strong>Upload your artwork to get started</strong>
                            <span>PNG, JPG up to 10MB</span>
                        </div>
                    )}
                    <input ref={pipelineFileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handlePreUpload(e.target.files[0], 'pipeline')} />
                </div>
            );
        }
        if (tool === 'repeat') {
            return (
                <div className="st-repeat-layout">
                    <div className="st-repeat-board">
                        <div className="st-repeat-toolbar">
                            <div className="st-tb-group">
                                <button className={`st-tb-btn ${isPanning ? 'active' : ''}`}><I d="M10 20l-4-4m0 0l4-4m-4 4h14M14 4l4 4m0 0l-4 4m4-4H4" s={16} /></button>
                                <button className="st-tb-btn"><I d="M12 5v14M5 12h14" s={16} /></button>
                            </div>
                            <div className="st-tb-group">
                                <button className="st-tb-btn" onClick={() => setCanvasZoom(z => Math.max(0.1, z - 0.1))}><I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" s={16} /></button>
                                <input type="range" min="0.1" max="3" step="0.05" value={canvasZoom} onChange={(e) => setCanvasZoom(parseFloat(e.target.value))} className="st-zoom-slider" />
                                <span className="st-zoom-text">{Math.round(canvasZoom * 100)}%</span>
                                <button className="st-tb-btn" onClick={() => { setCanvasZoom(1); setCanvasPan({ x: 0, y: 0 }) }} title="Fit to Screen"><I d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" s={16} /></button>
                                <button className="st-tb-btn active" title="Grid"><I d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" s={16} /></button>
                            </div>
                            <button className={`st-tb-btn-text ${showTileBoundary ? 'active' : ''}`} onClick={() => setShowTileBoundary(!showTileBoundary)}>
                                <I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={16} /> Show Tile Boundary
                            </button>
                        </div>
                        <div
                            className="st-repeat-canvas-container"
                            onWheel={handleWheel}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        >
                            <div
                                className="st-repeat-canvas-wrapper"
                                style={{ transform: `translate(-50%, -50%) translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom})` }}
                            >
                                <canvas ref={canvasRef} className="st-canvas-free" style={{ border: showTileBoundary ? '1px dashed #6366f1' : 'none' }} />
                            </div>
                        </div>
                        <div className="st-repeat-footer">
                            <span className="st-res-text">4096px &times; 3072px</span>
                            <div className="st-footer-actions">
                                <button><I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={14} /></button>
                                <button><I d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" s={14} /></button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }
        if (tool === 'exports') {
            const imageCount = exportsList.filter(f => f.type === 'image').length;
            const vectorCount = exportsList.filter(f => f.type === 'vector').length;

            const formatTimestamp = (ts) => {
                if (!ts) return '';
                const date = new Date(ts * 1000);
                const yyyy = date.getFullYear();
                const mm = String(date.getMonth() + 1).padStart(2, '0');
                const dd = String(date.getDate()).padStart(2, '0');

                let hours = date.getHours();
                const minutes = String(date.getMinutes()).padStart(2, '0');
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12;
                hours = hours ? hours : 12;
                const hh = String(hours).padStart(2, '0');

                return `${yyyy}-${mm}-${dd} ${hh}:${minutes} ${ampm}`;
            };

            const getToolInfo = (filename) => {
                if (filename.startsWith('repeat_')) {
                    const gridMatch = filename.match(/repeat_(\d+x\d+)_/);
                    const grid = gridMatch ? gridMatch[1] : '3x3';
                    return {
                        label: 'Repeat Set',
                        badgeClass: 'repeat',
                        icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
                        params: [`Grid: ${grid}`, 'DPI: 300', 'Tile Repeat']
                    };
                }
                if (filename.startsWith('vec_')) {
                    return {
                        label: 'Vectorize',
                        badgeClass: 'vectorize',
                        icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
                        params: ['Colors: 32', 'Engine: AI Local', 'Vector SVG']
                    };
                }
                if (filename.startsWith('upscale_')) {
                    return {
                        label: 'Upscale',
                        badgeClass: 'upscale',
                        icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
                        params: ['Factor: x4', 'DPI: 600', 'AI Upscale']
                    };
                }
                if (filename.startsWith('seamless_')) {
                    return {
                        label: 'Seamless Fix',
                        badgeClass: 'seamless',
                        icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z',
                        params: ['Seam Assess', 'Geometric Patch', 'Tileable']
                    };
                }
                if (filename.startsWith('mockup_')) {
                    return {
                        label: 'Mappings',
                        badgeClass: 'mappings',
                        icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z',
                        params: ['Product Mockup', '3D Map', 'Preview']
                    };
                }
                if (filename.startsWith('recolor_')) {
                    return {
                        label: 'Colorway',
                        badgeClass: 'generic',
                        icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
                        params: ['Palette Swap', 'Color Map', 'Recolor']
                    };
                }
                if (filename.startsWith('techpack_')) {
                    return {
                        label: 'Tech Pack',
                        badgeClass: 'generic',
                        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
                        params: ['PDF', 'Color Palette', 'Specs']
                    };
                }
                return {
                    label: 'AI Export',
                    badgeClass: 'generic',
                    icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
                    params: ['Auto-save', 'History']
                };
            };

            const renderOriginalImage = (src) => {
                if (src) {
                    return <img src={src} alt="Original Input" className="st-export-log-image" loading="lazy" />;
                }
                return (
                    <div className="st-export-log-placeholder">
                        <svg className="st-export-placeholder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5" />
                            <circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5" />
                            <path d="M21 15l-5-5L5 21" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Original Input</span>
                    </div>
                );
            };

            const renderPipelineStepper = (run) => {
                return (
                    <div className="st-export-stepper">
                        <div className="st-stepper-title">Pipeline: {run.name || 'Custom Workflow'}</div>
                        <div className="st-stepper-flow">
                            {run.steps.map((stepType, idx) => {
                                const stepDef = STEP_TYPES.find(s => s.type === stepType);
                                const isLast = idx === run.steps.length - 1;
                                return (
                                    <React.Fragment key={idx}>
                                        <div className="st-stepper-node" title={stepDef?.desc || stepType}>
                                            <div className="st-node-icon">
                                                <I d={stepDef?.icon || "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"} s={12} />
                                            </div>
                                            <span className="st-node-label">{stepDef?.label || stepType}</span>
                                        </div>
                                        {!isLast && <div className="st-stepper-connector" />}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </div>
                );
            };

            const renderSingleToolStepper = (filename) => {
                const info = getToolInfo(filename);
                return (
                    <div className="st-export-single-tool">
                        <div className="st-stepper-title">Operation: {info.label}</div>
                        <div className="st-tool-params">
                            <div className={`st-tool-badge-pill ${info.badgeClass}`}>
                                <I d={info.icon} s={12} />
                                <span>{info.label}</span>
                            </div>
                            <div className="st-params-divider" />
                            <div className="st-params-list">
                                {info.params.map((p, idx) => (
                                    <span key={idx} className="st-param-pill">{p}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            };

            // Pagination calculation
            const itemsPerPage = 9;
            const indexOfLastItem = exportsPage * itemsPerPage;
            const indexOfFirstItem = indexOfLastItem - itemsPerPage;
            const currentItems = filteredExports.slice(indexOfFirstItem, indexOfLastItem);
            const totalPages = Math.ceil(filteredExports.length / itemsPerPage);

            const pageNumbers = [];
            for (let i = 1; i <= totalPages; i++) {
                pageNumbers.push(i);
            }

            return (
                <div className="st-inspire-canvas full-width">
                    {isLoadingExports ? (
                        <div className="st-loading"><div className="st-spinner" /><span>Loading exports...</span></div>
                    ) : exportsList.length > 0 ? (
                        <>
                            <div className="st-exports-toolbar">
                                <div className="st-exports-toolbar-left">
                                    <label className="st-exports-select-all">
                                        <input
                                            type="checkbox"
                                            checked={filteredExports.length > 0 && filteredExports.every(f => selectedExports.has(f.id))}
                                            onChange={selectAllExports}
                                        />
                                        <span>{selectedExports.size > 0 ? `${selectedExports.size} selected` : 'Select all'}</span>
                                    </label>
                                    {selectedExports.size > 0 && (
                                        <button
                                            className="st-exports-delete-btn"
                                            onClick={() => deleteExports([...selectedExports])}
                                            disabled={isDeleting}
                                        >
                                            <I d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" s={14} />
                                            {isDeleting ? 'Deleting...' : `Delete ${selectedExports.size}`}
                                        </button>
                                    )}
                                </div>
                                <select className="st-exports-filter" value={exportsFilter} onChange={(e) => { setExportsFilter(e.target.value); setExportsPage(1); }}>
                                    <option value="all">All Files ({exportsList.length})</option>
                                    <option value="image">Images ({imageCount})</option>
                                    <option value="vector">Vectors ({vectorCount})</option>
                                </select>
                            </div>
                            {currentItems.length > 0 ? (
                                <div className="st-export-log-list">
                                    {currentItems.map((file) => {
                                        const fullUrl = file.imageUrl.startsWith('http') ? file.imageUrl : `${API}${file.imageUrl}`;
                                        const previewSrc = (file.previewUrl || file.imageUrl).startsWith('http')
                                            ? (file.previewUrl || file.imageUrl)
                                            : `${API}${file.previewUrl || file.imageUrl}`;
                                        const isSelected = selectedExports.has(file.id);

                                        // Match with a pipeline run
                                        const matchedRun = pipelineRuns.find(run => {
                                            if (!run.results) return false;
                                            return run.results.some(res => res.resultUrl && (res.resultUrl.endsWith(file.id) || res.resultUrl === file.imageUrl));
                                        });

                                        // Resolve original image URL
                                        const originalInputUrl = matchedRun
                                            ? (matchedRun.results.find(res => res.type === 'upload')?.resultUrl)
                                            : activeProject?.heroImageUrl;
                                        const originalSrc = originalInputUrl
                                            ? (originalInputUrl.startsWith('http') ? originalInputUrl : `${API}${originalInputUrl}`)
                                            : null;

                                        return (
                                            <div key={file.id} className={`st-export-log-card ${isSelected ? 'selected' : ''}`}>
                                                {/* Header metadata bar */}
                                                <div className="st-export-log-header">
                                                    <div className="st-export-log-header-left">
                                                        <div className="st-export-check" onClick={() => toggleExportSelect(file.id)}>
                                                            <input type="checkbox" checked={isSelected} readOnly />
                                                        </div>
                                                        <span className="st-export-log-id" title={file.id}>{file.id}</span>
                                                    </div>
                                                    <div className="st-export-log-header-right">
                                                        <span className="st-export-timestamp">{formatTimestamp(file.timestamp)}</span>
                                                    </div>
                                                </div>

                                                {/* Split panel contents */}
                                                <div className="st-export-log-body">
                                                    {/* Original Input image on the left */}
                                                    <div className="st-export-log-panel left">
                                                        <div className="st-panel-tag">Original Input</div>
                                                        <div className="st-panel-image-container">
                                                            {renderOriginalImage(originalSrc)}
                                                        </div>
                                                    </div>

                                                    {/* Pipeline/tool step in the center */}
                                                    <div className="st-export-log-panel center">
                                                        <div className="st-panel-connection-line-bg" />
                                                        <div className="st-panel-connection-content">
                                                            {matchedRun ? renderPipelineStepper(matchedRun) : renderSingleToolStepper(file.id)}
                                                        </div>
                                                    </div>

                                                    {/* Final Output image on the right */}
                                                    <div className="st-export-log-panel right">
                                                        <div className="st-panel-tag">Final Output</div>
                                                        <div className="st-panel-image-container">
                                                            <img src={previewSrc} alt="Final Output" className="st-export-log-image" loading="lazy" />
                                                            <div className="st-export-image-hover">
                                                                <a href={fullUrl} onClick={(e) => forceDownload(e, fullUrl)} className="st-export-hover-btn dl" title="Download">
                                                                    <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={14} />
                                                                    <span>Download</span>
                                                                </a>
                                                            </div>
                                                        </div>
                                                        <div className="st-export-meta-row">
                                                            <span className={`st-export-badge ${file.format.toLowerCase()}`}>{file.format}</span>
                                                            <span className="st-export-size">{file.size}</span>
                                                            {file.type === 'image' && (
                                                                <button
                                                                    className="st-export-techpack-btn"
                                                                    title="Download Tech Pack PDF"
                                                                    onClick={() => generateTechPack(file.id)}
                                                                    disabled={techPackLoading === file.id}
                                                                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', transition: 'all 0.2s' }}
                                                                >
                                                                    <I d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" s={13} />
                                                                    {techPackLoading === file.id ? 'Generating...' : 'Tech Pack'}
                                                                </button>
                                                            )}
                                                            <button
                                                                className="st-export-trash-btn"
                                                                title="Delete"
                                                                onClick={() => deleteExports([file.id])}
                                                                disabled={isDeleting}
                                                            >
                                                                <I d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" s={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="st-empty-canvas"><span className="st-empty-icon">ðŸ”</span><p>No {exportsFilter === 'vector' ? 'vector' : 'image'} files found.</p></div>
                            )}

                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                                <div className="st-pagination">
                                    <button
                                        className="st-pagination-btn prev"
                                        onClick={() => setExportsPage(prev => Math.max(prev - 1, 1))}
                                        disabled={exportsPage === 1}
                                    >
                                        <I d="M15 19l-7-7 7-7" s={14} />
                                        <span>Prev</span>
                                    </button>

                                    <div className="st-pagination-numbers">
                                        {pageNumbers.map(number => (
                                            <button
                                                key={number}
                                                className={`st-pagination-number ${exportsPage === number ? 'active' : ''}`}
                                                onClick={() => setExportsPage(number)}
                                            >
                                                {number}
                                            </button>
                                        ))}
                                    </div>

                                    <button
                                        className="st-pagination-btn next"
                                        onClick={() => setExportsPage(prev => Math.min(prev + 1, totalPages))}
                                        disabled={exportsPage === totalPages}
                                    >
                                        <span>Next</span>
                                        <I d="M9 5l7 7-7 7" s={14} />
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="st-empty-canvas"><span className="st-empty-icon">ðŸ“</span><p>No exports generated yet for this project.</p></div>
                    )}
                </div>
            );
        }
        if (tool === 'pattern') {
            const loading = isEnh;
            return (
                <div className="st-pattern-layout">
                    <div
                        className={`st-pattern-upload ${isDrag ? 'dragging' : ''}`}
                        onClick={() => fileRef.current?.click()}
                        onDrop={(e) => { e.preventDefault(); setIsDrag(false); handleUpload(e.dataTransfer.files[0]); }}
                        onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                        onDragLeave={() => setIsDrag(false)}
                    >
                        <div className="st-pattern-upload-icon">
                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={20} />
                        </div>
                        <strong>Upload an image or drag &amp; drop</strong>
                        <p>JPG, PNG &bull; Up to 50MB &bull; Recommended: 3000px or higher</p>
                    </div>

                    <div className="st-pattern-panels">
                        <div className="st-pattern-panel">
                            <div className="st-pattern-panel-label">Original</div>
                            {preview ? (
                                <img src={preview} alt="Original" className="st-pattern-image" />
                            ) : (
                                <>
                                    <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="25" y="30" width="60" height="65" rx="8" fill="#F3F4F6" stroke="#E5E7EB" strokeWidth="2" transform="rotate(-10 25 30)" />
                                        <rect x="40" y="25" width="60" height="65" rx="8" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
                                        <circle cx="55" cy="45" r="6" fill="#E5E7EB" />
                                        <path d="M40 70L55 55L75 75L85 65L100 80" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    <div className="st-pattern-empty-title">No image uploaded</div>
                                    <div className="st-pattern-empty-desc">Upload an outfit or fabric image to get started.</div>
                                    <button className="st-pattern-btn-outline" onClick={() => fileRef.current?.click()}>
                                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={16} />
                                        Upload Image
                                    </button>
                                </>
                            )}
                        </div>

                        <div className="st-pattern-arrow">
                            <I d="M5 12h14M12 5l7 7-7 7" s={18} />
                        </div>

                        <div className="st-pattern-panel">
                            <div className="st-pattern-panel-label">Extracted Pattern</div>
                            {enhUrl ? (
                                Array.isArray(enhUrl) ? (
                                    <div style={{ position: 'absolute', inset: '0', padding: '3.5rem 1rem 1rem', display: 'flex', gap: '10px' }}>
                                        {enhUrl.map((url, i) => (
                                            <div key={i} style={{ flex: 1, position: 'relative' }}>
                                                <img src={url} alt={`Result ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '8px' }} />
                                                <a href={url} onClick={(e) => forceDownload(e, url)} className="st-dl-btn" style={{ position: 'absolute', bottom: '0.5rem', right: '0.5rem' }}>Download</a>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <>
                                        <img src={enhUrl} alt="Result" className="st-pattern-image" />
                                        <a href={enhUrl} onClick={(e) => forceDownload(e, enhUrl)} className="st-dl-btn" style={{ position: 'absolute', bottom: '1rem', right: '1rem' }}>Download</a>
                                    </>
                                )
                            ) : loading ? (
                                <div className="st-loading"><div className="st-spinner" /><span>Extracting Pattern...</span></div>
                            ) : (
                                <>
                                    <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="35" y="30" width="60" height="60" rx="8" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="2" strokeDasharray="4 4" />
                                        <path d="M50 45C50 45 55 50 60 45C65 40 70 45 70 45" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M45 60C45 60 50 55 55 60C60 65 65 60 65 60" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M55 75C55 75 60 70 65 75C70 80 75 75 75 75" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M75 55L75 60M85 30L90 35M30 75L25 70" stroke="#C7D2FE" strokeWidth="2" strokeLinecap="round" />
                                        <path d="M92 40L95 48L103 51L95 54L92 62L89 54L81 51L89 48Z" fill="#C7D2FE" />
                                        <path d="M40 20L42 25L47 27L42 29L40 34L38 29L33 27L38 25Z" fill="#E0E7FF" />
                                    </svg>
                                    <div className="st-pattern-empty-title">Extracted pattern will appear here</div>
                                    <div className="st-pattern-empty-desc">Our AI will analyze your image and generate a clean, seamless repeating design.</div>
                                    <button className="st-pattern-btn-outline" disabled={true}>
                                        <I d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" s={16} />
                                        Extract Design
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
        if (tool === 'seamless') {
            const loading = isSeamless;
            return (
                <div className="st-pattern-layout">
                    <div
                        className={`st-pattern-upload ${isDrag ? 'dragging' : ''}`}
                        onClick={() => fileRef.current?.click()}
                        onDrop={(e) => { e.preventDefault(); setIsDrag(false); handleUpload(e.dataTransfer.files[0]); }}
                        onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                        onDragLeave={() => setIsDrag(false)}
                    >
                        <div className="st-pattern-upload-icon">
                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={20} />
                        </div>
                        <strong>Upload an image or drag &amp; drop</strong>
                        <p>JPG, PNG &bull; Up to 50MB</p>
                    </div>

                    <div className="st-pattern-panels">
                        <div className="st-pattern-panel">
                            <div className="st-pattern-panel-label">Original</div>
                            {preview ? (
                                <img src={preview} alt="Original" className="st-pattern-image" />
                            ) : (
                                <>
                                    <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="25" y="30" width="60" height="65" rx="8" fill="#F3F4F6" stroke="#E5E7EB" strokeWidth="2" transform="rotate(-10 25 30)" />
                                        <rect x="40" y="25" width="60" height="65" rx="8" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
                                        <circle cx="55" cy="45" r="6" fill="#E5E7EB" />
                                        <path d="M40 70L55 55L75 75L85 65L100 80" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    <div className="st-pattern-empty-title">No image uploaded</div>
                                </>
                            )}
                        </div>

                        <div className="st-pattern-arrow">
                            <I d="M5 12h14M12 5l7 7-7 7" s={18} />
                        </div>

                        <div className="st-pattern-panel">
                            <div className="st-pattern-panel-label">Seamless Base Tile</div>
                            {seamlessUrl ? (
                                <>
                                    <img src={seamlessUrl} alt="Result" className="st-pattern-image" />
                                    <a href={seamlessUrl} onClick={(e) => forceDownload(e, seamlessUrl)} className="st-dl-btn" style={{ position: 'absolute', bottom: '1rem', right: '1rem' }}>Download</a>
                                </>
                            ) : loading ? (
                                <div className="st-loading"><div className="st-spinner" /><span>Fixing seams...</span></div>
                            ) : (
                                <>
                                    <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="35" y="30" width="60" height="60" rx="8" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="2" strokeDasharray="4 4" />
                                        <path d="M50 45C50 45 55 50 60 45C65 40 70 45 70 45" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M45 60C45 60 50 55 55 60C60 65 65 60 65 60" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M55 75C55 75 60 70 65 75C70 80 75 75 75 75" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M75 55L75 60M85 30L90 35M30 75L25 70" stroke="#C7D2FE" strokeWidth="2" strokeLinecap="round" />
                                        <path d="M92 40L95 48L103 51L95 54L92 62L89 54L81 51L89 48Z" fill="#C7D2FE" />
                                        <path d="M40 20L42 25L47 27L42 29L40 34L38 29L33 27L38 25Z" fill="#E0E7FF" />
                                    </svg>
                                    <div className="st-pattern-empty-title">Seamless pattern will appear here</div>
                                    <div className="st-pattern-empty-desc">Our AI will offset your image and seamlessly redraw the connections.</div>
                                    <button className="st-pattern-btn-outline" disabled={true}>
                                        <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z" s={16} />
                                        Make Seamless Base Tile
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
        if (tool === 'library') {
            return (
                <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text)', marginBottom: '1.5rem' }}>Brand Library</h2>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem', alignItems: 'start' }}>
                        {/* Left: Palette Builder */}
                        <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Create New Palette</h3>

                            <label className="st-label-sm">Palette Name</label>
                            <input
                                type="text"
                                className="st-input"
                                value={newPaletteName}
                                onChange={e => setNewPaletteName(e.target.value)}
                                placeholder="e.g. Summer Core 2026"
                                style={{ width: '100%', marginBottom: '1rem' }}
                            />

                            <label className="st-label-sm">Colors</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                                {newPaletteColors.map((col, i) => (
                                    <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <input
                                            type="color"
                                            value={col}
                                            onChange={e => {
                                                const newCols = [...newPaletteColors];
                                                newCols[i] = e.target.value;
                                                setNewPaletteColors(newCols);
                                            }}
                                            style={{ width: '40px', height: '40px', padding: 0, border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                                        />
                                        <input
                                            type="text"
                                            className="st-input"
                                            value={col}
                                            onChange={e => {
                                                const newCols = [...newPaletteColors];
                                                newCols[i] = e.target.value;
                                                setNewPaletteColors(newCols);
                                            }}
                                            style={{ flex: 1, fontFamily: 'monospace' }}
                                        />
                                        {newPaletteColors.length > 1 && (
                                            <button
                                                className="st-icon-btn"
                                                onClick={() => setNewPaletteColors(newPaletteColors.filter((_, idx) => idx !== i))}
                                                style={{ color: '#ef4444' }}
                                            >
                                                <I d="M6 18L18 6M6 6l12 12" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <button
                                className="st-btn"
                                onClick={() => setNewPaletteColors([...newPaletteColors, '#cccccc'])}
                                style={{ width: '100%', marginBottom: '1.5rem', border: '1px dashed var(--border)' }}
                            >
                                + Add Color
                            </button>

                            <button
                                className="st-btn primary"
                                onClick={saveBrandPalette}
                                disabled={isSavingPalette || !newPaletteName.trim()}
                                style={{ width: '100%' }}
                            >
                                {isSavingPalette ? 'Saving...' : 'Save Palette'}
                            </button>
                        </div>

                        {/* Right: Saved Palettes */}
                        <div>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Saved Palettes</h3>
                            {brandPalettesLoading ? (
                                <p>Loading palettes...</p>
                            ) : brandPalettes.length === 0 ? (
                                <div className="st-empty-canvas" style={{ minHeight: '200px' }}>
                                    <span className="st-empty-icon" style={{ fontSize: '2rem' }}>ðŸŽ¨</span>
                                    <p>No brand palettes saved yet.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {brandPalettes.map(p => (
                                        <div key={p.id} style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                                <h4 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text)' }}>{p.name}</h4>
                                                <button className="st-icon-btn" onClick={() => deleteBrandPalette(p.id)} style={{ color: '#ef4444' }}>
                                                    <I d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </button>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                {p.colors.map((c, i) => (
                                                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                                                        <div style={{ width: '50px', height: '50px', borderRadius: '8px', backgroundColor: c, border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}></div>
                                                        <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{c.toUpperCase()}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }
if (tool === 'imagelayers') {
    return (
        <div className={`st-layer-editor ${isImageLayersFullscreen ? 'fullscreen' : ''}`}>
            {imageLayersResults.length > 0 ? (
                <>
                    <div className="st-qwen-layer-hero">
                        <div>
                            <div className="st-qwen-eyebrow">Qwen-Image-Layered</div>
                            <h2>Editable RGBA layers with physical isolation</h2>
                            <p>Decompose, recolor, revise, replace, resize, reposition, delete, and recursively split any selected layer.</p>
                        </div>
                        <button
                            className="st-layer-fullscreen-btn"
                            onClick={() => setIsImageLayersFullscreen(v => !v)}
                            title={isImageLayersFullscreen ? 'Exit fullscreen' : 'Fullscreen editor'}
                        >
                            <I d={isImageLayersFullscreen ? 'M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5' : 'M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5'} s={15} />
                            {isImageLayersFullscreen ? 'Exit' : 'Fullscreen'}
                        </button>
                        <div className="st-qwen-depth-preview" aria-hidden="true">
                            {[0, 1, 2, 3, 4].map(i => <span key={i} style={{ '--i': i }} />)}
                        </div>
                    </div>

                    <div className="st-qwen-demo-strip">
                        {qwenLayerDemoActions.map((demo) => (
                            <button
                                key={demo.label}
                                className={`st-qwen-demo-card ${editType === demo.type ? 'active' : ''}`}
                                onClick={() => applyQwenLayerDemo(demo)}
                                title={demo.prompt || demo.label}
                            >
                                <I d={demo.icon} s={15} />
                                <span>{demo.label}</span>
                                {demo.prompt ? <small>{demo.prompt}</small> : null}
                            </button>
                        ))}
                    </div>

                    <div className="st-layer-toolbar">
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('flipH')} title="Flip Horizontal">
                            <I d="M15 21h2v-2h-2v2zm4-12h2V7h-2v2zM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2zm16-2v2h2c0-1.1-.9-2-2-2zm-8 20h2V1h-2v22zm8-6h2v-2h-2v2zM15 5h2V3h-2v2zm4 8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2z" s={14} /> Flip H
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('flipV')} title="Flip Vertical">
                            <I d="M7 8v8h2V8H7zm4 0v8h2V8h-2zm4 0v8h2V8h-2z" s={14} /> Flip V
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('rotLeft')} title="Rotate Left 90 deg">
                            <I d="M10 4v4h-4l5-5 5 5h-4v4" s={14} /> Rot L
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('rotRight')} title="Rotate Right 90 deg">
                            <I d="M14 4v4h4l-5-5-5 5h4v4" s={14} /> Rot R
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('front')} title="Bring to Front">
                            <I d="M4 4h8v8H4V4zm10 10h6v6h-6v-6z" s={14} /> Front
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('back')} title="Send to Back">
                            <I d="M14 14h6v6h-6v-6zM4 4h8v8H4V4z" s={14} /> Back
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('delete')} title="Delete Selected">
                            <I d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" s={14} /> Del
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={resetLayersToBase} title="Reset all layers to original positions">
                            <I d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16M3 21v-5h5" s={14} /> Base
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={() => setImageLayerZoom(layerCanvasZoom - 0.15)} title="Zoom Out">
                            <I d="M5 12h14" s={14} /> Zoom
                        </button>
                        <div className="st-layer-zoom-readout">{Math.round(layerCanvasZoom * 100)}%</div>
                        <button className="st-layer-toolbar-btn" onClick={() => setImageLayerZoom(layerCanvasZoom + 0.15)} title="Zoom In">
                            <I d="M12 5v14M5 12h14" s={14} /> Zoom
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={resetImageLayerView} title="Reset zoom and pan">
                            <I d="M4 4h16v16H4z" s={14} /> View
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className={`st-layer-toolbar-btn ${isLayerMaskMode ? 'active' : ''}`} onClick={() => setIsLayerMaskMode(v => !v)} title="Paint an inpaint mask">
                            <I d="M12 19l7-7 3 3-7 7H9v-6l10-10a2.1 2.1 0 00-3-3L6 13v6h6z" s={14} /> Brush
                        </button>
                        <div className="st-recursive-control st-mask-control">
                            <span>Size</span>
                            <input type="range" min="6" max="96" value={layerMaskBrushSize} onChange={(e) => setLayerMaskBrushSize(+e.target.value)} />
                            <strong>{layerMaskBrushSize}</strong>
                        </div>
                        <button className="st-layer-toolbar-btn" onClick={clearLayerMask} title="Clear painted inpaint mask">
                            <I d="M18 6L6 18M6 6l12 12" s={14} /> Clear Mask
                        </button>
                        <button className="st-layer-toolbar-btn st-qwen-action-btn" onClick={handleInpaintLayer} disabled={selectedLayerId === null || isProcessingAI || isInpaintingLayer || !layerEditPrompt.trim()} title="Inpaint only the painted mask on selected layer">
                            <I d="M3 21v-4l11-11 4 4L7 21H3z" s={14} /> {isInpaintingLayer ? 'Inpainting...' : 'Inpaint Mask'}
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <div className="st-recursive-control">
                            <span>Depth</span>
                            <input type="range" min="2" max="10" value={recursiveLayerCount} onChange={(e) => setRecursiveLayerCount(+e.target.value)} />
                            <strong>{recursiveLayerCount}</strong>
                        </div>
                        <button className="st-layer-toolbar-btn st-qwen-action-btn" onClick={handleRecursiveDecompose} disabled={selectedLayerId === null || isProcessingAI} title="Decompose selected layer again with Qwen">
                            <I d="M12 2L2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5" s={14} /> Decompose Selected
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={handleComposeLayers} disabled={isExportingLayers} title="Flatten ordered visible layers to PNG">
                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={14} /> {isExportingLayers ? 'Exporting...' : 'Flatten & Export PNG'}
                        </button>
                    </div>


            {/* Main Body */}
            <div className="st-layer-body">
                {/* Canvas */}
                <div className="st-layer-canvas-wrap checkerboard-bg">
                    <canvas ref={fabricCanvasRef} />
                    {isProcessingAI && (
                        <div className="st-processing-overlay">
                            <div className="st-spinner" style={{ width: 40, height: 40, borderWidth: 4, borderColor: 'rgba(59, 130, 246, 0.3)', borderTopColor: '#3b82f6' }} />
                            <div className="st-processing-text">{aiProcessingText}</div>
                        </div>
                    )}
                </div>

                {/* Layer Panel */}
                <div className="st-layer-panel">
                    <div className="st-layer-panel-title">LAYERS ({layersList.length})</div>
                    <div className="st-layer-panel-list">
                        {/* Reverse order so top layer is at top of list */}
                        {[...layersList].reverse().map((layer) => (
                            <div
                                key={layer.id}
                                className={`st-layer-panel-item ${selectedLayerId === layer.id ? 'selected' : ''} ${layerDragState.draggingId === layer.id ? 'dragging' : ''} ${layerDragState.overId === layer.id ? `drag-over-${layerDragState.position}` : ''}`}
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', String(layer.id));
                                    setLayerDragState({ draggingId: layer.id, overId: null, position: null });
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const position = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                                    setLayerDragState(prev => (
                                        prev.overId === layer.id && prev.position === position
                                            ? prev
                                            : { ...prev, overId: layer.id, position }
                                    ));
                                }}
                                onDragLeave={(e) => {
                                    if (!e.currentTarget.contains(e.relatedTarget)) {
                                        setLayerDragState(prev => ({ ...prev, overId: null, position: null }));
                                    }
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const draggedId = Number(e.dataTransfer.getData('text/plain'));
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const position = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                                    reorderLayerStack(draggedId, layer.id, position);
                                    setLayerDragState({ draggingId: null, overId: null, position: null });
                                }}
                                onDragEnd={() => setLayerDragState({ draggingId: null, overId: null, position: null })}
                                onClick={() => selectLayerFromPanel(layer.id)}
                            >
                                <div className="layer-num">{layer.id + 1}</div>
                                <img className="layer-thumb" src={`${API}${layer.url}`} alt={layer.name} draggable={false} />
                                <div className="layer-name">
                                    {layer.loadingName ? '...' : layer.name}
                                </div>
                                <button
                                    className={`st-layer-icon-btn ${!layer.visible ? 'off' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                                    title="Visibility"
                                >
                                    <I d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" s={14} />
                                </button>
                                <button
                                    className={`st-layer-icon-btn ${!layer.locked ? 'off' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }}
                                    title="Lock"
                                >
                                    {layer.locked
                                        ? <I d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" s={14} />
                                        : <I d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z" s={14} />}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="st-layer-prompt-bar st-qwen-prompt-bar">
                <div className="st-layer-prompt-chips">
                    <button className={`st-layer-prompt-chip ${editType === 'recolor' ? 'active' : ''}`} onClick={() => setEditType('recolor')}>Recolor</button>
                    <button className={`st-layer-prompt-chip ${editType === 'revise' ? 'active' : ''}`} onClick={() => setEditType('revise')}>Revise</button>
                    <button className={`st-layer-prompt-chip ${editType === 'replace' ? 'active' : ''}`} onClick={() => setEditType('replace')}>Replace</button>
                    <button className={`st-layer-prompt-chip ${editType === 'inpaint' ? 'active' : ''}`} onClick={() => setEditType('inpaint')}>Inpaint</button>
                    <button className={`st-layer-prompt-chip ${editType === 'remove' ? 'active' : ''}`} onClick={() => setEditType('remove')}>Remove</button>
                    <button className={`st-layer-prompt-chip ${editType === 'decompose' ? 'active' : ''}`} onClick={() => setEditType('decompose')}>Decompose</button>
                </div>
                <div className="st-layer-prompt-input-wrap">
                    <input
                        type="text"
                        className="st-layer-prompt-input"
                        placeholder={editType === 'recolor' ? 'e.g. "Change to navy blue"' : editType === 'revise' ? 'e.g. "Make it more detailed"' : editType === 'replace' ? 'e.g. "Replace with a rose"' : editType === 'inpaint' ? 'Paint a mask, then describe the local change' : editType === 'remove' ? 'Remove this layer element' : 'Recursively decompose this layer'}
                        value={layerEditPrompt}
                        onChange={(e) => setLayerEditPrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleEditLayer(); }}
                        disabled={selectedLayerId === null || isProcessingAI}
                    />
                    <button
                        className="st-layer-prompt-apply"
                        onClick={handleEditLayer}
                        disabled={selectedLayerId === null || isProcessingAI || (!layerEditPrompt.trim() && editType !== 'remove' && editType !== 'decompose')}
                    >
                        {isProcessingAI ? 'Processing...' : editType === 'decompose' ? 'Decompose' : editType === 'inpaint' ? 'Inpaint' : 'Apply'}
                    </button>
                </div>
            </div>
                </>
            ) : (
                <div className="st-layer-empty">
                    {isImageLayering ? (
                        <>
                            <div className="st-spinner" style={{ width: 32, height: 32, borderTopColor: '#67e8f9' }} />
                            <div>Qwen is decomposing image into {imageLayersNumLayers} RGBA layers...</div>
                            <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>The resulting layers can be isolated, edited, moved, resized, deleted, and decomposed again.</div>
                        </>
                    ) : (
                        <>
                            <div className="st-qwen-empty-visual" aria-hidden="true">
                                <div className="st-qwen-empty-card base">{preview ? <img src={preview} alt="" /> : null}</div>
                                {[0, 1, 2, 3].map(i => <div key={i} className="st-qwen-empty-card layer" style={{ '--i': i }} />)}
                            </div>
                            <div className="st-qwen-empty-title">Qwen-Image-Layered</div>
                            <div>Upload an image, choose a layer count, then decompose it into editable RGBA layers.</div>
                            <div className="st-qwen-demo-grid">
                                {qwenLayerDemoActions.map((demo) => (
                                    <button
                                        key={demo.label}
                                        className={`st-qwen-demo-card ${editType === demo.type ? 'active' : ''}`}
                                        onClick={() => applyQwenLayerDemo(demo)}
                                    >
                                        <I d={demo.icon} s={15} />
                                        <span>{demo.label}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="st-qwen-feature-row">
                                <span>Physical isolation</span>
                                <span>Natural-language edits</span>
                                <span>Recursive depth</span>
                                <span>Layer composition</span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
            if (tool === 'vectorize' || tool === 'upscale') {
      const resultUrl = tool === 'vectorize' ? vecUrl : upscaleUrl;
            const loading = tool === 'vectorize' ? isVec : isUpscaling;
            return (
            <div className="st-compare">
                <div className="st-compare-panel"><div className="st-compare-label">ORIGINAL</div>{preview ? <img src={preview} alt="Original" /> : <span className="st-compare-empty">Upload an image</span>}</div>
                <div className="st-compare-divider">{loading ? <div className="st-spinner" /> : '->'}</div>
                <div className="st-compare-panel">
                    <div className="st-compare-label">RESULT</div>
                    {resultUrl ? (
                        Array.isArray(resultUrl) ? (
                            <div style={{ display: 'flex', gap: '10px', height: '100%', alignItems: 'center' }}>
                                {resultUrl.map((url, i) => (
                                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <img src={url} alt={`Result ${i + 1}`} style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />
                                        <a href={url} onClick={(e) => forceDownload(e, url)} className="st-dl-btn">Download</a>
                                    </div>
                                ))}
                            </div>
                        ) : <>
                            <img src={resultUrl} alt="Result" style={{ maxWidth: '100%', maxHeight: '320px', objectFit: 'contain' }} />
                            <a href={resultUrl} onClick={(e) => forceDownload(e, resultUrl)} className="st-dl-btn" style={{ position: 'absolute', bottom: '0.5rem', right: '0.5rem' }}>Download {tool === 'vectorize' ? 'SVG' : 'PNG'}</a>
                        </>
                    ) : loading ? <span className="st-processing">Processing...</span> : <span className="st-compare-empty">Result appears here</span>}
                </div>
            </div>
            );
    }
            return (
            <div className="st-inspire-main">
                {/* Upload Box */}
                <div
                    className={`st-inspire-upload-box ${preview ? 'has-image' : ''}`}
                    onClick={() => fileRef.current?.click()}
                    onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files[0]); }}
                    onDragOver={(e) => e.preventDefault()}
                >
                    {preview ? (
                        <div className="st-upload-preview" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                            <img src={preview} alt="Uploaded reference" style={{ maxHeight: '160px', borderRadius: '8px', objectFit: 'contain' }} />
                            <div><span className="st-upload-name">{uploaded?.originalName || 'Image Uploaded'}</span><span className="st-upload-hint">Click to replace</span></div>
                        </div>
                    ) : (
                        <>
                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={24} />
                            <h3>Upload reference image (optional)</h3>
                            <p>PNG, JPG up to 10MB</p>
                        </>
                    )}
                </div>

                {/* Prompt Box */}
                <div className="st-inspire-prompt-container">
                    <div className="st-inspire-prompt-top">
                        <div className="st-inspire-prompt-icon">
                            <I d="M5 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zM16 12l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zM14 2l1.5 4.5L20 8l-4.5 1.5L14 14l-1.5-4.5L8 8l4.5-1.5L14 2z" s={20} />
                        </div>
                        <input
                            className="st-inspire-prompt-input"
                            placeholder="Describe the pattern inspiration you want to create..."
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && generate()}
                        />
                    </div>
                    <div className="st-inspire-prompt-bottom">
                        <div className="st-inspire-tags">
                            {['Floral', 'Geometric', 'Minimal', 'Vintage', 'Watercolor', 'Tropical'].map(t => (
                                <button key={t} className="st-inspire-tag" onClick={() => setPrompt(prev => prev ? `${prev}, ${t}` : t)}>
                                    <I d="M7 21l7-14M3 11h18M3 17h18" s={12} /> {t}
                                </button>
                            ))}
                        </div>
                        <div className="st-inspire-prompt-actions">
                            {uploaded && (
                                <button
                                    className="st-btn"
                                    onClick={descImg}
                                    disabled={isDesc}
                                    style={{ background: '#f5f3ff', color: 'var(--primary)', border: 'none', marginRight: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}
                                    title="Auto-describe uploaded image"
                                >
                                    <I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={14} />
                                    {isDesc ? 'Analyzing...' : 'Auto-Describe'}
                                </button>
                            )}
                            <button className="st-inspire-send-btn" onClick={generate} disabled={isGen}>
                                <I d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" s={16} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Generated Variations */}
                <div className="st-inspire-section">
                    <div className="st-inspire-section-header">
                        <div className="st-inspire-section-title">
                            <h2>Generated Variations</h2>
                            <p>Generated from your prompt</p>
                        </div>
                        <a href="#" className="st-inspire-section-link"><I d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" s={14} /> View history</a>
                    </div>
                    {isGen ? (
                        <div className="st-loading" style={{ height: '200px' }}><div className="st-spinner" /><span>Generating variations...</span></div>
                    ) : generatedVariations.length > 0 ? (
                        <div className="st-inspire-var-grid">
                            {generatedVariations.map((u, i) => (
                                <div key={u} className={`st-inspire-var-item ${i === 0 ? 'active' : ''}`}>
                                    <img src={u} alt={`Variation ${i + 1}`} />
                                    <div className="st-inspire-var-actions">
                                        <button className="st-inspire-var-btn"><I d="M20.8 4.6a5.5 5.5 0 0 0-7.7 0l-1.1 1-1.1-1a5.5 5.5 0 0 0-7.8 7.8l1 1 7.9 7.9 7.9-7.9 1-1a5.5 5.5 0 0 0 0-7.8z" s={14} /></button>
                                        <button className="st-inspire-var-btn" onClick={(e) => forceDownload(e, u)}><I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /></button>
                                        <button className="st-inspire-var-btn"><I d="M5 12h.01M12 12h.01M19 12h.01" s={14} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="st-empty-canvas" style={{ minHeight: '160px', background: 'transparent' }}>
                            <p>Enter a prompt above to generate beautiful variations.</p>
                        </div>
                    )}
                </div>
            </div>
            );
  };

            const creditPercent = Math.min(100, Math.round((user.creditsUsed / user.creditsLimit) * 100));

            const healthItems = [
            ['Tile Seamless', state.health.tileSeamless],
            ['Color Balance', state.health.colorBalance],
            ['Print Readiness', state.health.printReadiness],
            ['Resolution', state.health.resolution],
            ];

            return (
            <div className="studio">
                <aside className="st-sidebar">
                    <div className="st-sidebar-top">
                        <div className="st-logo" onClick={() => { setTool(user.role === 'admin' ? 'admin-dashboard' : 'dashboard'); setError(''); }} style={{ cursor: 'pointer' }}><span className="ln-logo-badge">RI</span> RIM AI</div>

                        {user.role === 'admin' ? (
                            <>
                                {ADMIN_NAV.map((s) => (
                                    <div key={s.section || 'admin'}>
                                        {s.section && <div className="st-nav-section">{s.section}</div>}
                                        {s.items.map((it) => (
                                            <button key={it.id} className={`st-nav-item ${tool === it.id ? 'active' : ''}`} onClick={() => { setTool(it.id); setError(''); }}>
                                                <I d={it.icon} s={18} /><span>{it.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                ))}
                                <div className="st-nav-section">ACCOUNT</div>
                                <button className="st-nav-item" onClick={() => setShowSettingsModal(true)}>
                                    <I d="M12.2 2h-.4a2 2 0 00-2 2v.2a2 2 0 01-1 1.7l-.4.2a2 2 0 01-2 0l-.2-.1a2 2 0 00-2.7.7l-.2.4a2 2 0 00.7 2.7l.2.1a2 2 0 011 1.7v.5a2 2 0 01-1 1.8l-.2.1a2 2 0 00-.7 2.7l.2.4a2 2 0 002.7.7l.2-.1a2 2 0 012 0l.4.2a2 2 0 011 1.7v.2a2 2 0 002 2h.4a2 2 0 002-2v-.2a2 2 0 011-1.7l.4-.2a2 2 0 012 0l.2.1a2 2 0 002.7-.7l.2-.4a2 2 0 00-.7-2.7l-.2-.1a2 2 0 01-1-1.8v-.5a2 2 0 011-1.7l.2-.1a2 2 0 00.7-2.7l-.2-.4a2 2 0 00-2.7-.7l-.2.1a2 2 0 01-2 0l-.4-.2a2 2 0 01-1-1.7V4a2 2 0 00-2-2z" />
                                    <span>Settings</span>
                                </button>
                            </>
                        ) : (
                            <>
                                {NAV.map((s) => (
                                    <div key={s.section || 'home'}>
                                        {s.section && <div className="st-nav-section">{s.section}</div>}
                                        {s.items.map((it) => (
                                            <button key={it.id} className={`st-nav-item ${tool === it.id ? 'active' : ''}`} onClick={() => { setTool(it.id); setError(''); }}>
                                                <I d={it.icon} s={18} /><span>{it.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                    <div className="st-sidebar-bottom">
                        {user.role === 'admin' ? (
                            <div style={{ padding: '4px 0' }}>
                                <div className="st-credits-label">Replicate <span className="st-plan">Supervisor</span></div>
                                <div className="st-credits-text strong">${budgetData.totalSpent.toFixed(2)} <span>/ ${budgetData.budget.toFixed(2)}</span></div>
                                <div className="st-credits-bar"><div className="st-credits-fill" style={{ width: `${budgetData.budget > 0 ? Math.min(100, (budgetData.totalSpent / budgetData.budget) * 100) : 0}%` }} /></div>
                                <div className="st-credits-text">${budgetData.remaining.toFixed(2)} remaining</div>
                            </div>
                        ) : (
                            <>
                                <div className="st-credits-label">AI Credits <span className="st-plan">{user.plan}</span></div>
                                <div className="st-credits-text strong">{(user.creditsLimit - user.creditsUsed).toLocaleString()} <span>/ {user.creditsLimit.toLocaleString()}</span></div>
                                <div className="st-credits-bar"><div className="st-credits-fill" style={{ width: `${creditPercent}%` }} /></div>
                                <div className="st-credits-text">Resets in {user.resetDays} days</div>
                            </>
                        )}
                    </div>
                </aside>
                <div className="st-main">
                    <header className="st-topbar">
                        <select className="st-project-select" value={activeProject.id} onChange={(e) => loadStudioState(+e.target.value)}>
                            {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <div className="st-search"><I d="M21 21l-4.3-4.3M10 18a8 8 0 100-16 8 8 0 000 16z" s={16} /><input placeholder="Search projects, patterns, tools..." /><kbd>Ctrl K</kbd></div>
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
                                    <div
                                        className="st-bg-tasks-dropdown st-glassmorphic-dropdown"
                                        style={{
                                            position: 'absolute',
                                            top: '100%',
                                            right: 0,
                                            marginTop: '0.5rem',
                                            width: '320px',
                                            background: 'rgba(255, 255, 255, 0.85)',
                                            backdropFilter: 'blur(20px)',
                                            border: '1px solid rgba(226, 232, 240, 0.8)',
                                            borderRadius: '12px',
                                            boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
                                            padding: '0.85rem',
                                            zIndex: 9999,
                                            maxHeight: '400px',
                                            overflowY: 'auto'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '0.65rem' }}>
                                            <strong style={{ fontSize: '0.85rem', color: '#0f172a' }}>Background AI Queue</strong>
                                            <button
                                                onClick={() => setBgTasks([])}
                                                style={{ fontSize: '0.75rem', background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontWeight: 600 }}
                                            >
                                                Clear Queue
                                            </button>
                                        </div>

                                        {bgTasks.length === 0 ? (
                                            <div style={{ textAlign: 'center', padding: '1.5rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                                                No background tasks running. Your pattern extractions, vectorizations, and upscales will process here in real-time.
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {bgTasks.map(t => (
                                                    <div
                                                        key={t.id}
                                                        style={{
                                                            background: '#fff',
                                                            border: '1px solid #f1f5f9',
                                                            borderRadius: '8px',
                                                            padding: '0.65rem',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '0.35rem'
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b' }}>{t.label}</span>
                                                            <span style={{
                                                                fontSize: '0.55rem',
                                                                fontWeight: 800,
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                textTransform: 'uppercase',
                                                                background: t.status === 'completed' ? '#dcfce7' : t.status === 'failed' ? '#fee2e2' : '#e0e7ff',
                                                                color: t.status === 'completed' ? '#15803d' : t.status === 'failed' ? '#b91c1c' : '#4338ca',
                                                            }}>
                                                                {t.status}
                                                            </span>
                                                        </div>

                                                        <div style={{ fontSize: '0.62rem', color: '#64748b', textAlign: 'left' }}>Input: {t.filename}</div>

                                                        {t.status === 'running' && (
                                                            <div style={{ width: '100%' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: '#6366f1', fontWeight: 700, marginBottom: '2px' }}>
                                                                    <span>Processing...</span>
                                                                    <span>{t.progress}%</span>
                                                                </div>
                                                                <div style={{ width: '100%', height: '4px', background: '#e2e8f0', borderRadius: '99px', overflow: 'hidden' }}>
                                                                    <div style={{ width: `${t.progress}%`, height: '100%', background: 'linear-gradient(90deg, #6366f1, #ec4899)', transition: 'width 0.4s ease' }} />
                                                                </div>
                                                            </div>
                                                        )}

                                                        {t.status === 'completed' && t.resultUrl && (
                                                            <div style={{ display: 'flex', gap: '8px', marginTop: '0.25rem', alignItems: 'center' }}>
                                                                <div style={{ width: '32px', height: '32px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                    <img
                                                                        src={t.resultUrl.startsWith('http') ? t.resultUrl : `${API}${t.resultUrl}`}
                                                                        alt="Result"
                                                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                                    />
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '0.35rem', flex: 1, justifyContent: 'flex-end' }}>
                                                                    <button
                                                                        onClick={() => {
                                                                            setTool(t.type);
                                                                            if (t.type === 'pattern') setEnhUrl(t.resultUrls || t.resultUrl);
                                                                            if (t.type === 'seamless') setSeamlessUrl(t.resultUrl);
                                                                            if (t.type === 'vectorize') setVecUrl(t.resultUrl);
                                                                            if (t.type === 'upscale') setUpscaleUrl(t.resultUrl);
                                                                            if (t.type === 'mappings') {
                                                                                setMappingStep(4);
                                                                                if (t.resultUrls) {
                                                                                    const recreatedMockups = t.resultUrls.map(url => ({ mockupUrl: url.replace(API, ''), productType: 'mockup' }));
                                                                                    setMappingResults(recreatedMockups);
                                                                                }
                                                                            }
                                                                            setShowBgTasksDropdown(false);
                                                                        }}
                                                                        style={{
                                                                            padding: '3px 8px',
                                                                            fontSize: '0.62rem',
                                                                            background: 'rgba(99, 102, 241, 0.08)',
                                                                            color: '#6366f1',
                                                                            border: 'none',
                                                                            borderRadius: '4px',
                                                                            fontWeight: 700,
                                                                            cursor: 'pointer'
                                                                        }}
                                                                    >
                                                                        View
                                                                    </button>
                                                                    <a
                                                                        href={t.resultUrl.startsWith('http') ? t.resultUrl : `${API}${t.resultUrl}`}
                                                                        download
                                                                        onClick={(e) => forceDownload(e, t.resultUrl.startsWith('http') ? t.resultUrl : `${API}${t.resultUrl}`)}
                                                                        style={{
                                                                            padding: '3px 8px',
                                                                            fontSize: '0.62rem',
                                                                            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                                                                            color: '#fff',
                                                                            borderRadius: '4px',
                                                                            fontWeight: 700,
                                                                            textDecoration: 'none',
                                                                            textAlign: 'center'
                                                                        }}
                                                                    >
                                                                        Download
                                                                    </a>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {t.status === 'failed' && (
                                                            <span style={{ fontSize: '0.62rem', color: '#ef4444', fontWeight: 600 }}>Error: {t.error}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <button className="st-icon-btn"><I d="M18 8a6 6 0 00-12 0c0 7-3 7-3 7h18s-3 0-3-7M13.7 21a2 2 0 01-3.4 0" /></button>
                            {/* <button className="st-icon-btn"><I d="M9.1 9a3 3 0 115.8 1c0 2-3 2-3 4M12 17h.01" /></button> */}
                            <div className="st-avatar">{user.initials}</div>
                            <div className="st-user-meta"><strong>{user.name}</strong><span>{user.plan}</span></div>
                            <button className="st-nav-logout-btn" onClick={onLogout} title="Log Out Session">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '5px' }}>
                                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                    <polyline points="16 17 21 12 16 7"></polyline>
                                    <line x1="21" y1="12" x2="9" y2="12"></line>
                                </svg>
                                Logout
                            </button>
                        </div>
                    </header>
                    <div className={`st-workspace ${tool === 'library' || tool === 'exports' || tool === 'mappings' || tool === 'print-advisor' || tool === 'colorway-manager' || tool === 'measurement' || tool.startsWith('admin') ? 'full-width' : ''}`}>
                        <main className={`st-center ${tool === 'repeat' ? 'no-scroll' : ''}`}>
                            <div className="st-page-head">
                                <div>
                                    <h1 className="st-title">{toolLabel} {tool === 'library' && <span className="st-pro-badge">Pro</span>}</h1>
                                    <p>{tool === 'dashboard' ? 'Build, customize, and run AI pipelines to transform your artwork into production-ready patterns.' : tool === 'pattern' ? 'Create, refine, and perfect repeat patterns with AI precision.' : tool === 'exports' ? 'View and download your recently exported assets.' : tool === 'print-advisor' ? 'Analyze your pattern and get production-ready print method recommendations.' : tool === 'colorway-manager' ? 'Generate systematic production colorways with color theory strategies.' : tool === 'measurement' ? 'View real-world dimensions, DPI calculations, and production readiness.' : tool.startsWith('admin') ? 'Manage users, view API billing logs, and adjust credit limits.' : 'Upload artwork and generate print-ready assets.'}</p>
                                </div>
                            </div>
                            {isLoadingState && <div className="st-error">Loading SQLite-backed studio state...</div>}
                            {(tool !== 'dashboard' && tool !== 'exports' && tool !== 'pattern' && tool !== 'inspire' && tool !== 'seamless' && tool !== 'mappings' && !tool.startsWith('admin')) && (
                                <div
                                    className={`st-upload ${isDrag ? 'dragging' : ''} ${preview ? 'has-image' : ''}`}
                                    onClick={() => fileRef.current?.click()}
                                    onDrop={(e) => { e.preventDefault(); setIsDrag(false); handleUpload(e.dataTransfer.files[0]); }}
                                    onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                                    onDragLeave={() => setIsDrag(false)}
                                >
                                    {preview ? (
                                        <div className="st-upload-preview"><img src={preview} alt="Uploaded" /><div><span className="st-upload-name">{uploaded?.originalName || 'Image'}</span><span className="st-upload-hint">Click to replace</span></div></div>
                                    ) : (
                                        <div className="st-upload-empty"><I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /><span>Upload Image</span></div>
                                    )}
                                </div>
                            )}
                            <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handlePreUpload(e.target.files[0], 'tool')} />
                            {renderCanvas()}
                            {error && <div className="st-error">{error}</div>}

                        </main>
                        {tool !== 'library' && tool !== 'exports' && tool !== 'mappings' && !tool.startsWith('admin') && (
                            <aside className="st-right-panel">
                                {tool === 'dashboard' ? (
                                    <div className="st-pl-right">
                                        <div className="st-pl-right-header">
                                            <strong>Live Preview</strong>
                                            {pipelineCurrentStep >= 0 && <span className="st-pl-step-indicator">Step {pipelineCurrentStep + 1} of {pipelineSteps.length}</span>}
                                        </div>
                                        <div className="st-pl-preview-area">
                                            {pipelinePreview ? (
                                                <img src={pipelinePreview} alt="Pipeline Preview" className="st-pl-preview-img" />
                                            ) : (
                                                <div className="st-pl-preview-empty">
                                                    <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={32} />
                                                    <span>Run your pipeline to see a live preview</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="st-pl-runs-section">
                                            <strong>Recent Runs</strong>
                                            {pipelineRuns.length > 0 ? (
                                                <div className="st-pl-runs-list">
                                                    {pipelineRuns.slice(0, 5).map(run => (
                                                        <div key={run.id} className="st-pl-run-row">
                                                            <div className="st-pl-run-info">
                                                                <strong>{run.name}</strong>
                                                                <span>{new Date(run.createdAt).toLocaleDateString()}</span>
                                                            </div>
                                                            <span className={`st-pl-run-status ${run.status}`}>{run.status}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="st-pl-runs-empty">No pipeline runs yet.</p>
                                            )}
                                        </div>
                                    </div>
                                ) : renderControls()}
                            </aside>
                        )}
                    </div>
                </div>

                {showSettingsModal && (
                    <div className="st-modal-overlay" onClick={() => setShowSettingsModal(false)}>
                        <div className="st-modal" onClick={e => e.stopPropagation()}>
                            <div className="st-modal-header">
                                <h2>Projects Management</h2>
                                <button className="st-modal-close" onClick={() => setShowSettingsModal(false)}>Ã—</button>
                            </div>
                            <div className="st-modal-body">
                                <div className="st-settings-projects">
                                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                                        <input type="text" id="newProjectName" placeholder="New Project Name..." className="st-input" style={{ flex: 1 }} />
                                        <button className="st-btn primary" onClick={async () => {
                                            const inp = document.getElementById('newProjectName');
                                            if (!inp.value) return;
                                            const r = await fetch(`${API}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: inp.value }) });
                                            if (r.ok) { inp.value = ''; loadStudioState(activeProject.id); }
                                        }}>Create Project</button>
                                    </div>
                                    {state.projects.map(p => (
                                        <div key={p.id} className="st-settings-project-row">
                                            <img
                                                src={p.thumbnailUrl && p.thumbnailUrl.startsWith('/') ? `${API}${p.thumbnailUrl}` : (p.thumbnailUrl || '/demo_geometric.png')}
                                                alt="Thumb"
                                                style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', border: '1px solid #e2e7f0', cursor: 'pointer' }}
                                                title="Click to update thumbnail URL"
                                                onClick={async () => {
                                                    const url = prompt('Enter new image URL or path for this project thumbnail:', p.thumbnailUrl);
                                                    if (url && url !== p.thumbnailUrl) {
                                                        await fetch(`${API}/api/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thumbnail_url: url }) });
                                                        loadStudioState(activeProject.id);
                                                    }
                                                }}
                                            />
                                            <input
                                                type="text"
                                                defaultValue={p.name}
                                                className="st-input"
                                                onBlur={async (e) => {
                                                    if (e.target.value !== p.name && e.target.value.trim() !== '') {
                                                        await fetch(`${API}/api/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: e.target.value }) });
                                                        loadStudioState(activeProject.id);
                                                    }
                                                }}
                                            />
                                            <button className="st-btn danger" disabled={state.projects.length <= 1} onClick={async () => {
                                                if (!window.confirm('Are you sure? This will delete all history, variations, and settings for this project.')) return;
                                                await fetch(`${API}/api/projects/${p.id}`, { method: 'DELETE' });
                                                loadStudioState(state.projects.find(x => x.id !== p.id).id);
                                            }}>Delete</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {cropSrc && (
                    <div className="st-modal-overlay" style={{ zIndex: 9999 }}>
                        <div className="st-modal" style={{ maxWidth: '800px', width: '90%' }}>
                            <h2>Crop Image (Optional)</h2>
                            <p style={{ color: '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                Trim problematic edges before uploading. This is highly recommended to fix seams before making the pattern seamless. Skip if not needed.
                            </p>
                            <div style={{ maxHeight: '60vh', overflow: 'auto', background: '#f8fafc', padding: '1rem', borderRadius: '8px', display: 'flex', justifyContent: 'center' }}>
                                <ReactCrop crop={cropConfig} onChange={c => setCropConfig(c)}>
                                    <img src={cropSrc} ref={cropImageRef} alt="Crop preview" style={{ maxWidth: '100%', maxHeight: '55vh' }} />
                                </ReactCrop>
                            </div>
                            <div className="st-modal-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button className="st-btn-outline" onClick={cancelCrop}>Cancel</button>
                                <button className="st-btn-outline" onClick={() => {
                                    if (cropAction === 'pipeline') handlePipelineUpload(cropFile);
                                    else handleUpload(cropFile);
                                    cancelCrop();
                                }}>Skip Crop</button>
                                <button className="st-btn" onClick={applyCrop} disabled={!cropConfig?.width || !cropConfig?.height}>Apply & Upload</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            );
}











