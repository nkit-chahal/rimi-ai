import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useImageDropzone } from '../shared/useImageDropzone';
import { I } from '../shared/StudioIcons';
import { API, apiFetch, forceDownload } from '../shared/helpers';
import { createPortal } from 'react-dom';

export default function RepeatTool(props) {
    const { uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, creditPricing, controls, updateControls, repeatUrl, setRepeatUrl, isRepeat, setIsRepeat, rightPanelEl, handlePreUpload, onUploadInvalid, onUploadPaste, tool, state, setState, setUploads, currentToken } = props;

    const { pasteProps, inputProps } = useImageDropzone({
        onFile: handlePreUpload,
        onInvalidFile: onUploadInvalid,
        onPasteSuccess: onUploadPaste,
    });

    const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
    const [canvasZoom, setCanvasZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const [showTileBoundary, setShowTileBoundary] = useState(true);
    const canvasRef = useRef(null);

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const repeatCreditCost = creditPricing?.repeat || 5;
    const hasEnoughRepeatCredits = userRemainingCredits >= repeatCreditCost;

    const rptW = Number(controls.printWidth) || 12;
    const rptH = Number(controls.printHeight ?? controls.printWidth) || 12;
    const fabW = Number(controls.fabricWidth) || 54;
    const dpi = Number(controls.exportDpi) || 300;
    const FABRIC_PREVIEW_PX = 960;

    const calcExportGrid = useCallback((fw, tw) => {
        if (tw > fw) return 2;
        return Math.max(2, Math.min(8, Math.ceil(fw / Math.max(tw, 0.5))));
    }, []);

    const layoutMetrics = useMemo(() => {
        const repeatsAcross = fabW / Math.max(rptW, 0.5);
        const fullRepeatsAcross = Math.floor(repeatsAcross);
        const tileWiderThanFabric = rptW > fabW;
        const coverage = tileWiderThanFabric
            ? 100
            : (fullRepeatsAcross * rptW) / Math.max(fabW, 1) * 100;
        const exportGrid = calcExportGrid(fabW, rptW);
        const tilesAcrossCeil = Math.ceil(repeatsAcross);
        const maxPreviewCols = rptW <= 2 ? 36 : rptW <= 4 ? 24 : rptW <= 8 ? 18 : 12;

        const previewCols = tileWiderThanFabric
            ? 1
            : Math.min(maxPreviewCols, Math.max(2, tilesAcrossCeil));
        const previewRows = tileWiderThanFabric
            ? 2
            : Math.min(8, Math.max(3, Math.ceil(previewCols / 4)));
        const tileDisplayW = tileWiderThanFabric
            ? FABRIC_PREVIEW_PX
            : FABRIC_PREVIEW_PX / repeatsAcross;
        const tileDisplayH = tileDisplayW * (rptH / Math.max(rptW, 0.5));
        const canvasPxW = Math.round(tileDisplayW * previewCols);
        const canvasPxH = Math.round(tileDisplayH * previewRows);

        const tilePxW = Math.round(rptW * dpi);
        const tilePxH = Math.round(rptH * dpi);
        const sheetPxW = tilePxW * exportGrid;
        const sheetPxH = tilePxH * exportGrid;
        const sheetInW = (exportGrid * rptW).toFixed(1);
        const sheetInH = (exportGrid * rptH).toFixed(1);

        const repeatsLabel = tileWiderThanFabric
            ? `Partial (${repeatsAcross.toFixed(2)} tile fits)`
            : Math.abs(repeatsAcross - Math.round(repeatsAcross)) < 0.01
                ? `${Math.round(repeatsAcross)} across fabric`
                : `${fullRepeatsAcross} full (${repeatsAcross.toFixed(2)} across)`;
        const gridLabel = `${previewCols}×${previewRows} on canvas`;
        const gridNote = !tileWiderThanFabric && previewCols < tilesAcrossCeil
            ? `Full fabric width = ${tilesAcrossCeil} tiles`
            : !tileWiderThanFabric
                ? `Matches ${tilesAcrossCeil} tiles across ${fabW}″`
                : '';

        return {
            repeatsAcross,
            fullRepeatsAcross,
            tileWiderThanFabric,
            coverage,
            exportGrid,
            previewCols,
            previewRows,
            tileDisplayW,
            tileDisplayH,
            canvasPxW,
            canvasPxH,
            tilePxW,
            tilePxH,
            sheetPxW,
            sheetPxH,
            sheetInW,
            sheetInH,
            repeatsLabel,
            gridLabel,
            gridNote,
        };
    }, [fabW, rptW, rptH, dpi, calcExportGrid]);

    const {
        tileWiderThanFabric,
        coverage,
        exportGrid,
        previewCols,
        previewRows,
        tileDisplayW,
        tileDisplayH,
        tilePxW,
        tilePxH,
        sheetPxW,
        sheetPxH,
        sheetInW,
        sheetInH,
        repeatsLabel,
        gridLabel,
        gridNote,
    } = layoutMetrics;

    const setRepeat = useCallback((patch) => {
        if (!updateControls) return;
        const nextW = patch.printWidth ?? rptW;
        const nextH = patch.printHeight ?? rptH;
        const nextFab = patch.fabricWidth ?? fabW;
        updateControls({
            ...patch,
            printWidth: patch.printWidth ?? nextW,
            printHeight: patch.printHeight ?? nextH,
            fabricWidth: patch.fabricWidth ?? nextFab,
            gridSize: calcExportGrid(nextFab, nextW),
        });
    }, [updateControls, rptW, rptH, fabW, calcExportGrid]);
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
            const d = await apiFetch('/api/create-repeat-set', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: activeProject.id,
                    userId: user?.id,
                    filename: safeFilename,
                    imageUrl: safeUrl,
                    gridSize: exportGrid,
                    scale: controls.scale,
                    rotation: controls.rotation,
                    repeatType: controls.repeatType,
                    dpi: controls.exportDpi,
                    format: controls.exportFormat,
                    printWidth: rptW,
                    printHeight: rptH,
                    repeatWidth: rptW,
                    repeatHeight: rptH,
                    fabricWidth: fabW,
                }),
            }, currentToken);
            if (d.success) {
                updateCreditsFromResponse?.(d);
                const fullUrl = `${API}${d.resultUrl}`;
                setRepeatUrl(fullUrl);
                forceDownload({ preventDefault: () => { } }, fullUrl);
            } else setError(d.error);
        } catch {
            setError('Backend is not reachable. Start Flask on port 3001.');
        } finally {
            setIsRepeat(false);
        }
    };


    useEffect(() => {
        setCanvasZoom(1);
        setCanvasPan({ x: 0, y: 0 });
    }, [rptW, rptH, fabW, previewCols, previewRows]);

    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext('2d');
        const cols = previewCols;
        const rows = previewRows;
        const tileW = Math.max(24, Math.round(tileDisplayW));
        const tileH = Math.max(24, Math.round(tileDisplayH));

        const drawPattern = (img) => {
            c.width = tileW * cols;
            c.height = tileH * rows;
            ctx.fillStyle = '#fbfaf7';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.save();
            ctx.translate(c.width / 2, c.height / 2);
            ctx.rotate((controls.rotation * Math.PI) / 180);
            ctx.translate(-c.width / 2, -c.height / 2);

            const drawW = tileW * (controls.scale / 100);
            const drawH = tileH * (controls.scale / 100);
            const insetX = (tileW - drawW) / 2;
            const insetY = (tileH - drawH) / 2;
            const expand = 2;

            const drawTile = (col, row, x, y) => {
                ctx.drawImage(img, x + insetX, y + insetY, drawW, drawH);
            };

            if (controls.repeatType === 'half_brick') {
                for (let r = -expand; r < rows + expand; r += 1) {
                    const offset = Math.abs(r) % 2 ? Math.floor(tileW / 2) : 0;
                    for (let col = -expand; col <= cols + expand; col += 1) {
                        drawTile(col, r, col * tileW + offset, r * tileH);
                    }
                }
            } else if (controls.repeatType === 'half_drop') {
                for (let col = -expand; col < cols + expand; col += 1) {
                    const offset = Math.abs(col) % 2 ? Math.floor(tileH / 2) : 0;
                    for (let r = -expand; r <= rows + expand; r += 1) {
                        drawTile(col, r, col * tileW, r * tileH + offset);
                    }
                }
            } else if (controls.repeatType === 'mirror') {
                for (let r = -expand; r < rows + expand; r += 1) {
                    for (let col = -expand; col < cols + expand; col += 1) {
                        ctx.save();
                        ctx.translate(
                            col * tileW + insetX + (Math.abs(col) % 2 ? drawW : 0),
                            r * tileH + insetY + (Math.abs(r) % 2 ? drawH : 0),
                        );
                        ctx.scale(Math.abs(col) % 2 ? -1 : 1, Math.abs(r) % 2 ? -1 : 1);
                        ctx.drawImage(img, 0, 0, drawW, drawH);
                        ctx.restore();
                    }
                }
            } else {
                for (let r = -expand; r < rows + expand; r += 1) {
                    for (let col = -expand; col < cols + expand; col += 1) {
                        drawTile(col, r, col * tileW, r * tileH);
                    }
                }
            }

            if (showTileBoundary) {
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.55)';
                ctx.lineWidth = 1;
                for (let r = 0; r < rows; r += 1) {
                    for (let col = 0; col < cols; col += 1) {
                        ctx.strokeRect(col * tileW + 0.5, r * tileH + 0.5, tileW - 1, tileH - 1);
                    }
                }
                if (!tileWiderThanFabric) {
                    ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
                    ctx.setLineDash([6, 4]);
                    ctx.strokeRect(0.5, 0.5, FABRIC_PREVIEW_PX - 1, rows * tileH - 1);
                    ctx.setLineDash([]);
                }
            }

            if (controls.edgeMatch && (controls.hBrush > 0 || controls.vBrush > 0)) {
                ctx.fillStyle = 'rgba(99, 102, 241, 0.35)';
                const displayHBrush = tileW * (controls.hBrush / 100);
                const displayVBrush = tileH * (controls.vBrush / 100);

                for (let r = -expand; r <= rows + expand; r += 1) {
                    if (displayHBrush > 0) {
                        if (controls.repeatType === 'half_drop') {
                            for (let col = -expand; col <= cols + expand; col += 1) {
                                const offset = Math.abs(col) % 2 ? Math.floor(tileH / 2) : 0;
                                const y = r * tileH + offset;
                                ctx.fillRect(col * tileW, y - displayHBrush / 2, tileW, displayHBrush);
                            }
                        } else {
                            const y = r * tileH;
                            ctx.fillRect(-expand * tileW, y - displayHBrush / 2, (cols + expand * 2) * tileW, displayHBrush);
                        }
                    }
                }
                for (let col = -expand; col <= cols + expand; col += 1) {
                    if (displayVBrush > 0) {
                        if (controls.repeatType === 'half_brick') {
                            for (let r = -expand; r <= rows + expand; r += 1) {
                                const offset = Math.abs(r) % 2 ? Math.floor(tileW / 2) : 0;
                                const x = col * tileW + offset;
                                ctx.fillRect(x - displayVBrush / 2, r * tileH, displayVBrush, tileH);
                            }
                        } else {
                            const x = col * tileW;
                            ctx.fillRect(x - displayVBrush / 2, -expand * tileH, displayVBrush, (rows + expand * 2) * tileH);
                        }
                    }
                }
            }

            ctx.restore();
        };

        if (!preview) {
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

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => drawPattern(img);
        img.onerror = () => {
            c.width = 980;
            c.height = 680;
            ctx.fillStyle = '#fbfaf7';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Could not load preview image', c.width / 2, c.height / 2);
        };
        const src = (preview.startsWith('http') || preview.startsWith('blob:') || preview.startsWith('data:'))
            ? preview
            : preview.startsWith('/')
                ? `${API}${preview}`
                : preview;
        img.src = src;
    }, [
        controls.repeatType,
        controls.rotation,
        controls.scale,
        controls.edgeMatch,
        controls.hBrush,
        controls.vBrush,
        preview,
        previewCols,
        previewRows,
        tileDisplayW,
        tileDisplayH,
        tileWiderThanFabric,
        rptW,
        rptH,
        fabW,
        showTileBoundary,
    ]);

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
            <div {...pasteProps} className="st-repeat-layout">
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
                            <canvas ref={canvasRef} className="st-canvas-free" />
                        </div>
                    </div>
                    <div className="st-repeat-footer">
                        <span className="st-res-text">{sheetPxW.toLocaleString()}px &times; {sheetPxH.toLocaleString()}px</span>
                        <div className="st-footer-actions">
                            <button><I d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" s={14} /></button>
                            <button><I d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" s={14} /></button>
                        </div>
                    </div>
                </div>
                <input {...inputProps} />
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
                                if (p) setRepeat({ printWidth: p.w, printHeight: p.h });
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
                                onClick={() => setRepeat({ printWidth: p.w, printHeight: p.h })}
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
                                    onChange={e => setRepeat({ printWidth: parseFloat(e.target.value) || 1 })}
                                    className="st-select" style={{ width: '100%', textAlign: 'center', fontSize: '0.85rem', fontWeight: 700 }} />
                                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>″</span>
                            </div>
                        </div>
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 600, paddingTop: '16px' }}>×</span>
                        <div>
                            <label className="st-label-sm" style={{ marginBottom: '2px' }}>Height</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input type="number" min="0.5" max="72" step="0.5" value={rptH}
                                    onChange={e => setRepeat({ printHeight: parseFloat(e.target.value) || 1 })}
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

                    {tileWiderThanFabric && (
                        <div style={{ marginTop: '0.65rem', padding: '0.55rem 0.7rem', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fde68a', fontSize: '0.72rem', color: '#92400e', lineHeight: 1.45 }}>
                            Tile ({rptW}″) is wider than fabric ({fabW}″). Export uses a {exportGrid}×{exportGrid} sheet — pick a smaller tile or wider fabric for true yardage repeats.
                        </div>
                    )}

                    {/* Auto-calculated info — fully reactive */}
                    <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.04)', border: '1px solid rgba(139, 92, 246, 0.08)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Repeats across</span>
                            <span style={{ fontSize: '0.82rem', color: '#4f46e5', fontWeight: 800, textAlign: 'right' }}>{repeatsLabel}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Fabric coverage</span>
                            <span style={{ fontSize: '0.78rem', color: coverage >= 99.9 ? '#10b981' : coverage >= 75 ? '#f59e0b' : '#ef4444', fontWeight: 700 }}>{coverage.toFixed(1)}%</span>
                        </div>
                        <div style={{ height: '1px', background: 'rgba(0,0,0,0.04)', margin: '2px 0' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Canvas preview</span>
                            <span style={{ fontSize: '0.78rem', color: '#374151', fontWeight: 700, textAlign: 'right' }}>
                                {gridLabel}
                                {gridNote && (
                                    <span style={{ display: 'block', fontSize: '0.68rem', color: '#94a3b8', fontWeight: 500, marginTop: '2px' }}>{gridNote}</span>
                                )}
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Single tile ({dpi} DPI)</span>
                            <span style={{ fontSize: '0.78rem', color: '#374151', fontWeight: 700 }}>{tilePxW.toLocaleString()}×{tilePxH.toLocaleString()} px</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Export sheet</span>
                            <span style={{ fontSize: '0.78rem', color: '#374151', fontWeight: 700, textAlign: 'right' }}>
                                {exportGrid}×{exportGrid} tiles<br />
                                <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 500 }}>
                                    {sheetPxW.toLocaleString()}×{sheetPxH.toLocaleString()} px ({sheetInW}″ × {sheetInH}″)
                                </span>
                            </span>
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
