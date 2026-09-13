/**
 * Studio domains: Print, Embroidery, Woven.
 *
 * One place for domain metadata, plan gating and the remembered choice.
 * Tool membership comes from the shared NAV (studioNav.js) so the sidebar,
 * the studio picker and the access checks can never disagree.
 */
import { isProUser } from './planTiers';
import { domainToolIds } from './studioNav';

export const DOMAIN_STORAGE_KEY = 'rim_studio_domain';

/** Plan levels a domain can require. Order matters: later entries include earlier ones. */
export const PLAN_LEVELS = ['basic', 'pro'];

export const STUDIO_DOMAINS = {
    print: {
        id: 'print',
        label: 'Print',
        tagline: 'Surface and print design',
        description: 'Extract patterns, build seamless repeats, manage colorways and preview on 30+ products.',
        icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z',
        accent: '#8B5CF6',
        accentText: '#6D28D9',
        status: 'available',
        minPlan: 'basic',
        defaultTool: 'pattern',
        toolIds: domainToolIds('print'),
    },
    embroidery: {
        id: 'embroidery',
        label: 'Embroidery',
        tagline: 'Motifs, threads and placement',
        description: 'Place embroidery, lace, brocade and zari on prints or solids, match thread shades and map to products.',
        icon: 'M3 12l3-4 3 8 3-8 3 8 3-8 3 4',
        accent: '#F43F5E',
        accentText: '#BE123C',
        status: 'available',
        minPlan: 'pro',
        defaultTool: 'emb-placement',
        toolIds: domainToolIds('embroidery'),
    },
    woven: {
        id: 'woven',
        label: 'Woven',
        tagline: 'Checks, dobby and jacquard',
        description: 'Design yarn-dyed checks and stripes, draft weaves, convert artwork to jacquard and visualise cloth.',
        icon: 'M4 6h16M4 12h16M4 18h16M6 4v16M12 4v16M18 4v16',
        accent: '#10B981',
        accentText: '#047857',
        status: 'coming_soon',
        minPlan: 'pro',
        defaultTool: 'wv-checks',
        toolIds: domainToolIds('woven'),
    },
};

export const DOMAIN_ORDER = ['print', 'embroidery', 'woven'];

const TOOL_TO_DOMAIN = new Map(
    DOMAIN_ORDER.flatMap((domainId) => STUDIO_DOMAINS[domainId].toolIds.map((toolId) => [toolId, domainId])),
);

export function isDomainId(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STUDIO_DOMAINS, value);
}

/** Domain a tool belongs to, or null for shared tools (dashboard, exports, billing, ...). */
export function domainForTool(toolId) {
    return TOOL_TO_DOMAIN.get(toolId) || null;
}

function userPlanLevel(user) {
    if (user?.role === 'admin') return 'pro';
    return isProUser(user) ? 'pro' : 'basic';
}

function planSatisfies(userLevel, requiredLevel) {
    return PLAN_LEVELS.indexOf(userLevel) >= PLAN_LEVELS.indexOf(requiredLevel);
}

/**
 * Access state of a domain for a user.
 *  - available: fully usable
 *  - preview:   the plan allows entry, but the tools are coming-soon placeholders
 *  - locked:    the plan does not include this studio
 */
export function getDomainAccess(domainId, user) {
    const domain = STUDIO_DOMAINS[domainId];
    if (!domain) return { state: 'locked', requiresPro: false, reason: 'Unknown studio' };

    const requiresPro = domain.minPlan === 'pro';
    if (!planSatisfies(userPlanLevel(user), domain.minPlan)) {
        return { state: 'locked', requiresPro, reason: 'Included with Pro and Scale plans' };
    }
    if (domain.status === 'coming_soon') {
        return { state: 'preview', requiresPro, reason: 'Coming soon' };
    }
    if (domain.status === 'early_access') {
        return { state: 'preview', requiresPro, reason: 'Early access' };
    }
    return { state: 'available', requiresPro, reason: '' };
}

export function canEnterDomain(domainId, user) {
    return getDomainAccess(domainId, user).state !== 'locked';
}

export function readStoredDomain() {
    try {
        const value = window.localStorage.getItem(DOMAIN_STORAGE_KEY);
        return isDomainId(value) ? value : null;
    } catch {
        return null;
    }
}

export function storeDomain(domainId) {
    if (!isDomainId(domainId)) return;
    try {
        window.localStorage.setItem(DOMAIN_STORAGE_KEY, domainId);
    } catch {
        // Storage unavailable (private mode, blocked). The choice simply is not remembered.
    }
}

export function clearStoredDomain() {
    try {
        window.localStorage.removeItem(DOMAIN_STORAGE_KEY);
    } catch {
        // Nothing to clear when storage is unavailable.
    }
}

/** Tool id encoded in a studio path such as /studio/pattern or /pattern. */
export function toolFromPathname(pathname) {
    const parts = String(pathname || '').split('/').filter(Boolean);
    return parts[0] === 'studio' ? parts[1] || null : parts[0] || null;
}

/**
 * Domain to open for a user on boot: a deep link to a domain tool wins,
 * then the remembered choice. Locked domains are ignored. Null means
 * the user must pick a studio first.
 */
export function resolveInitialDomain(user, pathname) {
    const fromPath = domainForTool(toolFromPathname(pathname));
    if (fromPath && canEnterDomain(fromPath, user)) return fromPath;

    const stored = readStoredDomain();
    if (stored && canEnterDomain(stored, user)) return stored;

    return null;
}
