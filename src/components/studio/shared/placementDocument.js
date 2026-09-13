/**
 * Placement Studio document model and the canvas contract.
 *
 * One coordinate space: the document, in pixels. Every layer stores the CENTRE of the motif
 * (x, y), a scale relative to the motif's own pixel size, a clockwise angle in degrees, flips
 * and opacity. The Fabric.js canvas is only a view: `fitView` derives a scale and offset, and
 * `layerToView` / `viewToLayer` convert both ways. The server renders the same document with
 * the same centre-origin rules (backend/services/placement_render.py).
 */

export const MAX_LAYERS = 40;
export const MIN_DOC_SIZE = 64;
export const MAX_DOC_SIZE = 6000;
export const DEFAULT_DOC_SIZE = 2000;

export const BASE_SWATCHES = [
    { id: 'velvet', label: 'Maroon velvet', color: '#5b1a2b' },
    { id: 'silk', label: 'Ivory silk', color: '#f3e9d2' },
    { id: 'cotton', label: 'White cotton', color: '#f7f4ee' },
    { id: 'linen', label: 'Ecru linen', color: '#e6dcc8' },
    { id: 'georgette', label: 'Navy georgette', color: '#1d2a5b' },
    { id: 'crepe', label: 'Black crepe', color: '#161616' },
];

let idCounter = 0;
export function nextLayerId() {
    idCounter += 1;
    return `L${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function clampSize(value, fallback = DEFAULT_DOC_SIZE) {
    const size = Math.round(Number(value));
    if (!Number.isFinite(size)) return fallback;
    return Math.max(MIN_DOC_SIZE, Math.min(MAX_DOC_SIZE, size));
}

export function createDocument({ width = DEFAULT_DOC_SIZE, height = DEFAULT_DOC_SIZE, base } = {}) {
    return {
        width: clampSize(width),
        height: clampSize(height),
        base: base || { kind: 'swatch', swatch: 'cotton', color: '#f7f4ee' },
        layers: [],
    };
}

/** Scale and offset that fit the document inside a viewport, centred, with padding. */
export function fitView(docWidth, docHeight, viewWidth, viewHeight, padding = 24) {
    const usableW = Math.max(1, viewWidth - padding * 2);
    const usableH = Math.max(1, viewHeight - padding * 2);
    const scale = Math.min(usableW / Math.max(1, docWidth), usableH / Math.max(1, docHeight));
    return {
        scale,
        offsetX: (viewWidth - docWidth * scale) / 2,
        offsetY: (viewHeight - docHeight * scale) / 2,
    };
}

/** Fabric object properties (centre origin) for a layer under a view. */
export function layerToView(layer, view) {
    return {
        left: view.offsetX + layer.x * view.scale,
        top: view.offsetY + layer.y * view.scale,
        scaleX: (layer.scaleX ?? 1) * view.scale,
        scaleY: (layer.scaleY ?? 1) * view.scale,
        angle: layer.angle ?? 0,
        flipX: Boolean(layer.flipX),
        flipY: Boolean(layer.flipY),
        opacity: layer.opacity ?? 1,
    };
}

/** Layer transform (document space) read back from a Fabric object with a centre origin. */
export function viewToLayer(obj, view) {
    return {
        x: (obj.left - view.offsetX) / view.scale,
        y: (obj.top - view.offsetY) / view.scale,
        scaleX: (obj.scaleX ?? 1) / view.scale,
        scaleY: (obj.scaleY ?? 1) / view.scale,
        angle: obj.angle ?? 0,
        flipX: Boolean(obj.flipX),
        flipY: Boolean(obj.flipY),
    };
}

/** New layer for a motif, centred, sized to a fraction of the document. */
export function makeLayerFromMotif(motif, doc, { targetFraction = 0.3 } = {}) {
    const motifW = Math.max(1, Number(motif.width) || 1);
    const motifH = Math.max(1, Number(motif.height) || 1);
    const scale = Math.min((doc.width * targetFraction) / motifW, (doc.height * targetFraction) / motifH);
    return {
        id: nextLayerId(),
        motifId: motif.id ?? null,
        name: motif.name || 'Motif',
        filename: motif.filename,
        url: motif.url,
        fileAccessToken: motif.fileAccessToken,
        width: motifW,
        height: motifH,
        x: doc.width / 2,
        y: doc.height / 2,
        scaleX: scale,
        scaleY: scale,
        angle: 0,
        flipX: false,
        flipY: false,
        opacity: 1,
        visible: true,
        locked: false,
    };
}

/** Axis-aligned footprint of a layer in document pixels, including rotation. */
export function layerFootprint(layer) {
    const w = layer.width * Math.abs(layer.scaleX ?? 1);
    const h = layer.height * Math.abs(layer.scaleY ?? 1);
    const rad = ((layer.angle ?? 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    return { width: w * cos + h * sin, height: w * sin + h * cos };
}

/**
 * Copies of a layer spaced evenly along one document edge (a border repeat).
 * Returns the new layers only; the original is left in place.
 */
export function repeatAlongEdge(doc, layer, { edge = 'bottom', count = 5, margin = 0.05 } = {}) {
    const n = Math.max(2, Math.min(40, Math.round(count)));
    const footprint = layerFootprint(layer);
    const copies = [];
    for (let i = 0; i < n; i += 1) {
        let x;
        let y;
        if (edge === 'top' || edge === 'bottom') {
            x = ((i + 0.5) * doc.width) / n;
            y = edge === 'top'
                ? doc.height * margin + footprint.height / 2
                : doc.height * (1 - margin) - footprint.height / 2;
        } else {
            y = ((i + 0.5) * doc.height) / n;
            x = edge === 'left'
                ? doc.width * margin + footprint.width / 2
                : doc.width * (1 - margin) - footprint.width / 2;
        }
        copies.push({ ...layer, id: nextLayerId(), name: `${layer.name} ${i + 1}`, x, y, locked: false });
    }
    return copies;
}

const round3 = (value) => Math.round(Number(value) * 1000) / 1000;

/** Payload for the flatten endpoint: only what the renderer needs. */
export function serializeForCompose(doc) {
    const base = doc.base || {};
    return {
        width: doc.width,
        height: doc.height,
        base: {
            kind: base.kind || 'solid',
            color: base.color,
            filename: base.kind === 'image' ? base.filename : undefined,
        },
        layers: doc.layers
            .filter((layer) => layer.visible !== false)
            .map((layer) => ({
                filename: layer.filename,
                x: round3(layer.x),
                y: round3(layer.y),
                scaleX: round3(layer.scaleX ?? 1),
                scaleY: round3(layer.scaleY ?? 1),
                angle: round3(layer.angle ?? 0),
                flipX: Boolean(layer.flipX),
                flipY: Boolean(layer.flipY),
                opacity: round3(layer.opacity ?? 1),
                visible: true,
            })),
    };
}

/** Move a layer up or down in the stack (higher index renders on top). */
export function moveLayer(layers, layerId, direction) {
    const index = layers.findIndex((layer) => layer.id === layerId);
    if (index === -1) return layers;
    const target = direction === 'up' ? index + 1 : index - 1;
    if (target < 0 || target >= layers.length) return layers;
    const next = [...layers];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

export const DRAFT_KEY_PREFIX = 'rimi.placement.draft.';

export function draftKey(projectId) {
    return `${DRAFT_KEY_PREFIX}${projectId || 'none'}`;
}

export function loadDraft(projectId) {
    try {
        const raw = window.localStorage.getItem(draftKey(projectId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.layers)) return null;
        return { ...createDocument(parsed), layers: parsed.layers.slice(0, MAX_LAYERS) };
    } catch {
        return null;
    }
}

export function saveDraft(projectId, doc) {
    try {
        window.localStorage.setItem(draftKey(projectId), JSON.stringify(doc));
    } catch {
        // Drafts are a convenience; storage may be unavailable.
    }
}

export function clearDraft(projectId) {
    try {
        window.localStorage.removeItem(draftKey(projectId));
    } catch {
        // Nothing to clear.
    }
}
