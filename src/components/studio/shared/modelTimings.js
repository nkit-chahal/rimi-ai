/**
 * Expected Replicate runtimes from production logs (Jul 2026).
 * expectedMs drives the loading-bar curve; min/max are for ETA copy.
 */

export const MODEL_TIMINGS = {
    'qwen/qwen-image-edit': {
        expectedMs: 2800,
        minMs: 2700,
        maxMs: 2800,
        label: 'Qwen Image Edit',
    },
    '851-labs/background-remover': {
        expectedMs: 4500,
        minMs: 1000,
        maxMs: 8000,
        label: 'Background Remover',
    },
    'google/imagen-4-fast': {
        expectedMs: 4500,
        minMs: 3000,
        maxMs: 6000,
        label: 'Imagen 4 Fast',
    },
    'xai/grok-imagine-image': {
        expectedMs: 7500,
        minMs: 6000,
        maxMs: 9000,
        label: 'Grok Imagine',
    },
    'recraft-ai/recraft-vectorize': {
        expectedMs: 9000,
        minMs: 6000,
        maxMs: 12000,
        label: 'Recraft Vectorize',
    },
    'black-forest-labs/flux-fill-pro': {
        expectedMs: 9500,
        minMs: 5000,
        maxMs: 14000,
        label: 'Flux Fill Pro',
    },
    'black-forest-labs/flux-2-pro': {
        expectedMs: 8500,
        minMs: 8000,
        maxMs: 9000,
        label: 'Flux 2 Pro',
    },
    'google/nano-banana': {
        expectedMs: 9500,
        minMs: 8000,
        maxMs: 11000,
        label: 'Nano Banana',
    },
    'google/nano-banana-2': {
        expectedMs: 11000,
        minMs: 10000,
        maxMs: 12000,
        label: 'Nano Banana 2',
    },
    'qwen/qwen-image-layered': {
        expectedMs: 12500,
        minMs: 9000,
        maxMs: 16000,
        label: 'Qwen Layered',
    },
    'google/imagen-4-ultra': {
        expectedMs: 14000,
        minMs: 13000,
        maxMs: 15000,
        label: 'Imagen 4 Ultra',
    },
    'bytedance/seedream-4.5': {
        expectedMs: 15500,
        minMs: 9000,
        maxMs: 22000,
        label: 'Seedream 4.5',
    },
    'replicate/seamless-texture': {
        expectedMs: 31000,
        minMs: 29000,
        maxMs: 33000,
        label: 'Seamless Texture',
    },
    'openai/gpt-image-2': {
        expectedMs: 150000,
        minMs: 60000,
        maxMs: 360000,
        label: 'GPT Image 2',
    },
    // Not in the log table — estimated from similar upscalers
    'google/upscaler': {
        expectedMs: 8000,
        minMs: 4000,
        maxMs: 15000,
        label: 'Google Upscaler',
    },
    // Local / non-Replicate tools
    local: {
        expectedMs: 2000,
        minMs: 800,
        maxMs: 4000,
        label: 'Processing',
    },
};

/** Default model for each studio tool / bg-task type */
export const TOOL_DEFAULT_MODELS = {
    removebg: '851-labs/background-remover',
    vectorize: 'recraft-ai/recraft-vectorize',
    upscale: 'google/upscaler',
    seamless: 'black-forest-labs/flux-fill-pro',
    'seamless-generate': 'replicate/seamless-texture',
    mappings: 'google/nano-banana-2',
    imagelayers: 'qwen/qwen-image-layered',
    'imagelayers-edit': 'qwen/qwen-image-edit',
    colorways: 'local',
    'colorway-manager': 'local',
    pattern: 'google/nano-banana',
    inspire: 'google/nano-banana',
    vectorpro: 'local',
};

const DEFAULT_TIMING = {
    expectedMs: 15000,
    minMs: 5000,
    maxMs: 30000,
    label: 'AI model',
};

export function getModelTiming(modelId) {
    if (!modelId) return DEFAULT_TIMING;
    return MODEL_TIMINGS[modelId] || DEFAULT_TIMING;
}

export function resolveModelId(modelOrTool, fallbackTool) {
    if (modelOrTool && MODEL_TIMINGS[modelOrTool]) return modelOrTool;
    if (modelOrTool && TOOL_DEFAULT_MODELS[modelOrTool]) return TOOL_DEFAULT_MODELS[modelOrTool];
    if (fallbackTool && TOOL_DEFAULT_MODELS[fallbackTool]) return TOOL_DEFAULT_MODELS[fallbackTool];
    return null;
}

/**
 * Asymptotic progress curve:
 * ~90% at expectedMs, then slow crawl toward 97% until the job finishes.
 */
export function timedProgressPct(elapsedMs, expectedMs) {
    const expected = Math.max(800, expectedMs || 15000);
    const t = Math.max(0, elapsedMs) / expected;
    if (t <= 1) {
        return Math.min(90, (1 - Math.exp(-2.3 * t)) * 100);
    }
    const overshoot = Math.min(1, (elapsedMs - expected) / expected);
    return Math.min(97, 90 + overshoot * 7);
}

export function formatEta(remainingMs) {
    if (remainingMs == null || Number.isNaN(remainingMs)) return '';
    if (remainingMs <= 0) return 'Finishing…';
    const sec = Math.ceil(remainingMs / 1000);
    if (sec < 60) return `~${sec}s left`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    if (min >= 5) return `~${min}m left`;
    return rem ? `~${min}m ${rem}s left` : `~${min}m left`;
}

export function formatUsualRange(timing) {
    const minS = Math.round((timing?.minMs || 0) / 1000);
    const maxS = Math.round((timing?.maxMs || 0) / 1000);
    if (!minS && !maxS) return '';
    if (minS === maxS) return `Usually ~${minS}s`;
    if (maxS >= 60) {
        const minM = Math.max(1, Math.round(minS / 60));
        const maxM = Math.max(minM, Math.round(maxS / 60));
        return `Usually ${minM}–${maxM} min`;
    }
    return `Usually ${minS}–${maxS}s`;
}
