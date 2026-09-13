import { describe, expect, it } from 'vitest';
import {
  BASE_SWATCHES,
  createDocument,
  fitView,
  layerFootprint,
  layerToView,
  makeLayerFromMotif,
  moveLayer,
  repeatAlongEdge,
  serializeForCompose,
  viewToLayer,
} from '../components/studio/shared/placementDocument';

const motif = { id: 9, name: 'Paisley', filename: 'p.png', url: '/uploads/p.png', width: 500, height: 250 };

describe('document and view contract', () => {
  it('fits the document inside the viewport and centres it', () => {
    const view = fitView(2000, 1000, 824, 600, 12);
    expect(view.scale).toBeCloseTo(0.4, 5);
    expect(view.offsetX).toBeCloseTo(12, 5);
    expect(view.offsetY).toBeCloseTo(100, 5);
  });

  it('round-trips a layer through view coordinates without drift', () => {
    const view = fitView(2000, 1000, 824, 600);
    const layer = { x: 1234.5, y: 321, scaleX: 0.8, scaleY: 1.2, angle: 33, flipX: true, flipY: false, opacity: 0.7 };
    const obj = layerToView(layer, view);
    const back = viewToLayer(obj, view);
    expect(back.x).toBeCloseTo(layer.x, 6);
    expect(back.y).toBeCloseTo(layer.y, 6);
    expect(back.scaleX).toBeCloseTo(layer.scaleX, 9);
    expect(back.scaleY).toBeCloseTo(layer.scaleY, 9);
    expect(back.angle).toBe(33);
    expect(back.flipX).toBe(true);
    // The view is never persisted: a different viewport gives different object props, same layer.
    const other = layerToView(layer, fitView(2000, 1000, 400, 300));
    expect(other.left).not.toBeCloseTo(obj.left, 1);
    expect(viewToLayer(other, fitView(2000, 1000, 400, 300)).x).toBeCloseTo(layer.x, 6);
  });

  it('creates centred motif layers sized to a fraction of the document', () => {
    const doc = createDocument({ width: 2000, height: 1000 });
    const layer = makeLayerFromMotif(motif, doc);
    expect(layer.x).toBe(1000);
    expect(layer.y).toBe(500);
    // 30% of 2000 = 600 wide -> scale 1.2, but 30% of 1000 = 300 tall -> scale 1.2 as well; min wins.
    expect(layer.scaleX).toBeCloseTo(1.2, 9);
    expect(layer.scaleY).toBe(layer.scaleX);
    expect(layer.visible).toBe(true);
    expect(layer.id).toMatch(/^L/);
  });

  it('computes rotated footprints', () => {
    const upright = layerFootprint({ width: 100, height: 50, scaleX: 2, scaleY: 2, angle: 0 });
    expect(upright).toEqual({ width: 200, height: 100 });
    const turned = layerFootprint({ width: 100, height: 50, scaleX: 1, scaleY: 1, angle: 90 });
    expect(turned.width).toBeCloseTo(50, 6);
    expect(turned.height).toBeCloseTo(100, 6);
  });

  it('repeats a layer evenly along an edge with unique ids', () => {
    const doc = createDocument({ width: 2000, height: 1000 });
    const layer = { ...makeLayerFromMotif(motif, doc), scaleX: 0.2, scaleY: 0.2 }; // 100 x 50 footprint
    const copies = repeatAlongEdge(doc, layer, { edge: 'bottom', count: 4, margin: 0.05 });
    expect(copies).toHaveLength(4);
    expect(copies.map((c) => c.x)).toEqual([250, 750, 1250, 1750]);
    copies.forEach((copy) => expect(copy.y).toBeCloseTo(1000 * 0.95 - 25, 6));
    expect(new Set(copies.map((c) => c.id)).size).toBe(4);
    const left = repeatAlongEdge(doc, layer, { edge: 'left', count: 2 });
    expect(left.map((c) => c.y)).toEqual([250, 750]);
    left.forEach((copy) => expect(copy.x).toBeCloseTo(2000 * 0.05 + 50, 6));
  });

  it('serializes only visible layers with rounded transforms and the base file only for image bases', () => {
    const doc = createDocument({ width: 1000, height: 800, base: { kind: 'swatch', swatch: 'velvet', color: BASE_SWATCHES[0].color, filename: 'ignored.png' } });
    doc.layers = [
      { id: 'a', filename: 'a.png', x: 10.12345, y: 20, scaleX: 1.23456, scaleY: 1, angle: 0, visible: true },
      { id: 'b', filename: 'b.png', x: 1, y: 1, visible: false },
    ];
    const payload = serializeForCompose(doc);
    expect(payload.base).toEqual({ kind: 'swatch', color: BASE_SWATCHES[0].color, filename: undefined });
    expect(payload.layers).toHaveLength(1);
    expect(payload.layers[0]).toMatchObject({ filename: 'a.png', x: 10.123, scaleX: 1.235, opacity: 1, visible: true });
    doc.base = { kind: 'image', filename: 'base.png' };
    expect(serializeForCompose(doc).base.filename).toBe('base.png');
  });

  it('moves layers within the stack and ignores impossible moves', () => {
    const layers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(moveLayer(layers, 'a', 'up').map((l) => l.id)).toEqual(['b', 'a', 'c']);
    expect(moveLayer(layers, 'c', 'up')).toBe(layers);
    expect(moveLayer(layers, 'a', 'down')).toBe(layers);
    expect(moveLayer(layers, 'zzz', 'up')).toBe(layers);
  });
});
