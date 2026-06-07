import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';
import { createPortal } from 'react-dom';

export default function ColorwaysTool(props) {
    const { uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, creditPricing, cwUrl, setCwUrl, handleUpload } = props;

    const colorwayCreditCost = creditPricing.recolor || 3;
    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const hasEnoughColorwayCredits = userRemainingCredits >= colorwayCreditCost;
    const [isDrag, setIsDrag] = useState(false);
    const fileRef = useRef(null);

    const [cwExtractedPalette, setCwExtractedPalette] = useState([]);
    const [cwTargetPalette, setCwTargetPalette] = useState([]);
    const [isCwExtracting, setIsCwExtracting] = useState(false);
    const [isCwRecoloring, setIsCwRecoloring] = useState(false);
    const [cwVariations, setCwVariations] = useState([]);

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
        if (!hasEnoughColorwayCredits) {
            setError(`Insufficient credits. Recolor needs ${colorwayCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }
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
                        <div className="st-particle" />
                        <div className="st-particle" />
                        <div className="st-particle" />
                        <div className="st-particle" />
                        <div className="st-particle" />
                        <div className="st-particle" />
                    </div>
                    <div className="st-dropzone-icon-wrap">
                        <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z" s={36} />
                    </div>
                    <h2 className="st-dropzone-title">Upload artwork for Colorways</h2>
                    <p className="st-dropzone-desc">Drag & drop or click to browse — map and generate new colorways</p>
                    <div className="st-dropzone-badges">
                        <span className="st-dropzone-badge">PNG</span>
                        <span className="st-dropzone-badge">JPG</span>
                        <span className="st-dropzone-badge">TIFF</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="st-pattern-layout" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
            <div className="st-comparison-workspace">
                <div className="st-comparison-card">
                    <div className="st-comparison-card-head">
                        <span>Original Artwork</span>
                        <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={14} /> Replace
                        </button>
                    </div>
                    <div className="st-comparison-card-body" style={{ position: 'relative' }}>
                        <img src={preview} alt="Original" />
                    </div>
                </div>

                <div className="st-comparison-action-bridge">
                    <button
                        className={`st-extract-btn-creative ${!hasEnoughColorwayCredits ? 'insufficient-credits' : ''}`}
                        onClick={generateColorway}
                        disabled={isCwRecoloring || !cwExtractedPalette.length || !hasEnoughColorwayCredits}
                        title={!hasEnoughColorwayCredits ? `Need ${colorwayCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Generate colorway'}
                    >
                        <div className={isCwRecoloring ? 'spin-icon' : ''}>
                            <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z" s={20} />
                        </div>
                        {isCwRecoloring ? 'Generating...' : hasEnoughColorwayCredits ? 'Recolor' : `Need ${colorwayCreditCost} credits`}
                    </button>
                    <span className="st-credit-badge">
                        <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1" s={12} />
                        {colorwayCreditCost} credits
                    </span>
                </div>

                <div className="st-comparison-card">
                    <div className="st-comparison-card-head">
                        <span>Latest Colorway</span>
                        {cwUrl && (
                            <button onClick={(e) => forceDownload(e, `${API}${cwUrl}`)} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '700', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /> Download
                            </button>
                        )}
                    </div>
                    <div className="st-comparison-card-body">
                        {cwUrl ? (
                            <div className="st-result-reveal">
                                <img src={`${API}${cwUrl}`} alt="Result" />
                            </div>
                        ) : isCwRecoloring ? (
                            <div className="st-ai-processing">
                                <div className="st-ai-sparkle-container">
                                    <div className="st-ai-sparkle-icon">
                                        <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z" s={28} />
                                    </div>
                                    <div className="st-ai-ring" />
                                    <div className="st-ai-ring" />
                                    <div className="st-ai-ring" />
                                </div>
                                <span className="st-ai-phase-text">AI is recoloring pattern...</span>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={48} />
                                <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Ready to generate</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Color Mapping Editor - Below Workspace */}
            <div style={{ marginTop: '2rem', backgroundColor: 'var(--card-bg)', borderRadius: '16px', border: '1px solid var(--border)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text)', fontSize: '1.2rem' }}>Color Mapping Editor</h3>
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Extract palette from original artwork and map to new target colors.</p>
                    </div>
                    <button className="st-extract-btn-creative" onClick={extractColors} disabled={!uploaded || isCwExtracting} style={{ width: 'auto', padding: '0.5rem 1rem' }}>
                        <div className={isCwExtracting ? 'spin-icon' : ''}>
                            <I d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" s={16} />
                        </div>
                        {isCwExtracting ? 'Extracting...' : 'Extract Colors'}
                    </button>
                </div>

                {cwExtractedPalette.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                        {cwTargetPalette.map((mapping, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', backgroundColor: 'var(--bg)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                                    <span style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: mapping.old, border: '1px solid var(--border)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}></span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontWeight: 600 }}>{mapping.old}</span>
                                </div>
                                <div style={{ color: 'var(--text-muted)' }}><I d="M14 5l7 7m0 0l-7 7m7-7H3" s={16} /></div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                                    <input
                                        type="color"
                                        value={mapping.new}
                                        onChange={(e) => {
                                            const newPalette = [...cwTargetPalette];
                                            newPalette[idx].new = e.target.value;
                                            setCwTargetPalette(newPalette);
                                        }}
                                        style={{ width: '36px', height: '36px', padding: 0, border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                                    />
                                    <input
                                        type="text"
                                        value={mapping.new}
                                        onChange={(e) => {
                                            const newPalette = [...cwTargetPalette];
                                            newPalette[idx].new = e.target.value;
                                            setCwTargetPalette(newPalette);
                                        }}
                                        style={{ width: '75px', fontSize: '0.85rem', fontFamily: 'monospace', padding: '0.4rem', backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', fontWeight: 600 }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Recent Variations */}
            {cwVariations.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                    <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text)', fontSize: '1.1rem' }}>Recent Variations</h3>
                    <div className="st-variations-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
                        {cwVariations.map((v, i) => (
                            <div key={i} style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', cursor: 'pointer', transition: 'transform 0.2s', ':hover': { transform: 'translateY(-2px)' } }} onClick={() => { setCwUrl(v.url); setCwTargetPalette([...v.targetPalette]); }}>
                                <img src={`${API}${v.url}`} alt={`Variation ${i}`} style={{ width: '100%', display: 'block', aspectRatio: '1/1', objectFit: 'cover' }} />
                                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '0.5rem', display: 'flex', gap: '4px', overflowX: 'auto' }}>
                                    {v.targetPalette.map((p, j) => (
                                        <div key={j} style={{ width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, backgroundColor: p.new, border: '1px solid rgba(255,255,255,0.2)' }} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

}
