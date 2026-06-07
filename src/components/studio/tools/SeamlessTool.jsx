import React, { useState, useEffect, useRef } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

export default function SeamlessTool({
    uploaded,
    preview,
    activeProject,
    user,
    setError,
    addBgTask,
    updateCreditsFromResponse,
    setUploads,
    tool,
    currentToken,
    state,
    creditPricing,
    seamlessUrl: parentSeamlessUrl,
    setSeamlessUrl: parentSetSeamlessUrl
}) {
    // Local state
    const [seamlessMode, setSeamlessMode] = useState('generate');
    const [seamlessPrompt, setSeamlessPrompt] = useState('');
    const [seamlessTiles, setSeamlessTiles] = useState([]);
    const [localSeamlessUrl, setLocalSeamlessUrl] = useState(null);
    const [isSeamless, setIsSeamless] = useState(false);
    const [seamlessProgress, setSeamlessProgress] = useState(0);
    const [seamlessStatus, setSeamlessStatus] = useState('');
    const [isDrag, setIsDrag] = useState(false);

    const fileRef = useRef(null);

    const seamlessUrl = parentSeamlessUrl !== undefined ? parentSeamlessUrl : localSeamlessUrl;
    const setSeamlessUrl = parentSetSeamlessUrl !== undefined ? parentSetSeamlessUrl : setLocalSeamlessUrl;

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const seamlessCreditCost = creditPricing?.seamless || 80;
    const hasEnoughSeamlessCredits = userRemainingCredits >= seamlessCreditCost;

    // Progress simulation
    useEffect(() => {
        if (isSeamless) {
            setSeamlessProgress(0);
            setSeamlessStatus('Assessing seams...');
            const startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                let progress = 0, status = '';
                if (elapsed < 2) { progress = (elapsed / 2) * 5; status = 'Assessing seams...'; }
                else if (elapsed < 5) { progress = 5 + ((elapsed - 2) / 3) * 10; status = 'Applying geometric fixes...'; }
                else if (elapsed < 35) { progress = 15 + ((elapsed - 5) / 30) * 40; status = 'Generating AI patches (Tier 1)...'; }
                else if (elapsed < 65) { progress = 55 + ((elapsed - 35) / 30) * 35; status = 'Refining seams (Tier 2)...'; }
                else { progress = 90 + Math.min(9, (elapsed - 65) / 10); status = 'Finalizing guarantee step...'; }
                setSeamlessProgress(Math.min(99, progress));
                setSeamlessStatus(status);
            }, 200);
            return () => clearInterval(interval);
        } else {
            setSeamlessProgress(100);
            setSeamlessStatus('Complete!');
            const t = setTimeout(() => { setSeamlessProgress(0); setSeamlessStatus(''); }, 2000);
            return () => clearTimeout(t);
        }
    }, [isSeamless]);

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

    // Fix existing tile (offset + inpaint)
    const makeSeamless = async () => {
        const filename = uploaded?.filename;
        if (!filename && !activeProject?.heroImageUrl) return;
        setIsSeamless(true);
        setSeamlessUrl(null);
        setError('');
        const trigger = async () => {
            const res = await fetch(`${API}/api/make-seamless`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: filename || activeProject.heroImageUrl,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                setSeamlessUrl(d.resultUrl.startsWith('http') ? d.resultUrl : `${API}${d.resultUrl}`);
                updateCreditsFromResponse(d);
                setIsSeamless(false);
                return { url: d.resultUrl };
            } else {
                setIsSeamless(false);
                throw new Error(d.error || 'Seamless fix failed');
            }
        };
        addBgTask('seamless', 'Make Seamless', filename || 'hero_image', trigger);
    };

    // Generate new seamless tile from text
    const generateSeamless = async () => {
        if (!seamlessPrompt.trim()) return;
        setIsSeamless(true);
        setSeamlessTiles([]);
        setSeamlessUrl(null);
        setError('');
        const trigger = async () => {
            const res = await fetch(`${API}/api/generate-seamless`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: seamlessPrompt,
                    referenceFilename: uploaded?.filename || null,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                const tiles = d.tiles || [];
                setSeamlessTiles(tiles);
                if (tiles.length > 0) {
                    setSeamlessUrl(`${API}${tiles[0].url}`);
                }
                updateCreditsFromResponse(d);
                setIsSeamless(false);
                return { url: tiles[0]?.url, urls: tiles.map(t => t.url) };
            } else {
                setIsSeamless(false);
                throw new Error(d.error || 'Generation failed');
            }
        };
        addBgTask('seamless', 'Generate Seamless Tiles', uploaded?.filename || 'text-prompt', trigger);
    };

    const loading = isSeamless;
    const pipelineStep = seamlessProgress < 15 ? 1 : seamlessProgress < 55 ? 2 : seamlessProgress < 90 ? 3 : 4;
    const pipelineStages = [
        { label: 'Upload', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12' },
        { label: 'AI Generate', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z' },
        { label: 'Score', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
        { label: 'Complete', icon: 'M5 13l4 4L19 7' }
    ];
    const promptChips = ['watercolor roses on cream', 'geometric aztec tribal', 'tropical palm leaves', 'ditsy floral vintage', 'abstract marble texture'];
    const bestTileIndex = seamlessTiles.length > 0 ? seamlessTiles.reduce((best, tile, idx) => tile.score > seamlessTiles[best].score ? idx : best, 0) : -1;

    return (
        <div className="st-pattern-layout" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem', padding: '2rem' }}>
            {/* Spring-Physics Segmented Control */}
            <div className="st-segmented-control">
                <div className="st-segment-highlight" style={{ left: seamlessMode === 'generate' ? '4px' : '50%', width: 'calc(50% - 4px)' }} />
                <button className={`st-segment-btn ${seamlessMode === 'generate' ? 'active' : ''}`} onClick={() => setSeamlessMode('generate')}>
                    <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={16} />
                    Generate New
                </button>
                <button className={`st-segment-btn ${seamlessMode === 'fix' ? 'active' : ''}`} onClick={() => setSeamlessMode('fix')}>
                    <I d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" s={16} />
                    Fix Existing
                </button>
            </div>

            {seamlessMode === 'generate' ? (
                /* ═══════ GENERATE NEW WORKSPACE ═══════ */
                <div style={{ width: '100%', maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* Prompt Container */}
                    <div className="st-prompt-container">
                        <div className="st-prompt-label">
                            <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={14} />
                            Describe your pattern
                        </div>
                        <textarea
                            className="st-prompt-textarea"
                            value={seamlessPrompt}
                            onChange={e => setSeamlessPrompt(e.target.value)}
                            placeholder="e.g. 'watercolor roses on cream linen background with soft petals'"
                            maxLength={500}
                        />
                        <div className="st-prompt-charcount">{seamlessPrompt.length} / 500</div>
                        {/* Suggestion Chips */}
                        <div className="st-prompt-chips">
                            {promptChips.map((chip, idx) => (
                                <button key={idx} className="st-prompt-chip" onClick={() => setSeamlessPrompt(chip)}>{chip}</button>
                            ))}
                        </div>
                        {/* Reference image indicator */}
                        {uploaded?.filename && (
                            <div className="st-prompt-ref">
                                <I d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" s={14} />
                                Reference: {uploaded.filename} will guide the style
                            </div>
                        )}
                    </div>

                    {/* Action Area */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        {loading || seamlessProgress > 0 ? (
                            /* Pipeline Progress Visualization */
                            <div className="st-pipeline-progress">
                                <div className="st-pipeline-stages">
                                    {pipelineStages.map((stage, idx) => {
                                        const stepNum = idx + 1;
                                        const isActive = stepNum === pipelineStep;
                                        const isCompleted = stepNum < pipelineStep;
                                        return (
                                            <React.Fragment key={idx}>
                                                <div className={`st-pipeline-stage ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}>
                                                    <div className="st-pipeline-icon">
                                                        <I d={stage.icon} s={14} />
                                                    </div>
                                                    <span className="st-pipeline-label">{stage.label}</span>
                                                </div>
                                                {idx < pipelineStages.length - 1 && (
                                                    <div className={`st-pipeline-connector ${isCompleted ? 'completed' : ''}`} />
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                                <div className="st-pipeline-pct">{Math.round(seamlessProgress)}%</div>
                                <div className="st-pipeline-status">{seamlessStatus}</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                                <button
                                    className={`st-extract-btn-creative ${!hasEnoughSeamlessCredits ? 'insufficient-credits' : ''}`}
                                    onClick={generateSeamless}
                                    disabled={!seamlessPrompt.trim() || !hasEnoughSeamlessCredits}
                                    title={!hasEnoughSeamlessCredits ? `Need ${seamlessCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Generate seamless tiles'}
                                >
                                    <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={18} />
                                    {hasEnoughSeamlessCredits ? 'Generate Seamless Tiles' : `Need ${seamlessCreditCost} credits`}
                                </button>
                                <span className="st-credit-badge">
                                    <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1" s={12} />
                                    {seamlessCreditCost} credits
                                </span>
                                {!hasEnoughSeamlessCredits && (
                                    <div className="st-credit-shortage">
                                        {userRemainingCredits.toLocaleString()} credits remaining. Recharge to generate seamless tiles.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Generated Results */}
                    {seamlessTiles.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                            {seamlessTiles.map((tile, i) => {
                                const tileUrl = `${API}${tile.url}`;
                                const isSelected = seamlessUrl === tileUrl;
                                const isBest = i === bestTileIndex;
                                const scoreClass = tile.score >= 0.9 ? 'excellent' : tile.score >= 0.75 ? 'good' : 'poor';
                                return (
                                    <div
                                        key={i}
                                        className={`st-tile-result-card ${isSelected ? 'selected' : ''}`}
                                        onClick={() => { setSeamlessUrl(tileUrl); setUploads(prev => ({ ...prev, [tool]: { ...prev[tool], url: tileUrl } })); }}
                                    >
                                        <img src={tileUrl} alt={`Tile ${i + 1}`} />
                                        <div className={`st-score-badge ${scoreClass}`}>
                                            {Math.round(tile.score * 100)}%
                                        </div>
                                        {isBest && <div className="st-best-pick">AI Pick</div>}
                                        <div className="st-tile-result-overlay">
                                            <a href={tileUrl} onClick={(e) => { e.stopPropagation(); forceDownload(e, tileUrl); }}>
                                                <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={16} />
                                            </a>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            ) : (
                /* ═══════ FIX EXISTING WORKSPACE ═══════ */
                <>
                    {!preview ? (
                        /* Creative Dropzone */
                        <div
                            className={`st-dropzone-creative ${isDrag ? 'dragging' : ''}`}
                            onClick={() => fileRef.current?.click()}
                            onDrop={(e) => { e.preventDefault(); setIsDrag(false); handlePreUpload(e.dataTransfer.files[0]); }}
                            onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                            onDragLeave={() => setIsDrag(false)}
                        >
                            <div className="st-particles">
                                <div className="st-particle" />
                                <div className="st-particle" />
                                <div className="st-particle" />
                                <div className="st-particle" />
                                <div className="st-particle" />
                                <div className="st-particle" />
                            </div>
                            <div className="st-dropzone-icon-wrap">
                                <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={36} />
                            </div>
                            <h2 className="st-dropzone-title">Upload a pattern tile to fix</h2>
                            <p className="st-dropzone-desc">AI will analyze and fix edge seams using offset & inpaint</p>
                            <div className="st-dropzone-badges">
                                <span className="st-dropzone-badge">PNG</span>
                                <span className="st-dropzone-badge">JPG</span>
                                <span className="st-dropzone-badge">TIFF</span>
                            </div>
                        </div>
                    ) : (
                        /* Comparison Workspace */
                        <div className="st-comparison-workspace">
                            {/* Original Input Card */}
                            <div className="st-comparison-card">
                                <div className="st-comparison-card-head">
                                    <span>Original Input</span>
                                    <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>Replace</button>
                                </div>
                                <div className="st-comparison-card-body">
                                    <img src={preview} alt="Original" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                </div>
                            </div>

                            {/* Action Bridge */}
                            <div className="st-comparison-action-bridge">
                                <button
                                    className={`st-extract-btn-creative ${!hasEnoughSeamlessCredits ? 'insufficient-credits' : ''}`}
                                    onClick={makeSeamless}
                                    disabled={loading || (!uploaded && !preview && !activeProject?.heroImageUrl) || !hasEnoughSeamlessCredits}
                                    title={!hasEnoughSeamlessCredits ? `Need ${seamlessCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Fix uploaded tile'}
                                >
                                    <I d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" s={18} />
                                    {loading ? 'Fixing...' : hasEnoughSeamlessCredits ? 'Fix Uploaded Tile' : `Need ${seamlessCreditCost} credits`}
                                </button>
                                <span className="st-credit-badge">
                                    <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1" s={12} />
                                    {seamlessCreditCost} credits
                                </span>
                            </div>

                            {/* Seamless Result Card */}
                            <div className="st-comparison-card">
                                <div className="st-comparison-card-head">
                                    <span>Seamless Result</span>
                                    {seamlessUrl && (
                                        <button onClick={(e) => forceDownload(e, seamlessUrl)} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                            <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /> Download
                                        </button>
                                    )}
                                </div>
                                <div className="st-comparison-card-body">
                                    {seamlessUrl ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', alignItems: 'center' }}>
                                            <img className="st-result-reveal" src={seamlessUrl.startsWith('/') ? `${API}${seamlessUrl}` : seamlessUrl} alt="Seamless Result" style={{ maxWidth: '100%', maxHeight: '280px', objectFit: 'contain', borderRadius: '8px' }} />
                                            <div className="st-tile-preview-2x2">
                                                <img src={seamlessUrl.startsWith('/') ? `${API}${seamlessUrl}` : seamlessUrl} alt="Tile 1" />
                                                <img src={seamlessUrl.startsWith('/') ? `${API}${seamlessUrl}` : seamlessUrl} alt="Tile 2" />
                                                <img src={seamlessUrl.startsWith('/') ? `${API}${seamlessUrl}` : seamlessUrl} alt="Tile 3" />
                                                <img src={seamlessUrl.startsWith('/') ? `${API}${seamlessUrl}` : seamlessUrl} alt="Tile 4" />
                                            </div>
                                            <a href={seamlessUrl} onClick={(e) => forceDownload(e, seamlessUrl)} className="st-extract-btn-creative" style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}>
                                                <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={14} />
                                                Download Tile
                                            </a>
                                        </div>
                                    ) : loading ? (
                                        <div className="st-ai-processing">
                                            <div className="st-ai-sparkle-container">
                                                <div className="st-ai-sparkle-icon">
                                                    <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={24} />
                                                </div>
                                                <div className="st-ai-ring" />
                                                <div className="st-ai-ring" />
                                                <div className="st-ai-ring" />
                                            </div>
                                            <div className="st-ai-phase-text">{seamlessStatus || 'AI is fixing seams...'}</div>
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', color: '#9ca3af', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '2rem 0' }}>
                                            <I d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" s={48} />
                                            <p>Seamless pattern will appear here.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
            <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={(e) => handlePreUpload(e.target.files[0])} />
        </div>
    );
}
