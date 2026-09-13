import { describe, expect, it } from 'vitest';
import {
  deltaEQuality,
  normalizeHex,
  parseShadeCardCsv,
  parseShadeCardFile,
  parseShadeCardJson,
  threadPaletteToCsv,
} from '../components/studio/shared/shadeCardImport';

describe('normalizeHex', () => {
  it('accepts 3 and 6 digit forms with or without a hash', () => {
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex(' #123456 ')).toBe('#123456');
    expect(normalizeHex('#12')).toBeNull();
    expect(normalizeHex(12)).toBeNull();
  });
});

describe('parseShadeCardCsv', () => {
  it('reads a header row in any column order', () => {
    const { entries, errors } = parseShadeCardCsv('Name,Hex,Code\nScarlet,#C8102E,215\n"Zari, Gold",b8860b,7010\n');
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { code: '215', name: 'Scarlet', hex: '#c8102e' },
      { code: '7010', name: 'Zari, Gold', hex: '#b8860b' },
    ]);
  });

  it('handles headerless rows and semicolon separators', () => {
    const { entries, errors } = parseShadeCardCsv('101;Snow;#FFFFFF\n202;;f5b400\nbroken;row');
    expect(entries).toEqual([
      { code: '101', name: 'Snow', hex: '#ffffff' },
      { code: '202', name: '', hex: '#f5b400' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Line 3/);
  });

  it('reports an empty file', () => {
    expect(parseShadeCardCsv('').errors).toEqual(['The file is empty']);
  });
});

describe('parseShadeCardJson and file dispatch', () => {
  it('accepts arrays and wrapped objects', () => {
    expect(parseShadeCardJson('[{"code":"1","hex":"#111111"}]').entries).toEqual([{ code: '1', name: '', hex: '#111111' }]);
    expect(parseShadeCardJson('{"entries":[{"number":"2","colour":"#222222","name":"Two"}]}').entries).toEqual([{ code: '2', name: 'Two', hex: '#222222' }]);
    expect(parseShadeCardJson('nope').errors).toEqual(['Invalid JSON']);
  });

  it('dispatches on file extension', () => {
    expect(parseShadeCardFile('card.JSON', '[{"code":"1","hex":"#111111"}]').entries).toHaveLength(1);
    expect(parseShadeCardFile('card.csv', 'code,hex\n1,#111111').entries).toHaveLength(1);
  });
});

describe('deltaEQuality and CSV export', () => {
  it('labels distances', () => {
    expect(deltaEQuality(0.5).label).toBe('Exact');
    expect(deltaEQuality(2.5).label).toBe('Very close');
    expect(deltaEQuality(5).label).toBe('Close');
    expect(deltaEQuality(12).label).toBe('Nearest');
  });

  it('writes a CSV with escaped names', () => {
    const csv = threadPaletteToCsv([{ sourceHex: '#c9102f', code: 'T-015', name: 'Scarlet "bright"', hex: '#c8102e', deltaE: 0.4 }]);
    expect(csv.split('\n')).toEqual([
      'source_hex,shade_code,shade_name,shade_hex,delta_e',
      '#c9102f,T-015,"Scarlet ""bright""",#c8102e,0.40',
    ]);
  });
});
