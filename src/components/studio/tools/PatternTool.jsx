import React, { useState, useEffect, useRef } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

// Per-model credits must mirror EXTRACT_MODELS in backend/routes/generation.py
// and DEFAULT_CREDIT_PRICING in backend/db.py.  At 4 credits per INR 1, the
// credits below give ~57% gross margin per call.
const EXTRACT_MODEL_DEFS = [
    { id: 'openai/gpt-image-2', name: 'GPT Image 2', sub: 'OpenAI', brand: 'openai', logo: 'AI', credits: 148, icon: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z' },
    { id: 'google/imagen-4-ultra', name: 'Imagen 4 Ultra', sub: 'Google', brand: 'anthropic', logo: 'G', credits: 69, icon: 'M12 2L10.5 8 5 9.5 9.5 12 8 18l4.5-2L17 19l-1.5-5.5L20 10.5 14 9.5z' },
    { id: 'black-forest-labs/flux-2-pro', name: 'Flux 2 Pro', sub: 'Black Forest Labs', brand: 'deepseek', logo: 'FL', credits: 35, icon: 'M12 2C6.477 2 2 6.477 2 12c0 4.411 2.865 8.166 6.839 9.462.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.699-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.577.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z' },
    { id: 'bytedance/seedream-4.5', name: 'Seedream 4.5', sub: 'ByteDance', brand: 'bytedance', logo: 'BD', credits: 46, icon: 'M4 4h4v16H4zm6 4h4v12h-4zm6 4h4v8h-4z' }
];

export default function PatternTool({
    uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, setUploads, tool, currentToken, state, creditPricing, setEnhUrl, setTool
}) {
    // ===== LOCAL STATE =====
    const [extractResults, setExtractResults] = useState(EXTRACT_MODEL_DEFS.map(m => ({ ...m, loading: false, url: null, error: null, duration: 0 })));
    const [enabledModels, setEnabledModels] = useState(() => EXTRACT_MODEL_DEFS.reduce((acc, m) => ({ ...acc, [m.id]: true }), {}));
    const activeModels = EXTRACT_MODEL_DEFS.filter(m => enabledModels[m.id]);
    const activeModelCount = activeModels.length;
    const creditsPerModel = creditPricing?.extract || 148;
    const modelCreditCost = (model) => model.credits || creditsPerModel;
    const extractCreditCost = activeModels.reduce((sum, model) => sum + modelCreditCost(model), 0);
    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const hasEnoughExtractCredits = userRemainingCredits >= extractCreditCost;
    const [extractGalleryOpen, setExtractGalleryOpen] = useState(false);
    const [extractGalleryIndex, setExtractGalleryIndex] = useState(0);
    const [extractChatMessages, setExtractChatMessages] = useState({});
    const [extractChatInput, setExtractChatInput] = useState('');
    const [isExtractEditing, setIsExtractEditing] = useState(false);
    const [isDrag, setIsDrag] = useState(false);
    const fileRef = useRef(null);

    // File Upload Handler
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

    const handlePreUpload = (file) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        setUploads(prev => ({ ...prev, [tool]: { file, url } }));
        handleUpload(file);
    };

    const extractDesignMulti = async () => {
        const activeUrl = preview || activeProject.heroImageUrl;
        if (!uploaded && !activeUrl) { setError('Upload an image first'); return; }

        let safeFilename = uploaded?.filename;
        let safeUrl = !uploaded ? activeUrl : null;
        if (!safeFilename && safeUrl && !safeUrl.startsWith('http')) {
            safeFilename = safeUrl.split('/').pop();
            safeUrl = null;
        }

        const modelsToRun = EXTRACT_MODEL_DEFS.filter(m => enabledModels[m.id]);
        if (modelsToRun.length === 0) return;
        const requiredCredits = modelsToRun.reduce((sum, model) => sum + modelCreditCost(model), 0);
        if (userRemainingCredits < requiredCredits) {
            setError(`Insufficient credits. Pattern extraction needs ${requiredCredits} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }

        // Reset only enabled models to loading, clear disabled ones
        setExtractResults(EXTRACT_MODEL_DEFS.map(m => ({
            ...m,
            loading: enabledModels[m.id],
            url: null,
            error: enabledModels[m.id] ? null : 'disabled',
            duration: 0
        })));
        setExtractChatMessages({});
        setError('');

        // Fire individual requests per model so results stream in
        modelsToRun.forEach(async (modelDef) => {
            try {
                const r = await fetch(`${API}/api/extract-design-single`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: safeFilename,
                        imageUrl: safeUrl,
                        projectId: activeProject.id,
                        userId: user?.id,
                        modelId: modelDef.id
                    })
                });
                const d = await r.json();
                if (d.success) {
                    setExtractResults(prev => prev.map(m =>
                        m.id === modelDef.id
                            ? { ...m, loading: false, url: d.resultUrl, error: d.error, duration: d.duration }
                            : m
                    ));
                    updateCreditsFromResponse(d);
                } else {
                    setExtractResults(prev => prev.map(m =>
                        m.id === modelDef.id
                            ? { ...m, loading: false, error: d.error || 'Failed' }
                            : m
                    ));
                }
            } catch (err) {
                setExtractResults(prev => prev.map(m =>
                    m.id === modelDef.id
                        ? { ...m, loading: false, error: err.message }
                        : m
                ));
            }
        });
    };


    const sendExtractEdit = async () => {
        const model = extractResults[extractGalleryIndex];
        if (!model?.url || !extractChatInput.trim() || isExtractEditing) return;

        const userMsg = extractChatInput.trim();
        setExtractChatInput('');
        setIsExtractEditing(true);

        // Add user message to chat
        setExtractChatMessages(prev => ({
            ...prev,
            [model.id]: [...(prev[model.id] || []), { role: 'user', content: userMsg }]
        }));

        try {
            const r = await fetch(`${API}/api/extract-edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageUrl: model.url,
                    prompt: userMsg,
                    modelId: model.id,
                    projectId: activeProject.id,
                    userId: user?.id
                })
            });
            const d = await r.json();
            if (d.success) {
                // Add AI response with image
                setExtractChatMessages(prev => ({
                    ...prev,
                    [model.id]: [...(prev[model.id] || []), { role: 'ai', content: 'Updated pattern:', imageUrl: d.resultUrl }]
                }));
                // Update the model's result URL
                setExtractResults(prev => prev.map((m, i) =>
                    i === extractGalleryIndex ? { ...m, url: d.resultUrl } : m
                ));
                updateCreditsFromResponse(d);
            } else {
                setExtractChatMessages(prev => ({
                    ...prev,
                    [model.id]: [...(prev[model.id] || []), { role: 'ai', content: `Error: ${d.error || 'Edit failed'}` }]
                }));
            }
        } catch (err) {
            setExtractChatMessages(prev => ({
                ...prev,
                [model.id]: [...(prev[model.id] || []), { role: 'ai', content: `Error: ${err.message}` }]
            }));
        }
        setIsExtractEditing(false);
    };


    const anyLoading = extractResults.some(m => m.loading);
    const anyResults = extractResults.some(m => m.url);
    const visibleResults = extractResults.filter(m => enabledModels[m.id]);
    const completedResults = visibleResults.filter(m => m.url);
    const galleryModel = extractResults[extractGalleryIndex];
    const galleryChats = extractChatMessages[galleryModel?.id] || [];

    if (!preview) {
        return (
            <div className="st-pattern-layout" style={{ display: 'flex', flex: 1, padding: '2rem' }}>
                <div
                    className={`st-dropzone-creative ${isDrag ? 'dragging' : ''}`}
                    onClick={() => fileRef.current?.click()}
                    onDrop={(e) => { e.preventDefault(); setIsDrag(false); handleUpload(e.dataTransfer.files[0]); }}
                    onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                    onDragLeave={() => setIsDrag(false)}
                >
                    <div className="st-particles">
                        <div className="st-particle" /><div className="st-particle" /><div className="st-particle" />
                        <div className="st-particle" /><div className="st-particle" /><div className="st-particle" />
                    </div>
                    <div className="st-dropzone-icon-wrap">
                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={36} />
                    </div>
                    <h2 className="st-dropzone-title">Upload artwork to extract</h2>
                    <p className="st-dropzone-desc">Drag & drop or click — 4 AI models will compete to extract the best pattern</p>
                    <div className="st-dropzone-badges">
                        <span className="st-dropzone-badge">PNG</span>
                        <span className="st-dropzone-badge">JPG</span>
                        <span className="st-dropzone-badge">TIFF</span>
                        <span className="st-dropzone-badge">4 AI Models</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="st-pattern-extract-page">

            {/* === TOP CARD: Source + AI Models === */}
            <div className="st-pattern-extract-top">
                {/* Source Pattern */}
                <div className="st-pattern-source-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1f2937' }}>Source Pattern</span>
                        <button onClick={() => fileRef.current?.click()} style={{
                            background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer',
                            fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
                        }}>
                            <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" s={12} />
                            Replace
                        </button>
                    </div>
                    <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #e5e7eb', aspectRatio: '1' }}>
                        <img src={preview} alt="Source" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                        {uploaded && <span style={{ fontSize: '0.7rem', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '3px', background: '#f3f4f6', padding: '3px 8px', borderRadius: '6px' }}>
                            <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16" s={10} />
                            {uploaded.filename?.split('.').pop()?.toUpperCase() || 'IMG'}
                        </span>}
                    </div>
                </div>

                {/* AI Models Selection */}
                <div className="st-pattern-models-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div>
                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1f2937' }}>AI Models</span>
                            <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '2px 0 0' }}>Select which models to use for extraction.</p>
                        </div>
                        <button
                            onClick={() => {
                                const allOn = EXTRACT_MODEL_DEFS.every(m => enabledModels[m.id]);
                                const next = EXTRACT_MODEL_DEFS.reduce((acc, m) => ({ ...acc, [m.id]: !allOn }), {});
                                setEnabledModels(next);
                            }}
                            disabled={anyLoading}
                            style={{
                                background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer',
                                fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
                            }}
                        >
                            {EXTRACT_MODEL_DEFS.every(m => enabledModels[m.id]) ? 'Deselect All' : 'Select All'}
                            <I d="M5 13l4 4L19 7" s={14} />
                        </button>
                    </div>
                    <div className="st-pattern-model-grid">
                        {EXTRACT_MODEL_DEFS.map(m => {
                            const on = enabledModels[m.id];
                            const descriptions = {
                                'openai/gpt-image-2': { desc: 'Great for balanced creativity and pattern coherence.', tag: 'High Quality', tagColor: '#6366f1' },
                                'google/imagen-4-ultra': { desc: 'Excellent for detail recreation and color accuracy.', tag: 'Photorealistic', tagColor: '#3b82f6' },
                                'black-forest-labs/flux-2-pro': { desc: 'Outstanding for artistic style and intricate patterns.', tag: 'Creative', tagColor: '#a855f7' },
                                'bytedance/seedream-4.5': { desc: 'Strong with texture preservation and soft details.', tag: 'Textured', tagColor: '#f59e0b' },
                            };
                            const info = descriptions[m.id] || { desc: '', tag: '', tagColor: '#888' };
                            return (
                                <div
                                    key={m.id}
                                    className="st-pattern-model-select-card"
                                    onClick={() => !anyLoading && setEnabledModels(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                                    style={{
                                        border: on ? `2px solid ${m.color}` : '2px solid #e5e7eb',
                                        cursor: anyLoading ? 'not-allowed' : 'pointer',
                                        background: on ? `${m.color}08` : '#fafafa',
                                        opacity: anyLoading ? 0.6 : 1,
                                    }}
                                >
                                    {/* Checkbox */}
                                    <div style={{
                                        position: 'absolute', top: '10px', right: '10px',
                                        width: '20px', height: '20px', borderRadius: '50%',
                                        background: on ? m.color : '#e5e7eb',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.2s ease',
                                    }}>
                                        {on && <I d="M5 13l4 4L19 7" s={12} style={{ color: '#fff' }} />}
                                    </div>
                                    {/* Icon */}
                                    <div style={{
                                        width: '40px', height: '40px', borderRadius: '12px',
                                        background: `${m.color}15`, color: m.color,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        marginBottom: '10px',
                                    }}>
                                        <I d={m.icon} s={22} />
                                    </div>
                                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1f2937', marginBottom: '4px' }}>{m.name}</div>
                                    <div style={{ fontSize: '0.68rem', color: '#6b7280', lineHeight: 1.4, marginBottom: '8px', minHeight: '2.8em' }}>{info.desc}</div>
                                    <span style={{
                                        fontSize: '0.65rem', fontWeight: 600, padding: '3px 8px', borderRadius: '6px',
                                        background: `${info.tagColor}12`, color: info.tagColor,
                                        border: `1px solid ${info.tagColor}25`,
                                    }}>{info.tag}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* === EXTRACT BUTTON === */}
            <button
                className={`st-extract-btn-creative ${!hasEnoughExtractCredits ? 'insufficient-credits' : ''}`}
                onClick={extractDesignMulti}
                disabled={anyLoading || !preview || activeModelCount === 0 || !hasEnoughExtractCredits}
                title={!hasEnoughExtractCredits ? `Need ${extractCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Extract pattern with selected AI models'}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}>
                    <div className={anyLoading ? 'spin-icon' : ''}>
                        <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={20} />
                    </div>
                    {anyLoading ? `Extracting with ${activeModelCount} AI...` : activeModelCount === 0 ? 'Select Models Above' : hasEnoughExtractCredits ? `Extract Pattern with AI` : `Need ${extractCreditCost} credits`}
                    {!anyLoading && <span style={{ fontSize: '1rem' }}>→</span>}
                </div>
                <span style={{ fontSize: '0.72rem', opacity: 0.8, fontWeight: 500 }}>
                    {activeModelCount} model{activeModelCount !== 1 ? 's' : ''} selected · ~{extractCreditCost} credits
                </span>
            </button>
            {!hasEnoughExtractCredits && (
                <div className="st-credit-shortage">
                    {userRemainingCredits.toLocaleString()} credits remaining. Deselect models or recharge to run this extraction.
                </div>
            )}

            {/* === EXTRACTION RESULTS === */}
            <div className="st-pattern-results-section">
                <div className="st-pattern-results-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1f2937', margin: 0 }}>Extraction Results</h3>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: '8px' }}>
                            {activeModelCount}
                        </span>
                        {anyResults && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, background: 'rgba(34,197,94,0.1)', color: '#22c55e', padding: '2px 8px', borderRadius: '8px' }}>
                                {completedResults.length}/{activeModelCount} complete
                            </span>
                        )}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Compare outputs from each AI model side by side.</span>
                </div>
                <div className="st-extract-grid">
                    {visibleResults.map((model) => {
                        const originalIdx = extractResults.findIndex(m => m.id === model.id);
                        return (
                            <div
                                key={model.id}
                                className={`st-extract-model-card ${model.loading ? 'loading' : ''} ${model.url ? 'completed' : ''} ${model.error && !model.url && model.error !== 'disabled' ? 'error' : ''}`}
                                onClick={() => {
                                    if (model.url) {
                                        setExtractGalleryIndex(originalIdx);
                                        setExtractGalleryOpen(true);
                                    }
                                }}
                            >
                                <div className="st-extract-model-header">
                                    <span className={`st-model-dot ${model.loading ? 'loading' : ''}`} style={{ backgroundColor: model.color }} />
                                    <I d={model.icon} s={15} />
                                    {model.name}
                                    {model.loading && (
                                        <span className="st-model-status" style={{ background: `${model.color}18`, color: model.color }}>Processing...</span>
                                    )}
                                    {model.url && (
                                        <span className="st-model-status" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                                            {model.duration}s
                                        </span>
                                    )}
                                    {model.error && !model.url && model.error !== 'disabled' && (
                                        <span className="st-model-status" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>Failed</span>
                                    )}
                                </div>
                                <div className="st-extract-model-body">
                                    {model.url ? (
                                        <>
                                            <img src={`${API}${model.url}`} alt={model.name} />
                                            <div className="st-extract-overlay">
                                                <I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={18} />
                                                <I d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" s={18} />
                                                View & Edit
                                            </div>
                                        </>
                                    ) : model.loading ? (
                                        <div className="st-ai-processing" style={{ transform: 'scale(0.7)' }}>
                                            <div className="st-ai-sparkle-container">
                                                <div className="st-ai-sparkle-icon" style={{ color: model.color }}>
                                                    <I d={model.icon} s={24} />
                                                </div>
                                                <div className="st-ai-ring" style={{ borderColor: `${model.color}40` }} />
                                                <div className="st-ai-ring" style={{ borderColor: `${model.color}25` }} />
                                                <div className="st-ai-ring" style={{ borderColor: `${model.color}15` }} />
                                            </div>
                                        </div>
                                    ) : model.error && model.error !== 'disabled' ? (
                                        <div style={{ textAlign: 'center', color: '#ef4444', padding: '1.5rem', fontSize: '0.8rem' }}>
                                            <I d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" s={28} />
                                            <p style={{ marginTop: '0.5rem' }}>Failed</p>
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.78rem', padding: '1.5rem 0.5rem' }}>
                                            <I d={model.icon} s={32} />
                                            <p style={{ marginTop: '0.5rem', fontWeight: 600, color: '#6b7280' }}>Ready to generate</p>
                                            <p style={{ fontSize: '0.68rem', color: '#9ca3af', marginTop: '2px' }}>Click extract to see results</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Quick Actions */}
            {anyResults && (
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div className="st-quick-actions">
                        <button className="st-quick-action-btn primary" onClick={() => { if (completedResults[0]) { setExtractGalleryIndex(extractResults.indexOf(completedResults[0])); setExtractGalleryOpen(true); } }}>
                            <I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={14} /> Open Gallery
                        </button>
                        <button className="st-quick-action-btn" onClick={(e) => { if (completedResults[0]) forceDownload(e, `${API}${completedResults[0].url}`); }}>
                            <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /> Download Best
                        </button>
                        <button className="st-quick-action-btn" onClick={() => { if (completedResults[0]) { setEnhUrl(completedResults[0].url); setTool('seamless'); } }}>
                            <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" s={14} /> Send to Seamless
                        </button>
                    </div>
                </div>
            )}

            {/* ===== GALLERY LIGHTBOX OVERLAY ===== */}
            {extractGalleryOpen && galleryModel && (
                <div className="st-extract-gallery-overlay" onClick={() => setExtractGalleryOpen(false)} onKeyDown={(e) => {
                    if (e.key === 'Escape') setExtractGalleryOpen(false);
                    if (e.key === 'ArrowLeft') setExtractGalleryIndex(p => (p - 1 + extractResults.length) % extractResults.length);
                    if (e.key === 'ArrowRight') setExtractGalleryIndex(p => (p + 1) % extractResults.length);
                }} tabIndex={0} ref={el => el?.focus()}>
                    <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        {/* Header */}
                        <div className="st-extract-gallery-header">
                            <div className="st-gallery-model-name">
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: galleryModel.color, display: 'inline-block' }} />
                                <I d={galleryModel.icon} s={18} />
                                {galleryModel.name}
                                <span className="st-gallery-model-badge" style={{ background: `${galleryModel.color}20`, color: galleryModel.color }}>
                                    {galleryModel.duration}s
                                </span>
                            </div>
                            <div className="st-gallery-actions">
                                {galleryModel.url && (
                                    <>
                                        <button onClick={(e) => forceDownload(e, `${API}${galleryModel.url}`)}>
                                            <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /> Download
                                        </button>
                                        <button onClick={() => { setEnhUrl(galleryModel.url); setTool('seamless'); setExtractGalleryOpen(false); }}>
                                            <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" s={14} /> Seamless
                                        </button>
                                        <button onClick={() => { setEnhUrl(galleryModel.url); setTool('repeat'); setExtractGalleryOpen(false); }}>
                                            <I d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" s={14} /> Repeat
                                        </button>
                                    </>
                                )}
                                <button className="st-gallery-close" onClick={() => setExtractGalleryOpen(false)}>✕</button>
                            </div>
                        </div>

                        {/* Main Image */}
                        <div className="st-extract-gallery-main">
                            <button className="st-extract-gallery-nav prev" onClick={() => setExtractGalleryIndex(p => (p - 1 + extractResults.length) % extractResults.length)}>
                                <I d="M15 19l-7-7 7-7" s={22} />
                            </button>
                            {galleryModel.url ? (
                                <img src={`${API}${galleryModel.url}`} alt={galleryModel.name} key={galleryModel.url} />
                            ) : galleryModel.loading ? (
                                <div className="st-ai-processing">
                                    <div className="st-ai-sparkle-container">
                                        <div className="st-ai-sparkle-icon" style={{ color: galleryModel.color }}><I d={galleryModel.icon} s={36} /></div>
                                        <div className="st-ai-ring" /><div className="st-ai-ring" /><div className="st-ai-ring" />
                                    </div>
                                    <span className="st-ai-phase-text" style={{ color: '#fff' }}>Generating with {galleryModel.name}...</span>
                                </div>
                            ) : (
                                <div style={{ color: '#fff', textAlign: 'center' }}>
                                    <I d="M12 9v2m0 4h.01" s={48} />
                                    <p>{galleryModel.error || 'No result yet'}</p>
                                </div>
                            )}
                            <button className="st-extract-gallery-nav next" onClick={() => setExtractGalleryIndex(p => (p + 1) % extractResults.length)}>
                                <I d="M9 5l7 7-7 7" s={22} />
                            </button>
                        </div>

                        {/* Dots */}
                        <div className="st-extract-gallery-dots">
                            {extractResults.map((m, i) => (
                                <button
                                    key={m.id}
                                    className={`st-extract-gallery-dot ${i === extractGalleryIndex ? 'active' : ''}`}
                                    style={i === extractGalleryIndex ? { background: m.color, boxShadow: `0 0 10px ${m.color}80` } : {}}
                                    onClick={() => setExtractGalleryIndex(i)}
                                    title={m.name}
                                />
                            ))}
                        </div>

                        {/* Chat Panel */}
                        {galleryModel.url && (
                            <div className="st-extract-chat">
                                <div className="st-extract-chat-header">
                                    <I d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" s={14} />
                                    Chat with {galleryModel.name}
                                </div>
                                <div className="st-extract-chat-messages">
                                    {galleryChats.length === 0 && (
                                        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.78rem', textAlign: 'center', padding: '0.5rem' }}>
                                            Ask {galleryModel.name} to edit this pattern...
                                        </div>
                                    )}
                                    {galleryChats.map((msg, i) => (
                                        <div key={i} className={`st-extract-chat-bubble ${msg.role}`}>
                                            {msg.content}
                                            {msg.imageUrl && (
                                                <img src={`${API}${msg.imageUrl}`} alt="Edit result" onClick={() => {
                                                    setExtractResults(prev => prev.map((m, idx) =>
                                                        idx === extractGalleryIndex ? { ...m, url: msg.imageUrl } : m
                                                    ));
                                                }} />
                                            )}
                                        </div>
                                    ))}
                                    {isExtractEditing && (
                                        <div className="st-extract-chat-bubble ai" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <div className="st-spinner" style={{ width: 14, height: 14 }} /> Editing with {galleryModel.name}...
                                        </div>
                                    )}
                                </div>
                                <div className="st-extract-chat-input-bar">
                                    <input
                                        value={extractChatInput}
                                        onChange={e => setExtractChatInput(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendExtractEdit(); } }}
                                        placeholder={`e.g. "Make flowers smaller" or "Change to blue tones"`}
                                        disabled={isExtractEditing}
                                    />
                                    <button className="st-extract-chat-send" onClick={sendExtractEdit} disabled={isExtractEditing || !extractChatInput.trim()}>
                                        <I d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" s={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );

}
