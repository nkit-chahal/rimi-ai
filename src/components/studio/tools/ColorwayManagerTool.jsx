import React, { useState } from 'react';
import I from '../shared/StudioIcons';
import { API } from '../shared/helpers';

const ColorwayManagerTool = ({
    uploaded,
    activeProject,
    user,
    updateCreditsFromResponse,
    setError,
    forceDownload
}) => {
    // ===== COLORWAY MANAGER STATES =====
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
            const res = await fetch(`${API}/api/extract-palette`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: uploaded.filename, numColors: 6 }),
            });
            const d = await res.json();
            if (d.success) {
                setCwmPalette(d.palette);
                setCwmColorways([]);
                setCwmLockedColors(new Set());
            }
        } catch (e) {
            setError('Failed to extract palette');
        } finally {
            setIsCwmGenerating(false);
        }
    };

    const cwmGenerateColorways = async () => {
        if (!uploaded || cwmPalette.length === 0) return;
        setIsCwmGenerating(true);
        setError('');
        try {
            const res = await fetch(`${API}/api/colorways/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    palette: cwmPalette.map(p => p.hex),
                    lockedIndices: Array.from(cwmLockedColors),
                    strategy: cwmStrategy,
                    count: 4,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
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

    const strategies = [
        { id: 'complementary', label: 'Complementary', desc: 'Opposite colors on the wheel' },
        { id: 'analogous', label: 'Analogous', desc: 'Adjacent colors, harmonious' },
        { id: 'triadic', label: 'Triadic', desc: 'Three evenly spaced colors' },
        { id: 'monochrome', label: 'Monochrome', desc: 'Variations of a single hue' },
        { id: 'seasonal_warm', label: 'Warm Season', desc: 'Autumn/spring warm palette' },
        { id: 'seasonal_cool', label: 'Cool Season', desc: 'Winter/summer cool palette' },
    ];

    return (
        <div className="st-tool-content" style={{ maxWidth: '1200px', margin: '0 auto' }}>
            {/* Palette Extraction */}
            {cwmPalette.length === 0 ? (
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '2.5rem', borderRadius: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎨</div>
                    <h3 style={{ color: 'var(--text)', margin: '0 0 0.5rem 0' }}>Extract Base Palette</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Upload a pattern above, then extract its color palette to generate production colorways.</p>
                    <button className="st-btn primary" onClick={cwmExtractPalette} disabled={!uploaded || isCwmGenerating}
                        style={{ padding: '0.85rem 2rem', fontWeight: 600 }}>
                        {isCwmGenerating ? <><div className="st-spinner" style={{ width: 16, height: 16 }} /> Extracting...</> : 'Extract Palette from Image'}
                    </button>
                </div>
            ) : (
                <>
                    {/* Base Palette + Lock Controls */}
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <div className="st-group-title" style={{ margin: 0 }}>BASE PALETTE</div>
                            <button className="st-btn" onClick={cwmExtractPalette} style={{ fontSize: '0.75rem' }}>Re-extract</button>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            {cwmPalette.map((c, i) => (
                                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
                                    <div style={{ width: '56px', height: '56px', borderRadius: '12px', backgroundColor: c.hex, border: '2px solid var(--border)', cursor: 'pointer', position: 'relative' }}
                                        title={`${c.hex} (${(c.weight * 100).toFixed(1)}%)`}>
                                        {cwmLockedColors.has(i) && (
                                            <div style={{ position: 'absolute', top: '-6px', right: '-6px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <I d="M12 17v-2m-4 4h8m-4-14a4 4 0 014 4v2a2 2 0 01-2 2H10a2 2 0 01-2-2V9a4 4 0 014-4z" s={10} />
                                            </div>
                                        )}
                                    </div>
                                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{c.hex}</span>
                                    <button className="st-btn" onClick={() => setCwmLockedColors(prev => {
                                        const next = new Set(prev);
                                        next.has(i) ? next.delete(i) : next.add(i);
                                        return next;
                                    })} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                                        {cwmLockedColors.has(i) ? '🔒 Locked' : '🔓 Lock'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Strategy Picker */}
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)', marginBottom: '1.25rem' }}>
                        <div className="st-group-title">COLOR STRATEGY</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginTop: '0.75rem' }}>
                            {strategies.map(s => (
                                <button key={s.id} className={`st-btn ${cwmStrategy === s.id ? 'primary' : ''}`}
                                    onClick={() => setCwmStrategy(s.id)}
                                    style={{ flexDirection: 'column', gap: '0.15rem', padding: '0.75rem', textAlign: 'left', alignItems: 'flex-start' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{s.label}</span>
                                    <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{s.desc}</span>
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                            <button className="st-btn primary" onClick={cwmGenerateColorways} disabled={isCwmGenerating}
                                style={{ flex: 1, padding: '0.85rem', fontWeight: 600 }}>
                                {isCwmGenerating ? <><div className="st-spinner" style={{ width: 16, height: 16 }} /> Generating...</> : '🎨 Generate 4 Colorways'}
                            </button>
                            {cwmColorways.length > 0 && (
                                <button className="st-btn" onClick={cwmExportLineCard} disabled={isCwmExporting}
                                    style={{ padding: '0.85rem 1.5rem' }}>
                                    {isCwmExporting ? 'Exporting...' : '📄 Export Line Card PDF'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Generated Colorways Grid */}
                    {cwmColorways.length > 0 && (
                        <div>
                            <div className="st-group-title">GENERATED COLORWAYS</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem', marginTop: '0.75rem' }}>
                                {cwmColorways.map((cw, i) => (
                                    <div key={i} style={{ backgroundColor: 'var(--card-bg)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                        {cw.resultUrl && (
                                            <div style={{ aspectRatio: '1', overflow: 'hidden' }}>
                                                <img src={`${API}${cw.resultUrl}`} alt={`Colorway ${i + 1}`}
                                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            </div>
                                        )}
                                        <div style={{ padding: '1rem' }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)', marginBottom: '0.5rem' }}>
                                                Colorway {i + 1} — {cw.strategy || cwmStrategy}
                                            </div>
                                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                {cw.colors?.map((hex, j) => (
                                                    <div key={j} style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: hex, border: '1px solid var(--border)' }} title={hex} />
                                                ))}
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                                {cw.resultUrl && <button className="st-btn" onClick={(e) => forceDownload(e, `${API}${cw.resultUrl}`)} style={{ fontSize: '0.75rem', flex: 1 }}>Download</button>}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ColorwayManagerTool;
