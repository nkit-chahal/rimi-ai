import React, { useState } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

export default function VectorProTool({ uploaded, preview, activeProject, user, controls, setError, brandPalettes, updateCreditsFromResponse }) {
    // ===== LOCAL STATE =====
    const [vpTab, setVpTab] = useState('reduce');
    const [vpNumColors, setVpNumColors] = useState(6);
    const [vpReducedUrl, setVpReducedUrl] = useState(null);
    const [vpPalette, setVpPalette] = useState([]);
    const [isVpReducing, setIsVpReducing] = useState(false);
    const [vpLookupHex, setVpLookupHex] = useState('#ff6f61');
    const [vpLookupResults, setVpLookupResults] = useState([]);
    const [isVpLooking, setIsVpLooking] = useState(false);
    const [vpBrandPaletteId, setVpBrandPaletteId] = useState('');
    const [layerExportLoading, setLayerExportLoading] = useState(null);

    // ===== HANDLERS =====
    const reduceColors = async () => {
        if (!uploaded) return;
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

    // ===== RENDER =====
    return (
        <div className="st-tool-content st-vectorpro">
            {/* Tab bar */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <button className={`st-btn ${vpTab === 'reduce' ? 'primary' : ''}`} onClick={() => setVpTab('reduce')} style={{ flex: 1 }}>
                    <I d="M4 6h16M4 12h10M4 18h6" s={16} /> Color Reduce
                </button>
                <button className={`st-btn ${vpTab === 'lookup' ? 'primary' : ''}`} onClick={() => setVpTab('lookup')} style={{ flex: 1 }}>
                    <I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" s={16} /> Pantone Lookup
                </button>
            </div>

            {vpTab === 'reduce' ? (
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                    {/* Controls */}
                    <div style={{ flex: '1 1 280px', maxWidth: '360px', backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Reduce Colors</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                            Quantize your design to a fixed number of colors for screen printing, then auto-match each to the nearest Pantone.
                        </p>

                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            Target Colors: <strong style={{ color: 'var(--text)' }}>{vpBrandPaletteId ? 'Brand Palette Enforced' : vpNumColors}</strong>
                        </label>
                        {!vpBrandPaletteId && (
                            <input
                                type="range"
                                min={2} max={16} step={1}
                                value={vpNumColors}
                                onChange={(e) => setVpNumColors(Number(e.target.value))}
                                style={{ width: '100%', marginBottom: '1.5rem', accentColor: 'var(--primary)' }}
                            />
                        )}

                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            Brand Style Enforcement
                        </label>
                        <select
                            className="st-input"
                            value={vpBrandPaletteId}
                            onChange={e => setVpBrandPaletteId(e.target.value)}
                            style={{ width: '100%', marginBottom: '1.5rem', cursor: 'pointer' }}
                        >
                            <option value="">None (Auto-Extract)</option>
                            {brandPalettes.map(p => (
                                <option key={p.id} value={p.id}>{p.name} ({p.colors.length} colors)</option>
                            ))}
                        </select>

                        <button
                            className="st-btn primary"
                            onClick={reduceColors}
                            disabled={!uploaded || isVpReducing}
                            style={{ width: '100%' }}
                        >
                            {isVpReducing ? 'Reducing...' : `Reduce & Match (10 cr)`}
                        </button>

                        {/* Layer Export buttons — show after reduction */}
                        {vpPalette.length > 0 && (
                            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                                <button
                                    className="st-btn"
                                    onClick={() => exportLayers('zip')}
                                    disabled={!!layerExportLoading}
                                    style={{ flex: 1, fontSize: '0.8rem', padding: '0.5rem' }}
                                >
                                    <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={13} />
                                    {layerExportLoading === 'zip' ? '...' : 'Layers ZIP'}
                                </button>
                                <button
                                    className="st-btn"
                                    onClick={() => exportLayers('tiff')}
                                    disabled={!!layerExportLoading}
                                    style={{ flex: 1, fontSize: '0.8rem', padding: '0.5rem' }}
                                >
                                    <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={13} />
                                    {layerExportLoading === 'tiff' ? '...' : 'Layers TIFF'}
                                </button>
                            </div>
                        )}
                        {vpPalette.length > 0 && (
                            <div style={{ marginTop: '1.5rem' }}>
                                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: 'var(--text)' }}>Matched Palette</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {vpPalette.map((color, idx) => (
                                        <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.5rem', backgroundColor: 'var(--bg)', borderRadius: '8px' }}>
                                            <span style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundColor: color.hex, border: '1px solid var(--border)', flexShrink: 0 }}></span>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text)' }}>{color.hex.toUpperCase()}</span>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{(color.weight * 100).toFixed(1)}%</span>
                                                </div>
                                                {color.pantoneMatches && color.pantoneMatches.length > 0 && (
                                                    <div style={{ marginTop: '0.25rem' }}>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                                                            {color.pantoneMatches[0].name}
                                                        </span>
                                                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                                                            ΔE {color.pantoneMatches[0].deltaE}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Preview */}
                    <div style={{ flex: '2 1 400px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {vpReducedUrl ? (
                            <div style={{ backgroundColor: 'var(--card-bg)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                                <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Quantized Result ({vpNumColors} colors)</h3>
                                <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', backgroundColor: 'var(--bg)', borderRadius: '8px', overflow: 'hidden' }}>
                                    <img src={`${API}${vpReducedUrl}`} alt="Quantized" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                </div>
                                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                                    <a href={`${API}${vpReducedUrl}`} onClick={(e) => forceDownload(e, `${API}${vpReducedUrl}`)} className="st-dl-btn">
                                        <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={16} /> Download
                                    </a>
                                </div>
                            </div>
                        ) : uploaded ? (
                            <div style={{ backgroundColor: 'var(--card-bg)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                                <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Original Artwork</h3>
                                <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', backgroundColor: 'var(--bg)', borderRadius: '8px', overflow: 'hidden' }}>
                                    <img src={preview} alt="Original" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: '16px' }}>
                                Upload an image to start reducing colors
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* Pantone Lookup Tab */
                <div style={{ maxWidth: '600px' }}>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Pantone Color Lookup</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                            Enter any hex color to find the closest Pantone TCX matches using Delta-E 2000 perceptual distance.
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
                            <input
                                type="color"
                                value={vpLookupHex}
                                onChange={(e) => setVpLookupHex(e.target.value)}
                                style={{ width: '48px', height: '40px', padding: 0, border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                            />
                            <input
                                type="text"
                                value={vpLookupHex}
                                onChange={(e) => setVpLookupHex(e.target.value)}
                                placeholder="#ff6f61"
                                className="st-input"
                                style={{ flex: 1, fontFamily: 'monospace' }}
                            />
                            <button
                                className="st-btn primary"
                                onClick={() => lookupPantone(vpLookupHex)}
                                disabled={isVpLooking || vpLookupHex.length < 4}
                            >
                                {isVpLooking ? '...' : 'Match'}
                            </button>
                        </div>

                        {vpLookupResults.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Top Matches</h4>
                                {vpLookupResults.map((m, idx) => (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg)', borderRadius: '10px', border: idx === 0 ? '2px solid var(--primary)' : '1px solid var(--border)' }}>
                                        <span style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: m.hex, border: '1px solid var(--border)', flexShrink: 0 }}></span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>{m.name}</div>
                                            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.2rem' }}>
                                                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{m.hex.toUpperCase()}</span>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>RGB({m.rgb.join(', ')})</span>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: m.deltaE < 5 ? '#22c55e' : m.deltaE < 10 ? '#eab308' : '#ef4444' }}>
                                                {m.deltaE}
                                            </div>
                                            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>ΔE 2000</div>
                                        </div>
                                    </div>
                                ))}
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.5rem 0 0 0' }}>
                                    ΔE {'<'} 2 = imperceptible · ΔE {'<'} 5 = close match · ΔE {'>'} 10 = different color
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
