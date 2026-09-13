import fs from 'node:fs';
import path from 'node:path';
import * as fabric from 'fabric';
import { describe, expect, it } from 'vitest';

/**
 * Fabric 7 changed the default object origin from top-left to centre. Every position
 * calculation in ImageLayersTool, and the server-side compose it posts to, treats a layer's
 * left/top as its TOP-LEFT corner. These tests pin both halves of that contract.
 */
describe('Fabric origin contract', () => {
  it('still defaults to a centre origin, which is why we override it', () => {
    const rect = new fabric.Rect({ left: 100, top: 100, width: 50, height: 50, strokeWidth: 0 });
    expect(rect.originX).toBe('center');
    expect(rect.originY).toBe('center');
    // With the default origin, left/top is the CENTRE: the box starts half a width earlier.
    const bounds = rect.getBoundingRect();
    expect(Math.round(bounds.left)).toBe(75);
    expect(Math.round(bounds.top)).toBe(75);
  });

  it('places left/top at the corner once the origin is pinned', () => {
    const rect = new fabric.Rect({
      left: 100, top: 100, width: 50, height: 50, strokeWidth: 0,
      originX: 'left', originY: 'top',
    });
    const bounds = rect.getBoundingRect();
    expect(Math.round(bounds.left)).toBe(100);
    expect(Math.round(bounds.top)).toBe(100);
  });

  it('pins the origin on every layer image ImageLayersTool puts on the canvas', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../components/studio/tools/ImageLayersTool.jsx'),
      'utf-8',
    );

    // Objects are created with an identity tag (customId / customType) alongside their
    // position. Those are the ones that must pin the origin; later .set() calls that only
    // nudge left/top inherit the origin already on the object.
    const creationBlocks = [...source.matchAll(/\.set\(\{([^}]*?)\}\)/gs)]
      .map((match) => match[1])
      .filter((body) => /(^|\s)left:/.test(body)
        && /(^|\s)top:/.test(body)
        && /(^|\s)(customId|customType):/.test(body));

    expect(creationBlocks.length).toBeGreaterThanOrEqual(5);
    const unpinned = creationBlocks.filter((body) => !body.includes("originX: 'left'"));
    expect(unpinned).toEqual([]);
  });
});

/**
 * The canvas is a fitted view of the source artwork. Flatten must invert that view so exports
 * land at full source resolution instead of whatever size the browser window happened to be.
 */
describe('compose payload is in document space, not view space', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../components/studio/tools/ImageLayersTool.jsx'),
    'utf-8',
  );

  it('inverts the view transform instead of posting raw canvas coordinates', () => {
    expect(source).toContain('const buildComposePayload = ');
    // Coordinates are divided back out of the fitted scale...
    expect(source).toMatch(/x: \(\(obj\.left \|\| 0\) - offsetX\) \/ scale/);
    expect(source).toMatch(/scaleX: \(obj\.scaleX \|\| 1\) \/ scale/);
    // ...and the exported size comes from the source artwork, not the on-screen canvas.
    expect(source).toMatch(/width: Math\.round\(layout\?\.sourceWidth/);
  });

  it('no longer sends the on-screen canvas size as the export size', () => {
    expect(source).not.toContain('width: Math.round(canvas.getWidth())');
    expect(source).not.toContain('height: Math.round(canvas.getHeight())');
  });

  it('keeps the view transform in sync when the group is centred or the canvas resized', () => {
    // Both shift every object; if the recorded offset is not shifted too, the inversion drifts.
    expect(source).toContain('baseCanvasLayoutRef.current.baseLeft += offsetX');
    expect(source).toContain('baseCanvasLayoutRef.current.baseLeft += dx');
  });

  it('builds the compose payload in one place, not duplicated per call site', () => {
    // Defined once, called by both Flatten and Save to Project.
    expect((source.match(/const buildComposePayload = /g) || []).length).toBe(1);
    expect((source.match(/buildComposePayload\(\)/g) || []).length).toBe(2);
  });
});
