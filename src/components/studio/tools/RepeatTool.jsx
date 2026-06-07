import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';
import { createPortal } from 'react-dom';

export default function RepeatTool(props) {
    const { uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, creditPricing, controls, updateControls, repeatUrl, setRepeatUrl, isRepeat, setIsRepeat, rightPanelEl, handleUpload, handlePreUpload, tool, state, setState, setUploads } = props;

    const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
    const [canvasZoom, setCanvasZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const [showTileBoundary, setShowTileBoundary] = useState(true);
    const canvasRef = useRef(null);

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const repeatCreditCost = creditPricing?.repeat || 5;
    const hasEnoughRepeatCredits = userRemainingCredits >= repeatCreditCost;
    const [isDrag, setIsDrag] = useState(false);
    const fileRef = useRef(null);

    const createRepeat = async () => {
        if (!uploaded && !preview) {
            setError('Upload an image first to export a repeat set.');
            return;
        }
        if (!hasEnoughRepeatCredits) {
            setError(`Insufficient credits. Repeat Set needs ${repeatCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }

        let safeFilename = uploaded?.filename || '';
        let safeUrl = '';

        // If no filename from upload response, try to extract from preview URL
        if (!safeFilename && preview) {
            if (preview.startsWith('data:')) {
                // It's a base64 data URL from FileReader â€” we need the server filename
                setError('Image is still uploading. Please wait and try again.');
                return;
            } else if (preview.startsWith('http')) {
                safeUrl = preview;
            } else {
                // Local path like /uploads/xxx.png or /results/xxx.png
                safeFilename = preview.split('/').pop();
            }
        }

        if (!safeFilename && !safeUrl) {
            setError('No valid image to export. Please upload an image.');
            return;
        }

        setIsRepeat(true);
        setError('');
        setRepeatUrl(null);
        try {
            const r = await fetch(`${API}/api/create-repeat-set`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId: activeProject.id,
                    filename: safeFilename,
                    imageUrl: safeUrl,
                    gridSize: controls.gridSize,
                    scale: controls.scale,
                    repeatType: controls.repeatType,
                    dpi: controls.exportDpi,
                    format: controls.exportFormat,
                }),
            });
            const d = await r.json();
            if (d.success) {
                const fullUrl = `${API}${d.resultUrl}`;
                setRepeatUrl(fullUrl);
                // Force a real download using fetch+blob
                forceDownload({ preventDefault: () => { } }, fullUrl);
            } else setError(d.error);
        } catch {
            setError('Backend is not reachable. Start Flask on port 3001.');
        } finally {
            setIsRepeat(false);
        }
    };


    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            // Use full source image resolution for crisp preview
            const tw = img.width;
            const th = img.height;
            c.width = tw * controls.gridSize;
            c.height = th * controls.gridSize;
            ctx.fillStyle = '#fbfaf7';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.save();
            ctx.translate(c.width / 2, c.height / 2);
            ctx.rotate((controls.rotation * Math.PI) / 180);
            ctx.translate(-c.width / 2, -c.height / 2);
            const drawW = tw * (controls.scale / 100);
            const drawH = th * (controls.scale / 100);

            const expand = 2;
            if (controls.repeatType === 'half_brick') {
                for (let r = -expand; r < controls.gridSize + expand; r += 1) {
                    const offset = Math.abs(r) % 2 ? Math.floor(tw / 2) : 0;
                    for (let col = -expand; col <= controls.gridSize + expand; col += 1) ctx.drawImage(img, col * tw + offset, r * th, drawW, drawH);
                }
            } else if (controls.repeatType === 'half_drop') {
                for (let col = -expand; col < controls.gridSize + expand; col += 1) {
                    const offset = Math.abs(col) % 2 ? Math.floor(th / 2) : 0;
                    for (let r = -expand; r <= controls.gridSize + expand; r += 1) ctx.drawImage(img, col * tw, r * th + offset, drawW, drawH);
                }
            } else if (controls.repeatType === 'mirror') {
                for (let r = -expand; r < controls.gridSize + expand; r += 1) {
                    for (let col = -expand; col < controls.gridSize + expand; col += 1) {
                        ctx.save();
                        ctx.translate(
                            col * tw + (Math.abs(col) % 2 ? drawW : 0),
                            r * th + (Math.abs(r) % 2 ? drawH : 0)
                        );
                        ctx.scale(Math.abs(col) % 2 ? -1 : 1, Math.abs(r) % 2 ? -1 : 1);
                        ctx.drawImage(img, 0, 0, drawW, drawH);
                        ctx.restore();
                    }
                }
            } else {
                for (let r = -expand; r < controls.gridSize + expand; r += 1) {
                    for (let col = -expand; col < controls.gridSize + expand; col += 1) {
                        ctx.drawImage(img, col * tw, r * th, drawW, drawH);
                    }
                }
            }

            // Draw visual mask for seam brushes to give user feedback
            if (controls.edgeMatch && (controls.hBrush > 0 || controls.vBrush > 0)) {
                ctx.fillStyle = 'rgba(99, 102, 241, 0.35)'; // Purple/Indigo overlay

                // hBrush and vBrush are now percentages (0-25) representing Tile Overlap
                // We calculate the pixel width relative to the scaled tile width/height
                const displayHBrush = tw * (controls.hBrush / 100);
                const displayVBrush = th * (controls.vBrush / 100);

                // Ensure we draw the grid seams over the entire expanded area
                for (let r = -expand; r <= controls.gridSize + expand; r += 1) {
                    if (displayHBrush > 0) {
                        // Horizontal seams (between rows)
                        // Adjust for staggered layouts
                        if (controls.repeatType === 'half_drop') {
                            for (let col = -expand; col <= controls.gridSize + expand; col += 1) {
                                const offset = Math.abs(col) % 2 ? Math.floor(th / 2) : 0;
                                const y = r * th + offset;
                                ctx.fillRect(col * tw, y - displayHBrush / 2, tw, displayHBrush);
                            }
                        } else {
                            const y = r * th;
                            ctx.fillRect(-expand * tw, y - displayHBrush / 2, (controls.gridSize + expand * 2) * tw, displayHBrush);
                        }
                    }
                }
                for (let col = -expand; col <= controls.gridSize + expand; col += 1) {
                    if (displayVBrush > 0) {
                        // Vertical seams (between cols)
                        if (controls.repeatType === 'half_brick') {
                            for (let r = -expand; r <= controls.gridSize + expand; r += 1) {
                                const offset = Math.abs(r) % 2 ? Math.floor(tw / 2) : 0;
                                const x = col * tw + offset;
                                ctx.fillRect(x - displayVBrush / 2, r * th, displayVBrush, th);
                            }
                        } else {
                            const x = col * tw;
                            ctx.fillRect(x - displayVBrush / 2, -expand * th, displayVBrush, (controls.gridSize + expand * 2) * th);
                        }
                    }
                }
            }

            ctx.restore();
        };
        const imgSrc = preview;
        if (!imgSrc) {
            // No uploaded image â€” show blank canvas
            c.width = 980;
            c.height = 680;
            ctx.fillStyle = '#fbfaf7';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '16px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Upload an image to preview your repeat set', c.width / 2, c.height / 2);
            return;
        }
        img.src = imgSrc;
    }, [controls, preview]);

    const handleWheel = (e) => {
        setCanvasZoom(z => Math.max(0.1, Math.min(5, z - e.deltaY * 0.001)));
    };
    const handleMouseDown = (e) => {
        setIsPanning(true);
        setPanStart({ x: e.clientX - canvasPan.x, y: e.clientY - canvasPan.y });
    };
    const handleMouseMove = (e) => {
        if (!isPanning) return;
        setCanvasPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    };
    const handleMouseUp = () => setIsPanning(false);

    const renderVariations = (isSidebar = false) => {
        if (state.variations.length === 0) return null;
        return (
            <section className={`st-variations ${isSidebar ? 'st-side-variations' : ''}`}>
                <div className="st-section-title">Pattern Variations</div>
                <div className="st-variation-row">
                    {state.variations.map((v) => (
                        <button
                            key={v.id}
                            className={`st-variation ${v.isSelected ? 'active' : ''}`}
                            onClick={() => {
                                setState(s => ({
                                    ...s,
                                    variations: s.variations.map(item => ({ ...item, isSelected: item.id === v.id })),
                                    activeProject: { ...s.activeProject, heroImageUrl: v.imageUrl }
                                }));
                                setUploads(p => ({ ...p, [tool]: { file: null, url: v.imageUrl } }));
                            }}
                        >
                            <img src={v.imageUrl} alt="" />
                            <span>{v.name}</span>
                        </button>
                    ))}
                    <button className="st-generate-more"><span>+</span><small>Generate More</small></button>
                </div>
            </section>
        );
    };


    const renderCanvasBlock = () => {
        return (
            <div className="st-repeat-layout">
                <div className="st-repeat-board">
                    <div className="st-repeat-toolbar">
                        <div className="st-tb-group">
                            <button className={`st-tb-btn ${isPanning ? 'active' : ''}`}><I d="M10 20l-4-4m0 0l4-4m-4 4h14M14 4l4 4m0 0l-4 4m4-4H4" s={16} /></button>
                            <button className="st-tb-btn"><I d="M12 5v14M5 12h14" s={16} /></button>
                        </div>
                        <div className="st-tb-group">
                            <button className="st-tb-btn" onClick={() => setCanvasZoom(z => Math.max(0.1, z - 0.1))}><I d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" s={16} /></button>
                            <input type="range" min="0.1" max="3" step="0.05" value={canvasZoom} onChange={(e) => setCanvasZoom(parseFloat(e.target.value))} className="st-zoom-slider" />
                            <span className="st-zoom-text">{Math.round(canvasZoom * 100)}%</span>
                            <button className="st-tb-btn" onClick={() => { setCanvasZoom(1); setCanvasPan({ x: 0, y: 0 }) }} title="Fit to Screen"><I d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" s={16} /></button>
                            <button className="st-tb-btn active" title="Grid"><I d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" s={16} /></button>
                        </div>
                        <button className={`st-tb-btn-text ${showTileBoundary ? 'active' : ''}`} onClick={() => setShowTileBoundary(!showTileBoundary)}>
                            <I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={16} /> Show Tile Boundary
                        </button>
                    </div>
                    <div
                        className="st-repeat-canvas-container"
                        onWheel={handleWheel}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    >
                        <div
                            className="st-repeat-canvas-wrapper"
                            style={{ transform: `translate(-50%, -50%) translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom})` }}
                        >
                            <canvas ref={canvasRef} className="st-canvas-free" style={{ border: showTileBoundary ? '1px dashed #6366f1' : 'none' }} />
                        </div>
                    </div>
                    <div className="st-repeat-footer">
                        <span className="st-res-text">4096px &times; 3072px</span>
                        <div className="st-footer-actions">
                            <button><I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={14} /></button>
                            <button><I d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" s={14} /></button>
                        </div>
                    </div>
                </div>
            </div>
        );

    };

    const renderToolControls = () => {
        // Industry-standard repeat sizes (inches)
        const repeatPresets = [
            { w: 1, h: 1, label: '1×1″', cat: 'Ditsy' },
            { w: 2, h: 2, label: '2×2″', cat: 'Ditsy' },
            { w: 4, h: 4, label: '4×4″', cat: 'Small' },
            { w: 6, h: 6, label: '6×6″', cat: 'Small' },
            { w: 8, h: 8, label: '8×8″', cat: 'Medium' },
            { w: 12, h: 12, label: '12×12″', cat: 'Medium' },
            { w: 18, h: 18, label: '18×18″', cat: 'Large' },
            { w: 24, h: 24, label: '24×24″', cat: 'Large' },
            { w: 36, h: 36, label: '36×36″', cat: 'Engineered' },
            { w: 48, h: 48, label: '48×48″', cat: 'Engineered' },
        ];
        const fabricWidths = [36, 44, 45, 54, 58, 60];
        const rptW = controls.repeatWidth || 12;
        const rptH = controls.repeatHeight || 12;
        const fabW = controls.fabricWidth || 54;
        const dpi = controls.exportDpi || 300;

        // Centralized auto-grid calculation
        const calcGrid = (fw, tw) => Math.max(2, Math.min(8, Math.ceil(fw / tw)));
        const setRepeat = (patch) => {
            const nextW = patch.repeatWidth ?? rptW;
            const nextFab = patch.fabricWidth ?? fabW;
            updateControls({ ...patch, gridSize: calcGrid(nextFab, nextW) });
        };

        // Derived calculations (always precise, always reactive)
        const autoGrid = calcGrid(fabW, rptW);
        const repeatsAcross = fabW / rptW;
        const tilePxW = Math.round(rptW * dpi);
        const tilePxH = Math.round(rptH * dpi);
        const sheetPxW = tilePxW * autoGrid;
        const sheetPxH = tilePxH * autoGrid;
        const coverage = ((Math.floor(repeatsAcross) * rptW) / fabW * 100);

        const isCustomSize = !repeatPresets.some(p => p.w === rptW && p.h === rptH);
        const catColors = { Ditsy: '#10b981', Small: '#3b82f6', Medium: '#8b5cf6', Large: '#f59e0b', Engineered: '#ef4444' };
        const activeCat = repeatPresets.find(p => p.w === rptW && p.h === rptH)?.cat || '';

        return (
            <div className="st-ctrl">
                <div className="st-settings-group">
                    <div className="st-group-title">REPEAT DIMENSIONS</div>

                    {/* Industry Category Tags */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '0.75rem' }}>
                        {['Ditsy', 'Small', 'Medium', 'Large', 'Engineered'].map(cat => (
                            <button key={cat} onClick={() => {
                                const p = repeatPresets.find(r => r.cat === cat);
                                if (p) setRepeat({ repeatWidth: p.w, repeatHeight: p.h });
                            }}
                                style={{
                                    padding: '3px 10px', borderRadius: '999px', border: `1px solid ${activeCat === cat ? catColors[cat] : 'rgba(0,0,0,0.06)'}`,
                                    background: activeCat === cat ? `${catColors[cat]}12` : 'transparent',
                                    color: activeCat === cat ? catColors[cat] : '#64748b',
                                    fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s ease', textTransform: 'uppercase', letterSpacing: '0.03em'
                                }}>{cat}</button>
                        ))}
                    </div>

                    {/* Preset Size Grid */}
                    <label className="st-label">Tile Size (inches)</label>
                    <div className="st-btn-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                        {repeatPresets.map(p => (
                            <button key={p.label}
                                className={`st-grid-btn ${rptW === p.w && rptH === p.h ? 'active' : ''}`}
                                onClick={() => setRepeat({ repeatWidth: p.w, repeatHeight: p.h })}
                                style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', minWidth: 'auto' }}
                            >{p.label}</button>
                        ))}
                        <button
                            className={`st-grid-btn ${isCustomSize ? 'active' : ''}`}
                            onClick={() => { }}
                            style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}
                        >Custom</button>
                    </div>

                    {/* Custom Width × Height */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '6px', alignItems: 'center', marginTop: '0.75rem' }}>
                        <div>
                            <label className="st-label-sm" style={{ marginBottom: '2px' }}>Width</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input type="number" min="0.5" max="72" step="0.5" value={rptW}
                                    onChange={e => setRepeat({ repeatWidth: parseFloat(e.target.value) || 1 })}
                                    className="st-select" style={{ width: '100%', textAlign: 'center', fontSize: '0.85rem', fontWeight: 700 }} />
                                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>″</span>
                            </div>
                        </div>
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600, paddingTop: '16px' }}>×</span>
                        <div>
                            <label className="st-label-sm" style={{ marginBottom: '2px' }}>Height</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input type="number" min="0.5" max="72" step="0.5" value={rptH}
                                    onChange={e => setRepeat({ repeatHeight: parseFloat(e.target.value) || 1 })}
                                    className="st-select" style={{ width: '100%', textAlign: 'center', fontSize: '0.85rem', fontWeight: 700 }} />
                                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>″</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="st-settings-group">
                    <div className="st-group-title">FABRIC & LAYOUT</div>

                    {/* Fabric Width */}
                    <label className="st-label">Fabric Width</label>
                    <div className="st-btn-row" style={{ gap: '4px', flexWrap: 'wrap' }}>
                        {fabricWidths.map(fw => (
                            <button key={fw}
                                className={`st-grid-btn ${fabW === fw ? 'active' : ''}`}
                                onClick={() => setRepeat({ fabricWidth: fw })}
                                style={{ fontSize: '0.75rem', padding: '0.35rem 0.5rem', minWidth: 'auto' }}
                            >{fw}″</button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '0.5rem' }}>
                        <input type="number" min="12" max="120" step="1" value={fabW}
                            onChange={e => setRepeat({ fabricWidth: parseFloat(e.target.value) || 54 })}
                            className="st-select" style={{ flex: 1, textAlign: 'center', fontSize: '0.85rem', fontWeight: 700 }} />
                        <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>inches</span>
                    </div>

                    {/* Auto-calculated info — fully reactive */}
                    <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.04)', border: '1px solid rgba(139, 92, 246, 0.08)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Repeats across</span>
                            <span style={{ fontSize: '0.88rem', color: '#4f46e5', fontWeight: 800 }}>{Math.floor(repeatsAcross)}× <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 500 }}>({repeatsAcross.toFixed(2)})</span></span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Coverage</span>
                            <span style={{ fontSize: '0.78rem', color: coverage >= 99.9 ? '#10b981' : '#f59e0b', fontWeight: 700 }}>{coverage.toFixed(1)}%</span>
                        </div>
                        <div style={{ height: '1px', background: 'rgba(0,0,0,0.04)', margin: '2px 0' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Grid preview</span>
                            <span style={{ fontSize: '0.78rem', color: '#374151', fontWeight: 700 }}>{autoGrid}×{autoGrid} tiles</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Single tile ({dpi} DPI)</span>
                            <span style={{ fontSize: '0.78rem', color: '#374151', fontWeight: 700 }}>{tilePxW}×{tilePxH} px</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Total sheet</span>
                            <span style={{ fontSize: '0.78rem', color: '#374151', fontWeight: 700 }}>{sheetPxW}×{sheetPxH} px</span>
                        </div>
                    </div>

                    <label className="st-label" style={{ marginTop: '0.75rem' }}>Scale</label>
                    <div className="st-scale-row">
                        <button onClick={() => updateControls({ scale: Math.max(50, controls.scale - 10) })}>-</button>
                        <span style={{ flex: 1, textAlign: 'center' }}>{controls.scale}%</span>
                        <button onClick={() => updateControls({ scale: Math.min(200, controls.scale + 10) })}>+</button>
                    </div>

                    <label className="st-label">Rotation</label>
                    <div className="st-scale-row">
                        <button onClick={() => updateControls({ rotation: (controls.rotation - 15 + 360) % 360 })}>0&deg;</button>
                        <span style={{ flex: 1, textAlign: 'center' }}>{controls.rotation}&deg;</span>
                        <button onClick={() => updateControls({ rotation: (controls.rotation + 15) % 360 })}>+</button>
                    </div>

                    <label className="st-label">Mirror</label>
                    <div className="st-btn-row">
                        <button className={`st-sym-btn ${controls.repeatType === 'block' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'block' })} title="None"><I d="M3 3h18v18H3z" s={14} /></button>
                        <button className={`st-sym-btn ${controls.repeatType === 'mirror' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'mirror' })} title="Horizontal"><I d="M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4" s={14} /></button>
                        <button className={`st-sym-btn ${controls.repeatType === 'half_drop' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'half_drop' })} title="Half Drop"><I d="M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4" s={14} /></button>
                        <button className={`st-sym-btn ${controls.repeatType === 'half_brick' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'half_brick' })} title="Half Brick"><I d="M3 3h7v7H3zM14 3h7v7h-7zM8.5 10h7v7h-7zM3 17h7v7H3zM14 17h7v7h-7z" s={14} /></button>
                    </div>
                </div>
                <div className="st-settings-group">
                    <div className="st-group-title">EXPORT OPTIONS</div>
                    <div className="st-export-grid">
                        <div><label className="st-label-sm">Format</label><select value={controls.exportFormat} onChange={(e) => updateControls({ exportFormat: e.target.value })} className="st-select"><option>PNG</option><option>JPG</option><option>TIFF</option></select></div>
                        <div><label className="st-label-sm">Resolution</label><select value={controls.exportDpi} onChange={(e) => updateControls({ exportDpi: +e.target.value })} className="st-select"><option value={72}>72 DPI</option><option value={150}>150 DPI</option><option value={300}>300 DPI</option><option value={600}>600 DPI</option></select></div>
                    </div>
                </div>
                <button
                    className={`st-export-btn ${!hasEnoughRepeatCredits ? 'insufficient-credits' : ''}`}
                    onClick={() => createRepeat()}
                    disabled={isRepeat || (!uploaded && !preview) || !hasEnoughRepeatCredits}
                    title={!hasEnoughRepeatCredits ? `Need ${repeatCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Export repeat set'}
                >
                    {isRepeat ? 'Processing...' : hasEnoughRepeatCredits ? 'Export Repeat Set' : `Need ${repeatCreditCost} credits`}
                </button>
                {!hasEnoughRepeatCredits && (
                    <div className="st-credit-shortage">
                        {userRemainingCredits.toLocaleString()} credits remaining. Recharge to export a Repeat Set.
                    </div>
                )}
                {renderVariations(true)}
                {tool === 'inspire' && (
                    <div className="st-chat-container">
                        <div className="st-chat-search">
                            <input type="text" placeholder="Describe your pattern..." />
                            <button className="st-chat-send"><I d="M5 12h14M12 5l7 7-7 7" s={16} /></button>
                        </div>
                    </div>
                )}
            </div>
        );

    };

    return (
        <>
            {renderCanvasBlock()}
            {rightPanelEl && createPortal(
                <div className="st-pl-right" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {renderToolControls()}
                </div>,
                rightPanelEl
            )}
        </>
    );
}
