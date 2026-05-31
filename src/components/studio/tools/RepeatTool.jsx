import React, { useState, useEffect, useRef } from 'react';
import { I } from '../shared/StudioIcons';
import { API } from '../shared/helpers';

export default function RepeatTool({ controls, updateControls, createRepeat, isRepeat, uploaded, preview }) {
    const canvasRef = useRef(null);
    const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
    const [canvasZoom, setCanvasZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const [showTileBoundary, setShowTileBoundary] = useState(true);

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


    return (
        <>
                <div className="st-ctrl">
                    <div className="st-settings-group">
                        <div className="st-group-title">TILE SETTINGS</div>
                        <label className="st-label">Grid Size</label>
                        <div className="st-btn-row">
                            {['2x2', '3x3', '4x4', '5x5', '6x6'].map((n, i) => (
                                <button key={n} className={`st-grid-btn ${controls.gridSize === i + 2 ? 'active' : ''}`} onClick={() => updateControls({ gridSize: i + 2 })}>{n}</button>
                            ))}
                        </div>

                        <label className="st-label">Scale</label>
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
                            <button className={`st-sym-btn ${controls.repeatType === 'half_drop' ? 'active' : ''}`} onClick={() => updateControls({ repeatType: 'half_drop' })} title="Vertical"><I d="M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4" s={14} /></button>
                        </div>
                    </div>
                    <div className="st-settings-group">
                        <div className="st-group-title">EXPORT OPTIONS</div>
                        <div className="st-export-grid">
                            <div><label className="st-label-sm">Format</label><select value={controls.exportFormat} onChange={(e) => updateControls({ exportFormat: e.target.value })} className="st-select"><option>PNG</option><option>JPG</option><option>TIFF</option></select></div>
                            <div><label className="st-label-sm">Resolution</label><select value={controls.exportDpi} onChange={(e) => updateControls({ exportDpi: +e.target.value })} className="st-select"><option value={150}>150 DPI</option><option value={300}>300 DPI</option><option value={600}>600 DPI</option></select></div>
                        </div>
                    </div>
                    <button className="st-export-btn" onClick={() => createRepeat()} disabled={isRepeat || (!uploaded && !preview)}>{isRepeat ? 'Processing...' : 'Export Repeat Set'}</button>
                </div>

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

        </>
    );
}
