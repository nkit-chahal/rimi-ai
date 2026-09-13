"""Stitch Styles: render flat motifs or whole placements as realistic embroidery.

Two modes:
- ``motif``: an RGBA motif is placed on the chroma-green matte used by the layer editor, rendered
  by the image-edit model, then keyed back to transparency and clipped to the original silhouette
  so it can go straight back into the Motif Library.
- ``design``: an opaque flattened placement is re-rendered in place by the mockup model so the
  composition stays identical and only the surface becomes thread.
"""
import base64
import io
import time

import numpy as np
import replicate
import requests as http_requests
from PIL import Image
from scipy import ndimage

from auth import green_matte_to_rgba, remove_background_with_rmbg, rgba_layer_to_green_matte

MOTIF_MODEL = 'qwen/qwen-image-edit'
DESIGN_MODEL = 'google/nano-banana-2'
MATTE = (30, 215, 96)
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5
MAX_INPUT_PX = 1024

STITCH_STYLES = {
    'satin': {
        'label': 'Satin stitch',
        'prompt': 'smooth satin stitch with long parallel threads that follow each shape and a soft glossy sheen',
        'density': 900,
        'blurb': 'Lettering, borders and shapes under 1 cm wide.',
    },
    'fill': {
        'label': 'Tatami fill',
        'prompt': 'dense tatami fill stitch built from fine parallel rows with a subtle woven texture',
        'density': 1200,
        'blurb': 'Large areas and solid backgrounds.',
    },
    'chain': {
        'label': 'Chain stitch',
        'prompt': 'chain stitch made of interlocking looped stitches that follow the outlines',
        'density': 500,
        'blurb': 'Outlines and folk motifs.',
    },
    'french_knot': {
        'label': 'French knots',
        'prompt': 'clusters of French knots giving a raised, dotted, textured surface',
        'density': 250,
        'blurb': 'Flower centres and textured fills.',
    },
    'zardozi': {
        'label': 'Zardozi',
        'prompt': 'zardozi work with couched metallic gold and silver wire, raised and glinting, accented with sequins and beads',
        'density': 700,
        'blurb': 'Bridal and festive borders on silk and velvet.',
    },
    'aari': {
        'label': 'Aari (tambour)',
        'prompt': 'aari tambour work of fine continuous chain stitches made with a hook, delicate and even',
        'density': 550,
        'blurb': 'Fine all-over work on sarees and blouses.',
    },
    'kantha': {
        'label': 'Kantha running stitch',
        'prompt': 'kantha running stitch with rows of small, even hand stitches that gently ripple the fabric',
        'density': 200,
        'blurb': 'Quilted, hand-made look.',
    },
    'cross': {
        'label': 'Cross stitch',
        'prompt': 'counted cross stitch made of a grid of small X-shaped stitches',
        'density': 400,
        'blurb': 'Geometric and folk designs.',
    },
}

FINISHES = {
    'cotton': 'matte cotton thread',
    'rayon': 'glossy rayon thread',
    'metallic': 'metallic thread',
}
DENSITIES = {
    'light': ('light, open coverage that lets the fabric show through', 0.7),
    'medium': ('medium coverage', 1.0),
    'dense': ('dense, full coverage with no fabric showing', 1.4),
}
DIRECTIONS = {
    'follow': 'stitch direction following the contours of each shape',
    'horizontal': 'stitches running horizontally',
    'diagonal': 'stitches running on a 45 degree diagonal',
}


def style_catalogue():
    return [
        {'id': key, 'label': value['label'], 'blurb': value['blurb'], 'density': value['density']}
        for key, value in STITCH_STYLES.items()
    ]


def _fragments(style, finish, density, direction):
    style_text = STITCH_STYLES.get(style, STITCH_STYLES['satin'])['prompt']
    finish_text = FINISHES.get(finish, FINISHES['rayon'])
    density_text = DENSITIES.get(density, DENSITIES['medium'])[0]
    direction_text = DIRECTIONS.get(direction, DIRECTIONS['follow'])
    return style_text, finish_text, density_text, direction_text


def build_motif_prompt(style, finish, density, direction):
    style_text, finish_text, density_text, direction_text = _fragments(style, finish, density, direction)
    return (
        "The foreground design sits on a flat chroma green background. "
        f"Recreate the foreground as real embroidery: {style_text}, in {finish_text}, {density_text}, {direction_text}. "
        "Keep the exact silhouette, colours and composition; do not add new elements or change the background. "
        "Photorealistic close-up thread texture with slight relief and natural shadow. "
        "Keep the background flat solid chroma green."
    )


def build_design_prompt(style, finish, density, direction):
    style_text, finish_text, density_text, direction_text = _fragments(style, finish, density, direction)
    return (
        "Use @Image 1 as the design. Recreate it as real embroidery on the same fabric: "
        f"{style_text}, in {finish_text}, {density_text}, {direction_text}. "
        "Keep the composition, placement, proportions and colours exactly as in @Image 1; only the rendering changes "
        "so every motif becomes embroidered thread with raised relief and natural shadows on the fabric. "
        "Do not add motifs, do not repeat the design, do not change the base fabric colour. Photorealistic, 4K."
    )


def _downscale(img, max_px=MAX_INPUT_PX):
    if max(img.size) <= max_px:
        return img
    scale = max_px / max(img.size)
    return img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)


def _to_data_uri(img, fmt='PNG'):
    buffer = io.BytesIO()
    if fmt == 'JPEG':
        img.convert('RGB').save(buffer, format='JPEG', quality=90)
        mime = 'image/jpeg'
    else:
        img.save(buffer, format='PNG')
        mime = 'image/png'
    return f"data:{mime};base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}"


def _download(output):
    try:
        return output.read()
    except AttributeError:
        url = str(output[0]) if isinstance(output, list) and output else str(output)
        resp = http_requests.get(url, timeout=120)
        resp.raise_for_status()
        return resp.content


def run_model(model, model_input):
    """Call Replicate with retries. Returns (bytes, duration_seconds)."""
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            t0 = time.time()
            output = replicate.run(model, input=model_input)
            content = _download(output)
            return content, time.time() - t0
        except Exception as exc:  # network / model hiccups
            last_exc = exc
            if attempt < MAX_RETRIES:
                time.sleep(attempt * RETRY_BACKOFF_SECONDS)
    raise RuntimeError(f'Model call failed: {last_exc}')


def _nearest_aspect(width, height):
    ratio = width / max(1, height)
    options = {'1:1': 1.0, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16, '3:2': 1.5, '2:3': 2 / 3}
    return min(options, key=lambda key: abs(options[key] - ratio))


def render_motif(source, style, finish, density, direction):
    """RGBA motif -> RGBA embroidered motif. Returns (image, prompt, duration)."""
    rgba = _downscale(source.convert('RGBA'))
    matte = rgba_layer_to_green_matte(rgba, MATTE)
    prompt = build_motif_prompt(style, finish, density, direction)
    content, duration = run_model(MOTIF_MODEL, {'image': _to_data_uri(matte), 'prompt': prompt})

    result = Image.open(io.BytesIO(content)).convert('RGB').resize(rgba.size, Image.LANCZOS)
    keyed = remove_background_with_rmbg(result) or green_matte_to_rgba(result, MATTE)
    keyed = keyed.convert('RGBA').resize(rgba.size, Image.LANCZOS)

    # Clip to a slightly grown version of the original silhouette: stitches may bulge, stray green should not.
    original_alpha = np.array(rgba.split()[3]) > 24
    grow = max(2, int(round(min(rgba.size) * 0.015)))
    allowed = ndimage.binary_dilation(original_alpha, iterations=grow)
    arr = np.array(keyed)
    arr[..., 3] = np.where(allowed, arr[..., 3], 0)
    return Image.fromarray(arr, 'RGBA'), prompt, duration


def render_design(source, style, finish, density, direction):
    """Opaque design -> opaque embroidered design. Returns (image, prompt, duration)."""
    rgb = _downscale(source.convert('RGB'))
    prompt = build_design_prompt(style, finish, density, direction)
    content, duration = run_model(DESIGN_MODEL, {
        'prompt': prompt,
        'image_input': [_to_data_uri(rgb, 'JPEG')],
        'aspect_ratio': _nearest_aspect(*rgb.size),
    })
    result = Image.open(io.BytesIO(content)).convert('RGB')
    return result, prompt, duration
