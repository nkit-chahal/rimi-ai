import { API, apiFetch } from '../shared/helpers';
import { getUpstreamNode, graphToLegacy, topoSort } from './pipelineGraph';

function filenameFromResultUrl(url) {
    if (!url) return null;
    if (url.startsWith('http')) {
        try {
            return new URL(url).pathname.split('/').pop();
        } catch {
            return url.split('/').pop();
        }
    }
    return url.split('/').pop();
}

async function extractPalette(filename, ctx) {
    const d = await apiFetch('/api/extract-palette', {
        method: 'POST',
        body: JSON.stringify({ filename, projectId: ctx.projectId, userId: ctx.userId }),
    }, ctx.token);
    return d.palette || ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b'];
}

export async function executeNode(node, ctx) {
    const type = node.data.nodeType;
    const settings = node.data.settings || {};
    const filename = ctx.inputFilename;

    if (type === 'imageInput') {
        if (!ctx.uploadFilename) throw new Error('No image uploaded.');
        const url = `${API}/uploads/${ctx.uploadFilename}`;
        return { filename: ctx.uploadFilename, resultUrl: url };
    }

    if (type === 'export') {
        if (!filename) throw new Error('No input for export.');
        return { filename, resultUrl: `${API}/results/${filename}` };
    }

    if (!filename) throw new Error('Connect an upstream node with output first.');

    let d;

    switch (type) {
        case 'extract':
            d = await apiFetch('/api/extract-design', {
                method: 'POST',
                body: JSON.stringify({ projectId: ctx.projectId, filename, userId: ctx.userId }),
            }, ctx.token);
            break;
        case 'seamless':
            d = await apiFetch('/api/make-seamless', {
                method: 'POST',
                body: JSON.stringify({ projectId: ctx.projectId, filename, userId: ctx.userId }),
            }, ctx.token);
            break;
        case 'repeat':
            d = await apiFetch('/api/create-repeat-set', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: ctx.projectId,
                    filename,
                    userId: ctx.userId,
                    gridSize: settings.gridSize || 3,
                    scale: 100,
                    repeatType: settings.repeatType || 'block',
                    dpi: settings.resolution || 300,
                    format: settings.outputFormat || 'PNG',
                }),
            }, ctx.token);
            break;
        case 'upscale':
            d = await apiFetch('/api/upscale', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: ctx.projectId,
                    filename,
                    factor: settings.upscaleFactor || 'x4',
                    userId: ctx.userId,
                }),
            }, ctx.token);
            break;
        case 'vectorize':
            d = await apiFetch('/api/vectorize', {
                method: 'POST',
                body: JSON.stringify({ projectId: ctx.projectId, filename, userId: ctx.userId }),
            }, ctx.token);
            break;
        case 'removebg':
            d = await apiFetch('/api/remove-bg', {
                method: 'POST',
                body: JSON.stringify({ filename, projectId: ctx.projectId, userId: ctx.userId }),
            }, ctx.token);
            break;
        case 'inspire': {
            let prompt = settings.prompt;
            if (!prompt) {
                try {
                    const desc = await apiFetch('/api/describe-image', {
                        method: 'POST',
                        body: JSON.stringify({ filename, projectId: ctx.projectId }),
                    }, ctx.token);
                    prompt = desc.description || 'Luxury textile pattern variation';
                } catch {
                    prompt = 'Luxury textile pattern variation';
                }
            }
            d = await apiFetch('/api/generate-inspirations', {
                method: 'POST',
                body: JSON.stringify({
                    prompt,
                    creativity: settings.creativity || 3,
                    count: 1,
                    filename,
                    projectId: ctx.projectId,
                    userId: ctx.userId,
                }),
            }, ctx.token);
            if (d.success && d.variations?.length) {
                const v = d.variations[0];
                const outFn = filenameFromResultUrl(v);
                return {
                    filename: outFn,
                    resultUrl: v.startsWith('http') ? v : `${API}${v.startsWith('/') ? v : `/results/${v}`}`,
                    credits: d,
                };
            }
            throw new Error(d.error || 'Inspiration generation failed');
        }
        case 'colorways': {
            const palette = settings.palette?.length
                ? settings.palette
                : await extractPalette(filename, ctx);
            d = await apiFetch('/api/colorways/generate', {
                method: 'POST',
                body: JSON.stringify({
                    filename,
                    palette,
                    lockedIndices: [],
                    strategy: settings.strategy || 'complementary',
                    count: settings.count || 1,
                    projectId: ctx.projectId,
                    userId: ctx.userId,
                }),
            }, ctx.token);
            if (d.success && d.colorways?.length) {
                const cw = d.colorways[0];
                return {
                    filename: filenameFromResultUrl(cw.resultUrl),
                    resultUrl: `${API}${cw.resultUrl}`,
                    credits: d,
                };
            }
            throw new Error(d.error || 'Colorway generation failed');
        }
        case 'imagelayers':
            d = await apiFetch('/api/image-layers', {
                method: 'POST',
                body: JSON.stringify({
                    filename,
                    numLayers: settings.numLayers || 4,
                    projectId: ctx.projectId,
                    userId: ctx.userId,
                }),
            }, ctx.token);
            if (d.success && d.layers?.length) {
                const layer = d.layers[0];
                return {
                    filename: layer.filename,
                    resultUrl: `${API}${layer.url}`,
                    credits: d,
                };
            }
            throw new Error(d.error || 'Image layers failed');
        case 'mappings':
            d = await apiFetch('/api/generate-mockup', {
                method: 'POST',
                body: JSON.stringify({
                    patternFilename: filename,
                    productType: settings.productType || 'tshirt',
                    background: settings.background || 'studio',
                    projectId: ctx.projectId,
                    userId: ctx.userId,
                }),
            }, ctx.token);
            if (d.success && d.mockupUrl) {
                return {
                    filename: filenameFromResultUrl(d.mockupUrl),
                    resultUrl: `${API}${d.mockupUrl}`,
                    credits: d,
                };
            }
            throw new Error(d.error || 'Mockup generation failed');
        case 'vectorpro':
            d = await apiFetch('/api/color-reduce', {
                method: 'POST',
                body: JSON.stringify({
                    filename,
                    numColors: settings.numColors || 8,
                    projectId: ctx.projectId,
                    userId: ctx.userId,
                }),
            }, ctx.token);
            break;
        default:
            throw new Error(`Unknown node type: ${type}`);
    }

    if (!d?.success) throw new Error(d?.error || `${type} failed`);
    ctx.onCredits?.(d);

    const resultUrl = d.resultUrl ? `${API}${d.resultUrl}` : null;
    const outFilename = filenameFromResultUrl(d.resultUrl || d.mockupUrl);
    return { filename: outFilename, resultUrl, credits: d };
}

export async function executeGraph(graph, ctx, options = {}) {
    const { nodes, edges } = graph;
    const order = topoSort(nodes, edges);
    const results = {};
    const runLog = [];
    let runId = null;

    if (options.createRunRecord !== false) {
        try {
            const legacy = graphToLegacy(graph);
            const rd = await apiFetch('/api/pipeline-runs', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: ctx.projectId,
                    name: options.flowName || 'Custom Flow',
                    steps: legacy.steps,
                    settings: legacy.settings,
                    graph,
                }),
            }, ctx.token);
            if (rd.success) runId = rd.runId;
        } catch { /* non-fatal */ }
    }

    const targetIdx = options.nodeId
        ? order.findIndex((n) => n.id === options.nodeId)
        : order.length - 1;
    const nodesToRun = targetIdx >= 0 ? order.slice(0, targetIdx + 1) : order;

    for (const node of nodesToRun) {
        if (options.nodeId && node.id !== options.nodeId) {
            const cached = node.data.status === 'done' && node.data.filename;
            if (cached) {
                results[node.id] = {
                    filename: node.data.filename,
                    resultUrl: node.data.resultUrl,
                };
                continue;
            }
        }

        options.onNodeStatus?.(node.id, 'running');

        try {
            let inputFilename = ctx.uploadFilename;

            if (node.data.nodeType !== 'imageInput') {
                const upstream = getUpstreamNode(node.id, nodes, edges);
                if (upstream && results[upstream.id]?.filename) {
                    inputFilename = results[upstream.id].filename;
                } else if (upstream?.data?.filename) {
                    inputFilename = upstream.data.filename;
                }
            }

            const execCtx = { ...ctx, inputFilename };
            const out = await executeNode(node, execCtx);
            results[node.id] = out;

            options.onNodeStatus?.(node.id, 'done', out);
            runLog.push({ nodeId: node.id, type: node.data.nodeType, status: 'done', resultUrl: out.resultUrl });
        } catch (err) {
            options.onNodeStatus?.(node.id, 'error', { error: err.message });
            runLog.push({ nodeId: node.id, type: node.data.nodeType, status: 'error', error: err.message });

            if (runId) {
                apiFetch(`/api/pipeline-runs/${runId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: 'failed', results: runLog, graph }),
                }, ctx.token).catch(() => {});
            }
            throw err;
        }
    }

    const finalStatus = runLog.every((r) => r.status === 'done') ? 'completed' : 'failed';
    if (runId) {
        apiFetch(`/api/pipeline-runs/${runId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: finalStatus, results: runLog, graph }),
        }, ctx.token).catch(() => {});
    }

    return { results, runLog, runId };
}
