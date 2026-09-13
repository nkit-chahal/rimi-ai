"""Appliqué patches and procedural embellishments (sequins, beads, mirror work).

Everything here is deterministic PIL/numpy work: no model calls, so it can run for a credit or two.
Outputs are RGBA PNGs that slot into the Motif Library and Placement Studio like any other motif.
"""
import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

EDGE_STYLES = ('satin', 'blanket', 'none')
FILL_KINDS = ('solid', 'image')
EMBELLISHMENT_KINDS = ('sequin', 'bead', 'mirror')
LAYOUTS = ('scatter', 'row', 'cluster')
MAX_CANVAS = 3000
MAX_COUNT = 400


def parse_hex(value, default=(200, 40, 60)):
    if not isinstance(value, str):
        return default
    digits = value.strip().lstrip('#')
    if len(digits) == 3:
        digits = ''.join(ch * 2 for ch in digits)
    if len(digits) != 6:
        return default
    try:
        return tuple(int(digits[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return default


def _shade(rgb, factor):
    return tuple(max(0, min(255, int(round(c * factor)))) for c in rgb)


# ---------------------------------------------------------------------------
# Appliqué
# ---------------------------------------------------------------------------
def _tile_fill(fill_img, width, height, scale):
    """Tile a print across the canvas; ``scale`` is the tile width as a fraction of the canvas width."""
    tile_w = max(8, int(round(width * max(0.05, min(1.0, scale)))))
    ratio = tile_w / max(1, fill_img.width)
    tile_h = max(8, int(round(fill_img.height * ratio)))
    tile = fill_img.convert('RGBA').resize((tile_w, tile_h), Image.LANCZOS)
    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    for y in range(0, height, tile_h):
        for x in range(0, width, tile_w):
            canvas.alpha_composite(tile, dest=(x, y))
    return canvas


def render_applique(shape_img, fill, edge=None, shadow=False, fill_img=None):
    """Cut ``fill`` into the silhouette of ``shape_img`` and finish the edge like a real appliqué.

    fill: {'kind': 'solid', 'color': '#hex'} or {'kind': 'image', 'scale': 0.5} with ``fill_img`` supplied.
    edge: {'style': 'satin'|'blanket'|'none', 'color': '#hex', 'width': px}
    Returns an RGBA image padded for the edge and shadow.
    """
    edge = edge or {}
    style = edge.get('style') if edge.get('style') in EDGE_STYLES else 'satin'
    edge_width = int(max(0, min(40, int(edge.get('width', 6) or 0)))) if style != 'none' else 0
    edge_color = parse_hex(edge.get('color'), (245, 220, 120))
    pad = edge_width + (6 if shadow else 0) + 2

    shape = shape_img.convert('RGBA')
    alpha = np.array(shape.split()[3])
    mask = alpha > 40
    if not mask.any():
        raise ValueError('The shape image has no visible pixels to cut from')

    width = shape.width + pad * 2
    height = shape.height + pad * 2
    padded = np.zeros((height, width), dtype=bool)
    padded[pad:pad + shape.height, pad:pad + shape.width] = mask

    # Fill layer
    fill = fill or {}
    if fill.get('kind') == 'image' and fill_img is not None:
        fill_layer = _tile_fill(fill_img, width, height, float(fill.get('scale', 0.5) or 0.5))
    else:
        fill_layer = Image.new('RGBA', (width, height), parse_hex(fill.get('color'), (200, 40, 60)) + (255,))
    fill_arr = np.array(fill_layer)
    fill_arr[..., 3] = np.where(padded, fill_arr[..., 3], 0)
    patch = Image.fromarray(fill_arr, 'RGBA')

    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))

    # Shadow under the whole patch (including the stitched edge)
    if shadow:
        outer = ndimage.binary_dilation(padded, iterations=max(1, edge_width)) if edge_width else padded
        shadow_arr = np.zeros((height, width, 4), dtype=np.uint8)
        shadow_arr[..., 3] = np.where(outer, 110, 0).astype(np.uint8)
        shadow_img = Image.fromarray(shadow_arr, 'RGBA').filter(ImageFilter.GaussianBlur(radius=3))
        shifted = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        shifted.alpha_composite(shadow_img, dest=(3, 4))
        canvas.alpha_composite(shifted)

    canvas.alpha_composite(patch)

    # Stitched edge: a ring around the silhouette
    if edge_width > 0:
        outer = ndimage.binary_dilation(padded, iterations=edge_width)
        ring = outer & ~padded
        ys, xs = np.mgrid[0:height, 0:width]
        if style == 'satin':
            # Dense satin stitch: fine diagonal thread lines with a slightly darker groove every third line.
            groove = ((xs + ys) % 3) == 0
            ring_rgb = np.where(groove[..., None], np.array(_shade(edge_color, 0.78), dtype=np.uint8), np.array(edge_color, dtype=np.uint8))
            ring_alpha = np.where(ring, 255, 0)
        else:  # blanket stitch: chunky dashes with gaps
            dash = ((xs // 6 + ys // 6) % 2) == 0
            ring_rgb = np.broadcast_to(np.array(edge_color, dtype=np.uint8), (height, width, 3))
            ring_alpha = np.where(ring & dash, 255, 0)
        ring_arr = np.zeros((height, width, 4), dtype=np.uint8)
        ring_arr[..., :3] = ring_rgb
        ring_arr[..., 3] = ring_alpha.astype(np.uint8)
        canvas.alpha_composite(Image.fromarray(ring_arr, 'RGBA'))

    return canvas


# ---------------------------------------------------------------------------
# Embellishments
# ---------------------------------------------------------------------------
def _draw_sequin(draw, cx, cy, radius, color):
    light = _shade(color, 1.35)
    dark = _shade(color, 0.7)
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color + (255,), outline=dark + (255,), width=max(1, radius // 8))
    # Highlight crescent
    hr = radius * 0.62
    draw.ellipse((cx - hr, cy - hr - radius * 0.18, cx + hr * 0.4, cy + hr * 0.2), fill=light + (150,))
    # Centre hole
    hole = max(1, radius // 5)
    draw.ellipse((cx - hole, cy - hole, cx + hole, cy + hole), fill=(0, 0, 0, 0))


def _draw_bead(draw, cx, cy, radius, color):
    steps = max(3, int(radius))
    for i in range(steps, 0, -1):
        t = i / steps
        shade = _shade(color, 0.55 + 0.75 * (1 - t))
        r = radius * t
        ox = -radius * 0.25 * (1 - t)
        oy = -radius * 0.25 * (1 - t)
        draw.ellipse((cx - r + ox, cy - r + oy, cx + r + ox, cy + r + oy), fill=shade + (255,))
    spec = max(1, radius // 4)
    draw.ellipse((cx - radius * 0.45 - spec, cy - radius * 0.45 - spec, cx - radius * 0.45 + spec, cy - radius * 0.45 + spec), fill=(255, 255, 255, 220))


def _draw_mirror(draw, cx, cy, radius, thread_color):
    glass_r = radius * 0.72
    draw.ellipse((cx - glass_r, cy - glass_r, cx + glass_r, cy + glass_r), fill=(205, 212, 222, 255), outline=(150, 158, 170, 255), width=1)
    draw.chord((cx - glass_r, cy - glass_r, cx + glass_r, cy + glass_r), start=200, end=300, fill=(245, 248, 252, 200))
    # Stitched ring around the glass, as in shisha work
    segments = max(8, int(radius))
    for k in range(segments):
        a0 = (360 / segments) * k
        a1 = a0 + (360 / segments) * 0.55
        draw.arc((cx - radius, cy - radius, cx + radius, cy + radius), start=a0, end=a1, fill=thread_color + (255,), width=max(2, radius // 5))
    for k in range(segments // 2):
        angle = math.radians((360 / (segments // 2)) * k)
        x0, y0 = cx + glass_r * 0.92 * math.cos(angle), cy + glass_r * 0.92 * math.sin(angle)
        x1, y1 = cx + radius * math.cos(angle), cy + radius * math.sin(angle)
        draw.line((x0, y0, x1, y1), fill=thread_color + (255,), width=max(1, radius // 8))


def _positions(layout, count, width, height, radius, rng):
    if layout == 'row':
        cy = height / 2
        step = width / count
        return [((i + 0.5) * step, cy) for i in range(count)]
    if layout == 'cluster':
        points = []
        for _ in range(count):
            points.append((
                min(width - radius, max(radius, rng.gauss(width / 2, width / 6))),
                min(height - radius, max(radius, rng.gauss(height / 2, height / 6))),
            ))
        return points
    points = []
    attempts = 0
    while len(points) < count and attempts < count * 40:
        attempts += 1
        x = rng.uniform(radius, max(radius, width - radius))
        y = rng.uniform(radius, max(radius, height - radius))
        if all((x - px) ** 2 + (y - py) ** 2 >= (radius * 1.6) ** 2 for px, py in points):
            points.append((x, y))
    return points


def render_embellishment(kind='sequin', layout='scatter', count=40, size=24, colors=None, width=800, height=400, seed=7):
    """Draw a sheet of sequins, beads or mirrors as an RGBA motif."""
    kind = kind if kind in EMBELLISHMENT_KINDS else 'sequin'
    layout = layout if layout in LAYOUTS else 'scatter'
    width = max(64, min(MAX_CANVAS, int(width)))
    height = max(64, min(MAX_CANVAS, int(height)))
    count = max(1, min(MAX_COUNT, int(count)))
    radius = max(3, min(min(width, height) // 2, int(size) // 2))
    palette = [parse_hex(c, (230, 190, 90)) for c in (colors or ['#e6bd5a'])] or [(230, 190, 90)]
    rng = random.Random(int(seed))

    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    for index, (cx, cy) in enumerate(_positions(layout, count, width, height, radius, rng)):
        color = palette[index % len(palette)] if layout == 'row' else rng.choice(palette)
        if kind == 'sequin':
            _draw_sequin(draw, cx, cy, radius, color)
        elif kind == 'bead':
            _draw_bead(draw, cx, cy, radius, color)
        else:
            _draw_mirror(draw, cx, cy, radius, color)
    return canvas
