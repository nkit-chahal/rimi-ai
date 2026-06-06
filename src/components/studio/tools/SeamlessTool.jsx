import React, { useState, useEffect } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';

export default function SeamlessTool({ uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse }) {
    // Local state
    const [seamlessMode, setSeamlessMode] = useState('generate');
    const [seamlessPrompt, setSeamlessPrompt] = useState('');
    const [seamlessTiles, setSeamlessTiles] = useState([]);
    const [seamlessUrl, setSeamlessUrl] = useState(null);
    const [isSeamless, setIsSeamless] = useState(false);
    const [seamlessProgress, setSeamlessProgress] = useState(0);
    const [seamlessStatus, setSeamlessStatus] = useState('');
    const [isDrag, setIsDrag] = useState(false);

    const fileRef = React.useRef(null);

    // Progress simulation
    useEffect(() => {
        if (isSeamless) {
            setSeamlessProgress(0);
            setSeamlessStatus('Assessing seams...');
            const startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                let progress = 0, status = '';
                if (elapsed < 2) { progress = (elapsed / 2) * 5; status = 'Assessing seams...'; }
                else if (elapsed < 5) { progress = 5 + ((elapsed - 2) / 3) * 10; status = 'Applying geometric fixes...'; }
                else if (elapsed < 35) { progress = 15 + ((elapsed - 5) / 30) * 40; status = 'Generating AI patches (Tier 1)...'; }
                else if (elapsed < 65) { progress = 55 + ((elapsed - 35) / 30) * 35; status = 'Refining seams (Tier 2)...'; }
                else { progress = 90 + Math.min(9, (elapsed - 65) / 10); status = 'Finalizing guarantee step...'; }
                setSeamlessProgress(Math.min(99, progress));
                setSeamlessStatus(status);
            }, 200);
            return () => clearInterval(interval);
        } else {
            setSeamlessProgress(100);
            setSeamlessStatus('Complete!');
            const t = setTimeout(() => { setSeamlessProgress(0); setSeamlessStatus(''); }, 2000);
            return () => clearTimeout(t);
        }
    }, [isSeamless]);

    // Fix existing tile (offset + inpaint)
    const makeSeamless = async () => {
        const filename = uploaded?.filename;
        if (!filename && !activeProject?.heroImageUrl) return;
        setIsSeamless(true);
        setSeamlessUrl(null);
        setError('');
        const trigger = async () => {
            const res = await fetch(`${API}/api/make-seamless`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: filename || activeProject.heroImageUrl,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                setSeamlessUrl(d.resultUrl.startsWith('http') ? d.resultUrl : `${API}${d.resultUrl}`);
                updateCreditsFromResponse(d);
                setIsSeamless(false);
                return { url: d.resultUrl };
            } else {
                setIsSeamless(false);
                throw new Error(d.error || 'Seamless fix failed');
            }
        };
        addBgTask('seamless', 'Make Seamless', filename || 'hero_image', trigger);
    };

    // Generate new seamless tile from text
    const generateSeamless = async () => {
        if (!seamlessPrompt.trim()) return;
        setIsSeamless(true);
        setSeamlessTiles([]);
        setSeamlessUrl(null);
        setError('');
        const trigger = async () => {
            const res = await fetch(`${API}/api/generate-seamless`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: seamlessPrompt,
                    referenceFilename: uploaded?.filename || null,
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const d = await res.json();
            if (d.success) {
                const tiles = d.tiles || [];
                setSeamlessTiles(tiles);
                if (tiles.length > 0) {
                    setSeamlessUrl(`${API}${tiles[0].url}`);
                }
                updateCreditsFromResponse(d);
                setIsSeamless(false);
                return { url: tiles[0]?.url, urls: tiles.map(t => t.url) };
            } else {
                setIsSeamless(false);
                throw new Error(d.error || 'Generation failed');
            }
        };
        addBgTask('seamless', 'Generate Seamless Tiles', uploaded?.filename || 'text-prompt', trigger);
    };

    const handleUpload = (file) => {
        // Placeholder — parent handles upload via setUploads
    };

    const loading = isSeamless;

    return (
        <>
            <div className="st-pattern-right">
                <div className="st-pattern-right-title">
                    <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z" s={20} />
                    Seamless Pattern
                </div>
                <div className="st-btn-row" style={{ marginBottom: '0.75rem' }}>
                    <button className={`st-grid-btn ${seamlessMode === 'generate' ? 'active' : ''}`} onClick={() => setSeamlessMode('generate')} style={{ flex: 1 }}>✨ Generate New</button>
                    <button className={`st-grid-btn ${seamlessMode === 'fix' ? 'active' : ''}`} onClick={() => setSeamlessMode('fix')} style={{ flex: 1 }}>🔧 Fix Existing</button>
                </div>

                {seamlessMode === 'generate' ? (
                    <>
                        <p className="st-pattern-right-desc" style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                            Generate natively seamless tiles from a text description. Uses AI with circular padding — tiles are seamless by construction.
                        </p>
                        <textarea
                            value={seamlessPrompt}
                            onChange={e => setSeamlessPrompt(e.target.value)}
                            placeholder="Describe the pattern... e.g. 'watercolor roses on cream linen background' or 'geometric art deco gold lines on navy'"
                            style={{ width: '100%', minHeight: '70px', padding: '0.6rem', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit', background: '#f8fafc' }}
                        />
                        {uploaded?.filename && (
                            <p style={{ fontSize: '0.75rem', color: '#6366f1', margin: '0.3rem 0' }}>📎 Reference image will guide the style</p>
                        )}
                    </>
                ) : (
                    <p className="st-pattern-right-desc">
                        Upload a tile and let AI fix the edges using offset + inpaint. Best for images that are almost seamless already.
                    </p>
                )}

                {isSeamless || seamlessProgress > 0 ? (
                    <div style={{ marginTop: '1rem', width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 500 }}>
                            <span>{seamlessStatus}</span>
                            <span>{Math.round(seamlessProgress)}%</span>
                        </div>
                        <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${seamlessProgress}%`, height: '100%', background: '#6366f1', transition: 'width 0.2s linear' }} />
                        </div>
                    </div>
                ) : seamlessMode === 'generate' ? (
                    <button className="st-pattern-right-btn" onClick={generateSeamless} disabled={!seamlessPrompt.trim()} style={{ marginTop: '0.5rem' }}>
                        <I d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" s={16} />
                        Generate Seamless Tiles
                    </button>
                ) : (
                    <button className="st-pattern-right-btn" onClick={makeSeamless} disabled={(!uploaded && !preview && !activeProject?.heroImageUrl)}>
                        <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z" s={16} />
                        Fix Uploaded Tile
                    </button>
                )}

                {seamlessTiles.length > 0 && (
                    <div style={{ marginTop: '1rem' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#334155' }}>Generated Tiles (click to select)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                            {seamlessTiles.map((tile, i) => (
                                <div key={i} onClick={() => setSeamlessUrl(`${API}${tile.url}`)}
                                    style={{ cursor: 'pointer', border: seamlessUrl === `${API}${tile.url}` ? '2px solid #6366f1' : '2px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
                                    <img src={`${API}${tile.url}`} alt={`Tile ${i + 1}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
                                    <div style={{ position: 'absolute', bottom: 4, right: 4, background: tile.score >= 0.9 ? '#22c55e' : tile.score >= 0.75 ? '#eab308' : '#ef4444', color: '#fff', fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                        {Math.round(tile.score * 100)}%
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="st-pattern-layout">
                <div
                    className={`st-pattern-upload ${isDrag ? 'dragging' : ''}`}
                    onClick={() => fileRef.current?.click()}
                    onDrop={(e) => { e.preventDefault(); setIsDrag(false); handleUpload(e.dataTransfer.files[0]); }}
                    onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                    onDragLeave={() => setIsDrag(false)}
                >
                    <div className="st-pattern-upload-icon">
                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={20} />
                    </div>
                    <strong>Upload an image or drag &amp; drop</strong>
                    <p>JPG, PNG &bull; Up to 50MB</p>
                </div>

                <div className="st-pattern-panels">
                    <div className="st-pattern-panel">
                        <div className="st-pattern-panel-label">Original</div>
                        {preview ? (
                            <img src={preview} alt="Original" className="st-pattern-image" />
                        ) : (
                            <>
                                <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="25" y="30" width="60" height="65" rx="8" fill="#F3F4F6" stroke="#E5E7EB" strokeWidth="2" transform="rotate(-10 25 30)" />
                                    <rect x="40" y="25" width="60" height="65" rx="8" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="2" />
                                    <circle cx="55" cy="45" r="6" fill="#E5E7EB" />
                                    <path d="M40 70L55 55L75 75L85 65L100 80" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <div className="st-pattern-empty-title">No image uploaded</div>
                            </>
                        )}
                    </div>

                    <div className="st-pattern-arrow">
                        <I d="M5 12h14M12 5l7 7-7 7" s={18} />
                    </div>

                    <div className="st-pattern-panel">
                        <div className="st-pattern-panel-label">Seamless Base Tile</div>
                        {seamlessUrl ? (
                            <>
                                <img src={seamlessUrl} alt="Result" className="st-pattern-image" />
                                <a href={seamlessUrl} onClick={(e) => forceDownload(e, seamlessUrl)} className="st-dl-btn" style={{ position: 'absolute', bottom: '1rem', right: '1rem' }}>Download</a>
                            </>
                        ) : loading ? (
                            <div className="st-loading"><div className="st-spinner" /><span>Fixing seams...</span></div>
                        ) : (
                            <>
                                <svg className="st-pattern-empty-img" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="35" y="30" width="60" height="60" rx="8" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="2" strokeDasharray="4 4" />
                                    <path d="M50 45C50 45 55 50 60 45C65 40 70 45 70 45" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    <path d="M45 60C45 60 50 55 55 60C60 65 65 60 65 60" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    <path d="M55 75C55 75 60 70 65 75C70 80 75 75 75 75" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    <path d="M75 55L75 60M85 30L90 35M30 75L25 70" stroke="#C7D2FE" strokeWidth="2" strokeLinecap="round" />
                                    <path d="M92 40L95 48L103 51L95 54L92 62L89 54L81 51L89 48Z" fill="#C7D2FE" />
                                    <path d="M40 20L42 25L47 27L42 29L40 34L38 29L33 27L38 25Z" fill="#E0E7FF" />
                                </svg>
                                <div className="st-pattern-empty-title">Seamless pattern will appear here</div>
                                <div className="st-pattern-empty-desc">Our AI will offset your image and seamlessly redraw the connections.</div>
                                <button className="st-pattern-btn-outline" disabled={true}>
                                    <I d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z" s={16} />
                                    Make Seamless Base Tile
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
