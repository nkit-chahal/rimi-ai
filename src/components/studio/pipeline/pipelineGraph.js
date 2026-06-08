import { getDefaultSettings, getNodeCost, normalizeNodeType } from './pipelineRegistry';

const H_SPACING = 280;
const V_CENTER = 120;

let _idCounter = 0;
export function newNodeId(prefix = 'node') {
    _idCounter += 1;
    return `${prefix}_${Date.now()}_${_idCounter}`;
}

export function createNode(type, position = { x: 0, y: 0 }, data = {}) {
    const nodeType = normalizeNodeType(type);
    return {
        id: data.id || newNodeId(nodeType),
        type: 'pipelineNode',
        position,
        data: {
            nodeType,
            label: data.label,
            settings: data.settings || getDefaultSettings(nodeType),
            status: data.status || 'pending',
            resultUrl: data.resultUrl || null,
            filename: data.filename || null,
            previewUrl: data.previewUrl || null,
            error: data.error || null,
        },
    };
}

export function createEdge(source, target) {
    return {
        id: `e_${source}_${target}`,
        source,
        target,
        type: 'smoothstep',
        animated: false,
    };
}

export function createEmptyGraph() {
    const input = createNode('imageInput', { x: 80, y: V_CENTER });
    const output = createNode('export', { x: 80 + H_SPACING, y: V_CENTER });
    return {
        nodes: [input, output],
        edges: [createEdge(input.id, output.id)],
        viewport: { x: 0, y: 0, zoom: 1 },
    };
}

export function buildLinearGraph(types, settingsMap = {}) {
    const nodes = types.map((rawType, i) => {
        const nodeType = normalizeNodeType(rawType);
        return createNode(nodeType, { x: 80 + i * H_SPACING, y: V_CENTER }, {
            settings: settingsMap[rawType] || settingsMap[nodeType] || getDefaultSettings(nodeType),
        });
    });
    const edges = [];
    for (let i = 0; i < nodes.length - 1; i++) {
        edges.push(createEdge(nodes[i].id, nodes[i + 1].id));
    }
    return { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.85 } };
}

export function linearToGraph(steps = [], settings = {}) {
    if (!steps?.length) return createEmptyGraph();
    return buildLinearGraph(steps, settings);
}

export function graphFromWorkflow(workflow) {
    if (workflow?.graph?.nodes?.length) {
        return {
            nodes: workflow.graph.nodes,
            edges: workflow.graph.edges || [],
            viewport: workflow.graph.viewport || { x: 0, y: 0, zoom: 1 },
        };
    }
    return linearToGraph(workflow?.steps || [], workflow?.settings || {});
}

export function graphToLegacy(graph) {
    const order = topoSort(graph.nodes, graph.edges);
    const steps = order.map((n) => n.data.nodeType);
    const settings = {};
    order.forEach((n) => {
        settings[n.data.nodeType] = n.data.settings || {};
    });
    return { steps, settings };
}

export function topoSort(nodes, edges) {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const inDegree = new Map(nodes.map((n) => [n.id, 0]));
    const adj = new Map(nodes.map((n) => [n.id, []]));

    edges.forEach((e) => {
        if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) return;
        adj.get(e.source).push(e.target);
        inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    });

    const queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
    const sorted = [];

    while (queue.length) {
        const id = queue.shift();
        const node = nodeMap.get(id);
        if (node) sorted.push(node);
        (adj.get(id) || []).forEach((next) => {
            inDegree.set(next, inDegree.get(next) - 1);
            if (inDegree.get(next) === 0) queue.push(next);
        });
    }

    if (sorted.length !== nodes.length) {
        throw new Error('Pipeline graph contains a cycle.');
    }
    return sorted;
}

export function getUpstreamNode(nodeId, nodes, edges) {
    const edge = edges.find((e) => e.target === nodeId);
    if (!edge) return null;
    return nodes.find((n) => n.id === edge.source) || null;
}

export function validateGraph(nodes, edges, uploadFilename) {
    const inputNodes = nodes.filter((n) => n.data.nodeType === 'imageInput');
    if (inputNodes.length !== 1) {
        return 'Pipeline must have exactly one Image Input node.';
    }
    if (!uploadFilename) {
        return 'Upload an image on the Image Input node before running.';
    }

    try {
        topoSort(nodes, edges);
    } catch (err) {
        return err.message;
    }

    const order = topoSort(nodes, edges);
    const vecIdx = order.findIndex((n) => n.data.nodeType === 'vectorize');
    const upIdx = order.findIndex((n) => n.data.nodeType === 'upscale');
    if (vecIdx !== -1 && upIdx !== -1 && upIdx > vecIdx) {
        return 'Invalid pipeline: upscale cannot come after vectorize.';
    }

    return null;
}

export function estimateGraphCredits(nodes, creditPricing) {
    return nodes.reduce((sum, n) => {
        const t = n.data.nodeType;
        if (t === 'imageInput' || t === 'export') return sum;
        return sum + getNodeCost(t, creditPricing);
    }, 0);
}
