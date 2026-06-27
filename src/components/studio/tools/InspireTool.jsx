import React, { useState } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload, jsonAuthHeaders } from '../shared/helpers';
import { useImageDropzone } from '../shared/useImageDropzone';

export default function InspireTool({
    uploaded,
    preview,
    activeProject,
    user,
    setError,
    updateCreditsFromResponse,
    setUploads,
    tool,
    currentToken,
    creditPricing,
    handlePreUpload,
    onUploadInvalid,
    onUploadPaste,
}) {
    // State variables
    const [prompt, setPrompt] = useState('');
    const [creativity, setCreativity] = useState(3);
    const [variants, setVariants] = useState(4);
    const [inspireColors, setInspireColors] = useState(['#94b09e', '#e7dec2', '#dca5a2']);
    const [inspireStyle, setInspireStyle] = useState('All Styles');
    const [inspireModels, setInspireModels] = useState(['google/nano-banana']);
    const [inspireAspect, setInspireAspect] = useState('1:1');
    const [inspireResolution, setInspireResolution] = useState('1024');
    const [inspireProgress, setInspireProgress] = useState(0);
    const [generatedVariations, setGeneratedVariations] = useState([]);
    const [isDesc, setIsDesc] = useState(false);
    const [isGen, setIsGen] = useState(false);
    const [analysis, setAnalysis] = useState(null);
    const [showModelModal, setShowModelModal] = useState(false);

    const { rootProps, pasteProps, inputProps, isDrag } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

    // Per-model credit costs.  IDs MUST match MODEL_TO_CREDITS keys in
    // backend/routes/generation.py and Replicate's actual model slugs.
    // Pricing rule (Option A, 4 credits per INR 1, ~57% gross margin):
    //   credits = ceil(cost_usd * 1150)
    const allAvailableModels = [

        { id: 'google/imagen-4-fast', name: 'Imagen 4 Fast', sub: 'Google', brand: 'google', logo: 'I4', credits: 23, icon: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z' },


        { id: 'xai/grok-imagine-image', name: 'Grok Imagine', sub: 'xAI', brand: 'xai', logo: 'GR', credits: 23, icon: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z' },
        { id: 'bytedance/seedream-4.5', name: 'Seedream 4.5', sub: 'ByteDance', brand: 'bytedance', logo: 'SD', credits: 46, icon: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z' },
        { id: 'google/nano-banana-2', name: 'Nano Banana 2', sub: 'Google', brand: 'google', logo: 'N2', credits: 78, icon: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z' },

        { id: 'black-forest-labs/flux-schnell', name: 'Flux Schnell', sub: 'Black Forest', brand: 'bfl', logo: 'FS', credits: 4, icon: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z' },
        { id: 'google/nano-banana', name: 'Nano Banana', sub: 'Google', brand: 'google', logo: 'NB', credits: 45, icon: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z' },
    ];

    const promptChips = ['Botanical repeat', 'Hand-painted floral', 'Art deco geometric', 'Soft watercolor', 'Vintage textile', 'Tropical foliage'];

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    // Sum per-model credits for every selected model and multiply by variants
    // so cost reflects the true mix.  Cheap models (Flux Schnell = 4) cost far
    // less than premium ones (Nano Banana Pro = 173).
    const creditsPerVariant = inspireModels.reduce((sum, modelId) => {
        const cfg = allAvailableModels.find(m => m.id === modelId);
        return sum + (cfg?.credits || creditPricing?.inspire || 148);
    }, 0) || (creditPricing?.inspire || 148);
    const inspireCreditCost = variants * creditsPerVariant;
    const hasEnoughInspireCredits = userRemainingCredits >= inspireCreditCost;

    // Auto Describe Reference Image
    const descImg = async () => {
        if (!uploaded?.filename) return;
        setIsDesc(true);
        setError('');
        try {
            const r = await fetch(`${API}/api/describe-image`, {
                method: 'POST',
                headers: jsonAuthHeaders(currentToken),
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
            setError('Backend is not reachable.');
        } finally {
            setIsDesc(false);
        }
    };

    // Parallel multi-model generation loop
    const generate = async () => {
        if (!prompt.trim()) {
            setError('Enter a prompt');
            return;
        }
        if (!hasEnoughInspireCredits) {
            setError(`Insufficient credits. Inspiration generation needs ${inspireCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
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

            setGeneratedVariations([]);
            setInspireProgress(0);

            let completedModels = 0;
            const totalModels = inspireModels.length;

            const fetchPromises = inspireModels.map(async (modelId) => {
                try {
                    const r = await fetch(`${API}/api/generate-inspirations`, {
                        method: 'POST',
                        headers: jsonAuthHeaders(currentToken),
                        body: JSON.stringify({
                            prompt: finalPrompt,
                            creativity,
                            count: variants,
                            models: [modelId],
                            aspect_ratio: inspireAspect,
                            resolution: inspireResolution,
                            projectId: activeProject.id,
                            filename: safeFilename,
                            imageUrl: safeUrl,
                            userId: user?.id
                        })
                    });
                    const d = await r.json();
                    if (d.success) {
                        setGeneratedVariations(prev => [...prev, ...d.variations]);
                        updateCreditsFromResponse(d);
                    } else if (d.error && completedModels === 0) {
                        setError(d.error);
                    }
                } catch (e) {
                    console.error(`Error with model ${modelId}:`, e);
                } finally {
                    completedModels++;
                    setInspireProgress(Math.round((completedModels / totalModels) * 100));
                }
            });

            await Promise.all(fetchPromises);
        } catch {
            setError('Backend is not reachable.');
        } finally {
            setIsGen(false);
        }
    };

    return (
        <div {...pasteProps} className="st-inspire-main st-inspire-studio">
            {/* Modal for AI Preferences */}
            {showModelModal && (
                <div className="st-model-modal-overlay" onClick={() => setShowModelModal(false)}>
                    <div className="st-model-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="st-model-header">
                            <div>
                                <h2>AI model preferences</h2>
                                <p>Manage and reorder your AI models and settings</p>
                            </div>
                            <button className="st-model-close" onClick={() => setShowModelModal(false)}>
                                <I d="M6 18L18 6M6 6l12 12" s={20} />
                            </button>
                        </div>

                        <div className="st-model-list">
                            {allAvailableModels.map(m => {
                                const isActive = inspireModels.includes(m.id);
                                return (
                                    <div key={m.id} className="st-model-row" style={{ opacity: isActive ? 1 : 0.6 }}>
                                        <div className="st-model-row-left">
                                            <div className="st-model-drag">
                                                <I d="M8 6h2v2H8V6zm0 5h2v2H8v-2zm0 5h2v2H8v-2zm4-10h2v2h-2V6zm0 5h2v2h-2v-2zm0 5h2v2h-2v-2z" s={16} />
                                            </div>
                                            <div className="st-model-name">
                                                <I d={m.icon} s={16} /> {m.name}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <div className="st-model-dropdown">
                                                {m.sub} <I d="M6 9l6 6 6-6" s={12} style={{ marginLeft: '4px' }} />
                                            </div>
                                            <div className={`st-toggle ${isActive ? 'active' : ''}`} onClick={() => {
                                                if (isActive) {
                                                    if (inspireModels.length > 1) setInspireModels(inspireModels.filter(id => id !== m.id));
                                                } else {
                                                    setInspireModels([...inspireModels, m.id]);
                                                }
                                            }}>
                                                <div className="st-toggle-knob" />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.05)', background: '#171717' }}>
                            <div className="st-modal-group" style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                                <div className="st-modal-label">Aspect Ratio</div>
                                <select className="st-modal-dark-select" value={inspireAspect} onChange={e => setInspireAspect(e.target.value)}>
                                    <option value="1:1">1:1 Square</option>
                                    <option value="4:3">4:3 Standard</option>
                                    <option value="16:9">16:9 Widescreen</option>
                                    <option value="9:16">9:16 Mobile</option>
                                </select>
                            </div>
                            <div className="st-modal-group" style={{ flex: 1 }}>
                                <div className="st-modal-label">Resolution</div>
                                <select className="st-modal-dark-select" value={inspireResolution} onChange={e => setInspireResolution(e.target.value)}>
                                    <option value="512">512px Draft</option>
                                    <option value="1024">1K Standard</option>
                                    <option value="1536">1.5K High</option>
                                    <option value="2048">2K Ultra</option>
                                </select>
                            </div>
                        </div>
                        <div className="st-modal-group" style={{ background: '#171717' }}>
                            <div className="st-modal-label">Creativity Level</div>
                            <div style={{ display: 'flex', background: '#262626', padding: '0.35rem', borderRadius: '10px', position: 'relative' }}>
                                {['Conservative', 'Balanced', 'Creative', 'Bold', 'Wild'].map((lvl, idx) => (
                                    <div key={lvl} className={`st-creativity-pill-dark ${creativity === idx + 1 ? 'active' : ''}`} onClick={() => setCreativity(idx + 1)}>
                                        {lvl}
                                        {creativity === idx + 1 && <div className="st-creativity-highlight-dark" />}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="st-model-footer">
                            <button className="st-model-btn-sec" onClick={() => setShowModelModal(false)}>Apply for this chat</button>
                            <button className="st-model-btn-pri" onClick={() => setShowModelModal(false)}>Save as default</button>
                        </div>
                    </div>
                </div>
            )}

            <section className="st-inspire-board">
                <div className="st-inspire-main-column">
                    <div className="st-inspire-topbar">
                        <div className="st-inspire-model-box st-inspire-model-top">
                            <div className="st-inspire-model-box-head">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span>AI Generation Models</span>
                                    <button
                                        onClick={() => setShowModelModal(true)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#94a3b8' }}
                                        title="Configure preferences"
                                    >
                                        <I d="M12.2 2h-.4a2 2 0 00-2 2v.2a2 2 0 01-1 1.7l-.4.2a2 2 0 01-2 0l-.2-.1a2 2 0 00-2.7.7l-.2.4a2 2 0 00.7 2.7l.2.1a2 2 0 011 1.7v.5a2 2 0 01-1 1.8l-.2.1a2 2 0 00-.7 2.7l.2.4a2 2 0 002.7.7l.2-.1a2 2 0 012 0l.4.2a2 2 0 011 1.7v.2a2 2 0 002 2h.4a2 2 0 002-2v-.2a2 2 0 011-1.7l.4-.2a2 2 0 012 0l.2.1a2 2 0 002.7-.7l.2-.4a2 2 0 00-.7-2.7l-.2-.1a2 2 0 01-1-1.8v-.5a2 2 0 011-1.7l.2-.1a2 2 0 00.7-2.7l-.2-.4a2 2 0 00-2.7-.7l-.2.1a2 2 0 01-2 0l-.4-.2a2 2 0 01-1-1.7V4a2 2 0 00-2-2z" s={14} />
                                    </button>
                                </div>
                                <strong>{inspireModels.length} enabled</strong>
                            </div>
                            <div className="st-inspire-model-top-grid">
                                {allAvailableModels.map((m) => {
                                    const active = inspireModels.includes(m.id);
                                    return (
                                        <button key={m.id} className="st-inspire-model-row" onClick={() => {
                                            if (active) {
                                                if (inspireModels.length > 1) setInspireModels(inspireModels.filter(id => id !== m.id));
                                            } else {
                                                setInspireModels([...inspireModels, m.id]);
                                            }
                                        }}>
                                            <span className={`st-model-brand ${m.brand}`}>{m.logo}</span>
                                            <strong>{m.name}</strong>
                                            <small>{m.sub}</small>
                                            <i className={active ? 'active' : ''} />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="st-inspire-compose-row">
                        <div
                            className={`st-inspire-upload-zone ${preview ? 'has-image' : ''} ${isDrag ? 'dragging' : ''}`}
                            {...rootProps}
                        >
                            <span><I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={18} /></span>
                            <strong>{preview ? 'Replace Reference Image' : 'Upload Reference Image'}</strong>
                            <small>Drag, paste, or click — JPG, PNG, or WebP</small>
                        </div>
                        <div className={`st-inspire-photo-preview ${preview ? 'has-image' : ''}`}>
                            {preview ? (
                                <img src={preview} alt="Uploaded reference preview" />
                            ) : (
                                <div>
                                    <I d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM8 14l2.5-2.5L13 14l2-2 3 3M8.5 8.5h.01" s={24} />
                                    <strong>Uploaded photo preview</strong>
                                    <span>Your reference image will appear here.</span>
                                </div>
                            )}
                        </div>
                        <div className="st-inspire-prompt-card">
                            <label className="st-inspire-field-label" htmlFor="inspire-prompt">Prompt</label>
                            <textarea
                                id="inspire-prompt"
                                className="st-inspire-prompt-area"
                                placeholder="A delicate floral pattern unfolds in muted hues of pale yellow, sage green, and dusty blue on a creamy white background. Curved stems with intricate swirls and leaves."
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        generate();
                                    }
                                }}
                                rows={3}
                            />
                            <div className="st-inspire-prompt-footer">
                                <div className="st-inspire-model-pills">
                                    {inspireModels.slice(0, 2).map((mId) => {
                                        const cfg = allAvailableModels.find(m => m.id === mId) || allAvailableModels[0];
                                        return <span key={mId}><i className={`st-model-brand ${cfg.brand}`}>{cfg.logo}</i> {cfg.name}</span>;
                                    })}
                                    {inspireModels.length > 2 && <span>+{inspireModels.length - 2}</span>}
                                </div>
                                <div className="st-inspire-action-row">
                                    <button className="st-inspire-soft-btn" onClick={descImg} disabled={isDesc || !uploaded}>
                                        <I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={13} />
                                        {isDesc ? 'Analyzing' : 'Auto-Describe'}
                                    </button>
                                    <button
                                        className={`st-inspire-primary-btn ${!hasEnoughInspireCredits ? 'insufficient-credits' : ''}`}
                                        onClick={generate}
                                        disabled={isGen || !prompt.trim() || !hasEnoughInspireCredits}
                                        title={!hasEnoughInspireCredits ? `Need ${inspireCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Generate inspirations'}
                                    >
                                        <I d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" s={14} />
                                        {isGen ? 'Generating' : hasEnoughInspireCredits ? 'Generate' : `Need ${inspireCreditCost} credits`}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="st-inspire-results-header">
                        <div>
                            <h3>Generated Variations</h3>
                            <p>{generatedVariations.length ? `${generatedVariations.length} variations from ${inspireModels.length} model${inspireModels.length > 1 ? 's' : ''}` : 'Generated pattern variations will appear here.'}</p>
                        </div>
                        <div className="st-inspire-results-actions">
                            <button className="active" title="Grid view"><I d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" s={14} /></button>
                            <button title="List view"><I d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" s={14} /></button>
                            {generatedVariations.length > 0 && (
                                <button className="download" onClick={async (e) => {
                                    e.preventDefault();
                                    for (let i = 0; i < generatedVariations.length; i++) {
                                        await forceDownload(e, generatedVariations[i]);
                                        await new Promise(r => setTimeout(r, 400));
                                    }
                                }}>
                                    <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} />
                                    Download All
                                </button>
                            )}
                        </div>
                    </div>

                    {isGen && generatedVariations.length === 0 ? (
                        <div className="st-inspire-loading">
                            <div className="st-spinner" />
                            <strong>Generating {variants * inspireModels.length} variations</strong>
                            <span>Using {inspireModels.length} active model{inspireModels.length > 1 ? 's' : ''} in parallel.</span>
                        </div>
                    ) : generatedVariations.length > 0 ? (
                        <div className="st-inspire-results-stack">
                            {isGen && (
                                <div className="st-inspire-progress">
                                    <div><span style={{ width: `${inspireProgress}%` }} /></div>
                                    <strong>{inspireProgress}%</strong>
                                </div>
                            )}
                            <div className="st-inspire-var-grid">
                                {generatedVariations.map((u, i) => (
                                    <div key={u + i} className={`st-inspire-var-item ${i === 0 ? 'active' : ''}`}>
                                        {i === 0 && <div className="st-inspire-selected-mark"><I d="M20 6L9 17l-5-5" s={13} /></div>}
                                        <img src={u.startsWith('/') ? `${API}${u}` : u} alt={`Variation ${i + 1}`} />
                                        <div className="st-inspire-var-actions">
                                            <button className="st-inspire-var-btn" title="Favorite"><I d="M20.8 4.6a5.5 5.5 0 0 0-7.7 0l-1.1 1-1.1-1a5.5 5.5 0 0 0-7.8 7.8l1 1 7.9 7.9 7.9-7.9 1-1a5.5 5.5 0 0 0 0-7.8z" s={14} /></button>
                                            <button className="st-inspire-var-btn" onClick={(e) => forceDownload(e, u)} title="Download"><I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /></button>
                                            <button className="st-inspire-var-btn" title="Use as base" onClick={() => { setUploads(prev => ({ ...prev, [tool]: { url: u.startsWith('/') ? `${API}${u}` : u, file: { filename: u.split('/').pop() } } })); }}><I d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" s={14} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="st-inspire-empty-state">
                            <div><I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={28} /></div>
                            <strong>Ready to create</strong>
                            <span>Write a prompt, upload a reference image, then generate pattern variations.</span>
                        </div>
                    )}
                </div>

                <aside className="st-inspire-refine-panel">
                    <div className="st-inspire-refine-title">Refine Your Results</div>

                    <div className="st-inspire-control-group">
                        <label>Creativity <I d="M12 17h.01M12 13a4 4 0 10-4-4" s={12} /></label>
                        <div className="st-inspire-named-segments">
                            {['Conservative', 'Balanced', 'Creative', 'Bold'].map((name, idx) => (
                                <button key={name} className={creativity === idx + 1 ? 'active' : ''} onClick={() => setCreativity(idx + 1)}>{name}</button>
                            ))}
                        </div>
                    </div>

                    <div className="st-inspire-control-group">
                        <label>Variants</label>
                        <div className="st-inspire-number-grid">
                            {[1, 2, 4, 6, 8, 10, 12, 16, 20].map(n => (
                                <button key={n} className={variants === n ? 'active' : ''} onClick={() => setVariants(n)}>{n}</button>
                            ))}
                        </div>
                    </div>

                    <div className="st-inspire-control-group">
                        <label>Style</label>
                        <div className="st-inspire-chip-grid">
                            {['All Styles', 'Hand Painted', 'Minimal', 'Line Art', 'Vintage', 'Geometric'].map(style => (
                                <button key={style} className={inspireStyle === style || (style === 'All Styles' && inspireStyle === 'All Styles') ? 'active' : ''} onClick={() => setInspireStyle(style)}>{style}</button>
                            ))}
                        </div>
                    </div>

                    <div className="st-inspire-control-group">
                        <label>Aspect Ratio</label>
                        <select className="st-inspire-select" value={inspireAspect} onChange={e => setInspireAspect(e.target.value)}>
                            <option value="1:1">1:1 Square</option>
                            <option value="4:3">4:3 Standard</option>
                            <option value="16:9">16:9 Widescreen</option>
                            <option value="9:16">9:16 Mobile</option>
                        </select>
                    </div>

                    <div className="st-inspire-control-group">
                        <label>Resolution</label>
                        <select className="st-inspire-select" value={inspireResolution} onChange={e => setInspireResolution(e.target.value)}>
                            <option value="512">512px Draft</option>
                            <option value="1024">1K - Standard</option>
                            <option value="1536">1.5K High</option>
                            <option value="2048">2K Ultra</option>
                        </select>
                    </div>
                </aside>
            </section>
            <input {...inputProps} />
        </div>
    );
}
