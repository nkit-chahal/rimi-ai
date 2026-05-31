import React, { useState, lazy, Suspense as ReactSuspense } from 'react';
import { I } from '../shared/StudioIcons';
import { API } from '../shared/helpers';

const GarmentPreview3D = lazy(() => import('../../GarmentPreview3D'));

export default function Mockup3DTool({ preview }) {
    const [mockup3dGarment, setMockup3dGarment] = useState('tshirt');
    const [mockup3dTileX, setMockup3dTileX] = useState(4);
    const [mockup3dTileY, setMockup3dTileY] = useState(4);
    const [mockup3dAutoRotate, setMockup3dAutoRotate] = useState(true);

    const garments = [
        { id: 'tshirt', label: 'T-Shirt', icon: 'M20.38 3.46L16 2 12 3.5 8 2 3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47c.06.37.29.68.62.84L8 12v8a1 1 0 001 1h6a1 1 0 001-1v-8l4.52-2a1 1 0 00.62-.84l.58-3.47a2 2 0 00-1.34-2.23z' },
        { id: 'dress', label: 'Dress', icon: 'M6.5 2h11l1 4H19l-3 14H8L5 6h.5l1-4zM12 2v4' },
        { id: 'totebag', label: 'Tote Bag', icon: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0' },
    ];

    return (
        <div className="st-tool-content" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', height: '100%' }}>
            {/* Controls panel */}
            <div style={{ flex: '1 1 260px', maxWidth: '320px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Garment Type</h3>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {garments.map(g => (
                            <button
                                key={g.id}
                                className={`st-btn ${mockup3dGarment === g.id ? 'primary' : ''}`}
                                onClick={() => setMockup3dGarment(g.id)}
                                style={{ flex: 1, flexDirection: 'column', gap: '0.3rem', padding: '0.75rem 0.5rem' }}
                            >
                                <I d={g.icon} s={20} />
                                <span style={{ fontSize: '0.75rem' }}>{g.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Pattern Tiling</h3>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Horizontal Repeat: <strong style={{ color: 'var(--text)' }}>{mockup3dTileX}x</strong>
                    </label>
                    <input type="range" min={1} max={8} step={1} value={mockup3dTileX}
                        onChange={e => setMockup3dTileX(Number(e.target.value))}
                        style={{ width: '100%', marginBottom: '1rem', accentColor: 'var(--primary)' }}
                    />
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Vertical Repeat: <strong style={{ color: 'var(--text)' }}>{mockup3dTileY}x</strong>
                    </label>
                    <input type="range" min={1} max={8} step={1} value={mockup3dTileY}
                        onChange={e => setMockup3dTileY(Number(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--primary)' }}
                    />
                </div>

                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text)' }}>
                        <input type="checkbox" checked={mockup3dAutoRotate} onChange={e => setMockup3dAutoRotate(e.target.checked)}
                            style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }}
                        />
                        Auto-Rotate
                    </label>
                    <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Drag to rotate manually · Scroll to zoom
                    </p>
                </div>
            </div>

            {/* 3D Canvas */}
            <div style={{ flex: '2 1 400px', backgroundColor: 'var(--card-bg)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', minHeight: '500px', position: 'relative' }}>
                {preview ? (
                    <ReactSuspense fallback={
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                            <div className="st-spinner" style={{ marginRight: '0.75rem' }} /> Loading 3D engine...
                        </div>
                    }>
                        <GarmentPreview3D
                            patternUrl={preview}
                            garmentType={mockup3dGarment}
                            tileX={mockup3dTileX}
                            tileY={mockup3dTileY}
                            autoRotate={mockup3dAutoRotate}
                        />
                    </ReactSuspense>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '1rem', padding: '2rem', textAlign: 'center' }}>
                        <I d="M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" s={48} />
                        <p>Upload a pattern image to see it applied to a 3D garment mockup</p>
                    </div>
                )}
            </div>
        </div>
    );
}
