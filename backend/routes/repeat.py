"""Repeat set route: create tiled repeat patterns from images."""
import math
import os
import uuid
from io import BytesIO
from flask import Blueprint, request, jsonify, g
from middleware import login_required, project_access_from_payload
from PIL import Image, ImageOps

from config import UPLOAD_DIR, RESULTS_DIR
from auth import credit_requirement, get_updated_credits, log_export, refund_credits, reserve_credits_or_error
from security_utils import safe_fetch_url, media_access_token
import storage

bp = Blueprint('repeat', __name__)


def _load_source_image(filename, image_url):
    if image_url and image_url.startswith('http'):
        content = safe_fetch_url(image_url, timeout=30)
        return Image.open(BytesIO(content))
    if filename:
        filepath = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(filepath):
            filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.exists(filepath):
            return None
        return Image.open(filepath)
    return None


def _build_tile_image(img, tile_px_w, tile_px_h, scale, rotation):
    """Fit source art onto one print tile at the requested pixel size."""
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    scale_factor = max(0.1, min(2.0, float(scale) / 100.0))
    target_w = max(1, int(round(tile_px_w * scale_factor)))
    target_h = max(1, int(round(tile_px_h * scale_factor)))
    resized = img.resize((target_w, target_h), Image.Resampling.LANCZOS)

    if rotation:
        resized = resized.rotate(int(rotation) % 360, expand=True, resample=Image.Resampling.BICUBIC)

    tile = Image.new('RGBA', (tile_px_w, tile_px_h), (251, 250, 247, 255))
    paste_x = (tile_px_w - resized.width) // 2
    paste_y = (tile_px_h - resized.height) // 2
    tile.paste(resized, (paste_x, paste_y), resized)
    return tile.convert('RGB')


def _paste_repeat(tile, tiled, repeat_type, col, row, tile_px_w, tile_px_h):
    if repeat_type == 'half_brick':
        offset = (tile_px_w // 2) if abs(row) % 2 else 0
        tiled.paste(tile, (col * tile_px_w + offset, row * tile_px_h))
    elif repeat_type == 'half_drop':
        offset = (tile_px_h // 2) if abs(col) % 2 else 0
        tiled.paste(tile, (col * tile_px_w, row * tile_px_h + offset))
    elif repeat_type == 'mirror':
        mirrored = tile
        if abs(col) % 2:
            mirrored = ImageOps.mirror(mirrored)
        if abs(row) % 2:
            mirrored = ImageOps.flip(mirrored)
        tiled.paste(mirrored, (col * tile_px_w, row * tile_px_h))
    else:
        tiled.paste(tile, (col * tile_px_w, row * tile_px_h))


@bp.route('/api/create-repeat-set', methods=['POST'])
@login_required
def create_repeat_set():
    data = request.get_json() or {}
    filename = os.path.basename(data.get('filename', '') or '')
    image_url = data.get('imageUrl', '')
    repeat_width = float(data.get('repeatWidth') or data.get('printWidth') or 12)
    repeat_height = float(data.get('repeatHeight') or data.get('printHeight') or repeat_width)
    fabric_width = float(data.get('fabricWidth') or 54)
    scale = float(data.get('scale', 100))
    repeat_type = data.get('repeatType', 'block')
    rotation = int(data.get('rotation', 0))
    dpi = int(data.get('dpi', 300))
    out_format = (data.get('format') or 'PNG').upper()
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']

    def _export_grid(fw, tw):
        """Full tiles that fit across fabric — never ceil past fabric width."""
        tw = max(float(tw), 0.5)
        fw = float(fw)
        if tw > fw:
            return 2
        full = math.floor(fw / tw)
        if full >= 2:
            return min(8, full)
        return max(1, full)

    grid_size = data.get('gridSize')
    if grid_size is None:
        grid_size = _export_grid(fabric_width, repeat_width)
    grid_size = max(1, min(8, int(grid_size)))

    required_credits = credit_requirement('repeat', 5)
    credits_reserved = False

    try:
        img = _load_source_image(filename, image_url)
        if img is None:
            return jsonify({'error': 'Provide either filename or imageUrl'}), 400

        ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'export', 1)
        if not ok:
            return jsonify(err), 403
        credits_reserved = True

        tile_px_w = max(1, int(round(repeat_width * dpi)))
        tile_px_h = max(1, int(round(repeat_height * dpi)))
        tile = _build_tile_image(img, tile_px_w, tile_px_h, scale, rotation)

        tiled = Image.new('RGB', (tile_px_w * grid_size, tile_px_h * grid_size), color='#fbfaf7')
        expand = 2
        for row in range(-expand, grid_size + expand):
            for col in range(-expand, grid_size + expand):
                _paste_repeat(tile, tiled, repeat_type, col, row, tile_px_w, tile_px_h)

        if out_format in ('JPG', 'JPEG'):
            ext, save_format = 'jpg', 'JPEG'
        elif out_format == 'TIFF':
            ext, save_format = 'tiff', 'TIFF'
        else:
            ext, save_format = 'png', 'PNG'

        result_name = (
            f"repeat_{int(repeat_width)}x{int(repeat_height)}in_"
            f"{grid_size}x{grid_size}_{dpi}dpi_{uuid.uuid4().hex[:8]}.{ext}"
        )
        result_path = os.path.join(RESULTS_DIR, result_name)
        save_kwargs = {'format': save_format, 'dpi': (dpi, dpi)}
        if save_format == 'JPEG':
            save_kwargs['quality'] = 95
        tiled.save(result_path, **save_kwargs)
        storage.sync_to_s3(result_path)
        updated_credits = get_updated_credits(user_id)
        input_fn = filename if filename else (image_url.split('/')[-1] if image_url else None)
        log_export(
            project_id,
            result_name,
            input_fn,
            "Repeat Set",
            {
                "gridSize": grid_size,
                "scale": scale,
                "repeatType": repeat_type,
                "rotation": rotation,
                "dpi": dpi,
                "format": save_format,
                "repeatWidth": repeat_width,
                "repeatHeight": repeat_height,
                "fabricWidth": fabric_width,
                "tilePixels": f"{tile_px_w}x{tile_px_h}",
            },
            user_id=user_id,
        )
        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            'fileAccessToken': media_access_token(result_name, user_id),
            'gridSize': grid_size,
            'dimensions': f'{tiled.size[0]}x{tiled.size[1]}',
            'tileDimensions': f'{tile_px_w}x{tile_px_h}',
            'dpi': dpi,
            'format': save_format,
            'repeatWidth': repeat_width,
            'repeatHeight': repeat_height,
            **updated_credits,
        })
    except Exception as e:
        if credits_reserved:
            refund_credits(user_id, project_id, required_credits, note='Repeat set failed')
        print(f"  [Repeat Set] Error: {e}")
        return jsonify({'error': str(e)}), 500
