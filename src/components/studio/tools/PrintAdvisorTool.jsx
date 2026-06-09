import React, { useState } from 'react';
import { I } from '../shared/StudioIcons';
import { API, apiFetch } from '../shared/helpers';

export default function PrintAdvisorTool({ uploaded, preview, activeProject, user, controls, setError, currentToken }) {
    // ===== LOCAL STATE =====
    const [printAdvisorResult, setPrintAdvisorResult] = useState(null);
    const [isPrintAdvisorLoading, setIsPrintAdvisorLoading] = useState(false);
    const [printAdvisorFabric, setPrintAdvisorFabric] = useState('cotton');
    const [printAdvisorVolume, setPrintAdvisorVolume] = useState(500);

    // ===== HANDLERS =====
    const analyzePrintMethod = async () => {
        if (!uploaded) return;
        setIsPrintAdvisorLoading(true);
        setPrintAdvisorResult(null);
        setError('');
        try {
            const d = await apiFetch(`${API}/api/print-advisor`, {
                method: 'POST',
                token: currentToken,
                body: JSON.stringify({
                    filename: uploaded.filename,
                    fabricType: printAdvisorFabric,
                    productionVolume: printAdvisorVolume,
                    projectId: activeProject.id,
                }),
            });
            if (d.success) {
                setPrintAdvisorResult(d.analysis);
            } else {
                throw new Error(d.error || 'Analysis failed');
            }
        } catch (e) {
            setError(e.message || 'Print analysis failed');
        } finally {
            setIsPrintAdvisorLoading(false);
        }
    };

    // ===== RENDER =====
    const fabricTypes = [
        { id: 'cotton', label: 'Cotton', icon: '🌿' },
        { id: 'polyester', label: 'Polyester', icon: '🧵' },
        { id: 'silk', label: 'Silk', icon: '✨' },
        { id: 'linen', label: 'Linen', icon: '🌾' },
        { id: 'nylon', label: 'Nylon', icon: '🔗' },
        { id: 'rayon', label: 'Rayon', icon: '💧' },
    ];
    const methodColors = {
        'Screen Printing': '#22c55e',
        'Digital Printing': '#3b82f6',
        'Rotary Printing': '#f59e0b',
        'Sublimation': '#a855f7',
        'Block Printing': '#ec4899',
        'Discharge Printing': '#14b8a6',
    };

    return (
        <div className="st-tool-content" style={{ maxWidth: '1100px', margin: '0 auto' }}>
            {/* Configuration */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <div className="st-group-title">FABRIC TYPE</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginTop: '0.75rem' }}>
                        {fabricTypes.map(f => (
                            <button key={f.id} className={`st-btn ${printAdvisorFabric === f.id ? 'primary' : ''}`}
                                onClick={() => setPrintAdvisorFabric(f.id)}
                                style={{ flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 0.5rem', fontSize: '0.8rem' }}>
                                <span style={{ fontSize: '1.2rem' }}>{f.icon}</span>{f.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <div className="st-group-title">PRODUCTION VOLUME</div>
                    <div style={{ marginTop: '0.75rem' }}>
                        <label className="st-label">Estimated yards/meters</label>
                        <input type="number" value={printAdvisorVolume} onChange={e => setPrintAdvisorVolume(Math.max(1, parseInt(e.target.value) || 0))}
                            style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: 'var(--bg)', color: 'var(--text)', fontSize: '1rem' }} />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                            {[50, 200, 500, 1000, 5000, 10000].map(v => (
                                <button key={v} className={`st-btn ${printAdvisorVolume === v ? 'primary' : ''}`}
                                    onClick={() => setPrintAdvisorVolume(v)} style={{ fontSize: '0.75rem', padding: '0.4rem 0.75rem' }}>
                                    {v.toLocaleString()}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button className="st-btn primary" onClick={analyzePrintMethod}
                        disabled={!uploaded || isPrintAdvisorLoading}
                        style={{ width: '100%', marginTop: '1.25rem', padding: '0.85rem', fontWeight: 600, fontSize: '0.9rem' }}>
                        {isPrintAdvisorLoading ? <><div className="st-spinner" style={{ width: 16, height: 16 }} /> Analyzing Pattern...</> : <><I d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" s={16} /> Analyze Print Method</>}
                    </button>
                </div>
            </div>

            {/* Results */}
            {printAdvisorResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Pattern Analysis Summary */}
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
                        <div className="st-group-title">PATTERN ANALYSIS</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1rem' }}>
                            {[
                                ['Colors', printAdvisorResult.colorCount, printAdvisorResult.colorCount <= 8 ? '#22c55e' : printAdvisorResult.colorCount <= 16 ? '#f59e0b' : '#ef4444'],
                                ['Detail', printAdvisorResult.detailLevel, '#3b82f6'],
                                ['Gradients', printAdvisorResult.hasGradients ? 'Yes' : 'No', printAdvisorResult.hasGradients ? '#f59e0b' : '#22c55e'],
                                ['Min Feature', `${printAdvisorResult.minFeatureSize}px`, '#a855f7'],
                            ].map(([label, value, color]) => (
                                <div key={label} style={{ textAlign: 'center', padding: '1rem', borderRadius: '12px', background: `${color}15`, border: `1px solid ${color}30` }}>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{label}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Recommendations */}
                    <div className="st-group-title" style={{ marginBottom: '-0.5rem' }}>RECOMMENDED PRINT METHODS</div>
                    {printAdvisorResult.recommendations?.map((rec, i) => (
                        <div key={rec.method} style={{
                            backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '16px',
                            border: i === 0 ? `2px solid ${methodColors[rec.method] || '#3b82f6'}` : '1px solid var(--border)',
                            position: 'relative'
                        }}>
                            {i === 0 && <div style={{ position: 'absolute', top: '-10px', left: '1rem', backgroundColor: methodColors[rec.method] || '#3b82f6', color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '2px 10px', borderRadius: '10px', textTransform: 'uppercase' }}>Best Match</div>}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                        <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>{rec.method}</span>
                                        <div style={{ backgroundColor: `${methodColors[rec.method] || '#3b82f6'}20`, color: methodColors[rec.method] || '#3b82f6', padding: '2px 8px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600 }}>
                                            Score: {rec.score}/100
                                        </div>
                                    </div>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.5rem 0', lineHeight: 1.5 }}>{rec.reasoning}</p>
                                </div>
                                <div style={{ textAlign: 'right', minWidth: '140px' }}>
                                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: methodColors[rec.method] || '#3b82f6' }}>{rec.costEstimate}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>per yard est.</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Min: {rec.minOrder}</div>
                                </div>
                            </div>
                            {/* Progress bar */}
                            <div style={{ marginTop: '0.75rem', height: '6px', borderRadius: '3px', backgroundColor: 'var(--bg)', overflow: 'hidden' }}>
                                <div style={{ width: `${rec.score}%`, height: '100%', borderRadius: '3px', backgroundColor: methodColors[rec.method] || '#3b82f6', transition: 'width 0.5s ease' }} />
                            </div>
                            {rec.filePrep && (
                                <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '10px', backgroundColor: 'var(--bg)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    <strong style={{ color: 'var(--text)' }}>File Prep:</strong> {rec.filePrep}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
