import React, { useState } from 'react';
import { I } from '../shared/StudioIcons';
import { apiFetch, forceDownload } from '../shared/helpers';
import ImageDropzone from '../shared/ImageDropzone';
import { useImageDropzone } from '../shared/useImageDropzone';

export default function ColorwayManagerTool(props) {
    const {
        uploaded, preview, activeProject, user, setError, updateCreditsFromResponse,
        creditPricing, currentToken, handlePreUpload, onUploadInvalid, onUploadPaste,
    } = props;

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));

    const { pasteProps, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

    const [cwmPalette, setCwmPalette] = useState([]);
    const [cwmColorways, setCwmColorways] = useState([]);
    const [cwmLockedColors, setCwmLockedColors] = useState(new Set());
    const [cwmStrategy, setCwmStrategy] = useState('complementary');
    const [isCwmGenerating, setIsCwmGenerating] = useState(false);
    const [isCwmExporting, setIsCwmExporting] = useState(false);

    const cwmExtractPalette = async () => {
        if (!uploaded) return;
        setIsCwmGenerating(true);
        setError('');
        try {
            const d = await apiFetch('/api/extract-palette', {
                method: 'POST',
                body: JSON.stringify({ filename: uploaded.filename, numColors: 6 }),
            }, currentToken);
            if (d.success) {
                setCwmPalette(d.palette);
                setCwmColorways([]);
                setCwmLockedColors(new Set());
            } else {
                throw new Error(d.error || 'Failed to extract palette');
            }
        } catch (e) {
            setError(e.message || 'Failed to extract palette');
        } finally {
            setIsCwmGenerating(false);
        }
    };

    const cwmGenerateColorways = async () => {
        if (!uploaded || cwmPalette.length === 0) return;
        const requiredCredits = 4 * (creditPricing.colorways || 3);
        if (userRemainingCredits < requiredCredits) {
            setError(`Insufficient credits. Colorway generation needs ${requiredCredits} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }
        setIsCwmGenerating(true);
        setError('');
        try {
            const d = await apiFetch('/api/colorways/generate', {
                method: 'POST',
                body: JSON.stringify({
                    filename: uploaded.filename,
                    palette: cwmPalette.map(p => p.hex),
                    lockedIndices: Array.from(cwmLockedColors),
                    strategy: cwmStrategy,
                    count: 4,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            }, currentToken);
            if (d.success) {
                setCwmColorways(d.colorways);
                updateCreditsFromResponse(d);
            } else {
                throw new Error(d.error || 'Generation failed');
            }
        } catch (e) {
            setError(e.message || 'Colorway generation failed');
        } finally {
            setIsCwmGenerating(false);
        }
    };

    const cwmExportLineCard = async () => {
        if (cwmColorways.length === 0) return;
        setIsCwmExporting(true);
        try {
            const res = await fetch(`${API}/api/colorways/export-linecard`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded?.filename,
                    colorways: cwmColorways,
                    basePalette: cwmPalette.map(p => p.hex),
                    projectId: activeProject.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                const link = document.createElement('a');
                link.href = `${API}${d.pdfUrl}`;
                link.download = 'colorway_linecard.pdf';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        } catch (e) {
            setError('Export failed');
        } finally {
            setIsCwmExporting(false);
        }
    };

    // ===== MEASUREMENT TOOL =====


    const strategies = [
        { id: 'complementary', label: 'Complementary', desc: 'Opposite colors on the wheel', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z' },
        { id: 'analogous', label: 'Analogous', desc: 'Adjacent colors, harmonious', icon: 'M4 4h16v16H4V4zm4 4v8M16 8v8M12 8v8' },
        { id: 'triadic', label: 'Triadic', desc: 'Three evenly spaced colors', icon: 'M12 2L2 22h20L12 2z' },
        { id: 'monochrome', label: 'Monochrome', desc: 'Variations of a single hue', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 14a5 5 0 1 1 0-10 5 5 0 0 1 0 10z' },
        { id: 'seasonal_warm', label: 'Warm Season', desc: 'Autumn/spring warm palette', icon: 'M12 3v2m0 14v2M5.636 5.636l1.414 1.414M16.95 16.95l1.414 1.414M3 12h2m14 0h2M5.636 18.364l1.414-1.414M16.95 7.05l1.414-1.414M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
        { id: 'seasonal_cool', label: 'Cool Season', desc: 'Winter/summer cool palette', icon: 'M12 2l2 4 4-2-2 4 4 2-4 2 2 4-4-2-2 4-2-4-4 2 2-4-4-2 4-2-2-4 4 2 2-4z' },
    ];

    if (!preview) {
        return (
            <div className="st-pattern-layout" style={{ display: 'flex', flex: 1, padding: '2rem' }}>
                <ImageDropzone
                    title="Upload artwork to manage colorways"
                    description="Drag & drop, paste, or click — mass-generate production palettes"
                    badges={['PNG', 'JPG', 'WEBP']}
                    icon={<I d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V17a4 4 0 01-4 4H7z" s={36} />}
                    onFile={handlePreUpload}
                    onInvalidFile={onUploadInvalid}
                    onPasteSuccess={onUploadPaste}
                />
            </div>
        );
    }

    return (
        <div {...pasteProps} className="st-tool-content st-pattern-layout" style={{ maxWidth: '1400px', margin: '0 auto', padding: '2rem' }}>
            {/* Palette Extraction */}
            {cwmPalette.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                    <div className="st-comparison-card" style={{ width: '100%', maxWidth: '600px', textAlign: 'center', padding: '3rem 2rem' }}>
                        <div className="st-dropzone-icon-wrap" style={{ margin: '0 auto 1.5rem auto' }}>
                            <I d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V17a4 4 0 01-4 4H7z" s={36} />
                        </div>
                        <h3 style={{ color: 'var(--text)', margin: '0 0 0.5rem 0', fontSize: '1.5rem' }}>Extract Base Palette</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '2rem' }}>AI will analyze your artwork and intelligently extract its core colors to generate production colorways.</p>
                        <button className="st-extract-btn-creative" onClick={cwmExtractPalette} disabled={isCwmGenerating}>
                            <div className={isCwmGenerating ? 'spin-icon' : ''}>
                                <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z" s={20} />
                            </div>
                            {isCwmGenerating ? 'Extracting Palette...' : 'Extract Palette from Image'}
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        {/* Left Panel: Controls */}
                        <div style={{ flex: '1 1 400px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                            {/* Base Palette + Lock Controls */}
                            <div className="st-comparison-card" style={{ padding: '1.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                                    <div className="st-group-title" style={{ margin: 0, fontSize: '1.1rem' }}>BASE PALETTE</div>
                                    <button className="st-btn" onClick={cwmExtractPalette} style={{ fontSize: '0.75rem', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                        <I d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" s={14} /> Re-extract
                                    </button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: '1rem' }}>
                                    {cwmPalette.map((c, i) => (
                                        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                                            <div
                                                style={{
                                                    width: '100%', aspectRatio: '1', borderRadius: '12px', backgroundColor: c.hex,
                                                    border: cwmLockedColors.has(i) ? '3px solid #6366f1' : '1px solid var(--border)',
                                                    cursor: 'pointer', position: 'relative', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
                                                }}
                                                title={`${c.hex} (${(c.weight * 100).toFixed(1)}%)`}
                                                onClick={() => setCwmLockedColors(prev => {
                                                    const next = new Set(prev);
                                                    next.has(i) ? next.delete(i) : next.add(i);
                                                    return next;
                                                })}
                                            >
                                                {cwmLockedColors.has(i) && (
                                                    <div style={{ position: 'absolute', top: '-6px', right: '-6px', width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                                                        <I d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" s={12} />
                                                    </div>
                                                )}
                                            </div>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontWeight: 600 }}>{c.hex}</span>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    <I d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" s={14} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} />
                                    Click a color to lock it. Locked colors won't change during generation.
                                </div>
                            </div>

                            {/* Strategy Picker */}
                            <div className="st-comparison-card" style={{ padding: '1.5rem' }}>
                                <div className="st-group-title" style={{ fontSize: '1.1rem' }}>COLOR STRATEGY</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginTop: '1rem' }}>
                                    {strategies.map(s => (
                                        <button key={s.id} className={`st-btn ${cwmStrategy === s.id ? 'primary' : ''}`}
                                            onClick={() => setCwmStrategy(s.id)}
                                            style={{ flexDirection: 'column', gap: '0.4rem', padding: '1rem 0.75rem', textAlign: 'left', alignItems: 'flex-start', borderRadius: '12px', border: cwmStrategy === s.id ? '2px solid transparent' : '1px solid var(--border)', background: cwmStrategy === s.id ? 'var(--primary-hover)' : 'var(--bg)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <I d={s.icon} s={16} />
                                                <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{s.label}</span>
                                            </div>
                                            <span style={{ fontSize: '0.7rem', opacity: cwmStrategy === s.id ? 0.9 : 0.6, lineHeight: 1.3 }}>{s.desc}</span>
                                        </button>
                                    ))}
                                </div>
                                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                                    <button
                                        className={`st-extract-btn-creative ${userRemainingCredits < (4 * (creditPricing.colorways || 3)) ? 'insufficient-credits' : ''}`}
                                        onClick={cwmGenerateColorways}
                                        disabled={isCwmGenerating || userRemainingCredits < (4 * (creditPricing.colorways || 3))}
                                        title={userRemainingCredits < (4 * (creditPricing.colorways || 3)) ? `Need ${4 * (creditPricing.colorways || 3)} credits. You have ${userRemainingCredits} remaining.` : 'Generate colorways'}
                                        style={{ width: '100%', padding: '0.85rem' }}
                                    >
                                        <div className={isCwmGenerating ? 'spin-icon' : ''}>
                                            <I d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" s={20} />
                                        </div>
                                        {isCwmGenerating ? 'Generating...' : userRemainingCredits < (4 * (creditPricing.colorways || 3)) ? `Need ${4 * (creditPricing.colorways || 3)} credits` : 'Generate 4 Colorways'}
                                    </button>
                                </div>
                                {cwmColorways.length > 0 && (
                                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                                        <button className="st-btn" onClick={cwmExportLineCard} disabled={isCwmExporting}
                                            style={{ padding: '0.75rem 1.5rem', width: '100%' }}>
                                            {isCwmExporting ? 'Exporting...' : <><I d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" s={14} /> Export Line Card PDF</>}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right Panel: Results */}
                        <div style={{ flex: '2 1 600px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {isCwmGenerating ? (
                                <div className="st-comparison-card" style={{ height: '100%', minHeight: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                    <div className="st-ai-processing">
                                        <div className="st-ai-sparkle-container">
                                            <div className="st-ai-sparkle-icon">
                                                <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z" s={36} />
                                            </div>
                                            <div className="st-ai-ring" />
                                            <div className="st-ai-ring" />
                                            <div className="st-ai-ring" />
                                        </div>
                                        <span className="st-ai-phase-text" style={{ marginTop: '1.5rem', fontSize: '1.1rem' }}>AI is calculating multi-colorway distribution...</span>
                                    </div>
                                </div>
                            ) : cwmColorways.length > 0 ? (
                                <div className="st-comparison-card" style={{ padding: '2rem' }}>
                                    <div className="st-group-title" style={{ fontSize: '1.2rem', marginBottom: '1.5rem' }}>GENERATED COLORWAYS</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                                        {cwmColorways.map((cw, i) => (
                                            <div key={i} style={{ backgroundColor: 'var(--bg)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                                {cw.resultUrl ? (
                                                    <div style={{ aspectRatio: '1', overflow: 'hidden', position: 'relative' }}>
                                                        <img src={`${API}${cw.resultUrl}`} alt={`Colorway ${i + 1}`}
                                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        <div style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: '4px 8px', borderRadius: '8px', color: '#fff', fontSize: '0.7rem', fontWeight: 600 }}>
                                                            Colorway {i + 1}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--card-bg)' }}>
                                                        <div className="st-spinner" />
                                                    </div>
                                                )}
                                                <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1rem' }}>
                                                        {cw.colors?.map((hex, j) => (
                                                            <div key={j} style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: hex, border: '1px solid var(--border)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)' }} title={hex} />
                                                        ))}
                                                    </div>
                                                    <div style={{ marginTop: 'auto' }}>
                                                        {cw.resultUrl && (
                                                            <button className="st-btn" onClick={(e) => forceDownload(e, `${API}${cw.resultUrl}`)} style={{ width: '100%', padding: '0.6rem' }}>
                                                                <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} style={{ marginRight: '4px' }} /> Download
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="st-comparison-card" style={{ height: '100%', minHeight: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                    <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z" s={48} />
                                    <p style={{ marginTop: '1rem', fontSize: '1.1rem', fontWeight: 600 }}>Ready to generate 4 new colorways</p>
                                    <p style={{ fontSize: '0.9rem' }}>Select a strategy on the left and click Generate.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
            <input {...inputProps} />
        </div>
    );

}
