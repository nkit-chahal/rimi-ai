import React, { useState, useEffect } from 'react';
import { I } from '../shared/StudioIcons';
import { API } from '../shared/helpers';

export default function LibraryTool(props) {
    const {
        uploaded, preview, activeProject, user, controls, setError, addBgTask, updateCreditsFromResponse,
        setUploads, tool, currentToken, state
    } = props;

    const [newPaletteName, setNewPaletteName] = useState('');
    const [newPaletteColors, setNewPaletteColors] = useState(['#4f46e5', '#ec4899', '#f59e0b']);
    const [isSavingPalette, setIsSavingPalette] = useState(false);
    const [brandPalettesLoading, setBrandPalettesLoading] = useState(true);
    const [brandPalettes, setBrandPalettes] = useState([]);

    useEffect(() => {
        const fetchPalettes = async () => {
            setBrandPalettesLoading(true);
            try {
                const res = await fetch(`${API}/api/brand-palettes`, {
                    headers: { ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}) },
                });
                const data = await res.json();
                if (res.ok && data.palettes) setBrandPalettes(data.palettes);
            } catch (err) {
                // Palettes failed to load, leave empty
            } finally {
                setBrandPalettesLoading(false);
            }
        };
        fetchPalettes();
    }, [currentToken]);

    const saveBrandPalette = async () => {
        if (!newPaletteName.trim() || isSavingPalette) return;
        setIsSavingPalette(true);
        try {
            const res = await fetch(`${API}/api/brand-palettes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
                },
                body: JSON.stringify({ name: newPaletteName, colors: newPaletteColors }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            setBrandPalettes(prev => [...prev, data.palette || { id: Date.now(), name: newPaletteName, colors: newPaletteColors }]);
            setNewPaletteName('');
            setNewPaletteColors(['#4f46e5', '#ec4899', '#f59e0b']);
        } catch (err) {
            setError(err.message || 'Failed to save palette');
        } finally {
            setIsSavingPalette(false);
        }
    };

    const deleteBrandPalette = async (id) => {
        try {
            await fetch(`${API}/api/brand-palettes/${id}`, {
                method: 'DELETE',
                headers: { ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}) },
            });
            setBrandPalettes(prev => prev.filter(p => p.id !== id));
        } catch (err) {
            setError(err.message || 'Failed to delete palette');
        }
    };

    
    return (
        <>


                <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text)', marginBottom: '1.5rem' }}>Brand Library</h2>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem', alignItems: 'start' }}>
                        {/* Left: Palette Builder */}
                        <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Create New Palette</h3>

                            <label className="st-label-sm">Palette Name</label>
                            <input
                                type="text"
                                className="st-input"
                                value={newPaletteName}
                                onChange={e => setNewPaletteName(e.target.value)}
                                placeholder="e.g. Summer Core 2026"
                                style={{ width: '100%', marginBottom: '1rem' }}
                            />

                            <label className="st-label-sm">Colors</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                                {newPaletteColors.map((col, i) => (
                                    <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <input
                                            type="color"
                                            value={col}
                                            onChange={e => {
                                                const newCols = [...newPaletteColors];
                                                newCols[i] = e.target.value;
                                                setNewPaletteColors(newCols);
                                            }}
                                            style={{ width: '40px', height: '40px', padding: 0, border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                                        />
                                        <input
                                            type="text"
                                            className="st-input"
                                            value={col}
                                            onChange={e => {
                                                const newCols = [...newPaletteColors];
                                                newCols[i] = e.target.value;
                                                setNewPaletteColors(newCols);
                                            }}
                                            style={{ flex: 1, fontFamily: 'monospace' }}
                                        />
                                        {newPaletteColors.length > 1 && (
                                            <button
                                                className="st-icon-btn"
                                                onClick={() => setNewPaletteColors(newPaletteColors.filter((_, idx) => idx !== i))}
                                                style={{ color: '#ef4444' }}
                                            >
                                                <I d="M6 18L18 6M6 6l12 12" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <button
                                className="st-btn"
                                onClick={() => setNewPaletteColors([...newPaletteColors, '#cccccc'])}
                                style={{ width: '100%', marginBottom: '1.5rem', border: '1px dashed var(--border)' }}
                            >
                                + Add Color
                            </button>

                            <button
                                className="st-btn primary"
                                onClick={saveBrandPalette}
                                disabled={isSavingPalette || !newPaletteName.trim()}
                                style={{ width: '100%' }}
                            >
                                {isSavingPalette ? 'Saving...' : 'Save Palette'}
                            </button>
                        </div>

                        {/* Right: Saved Palettes */}
                        <div>
                            <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Saved Palettes</h3>
                            {brandPalettesLoading ? (
                                <p>Loading palettes...</p>
                            ) : brandPalettes.length === 0 ? (
                                <div className="st-empty-canvas" style={{ minHeight: '200px' }}>
                                    <span className="st-empty-icon" style={{ fontSize: '2rem' }}>🎨</span>
                                    <p>No brand palettes saved yet.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {brandPalettes.map(p => (
                                        <div key={p.id} style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                                <h4 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text)' }}>{p.name}</h4>
                                                <button className="st-icon-btn" onClick={() => deleteBrandPalette(p.id)} style={{ color: '#ef4444' }}>
                                                    <I d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </button>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                {p.colors.map((c, i) => (
                                                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                                                        <div style={{ width: '50px', height: '50px', borderRadius: '8px', backgroundColor: c, border: '1px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}></div>
                                                        <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{c.toUpperCase()}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            
        </>
    );
}
