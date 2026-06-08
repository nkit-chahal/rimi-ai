import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { I } from '../shared/StudioIcons';
import { API, apiFetch, forceDownload } from '../shared/helpers';
import ImageDropzone from '../shared/ImageDropzone';
import { useImageDropzone } from '../shared/useImageDropzone';

export default function RemoveBgTool(props) {
    const {
        uploaded,
        preview,
        activeProject,
        user,
        setError,
        addBgTask,
        updateCreditsFromResponse,
        creditPricing,
        currentToken,
        removeBgUrl,
        setRemoveBgUrl,
        rightPanelEl,
        handlePreUpload,
        onUploadInvalid,
        onUploadPaste,
    } = props;

    const [isProcessing, setIsProcessing] = useState(false);

    const { pasteProps, openFilePicker, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const creditCost = creditPricing.removeBg || 2;
    const hasEnoughCredits = userRemainingCredits >= creditCost;

    const serverFilename = uploaded?.filename;
    const isUploading = Boolean(uploaded && !serverFilename);

    const resolveImagePayload = () => {
        if (serverFilename) {
            return { filename: serverFilename, imageUrl: null };
        }

        const activeUrl = preview || activeProject?.heroImageUrl;
        if (!activeUrl) return null;

        if (activeUrl.startsWith('http')) {
            return { filename: '', imageUrl: activeUrl };
        }

        if (activeUrl.startsWith('blob:')) {
            return null;
        }

        const name = activeUrl.split('/').pop();
        return name ? { filename: name, imageUrl: null } : null;
    };

    const removeBackground = async () => {
        if (isUploading) {
            setError('Image is still uploading — wait a moment and try again.');
            return;
        }

        const payload = resolveImagePayload();
        if (!payload) {
            setError('Upload an image first');
            return;
        }
        if (!hasEnoughCredits) {
            setError(`Insufficient credits. Remove Background needs ${creditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }

        setIsProcessing(true);
        setError('');
        setRemoveBgUrl(null);

        const trigger = async () => {
            const data = await apiFetch('/api/remove-bg', {
                method: 'POST',
                body: JSON.stringify({
                    ...payload,
                    projectId: activeProject.id,
                    userId: user?.id,
                }),
            }, currentToken);

            if (data.success) {
                const fullUrl = `${API}${data.resultUrl}`;
                setRemoveBgUrl(fullUrl);
                setIsProcessing(false);
                updateCreditsFromResponse(data);
                return { url: fullUrl };
            }
            setIsProcessing(false);
            throw new Error(data.error || 'Background removal failed');
        };

        addBgTask('removebg', 'Remove Background', payload.filename || 'image.png', trigger);
    };

    const renderControls = () => (
        <div className="st-ctrl">
            <div className="st-vectorize-card">
                <div className="st-vectorize-card-head">
                    <span>Output</span>
                    <strong>PNG (transparent)</strong>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5, margin: '0 0 0.75rem' }}>
                    AI removes the background and returns a transparent PNG. Typical processing time is about 3 seconds.
                </p>

                <button
                    className={`st-export-btn ${!hasEnoughCredits ? 'insufficient-credits' : ''}`}
                    onClick={removeBackground}
                    disabled={isProcessing || isUploading || (!serverFilename && !preview && !activeProject?.heroImageUrl) || !hasEnoughCredits}
                    title={!hasEnoughCredits ? `Need ${creditCost} credits. You have ${userRemainingCredits} remaining.` : 'Remove background'}
                >
                    {isProcessing ? 'Removing...' : hasEnoughCredits ? 'Remove Background' : `Need ${creditCost} credits`}
                </button>
                {!hasEnoughCredits && (
                    <div className="st-credit-shortage">
                        {userRemainingCredits.toLocaleString()} credits remaining. Recharge to use Remove Background.
                    </div>
                )}
            </div>
        </div>
    );

    if (!preview) {
        return (
            <>
                <div className="st-pattern-layout" style={{ display: 'flex', flex: 1, padding: '2rem' }}>
                    <ImageDropzone
                        title="Upload artwork to remove background"
                        description="Drag & drop, paste, or click — get a clean transparent PNG in seconds"
                        badges={['PNG', 'JPG', 'WEBP']}
                        onFile={handlePreUpload}
                        onInvalidFile={onUploadInvalid}
                        onPasteSuccess={onUploadPaste}
                    />
                </div>
                {rightPanelEl && createPortal(
                    <div className="st-pl-right" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        {renderControls()}
                    </div>,
                    rightPanelEl,
                )}
            </>
        );
    }

    return (
        <>
            <div {...pasteProps} className="st-pattern-layout" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div className="st-comparison-workspace">
                    <div className="st-comparison-card">
                        <div className="st-comparison-card-head">
                            <span>Original</span>
                            <button type="button" onClick={openFilePicker} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={14} />
                                Replace
                            </button>
                        </div>
                        <div className="st-comparison-card-body">
                            <img src={preview} alt="Original artwork" />
                        </div>
                    </div>

                    <div className="st-comparison-action-bridge">
                        <button
                            className={`st-extract-btn-creative ${!hasEnoughCredits ? 'insufficient-credits' : ''}`}
                            onClick={removeBackground}
                            disabled={isProcessing || isUploading || !preview || !hasEnoughCredits}
                            title={!hasEnoughCredits ? `Need ${creditCost} credits. You have ${userRemainingCredits} remaining.` : 'Remove Background'}
                        >
                            <div className={isProcessing ? 'spin-icon' : ''}>
                                <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={20} />
                            </div>
                            {isProcessing ? 'Processing...' : hasEnoughCredits ? 'Remove BG' : `Need ${creditCost} credits`}
                        </button>
                        <span className="st-credit-badge">
                            <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1" s={12} />
                            {creditCost} credits
                        </span>
                    </div>

                    <div className="st-comparison-card">
                        <div className="st-comparison-card-head">
                            <span>Transparent PNG</span>
                            {removeBgUrl && (
                                <button type="button" onClick={(e) => forceDownload(e, removeBgUrl)} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '700', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                    <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /> Download
                                </button>
                            )}
                        </div>
                        <div className="st-comparison-card-body checkerboard-bg">
                            {removeBgUrl ? (
                                <div className="st-result-reveal">
                                    <img src={removeBgUrl} alt="Background removed" />
                                </div>
                            ) : isProcessing ? (
                                <div className="st-ai-processing">
                                    <div className="st-ai-sparkle-container">
                                        <div className="st-ai-sparkle-icon">
                                            <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={28} />
                                        </div>
                                        <div className="st-ai-ring" />
                                        <div className="st-ai-ring" />
                                        <div className="st-ai-ring" />
                                    </div>
                                    <span className="st-ai-phase-text">Removing background...</span>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                    <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={48} />
                                    <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Ready to remove background</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <input {...inputProps} />
            </div>
            {rightPanelEl && createPortal(
                <div className="st-pl-right" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {renderControls()}
                </div>,
                rightPanelEl,
            )}
        </>
    );
}
