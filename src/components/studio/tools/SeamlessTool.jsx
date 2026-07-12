import React, { useState, useEffect, useRef } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload, runAsyncJob, jsonAuthHeaders, cacheMediaFromResponse, mediaUrl } from '../shared/helpers';
import MediaImg from '../shared/MediaImg';
import ImageDropzone from '../shared/ImageDropzone';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import UploadImageFrame from '../shared/UploadImageFrame';
import { useImageDropzone } from '../shared/useImageDropzone';
import OpenInQwenButton from '../shared/OpenInQwenButton';
import ModelLoadingBar from '../shared/ModelLoadingBar';
import '../../../styles/tools/pattern.css';

export default function SeamlessTool({
    uploaded,
    preview,
    activeProject,
    user,
    setError,
    addBgTask,
    updateCreditsFromResponse,
    creditPricing,
    seamlessUrl: parentSeamlessUrl,
    setSeamlessUrl: parentSetSeamlessUrl,
    handlePreUpload,
    onUploadInvalid,
    onUploadPaste,
    currentToken,
    uploadStatus,
    isUploading,
    setTool,
    setQwenLaunch,
    setUploads,
    tool,
}) {
    // Local state
    const [seamlessMode, setSeamlessMode] = useState('generate');
    const [seamlessPrompt, setSeamlessPrompt] = useState('');
    const [seamlessTiles, setSeamlessTiles] = useState([]);
    const [localSeamlessUrl, setLocalSeamlessUrl] = useState(null);
    const [isSeamless, setIsSeamless] = useState(false);
    const [seamlessProgress, setSeamlessProgress] = useState(0);
    const [seamlessStatus, setSeamlessStatus] = useState('');
    const [seamlessModelId, setSeamlessModelId] = useState('black-forest-labs/flux-fill-pro');
    const hasActiveSeamlessRun = useRef(false);

    const { pasteProps, openFilePicker, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

    const seamlessUrl = parentSeamlessUrl !== undefined ? parentSeamlessUrl : localSeamlessUrl;
    const setSeamlessUrl = parentSetSeamlessUrl !== undefined ? parentSetSeamlessUrl : setLocalSeamlessUrl;

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const seamlessCreditCost = creditPricing?.seamless || 58;
    const hasEnoughSeamlessCredits = userRemainingCredits >= seamlessCreditCost;

    useEffect(() => {
        if (!isSeamless && hasActiveSeamlessRun.current) {
            hasActiveSeamlessRun.current = false;
            setSeamlessProgress(100);
            setSeamlessStatus('Complete!');
            const t = window.setTimeout(() => { setSeamlessProgress(0); setSeamlessStatus(''); }, 2000);
            return () => window.clearTimeout(t);
        }
        if (!isSeamless) {
            setSeamlessProgress(0);
            setSeamlessStatus('');
        }
        return undefined;
    }, [isSeamless]);

    // Fix existing tile (offset + inpaint)
    const makeSeamless = async () => {
        const filename = uploaded?.filename;
        if (!filename && !activeProject?.heroImageUrl) return;
        setIsSeamless(true);
        setSeamlessUrl(null);
        setError('');
        setSeamlessMode('fix');
        setSeamlessModelId('black-forest-labs/flux-fill-pro');
        const trigger = async (reportProgress) => {
            hasActiveSeamlessRun.current = true;
            const payload = {
                filename: filename || activeProject.heroImageUrl,
                projectId: activeProject.id,
                userId: user.id,
            };
            const result = await runAsyncJob('/api/make-seamless', payload, currentToken, {
                onProgress: (job) => {
                    setSeamlessProgress(job.progressPct || 0);
                    setSeamlessStatus(job.stage || 'Working…');
                    reportProgress?.(job.progressPct || 0, job.stage);
                },
            });
            cacheMediaFromResponse(result);
            const resultUrl = result.resultUrl?.startsWith('http') ? result.resultUrl : result.resultUrl;
            setSeamlessUrl(resultUrl);
            updateCreditsFromResponse(result);
            setIsSeamless(false);
            return { url: resultUrl };
        };
        addBgTask('seamless', 'Make Seamless', filename || 'hero_image', trigger, {
            modelId: 'black-forest-labs/flux-fill-pro',
        });
    };

    // Generate new seamless tile from text
    const generateSeamless = async () => {
        if (!seamlessPrompt.trim()) return;
        setIsSeamless(true);
        setSeamlessTiles([]);
        setSeamlessUrl(null);
        setError('');
        setSeamlessMode('generate');
        setSeamlessModelId('replicate/seamless-texture');
        setSeamlessProgress(1);
        setSeamlessStatus('Generating seamless texture…');
        const trigger = async (reportProgress) => {
            // Timed progress for sync endpoint (no job stream)
            const started = Date.now();
            const expectedMs = 31000;
            const tick = window.setInterval(() => {
                const elapsed = Date.now() - started;
                const pct = Math.min(97, (1 - Math.exp(-2.3 * (elapsed / expectedMs))) * 100);
                setSeamlessProgress(pct);
                setSeamlessStatus(pct < 90 ? 'Generating seamless texture…' : 'Scoring tiles…');
                reportProgress?.(pct, 'Generating…');
            }, 120);
            try {
                const res = await fetch(`${API}/api/generate-seamless`, {
                    method: 'POST',
                    headers: jsonAuthHeaders(currentToken),
                    body: JSON.stringify({
                        prompt: seamlessPrompt,
                        referenceFilename: uploaded?.filename || null,
                        projectId: activeProject.id,
                        userId: user.id,
                    }),
                });
                const d = await res.json();
                window.clearInterval(tick);
                if (d.success) {
                    const tiles = d.tiles || [];
                    setSeamlessTiles(tiles);
                    if (tiles.length > 0) {
                        setSeamlessUrl(tiles[0].url);
                    }
                    updateCreditsFromResponse(d);
                    setIsSeamless(false);
                    setSeamlessProgress(100);
                    return { url: tiles[0]?.url, urls: tiles.map(t => t.url) };
                } else {
                    setIsSeamless(false);
                    throw new Error(d.error || 'Generation failed');
                }
            } catch (err) {
                window.clearInterval(tick);
                setIsSeamless(false);
                throw err;
            }
        };
        addBgTask('seamless', 'Generate Seamless Tiles', uploaded?.filename || 'text-prompt', trigger, {
            modelId: 'replicate/seamless-texture',
        });
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
        <div {...pasteProps} className="st-pattern-layout" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem', padding: '2rem' }}>
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
                            <div className="st-pipeline-progress" style={{ flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: 420 }}>
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
                                <ModelLoadingBar
                                    active={loading || (seamlessProgress > 0 && seamlessProgress < 100)}
                                    modelId={seamlessModelId}
                                    label={seamlessStatus || 'Generating seamless tiles…'}
                                    serverProgress={seamlessProgress}
                                    accent="#8b5cf6"
                                />
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
                                const tileUrl = tile.url;
                                const isSelected = seamlessUrl === tileUrl || seamlessUrl === mediaUrl(tile.url);
                                const isBest = i === bestTileIndex;
                                const scoreClass = tile.score >= 0.9 ? 'excellent' : tile.score >= 0.75 ? 'good' : 'poor';
                                return (
                                    <div
                                        key={i}
                                        className={`st-tile-result-card ${isSelected ? 'selected' : ''}`}
                                        onClick={() => { setSeamlessUrl(tileUrl); setUploads(prev => ({ ...prev, [tool]: { ...prev[tool], url: tileUrl } })); }}
                                    >
                                        <MediaImg src={tileUrl} alt={`Tile ${i + 1}`} token={currentToken} />
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
                        <ImageDropzone
                            title="Upload a pattern tile to fix"
                            description="Drag & drop, paste, or click — AI will analyze and fix edge seams using offset & inpaint"
                            badges={['PNG', 'JPG', 'WEBP']}
                            uploadStatus={uploadStatus}
                            onFile={handlePreUpload}
                            onInvalidFile={onUploadInvalid}
                            onPasteSuccess={onUploadPaste}
                        />
                    ) : (
                        /* Comparison Workspace */
                        <div className="st-comparison-workspace">
                            {/* Original Input Card */}
                            <div className="st-comparison-card">
                                <div className="st-comparison-card-head">
                                    <span>Original Input</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <UploadStatusBadge status={uploadStatus} />
                                        <button type="button" onClick={openFilePicker} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>Replace</button>
                                    </div>
                                </div>
                                <div className="st-comparison-card-body">
                                    <UploadImageFrame status={uploadStatus}>
                                        <img src={preview} alt="Original" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                    </UploadImageFrame>
                                </div>
                            </div>

                            {/* Action Bridge */}
                            <div className="st-comparison-action-bridge">
                                <button
                                    className={`st-extract-btn-creative ${!hasEnoughSeamlessCredits ? 'insufficient-credits' : ''}`}
                                    onClick={makeSeamless}
                                    disabled={loading || isUploading || (!uploaded && !preview && !activeProject?.heroImageUrl) || !hasEnoughSeamlessCredits}
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
                                            <MediaImg className="st-result-reveal" src={seamlessUrl} alt="Seamless Result" token={currentToken} style={{ maxWidth: '100%', maxHeight: '280px', objectFit: 'contain', borderRadius: '8px' }} />
                                            <div className="st-tile-preview-2x2">
                                                <MediaImg src={seamlessUrl} alt="Tile 1" token={currentToken} />
                                                <MediaImg src={seamlessUrl} alt="Tile 2" token={currentToken} />
                                                <MediaImg src={seamlessUrl} alt="Tile 3" token={currentToken} />
                                                <MediaImg src={seamlessUrl} alt="Tile 4" token={currentToken} />
                                            </div>
                                            <a href={seamlessUrl} onClick={(e) => forceDownload(e, seamlessUrl)} className="st-extract-btn-creative" style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}>
                                                <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={14} />
                                                Download Tile
                                            </a>
                                            <OpenInQwenButton
                                                sourceUrl={seamlessUrl}
                                                projectId={activeProject?.id}
                                                userId={user?.id}
                                                currentToken={currentToken}
                                                setTool={setTool}
                                                setQwenLaunch={setQwenLaunch}
                                                setUploads={setUploads}
                                                setError={setError}
                                                className="st-extract-btn-creative"
                                                label="Open in Qwen Studio"
                                            />
                                        </div>
                                    ) : loading ? (
                                        <ModelLoadingBar
                                            active
                                            modelId={seamlessModelId}
                                            label={seamlessStatus || 'AI is fixing seams…'}
                                            serverProgress={seamlessProgress}
                                            accent="#6366f1"
                                        />
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
            <input {...inputProps} />
        </div>
    );
}
