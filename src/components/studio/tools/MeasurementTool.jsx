import React, { useState } from 'react';
import I from '../shared/StudioIcons';
import { API } from '../shared/helpers';

export default function MeasurementTool({ uploaded, preview, controls }) {
    const [measureUnit, setMeasureUnit] = useState('inches');
    const [measureDpi, setMeasureDpi] = useState(300);
    const [measureShowRuler, setMeasureShowRuler] = useState(true);
    const [measureShowGrid, setMeasureShowGrid] = useState(false);

    const imgWidth = uploaded ? (uploaded.width || 1024) : 1024;
    const imgHeight = uploaded ? (uploaded.height || 1024) : 1024;
    const pxPerUnit = measureUnit === 'inches' ? measureDpi : measureDpi / 2.54;
    const realWidth = (imgWidth / pxPerUnit).toFixed(2);
    const realHeight = (imgHeight / pxPerUnit).toFixed(2);
    const repeatWidth = (controls.printWidth || 12);
    const scaleFactor = (controls.scale || 100) / 100;
    const effectiveRepeatW = (repeatWidth * scaleFactor).toFixed(2);
    const motifsPerYard = measureUnit === 'inches' ? (36 / parseFloat(realHeight)).toFixed(1) : ((91.44 / 2.54) / parseFloat(realHeight)).toFixed(1);

    return (
        <div className="st-tool-content" style={{ maxWidth: '1100px', margin: '0 auto' }}>
            {/* Settings */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <div className="st-group-title">UNITS</div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        {['inches', 'cm'].map(u => (
                            <button key={u} className={`st-btn ${measureUnit === u ? 'primary' : ''}`}
                                onClick={() => setMeasureUnit(u)} style={{ flex: 1, textTransform: 'capitalize' }}>{u}</button>
                        ))}
                    </div>
                </div>
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <div className="st-group-title">DPI</div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        {[72, 150, 300, 600].map(d => (
                            <button key={d} className={`st-btn ${measureDpi === d ? 'primary' : ''}`}
                                onClick={() => setMeasureDpi(d)} style={{ flex: 1, fontSize: '0.8rem' }}>{d}</button>
                        ))}
                    </div>
                </div>
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <div className="st-group-title">OVERLAYS</div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button className={`st-btn ${measureShowRuler ? 'primary' : ''}`} onClick={() => setMeasureShowRuler(!measureShowRuler)} style={{ flex: 1, fontSize: '0.8rem' }}>📏 Ruler</button>
                        <button className={`st-btn ${measureShowGrid ? 'primary' : ''}`} onClick={() => setMeasureShowGrid(!measureShowGrid)} style={{ flex: 1, fontSize: '0.8rem' }}>📐 Grid</button>
                    </div>
                </div>
            </div>

            {/* Dimensions Display */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    ['Tile Width', `${realWidth} ${measureUnit}`, '#3b82f6', `${imgWidth}px`],
                    ['Tile Height', `${realHeight} ${measureUnit}`, '#22c55e', `${imgHeight}px`],
                    ['Print Width', `${effectiveRepeatW} ${measureUnit}`, '#f59e0b', `Scale: ${controls.scale}%`],
                    ['Repeats/Yard', motifsPerYard, '#a855f7', 'vertical repeats'],
                ].map(([label, value, color, sub]) => (
                    <div key={label} style={{ backgroundColor: 'var(--card-bg)', padding: '1.25rem', borderRadius: '16px', border: `1px solid ${color}30`, textAlign: 'center' }}>
                        <div style={{ fontSize: '1.8rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', marginTop: '0.5rem' }}>{label}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{sub}</div>
                    </div>
                ))}
            </div>

            {/* Visual Preview with Rulers */}
            <div style={{ backgroundColor: 'var(--card-bg)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', position: 'relative' }}>
                {/* Top ruler */}
                {measureShowRuler && (
                    <div style={{ height: '28px', backgroundColor: 'var(--bg)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-end', paddingLeft: '28px', overflow: 'hidden' }}>
                        {Array.from({ length: Math.ceil(parseFloat(realWidth)) + 1 }, (_, i) => (
                            <div key={i} style={{ position: 'relative', flex: `0 0 ${100 / (parseFloat(realWidth) || 1)}%`, borderLeft: '1px solid var(--text-muted)', height: '100%' }}>
                                <span style={{ position: 'absolute', top: '2px', left: '4px', fontSize: '0.6rem', color: 'var(--text-muted)' }}>{i}</span>
                            </div>
                        ))}
                    </div>
                )}
                <div style={{ display: 'flex' }}>
                    {/* Left ruler */}
                    {measureShowRuler && (
                        <div style={{ width: '28px', backgroundColor: 'var(--bg)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                            {Array.from({ length: Math.ceil(parseFloat(realHeight)) + 1 }, (_, i) => (
                                <div key={i} style={{ position: 'relative', flex: `0 0 ${100 / (parseFloat(realHeight) || 1)}%`, borderTop: '1px solid var(--text-muted)' }}>
                                    <span style={{ position: 'absolute', top: '2px', left: '3px', fontSize: '0.6rem', color: 'var(--text-muted)', writingMode: 'vertical-rl' }}>{i}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {/* Image with grid overlay */}
                    <div style={{ flex: 1, position: 'relative', minHeight: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                        {preview ? (
                            <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '500px' }}>
                                <img src={preview.startsWith('http') ? preview : preview.startsWith('/') ? `${API}${preview}` : preview} alt="Pattern"
                                    style={{ maxWidth: '100%', maxHeight: '500px', objectFit: 'contain', borderRadius: '8px' }} />
                                {measureShowGrid && (
                                    <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent calc(100% / ${controls.gridSize || 2} - 1px), rgba(255,255,255,0.15) calc(100% / ${controls.gridSize || 2} - 1px), rgba(255,255,255,0.15) calc(100% / ${controls.gridSize || 2})), repeating-linear-gradient(90deg, transparent, transparent calc(100% / ${controls.gridSize || 2} - 1px), rgba(255,255,255,0.15) calc(100% / ${controls.gridSize || 2} - 1px), rgba(255,255,255,0.15) calc(100% / ${controls.gridSize || 2}))`, pointerEvents: 'none', borderRadius: '8px' }} />
                                )}
                            </div>
                        ) : (
                            <div className="st-empty-canvas"><p>Upload an image to see measurements</p></div>
                        )}
                    </div>
                </div>
            </div>

            {/* Production Warnings */}
            {uploaded && (
                <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {measureDpi < 150 && (
                        <div style={{ padding: '0.75rem 1rem', borderRadius: '12px', backgroundColor: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: '0.85rem' }}>
                            ⚠️ <strong>Low DPI Warning:</strong> {measureDpi} DPI is below the minimum for production printing (150 DPI). Consider upscaling your image.
                        </div>
                    )}
                    {parseFloat(realWidth) < 2 && (
                        <div style={{ padding: '0.75rem 1rem', borderRadius: '12px', backgroundColor: '#f59e0b20', border: '1px solid #f59e0b40', color: '#f59e0b', fontSize: '0.85rem' }}>
                            ⚠️ <strong>Small Tile:</strong> Your tile is only {realWidth} {measureUnit} wide. Most fabric prints need at least 4-6 inches for visible motif detail.
                        </div>
                    )}
                    {measureDpi >= 300 && parseFloat(realWidth) >= 4 && (
                        <div style={{ padding: '0.75rem 1rem', borderRadius: '12px', backgroundColor: '#22c55e20', border: '1px solid #22c55e40', color: '#22c55e', fontSize: '0.85rem' }}>
                            ✅ <strong>Print Ready:</strong> Resolution and dimensions meet production quality requirements.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
