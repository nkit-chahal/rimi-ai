import { describe, expect, it } from 'vitest';
import { calcExportGrid, calcRepeatLayoutMetrics } from '../components/studio/shared/repeatLayout';

describe('calcExportGrid', () => {
  it('uses full tiles that fit — 12″ on 54″ → 4, not ceil 5', () => {
    expect(calcExportGrid(54, 12)).toBe(4);
  });

  it('exact fabric fit stays exact — 9″ on 54″ → 6', () => {
    expect(calcExportGrid(54, 9)).toBe(6);
  });

  it('exact fabric fit — 12″ on 60″ → 5', () => {
    expect(calcExportGrid(60, 12)).toBe(5);
  });

  it('single full tile when only one fits — 36″ on 54″ → 1', () => {
    expect(calcExportGrid(54, 36)).toBe(1);
  });

  it('engineered 48″ on 60″ exports 1×1, not ceil 2', () => {
    expect(calcExportGrid(60, 48)).toBe(1);
  });

  it('oversized tile still returns a 2×2 sample sheet', () => {
    expect(calcExportGrid(54, 72)).toBe(2);
  });

  it('caps at 8 tiles across', () => {
    expect(calcExportGrid(54, 2)).toBe(8);
  });
});

describe('calcRepeatLayoutMetrics (12″ tile, 54″ fabric)', () => {
  const m = calcRepeatLayoutMetrics({
    fabricWidth: 54,
    tileWidth: 12,
    tileHeight: 12,
    dpi: 300,
  });

  it('reports 4.5 across / 4 full', () => {
    expect(m.repeatsAcross).toBeCloseTo(4.5);
    expect(m.fullRepeatsAcross).toBe(4);
    expect(m.repeatsLabel).toBe('4 full (4.50 across)');
  });

  it('export sheet is 4×4 = 48″, not 5×5 = 60″', () => {
    expect(m.exportGrid).toBe(4);
    expect(m.sheetInW).toBe('48.0');
    expect(m.sheetInH).toBe('48.0');
    expect(m.sheetPxW).toBe(14400);
    expect(m.sheetPxH).toBe(14400);
  });

  it('keeps yardage remainder peek past fabric guide', () => {
    expect(m.previewCols).toBe(5); // ceil padding past fabric guide
    expect(m.previewRows).toBe(3);
    expect(m.fabricLockedPreview).toBe(false);
    expect(m.gridNote).toBe('Preview padded; 4 full fit in 54″');
    expect(m.gridNote).not.toMatch(/Matches 5/);
  });

  it('sizes tiles so fabric preview width equals fabric inches', () => {
    expect(m.tileDisplayW * m.repeatsAcross).toBeCloseTo(m.fabricPreviewPx);
  });
});

describe('calcRepeatLayoutMetrics exact fit', () => {
  it('labels exact tile counts as matching fabric', () => {
    const m = calcRepeatLayoutMetrics({
      fabricWidth: 54,
      tileWidth: 9,
      tileHeight: 9,
      dpi: 300,
    });
    expect(m.exportGrid).toBe(6);
    expect(m.sheetInW).toBe('54.0');
    expect(m.gridNote).toBe('Matches 6 tiles across 54″');
  });

  it('12″ on 60″ is exact 5 across and 5×5 export', () => {
    const m = calcRepeatLayoutMetrics({
      fabricWidth: 60,
      tileWidth: 12,
      tileHeight: 12,
      dpi: 300,
    });
    expect(m.repeatsAcross).toBeCloseTo(5);
    expect(m.exportGrid).toBe(5);
    expect(m.previewCols).toBe(5);
    expect(m.sheetInW).toBe('60.0');
    expect(m.gridNote).toBe('Matches 5 tiles across 60″');
  });
});

describe('calcRepeatLayoutMetrics engineered (48″ on 60″)', () => {
  const m = calcRepeatLayoutMetrics({
    fabricWidth: 60,
    tileWidth: 48,
    tileHeight: 48,
    dpi: 300,
  });

  it('sidebar repeats match fabric math', () => {
    expect(m.repeatsAcross).toBeCloseTo(1.25);
    expect(m.fullRepeatsAcross).toBe(1);
    expect(m.repeatsLabel).toBe('1 full (1.25 across)');
  });

  it('export stays 1×1 — does not ceil to 2', () => {
    expect(m.exportGrid).toBe(1);
    expect(m.sheetInW).toBe('48.0');
    expect(m.sheetInH).toBe('48.0');
  });

  it('preview is fabric-locked — not a misleading 2×3 wall', () => {
    expect(m.fabricLockedPreview).toBe(true);
    expect(m.previewCols).toBe(1);
    expect(m.previewRows).toBe(2);
    expect(m.canvasPxW).toBe(m.fabricPreviewPx);
    expect(m.gridLabel).toMatch(/1×1 export/);
    expect(m.gridNote).toMatch(/1\.25 across/);
    expect(m.gridLabel).not.toMatch(/2×3/);
  });
});
