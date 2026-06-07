import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { I } from '../shared/StudioIcons';
import { API, apiFetch, forceDownload } from '../shared/helpers';
import { createPortal } from 'react-dom';

export default function DashboardTool(props) {
    const { uploaded, preview, activeProject, user, setError, setNotice, addBgTask, updateCreditsFromResponse, creditPricing, currentToken, tool, rightPanelEl, handleUpload, handlePreUpload, setTool } = props;

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const [isDrag, setIsDrag] = useState(false);
    const fileRef = useRef(null);
    const STEP_TYPES = [
        { type: 'upload', label: 'Upload', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12', desc: 'Upload artwork' },
        { type: 'extract', label: 'Extract Design', icon: 'M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z', desc: 'AI pattern extraction' },
        { type: 'seamless', label: 'Make Seamless', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z', desc: 'Seamless tiling' },
        { type: 'repeat', label: 'Repeat', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', desc: 'Repeat pattern grid' },
        { type: 'vectorize', label: 'Vectorize', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z', desc: 'Convert to SVG' },
        { type: 'upscale', label: 'Upscale', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7', desc: 'Enhance resolution' },
        { type: 'export', label: 'Export', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', desc: 'Export output' },
    ];
    const PIPELINE_CATEGORIES = {
        'AI Tools': ['extract', 'seamless', 'vectorize', 'upscale'],
        'Layout': ['repeat'],
        'Utility': ['upload', 'export']
    };
    // Fallback credit costs mirror DEFAULT_CREDIT_PRICING in backend/db.py
    // (4 credits per INR 1, ~57% gross margin).  Live values arrive via
    // /api/credit-pricing and override these.
    const STEP_TYPES_MAP = {
        upload: { label: 'Upload Input', cost: 0 },
        extract: { label: 'Pattern Extract', cost: creditPricing?.extract || 148 },
        seamless: { label: 'Make Seamless', cost: creditPricing?.seamless || 58 },
        repeat: { label: 'Repeat Set', cost: creditPricing?.repeat || 5 },
        vectorize: { label: 'Vectorize SVG', cost: creditPricing?.vectorize || 12 },
        upscale: { label: 'Super Resolution', cost: creditPricing?.upscale || 23 },
        export: { label: 'Export Output', cost: 0 },
    };
    const PIPELINE_TEMPLATES = [
        { id: 'extract', name: 'Extract & Clean', desc: 'AI extraction followed by seamless layout.', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z', steps: ['upload', 'extract', 'seamless', 'export'] },
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

    useEffect(() => {
        if (tool === 'dashboard' && activeProject?.id) {
            if (currentToken) {
                apiFetch(`/api/pipeline-runs?project_id=${activeProject.id}`, {}, currentToken)
                    .then((d) => { if (d.success) setPipelineRuns(d.runs); })
                    .catch(() => { });
            }
            fetch(`${API}/api/workflows`).then(r => r.json()).then(d => {
                if (d.success) setSavedProfiles(d.workflows);
            }).catch(() => { });
        }
    }, [tool, activeProject?.id, currentToken]);

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
        if (userRemainingCredits < estimatedCredits) {
            setError(`Insufficient credits. This pipeline needs ${estimatedCredits} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }

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
                        body: JSON.stringify({ projectId: activeProject.id, filename: currentInput, userId: user?.id }),
                    });
                    const d = await r.json();
                    if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); updateCreditsFromResponse(d); }
                    else throw new Error(d.error || 'Extraction failed');
                } else if (step.type === 'seamless') {
                    const r = await fetch(`${API}/api/make-seamless`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: activeProject.id, filename: currentInput, userId: user?.id }),
                    });
                    const d = await r.json();
                    if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); updateCreditsFromResponse(d); }
                    else throw new Error(d.error || 'Seamless failed');
                } else if (step.type === 'repeat') {
                    const r = await fetch(`${API}/api/create-repeat-set`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            projectId: activeProject.id, filename: currentInput, userId: user?.id,
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
                        body: JSON.stringify({ projectId: activeProject.id, filename: currentInput, factor: step.settings?.upscaleFactor || 'x4', userId: user?.id }),
                    });
                    const d = await r.json();
                    if (d.success && d.resultUrl) { resultUrl = `${API}${d.resultUrl}`; currentInput = d.resultUrl.split('/').pop(); updateCreditsFromResponse(d); }
                    else throw new Error(d.error || 'Upscale failed');
                } else if (step.type === 'vectorize') {
                    const r = await fetch(`${API}/api/vectorize`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: activeProject.id, filename: currentInput, userId: user?.id }),
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
            setError('Please enter a name for your pipeline profile.');
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
                setNotice?.('Pipeline profile saved successfully.');
                setSavedProfiles([{
                    id: rd.workflowId,
                    name: pipelineName.trim(),
                    steps: pipelineSteps.map(s => s.type),
                    settings: pipelineSteps.reduce((acc, s) => ({ ...acc, [s.type]: s.settings }), {}),
                }, ...savedProfiles]);
            } else {
                setError('Failed to save pipeline profile.');
            }
        } catch {
            setError('Error connecting to server.');
        }
    };
    // ===== END PIPELINE =====

    const [repeatTab, setRepeatTab] = useState('canvas');
    const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
    const [canvasZoom, setCanvasZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const [showTileBoundary, setShowTileBoundary] = useState(true);



    const renderCanvasBlock = () => {
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
                        <button
                            className={`st-pl-run-btn ${userRemainingCredits < estimatedCredits ? 'insufficient-credits' : ''}`}
                            disabled={pipelineRunning || pipelineSteps.length === 0 || userRemainingCredits < estimatedCredits}
                            onClick={runPipeline}
                            title={userRemainingCredits < estimatedCredits ? `Need ${estimatedCredits} credits. You have ${userRemainingCredits} remaining.` : 'Run pipeline'}
                        >
                            {pipelineRunning ? <><div className="st-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Running...</> : userRemainingCredits < estimatedCredits ? <>Need {estimatedCredits} credits</> : <><I d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" s={18} /> Run Pipeline</>}
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

    };

    const renderToolControls = () => {
        return (
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

        );
    };

    return (
        <>
            {renderCanvasBlock()}
            {rightPanelEl && createPortal(
                <div className="st-pl-right" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {renderToolControls()}
                </div>,
                rightPanelEl
            )}
        </>
    );
}
