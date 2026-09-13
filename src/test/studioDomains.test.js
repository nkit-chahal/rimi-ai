import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  NAV,
  SHARED_USER_TOOLS,
  domainToolIds,
  navSectionLabel,
  userToolsForDomain,
} from '../components/studio/shared/studioNav';
import {
  DOMAIN_ORDER,
  DOMAIN_STORAGE_KEY,
  STUDIO_DOMAINS,
  canEnterDomain,
  clearStoredDomain,
  domainForTool,
  getDomainAccess,
  readStoredDomain,
  resolveInitialDomain,
  storeDomain,
  toolFromPathname,
} from '../components/studio/shared/studioDomains';
import { COMING_SOON_TOOLS } from '../components/studio/shared/comingSoonTools';
import { TOOL_COMPONENTS } from '../router/toolRegistry';
import { t } from '../i18n/en-IN';

/** The test runner's localStorage has no working methods, so give window a real in-memory one. */
function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  };
}

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', { value: createMemoryStorage(), configurable: true, writable: true });
});

const basicUser = { id: 1, role: 'user', plan: 'basic' };
const proUser = { id: 2, role: 'user', plan: 'pro', isPro: true };
const adminUser = { id: 3, role: 'admin', plan: 'basic' };

const PRINT_TOOLS = [
  'pattern', 'seamless', 'repeat', 'mappings', 'inspire', 'vectorize', 'upscale',
  'removebg', 'imagelayers', 'colorways', 'colorway-manager', 'vectorpro', 'mockup3d',
];

describe('studio nav and domain consistency', () => {
  it('keeps every existing print tool under the print domain', () => {
    expect(domainToolIds('print')).toEqual(PRINT_TOOLS);
    expect(STUDIO_DOMAINS.print.toolIds).toEqual(PRINT_TOOLS);
  });

  it('gives every domain tools and a default tool that belongs to it', () => {
    DOMAIN_ORDER.forEach((domainId) => {
      const domain = STUDIO_DOMAINS[domainId];
      expect(domain.toolIds.length).toBeGreaterThan(0);
      expect(domain.toolIds).toContain(domain.defaultTool);
    });
  });

  it('has a label for every tool and every domain section', () => {
    NAV.flatMap((section) => section.items).forEach((item) => {
      expect(t(`nav.${item.id}`)).not.toBe(`nav.${item.id}`);
    });
    NAV.filter((section) => section.domain).forEach((section) => {
      const label = navSectionLabel(section);
      expect(label).toBeTruthy();
      expect(label.startsWith('navSections.')).toBe(false);
    });
  });

  it('gives every embroidery and woven tool either a component or a coming-soon placeholder', () => {
    ['embroidery', 'woven'].forEach((domainId) => {
      NAV.filter((section) => section.domain === domainId)
        .flatMap((section) => section.items)
        .forEach((item) => {
          if (item.comingSoon) {
            expect(COMING_SOON_TOOLS[item.id]?.title).toBeTruthy();
            expect(TOOL_COMPONENTS[item.id]).toBeUndefined();
          } else {
            expect(TOOL_COMPONENTS[item.id]).toBeTruthy();
            expect(COMING_SOON_TOOLS[item.id]).toBeUndefined();
          }
        });
    });
    expect(TOOL_COMPONENTS['emb-threads']).toBeTruthy();
    expect(TOOL_COMPONENTS['emb-motifs']).toBeTruthy();
  });

  it('builds per-domain allow lists from shared tools plus the domain tools only', () => {
    const embroidery = userToolsForDomain('embroidery');
    SHARED_USER_TOOLS.forEach((id) => expect(embroidery).toContain(id));
    expect(embroidery).toContain('emb-placement');
    expect(embroidery).not.toContain('pattern');
    expect(embroidery).not.toContain('wv-checks');
  });
});

describe('domainForTool', () => {
  it('maps tools to their domain and shared tools to null', () => {
    expect(domainForTool('pattern')).toBe('print');
    expect(domainForTool('emb-threads')).toBe('embroidery');
    expect(domainForTool('wv-jacquard')).toBe('woven');
    expect(domainForTool('exports')).toBeNull();
    expect(domainForTool(undefined)).toBeNull();
  });
});

describe('getDomainAccess', () => {
  it('opens print to every plan', () => {
    expect(getDomainAccess('print', basicUser).state).toBe('available');
    expect(getDomainAccess('print', null).state).toBe('available');
  });

  it('locks embroidery and woven for basic plans', () => {
    expect(getDomainAccess('embroidery', basicUser)).toMatchObject({ state: 'locked', requiresPro: true });
    expect(getDomainAccess('woven', basicUser).state).toBe('locked');
    expect(canEnterDomain('woven', basicUser)).toBe(false);
  });

  it('lets pro plans and admins preview coming-soon studios', () => {
    expect(getDomainAccess('embroidery', proUser)).toMatchObject({ state: 'available' });
    expect(getDomainAccess('woven', { plan: 'Business Studio' }).state).toBe('preview');
    expect(getDomainAccess('woven', adminUser).state).toBe('preview');
  });

  it('treats unknown domains as locked', () => {
    expect(getDomainAccess('knitting', proUser).state).toBe('locked');
  });
});

describe('remembered choice and boot resolution', () => {
  beforeEach(() => clearStoredDomain());

  it('extracts the tool from studio paths', () => {
    expect(toolFromPathname('/studio/wv-checks')).toBe('wv-checks');
    expect(toolFromPathname('/pattern')).toBe('pattern');
    expect(toolFromPathname('/studio')).toBeNull();
  });

  it('prefers an accessible deep link over the stored choice', () => {
    storeDomain('print');
    expect(resolveInitialDomain(proUser, '/studio/wv-checks')).toBe('woven');
  });

  it('ignores deep links into locked studios and falls back to the stored choice', () => {
    storeDomain('print');
    expect(resolveInitialDomain(basicUser, '/studio/wv-checks')).toBe('print');
  });

  it('returns null when nothing usable is stored so the picker is shown', () => {
    expect(resolveInitialDomain(basicUser, '/studio')).toBeNull();
    storeDomain('embroidery');
    expect(resolveInitialDomain(basicUser, '/studio/exports')).toBeNull();
    expect(resolveInitialDomain(proUser, '/studio/exports')).toBe('embroidery');
  });

  it('only remembers valid domain ids', () => {
    storeDomain('nope');
    expect(readStoredDomain()).toBeNull();
    window.localStorage.setItem(DOMAIN_STORAGE_KEY, 'garbage');
    expect(readStoredDomain()).toBeNull();
    storeDomain('woven');
    expect(readStoredDomain()).toBe('woven');
    clearStoredDomain();
    expect(readStoredDomain()).toBeNull();
  });
});
