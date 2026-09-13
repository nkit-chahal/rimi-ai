"""Render a Placement Studio document to a PIL image.

The document contract, shared with the frontend canvas:
- ``width`` / ``height`` are the document size in pixels.
- ``base`` is ``{kind: 'image'|'solid'|'swatch', filename?, color?}``. Image bases are fitted
  (cover) to the document; the frontend sizes the document to the image, so no crop happens
  in the normal path.
- Each layer's ``x`` / ``y`` is the layer's CENTRE in document pixels. ``scaleX`` / ``scaleY``
  multiply the source image's own pixel size, ``angle`` is clockwise degrees, and flips are
  applied before scaling. This matches Fabric.js objects created with a centre origin.
"""
import math

import numpy as np
from PIL import Image, ImageOps

MIN_SIZE = 64
MAX_SIZE = 6000
MAX_LAYERS = 40
DEFAULT_BASE_COLOR = (247, 244, 238, 255)


def parse_hex(value, default=DEFAULT_BASE_COLOR):
    if not isinstance(value, str):
        return default
    digits = value.strip().lstrip('#')
    if len(digits) == 3:
        digits = ''.join(ch * 2 for ch in digits)
    if len(digits) != 6:
        return default
    try:
        return tuple(int(digits[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    except ValueError:
        return default


def clamp_size(value, fallback):
    try:
        size = int(round(float(value)))
    except (TypeError, ValueError):
        return fallback
    return max(MIN_SIZE, min(MAX_SIZE, size))


def _vignette(width, height, strength=0.18):
    """Radial darkening used for fabric swatch bases, as an RGBA overlay."""
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float64)
    cx, cy = (width - 1) / 2.0, (height - 1) / 2.0
    dist = np.sqrt(((xs - cx) / max(cx, 1)) ** 2 + ((ys - cy) / max(cy, 1)) ** 2) / math.sqrt(2)
    alpha = np.clip(dist, 0, 1) ** 2 * strength * 255
    overlay = np.zeros((height, width, 4), dtype=np.uint8)
    overlay[..., 3] = alpha.astype(np.uint8)
    return Image.fromarray(overlay, 'RGBA')


def render_base(base, width, height, resolve_path):
    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    base = base or {}
    kind = base.get('kind') or 'solid'
    color = parse_hex(base.get('color'))

    if kind == 'image' and base.get('filename'):
        path = resolve_path(base.get('filename'))
        if path:
            with Image.open(path) as img:
                fitted = ImageOps.fit(img.convert('RGBA'), (width, height), Image.LANCZOS)
            canvas.alpha_composite(fitted)
            return canvas

    canvas.paste(color, (0, 0, width, height))
    if kind == 'swatch':
        canvas.alpha_composite(_vignette(width, height))
    return canvas


def _composite_at(canvas, img, left, top):
    """Alpha-composite ``img`` onto ``canvas`` at (left, top), clipping to the canvas.

    ``Image.paste`` with an RGBA mask applies the alpha twice on transparent canvases, which
    darkens anti-aliased edges and breaks layer opacity; ``alpha_composite`` does not.
    """
    canvas_w, canvas_h = canvas.size
    img_w, img_h = img.size
    x0, y0 = max(left, 0), max(top, 0)
    x1, y1 = min(left + img_w, canvas_w), min(top + img_h, canvas_h)
    if x1 <= x0 or y1 <= y0:
        return
    canvas.alpha_composite(img, dest=(x0, y0), source=(x0 - left, y0 - top, x1 - left, y1 - top))


def render_layer(layer, width, height, resolve_path):
    """Return a document-sized RGBA image with the transformed layer, or None."""
    path = resolve_path(layer.get('filename'))
    if not path:
        return None
    with Image.open(path) as source:
        img = source.convert('RGBA')

    if layer.get('flipX'):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if layer.get('flipY'):
        img = img.transpose(Image.FLIP_TOP_BOTTOM)

    sx = abs(float(layer.get('scaleX', 1.0) or 1.0))
    sy = abs(float(layer.get('scaleY', 1.0) or 1.0))
    new_w = max(1, int(round(img.width * sx)))
    new_h = max(1, int(round(img.height * sy)))
    if (new_w, new_h) != img.size:
        img = img.resize((new_w, new_h), Image.LANCZOS)

    angle = float(layer.get('angle', 0) or 0) % 360
    if angle:
        # Fabric angles are clockwise; PIL rotates counter-clockwise, and expands around the centre.
        img = img.rotate(-angle, expand=True, resample=Image.BICUBIC)

    opacity = float(layer.get('opacity', 1.0) if layer.get('opacity') is not None else 1.0)
    opacity = max(0.0, min(1.0, opacity))
    if opacity < 1.0:
        r, g, b, a = img.split()
        a = a.point(lambda p: int(p * opacity))
        img = Image.merge('RGBA', (r, g, b, a))

    cx = float(layer.get('x', width / 2))
    cy = float(layer.get('y', height / 2))
    left = int(round(cx - img.width / 2))
    top = int(round(cy - img.height / 2))

    layer_canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    _composite_at(layer_canvas, img, left, top)
    return layer_canvas


def render_document(document, resolve_path):
    """Render the whole document. ``resolve_path(filename) -> path or None`` supplies files."""
    document = document or {}
    width = clamp_size(document.get('width'), 2000)
    height = clamp_size(document.get('height'), 2000)
    canvas = render_base(document.get('base'), width, height, resolve_path)

    layers = [layer for layer in (document.get('layers') or []) if isinstance(layer, dict)]
    rendered_count = 0
    for layer in layers[:MAX_LAYERS]:
        if layer.get('visible') is False:
            continue
        rendered = render_layer(layer, width, height, resolve_path)
        if rendered is not None:
            canvas.alpha_composite(rendered)
            rendered_count += 1
    return canvas, rendered_count
