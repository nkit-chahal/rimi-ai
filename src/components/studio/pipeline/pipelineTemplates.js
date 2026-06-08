import { buildLinearGraph } from './pipelineGraph';

export const PIPELINE_TEMPLATES = [
    {
        id: 'extract-seamless',
        name: 'Extract & Seamless',
        desc: 'AI extraction followed by seamless layout for print-ready tiles.',
        preview: '/demo_floral.png',
        steps: ['imageInput', 'extract', 'seamless', 'export'],
    },
    {
        id: 'repeat-set',
        name: 'Repeat Set',
        desc: 'Generate half drop, brick, and block repeat layouts.',
        preview: '/demo_geometric.png',
        steps: ['imageInput', 'repeat', 'export'],
    },
    {
        id: 'print-production',
        name: 'Print Production',
        desc: 'End-to-end workflow: extract, seamless, repeat, and upscale.',
        preview: '/demo_floral.png',
        steps: ['imageInput', 'extract', 'seamless', 'repeat', 'upscale', 'export'],
    },
    {
        id: 'vector-print',
        name: 'Vector Print Ready',
        desc: 'Upscale then vectorize for scalable print artwork.',
        preview: '/demo_geometric.png',
        steps: ['imageInput', 'upscale', 'vectorize', 'export'],
    },
    {
        id: 'clean-mockup',
        name: 'Clean & Mockup',
        desc: 'Remove background and map onto a product mockup.',
        preview: '/products/tshirt.png',
        steps: ['imageInput', 'removebg', 'mappings', 'export'],
    },
    {
        id: 'colorway-explorer',
        name: 'Colorway Explorer',
        desc: 'Generate production colorways from your pattern.',
        preview: '/demo_floral.png',
        steps: ['imageInput', 'colorways', 'export'],
    },
];

export function templateToGraph(template) {
    return buildLinearGraph(template.steps);
}
