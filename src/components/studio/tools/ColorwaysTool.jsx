import React, { useState } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

export default function ColorwaysTool({ uploaded, preview, activeProject, user, controls, setError, addBgTask, updateCreditsFromResponse }) {
    // ===== LOCAL STATE =====
    const [cwExtractedPalette, setCwExtractedPalette] = useState([]);
    const [cwTargetPalette, setCwTargetPalette] = useState([]);
    const [cwUrl, setCwUrl] = useState(null);
    const [isCwExtracting, setIsCwExtracting] = useState(false);
    const [isCwRecoloring, setIsCwRecoloring] = useState(false);
    const [cwVariations, setCwVariations] = useState([]);

    // ===== HANDLERS =====
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

    // ===== RENDER =====
    return (
        <div className="st-tool-content st-colorways">
            <div className="st-canvas-container" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>

                <div className="st-panel st-panel-left" style={{ flex: '1 1 300px', maxWidth: '400px', backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '1.5rem', color: 'var(--text)' }}>Color Palette</h3>

                    {!cwExtractedPalette.length ? (
                        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>Extract colors from your uploaded image to get started.</p>
                            <button
                                className="st-btn primary"
                                onClick={extractColors}
                                disabled={!uploaded || isCwExtracting}
                                style={{ width: '100%' }}
                            >
                                {isCwExtracting ? 'Extracting...' : 'Extract Colors'}
                            </button>
                        </div>
                    ) : (
                        <div className="st-cw-palette-editor">
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>Color Mapping</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {cwTargetPalette.map((mapping, idx) => (
                                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                                <span style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: mapping.old, border: '1px solid var(--border)' }}></span>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{mapping.old}</span>
                                            </div>
                                            <I d="M14 5l7 7m0 0l-7 7m7-7H3" s={14} />
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                                <input
                                                    type="color"
                                                    value={mapping.new}
                                                    onChange={(e) => {
                                                        const newPalette = [...cwTargetPalette];
                                                        newPalette[idx].new = e.target.value;
                                                        setCwTargetPalette(newPalette);
                                                    }}
                                                    style={{ width: '30px', height: '30px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                                />
                                                <input
                                                    type="text"
                                                    value={mapping.new}
                                                    onChange={(e) => {
                                                        const newPalette = [...cwTargetPalette];
                                                        newPalette[idx].new = e.target.value;
                                                        setCwTargetPalette(newPalette);
                                                    }}
                                                    style={{ width: '70px', fontSize: '0.8rem', fontFamily: 'monospace', padding: '0.25rem', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '4px' }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    className="st-btn"
                                    onClick={() => setCwTargetPalette(cwExtractedPalette.map(p => ({ old: p.hex, new: p.hex })))}
                                    style={{ flex: 1 }}
                                >
                                    Reset
                                </button>
                                <button
                                    className="st-btn primary"
                                    onClick={generateColorway}
                                    disabled={isCwRecoloring}
                                    style={{ flex: 2 }}
                                >
                                    {isCwRecoloring ? 'Generating...' : 'Generate (10 cr)'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="st-panel st-panel-right" style={{ flex: '2 1 500px', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {cwUrl ? (
                        <div className="st-preview-card" style={{ backgroundColor: 'var(--card-bg)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Latest Colorway</h3>
                            <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', backgroundColor: 'var(--bg)', borderRadius: '8px', overflow: 'hidden' }}>
                                <img src={`${API}${cwUrl}`} alt="Recolored" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            </div>
                            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                                <a href={`${API}${cwUrl}`} onClick={(e) => forceDownload(e, `${API}${cwUrl}`)} className="st-dl-btn">
                                    <I d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" s={16} /> Download
                                </a>
                            </div>
                        </div>
                    ) : uploaded ? (
                        <div className="st-preview-card" style={{ backgroundColor: 'var(--card-bg)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Original Artwork</h3>
                            <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', backgroundColor: 'var(--bg)', borderRadius: '8px', overflow: 'hidden' }}>
                                <img src={preview} alt="Original" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: '16px' }}>
                            Upload an image to start recoloring
                        </div>
                    )}

                    {cwVariations.length > 0 && (
                        <div className="st-variations-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem' }}>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text)', fontSize: '1.1rem' }}>Recent Variations</h3>
                            </div>
                            {cwVariations.map((v, i) => (
                                <div key={i} style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => { setCwUrl(v.url); setCwTargetPalette([...v.targetPalette]); }}>
                                    <img src={`${API}${v.url}`} alt={`Variation ${i}`} style={{ width: '100%', display: 'block', aspectRatio: '1/1', objectFit: 'cover' }} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
