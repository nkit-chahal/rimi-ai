import { describe, expect, it } from 'vitest';
import {
  EMBROIDERY_FABRICS,
  EMBROIDERY_PRODUCTS,
  EMBROIDERY_TECHNIQUES,
  productById,
  suitability,
} from '../components/studio/shared/embroideryMockups';

describe('embroidery mockup reference data', () => {
  it('gives every product at least two placement zones and a unique id', () => {
    const ids = EMBROIDERY_PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    EMBROIDERY_PRODUCTS.forEach((product) => {
      expect(product.zones.length).toBeGreaterThanOrEqual(2);
      expect(product.label).toBeTruthy();
    });
    expect(productById('saree').zones).toContain('pallu');
    expect(productById('nope')).toBeNull();
  });

  it('warns on the combinations an embroidery unit would reject', () => {
    expect(suitability('zari', 'tshirt', 'jersey').level).toBe('avoid');
    expect(suitability('sequin', 'cushion', 'cotton').level).toBe('avoid');
    expect(suitability('mirror', 'curtain', 'cotton').level).toBe('avoid');
  });

  it('marks classic pairings good and falls back to good with a neutral note', () => {
    expect(suitability('zari', 'saree', 'silk')).toMatchObject({ level: 'good' });
    expect(suitability('zari', 'saree', 'cotton').level).toBe('ok');
    expect(suitability('applique', 'tote_bag', 'denim').level).toBe('good');
    expect(suitability('thread', 'dress', 'cotton')).toMatchObject({ level: 'good', note: 'No known issues for this combination.' });
  });

  it('exposes technique and fabric lists with ids the backend accepts', () => {
    expect(EMBROIDERY_TECHNIQUES.map((t) => t.id)).toEqual(['thread', 'zari', 'applique', 'sequin', 'mirror']);
    expect(EMBROIDERY_FABRICS.length).toBeGreaterThan(5);
  });
});
