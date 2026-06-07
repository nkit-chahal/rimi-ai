import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { I } from '../shared/StudioIcons';
import { API, forceDownload } from '../shared/helpers';
import { createPortal } from 'react-dom';
import * as fabric from 'fabric';

export default function ImageLayersTool(props) {
    const { uploaded, preview, activeProject, user, setError, addBgTask, updateCreditsFromResponse, creditPricing, currentToken, rightPanelEl, handleUpload, handlePreUpload, tool } = props;

    const userRemainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const imageLayersCreditCost = creditPricing.imageLayers || 100;
    const hasEnoughImageLayersCredits = userRemainingCredits >= imageLayersCreditCost;
    const layerEditCreditCost = creditPricing.imageLayerEdit || 15;
    const hasEnoughLayerEditCredits = userRemainingCredits >= layerEditCreditCost;
    const [isDrag, setIsDrag] = useState(false);
    const fileRef = useRef(null);

    const [imageLayersResults, setImageLayersResults] = useState([]);
    const [isImageLayering, setIsImageLayering] = useState(false);
    const [imageLayersNumLayers, setImageLayersNumLayers] = useState(4);
    const [imageLayersDescription, setImageLayersDescription] = useState('auto');

    // New states for interactive editor
    const fabricCanvasRef = useRef(null);
    const canvasInstanceRef = useRef(null);
    const baseCanvasLayoutRef = useRef(null);
    const [layersList, setLayersList] = useState([]);
    const [selectedLayerId, setSelectedLayerId] = useState(null);
    const [layerCanvasZoom, setLayerCanvasZoom] = useState(1);
    const [layerDragState, setLayerDragState] = useState({ draggingId: null, overId: null, position: null });
    const [isExportingLayers, setIsExportingLayers] = useState(false);
    const [isLayerMaskMode, setIsLayerMaskMode] = useState(false);
    const [layerMaskBrushSize, setLayerMaskBrushSize] = useState(32);
    const [isInpaintingLayer, setIsInpaintingLayer] = useState(false);
    const [isImageLayersFullscreen, setIsImageLayersFullscreen] = useState(false);

    // AI Edit states
    const [layerEditPrompt, setLayerEditPrompt] = useState('');
    const [isEditingLayer, setIsEditingLayer] = useState(false);
    const [editType, setEditType] = useState('recolor'); // recolor | revise | replace | freeform

    // Qwen recursive decomposition
    const [recursiveLayerCount, setRecursiveLayerCount] = useState(4);
    const [isProcessingAI, setIsProcessingAI] = useState(false);
    const [aiProcessingText, setAiProcessingText] = useState('');
    const qwenLayerDemoActions = [
        {
            label: 'Edit Text',
            type: 'revise',
            prompt: 'Change the selected text to "Qwen-Image"',
            icon: 'M4 7V4h16v3M9 20h6M12 4v16',
        },
        {
            label: 'Replace',
            type: 'replace',
            prompt: 'Replace the selected object with a friendly dog',
            icon: 'M7 7h10v10H7zM3 12h4M17 12h4M12 3v4M12 17v4',
        },
        {
            label: 'Recolor',
            type: 'recolor',
            prompt: 'Recolor the selected layer to cyan and violet',
            icon: 'M12 22a7 7 0 007-7c0-5-7-13-7-13S5 10 5 15a7 7 0 007 7z',
        },
        {
            label: 'Remove',
            type: 'remove',
            prompt: '',
            icon: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
        },
        {
            label: 'Decompose',
            type: 'decompose',
            prompt: '',
            icon: 'M12 2L2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5',
        },
        {
            label: 'Inpaint',
            type: 'inpaint',
            prompt: 'Change only the painted area',
            icon: 'M3 21v-4l11-11 4 4L7 21H3zM14 6l2-2a2 2 0 012.8 0l1.2 1.2a2 2 0 010 2.8l-2 2',
        },
    ];

    const generateImageLayers = async () => {
        if (!uploaded) return;
        if (!hasEnoughImageLayersCredits) {
            setError(`Insufficient credits. Image Layers needs ${imageLayersCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }
        setIsImageLayering(true);
        setImageLayersResults([]);
        setLayersList([]);
        if (canvasInstanceRef.current) {
            canvasInstanceRef.current.clear();
        }
        setError('');

        const trigger = async () => {
            const r = await fetch(`${API}/api/image-layers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: uploaded.filename,
                    numLayers: imageLayersNumLayers,
                    description: imageLayersDescription || 'auto',
                    outputFormat: 'png',
                    projectId: activeProject.id,
                    userId: user.id
                }),
            });
            const d = await r.json();
            if (d.success) {
                setImageLayersResults(d.layers);
                updateCreditsFromResponse(d);

                // Auto-caption layers in background
                const initialLayersList = d.layers.map((l, i) => ({
                    id: l.index,
                    name: `Layer ${l.index + 1}`,
                    url: l.url,
                    filename: l.filename,
                    x: l.x || 0,
                    y: l.y || 0,
                    width: l.width,
                    height: l.height,
                    sourceWidth: l.sourceWidth,
                    sourceHeight: l.sourceHeight,
                    visible: true,
                    locked: false,
                    fabricId: null,
                    loadingName: true
                }));
                setLayersList(initialLayersList);

                // Load into Fabric canvas
                setTimeout(() => {
                    initFabricCanvas(d.layers);
                }, 100);
                setIsImageLayering(false);

                // Fetch captions async
                d.layers.forEach(async (layer) => {
                    try {
                        const capRes = await fetch(`${API}/api/caption-layer`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename: layer.filename })
                        });
                        const capData = await capRes.json();
                        if (capData.success) {
                            setLayersList(prev => prev.map(pl =>
                                pl.id === layer.index ? { ...pl, name: capData.name, loadingName: false } : pl
                            ));
                        }
                    } catch (e) {
                        console.error("Caption error", e);
                        setLayersList(prev => prev.map(pl =>
                            pl.id === layer.index ? { ...pl, loadingName: false } : pl
                        ));
                    }
                });

                return { url: d.layers[0]?.url, urls: d.layers.map(l => l.url) };
            } else {
                setIsImageLayering(false);
                throw new Error(d.error || 'Image layer decomposition failed');
            }
        };
        addBgTask('imagelayers', `Image Layers: ${imageLayersNumLayers} layers`, uploaded.filename, trigger);
    };

    const initFabricCanvas = (layers) => {
        if (!fabricCanvasRef.current) return;
        if (canvasInstanceRef.current) {
            canvasInstanceRef.current.dispose();
        }

        const parent = fabricCanvasRef.current.parentElement;
        const w = parent ? parent.clientWidth : 800;
        const h = parent ? parent.clientHeight : 600;

        const canvas = new fabric.Canvas(fabricCanvasRef.current, {
            width: w,
            height: h,
            preserveObjectStacking: true, // Keep z-index when selected
        });
        canvasInstanceRef.current = canvas;
        setLayerCanvasZoom(1);
        setIsLayerMaskMode(false);

        const centerLoadedLayerGroup = () => {
            const imageObjects = canvas.getObjects().filter(obj => obj.type === 'image');
            if (!imageObjects.length) return;

            const bounds = imageObjects.reduce((acc, obj) => {
                const rect = obj.getBoundingRect();
                return {
                    minX: Math.min(acc.minX, rect.left),
                    minY: Math.min(acc.minY, rect.top),
                    maxX: Math.max(acc.maxX, rect.left + rect.width),
                    maxY: Math.max(acc.maxY, rect.top + rect.height),
                };
            }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

            if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return;

            const groupWidth = bounds.maxX - bounds.minX;
            const groupHeight = bounds.maxY - bounds.minY;
            const offsetX = (canvas.getWidth() - groupWidth) / 2 - bounds.minX;
            const offsetY = (canvas.getHeight() - groupHeight) / 2 - bounds.minY;

            imageObjects.forEach((obj) => {
                obj.set({
                    left: obj.left + offsetX,
                    top: obj.top + offsetY,
                    initialLeft: obj.left + offsetX,
                    initialTop: obj.top + offsetY,
                    initialScaleX: obj.scaleX,
                    initialScaleY: obj.scaleY,
                    initialAngle: obj.angle || 0,
                });
                obj.setCoords();
            });
        };

        canvas.on('mouse:wheel', (opt) => {
            const delta = opt.e.deltaY;
            let zoom = canvas.getZoom();
            zoom *= 0.999 ** delta;
            zoom = Math.max(0.25, Math.min(zoom, 5));
            canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            setLayerCanvasZoom(Number(zoom.toFixed(2)));
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });
        // Selection sync
        canvas.on('selection:created', (e) => {
            if (e.selected && e.selected.length > 0) {
                setSelectedLayerId(e.selected[0].customId);
            }
        });
        canvas.on('selection:updated', (e) => {
            if (e.selected && e.selected.length > 0) {
                setSelectedLayerId(e.selected[0].customId);
            }
        });
        canvas.on('selection:cleared', () => {
            setSelectedLayerId(null);
        });
        canvas.on('path:created', (e) => {
            if (e.path) {
                e.path.set({
                    customType: 'inpaintMask',
                    selectable: false,
                    evented: false,
                    excludeFromExport: true,
                    stroke: 'rgba(103, 232, 249, 0.55)',
                    fill: null,
                });
                e.path.setCoords();
                canvas.renderAll();
            }
        });

        const sourceWidth = Math.max(...layers.map(l => l.sourceWidth || l.width || 1), 1);
        const sourceHeight = Math.max(...layers.map(l => l.sourceHeight || l.height || 1), 1);
        const bounds = layers.reduce((acc, layer) => {
            const x = Number.isFinite(Number(layer.x)) ? Number(layer.x) : 0;
            const y = Number.isFinite(Number(layer.y)) ? Number(layer.y) : 0;
            const width = Math.max(1, Number(layer.width || layer.sourceWidth || 1));
            const height = Math.max(1, Number(layer.height || layer.sourceHeight || 1));
            return {
                minX: Math.min(acc.minX, x),
                minY: Math.min(acc.minY, y),
                maxX: Math.max(acc.maxX, x + width),
                maxY: Math.max(acc.maxY, y + height),
            };
        }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const contentLeft = Number.isFinite(bounds.minX) ? bounds.minX : 0;
        const contentTop = Number.isFinite(bounds.minY) ? bounds.minY : 0;
        const contentWidth = Math.max(1, (Number.isFinite(bounds.maxX) ? bounds.maxX : sourceWidth) - contentLeft);
        const contentHeight = Math.max(1, (Number.isFinite(bounds.maxY) ? bounds.maxY : sourceHeight) - contentTop);
        const padding = 40;
        const baseScale = Math.min((w - padding) / contentWidth, (h - padding) / contentHeight, 1);
        const baseLeft = (w - contentWidth * baseScale) / 2 - contentLeft * baseScale;
        const baseTop = (h - contentHeight * baseScale) / 2 - contentTop * baseScale;
        baseCanvasLayoutRef.current = { sourceWidth, sourceHeight, contentLeft, contentTop, contentWidth, contentHeight, baseScale, baseLeft, baseTop };
        // Load images
        let loadedCount = 0;
        layers.forEach((layer) => {
            fabric.Image.fromURL(`${API}${layer.url}`, { crossOrigin: 'anonymous' }).then((img) => {
                if (!canvasInstanceRef.current) return;
                const layerLeft = baseLeft + (layer.x || 0) * baseScale;
                const layerTop = baseTop + (layer.y || 0) * baseScale;

                img.set({
                    customId: layer.index,
                    left: layerLeft,
                    top: layerTop,
                    scaleX: baseScale,
                    scaleY: baseScale,
                    initialLeft: layerLeft,
                    initialTop: layerTop,
                    initialScaleX: baseScale,
                    initialScaleY: baseScale,
                    initialAngle: 0,
                    transparentCorners: false,
                    cornerColor: 'rgba(139, 92, 246, 0.8)',
                    borderColor: 'rgba(139, 92, 246, 0.8)',
                    cornerSize: 8,
                });

                canvas.add(img);
                img.setCoords();

                setLayersList(prev => prev.map(pl =>
                    pl.id === layer.index ? { ...pl, fabricId: img } : pl
                ));

                loadedCount++;
                if (loadedCount === layers.length) {
                    // Ensure they are ordered by index
                    const objs = canvas.getObjects();
                    objs.sort((a, b) => a.customId - b.customId);
                    objs.forEach(o => { canvas.remove(o); canvas.add(o); });
                    centerLoadedLayerGroup();
                    canvas.renderAll();
                }
            }).catch(err => console.error("Error loading fabric image", err));
        });
    };

    const handleEditLayer = async () => {
        if (!selectedLayerId && selectedLayerId !== 0) return;
        if (editType === 'inpaint') {
            handleInpaintLayer();
            return;
        }
        if (editType === 'remove') {
            applyCanvasTransform('delete');
            setLayerEditPrompt('');
            return;
        }
        if (editType === 'decompose') {
            handleRecursiveDecompose();
            return;
        }
        if (!layerEditPrompt) return;
        if (!hasEnoughLayerEditCredits) {
            setError(`Insufficient credits. Layer editing needs ${layerEditCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }

        const layerData = layersList.find(l => l.id === selectedLayerId);
        if (!layerData) return;

        setIsEditingLayer(true);
        try {
            const res = await fetch(`${API}/api/edit-layer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: layerData.filename,
                    prompt: layerEditPrompt,
                    editType: editType,
                    projectId: activeProject.id,
                    userId: user.id
                })
            });
            const d = await res.json();
            if (d.success) {
                updateCreditsFromResponse(d);
                // Replace image on canvas
                const canvas = canvasInstanceRef.current;
                const objToReplace = canvas.getObjects().find(o => o.customId === selectedLayerId);
                if (objToReplace) {
                    const oldZIndex = canvas.getObjects().indexOf(objToReplace);
                    fabric.Image.fromURL(`${API}${d.resultUrl}?t=${Date.now()}`, { crossOrigin: 'anonymous' }).then((newImg) => {
                        newImg.set({
                            customId: selectedLayerId,
                            left: objToReplace.left,
                            top: objToReplace.top,
                            scaleX: objToReplace.scaleX,
                            scaleY: objToReplace.scaleY,
                            angle: objToReplace.angle,
                            flipX: objToReplace.flipX,
                            flipY: objToReplace.flipY,
                            initialLeft: objToReplace.initialLeft,
                            initialTop: objToReplace.initialTop,
                            initialScaleX: objToReplace.initialScaleX,
                            initialScaleY: objToReplace.initialScaleY,
                            initialAngle: objToReplace.initialAngle || 0,
                            transparentCorners: false,
                            cornerColor: 'rgba(139, 92, 246, 0.8)',
                            borderColor: 'rgba(139, 92, 246, 0.8)',
                            cornerSize: 8,
                        });
                        canvas.remove(objToReplace);
                        canvas.insertAt(oldZIndex, newImg);
                        canvas.setActiveObject(newImg);
                        canvas.renderAll();

                        // Update layers list url
                        setLayersList(prev => prev.map(pl =>
                            pl.id === selectedLayerId ? { ...pl, url: d.resultUrl, filename: d.resultUrl.split('/').pop() } : pl
                        ));
                    }).catch(err => console.error("Error editing fabric layer", err));
                }
            } else {
                alert(d.error || 'Layer edit failed');
            }
        } catch (e) {
            console.error(e);
            alert('Error editing layer');
        } finally {
            setIsEditingLayer(false);
        }
    };

    const handleRecursiveDecompose = async () => {
        if (!selectedLayerId && selectedLayerId !== 0) {
            alert('Select a layer to decompose further.');
            return;
        }
        if (!hasEnoughImageLayersCredits) {
            setError(`Insufficient credits. Recursive decomposition needs ${imageLayersCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }
        const layerData = layersList.find(l => l.id === selectedLayerId);
        const canvas = canvasInstanceRef.current;
        const sourceObj = canvas?.getObjects().find(o => o.customId === selectedLayerId);
        if (!layerData || !canvas || !sourceObj) return;
        setIsProcessingAI(true);
        setAiProcessingText(`Qwen is decomposing "${layerData.name}" into ${recursiveLayerCount} layers...`);
        try {
            const res = await fetch(`${API}/api/image-layers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: layerData.filename,
                    numLayers: recursiveLayerCount,
                    description: imageLayersDescription || layerData.name || 'auto',
                    outputFormat: 'png',
                    projectId: activeProject.id,
                    userId: user.id
                })
            });
            const d = await res.json();
            if (!d.success) throw new Error(d.error || 'Recursive decomposition failed');
            updateCreditsFromResponse(d);
            const oldZIndex = canvas.getObjects().indexOf(sourceObj);
            const baseId = Math.max(0, ...layersList.map(l => l.id)) + 1;
            const childLayers = d.layers.map((layer, i) => ({
                id: baseId + i,
                name: `${layerData.name || 'Layer'} ${i + 1}`,
                url: layer.url,
                filename: layer.filename,
                x: layer.x || 0,
                y: layer.y || 0,
                width: layer.width,
                height: layer.height,
                sourceWidth: layer.sourceWidth,
                sourceHeight: layer.sourceHeight,
                visible: true,
                locked: false,
                fabricId: null,
                loadingName: true,
                parentId: selectedLayerId
            }));
            canvas.remove(sourceObj);
            setLayersList(prev => [...prev.filter(l => l.id !== selectedLayerId), ...childLayers]);
            setSelectedLayerId(childLayers[0]?.id ?? null);
            let loaded = 0;
            childLayers.forEach((child, i) => {
                fabric.Image.fromURL(`${API}${child.url}?t=${Date.now()}`, { crossOrigin: 'anonymous' }).then((img) => {
                    const childLeft = sourceObj.left + (child.x || 0) * sourceObj.scaleX;
                    const childTop = sourceObj.top + (child.y || 0) * sourceObj.scaleY;
                    img.set({
                        customId: child.id,
                        left: childLeft,
                        top: childTop,
                        scaleX: sourceObj.scaleX,
                        scaleY: sourceObj.scaleY,
                        angle: sourceObj.angle,
                        flipX: sourceObj.flipX,
                        flipY: sourceObj.flipY,
                        opacity: sourceObj.opacity,
                        initialLeft: childLeft,
                        initialTop: childTop,
                        initialScaleX: sourceObj.scaleX,
                        initialScaleY: sourceObj.scaleY,
                        initialAngle: sourceObj.angle,
                        transparentCorners: false,
                        cornerColor: 'rgba(103, 232, 249, 0.9)',
                        borderColor: 'rgba(103, 232, 249, 0.9)',
                        cornerSize: 8,
                    });
                    canvas.insertAt(oldZIndex + i, img);
                    loaded += 1;
                    if (loaded === childLayers.length) {
                        const firstChild = canvas.getObjects().find(o => o.customId === childLayers[0].id);
                        if (firstChild) canvas.setActiveObject(firstChild);
                        canvas.renderAll();
                    }
                    setLayersList(prev => prev.map(pl => pl.id === child.id ? { ...pl, fabricId: img } : pl));
                }).catch(err => console.error('Error loading recursive layer', err));
                fetch(`${API}/api/caption-layer`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: child.filename })
                })
                    .then(r => r.json())
                    .then(capData => {
                        if (capData.success) {
                            setLayersList(prev => prev.map(pl =>
                                pl.id === child.id ? { ...pl, name: capData.name, loadingName: false } : pl
                            ));
                        }
                    })
                    .catch(() => {
                        setLayersList(prev => prev.map(pl =>
                            pl.id === child.id ? { ...pl, loadingName: false } : pl
                        ));
                    });
            });
        } catch (e) {
            console.error(e);
            alert(e.message || 'Error during recursive decomposition');
        } finally {
            setIsProcessingAI(false);
        }
    };
    const setImageLayerZoom = (nextZoom) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const zoom = Math.max(0.25, Math.min(nextZoom, 5));
        canvas.zoomToPoint({ x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 }, zoom);
        setLayerCanvasZoom(Number(zoom.toFixed(2)));
    };
    const resetImageLayerView = () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        setLayerCanvasZoom(1);
        canvas.renderAll();
    };
    const resetLayersToBase = () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        canvas.getObjects().forEach((obj) => {
            if (obj.type === 'image') {
                obj.set({
                    left: obj.initialLeft ?? obj.left,
                    top: obj.initialTop ?? obj.top,
                    scaleX: obj.initialScaleX ?? obj.scaleX,
                    scaleY: obj.initialScaleY ?? obj.scaleY,
                    angle: obj.initialAngle ?? 0,
                    flipX: false,
                    flipY: false,
                });
                obj.setCoords();
            }
        });
        canvas.discardActiveObject();
        setSelectedLayerId(null);
        canvas.renderAll();
    };

    useEffect(() => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;

        canvas.isDrawingMode = isLayerMaskMode;
        if (isLayerMaskMode) {
            const brush = new fabric.PencilBrush(canvas);
            brush.color = 'rgba(103, 232, 249, 0.55)';
            brush.width = layerMaskBrushSize;
            canvas.freeDrawingBrush = brush;
            canvas.discardActiveObject();
            canvas.selection = false;
        } else {
            canvas.selection = true;
        }
        canvas.renderAll();
    }, [isLayerMaskMode, layerMaskBrushSize]);

    const clearLayerMask = () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        canvas.getObjects()
            .filter(obj => obj.customType === 'inpaintMask')
            .forEach(obj => canvas.remove(obj));
        canvas.renderAll();
    };

    const resizeImageLayerCanvas = useCallback(() => {
        const canvas = canvasInstanceRef.current;
        const el = fabricCanvasRef.current;
        const parent = el?.parentElement;
        if (!canvas || !parent) return;

        const nextWidth = Math.max(320, parent.clientWidth);
        const nextHeight = Math.max(280, parent.clientHeight);
        const prevWidth = canvas.getWidth();
        const prevHeight = canvas.getHeight();
        const dx = (nextWidth - prevWidth) / 2;
        const dy = (nextHeight - prevHeight) / 2;

        canvas.setDimensions({ width: nextWidth, height: nextHeight });
        canvas.getObjects().forEach((obj) => {
            obj.set({
                left: (obj.left || 0) + dx,
                top: (obj.top || 0) + dy,
            });
            if (obj.initialLeft !== undefined) obj.initialLeft += dx;
            if (obj.initialTop !== undefined) obj.initialTop += dy;
            obj.setCoords();
        });
        canvas.renderAll();
    }, []);

    useEffect(() => {
        if (!canvasInstanceRef.current) return;
        const raf = requestAnimationFrame(resizeImageLayerCanvas);
        return () => cancelAnimationFrame(raf);
    }, [isImageLayersFullscreen, resizeImageLayerCanvas]);

    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape') setIsImageLayersFullscreen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', resizeImageLayerCanvas);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', resizeImageLayerCanvas);
        };
    }, [resizeImageLayerCanvas]);

    const exportLayerMaskDataUrl = () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return null;
        const maskObjects = canvas.getObjects().filter(obj => obj.customType === 'inpaintMask');
        if (!maskObjects.length) return null;

        const viewportTransform = canvas.viewportTransform ? [...canvas.viewportTransform] : [1, 0, 0, 1, 0, 0];
        const snapshots = canvas.getObjects().map(obj => ({
            obj,
            visible: obj.visible,
            stroke: obj.stroke,
            opacity: obj.opacity,
            globalCompositeOperation: obj.globalCompositeOperation,
        }));

        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        canvas.backgroundColor = '#000000';
        canvas.getObjects().forEach((obj) => {
            if (obj.customType === 'inpaintMask') {
                obj.set({ visible: true, stroke: '#ffffff', opacity: 1, globalCompositeOperation: 'source-over' });
            } else {
                obj.set({ visible: false });
            }
        });
        canvas.renderAll();

        const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 1 });

        snapshots.forEach(({ obj, visible, stroke, opacity, globalCompositeOperation }) => {
            obj.set({ visible, stroke, opacity, globalCompositeOperation });
        });
        canvas.backgroundColor = '';
        canvas.setViewportTransform(viewportTransform);
        canvas.renderAll();

        return dataUrl;
    };

    const syncLayersListToCanvasOrder = (canvas) => {
        const orderedIds = canvas.getObjects()
            .filter(o => o.customId !== undefined && o.customId !== null)
            .map(o => o.customId);

        setLayersList(prev => [...prev].sort((a, b) => {
            const aIndex = orderedIds.indexOf(a.id);
            const bIndex = orderedIds.indexOf(b.id);
            return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
                (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
        }));
    };

    const reorderLayerStack = (dragId, targetId, position = 'before') => {
        if (dragId === null || targetId === null || dragId === targetId) return;

        const canvas = canvasInstanceRef.current;
        const displayOrder = [...layersList].reverse();
        const draggedLayer = displayOrder.find(layer => layer.id === dragId);
        if (!draggedLayer || !displayOrder.some(layer => layer.id === targetId)) return;

        const remainingDisplayOrder = displayOrder.filter(layer => layer.id !== dragId);
        const targetIndex = remainingDisplayOrder.findIndex(layer => layer.id === targetId);
        if (targetIndex === -1) return;

        const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
        const nextDisplayOrder = [
            ...remainingDisplayOrder.slice(0, insertIndex),
            draggedLayer,
            ...remainingDisplayOrder.slice(insertIndex),
        ];
        const nextCanvasOrder = [...nextDisplayOrder].reverse();

        setLayersList(nextCanvasOrder);
        setSelectedLayerId(dragId);

        if (canvas) {
            const objectMap = new Map(canvas.getObjects()
                .filter(o => o.customId !== undefined && o.customId !== null)
                .map(o => [o.customId, o]));

            nextCanvasOrder.forEach((layer) => {
                const obj = objectMap.get(layer.id);
                if (obj) {
                    canvas.remove(obj);
                    canvas.add(obj);
                }
            });

            const activeObj = objectMap.get(dragId);
            if (activeObj) canvas.setActiveObject(activeObj);
            canvas.renderAll();
        }
    };

    const handleInpaintLayer = async () => {
        if (!selectedLayerId && selectedLayerId !== 0) return;
        if (!layerEditPrompt.trim()) {
            alert('Enter an inpaint instruction first.');
            return;
        }
        if (!hasEnoughLayerEditCredits) {
            setError(`Insufficient credits. Layer inpaint needs ${layerEditCreditCost} credits, but you have ${userRemainingCredits} remaining.`);
            return;
        }

        const canvas = canvasInstanceRef.current;
        const layerData = layersList.find(l => l.id === selectedLayerId);
        const objToReplace = canvas?.getObjects().find(o => o.customId === selectedLayerId);
        const maskDataUrl = exportLayerMaskDataUrl();

        if (!canvas || !layerData || !objToReplace) return;
        if (!maskDataUrl) {
            alert('Paint a mask on the canvas first.');
            return;
        }

        setIsInpaintingLayer(true);
        setIsProcessingAI(true);
        setAiProcessingText('Qwen is inpainting the painted mask...');

        try {
            const res = await fetch(`${API}/api/inpaint-layer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: layerData.filename,
                    prompt: layerEditPrompt,
                    mask: maskDataUrl,
                    canvasWidth: Math.round(canvas.getWidth()),
                    canvasHeight: Math.round(canvas.getHeight()),
                    transform: {
                        x: objToReplace.left || 0,
                        y: objToReplace.top || 0,
                        scaleX: objToReplace.scaleX || 1,
                        scaleY: objToReplace.scaleY || 1,
                        angle: objToReplace.angle || 0,
                        flipX: !!objToReplace.flipX,
                        flipY: !!objToReplace.flipY,
                        opacity: objToReplace.opacity ?? 1,
                    },
                    projectId: activeProject.id,
                    userId: user.id
                })
            });
            const d = await res.json();
            if (!d.success) throw new Error(d.error || 'Layer inpaint failed');
            updateCreditsFromResponse(d);

            const oldZIndex = canvas.getObjects().indexOf(objToReplace);

            fabric.Image.fromURL(`${API}${d.resultUrl}?t=${Date.now()}`, { crossOrigin: 'anonymous' }).then((newImg) => {
                newImg.set({
                    customId: selectedLayerId,
                    left: 0,
                    top: 0,
                    scaleX: 1,
                    scaleY: 1,
                    angle: 0,
                    flipX: false,
                    flipY: false,
                    initialLeft: 0,
                    initialTop: 0,
                    initialScaleX: 1,
                    initialScaleY: 1,
                    initialAngle: 0,
                    transparentCorners: false,
                    cornerColor: 'rgba(139, 92, 246, 0.8)',
                    borderColor: 'rgba(139, 92, 246, 0.8)',
                    cornerSize: 8,
                });
                canvas.remove(objToReplace);
                canvas.insertAt(oldZIndex, newImg);
                canvas.setActiveObject(newImg);
                clearLayerMask();
                canvas.renderAll();

                setLayersList(prev => prev.map(pl =>
                    pl.id === selectedLayerId
                        ? { ...pl, url: d.resultUrl, filename: d.resultUrl.split('/').pop(), width: d.width, height: d.height }
                        : pl
                ));
            }).catch(err => console.error('Error loading inpainted layer', err));
        } catch (e) {
            console.error(e);
            alert(e.message || 'Layer inpaint failed');
        } finally {
            setIsInpaintingLayer(false);
            setIsProcessingAI(false);
            setAiProcessingText('');
        }
    };

    const handleComposeLayers = async () => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;

        const layerMap = new Map(layersList.map(layer => [layer.id, layer]));
        const payloadLayers = canvas.getObjects()
            .filter(obj => obj.customId !== undefined && obj.customId !== null)
            .map((obj) => {
                const layer = layerMap.get(obj.customId);
                return {
                    id: obj.customId,
                    name: layer?.name,
                    filename: layer?.filename,
                    x: obj.left || 0,
                    y: obj.top || 0,
                    scaleX: obj.scaleX || 1,
                    scaleY: obj.scaleY || 1,
                    angle: obj.angle || 0,
                    flipX: !!obj.flipX,
                    flipY: !!obj.flipY,
                    opacity: obj.opacity ?? 1,
                    visible: obj.visible !== false,
                };
            })
            .filter(layer => layer.filename);

        if (!payloadLayers.length) return;

        setIsExportingLayers(true);
        try {
            const res = await fetch(`${API}/api/compose-layers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    layers: payloadLayers,
                    width: Math.round(canvas.getWidth()),
                    height: Math.round(canvas.getHeight()),
                    projectId: activeProject.id,
                    userId: user.id,
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Layer export failed');
            updateCreditsFromResponse(data);

            const link = document.createElement('a');
            link.href = `${API}${data.resultUrl}`;
            link.download = data.resultUrl.split('/').pop() || 'composed_layers.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (e) {
            console.error(e);
            alert(e.message || 'Layer export failed');
        } finally {
            setIsExportingLayers(false);
        }
    };

    const applyCanvasTransform = (transformType) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const obj = canvas.getActiveObject();
        if (!obj) return;

        if (transformType === 'flipH') {
            obj.set('flipX', !obj.flipX);
        } else if (transformType === 'flipV') {
            obj.set('flipY', !obj.flipY);
        } else if (transformType === 'rotRight') {
            obj.rotate((obj.angle || 0) + 90);
        } else if (transformType === 'rotLeft') {
            obj.rotate((obj.angle || 0) - 90);
        } else if (transformType === 'delete') {
            canvas.remove(obj);
            setLayersList(prev => prev.filter(l => l.id !== obj.customId));
        } else if (transformType === 'front') {
            canvas.remove(obj);
            canvas.add(obj);
            syncLayersListToCanvasOrder(canvas);
        } else if (transformType === 'back') {
            canvas.remove(obj);
            canvas.insertAt(0, obj);
            syncLayersListToCanvasOrder(canvas);
        }
        canvas.renderAll();
    };

    const toggleLayerVisibility = (id) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const obj = canvas.getObjects().find(o => o.customId === id);
        if (obj) {
            const isVisible = obj.visible !== false;
            obj.set('visible', !isVisible);
            canvas.renderAll();
            setLayersList(prev => prev.map(l => l.id === id ? { ...l, visible: !isVisible } : l));
        }
    };

    const toggleLayerLock = (id) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const obj = canvas.getObjects().find(o => o.customId === id);
        if (obj) {
            const isLocked = obj.lockMovementX === true;
            obj.set({
                lockMovementX: !isLocked,
                lockMovementY: !isLocked,
                lockRotation: !isLocked,
                lockScalingX: !isLocked,
                lockScalingY: !isLocked,
                selectable: !isLocked,
                evented: !isLocked
            });
            if (!isLocked) canvas.discardActiveObject();
            canvas.renderAll();
            setLayersList(prev => prev.map(l => l.id === id ? { ...l, locked: !isLocked } : l));
        }
    };

    const selectLayerFromPanel = (id) => {
        const canvas = canvasInstanceRef.current;
        if (!canvas) return;
        const obj = canvas.getObjects().find(o => o.customId === id);
        if (obj && !obj.lockMovementX) {
            canvas.setActiveObject(obj);
            canvas.renderAll();
        }
        setSelectedLayerId(id);
    };

    const applyQwenLayerDemo = (demo) => {
        setEditType(demo.type);
        setLayerEditPrompt(demo.prompt);

        if (selectedLayerId !== null || layersList.length === 0) return;

        const fallbackLayer = [...layersList].reverse().find(layer => layer.visible !== false && !layer.locked) || [...layersList].reverse()[0];
        if (fallbackLayer) selectLayerFromPanel(fallbackLayer.id);
    };


    const renderCanvasBlock = () => {
    return (
        <div className={`st-layer-editor ${isImageLayersFullscreen ? 'fullscreen' : ''}`}>
            {imageLayersResults.length > 0 ? (
                <>
                    <div className="st-qwen-layer-hero">
                        <div>
                            <div className="st-qwen-eyebrow">Qwen-Image-Layered</div>
                            <h2>Editable RGBA layers with physical isolation</h2>
                            <p>Decompose, recolor, revise, replace, resize, reposition, delete, and recursively split any selected layer.</p>
                        </div>
                        <button
                            className="st-layer-fullscreen-btn"
                            onClick={() => setIsImageLayersFullscreen(v => !v)}
                            title={isImageLayersFullscreen ? 'Exit fullscreen' : 'Fullscreen editor'}
                        >
                            <I d={isImageLayersFullscreen ? 'M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5' : 'M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5'} s={15} />
                            {isImageLayersFullscreen ? 'Exit' : 'Fullscreen'}
                        </button>
                        <div className="st-qwen-depth-preview" aria-hidden="true">
                            {[0, 1, 2, 3, 4].map(i => <span key={i} style={{ '--i': i }} />)}
                        </div>
                    </div>

                    <div className="st-qwen-demo-strip">
                        {qwenLayerDemoActions.map((demo) => (
                            <button
                                key={demo.label}
                                className={`st-qwen-demo-card ${editType === demo.type ? 'active' : ''}`}
                                onClick={() => applyQwenLayerDemo(demo)}
                                title={demo.prompt || demo.label}
                            >
                                <I d={demo.icon} s={15} />
                                <span>{demo.label}</span>
                                {demo.prompt ? <small>{demo.prompt}</small> : null}
                            </button>
                        ))}
                    </div>

                    <div className="st-layer-toolbar">
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('flipH')} title="Flip Horizontal">
                            <I d="M15 21h2v-2h-2v2zm4-12h2V7h-2v2zM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2zm16-2v2h2c0-1.1-.9-2-2-2zm-8 20h2V1h-2v22zm8-6h2v-2h-2v2zM15 5h2V3h-2v2zm4 8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2z" s={14} /> Flip H
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('flipV')} title="Flip Vertical">
                            <I d="M7 8v8h2V8H7zm4 0v8h2V8h-2zm4 0v8h2V8h-2z" s={14} /> Flip V
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('rotLeft')} title="Rotate Left 90 deg">
                            <I d="M10 4v4h-4l5-5 5 5h-4v4" s={14} /> Rot L
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('rotRight')} title="Rotate Right 90 deg">
                            <I d="M14 4v4h4l-5-5-5 5h4v4" s={14} /> Rot R
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('front')} title="Bring to Front">
                            <I d="M4 4h8v8H4V4zm10 10h6v6h-6v-6z" s={14} /> Front
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('back')} title="Send to Back">
                            <I d="M14 14h6v6h-6v-6zM4 4h8v8H4V4z" s={14} /> Back
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={() => applyCanvasTransform('delete')} title="Delete Selected">
                            <I d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" s={14} /> Del
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={resetLayersToBase} title="Reset all layers to original positions">
                            <I d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16M3 21v-5h5" s={14} /> Base
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={() => setImageLayerZoom(layerCanvasZoom - 0.15)} title="Zoom Out">
                            <I d="M5 12h14" s={14} /> Zoom
                        </button>
                        <div className="st-layer-zoom-readout">{Math.round(layerCanvasZoom * 100)}%</div>
                        <button className="st-layer-toolbar-btn" onClick={() => setImageLayerZoom(layerCanvasZoom + 0.15)} title="Zoom In">
                            <I d="M12 5v14M5 12h14" s={14} /> Zoom
                        </button>
                        <button className="st-layer-toolbar-btn" onClick={resetImageLayerView} title="Reset zoom and pan">
                            <I d="M4 4h16v16H4z" s={14} /> View
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className={`st-layer-toolbar-btn ${isLayerMaskMode ? 'active' : ''}`} onClick={() => setIsLayerMaskMode(v => !v)} title="Paint an inpaint mask">
                            <I d="M12 19l7-7 3 3-7 7H9v-6l10-10a2.1 2.1 0 00-3-3L6 13v6h6z" s={14} /> Brush
                        </button>
                        <div className="st-recursive-control st-mask-control">
                            <span>Size</span>
                            <input type="range" min="6" max="96" value={layerMaskBrushSize} onChange={(e) => setLayerMaskBrushSize(+e.target.value)} />
                            <strong>{layerMaskBrushSize}</strong>
                        </div>
                        <button className="st-layer-toolbar-btn" onClick={clearLayerMask} title="Clear painted inpaint mask">
                            <I d="M18 6L6 18M6 6l12 12" s={14} /> Clear Mask
                        </button>
                        <button className="st-layer-toolbar-btn st-qwen-action-btn" onClick={handleInpaintLayer} disabled={selectedLayerId === null || isProcessingAI || isInpaintingLayer || !layerEditPrompt.trim()} title="Inpaint only the painted mask on selected layer">
                            <I d="M3 21v-4l11-11 4 4L7 21H3z" s={14} /> {isInpaintingLayer ? 'Inpainting...' : 'Inpaint Mask'}
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <div className="st-recursive-control">
                            <span>Depth</span>
                            <input type="range" min="2" max="10" value={recursiveLayerCount} onChange={(e) => setRecursiveLayerCount(+e.target.value)} />
                            <strong>{recursiveLayerCount}</strong>
                        </div>
                        <button className="st-layer-toolbar-btn st-qwen-action-btn" onClick={handleRecursiveDecompose} disabled={selectedLayerId === null || isProcessingAI} title="Decompose selected layer again with Qwen">
                            <I d="M12 2L2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5" s={14} /> Decompose Selected
                        </button>
                        <div className="st-layer-toolbar-sep" />
                        <button className="st-layer-toolbar-btn" onClick={handleComposeLayers} disabled={isExportingLayers} title="Flatten ordered visible layers to PNG">
                            <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" s={14} /> {isExportingLayers ? 'Exporting...' : 'Flatten & Export PNG'}
                        </button>
                    </div>


            {/* Main Body */}
            <div className="st-layer-body">
                {/* Canvas */}
                <div className="st-layer-canvas-wrap checkerboard-bg">
                    <canvas ref={fabricCanvasRef} />
                    {isProcessingAI && (
                        <div className="st-processing-overlay">
                            <div className="st-spinner" style={{ width: 40, height: 40, borderWidth: 4, borderColor: 'rgba(59, 130, 246, 0.3)', borderTopColor: '#3b82f6' }} />
                            <div className="st-processing-text">{aiProcessingText}</div>
                        </div>
                    )}
                </div>

                {/* Layer Panel */}
                <div className="st-layer-panel">
                    <div className="st-layer-panel-title">LAYERS ({layersList.length})</div>
                    <div className="st-layer-panel-list">
                        {/* Reverse order so top layer is at top of list */}
                        {[...layersList].reverse().map((layer) => (
                            <div
                                key={layer.id}
                                className={`st-layer-panel-item ${selectedLayerId === layer.id ? 'selected' : ''} ${layerDragState.draggingId === layer.id ? 'dragging' : ''} ${layerDragState.overId === layer.id ? `drag-over-${layerDragState.position}` : ''}`}
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', String(layer.id));
                                    setLayerDragState({ draggingId: layer.id, overId: null, position: null });
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const position = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                                    setLayerDragState(prev => (
                                        prev.overId === layer.id && prev.position === position
                                            ? prev
                                            : { ...prev, overId: layer.id, position }
                                    ));
                                }}
                                onDragLeave={(e) => {
                                    if (!e.currentTarget.contains(e.relatedTarget)) {
                                        setLayerDragState(prev => ({ ...prev, overId: null, position: null }));
                                    }
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const draggedId = Number(e.dataTransfer.getData('text/plain'));
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const position = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                                    reorderLayerStack(draggedId, layer.id, position);
                                    setLayerDragState({ draggingId: null, overId: null, position: null });
                                }}
                                onDragEnd={() => setLayerDragState({ draggingId: null, overId: null, position: null })}
                                onClick={() => selectLayerFromPanel(layer.id)}
                            >
                                <div className="layer-num">{layer.id + 1}</div>
                                <img className="layer-thumb" src={`${API}${layer.url}`} alt={layer.name} draggable={false} />
                                <div className="layer-name">
                                    {layer.loadingName ? '...' : layer.name}
                                </div>
                                <button
                                    className={`st-layer-icon-btn ${!layer.visible ? 'off' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                                    title="Visibility"
                                >
                                    <I d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" s={14} />
                                </button>
                                <button
                                    className={`st-layer-icon-btn ${!layer.locked ? 'off' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }}
                                    title="Lock"
                                >
                                    {layer.locked
                                        ? <I d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" s={14} />
                                        : <I d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z" s={14} />}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="st-layer-prompt-bar st-qwen-prompt-bar">
                <div className="st-layer-prompt-chips">
                    <button className={`st-layer-prompt-chip ${editType === 'recolor' ? 'active' : ''}`} onClick={() => setEditType('recolor')}>Recolor</button>
                    <button className={`st-layer-prompt-chip ${editType === 'revise' ? 'active' : ''}`} onClick={() => setEditType('revise')}>Revise</button>
                    <button className={`st-layer-prompt-chip ${editType === 'replace' ? 'active' : ''}`} onClick={() => setEditType('replace')}>Replace</button>
                    <button className={`st-layer-prompt-chip ${editType === 'inpaint' ? 'active' : ''}`} onClick={() => setEditType('inpaint')}>Inpaint</button>
                    <button className={`st-layer-prompt-chip ${editType === 'remove' ? 'active' : ''}`} onClick={() => setEditType('remove')}>Remove</button>
                    <button className={`st-layer-prompt-chip ${editType === 'decompose' ? 'active' : ''}`} onClick={() => setEditType('decompose')}>Decompose</button>
                </div>
                <div className="st-layer-prompt-input-wrap">
                    <input
                        type="text"
                        className="st-layer-prompt-input"
                        placeholder={editType === 'recolor' ? 'e.g. "Change to navy blue"' : editType === 'revise' ? 'e.g. "Make it more detailed"' : editType === 'replace' ? 'e.g. "Replace with a rose"' : editType === 'inpaint' ? 'Paint a mask, then describe the local change' : editType === 'remove' ? 'Remove this layer element' : 'Recursively decompose this layer'}
                        value={layerEditPrompt}
                        onChange={(e) => setLayerEditPrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleEditLayer(); }}
                        disabled={selectedLayerId === null || isProcessingAI}
                    />
                    <button
                        className="st-layer-prompt-apply"
                        onClick={handleEditLayer}
                        disabled={selectedLayerId === null || isProcessingAI || (!layerEditPrompt.trim() && editType !== 'remove' && editType !== 'decompose')}
                    >
                        {isProcessingAI ? 'Processing...' : editType === 'decompose' ? 'Decompose' : editType === 'inpaint' ? 'Inpaint' : 'Apply'}
                    </button>
                </div>
            </div>
                </>
            ) : (
                <div className="st-layer-empty">
                    {isImageLayering ? (
                        <>
                            <div className="st-spinner" style={{ width: 32, height: 32, borderTopColor: '#67e8f9' }} />
                            <div>Qwen is decomposing image into {imageLayersNumLayers} RGBA layers...</div>
                            <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>The resulting layers can be isolated, edited, moved, resized, deleted, and decomposed again.</div>
                        </>
                    ) : (
                        <>
                            <div className="st-qwen-empty-visual" aria-hidden="true">
                                <div className="st-qwen-empty-card base">{preview ? <img src={preview} alt="" /> : null}</div>
                                {[0, 1, 2, 3].map(i => <div key={i} className="st-qwen-empty-card layer" style={{ '--i': i }} />)}
                            </div>
                            <div className="st-qwen-empty-title">Qwen-Image-Layered</div>
                            <div>Upload an image, choose a layer count, then decompose it into editable RGBA layers.</div>
                            <div className="st-qwen-demo-grid">
                                {qwenLayerDemoActions.map((demo) => (
                                    <button
                                        key={demo.label}
                                        className={`st-qwen-demo-card ${editType === demo.type ? 'active' : ''}`}
                                        onClick={() => applyQwenLayerDemo(demo)}
                                    >
                                        <I d={demo.icon} s={15} />
                                        <span>{demo.label}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="st-qwen-feature-row">
                                <span>Physical isolation</span>
                                <span>Natural-language edits</span>
                                <span>Recursive depth</span>
                                <span>Layer composition</span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );

    };

    const renderToolControls = () => {
        if (tool === 'imagelayers') return (
            <div className="st-ctrl">
                <div className="st-qwen-side-card">
                    <div className="st-qwen-eyebrow">Qwen model stack</div>
                    <strong>Layered decomposition + Qwen layer editing</strong>
                    <p>Qwen-native layer decomposition and isolated natural-language edits power this workspace.</p>
                </div>
                <div className="st-settings-group">
                    <div className="st-group-title">QWEN DEMO ACTIONS</div>
                    <div className="st-qwen-demo-grid compact">
                        {qwenLayerDemoActions.map((demo) => (
                            <button
                                key={demo.label}
                                className={`st-qwen-demo-card ${editType === demo.type ? 'active' : ''}`}
                                onClick={() => applyQwenLayerDemo(demo)}
                            >
                                <I d={demo.icon} s={14} />
                                <span>{demo.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="st-settings-group">
                    <div className="st-group-title">LAYER SETTINGS</div>
                    <label className="st-label">Number of Layers</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input type="range" min="2" max="10" value={imageLayersNumLayers} onChange={(e) => setImageLayersNumLayers(+e.target.value)} className="st-range" style={{ flex: 1 }} />
                        <span style={{ fontWeight: 600, fontSize: '1rem', color: '#6366f1', minWidth: '24px', textAlign: 'center' }}>{imageLayersNumLayers}</span>
                    </div>
                    <div className="st-range-labels"><span>2 layers</span><span>10 layers</span></div>
                </div>
                <div className="st-settings-group" style={{ marginTop: '0.75rem' }}>
                    <label className="st-label">Description</label>
                    <input
                        type="text"
                        value={imageLayersDescription}
                        onChange={(e) => setImageLayersDescription(e.target.value)}
                        placeholder="'auto' for AI caption, or describe the image"
                        style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', fontFamily: 'inherit', background: '#f8fafc' }}
                    />
                    <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem' }}>Use "auto" to let AI describe the image, or provide your own description for better results.</p>
                </div>
                <div className="st-qwen-side-features">
                    <span><I d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" s={13} /> Variable layer count</span>
                    <span><I d="M4 4h16v16H4zM9 9h6v6H9z" s={13} /> Recursive decomposition</span>
                    <span><I d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" s={13} /> Recolor, revise, replace</span>
                    <span><I d="M5 9l7-7 7 7M5 15l7 7 7-7" s={13} /> Move and resize layers</span>
                </div>
                <button
                    className={`st-export-btn ${!hasEnoughImageLayersCredits ? 'insufficient-credits' : ''}`}
                    onClick={generateImageLayers}
                    disabled={isImageLayering || !uploaded || !hasEnoughImageLayersCredits}
                    title={!hasEnoughImageLayersCredits ? `Need ${imageLayersCreditCost} credits. You have ${userRemainingCredits} remaining.` : 'Decompose image into layers'}
                    style={{ marginTop: '1rem' }}
                >
                    {isImageLayering ? 'Qwen Decomposing...' : hasEnoughImageLayersCredits ? `Qwen Decompose into ${imageLayersNumLayers} Layers` : `Need ${imageLayersCreditCost} credits`}
                </button>
                <p className="st-generate-hint"><I d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" s={12} /> Uses ~{imageLayersCreditCost} credits</p>
                {!hasEnoughImageLayersCredits && (
                    <div className="st-credit-shortage">
                        {userRemainingCredits.toLocaleString()} credits remaining. Recharge to use Image Layers.
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
