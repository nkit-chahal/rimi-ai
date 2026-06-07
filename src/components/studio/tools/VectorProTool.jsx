import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';
import { createPortal } from 'react-dom';

export default function VectorProTool(props) {
    const { uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, creditPricing, brandPalettes } = props;

    const [layerExportLoading, setLayerExportLoading] = useState(null);
    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const colorReductionCreditCost = creditPricing.colorReduction || 3;
    const hasEnoughColorReductionCredits = userRemainingCredits >= colorReductionCreditCost;
    const layerExportCreditCost = creditPricing.layerExport || 2;
    const hasEnoughLayerExportCredits = userRemainingCredits >= layerExportCreditCost;
    const [isDrag, setIsDrag] = useState(false);
    const fileRef = useRef(null);

    const [vpTab, setVpTab] = useState('reduce');
    const [vpNumColors, setVpNumColors] = useState(6);
    const [vpReducedUrl, setVpReducedUrl] = useState(null);
    const [vpPalette, setVpPalette] = useState([]);
    const [isVpReducing, setIsVpReducing] = useState(false);
    const [vpLookupHex, setVpLookupHex] = useState('#ff6f61');
    const [vpLookupResults, setVpLookupResults] = useState([]);
    const [isVpLooking, setIsVpLooking] = useState(false);
    const [vpBrandPaletteId, setVpBrandPaletteId] = useState('');

    const reduceColors = async () => {
        if (!uploaded) return;
        if (!hasEnoughColorReductionCredits) {
            setError(`Insufficient credits. Color reduction needs ${colorReductionCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }
        setIsVpReducing(true);
        setError('');
        try {
            const res = await fetch(`${API}/api/color-reduce`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    numColors: vpNumColors,
                    projectId: activeProject.id,
                    userId: user.id,
                    brandPaletteId: vpBrandPaletteId ? parseInt(vpBrandPaletteId) : null
                }),
            });
            const d = await res.json();
            if (d.success) {
                setVpReducedUrl(d.resultUrl);
                setVpPalette(d.palette);
                updateCreditsFromResponse(d);
            } else {
                throw new Error(d.error);
            }
        } catch (e) {
            setError(e.message || 'Color reduction failed');
        } finally {
            setIsVpReducing(false);
        }
    };

    const lookupPantone = async (hexVal) => {
        setIsVpLooking(true);
        try {
            const res = await fetch(`${API}/api/pantone-match`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hex: hexVal }),
            });
            const d = await res.json();
            if (d.success) {
                setVpLookupResults(d.matches);
            }
        } catch (e) {
            setError('Pantone lookup failed');
        } finally {
            setIsVpLooking(false);
        }
    };

    const exportLayers = async (format) => {
        if (!uploaded) return;
        if (!hasEnoughLayerExportCredits) {
            setError(`Insufficient credits. Layer export needs ${layerExportCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }
        setLayerExportLoading(format);
        setError('');
        try {
            const res = await fetch(`${API}/api/layer-export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    numColors: vpNumColors,
                    format,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                updateCreditsFromResponse(d);
                const link = document.createElement('a');
                link.href = `${API}${d.resultUrl}`;
                link.download = `layers_${uploaded.filename.replace(/\.[^.]+$/, '')}.${format === 'zip' ? 'zip' : 'tiff'}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                throw new Error(d.error);
            }
        } catch (e) {
            setError(e.message || 'Layer export failed');
        } finally {
            setLayerExportLoading(null);
        }
    };


    return (
        <div className="st-pattern-layout" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
            {/* Premium Tab Bar */}
            <div className="st-comparison-card" style={{ marginBottom: '1.5rem', overflow: 'visible' }}>
                <div className="st-comparison-card-head" style={{ padding: 0, border: 'none' }}>
                    <div style={{ display: 'flex', width: '100%' }}>
                        <button
                            onClick={() => setVpTab('reduce')}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
                                padding: '1rem 1.5rem', border: 'none', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700,
                                background: vpTab === 'reduce' ? 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.08))' : 'transparent',
                                color: vpTab === 'reduce' ? 'var(--primary)' : 'var(--text-muted)',
                                borderBottom: vpTab === 'reduce' ? '2px solid var(--primary)' : '2px solid transparent',
                                transition: 'all 0.25s ease'
                            }}
                        >
                            <I d="M4 6h16M4 12h10M4 18h6" s={18} />
                            Color Reduce
                        </button>
                        <button
                            onClick={() => setVpTab('lookup')}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
                                padding: '1rem 1.5rem', border: 'none', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700,
                                background: vpTab === 'lookup' ? 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.08))' : 'transparent',
                                color: vpTab === 'lookup' ? 'var(--primary)' : 'var(--text-muted)',
                                borderBottom: vpTab === 'lookup' ? '2px solid var(--primary)' : '2px solid transparent',
                                transition: 'all 0.25s ease'
                            }}
                        >
                            <I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" s={18} />
                            Pantone Lookup
                        </button>
                    </div>
                </div>
            </div>

            {vpTab === 'reduce' ? (
                <div className="st-comparison-workspace">
                    {/* Left Panel — Controls */}
                    <div className="st-comparison-card" style={{ flex: '1 1 320px', maxWidth: '400px' }}>
                        <div className="st-comparison-card-head">
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <I d="M4 6h16M4 12h10M4 18h6" s={16} />
                                Reduce Controls
                            </span>
                            <span className="st-credit-badge">
                                <I d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 10v1" s={12} />
                                10 credits
                            </span>
                        </div>
                        <div className="st-comparison-card-body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0, lineHeight: 1.6 }}>
                                Quantize your design to a fixed number of colors for screen printing, then auto-match each to the nearest Pantone.
                            </p>

                            <div>
                                <div className="st-group-title">TARGET COLORS</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                                    <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary)', minWidth: '2.5rem', textAlign: 'center' }}>
                                        {vpBrandPaletteId ? '—' : vpNumColors}
                                    </span>
                                    {!vpBrandPaletteId && (
                                        <input
                                            type="range"
                                            min={2} max={16} step={1}
                                            value={vpNumColors}
                                            onChange={(e) => setVpNumColors(Number(e.target.value))}
                                            style={{ flex: 1, accentColor: 'var(--primary)' }}
                                        />
                                    )}
                                    {vpBrandPaletteId && (
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Brand Palette Enforced</span>
                                    )}
                                </div>
                            </div>

                            <div>
                                <div className="st-group-title">BRAND STYLE ENFORCEMENT</div>
                                <select
                                    className="st-input"
                                    value={vpBrandPaletteId}
                                    onChange={e => setVpBrandPaletteId(e.target.value)}
                                    style={{ width: '100%', marginTop: '0.5rem', cursor: 'pointer', padding: '0.7rem', borderRadius: '10px' }}
                                >
                                    <option value="">None (Auto-Extract)</option>
                                    {brandPalettes.map(p => (
                                        <option key={p.id} value={p.id}>{p.name} ({p.colors.length} colors)</option>
                                    ))}
                                </select>
                            </div>

                            <button
                                className={`st-extract-btn-creative ${!hasEnoughColorReductionCredits ? 'insufficient-credits' : ''}`}
                                onClick={reduceColors}
                                disabled={!uploaded || isVpReducing || !hasEnoughColorReductionCredits}
                                title={!hasEnoughColorReductionCredits ? `Need ${colorReductionCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Reduce and match colors'}
                                style={{ width: '100%' }}
                            >
                                <div className={isVpReducing ? 'spin-icon' : ''}>
                                    <I d="M4 6h16M4 12h10M4 18h6" s={18} />
                                </div>
                                {isVpReducing ? 'Reducing Colors...' : hasEnoughColorReductionCredits ? 'Reduce & Match' : `Need ${colorReductionCreditCost} credits`}
                            </button>
                            {!hasEnoughColorReductionCredits && (
                                <div className="st-credit-shortage">
                                    {userRemainingCredits.toLocaleString()} credits remaining. Recharge to reduce colors.
                                </div>
                            )}

                            {/* Layer Export buttons */}
                            {vpPalette.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        className="st-btn"
                                        onClick={() => exportLayers('zip')}
                                        disabled={!!layerExportLoading}
                                        style={{ flex: 1, fontSize: '0.8rem', padding: '0.6rem', borderRadius: '10px' }}
                                    >
                                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={13} />
                                        {layerExportLoading === 'zip' ? '...' : 'Layers ZIP'}
                                    </button>
                                    <button
                                        className="st-btn"
                                        onClick={() => exportLayers('tiff')}
                                        disabled={!!layerExportLoading}
                                        style={{ flex: 1, fontSize: '0.8rem', padding: '0.6rem', borderRadius: '10px' }}
                                    >
                                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={13} />
                                        {layerExportLoading === 'tiff' ? '...' : 'Layers TIFF'}
                                    </button>
                                </div>
                            )}

                            {/* Matched Palette — Modern Grid Cards */}
                            {vpPalette.length > 0 && (
                                <div>
                                    <div className="st-group-title" style={{ marginBottom: '0.75rem' }}>MATCHED PALETTE</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.6rem' }}>
                                        {vpPalette.map((color, idx) => (
                                            <div key={idx} style={{
                                                padding: '0.75rem', borderRadius: '12px',
                                                background: 'var(--bg)', border: '1px solid var(--border)',
                                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
                                                transition: 'transform 0.2s, box-shadow 0.2s'
                                            }}>
                                                <span style={{
                                                    width: '40px', height: '40px', borderRadius: '10px',
                                                    backgroundColor: color.hex, border: '1px solid var(--border)',
                                                    boxShadow: `0 4px 12px ${color.hex}40`
                                                }}></span>
                                                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text)', fontWeight: 700 }}>
                                                    {color.hex.toUpperCase()}
                                                </span>
                                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', background: 'var(--card-bg)', padding: '2px 6px', borderRadius: '6px' }}>
                                                    {(color.weight * 100).toFixed(1)}%
                                                </span>
                                                {color.pantoneMatches && color.pantoneMatches.length > 0 && (
                                                    <div style={{ textAlign: 'center' }}>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 700 }}>
                                                            {color.pantoneMatches[0].name}
                                                        </div>
                                                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                                                            ΔE {color.pantoneMatches[0].deltaE}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Panel — Preview */}
                    <div className="st-comparison-card" style={{ flex: '2 1 400px' }}>
                        <div className="st-comparison-card-head">
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={16} />
                                {vpReducedUrl ? `Quantized Result (${vpNumColors} colors)` : 'Preview'}
                            </span>
                            {vpReducedUrl && (
                                <button onClick={(e) => forceDownload(e, `${API}${vpReducedUrl}`)} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '700', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                    <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={14} /> Download
                                </button>
                            )}
                        </div>
                        <div className="st-comparison-card-body" style={{ position: 'relative' }}>
                            {vpReducedUrl ? (
                                <div className="st-result-reveal">
                                    <img src={`${API}${vpReducedUrl}`} alt="Quantized" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                </div>
                            ) : isVpReducing ? (
                                <div className="st-ai-processing">
                                    <div className="st-ai-sparkle-container">
                                        <div className="st-ai-sparkle-icon">
                                            <I d="M4 6h16M4 12h10M4 18h6" s={28} />
                                        </div>
                                        <div className="st-ai-ring" />
                                        <div className="st-ai-ring" />
                                        <div className="st-ai-ring" />
                                    </div>
                                    <span className="st-ai-phase-text">AI is reducing colors...</span>
                                </div>
                            ) : uploaded ? (
                                <img src={preview} alt="Original" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', color: 'var(--text-muted)', gap: '1rem' }}>
                                    <I d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" s={48} />
                                    <p style={{ fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>Upload an image to start reducing colors</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                /* Pantone Lookup Tab */
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div className="st-comparison-card" style={{ maxWidth: '640px', width: '100%' }}>
                        <div className="st-comparison-card-head">
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" s={16} />
                                Pantone Color Lookup
                            </span>
                            <span className="st-credit-badge" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                                <I d="M5 13l4 4L19 7" s={12} />
                                Free
                            </span>
                        </div>
                        <div className="st-comparison-card-body" style={{ padding: '1.5rem' }}>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0, marginBottom: '1.5rem', lineHeight: 1.6 }}>
                                Enter any hex color to find the closest Pantone TCX matches using Delta-E 2000 perceptual distance.
                            </p>

                            {/* Color Input Row */}
                            <div style={{
                                display: 'flex', gap: '0.75rem', marginBottom: '1.5rem',
                                padding: '0.75rem', background: 'var(--bg)', borderRadius: '14px', border: '1px solid var(--border)',
                                alignItems: 'center'
                            }}>
                                <input
                                    type="color"
                                    value={vpLookupHex}
                                    onChange={(e) => setVpLookupHex(e.target.value)}
                                    style={{ width: '48px', height: '44px', padding: 0, border: 'none', borderRadius: '10px', cursor: 'pointer', flexShrink: 0 }}
                                />
                                <input
                                    type="text"
                                    value={vpLookupHex}
                                    onChange={(e) => setVpLookupHex(e.target.value)}
                                    placeholder="#ff6f61"
                                    className="st-input"
                                    style={{ flex: 1, fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700 }}
                                />
                                <button
                                    className="st-extract-btn-creative"
                                    onClick={() => lookupPantone(vpLookupHex)}
                                    disabled={isVpLooking || vpLookupHex.length < 4}
                                    style={{ width: 'auto', padding: '0.6rem 1.5rem', whiteSpace: 'nowrap' }}
                                >
                                    <I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" s={16} />
                                    {isVpLooking ? 'Matching...' : 'Match'}
                                </button>
                            </div>

                            {/* Results */}
                            {vpLookupResults.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div className="st-group-title">TOP MATCHES</div>
                                    {vpLookupResults.map((m, idx) => (
                                        <div key={idx} style={{
                                            display: 'flex', alignItems: 'center', gap: '1rem',
                                            padding: '1rem', backgroundColor: 'var(--bg)', borderRadius: '14px',
                                            border: idx === 0 ? '2px solid var(--primary)' : '1px solid var(--border)',
                                            position: 'relative', transition: 'transform 0.2s'
                                        }}>
                                            {idx === 0 && (
                                                <div style={{
                                                    position: 'absolute', top: '-8px', right: '12px',
                                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                                    color: '#fff', fontSize: '0.6rem', fontWeight: 800,
                                                    padding: '2px 10px', borderRadius: '8px', textTransform: 'uppercase', letterSpacing: '0.05em'
                                                }}>Best Match</div>
                                            )}
                                            <span style={{
                                                width: '48px', height: '48px', borderRadius: '12px',
                                                backgroundColor: m.hex, border: '1px solid var(--border)', flexShrink: 0,
                                                boxShadow: `0 4px 14px ${m.hex}40`
                                            }}></span>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>{m.name}</div>
                                                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                                                    <span style={{
                                                        fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)',
                                                        background: 'var(--card-bg)', padding: '2px 8px', borderRadius: '6px'
                                                    }}>{m.hex.toUpperCase()}</span>
                                                    <span style={{
                                                        fontSize: '0.78rem', color: 'var(--text-muted)',
                                                        background: 'var(--card-bg)', padding: '2px 8px', borderRadius: '6px'
                                                    }}>RGB({m.rgb.join(', ')})</span>
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'center', flexShrink: 0, minWidth: '52px' }}>
                                                <div style={{
                                                    fontSize: '1.3rem', fontWeight: 800, lineHeight: 1,
                                                    color: m.deltaE < 5 ? '#22c55e' : m.deltaE < 10 ? '#eab308' : '#ef4444'
                                                }}>
                                                    {m.deltaE}
                                                </div>
                                                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '0.2rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>ΔE 2000</div>
                                            </div>
                                        </div>
                                    ))}
                                    <div style={{
                                        fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0',
                                        padding: '0.6rem 0.8rem', background: 'var(--bg)', borderRadius: '10px',
                                        textAlign: 'center', border: '1px solid var(--border)'
                                    }}>
                                        ΔE {'<'} 2 = imperceptible · ΔE {'<'} 5 = close match · ΔE {'>'} 10 = different color
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

}
