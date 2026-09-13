/**
 * Sidebar navigation shared by the Studio shell, the studio picker and tests.
 *
 * Sections with a `domain` belong to one studio (print, embroidery, woven) and are
 * shown only while that studio is active. Sections without a domain are shared.
 */
import { t } from '../../../i18n/en-IN';

export const NAV = [
    { section: '', items: [{ id: 'dashboard', label: 'Pipeline Studio', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' }] },
    {
        section: 'PRINT TOOLS',
        domain: 'print',
        items: [
            { id: 'pattern', label: 'Pattern Extraction', icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z' },
            { id: 'seamless', label: 'Make Seamless', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z' },
            { id: 'repeat', label: 'Repeat Set', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
            { id: 'mappings', label: 'Mappings', icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z' },
            { id: 'inspire', label: 'Inspirations', icon: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.7 1.7-1.7h2c3.1 0 5.5-2.5 5.5-5.5C22 6 17.5 2 12 2z' },
            { id: 'vectorize', label: 'Vectorize', icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z' },
            { id: 'upscale', label: 'Super Resolution', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
            { id: 'removebg', label: 'Remove Background', icon: 'M3 7h18M3 12h18M8 7v10M16 7v10M5 7V5a2 2 0 012-2h10a2 2 0 012 2v2' },
            { id: 'imagelayers', label: 'Qwen Studio', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', requiresPro: true },
            { id: 'colorways', label: 'Colorways', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 7a2 2 0 100 4 2 2 0 000-4z' },
            { id: 'colorway-manager', label: 'Colorway Manager', icon: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83' },
            { id: 'vectorpro', label: 'Vector Pro', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485' },
            { id: 'mockup3d', label: '3D Mockup', icon: 'M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.3 7l8.7 5 8.7-5M12 22V12', requiresPro: true },
        ],
    },
    {
        section: 'EMBROIDERY TOOLS',
        domain: 'embroidery',
        items: [
            { id: 'emb-placement', label: 'Placement Studio', icon: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20' },
            { id: 'emb-motifs', label: 'Motif Library', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3' },
            { id: 'emb-threads', label: 'Thread Shade Cards', icon: 'M6 4h12M6 20h12M8 4v16M16 4v16M8 9h8M8 13h8M8 17h8' },
            { id: 'emb-stitches', label: 'Stitch Styles', icon: 'M3 12l3-4 3 8 3-8 3 8 3-8 3 4' },
            { id: 'emb-applique', label: 'Appliqué & Embellishment', icon: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12' },
            { id: 'emb-mockups', label: 'Embroidery Mockups', icon: 'M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z' },
            { id: 'emb-techpack', label: 'Embroidery Tech Pack', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h6' },
        ],
    },
    {
        section: 'WOVEN TOOLS',
        domain: 'woven',
        items: [
            { id: 'wv-checks', label: 'Checks & Stripes', icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18', comingSoon: true },
            { id: 'wv-weave', label: 'Weave Designer', icon: 'M4 6h16M4 12h16M4 18h16M6 4v16M12 4v16M18 4v16', comingSoon: true },
            { id: 'wv-jacquard', label: 'Jacquard Designer', icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6zM7 7l10 10M17 7L7 17', comingSoon: true },
            { id: 'wv-yarns', label: 'Yarn Library', icon: 'M12 22a10 10 0 100-20 10 10 0 000 20zM2 12c4 0 8 2 10 6M12 2c-2 4-2 8 0 12M22 12c-4-2-8-2-12 0', comingSoon: true },
            { id: 'wv-visualizer', label: 'Weave Visualizer', icon: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 100-6 3 3 0 000 6z', comingSoon: true },
        ],
    },
    {
        section: 'ASSETS & LIBRARY',
        items: [
            { id: 'library', label: 'Brand Library', icon: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z', comingSoon: true },
            { id: 'measurement', label: 'Measurement', icon: 'M2 2h6v6H2zM16 2h6v6h-6zM2 16h6v6H2zM16 16h6v6h-6zM8 5h8M8 19h8M5 8v8M19 8v8', comingSoon: true },
            { id: 'exports', label: 'Exports', icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3' },
            { id: 'billing', label: 'Billing', icon: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 6v12M8 10h6a2 2 0 010 4h-4a2 2 0 000 4h6' },
        ],
    },
];

const SECTION_I18N_KEYS = {
    'AI DESIGN TOOLS': 'aiTools',
    'PRINT TOOLS': 'print',
    'EMBROIDERY TOOLS': 'embroidery',
    'WOVEN TOOLS': 'woven',
    'ASSETS & LIBRARY': 'assets',
};

/** Tools every studio can reach regardless of the active domain. */
export const SHARED_USER_TOOLS = ['dashboard', 'library', 'measurement', 'exports', 'billing', 'workspace'];

export function navSectionLabel(section) {
    const key = SECTION_I18N_KEYS[section?.section];
    return key ? t(`navSections.${key}`) : (section?.section || '');
}

/** Tool ids that belong to one studio domain, in sidebar order. */
export function domainToolIds(domain) {
    return NAV.filter((section) => section.domain === domain).flatMap((section) => section.items.map((item) => item.id));
}

/** Allow list of tool ids a non-admin user may open while a studio is active. */
export function userToolsForDomain(domain) {
    return [...SHARED_USER_TOOLS, ...domainToolIds(domain)];
}

export function allNavItems() {
    return NAV.flatMap((section) => section.items);
}
