"""Repeat set route: create tiled repeat patterns from images."""
import os
import uuid
import requests as http_requests
from io import BytesIO
from flask import Blueprint, request, jsonify
from PIL import Image, ImageOps

from config import UPLOAD_DIR, RESULTS_DIR
from auth import check_credits, credit_error_payload, credit_requirement, get_updated_credits, record_activity, log_export
import storage

bp = Blueprint('repeat', __name__)


@bp.route('/api/create-repeat-set', methods=['POST'])
def create_repeat_set():
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    image_url = data.get('imageUrl', '')
    grid_size = max(2, min(int(data.get('gridSize', 3)), 6))
    scale = float(data.get('scale', 100)) / 100.0
    repeat_type = data.get('repeatType', 'block')
    dpi = int(data.get('dpi', 300))
    out_format = data.get('format', 'PNG').upper()
    project_id = int(data.get('projectId', 1))
    user_id = data.get('userId') or data.get('user_id')
    if user_id:
        try:
            user_id = int(user_id)
        except ValueError:
            user_id = None
    required_credits = credit_requirement('repeat', 10)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403
    try:
        if image_url and image_url.startswith('http'):
            resp = http_requests.get(image_url, timeout=30)
            img = Image.open(BytesIO(resp.content))
        elif filename:
            filepath = os.path.join(UPLOAD_DIR, filename)
            if not os.path.exists(filepath):
                filepath = os.path.join(RESULTS_DIR, filename)
            if not os.path.exists(filepath):
                return jsonify({'error': 'File not found'}), 404
            img = Image.open(filepath)
        else:
            return jsonify({'error': 'Provide either filename or imageUrl'}), 400
        if img.mode != 'RGB':
            img = img.convert('RGB')
        width, height = img.size
        if scale != 1.0:
            draw_w, draw_h = int(width * scale), int(height * scale)
            img = img.resize((draw_w, draw_h), Image.Resampling.LANCZOS)
            width, height = img.size
        tiled = Image.new('RGB', (width * grid_size, height * grid_size), color='#fbfaf7')
        expand = 2
        for row in range(-expand, grid_size + expand):
            for col in range(-expand, grid_size + expand):
                if repeat_type == 'half_brick':
                    offset = (width // 2) if abs(row) % 2 else 0
                    tiled.paste(img, (col * width + offset, row * height))
                elif repeat_type == 'half_drop':
                    offset = (height // 2) if abs(col) % 2 else 0
                    tiled.paste(img, (col * width, row * height + offset))
                elif repeat_type == 'mirror':
                    flip_x = abs(col) % 2
                    flip_y = abs(row) % 2
                    mirrored = img
                    if flip_x: mirrored = ImageOps.mirror(mirrored)
                    if flip_y: mirrored = ImageOps.flip(mirrored)
                    tiled.paste(mirrored, (col * width, row * height))
                else:
                    tiled.paste(img, (col * width, row * height))
        if out_format in ('JPG', 'JPEG'): ext, save_format = 'jpg', 'JPEG'
        elif out_format == 'TIFF': ext, save_format = 'tiff', 'TIFF'
        else: ext, save_format = 'png', 'PNG'
        result_name = f"repeat_{grid_size}x{grid_size}_{uuid.uuid4().hex[:8]}.{ext}"
        result_path = os.path.join(RESULTS_DIR, result_name)
        tiled.save(result_path, save_format, quality=95, dpi=(dpi, dpi))
        storage.sync_to_s3(result_path)
        record_activity(project_id, 'export', 1, required_credits, user_id=user_id)
        updated_credits = get_updated_credits(user_id)
        input_fn = filename if filename else (image_url.split('/')[-1] if image_url else None)
        log_export(project_id, result_name, input_fn, "Repeat Set",
                   {"gridSize": grid_size, "scale": scale, "repeatType": repeat_type, "dpi": dpi, "format": save_format})
        return jsonify({'success': True, 'resultUrl': f'/results/{result_name}',
                        'gridSize': grid_size, 'dimensions': f'{tiled.size[0]}x{tiled.size[1]}', 'dpi': dpi, 'format': save_format,
                        **updated_credits})
    except Exception as e:
        print(f"  [Repeat Set] Error: {e}")
        return jsonify({'error': str(e)}), 500
