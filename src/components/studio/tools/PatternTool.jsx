import React, { useState, useEffect } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';
import ImageDropzone from '../shared/ImageDropzone';
import { useImageDropzone } from '../shared/useImageDropzone';

// Per-model credits must mirror EXTRACT_MODELS in backend/routes/generation.py
// and DEFAULT_CREDIT_PRICING in backend/db.py.  At 4 credits per INR 1, the
// credits below give ~57% gross margin per call.
const EXTRACT_MODEL_DEFS = [
    { id: 'google/nano-banana-2', name: 'Nano Banana 2', sub: 'Google', brand: 'google', logo: 'N2', credits: 78, accent: '#4285f4' },
    { id: 'google/imagen-4-ultra', name: 'Imagen 4 Ultra', sub: 'Google', brand: 'google', logo: 'IU', credits: 69, accent: '#4285f4' },
    { id: 'black-forest-labs/flux-2-pro', name: 'Flux 2 Pro', sub: 'Black Forest Labs', brand: 'bfl', logo: 'F2', credits: 104, accent: '#6366f1' },
    { id: 'bytedance/seedream-4.5', name: 'Seedream 4.5', sub: 'ByteDance', brand: 'bytedance', logo: 'SD', credits: 46, accent: '#f59e0b' },
];

export default function PatternTool({
    uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, tool, creditPricing, setEnhUrl, setTool,
    handlePreUpload, onUploadInvalid, onUploadPaste,
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

    const { pasteProps, openFilePicker, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

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
                <ImageDropzone
                    title="Upload artwork to extract"
                    description="Drag & drop, paste, or click — 4 AI models will compete to extract the best pattern"
                    badges={['PNG', 'JPG', 'WEBP', '4 AI Models']}
                    onFile={handlePreUpload}
                    onInvalidFile={onUploadInvalid}
                    onPasteSuccess={onUploadPaste}
                />
            </div>
        );
    }

    return (
        <div {...pasteProps} className="st-pattern-paste-wrap">
        <div className="st-pattern-extract-page">

            {/* === TOP CARD: Source + AI Models === */}
            <div className="st-pattern-extract-top">
                {/* Source Pattern */}
                <div className="st-pattern-source-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1f2937' }}>Source Pattern</span>
                        <button type="button" onClick={openFilePicker} style={{
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
                                'google/nano-banana-2': { desc: 'Fast and cost-effective with strong pattern extraction.', tag: 'Efficient', tagColor: '#4285f4' },
                                'google/imagen-4-ultra': { desc: 'Excellent for detail recreation and color accuracy.', tag: 'Photorealistic', tagColor: '#3b82f6' },
                                'black-forest-labs/flux-2-pro': { desc: 'Outstanding for artistic style and intricate patterns.', tag: 'Creative', tagColor: '#a855f7' },
                                'bytedance/seedream-4.5': { desc: 'Strong with texture preservation and soft details.', tag: 'Textured', tagColor: '#f59e0b' },
                            };
                            const info = descriptions[m.id] || { desc: '', tag: '', tagColor: '#888' };
                            return (
                                <div
                                    key={m.id}
                                    className={`st-pattern-model-select-card ${on ? 'selected' : ''}`}
                                    onClick={() => !anyLoading && setEnabledModels(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                                    style={{
                                        '--model-accent': m.accent,
                                        cursor: anyLoading ? 'not-allowed' : 'pointer',
                                        opacity: anyLoading ? 0.6 : 1,
                                    }}
                                >
                                    <div className={`st-pattern-model-check ${on ? 'on' : ''}`}>
                                        {on && <I d="M5 13l4 4L19 7" s={12} />}
                                    </div>
                                    <span className={`st-model-brand st-pattern-model-brand ${m.brand}`}>{m.logo}</span>
                                    <div className="st-pattern-model-name">{m.name}</div>
                                    <div className="st-pattern-model-desc">{info.desc}</div>
                                    <span
                                        className="st-pattern-model-tag"
                                        style={{
                                            background: `${info.tagColor}12`,
                                            color: info.tagColor,
                                            borderColor: `${info.tagColor}25`,
                                        }}
                                    >
                                        {info.tag}
                                    </span>
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
                                    <span className={`st-model-brand st-extract-model-brand ${model.brand}`}>{model.logo}</span>
                                    {model.name}
                                    {model.loading && (
                                        <span className="st-model-status" style={{ background: `${model.accent}18`, color: model.accent }}>Processing...</span>
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
                                                <div className="st-ai-sparkle-icon" style={{ color: model.accent }}>
                                                    <span className={`st-model-brand st-extract-model-brand ${model.brand}`}>{model.logo}</span>
                                                </div>
                                                <div className="st-ai-ring" style={{ borderColor: `${model.accent}40` }} />
                                                <div className="st-ai-ring" style={{ borderColor: `${model.accent}25` }} />
                                                <div className="st-ai-ring" style={{ borderColor: `${model.accent}15` }} />
                                            </div>
                                        </div>
                                    ) : model.error && model.error !== 'disabled' ? (
                                        <div style={{ textAlign: 'center', color: '#ef4444', padding: '1.5rem', fontSize: '0.8rem' }}>
                                            <I d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" s={28} />
                                            <p style={{ marginTop: '0.5rem' }}>Failed</p>
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.78rem', padding: '1.5rem 0.5rem' }}>
                                            <span className={`st-model-brand st-extract-model-brand lg ${model.brand}`}>{model.logo}</span>
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
                                    style={i === extractGalleryIndex ? { background: m.accent, boxShadow: `0 0 10px ${m.accent}80` } : {}}
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
        <input {...inputProps} />
        </div>
    );

}
