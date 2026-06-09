import { describe, expect, it } from 'vitest';
import { normalizeToken } from '../components/studio/shared/helpers';

describe('normalizeToken', () => {
  it('returns null for empty values', () => {
    expect(normalizeToken('')).toBeNull();
    expect(normalizeToken(null)).toBeNull();
  });

  it('trims whitespace from token strings', () => {
    expect(normalizeToken('  abc.def.ghi  ')).toBe('abc.def.ghi');
  });
});
