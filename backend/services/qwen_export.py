"""Export Qwen layered sessions to PNG, ZIP, PSD, or SVG."""
import io
import json
import os
import tempfile
import uuid
import zipfile
from xml.sax.saxutils import quoteattr

from PIL import Image

from config import RESULTS_DIR
from services.qwen_layers import _resolve_filepath
import storage


def _load_layer_image(filename):
    path = _resolve_filepath(filename)
    if not path:
        return None
    return Image.open(path).convert('RGBA')


def export_session_png(document, canvas_width, canvas_height):
    """Flatten session layers to PNG bytes."""
    canvas = Image.new('RGBA', (canvas_width, canvas_height), (0, 0, 0, 0))
    for layer in document.get('layers', []):
        if not layer.get('visible', True):
            continue
        img = _load_layer_image(layer.get('filename'))
        if img is None:
            continue

        if layer.get('flipX'):
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        if layer.get('flipY'):
            img = img.transpose(Image.FLIP_TOP_BOTTOM)

        sx = float(layer.get('scaleX', 1.0))
        sy = float(layer.get('scaleY', 1.0))
        new_w = max(1, int(img.width * abs(sx)))
        new_h = max(1, int(img.height * abs(sy)))
        img = img.resize((new_w, new_h), Image.LANCZOS)

        angle = float(layer.get('angle', 0))
        if angle != 0:
            img = img.rotate(-angle, expand=True, resample=Image.BICUBIC)

        opacity = float(layer.get('opacity', 1.0))
        if opacity < 1.0:
            r, g, b, a = img.split()
            a = a.point(lambda p: int(p * opacity))
            img = Image.merge('RGBA', (r, g, b, a))

        layer_canvas = Image.new('RGBA', (canvas_width, canvas_height), (0, 0, 0, 0))
        x = int(float(layer.get('x', 0)))
        y = int(float(layer.get('y', 0)))
        layer_canvas.paste(img, (x, y), img)
        canvas.alpha_composite(layer_canvas)

    buffer = io.BytesIO()
    canvas.save(buffer, format='PNG')
    return buffer.getvalue()


def export_session_zip(document, session_name='qwen_session'):
    """Create a ZIP with layer PNGs and manifest.json."""
    buffer = io.BytesIO()
    manifest_layers = []
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for layer in document.get('layers', []):
            fname = layer.get('filename')
            path = _resolve_filepath(fname)
            if not path:
                continue
            arcname = f"layers/{layer.get('local_id', layer.get('id', 0))}_{fname}"
            zf.write(path, arcname)
            manifest_layers.append({
                'localId': layer.get('local_id', layer.get('id')),
                'name': layer.get('name'),
                'filename': fname,
                'x': layer.get('x', 0),
                'y': layer.get('y', 0),
                'scaleX': layer.get('scaleX', 1),
                'scaleY': layer.get('scaleY', 1),
                'angle': layer.get('angle', 0),
                'opacity': layer.get('opacity', 1),
                'visible': layer.get('visible', True),
                'parentLocalId': layer.get('parent_local_id'),
            })
        manifest = {
            'sessionName': session_name,
            'canvas': document.get('canvas', {}),
            'layers': manifest_layers,
        }
        zf.writestr('manifest.json', json.dumps(manifest, indent=2))
    return buffer.getvalue()


def export_session_psd(document, canvas_width, canvas_height):
    """Build a layered PSD using psd-tools (same transform pipeline as PNG)."""
    try:
        from psd_tools import PSDImage
        from psd_tools.api.layers import PixelLayer
    except ImportError:
        raise RuntimeError('psd-tools is not installed on the server')

    psd = PSDImage.new(mode='RGBA', size=(canvas_width, canvas_height))
    for layer in document.get('layers', []):
        if not layer.get('visible', True):
            continue
        img = _load_layer_image(layer.get('filename'))
        if img is None:
            continue

        if layer.get('flipX'):
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        if layer.get('flipY'):
            img = img.transpose(Image.FLIP_TOP_BOTTOM)

        sx = float(layer.get('scaleX', 1.0))
        sy = float(layer.get('scaleY', 1.0))
        new_w = max(1, int(img.width * abs(sx)))
        new_h = max(1, int(img.height * abs(sy)))
        img = img.resize((new_w, new_h), Image.LANCZOS)

        angle = float(layer.get('angle', 0))
        if angle != 0:
            img = img.rotate(-angle, expand=True, resample=Image.BICUBIC)

        opacity = float(layer.get('opacity', 1.0))
        if opacity < 1.0:
            r, g, b, a = img.split()
            a = a.point(lambda p: int(p * opacity))
            img = Image.merge('RGBA', (r, g, b, a))

        layer_canvas = Image.new('RGBA', (canvas_width, canvas_height), (0, 0, 0, 0))
        x = int(float(layer.get('x', 0)))
        y = int(float(layer.get('y', 0)))
        layer_canvas.paste(img, (x, y), img)
        pixel_layer = PixelLayer.frompil(
            layer_canvas,
            psd,
            layer_name=layer.get('name') or f"Layer {layer.get('local_id', 0)}",
            top=0,
            left=0,
            opacity=255,
        )
        psd.append(pixel_layer)

    buffer = io.BytesIO()
    psd.save(buffer)
    return buffer.getvalue()


def _vectorize_layer_to_svg(png_path):
    """Trace one PNG layer to SVG.

    Uses the vtracer Python bindings from requirements.txt, the same ones
    routes/vectorize.py traces with. This previously shelled out to a `vtracer`
    executable that is not shipped in backend/bin and is not installed by the pip
    package, so every layer raised, each one was skipped, and the export returned an
    empty SVG that the caller still charged for.
    """
    import vtracer

    with tempfile.TemporaryDirectory() as tmp:
        out_svg = os.path.join(tmp, 'out.svg')
        vtracer.convert_image_to_svg_py(
            image_path=png_path,
            out_path=out_svg,
            colormode="color",
            hierarchical="stacked",
            mode="spline",
            filter_speckle=4,
            color_precision=6,
            layer_difference=16,
            corner_threshold=60,
            length_threshold=4.0,
            max_iterations=10,
            splice_threshold=45,
            path_precision=3,
        )
        with open(out_svg, 'r', encoding='utf-8') as handle:
            return handle.read()


def export_session_svg(document, canvas_width, canvas_height):
    """Assemble layered SVG from vectorized layers."""
    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{canvas_width}" height="{canvas_height}" viewBox="0 0 {canvas_width} {canvas_height}">',
    ]
    traced = 0
    skipped = []
    for layer in document.get('layers', []):
        if not layer.get('visible', True):
            continue
        fname = layer.get('filename')
        path = _resolve_filepath(fname)
        if not path:
            continue
        try:
            layer_svg = _vectorize_layer_to_svg(path)
            inner = layer_svg
            if '<svg' in layer_svg:
                start = layer_svg.find('>', layer_svg.find('<svg')) + 1
                end = layer_svg.rfind('</svg>')
                inner = layer_svg[start:end] if end > start else layer_svg
            x = int(float(layer.get('x', 0)))
            y = int(float(layer.get('y', 0)))
            opacity = float(layer.get('opacity', 1.0))
            name = layer.get('name') or f"layer-{layer.get('local_id', 0)}"
            # Layer names are user input and /results/*.svg is served as image/svg+xml,
            # so an unescaped name here is both malformed XML and a script vector.
            svg_parts.append(
                f'<g id={quoteattr(name)} transform="translate({x},{y})" opacity="{opacity}">{inner}</g>'
            )
            traced += 1
        except Exception as exc:
            skipped.append(f"{fname}: {exc}")
            print(f"  [SVG Export] Skipping layer {fname}: {exc}")
    svg_parts.append('</svg>')
    if not traced:
        # The caller records the export charge only after this returns, so raising is
        # what stops the user paying for an empty file.
        detail = f" ({'; '.join(skipped[:3])})" if skipped else ''
        raise RuntimeError(f'SVG export traced no layers{detail}')
    return '\n'.join(svg_parts).encode('utf-8')


def save_export_bytes(data, prefix, ext):
    """Save export bytes to RESULTS_DIR and return filename + url."""
    result_name = f"{prefix}_{uuid.uuid4().hex[:8]}.{ext}"
    result_path = os.path.join(RESULTS_DIR, result_name)
    with open(result_path, 'wb') as f:
        f.write(data)
    storage.sync_to_s3(result_path)
    return result_name, f'/results/{result_name}'
