/** Pipeline node definitions — maps node types to labels, costs, and default settings. */

export const NODE_CATEGORIES = {
    input: { label: 'Input', types: ['imageInput'] },
    ai: {
        label: 'AI Design',
        types: ['extract', 'seamless', 'repeat', 'vectorize', 'upscale', 'removebg', 'inspire', 'imagelayers', 'mappings'],
    },
    color: { label: 'Color', types: ['colorways', 'vectorpro'] },
    output: { label: 'Export', types: ['export'] },
};

export const NODE_DEFS = {
    imageInput: {
        label: 'Image Input',
        icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
        desc: 'Upload source artwork',
        creditKey: null,
        defaultCost: 0,
        hasInput: false,
        hasOutput: true,
        defaultSettings: {},
    },
    extract: {
        label: 'Pattern Extract',
        icon: 'M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z',
        desc: 'AI pattern extraction',
        creditKey: 'extract',
        defaultCost: 148,
        hasInput: true,
        hasOutput: true,
        defaultSettings: {},
    },
    seamless: {
        label: 'Make Seamless',
        icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z',
        desc: 'Seamless tiling',
        creditKey: 'seamless',
        defaultCost: 58,
        hasInput: true,
        hasOutput: true,
        defaultSettings: {},
    },
    repeat: {
        label: 'Repeat Set',
        icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
        desc: 'Repeat pattern grid',
        creditKey: 'repeat',
        defaultCost: 5,
        hasInput: true,
        hasOutput: true,
        defaultSettings: { gridSize: 3, repeatType: 'block' },
    },
    vectorize: {
        label: 'Vectorize',
        icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
        desc: 'Convert to SVG',
        creditKey: 'vectorize',
        defaultCost: 12,
        hasInput: true,
        hasOutput: true,
        defaultSettings: {},
    },
    upscale: {
        label: 'Super Resolution',
        icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
        desc: 'Enhance resolution',
        creditKey: 'upscale',
        defaultCost: 23,
        hasInput: true,
        hasOutput: true,
        defaultSettings: { upscaleFactor: 'x4' },
    },
    removebg: {
        label: 'Remove Background',
        icon: 'M3 7h18M3 12h18M8 7v10M16 7v10',
        desc: 'Transparent PNG',
        creditKey: 'removeBg',
        defaultCost: 2,
        hasInput: true,
        hasOutput: true,
        defaultSettings: {},
    },
    inspire: {
        label: 'Inspirations',
        icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.7 1.7-1.7h2c3.1 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z',
        desc: 'AI design variations',
        creditKey: 'inspire',
        defaultCost: 148,
        hasInput: true,
        hasOutput: true,
        defaultSettings: { prompt: 'Luxury textile pattern variation', creativity: 3, count: 1 },
    },
    colorways: {
        label: 'Colorways',
        icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
        desc: 'Production colorways',
        creditKey: 'colorways',
        defaultCost: 12,
        hasInput: true,
        hasOutput: true,
        defaultSettings: { strategy: 'complementary', count: 1 },
    },
    imagelayers: {
        label: 'Image Layers',
        icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5',
        desc: 'Decompose into layers',
        creditKey: 'imageLayers',
        defaultCost: 69,
        hasInput: true,
        hasOutput: true,
        defaultSettings: { numLayers: 4 },
    },
    mappings: {
        label: 'Product Mockup',
        icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z',
        desc: 'Map print onto product',
        creditKey: 'mappings',
        defaultCost: 148,
        hasInput: true,
        hasOutput: true,
        defaultSettings: { productType: 'tshirt', background: 'studio' },
    },
    vectorpro: {
        label: 'Vector Pro',
        icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343',
        desc: 'Color reduction',
        creditKey: 'colorReduction',
        defaultCost: 5,
        hasInput: true,
        hasOutput: true,
        defaultSettings: { numColors: 8 },
    },
    export: {
        label: 'Export',
        icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
        desc: 'Download final output',
        creditKey: null,
        defaultCost: 0,
        hasInput: true,
        hasOutput: false,
        defaultSettings: { outputFormat: 'PNG', resolution: 300 },
    },
};

const LEGACY_TYPE_MAP = { upload: 'imageInput' };

export function normalizeNodeType(type) {
    return LEGACY_TYPE_MAP[type] || type;
}

export function getNodeDef(type) {
    return NODE_DEFS[normalizeNodeType(type)] || null;
}

export function getNodeCost(type, creditPricing = {}) {
    const def = getNodeDef(type);
    if (!def) return 0;
    if (def.creditKey && creditPricing[def.creditKey] != null) {
        return creditPricing[def.creditKey];
    }
    return def.defaultCost;
}

export function getDefaultSettings(type) {
    const def = getNodeDef(type);
    return def ? { ...def.defaultSettings } : {};
}

export function allAddableTypes() {
    return Object.keys(NODE_DEFS).filter((t) => t !== 'imageInput' && t !== 'export');
}
