import React, { useState, useEffect } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload, jsonAuthHeaders, resolveImagePayload, cacheMediaFromResponse, mediaUrl, openFileInTool } from '../shared/helpers';
import MediaImg from '../shared/MediaImg';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import UploadImageFrame from '../shared/UploadImageFrame';
import '../../../styles/tools/pattern.css';
import ImageDropzone from '../shared/ImageDropzone';
import { useImageDropzone } from '../shared/useImageDropzone';
import OpenInQwenButton from '../shared/OpenInQwenButton';
import ModelLoadingBar from '../shared/ModelLoadingBar';
import { isProUser } from '../shared/planTiers';
import ProUpgradeModal from '../shared/ProUpgradeModal';

const EXTRACT_CREDIT_KEYS = {
    'xai/grok-imagine-image': 'extract_grok',
    'google/nano-banana': 'extract_nano_banana',
    'google/nano-banana-2': 'extract_nano_banana_2',
    'bytedance/seedream-4.5': 'extract_seedream',
    'google/imagen-4-fast': 'extract_imagen_fast',
    'google/imagen-4-ultra': 'extract_imagen_ultra',
    'black-forest-labs/flux-schnell': 'extract_flux_schnell',
    'black-forest-labs/flux-2-pro': 'extract_flux_2_pro',
    'openai/gpt-image-2': 'extract_gpt_image_2',
};

// Per-model credits must mirror EXTRACT_MODELS in backend/routes/generation.py
// Formula: ceil(usd * 1150). Pro models gated by plan.
const EXTRACT_MODEL_DEFS = [
    { id: 'black-forest-labs/flux-schnell', name: 'Flux Schnell', sub: 'Black Forest', brand: 'bfl', logo: 'FS', credits: 4, accent: '#a855f7', tier: 'normal' },
    { id: 'xai/grok-imagine-image', name: 'Grok Imagine', sub: 'xAI', brand: 'xai', logo: 'GR', credits: 23, accent: '#1d9bf0', tier: 'normal' },
    { id: 'google/imagen-4-fast', name: 'Imagen 4 Fast', sub: 'Google', brand: 'google', logo: 'I4', credits: 23, accent: '#34a853', tier: 'normal' },
    { id: 'google/nano-banana', name: 'Nano Banana', sub: 'Google', brand: 'google', logo: 'NB', credits: 45, accent: '#34a853', tier: 'normal' },
    { id: 'bytedance/seedream-4.5', name: 'Seedream 4.5', sub: 'ByteDance', brand: 'bytedance', logo: 'SD', credits: 46, accent: '#f59e0b', tier: 'pro' },
    { id: 'black-forest-labs/flux-2-pro', name: 'Flux 2 Pro', sub: 'Black Forest', brand: 'bfl', logo: 'F2', credits: 52, accent: '#7c3aed', tier: 'pro' },
    { id: 'google/imagen-4-ultra', name: 'Imagen 4 Ultra', sub: 'Google', brand: 'google', logo: 'IU', credits: 69, accent: '#0f9d58', tier: 'pro' },
    { id: 'google/nano-banana-2', name: 'Nano Banana 2', sub: 'Google', brand: 'google', logo: 'N2', credits: 78, accent: '#4285f4', tier: 'pro' },
    { id: 'openai/gpt-image-2', name: 'GPT Image 2', sub: 'OpenAI', brand: 'openai', logo: 'G2', credits: 148, accent: '#111827', tier: 'pro' },
];

export default function PatternTool({
    uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, tool, creditPricing,
    setEnhUrl, setSeamlessUrl, setRepeatUrl, setTool,
    handlePreUpload, onUploadInvalid, onUploadPaste, currentToken, uploadStatus, isUploading, setQwenLaunch, setUploads,
}) {
    const handoffSetters = { setTool, setEnhUrl, setSeamlessUrl, setRepeatUrl, setUploads, tool };
    // ===== LOCAL STATE =====
    const userIsPro = isProUser(user);
    const [extractResults, setExtractResults] = useState(EXTRACT_MODEL_DEFS.map(m => ({ ...m, loading: false, url: null, error: null, duration: 0 })));
    const [enabledModels, setEnabledModels] = useState(() =>
        EXTRACT_MODEL_DEFS.reduce((acc, m) => ({ ...acc, [m.id]: m.tier !== 'pro' }), {})
    );
    const activeModels = EXTRACT_MODEL_DEFS.filter(m => enabledModels[m.id] && (m.tier !== 'pro' || userIsPro));
    const activeModelCount = activeModels.length;
    const creditsPerModel = creditPricing?.extract || 45;
    const modelCreditCost = (model) =>
        creditPricing?.[EXTRACT_CREDIT_KEYS[model.id]] || model.credits || creditsPerModel;
    const extractCreditCost = activeModels.reduce((sum, model) => sum + modelCreditCost(model), 0);
    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const hasEnoughExtractCredits = userRemainingCredits >= extractCreditCost;
    const [extractGalleryOpen, setExtractGalleryOpen] = useState(false);
    const [extractGalleryIndex, setExtractGalleryIndex] = useState(0);
    const [extractChatMessages, setExtractChatMessages] = useState({});
    const [extractChatInput, setExtractChatInput] = useState('');
    const [isExtractEditing, setIsExtractEditing] = useState(false);
    const [proGateModel, setProGateModel] = useState(null);

    const { pasteProps, openFilePicker, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

    const extractDesignMulti = async () => {
        const imagePayload = resolveImagePayload({
            uploaded,
            preview,
            heroImageUrl: activeProject?.heroImageUrl,
        });
        if (!imagePayload || imagePayload.pending) {
            setError(imagePayload?.pending
                ? 'Image is still uploading — wait a moment and try again.'
                : 'Upload an image first');
            return;
        }

        const modelsToRun = EXTRACT_MODEL_DEFS.filter(m => enabledModels[m.id] && (m.tier !== 'pro' || userIsPro));
        if (modelsToRun.length === 0) return;
        const lockedPro = EXTRACT_MODEL_DEFS.some(m => enabledModels[m.id] && m.tier === 'pro' && !userIsPro);
        if (lockedPro) {
            const locked = EXTRACT_MODEL_DEFS.find(m => enabledModels[m.id] && m.tier === 'pro' && !userIsPro);
            setProGateModel(locked?.name || 'This model');
            return;
        }
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
                    headers: jsonAuthHeaders(currentToken),
                    body: JSON.stringify({
                        filename: imagePayload.filename,
                        imageUrl: imagePayload.imageUrl,
                        projectId: activeProject.id,
                        userId: user?.id,
                        modelId: modelDef.id
                    })
                });
                const d = await r.json();
                cacheMediaFromResponse(d);
                if (r.ok && d.success) {
                    setExtractResults(prev => prev.map(m =>
                        m.id === modelDef.id
                            ? { ...m, loading: false, url: d.resultUrl, error: d.error, duration: d.duration }
                            : m
                    ));
                    updateCreditsFromResponse(d);
                } else {
                    setExtractResults(prev => prev.map(m =>
                        m.id === modelDef.id
                            ? { ...m, loading: false, error: d.error || `HTTP ${r.status}` }
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
                headers: jsonAuthHeaders(currentToken),
                body: JSON.stringify({
                    imageUrl: model.url,
                    prompt: userMsg,
                    modelId: model.id,
                    projectId: activeProject.id,
                    userId: user?.id
                })
            });
            const d = await r.json();
            cacheMediaFromResponse(d);
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
                    uploadStatus={uploadStatus}
                    onFile={handlePreUpload}
                    onInvalidFile={onUploadInvalid}
                    onPasteSuccess={onUploadPaste}
                />
            </div>
        );
    }

    return (
        <div {...pasteProps} className="st-pattern-paste-wrap">
        <ProUpgradeModal
            open={Boolean(proGateModel)}
            modelName={proGateModel}
            onClose={() => setProGateModel(null)}
            onViewPlans={() => typeof setTool === 'function' && setTool('billing')}
        />
        <div className="st-pattern-extract-page">

            {/* === TOP CARD: Source + AI Models === */}
            <div className="st-pattern-extract-top">
                {/* Source Pattern */}
                <div className="st-pattern-source-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1f2937' }}>Source Pattern</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <UploadStatusBadge status={uploadStatus} />
                            <button type="button" onClick={openFilePicker} style={{
                            background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer',
                            fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
                        }}>
                            <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" s={12} />
                            Replace
                        </button>
                        </div>
                    </div>
                    <UploadImageFrame status={uploadStatus} style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #e5e7eb', aspectRatio: '1' }}>
                        <img src={preview} alt="Source" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </UploadImageFrame>
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
                                const selectable = EXTRACT_MODEL_DEFS.filter(m => m.tier !== 'pro' || userIsPro);
                                const allOn = selectable.every(m => enabledModels[m.id]);
                                const next = EXTRACT_MODEL_DEFS.reduce((acc, m) => {
                                    if (m.tier === 'pro' && !userIsPro) return { ...acc, [m.id]: false };
                                    return { ...acc, [m.id]: !allOn };
                                }, {});
                                setEnabledModels(next);
                            }}
                            disabled={anyLoading}
                            style={{
                                background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer',
                                fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px',
                            }}
                        >
                            {EXTRACT_MODEL_DEFS.filter(m => m.tier !== 'pro' || userIsPro).every(m => enabledModels[m.id]) ? 'Deselect All' : 'Select All'}
                            <I d="M5 13l4 4L19 7" s={14} />
                        </button>
                    </div>
                    <div className="st-pattern-model-grid">
                        {EXTRACT_MODEL_DEFS.map(m => {
                            const on = enabledModels[m.id];
                            const locked = m.tier === 'pro' && !userIsPro;
                            const descriptions = {
                                'xai/grok-imagine-image': { desc: 'Fast and creative with strong pattern interpretation.', tag: 'Fast', tagColor: '#1d9bf0' },
                                'bytedance/seedream-4.5': { desc: 'Strong with texture preservation and soft details.', tag: 'Pro', tagColor: '#f59e0b' },
                                'black-forest-labs/flux-schnell': { desc: 'Ultra fast and budget-friendly generation.', tag: 'Budget', tagColor: '#a855f7' },
                                'google/imagen-4-fast': { desc: 'Quick Google extract drafts (caption-assisted).', tag: 'Fast', tagColor: '#34a853' },
                                'google/nano-banana': { desc: 'Balanced quality and cost efficiency.', tag: 'Balanced', tagColor: '#34a853' },
                                'google/nano-banana-2': { desc: 'Enhanced quality with strong pattern extraction.', tag: 'Pro', tagColor: '#4285f4' },
                                'black-forest-labs/flux-2-pro': { desc: 'High-fidelity Flux 2 extract with reference image.', tag: 'Pro', tagColor: '#7c3aed' },
                                'openai/gpt-image-2': { desc: 'Top prompt adherence — quality=high ($0.128).', tag: 'Pro', tagColor: '#111827' },
                                'google/imagen-4-ultra': { desc: 'Highest Imagen quality for polished tiles.', tag: 'Pro', tagColor: '#0f9d58' },
                            };
                            const info = descriptions[m.id] || { desc: '', tag: m.tier === 'pro' ? 'Pro' : '', tagColor: '#888' };
                            const cost = modelCreditCost(m);
                            return (
                                <div
                                    key={m.id}
                                    className={`st-pattern-model-select-card ${on && !locked ? 'selected' : ''}`}
                                    onClick={() => {
                                        if (anyLoading) return;
                                        if (locked) {
                                            setProGateModel(m.name);
                                            return;
                                        }
                                        setEnabledModels(prev => ({ ...prev, [m.id]: !prev[m.id] }));
                                    }}
                                    style={{
                                        '--model-accent': m.accent,
                                        cursor: anyLoading ? 'not-allowed' : 'pointer',
                                        opacity: anyLoading || locked ? 0.55 : 1,
                                    }}
                                >
                                    <div className={`st-pattern-model-check ${on && !locked ? 'on' : ''}`}>
                                        {on && !locked && <I d="M5 13l4 4L19 7" s={12} />}
                                    </div>
                                    <span className={`st-model-brand st-pattern-model-brand ${m.brand}`}>{m.logo}</span>
                                    <div className="st-pattern-model-name">{m.name}{m.tier === 'pro' ? ' · Pro' : ''}</div>
                                    <div className="st-pattern-model-desc">{info.desc}</div>
                                    <div className="st-pattern-model-meta">
                                        <span
                                            className="st-pattern-model-credit st-credit-coin"
                                            title={`${cost} credits`}
                                            aria-label={`${cost} credits`}
                                        >
                                            <svg
                                                className="st-credit-coin-icon"
                                                viewBox="0 0 16 16"
                                                width="14"
                                                height="14"
                                                aria-hidden="true"
                                                focusable="false"
                                            >
                                                <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18" />
                                                <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.35" />
                                                <circle cx="8" cy="8" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
                                                <circle cx="8" cy="8" r="1.65" fill="currentColor" />
                                            </svg>
                                            <span className="st-credit-coin-value">{cost}</span>
                                            <span className="st-credit-coin-unit">cr</span>
                                        </span>
                                        {info.tag ? (
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
                                        ) : null}
                                    </div>
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
                disabled={anyLoading || isUploading || !preview || activeModelCount === 0 || !hasEnoughExtractCredits}
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
                                            <MediaImg src={model.url} alt={model.name} token={currentToken} />
                                            <div className="st-extract-overlay">
                                                <I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={18} />
                                                <I d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" s={18} />
                                                View & Edit
                                            </div>
                                        </>
                                    ) : model.loading ? (
                                        <ModelLoadingBar
                                            active
                                            modelId={model.id}
                                            label={`${model.name}…`}
                                            accent={model.accent}
                                            compact
                                        />
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
                        <button className="st-quick-action-btn" onClick={() => { if (completedResults[0]) openFileInTool({ url: completedResults[0].url }, 'seamless', handoffSetters); }}>
                            <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" s={14} /> Send to Seamless
                        </button>
                        {completedResults[0] && (
                            <OpenInQwenButton
                                sourceUrl={completedResults[0].url}
                                projectId={activeProject?.id}
                                userId={user?.id}
                                currentToken={currentToken}
                                setTool={setTool}
                                setQwenLaunch={setQwenLaunch}
                                setUploads={setUploads}
                                setError={setError}
                                className="st-quick-action-btn"
                            />
                        )}
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
                                        <button onClick={() => { openFileInTool({ url: galleryModel.url }, 'seamless', handoffSetters); setExtractGalleryOpen(false); }}>
                                            <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" s={14} /> Seamless
                                        </button>
                                        <button onClick={() => { openFileInTool({ url: galleryModel.url }, 'repeat', handoffSetters); setExtractGalleryOpen(false); }}>
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
                                <MediaImg src={galleryModel.url} alt={galleryModel.name} key={galleryModel.url} token={currentToken} />
                            ) : galleryModel.loading ? (
                                <ModelLoadingBar
                                    active
                                    modelId={galleryModel.id}
                                    label={`Generating with ${galleryModel.name}…`}
                                    accent={galleryModel.accent || galleryModel.color || '#6366f1'}
                                    tone="light"
                                />
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
                                                <MediaImg src={msg.imageUrl} alt="Edit result" token={currentToken} onClick={() => {
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
