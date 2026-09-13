import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as fabric from 'fabric';
import { I } from '../shared/StudioIcons';
import { apiFetch, cacheMediaFromResponse, forceDownload, mediaUrl, openFileInTool, resolveMediaUrl } from '../shared/helpers';
import MediaImg from '../shared/MediaImg';
import ImageDropzone from '../shared/ImageDropzone';
import UploadStatusBadge from '../shared/UploadStatusBadge';
import { useResultUrls } from '../../../stores/resultUrls';
import { deltaEQuality, normalizeHex } from '../shared/shadeCardImport';
import {
    BASE_SWATCHES,
    MAX_LAYERS,
    clampSize,
    clearDraft,
    createDocument,
    fitView,
    layerToView,
    loadDraft,
    makeLayerFromMotif,
    moveLayer,
    repeatAlongEdge,
    saveDraft,
    serializeForCompose,
    viewToLayer,
} from '../shared/placementDocument';
import '../../../styles/tools/embroidery.css';

const ICON = {
    flipH: 'M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4',
    flipV: 'M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4',
    rotL: 'M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8M21 3v5h-5',
    rotR: 'M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5',
    up: 'M12 19V5M5 12l7-7 7 7',
    down: 'M12 5v14M19 12l-7 7-7-7',
    copy: 'M8 8h12v12H8zM4 16V4h12',
    trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
    eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.1A11 11 0 0123 12a17 17 0 01-3.2 3.9M6.6 6.6A17 17 0 001 12s4 7 11 7a11 11 0 004.1-.8',
    lock: 'M6 11V8a6 6 0 1112 0v3M5 11h14v10H5z',
    unlock: 'M6 11V8a6 6 0 0111.3-2.8M5 11h14v10H5z',
    zoomIn: 'M12 5v14M5 12h14',
    zoomOut: 'M5 12h14',
    fit: 'M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6',
    download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
    plus: 'M12 5v14M5 12h14',
    thread: 'M6 4h12M6 20h12M8 4v16M16 4v16M8 9h8M8 13h8M8 17h8',
    repeat: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    send: 'M5 12h14M13 6l6 6-6 6',
};

const EDGES = [
    { id: 'bottom', label: 'Bottom border' },
    { id: 'top', label: 'Top border' },
    { id: 'left', label: 'Left edge' },
    { id: 'right', label: 'Right edge' },
];

const TECHNIQUE_LABELS = { applique: 'Appliqué' };
const techniqueLabel = (value) => TECHNIQUE_LABELS[value] || value;

async function loadFabricImage(path, token) {
    const url = await resolveMediaUrl(path, token);
    return fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
}

function readImageSize(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('Could not read the image size'));
        img.src = url;
    });
}

function isServerPath(url) {
    return typeof url === 'string' && (url.startsWith('/results/') || url.startsWith('/uploads/'));
}

/**
 * Placement Studio: put embroidery, lace, brocade and zari motifs on a print, a solid or a
 * fabric swatch. The document (document pixels, centre-origin layers) is the single source of
 * truth; the Fabric canvas is a view of it, and the server flattens the same document.
 */
export default function PlacementStudioTool(props) {
    const {
        uploaded, preview, uploadStatus, activeProject, user, currentToken, creditPricing, rightPanelEl,
        setError, setNotice, setTool, setUploads, setState, tool, updateCreditsFromResponse,
        handlePreUpload, onUploadInvalid, onUploadPaste,
    } = props;

    const projectId = activeProject?.id;
    const [doc, setDoc] = useState(() => loadDraft(projectId) || createDocument());
    const [selectedId, setSelectedId] = useState(null);
    const [viewSize, setViewSize] = useState({ width: 900, height: 600 });
    const [zoom, setZoom] = useState(1);
    const [panel, setPanel] = useState('base');
    const [motifs, setMotifs] = useState([]);
    const [motifsLoaded, setMotifsLoaded] = useState(false);
    const [motifFilter, setMotifFilter] = useState('all');
    const [repeatEdge, setRepeatEdge] = useState('bottom');
    const [repeatCount, setRepeatCount] = useState(5);
    const [recolor, setRecolor] = useState(null);
    const [isComposing, setIsComposing] = useState(false);
    const [result, setResult] = useState(null);

    const pendingMotif = useResultUrls((state) => state.pendingMotif);
    const clearPendingMotif = useResultUrls((state) => state.clearPendingMotif);
    const setLastPlacementResult = useResultUrls((state) => state.setLastPlacementResult);

    const wrapRef = useRef(null);
    const canvasElRef = useRef(null);
    const canvasRef = useRef(null);
    const objectsRef = useRef(new Map());
    const loadingRef = useRef(new Map());
    const baseRef = useRef(null);
    const docRef = useRef(doc);
    const viewRef = useRef(null);
    const selectedRef = useRef(null);

    const view = useMemo(
        () => fitView(doc.width, doc.height, viewSize.width, viewSize.height),
        [doc.width, doc.height, viewSize.width, viewSize.height],
    );
    const selectedLayer = doc.layers.find((layer) => layer.id === selectedId) || null;
    const composeCost = creditPricing?.placementCompose || 5;
    const recolorCost = creditPricing?.recolor || 3;
    const remainingCredits = Math.max(0, (user?.creditsLimit || 0) - (user?.creditsUsed || 0));
    const uploadReady = Boolean(uploaded?.filename) && uploadStatus === 'ready';

    useEffect(() => {
        docRef.current = doc;
        viewRef.current = view;
        selectedRef.current = selectedId;
    }, [doc, view, selectedId]);

    // Drafts survive tool switches and reloads, per project.
    useEffect(() => { saveDraft(projectId, doc); }, [doc, projectId]);

    // ---- document mutations -------------------------------------------------------------
    const updateLayer = (id, patch) => setDoc((prev) => ({
        ...prev,
        layers: prev.layers.map((layer) => (layer.id === id ? { ...layer, ...(typeof patch === 'function' ? patch(layer) : patch) } : layer)),
    }));

    const addLayers = (newLayers) => {
        const room = MAX_LAYERS - doc.layers.length;
        if (room <= 0) {
            setError(`A placement can hold at most ${MAX_LAYERS} motifs.`);
            return;
        }
        const accepted = newLayers.slice(0, room);
        setDoc((prev) => ({ ...prev, layers: [...prev.layers, ...accepted] }));
        if (accepted[0]) setSelectedId(accepted[0].id);
        setPanel('layer');
    };

    const removeLayer = (id) => {
        setDoc((prev) => ({ ...prev, layers: prev.layers.filter((layer) => layer.id !== id) }));
        if (selectedRef.current === id) setSelectedId(null);
    };

    const duplicateLayer = (layer) => {
        const copy = { ...layer, id: `${layer.id}c${Date.now().toString(36)}`, name: `${layer.name} copy`, x: layer.x + doc.width * 0.05, y: layer.y + doc.height * 0.05, locked: false };
        addLayers([copy]);
    };

    const setBase = (base) => setDoc((prev) => ({ ...prev, base }));

    const setDocSize = (key, value) => setDoc((prev) => ({ ...prev, [key]: clampSize(value, prev[key]) }));

    const applyImageBase = async (filename, url) => {
        try {
            const size = await readImageSize(mediaUrl(url));
            const longest = Math.max(size.width, size.height);
            const factor = longest > 4000 ? 4000 / longest : 1;
            setDoc((prev) => ({
                ...prev,
                width: clampSize(size.width * factor),
                height: clampSize(size.height * factor),
                base: { kind: 'image', filename, url },
            }));
            setNotice?.('Base set to your print. Motifs keep their positions.');
        } catch (error) {
            setError(error.message || 'Could not use that image as the base');
        }
    };

    const startNewDesign = () => {
        if (doc.layers.length && !window.confirm('Start a new placement? The current layers will be cleared.')) return;
        clearDraft(projectId);
        setDoc(createDocument());
        setSelectedId(null);
        setResult(null);
        setRecolor(null);
    };

    // ---- pending motif from the library ------------------------------------------------------
    useEffect(() => {
        if (!pendingMotif) return undefined;
        const timer = window.setTimeout(() => {
            addLayers([makeLayerFromMotif(pendingMotif, docRef.current)]);
            clearPendingMotif?.();
        }, 0);
        return () => window.clearTimeout(timer);
        // addLayers is stable enough for this one-shot handoff; it only reads refs and calls setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingMotif, clearPendingMotif]);

    // ---- motif library for the picker ---------------------------------------------------------
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await apiFetch('/api/motifs', {}, currentToken);
                if (cancelled) return;
                if (!data.success) throw new Error(data.error || 'Could not load motifs');
                (data.motifs || []).forEach((motif) => cacheMediaFromResponse({ filename: motif.filename, fileAccessToken: motif.fileAccessToken }));
                setMotifs(data.motifs || []);
            } catch (error) {
                if (!cancelled) setError(error.message || 'Could not load motifs');
            } finally {
                if (!cancelled) setMotifsLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [currentToken, setError]);

    // ---- Fabric canvas lifecycle ------------------------------------------------------------
    useEffect(() => {
        const el = canvasElRef.current;
        const wrap = wrapRef.current;
        if (!el || !wrap) return undefined;

        const canvas = new fabric.Canvas(el, { preserveObjectStacking: true, selection: false });
        canvasRef.current = canvas;
        const objects = objectsRef.current;
        const loading = loadingRef.current;

        const readLayerId = (event) => event?.selected?.[0]?.layerId ?? null;
        canvas.on('selection:created', (event) => setSelectedId(readLayerId(event)));
        canvas.on('selection:updated', (event) => setSelectedId(readLayerId(event)));
        canvas.on('selection:cleared', () => setSelectedId(null));
        canvas.on('object:modified', (event) => {
            const obj = event.target;
            if (!obj?.layerId) return;
            const patch = viewToLayer(obj, viewRef.current);
            setDoc((prev) => ({ ...prev, layers: prev.layers.map((layer) => (layer.id === obj.layerId ? { ...layer, ...patch } : layer)) }));
        });

        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver((entries) => {
                const rect = entries[0]?.contentRect;
                if (!rect) return;
                setViewSize({ width: Math.max(320, Math.floor(rect.width)), height: Math.max(280, Math.floor(rect.height)) });
            });
            observer.observe(wrap);
        }

        return () => {
            observer?.disconnect();
            canvas.dispose();
            canvasRef.current = null;
            objects.clear();
            loading.clear();
            baseRef.current = null;
        };
    }, []);

    // Keep the canvas a faithful view of the document.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (canvas.getWidth() !== viewSize.width || canvas.getHeight() !== viewSize.height) {
            canvas.setDimensions({ width: viewSize.width, height: viewSize.height });
        }

        const orderObjects = () => {
            const offset = baseRef.current ? 1 : 0;
            if (baseRef.current) canvas.moveObjectTo(baseRef.current, 0);
            docRef.current.layers.forEach((layer, index) => {
                const obj = objectsRef.current.get(layer.id);
                if (obj) canvas.moveObjectTo(obj, index + offset);
            });
        };

        const applyLayerProps = (obj, layer, currentView) => {
            const locked = Boolean(layer.locked);
            obj.set({
                ...layerToView(layer, currentView),
                visible: layer.visible !== false,
                selectable: !locked,
                evented: !locked,
                lockMovementX: locked,
                lockMovementY: locked,
                lockRotation: locked,
                lockScalingX: locked,
                lockScalingY: locked,
            });
            obj.setCoords();
        };

        const layoutBase = (obj, currentDoc, currentView) => {
            const w = currentDoc.width * currentView.scale;
            const h = currentDoc.height * currentView.scale;
            obj.set({
                left: currentView.offsetX + w / 2,
                top: currentView.offsetY + h / 2,
                scaleX: w / (obj.width || 1),
                scaleY: h / (obj.height || 1),
            });
            obj.setCoords();
        };

        // Base fabric
        const base = doc.base || {};
        const baseKey = base.kind === 'image' ? `image:${base.filename}` : 'fill';
        if (baseRef.current && baseRef.current.baseKey !== baseKey) {
            canvas.remove(baseRef.current);
            baseRef.current = null;
        }
        if (base.kind === 'image') {
            if (baseRef.current) {
                layoutBase(baseRef.current, doc, view);
            } else if (loadingRef.current.get('__base') !== baseKey) {
                loadingRef.current.set('__base', baseKey);
                loadFabricImage(base.url || `/uploads/${base.filename}`, currentToken).then((img) => {
                    loadingRef.current.delete('__base');
                    const current = canvasRef.current;
                    const currentBase = docRef.current.base;
                    if (!current || !currentBase || currentBase.kind !== 'image' || currentBase.filename !== base.filename) return;
                    img.set({ baseKey, originX: 'center', originY: 'center', selectable: false, evented: false });
                    baseRef.current = img;
                    current.add(img);
                    layoutBase(img, docRef.current, viewRef.current);
                    orderObjects();
                    current.requestRenderAll();
                }).catch(() => {
                    loadingRef.current.delete('__base');
                    setError('Could not load the base image');
                });
            }
        } else {
            const w = doc.width * view.scale;
            const h = doc.height * view.scale;
            if (!baseRef.current) {
                const rect = new fabric.Rect({ baseKey, originX: 'center', originY: 'center', selectable: false, evented: false, strokeWidth: 0 });
                baseRef.current = rect;
                canvas.add(rect);
            }
            baseRef.current.set({ left: view.offsetX + w / 2, top: view.offsetY + h / 2, width: w, height: h, scaleX: 1, scaleY: 1, fill: base.color || '#f7f4ee' });
            baseRef.current.setCoords();
        }

        // Layers
        const liveIds = new Set(doc.layers.map((layer) => layer.id));
        objectsRef.current.forEach((obj, id) => {
            if (!liveIds.has(id)) {
                canvas.remove(obj);
                objectsRef.current.delete(id);
            }
        });
        doc.layers.forEach((layer) => {
            const existing = objectsRef.current.get(layer.id);
            if (existing && existing.loadedFilename === layer.filename) {
                applyLayerProps(existing, layer, view);
                return;
            }
            if (existing) {
                canvas.remove(existing);
                objectsRef.current.delete(layer.id);
            }
            if (loadingRef.current.get(layer.id) === layer.filename) return;
            loadingRef.current.set(layer.id, layer.filename);
            loadFabricImage(layer.url || `/results/${layer.filename}`, currentToken).then((img) => {
                if (loadingRef.current.get(layer.id) === layer.filename) loadingRef.current.delete(layer.id);
                const current = canvasRef.current;
                if (!current) return;
                const liveLayer = docRef.current.layers.find((item) => item.id === layer.id);
                if (!liveLayer || liveLayer.filename !== layer.filename) return;
                img.set({
                    layerId: layer.id,
                    loadedFilename: layer.filename,
                    originX: 'center',
                    originY: 'center',
                    transparentCorners: false,
                    cornerColor: '#f43f5e',
                    cornerStrokeColor: '#ffffff',
                    borderColor: '#f43f5e',
                    cornerSize: 9,
                    padding: 2,
                });
                applyLayerProps(img, liveLayer, viewRef.current);
                objectsRef.current.set(layer.id, img);
                current.add(img);
                orderObjects();
                if (selectedRef.current === layer.id && img.selectable) current.setActiveObject(img);
                current.requestRenderAll();
            }).catch(() => {
                loadingRef.current.delete(layer.id);
                setError(`Could not load motif "${layer.name}"`);
            });
        });
        orderObjects();

        // Selection
        const active = canvas.getActiveObject();
        if (selectedId) {
            const obj = objectsRef.current.get(selectedId);
            if (obj && active !== obj && obj.selectable) canvas.setActiveObject(obj);
        } else if (active) {
            canvas.discardActiveObject();
        }
        canvas.requestRenderAll();
    }, [doc, view, viewSize, selectedId, currentToken, setError]);

    // Zoom is a pure view transform: object coordinates stay in canvas space.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        if (zoom !== 1) canvas.zoomToPoint(new fabric.Point(viewSize.width / 2, viewSize.height / 2), zoom);
        canvas.requestRenderAll();
    }, [zoom, viewSize]);

    // ---- recolor to thread ------------------------------------------------------------------
    const openRecolor = async (layer) => {
        setRecolor({ layerId: layer.id, rows: [], cards: [], cardId: '', busy: true });
        try {
            const [palette, cards] = await Promise.all([
                apiFetch('/api/extract-palette', { method: 'POST', body: JSON.stringify({ filename: layer.filename, numColors: 4 }) }, currentToken),
                apiFetch('/api/shade-cards', {}, currentToken),
            ]);
            if (!palette.success) throw new Error(palette.error || 'Could not read the motif colours');
            const rows = (palette.palette || []).map((entry) => ({ old: normalizeHex(entry.hex), new: normalizeHex(entry.hex), weight: entry.weight, code: '', deltaE: null }));
            const list = cards.cards || [];
            const thread = list.find((card) => card.kind === 'thread');
            setRecolor({ layerId: layer.id, rows, cards: list, cardId: thread?.id || list[0]?.id || '', busy: false });
        } catch (error) {
            setError(error.message || 'Could not start recolour');
            setRecolor(null);
        }
    };

    const matchRecolorToCard = async () => {
        if (!recolor?.cardId || !recolor.rows.length) return;
        setRecolor((prev) => ({ ...prev, busy: true }));
        try {
            const data = await apiFetch('/api/shade-cards/match', {
                method: 'POST',
                body: JSON.stringify({ cardId: recolor.cardId, colors: recolor.rows.map((row) => row.old), topN: 1 }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Matching failed');
            const byHex = {};
            data.results.forEach((entry) => { byHex[entry.hex] = entry.matches?.[0]; });
            setRecolor((prev) => ({
                ...prev,
                busy: false,
                rows: prev.rows.map((row) => {
                    const match = byHex[row.old];
                    return match ? { ...row, new: match.hex, code: `${match.code}${match.name ? ` ${match.name}` : ''}`, deltaE: match.deltaE } : row;
                }),
            }));
        } catch (error) {
            setError(error.message || 'Matching failed');
            setRecolor((prev) => (prev ? { ...prev, busy: false } : prev));
        }
    };

    const applyRecolor = async () => {
        const layer = docRef.current.layers.find((item) => item.id === recolor?.layerId);
        if (!layer) return;
        if (remainingCredits < recolorCost) {
            setError(`Recolour needs ${recolorCost} credits, but you have ${remainingCredits} remaining.`);
            return;
        }
        setRecolor((prev) => ({ ...prev, busy: true }));
        try {
            const data = await apiFetch('/api/recolor', {
                method: 'POST',
                body: JSON.stringify({
                    filename: layer.filename,
                    colorMapping: recolor.rows.map((row) => ({ old: row.old, new: normalizeHex(row.new) || row.old })),
                    projectId,
                    userId: user?.id,
                }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Recolour failed');
            cacheMediaFromResponse(data);
            updateCreditsFromResponse?.(data);
            const filename = String(data.resultUrl || '').split('/').pop();
            updateLayer(layer.id, { filename, url: data.resultUrl, fileAccessToken: data.fileAccessToken });
            setRecolor(null);
            setNotice?.(`Recoloured "${layer.name}"`);
        } catch (error) {
            setError(error.message || 'Recolour failed');
            setRecolor((prev) => (prev ? { ...prev, busy: false } : prev));
        }
    };

    // ---- flatten ----------------------------------------------------------------------------
    const flatten = async () => {
        if (!doc.layers.some((layer) => layer.visible !== false)) {
            setError('Add at least one visible motif before flattening.');
            return;
        }
        if (remainingCredits < composeCost) {
            setError(`Flatten needs ${composeCost} credits, but you have ${remainingCredits} remaining.`);
            return;
        }
        setIsComposing(true);
        try {
            const data = await apiFetch('/api/placement/compose', {
                method: 'POST',
                body: JSON.stringify({ projectId, userId: user?.id, document: serializeForCompose(doc) }),
            }, currentToken);
            if (!data.success) throw new Error(data.error || 'Flatten failed');
            cacheMediaFromResponse(data);
            updateCreditsFromResponse?.(data);
            setResult(data);
            setLastPlacementResult?.({ url: data.resultUrl, filename: data.filename, fileAccessToken: data.fileAccessToken, width: data.width, height: data.height });
            setPanel('export');
            setNotice?.(`Flattened ${data.layersRendered} motif${data.layersRendered === 1 ? '' : 's'} at ${data.width}×${data.height}`);
        } catch (error) {
            setError(error.message || 'Flatten failed');
        } finally {
            setIsComposing(false);
        }
    };

    const saveToProject = () => {
        if (!result || typeof setState !== 'function') return;
        setState((state) => ({
            ...state,
            activeProject: { ...state.activeProject, heroImageUrl: result.resultUrl },
            variations: [
                { id: Date.now(), name: 'Placement', imageUrl: result.resultUrl, isSelected: true },
                ...(state.variations || []).map((variation) => ({ ...variation, isSelected: false })),
            ],
        }));
        setNotice?.('Saved to project versions');
    };

    const sendToMappings = () => {
        if (!result) return;
        openFileInTool({ url: result.resultUrl, filename: result.filename }, 'mappings', { setTool, setUploads, tool });
    };

    // ---- derived -----------------------------------------------------------------------------
    const motifTechniques = useMemo(() => Array.from(new Set(motifs.map((motif) => motif.technique))), [motifs]);
    const visibleMotifs = motifFilter === 'all' ? motifs : motifs.filter((motif) => motif.technique === motifFilter);
    const heroPath = isServerPath(activeProject?.heroImageUrl) ? activeProject.heroImageUrl : null;

    // ---- render helpers ----------------------------------------------------------------------
    const renderBasePanel = () => (
        <div className="emb-side-section">
            <h3 className="emb-side-title">Fabric swatch</h3>
            <div className="emb-swatch-grid">
                {BASE_SWATCHES.map((swatch) => (
                    <button
                        key={swatch.id}
                        type="button"
                        className={`emb-swatch-btn${doc.base?.kind === 'swatch' && doc.base?.swatch === swatch.id ? ' is-active' : ''}`}
                        onClick={() => setBase({ kind: 'swatch', swatch: swatch.id, color: swatch.color })}
                    >
                        <span className="dot" style={{ background: swatch.color }} />
                        {swatch.label}
                    </button>
                ))}
            </div>

            <h3 className="emb-side-title">Solid colour</h3>
            <div className="emb-field-row">
                <input type="color" className="emb-color-input" value={normalizeHex(doc.base?.color) || '#f7f4ee'} onChange={(e) => setBase({ kind: 'solid', color: e.target.value })} aria-label="Solid base colour" />
                <input className="emb-input is-mono" value={doc.base?.kind === 'image' ? '' : (doc.base?.color || '')} placeholder="#hex" onChange={(e) => { const hex = normalizeHex(e.target.value); if (hex) setBase({ kind: 'solid', color: hex }); }} aria-label="Solid base hex" style={{ width: 110 }} />
            </div>

            <h3 className="emb-side-title">Print as base</h3>
            {preview ? (
                <div className="emb-upload-thumb">
                    <img src={preview} alt="Uploaded print" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <strong>{uploaded?.originalName || 'Uploaded print'}</strong>
                        <UploadStatusBadge status={uploadStatus} />
                    </div>
                </div>
            ) : (
                <ImageDropzone
                    variant="compact"
                    title="Upload a print"
                    description="Drag, paste or click"
                    onFile={handlePreUpload}
                    onInvalidFile={onUploadInvalid}
                    onPasteSuccess={onUploadPaste}
                    uploadStatus={uploadStatus}
                />
            )}
            <div className="emb-field-row">
                <button type="button" className="emb-btn is-small" disabled={!uploadReady} onClick={() => applyImageBase(uploaded.filename, `/uploads/${uploaded.filename}`)}>Use uploaded print</button>
                {heroPath && (
                    <button type="button" className="emb-btn is-small" onClick={() => applyImageBase(heroPath.split('/').pop(), heroPath)}>Use project image</button>
                )}
            </div>

            <h3 className="emb-side-title">Document size</h3>
            <div className="emb-field-row">
                <input className="emb-input" type="number" min="64" max="6000" value={doc.width} disabled={doc.base?.kind === 'image'} onChange={(e) => setDocSize('width', e.target.value)} aria-label="Document width" style={{ width: 96 }} />
                <span style={{ color: 'var(--muted)' }}>×</span>
                <input className="emb-input" type="number" min="64" max="6000" value={doc.height} disabled={doc.base?.kind === 'image'} onChange={(e) => setDocSize('height', e.target.value)} aria-label="Document height" style={{ width: 96 }} />
                <span className="emb-hint">px</span>
            </div>
            {doc.base?.kind === 'image' && <p className="emb-hint">Size follows the print. Choose a swatch or solid to edit it.</p>}
        </div>
    );

    const renderMotifsPanel = () => (
        <div className="emb-side-section">
            <div className="emb-panel-title" style={{ justifyContent: 'space-between' }}>
                <strong>Add from library</strong>
                <button type="button" className="emb-btn is-small" onClick={() => setTool?.('emb-motifs')}>Manage</button>
            </div>
            {motifTechniques.length > 1 && (
                <div className="emb-chips">
                    {['all', ...motifTechniques].map((value) => (
                        <button key={value} type="button" className={`emb-chip${motifFilter === value ? ' is-active' : ''}`} onClick={() => setMotifFilter(value)} style={{ minHeight: 30, fontSize: '0.72rem' }}>
                            {value === 'all' ? 'All' : techniqueLabel(value)}
                        </button>
                    ))}
                </div>
            )}
            {!motifsLoaded ? (
                <p className="emb-hint">Loading your library…</p>
            ) : visibleMotifs.length === 0 ? (
                <div className="emb-empty" style={{ padding: '1.25rem 0.75rem' }}>
                    <strong>No motifs yet</strong>
                    Upload laces, borders and motifs in the Motif Library first.
                    <button type="button" className="emb-btn is-small is-primary" onClick={() => setTool?.('emb-motifs')}>Open Motif Library</button>
                </div>
            ) : (
                <div className="emb-motif-picker">
                    {visibleMotifs.map((motif) => (
                        <button key={motif.id} type="button" className="emb-motif-pick" onClick={() => addLayers([makeLayerFromMotif(motif, doc)])} title={`Add ${motif.name}`}>
                            <span className="emb-motif-thumb"><MediaImg src={motif.url} alt="" token={currentToken} accessToken={motif.fileAccessToken} loading="lazy" /></span>
                            <span className="emb-motif-name">{motif.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    const renderLayerPanel = () => (
        <div className="emb-side-section">
            {selectedLayer ? (
                <>
                    <input className="emb-input" value={selectedLayer.name} onChange={(e) => updateLayer(selectedLayer.id, { name: e.target.value })} aria-label="Layer name" />
                    <div className="emb-icon-row" aria-label="Transform">
                        <button type="button" className="emb-btn" title="Flip horizontal" onClick={() => updateLayer(selectedLayer.id, (l) => ({ flipX: !l.flipX }))}><I d={ICON.flipH} s={15} /></button>
                        <button type="button" className="emb-btn" title="Flip vertical" onClick={() => updateLayer(selectedLayer.id, (l) => ({ flipY: !l.flipY }))}><I d={ICON.flipV} s={15} /></button>
                        <button type="button" className="emb-btn" title="Rotate 90° left" onClick={() => updateLayer(selectedLayer.id, (l) => ({ angle: ((l.angle || 0) - 90 + 360) % 360 }))}><I d={ICON.rotL} s={15} /></button>
                        <button type="button" className="emb-btn" title="Rotate 90° right" onClick={() => updateLayer(selectedLayer.id, (l) => ({ angle: ((l.angle || 0) + 90) % 360 }))}><I d={ICON.rotR} s={15} /></button>
                        <button type="button" className="emb-btn" title="Bring forward" onClick={() => setDoc((prev) => ({ ...prev, layers: moveLayer(prev.layers, selectedLayer.id, 'up') }))}><I d={ICON.up} s={15} /></button>
                        <button type="button" className="emb-btn" title="Send backward" onClick={() => setDoc((prev) => ({ ...prev, layers: moveLayer(prev.layers, selectedLayer.id, 'down') }))}><I d={ICON.down} s={15} /></button>
                        <button type="button" className="emb-btn" title="Duplicate" onClick={() => duplicateLayer(selectedLayer)}><I d={ICON.copy} s={15} /></button>
                        <button type="button" className="emb-btn" title={selectedLayer.locked ? 'Unlock' : 'Lock'} onClick={() => updateLayer(selectedLayer.id, (l) => ({ locked: !l.locked }))}><I d={selectedLayer.locked ? ICON.lock : ICON.unlock} s={15} /></button>
                        <button type="button" className="emb-btn" title={selectedLayer.visible === false ? 'Show' : 'Hide'} onClick={() => updateLayer(selectedLayer.id, (l) => ({ visible: l.visible === false }))}><I d={selectedLayer.visible === false ? ICON.eyeOff : ICON.eye} s={15} /></button>
                        <button type="button" className="emb-btn is-danger" title="Delete" onClick={() => removeLayer(selectedLayer.id)}><I d={ICON.trash} s={15} /></button>
                    </div>
                    <label className="emb-field">
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)' }}>Opacity {Math.round((selectedLayer.opacity ?? 1) * 100)}%</span>
                        <input className="emb-range" type="range" min="10" max="100" value={Math.round((selectedLayer.opacity ?? 1) * 100)} onChange={(e) => updateLayer(selectedLayer.id, { opacity: Number(e.target.value) / 100 })} />
                    </label>
                    <p className="emb-hint">
                        {Math.round(selectedLayer.width * Math.abs(selectedLayer.scaleX ?? 1))}×{Math.round(selectedLayer.height * Math.abs(selectedLayer.scaleY ?? 1))} px on the document · centre {Math.round(selectedLayer.x)}, {Math.round(selectedLayer.y)} · {Math.round(selectedLayer.angle || 0)}°
                    </p>

                    <h3 className="emb-side-title">Repeat along an edge</h3>
                    <div className="emb-field-row">
                        <select className="emb-select" value={repeatEdge} onChange={(e) => setRepeatEdge(e.target.value)} aria-label="Edge">
                            {EDGES.map((edge) => <option key={edge.id} value={edge.id}>{edge.label}</option>)}
                        </select>
                        <input className="emb-input" type="number" min="2" max="40" value={repeatCount} onChange={(e) => setRepeatCount(Math.max(2, Math.min(40, Number(e.target.value) || 2)))} aria-label="Repeat count" style={{ width: 72 }} />
                        <button type="button" className="emb-btn" onClick={() => addLayers(repeatAlongEdge(doc, selectedLayer, { edge: repeatEdge, count: repeatCount }))}>
                            <I d={ICON.repeat} s={14} /> Repeat
                        </button>
                    </div>

                    <h3 className="emb-side-title">Thread colour</h3>
                    {recolor && recolor.layerId === selectedLayer.id ? (
                        <div className="emb-side-section">
                            {recolor.busy && recolor.rows.length === 0 ? <p className="emb-hint">Reading motif colours…</p> : (
                                <>
                                    <div className="emb-field-row">
                                        <select className="emb-select" value={recolor.cardId} onChange={(e) => setRecolor((prev) => ({ ...prev, cardId: e.target.value }))} aria-label="Shade card" style={{ flex: 1 }}>
                                            {recolor.cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
                                        </select>
                                        <button type="button" className="emb-btn is-small" onClick={matchRecolorToCard} disabled={recolor.busy}>Match to card</button>
                                    </div>
                                    {recolor.rows.map((row, index) => {
                                        const quality = row.deltaE != null ? deltaEQuality(row.deltaE) : null;
                                        return (
                                            <div key={row.old} className="emb-recolor-row">
                                                <span className="emb-swatch is-small" style={{ background: row.old }} title={row.old} />
                                                <input type="color" className="emb-color-input" style={{ width: 30, height: 30 }} value={normalizeHex(row.new) || row.old} onChange={(e) => setRecolor((prev) => ({ ...prev, rows: prev.rows.map((r, i) => (i === index ? { ...r, new: e.target.value, code: '', deltaE: null } : r)) }))} aria-label={`New colour for ${row.old}`} />
                                                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {row.code || row.new}
                                                    {quality && <span className={`emb-quality is-${quality.tone}`} style={{ marginLeft: 6 }}>ΔE {row.deltaE.toFixed(1)}</span>}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    <div className="emb-field-row">
                                        <button type="button" className="emb-btn is-primary is-small" onClick={applyRecolor} disabled={recolor.busy}>{recolor.busy ? 'Working…' : `Apply recolour (${recolorCost})`}</button>
                                        <button type="button" className="emb-btn is-small" onClick={() => setRecolor(null)}>Cancel</button>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <button type="button" className="emb-btn" onClick={() => openRecolor(selectedLayer)}>
                            <I d={ICON.thread} s={14} /> Recolour to thread shade
                        </button>
                    )}
                </>
            ) : (
                <div className="emb-empty" style={{ padding: '1.25rem 0.75rem' }}>
                    <strong>No motif selected</strong>
                    Click a motif on the canvas, or add one from the Motifs tab.
                </div>
            )}

            <h3 className="emb-side-title">Layers ({doc.layers.length})</h3>
            {doc.layers.length === 0 ? <p className="emb-hint">Top of the list renders on top.</p> : (
                <ul className="emb-layer-list">
                    {[...doc.layers].reverse().map((layer) => (
                        <li key={layer.id} className={`emb-layer-row${layer.id === selectedId ? ' is-active' : ''}`} onClick={() => setSelectedId(layer.id)}>
                            <span className="emb-swatch is-dot" style={{ background: layer.visible === false ? 'transparent' : '#f43f5e', border: '1px solid rgba(28,25,23,0.2)' }} />
                            <span className="name" title={layer.name}>{layer.name}</span>
                            <button type="button" className="emb-icon-btn" onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, (l) => ({ visible: l.visible === false })); }} aria-label={`${layer.visible === false ? 'Show' : 'Hide'} ${layer.name}`}>
                                <I d={layer.visible === false ? ICON.eyeOff : ICON.eye} s={13} />
                            </button>
                            <button type="button" className="emb-icon-btn" onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, (l) => ({ locked: !l.locked })); }} aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`}>
                                <I d={layer.locked ? ICON.lock : ICON.unlock} s={13} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );

    const renderExportPanel = () => (
        <div className="emb-side-section">
            <button type="button" className="emb-btn is-primary" onClick={flatten} disabled={isComposing || doc.layers.length === 0}>
                {isComposing ? 'Flattening…' : `Flatten to PNG (${composeCost} credits)`}
            </button>
            <p className="emb-hint">Renders every visible motif at the document size ({doc.width}×{doc.height} px) with the exact positions you see here.</p>
            {result && (
                <>
                    <div className="emb-result">
                        <MediaImg src={result.resultUrl} alt="Flattened placement" token={currentToken} accessToken={result.fileAccessToken} />
                    </div>
                    <div className="emb-icon-row">
                        <button type="button" className="emb-btn is-small" onClick={(e) => forceDownload(e, mediaUrl(result.resultUrl), result.filename, currentToken)}><I d={ICON.download} s={14} /> Download</button>
                        <button type="button" className="emb-btn is-small" onClick={saveToProject}>Save to project</button>
                        <button type="button" className="emb-btn is-small" onClick={sendToMappings}><I d={ICON.send} s={14} /> Mockups</button>
                    </div>
                </>
            )}
            <h3 className="emb-side-title">Design</h3>
            <button type="button" className="emb-btn is-small" onClick={startNewDesign}>Start a new placement</button>
            <p className="emb-hint">Your placement is saved as a draft in this browser for {activeProject?.name || 'this project'}.</p>
        </div>
    );

    const TABS = [
        { id: 'base', label: 'Base' },
        { id: 'motifs', label: 'Motifs' },
        { id: 'layer', label: 'Layer' },
        { id: 'export', label: 'Export' },
    ];

    return (
        <>
            <div className="emb-placement">
                <div className="emb-placement-toolbar">
                    <span className="emb-doc-size">
                        {doc.width} × {doc.height} px · {doc.base?.kind === 'image' ? 'print base' : doc.base?.kind === 'swatch' ? `${BASE_SWATCHES.find((s) => s.id === doc.base.swatch)?.label || 'swatch'}` : 'solid base'} · {doc.layers.length} motif{doc.layers.length === 1 ? '' : 's'}
                    </span>
                    <button type="button" className="emb-btn is-small" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} aria-label="Zoom out"><I d={ICON.zoomOut} s={14} /></button>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                    <button type="button" className="emb-btn is-small" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))} aria-label="Zoom in"><I d={ICON.zoomIn} s={14} /></button>
                    <button type="button" className="emb-btn is-small" onClick={() => setZoom(1)} aria-label="Fit to view"><I d={ICON.fit} s={14} /> Fit</button>
                </div>
                <div ref={wrapRef} className="emb-placement-canvas">
                    <canvas ref={canvasElRef} />
                    {doc.layers.length === 0 && (
                        <div className="emb-canvas-hint"><span>Pick a base, then add motifs from the Motifs tab</span></div>
                    )}
                </div>
            </div>
            {rightPanelEl && createPortal(
                <div className="st-pl-right emb-side">
                    <nav className="emb-side-tabs" aria-label="Placement panels">
                        {TABS.map((tab) => (
                            <button key={tab.id} type="button" className={`emb-side-tab${panel === tab.id ? ' is-active' : ''}`} onClick={() => setPanel(tab.id)} aria-pressed={panel === tab.id}>
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                    {panel === 'base' && renderBasePanel()}
                    {panel === 'motifs' && renderMotifsPanel()}
                    {panel === 'layer' && renderLayerPanel()}
                    {panel === 'export' && renderExportPanel()}
                </div>,
                rightPanelEl,
            )}
        </>
    );
}
