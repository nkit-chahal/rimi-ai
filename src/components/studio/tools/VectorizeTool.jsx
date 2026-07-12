import React, { useState } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload, jsonAuthHeaders, cacheMediaFromResponse, mediaUrl } from '../shared/helpers';
import MediaImg from '../shared/MediaImg';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import UploadImageFrame from '../shared/UploadImageFrame';
import ImageDropzone from '../shared/ImageDropzone';
import { useImageDropzone } from '../shared/useImageDropzone';
import { createPortal } from 'react-dom';
import ModelLoadingBar from '../shared/ModelLoadingBar';

export default function VectorizeTool(props) {
    const {
        uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse,
        creditPricing, vecUrl, setVecUrl, upscaleUrl, setUpscaleUrl, tool, rightPanelEl,
        handlePreUpload, onUploadInvalid, onUploadPaste, currentToken, uploadStatus, isUploading,
    } = props;

    const [vecEngine, setVecEngine] = useState('api');
    const [vecColors, setVecColors] = useState(32);
    const [isVec, setIsVec] = useState(false);

    const [upscaleFactor, setUpscaleFactor] = useState('x4');
    const [isUpscaling, setIsUpscaling] = useState(false);

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const vectorizeCreditCost = vecEngine === 'api' ? (creditPricing.vectorize || 12) : (creditPricing.vectorizeLocal || 3);
    const hasEnoughVectorizeCredits = userRemainingCredits >= vectorizeCreditCost;
    const upscaleCreditCost = creditPricing.upscale || 23;
    const hasEnoughUpscaleCredits = userRemainingCredits >= upscaleCreditCost;
    const { pasteProps, openFilePicker, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

    const vectorize = async () => {
        const activeUrl = preview || activeProject.heroImageUrl;
        if (!uploaded && !activeUrl) {
            setError('Upload an image first');
            return;
        }
        if (!hasEnoughVectorizeCredits) {
            setError(`Insufficient credits. Vectorize needs ${vectorizeCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
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
                headers: jsonAuthHeaders(currentToken),
                body: JSON.stringify({ filename: safeFilename, imageUrl: safeUrl, engine: vecEngine, numColors: vecColors, projectId: activeProject.id, userId: user?.id })
            });
            const d = await r.json();
            cacheMediaFromResponse(d);
            if (d.success) {
                setVecUrl(d.resultUrl);
                setIsVec(false);
                updateCreditsFromResponse(d);
                return { url: d.resultUrl };
            } else {
                setIsVec(false);
                throw new Error(d.error || 'Vectorization failed');
            }
        };

        addBgTask('vectorize', 'Bezier Vectorization', safeFilename || 'vector.png', trigger, {
            modelId: vecEngine === 'api' ? 'recraft-ai/recraft-vectorize' : 'local',
            expectedMs: vecEngine === 'api' ? undefined : 5000,
        });
    };


    const upscale = async () => {
        if (!uploaded) {
            setError('Upload first');
            return;
        }
        if (!hasEnoughUpscaleCredits) {
            setError(`Insufficient credits. Super Resolution needs ${upscaleCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }
        setIsUpscaling(true);
        setError('');
        setUpscaleUrl(null);

        const trigger = async () => {
            const r = await fetch(`${API}/api/upscale`, {
                method: 'POST',
                headers: jsonAuthHeaders(currentToken),
                body: JSON.stringify({ filename: uploaded.filename, upscaleFactor, projectId: activeProject.id, userId: user?.id })
            });
            const d = await r.json();
            cacheMediaFromResponse(d);
            if (d.success) {
                setUpscaleUrl(d.resultUrl);
                setIsUpscaling(false);
                updateCreditsFromResponse(d);
                return { url: d.resultUrl };
            } else {
                setIsUpscaling(false);
                throw new Error(d.error || 'Upscaling failed');
            }
        };

        addBgTask('upscale', `Super Resolution (${upscaleFactor})`, uploaded.filename, trigger, {
            modelId: 'google/upscaler',
        });
    };



    const renderCanvasBlock = () => {
        const resultUrl = tool === 'vectorize' ? vecUrl : upscaleUrl;
        const loading = tool === 'vectorize' ? isVec : isUpscaling;
        const toolTitle = tool === 'vectorize' ? 'vectorize' : 'upscale';
        const toolLabel = tool === 'vectorize' ? 'Vectorize' : 'Upscale';
        const actionFunc = tool === 'vectorize' ? vectorize : upscale;
        const creditCost = tool === 'vectorize' ? vectorizeCreditCost : upscaleCreditCost;
        const hasEnoughToolCredits = tool === 'vectorize' ? hasEnoughVectorizeCredits : hasEnoughUpscaleCredits;

        if (!preview) {
            return (
                <div className="st-pattern-layout" style={{ display: 'flex', flex: 1, padding: '2rem' }}>
                    <ImageDropzone
                        title={`Upload artwork to ${toolTitle}`}
                        description="Drag & drop, paste, or click — AI will process your high-fidelity asset"
                        badges={['PNG', 'JPG', 'WEBP']}
                        icon={tool === 'vectorize'
                            ? <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={36} />
                            : <I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" s={36} />}
                        onFile={handlePreUpload}
                        onInvalidFile={onUploadInvalid}
                        onPasteSuccess={onUploadPaste}
                        uploadStatus={uploadStatus}
                    />
                </div>
            );
        }

        return (
            <div {...pasteProps} className="st-pattern-layout" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div className="st-comparison-workspace">
                    <div className="st-comparison-card">
                        <div className="st-comparison-card-head">
                            <span>Original Input</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <UploadStatusBadge status={uploadStatus} />
                                <button type="button" onClick={openFilePicker} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={14} />
                                Replace
                            </button>
                            </div>
                        </div>
                        <div className="st-comparison-card-body">
                            <UploadImageFrame status={uploadStatus}>
                                <img src={preview} alt="Original artwork" />
                            </UploadImageFrame>
                        </div>
                    </div>

                    <div className="st-comparison-action-bridge">
                        <button
                            className={`st-extract-btn-creative ${!hasEnoughToolCredits ? 'insufficient-credits' : ''}`}
                            onClick={actionFunc}
                            disabled={loading || isUploading || !preview || !hasEnoughToolCredits}
                            title={!hasEnoughToolCredits ? `Need ${creditCost} credits. You have ${userRemainingCredits} remaining.` : toolLabel}
                        >
                            <div className={loading ? 'spin-icon' : ''}>
                                <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={20} />
                            </div>
                            {loading ? 'Processing...' : hasEnoughToolCredits ? toolLabel : `Need ${creditCost} credits`}
                        </button>
                        <span className="st-credit-badge">
                            <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1" s={12} />
                            {creditCost} credits
                        </span>
                    </div>

                    <div className="st-comparison-card">
                        <div className="st-comparison-card-head">
                            <span>{tool === 'vectorize' ? 'Vector SVG' : 'Upscaled Result'}</span>
                            {resultUrl && !Array.isArray(resultUrl) && (
                                <button onClick={(e) => forceDownload(e, resultUrl)} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '700', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                    <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /> Download
                                </button>
                            )}
                        </div>
                        <div className="st-comparison-card-body">
                            {resultUrl ? (
                                Array.isArray(resultUrl) ? (
                                    <div className="st-result-reveal" style={{ position: 'absolute', inset: '0', padding: '1.25rem', display: 'flex', gap: '10px' }}>
                                        {resultUrl.map((url, i) => (
                                            <div key={i} style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                                                <MediaImg src={url} alt={`Result ${i + 1}`} token={currentToken} style={{ flex: 1, borderRadius: '10px', objectFit: 'contain' }} />
                                                <a href={url} onClick={(e) => forceDownload(e, url)} className="st-premium-download-btn" style={{ position: 'absolute', bottom: '0.5rem', right: '0.5rem' }}>Download</a>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="st-result-reveal">
                                        <MediaImg src={resultUrl} alt="Result" token={currentToken} />
                                    </div>
                                )
                            ) : loading ? (
                                <ModelLoadingBar
                                    active
                                    modelId={tool === 'vectorize'
                                        ? (vecEngine === 'api' ? 'recraft-ai/recraft-vectorize' : 'local')
                                        : 'google/upscaler'}
                                    label={tool === 'vectorize' ? 'Converting to vector…' : 'Enhancing resolution…'}
                                    accent="#6366f1"
                                    expectedMs={tool === 'vectorize' && vecEngine !== 'api' ? 5000 : undefined}
                                />
                            ) : (
                                <div style={{ textAlign: 'center', color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                    <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={48} />
                                    <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Ready to process image</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <input {...inputProps} />
            </div>
        );

    };

    const renderToolControls = () => {
        if (tool === 'vectorize') return (
            <div className="st-ctrl st-vectorize-ctrl">
                <div className="st-vectorize-card">
                    <div className="st-vectorize-card-head">
                        <span>Vector Output</span>
                        <strong>SVG</strong>
                    </div>
                    <label className="st-label">Engine</label>
                    <div className="st-vectorize-segment">
                        <button className={vecEngine === 'api' ? 'active' : ''} onClick={() => setVecEngine('api')}>Cloud API</button>
                        <button className={vecEngine === 'local' ? 'active' : ''} onClick={() => setVecEngine('local')}>Local</button>
                    </div>
                    {vecEngine === 'local' && (
                        <div className="st-vectorize-slider">
                            <div>
                                <label className="st-label">Color Detail</label>
                                <strong>{vecColors}</strong>
                            </div>
                            <input type="range" min="2" max="256" value={vecColors} onChange={(e) => setVecColors(Number(e.target.value))} />
                        </div>
                    )}
                    <button
                        className={`st-export-btn ${!hasEnoughVectorizeCredits ? 'insufficient-credits' : ''}`}
                        onClick={vectorize}
                        disabled={isVec || (!uploaded && !preview && !activeProject?.heroImageUrl) || !hasEnoughVectorizeCredits}
                        title={!hasEnoughVectorizeCredits ? `Need ${vectorizeCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Vectorize image'}
                    >
                        {isVec ? 'Vectorizing...' : hasEnoughVectorizeCredits ? 'Vectorize Image' : `Need ${vectorizeCreditCost} credits`}
                    </button>
                    {!hasEnoughVectorizeCredits && (
                        <div className="st-credit-shortage">
                            {userRemainingCredits.toLocaleString()} credits remaining. Switch to Local or recharge to use Cloud API.
                        </div>
                    )}
                </div>
            </div>
        );
        if (tool === 'upscale') return (
            <div className="st-ctrl">
                <label className="st-label">Resolution Factor</label>
                <div className="st-btn-row">
                    <button className={`st-grid-btn ${upscaleFactor === 'x2' ? 'active' : ''}`} onClick={() => setUpscaleFactor('x2')}>2x</button>
                    <button className={`st-grid-btn ${upscaleFactor === 'x4' ? 'active' : ''}`} onClick={() => setUpscaleFactor('x4')}>4x</button>
                </div>
                <button
                    className={`st-export-btn ${!hasEnoughUpscaleCredits ? 'insufficient-credits' : ''}`}
                    onClick={upscale}
                    disabled={isUpscaling || !uploaded || !hasEnoughUpscaleCredits}
                    title={!hasEnoughUpscaleCredits ? `Need ${upscaleCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Enhance resolution'}
                >
                    {isUpscaling ? 'Upscaling...' : hasEnoughUpscaleCredits ? 'Enhance Resolution' : `Need ${upscaleCreditCost} credits`}
                </button>
                {!hasEnoughUpscaleCredits && (
                    <div className="st-credit-shortage">
                        {userRemainingCredits.toLocaleString()} credits remaining. Recharge to use Super Resolution.
                    </div>
                )}
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
