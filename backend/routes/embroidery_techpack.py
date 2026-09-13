"""Embroidery tech pack endpoint: turns a placement, its thread palette and stitch choices into a PDF."""
import math
import os
import uuid

import numpy as np
from flask import Blueprint, g, jsonify, request
from PIL import Image

from auth import (
    credit_requirement,
    get_updated_credits,
    log_export,
    refund_credits,
    reserve_credits_or_error,
)
from config import RESULTS_DIR, UPLOAD_DIR
from db import db, db_lock
from middleware import login_required, project_access_from_payload
from security_utils import media_access_token
from services.embroidery_techpack import build_embroidery_tech_pack, estimate_stitches
from services.stitch_render import DENSITIES, STITCH_STYLES
import storage

bp = Blueprint('embroidery_techpack', __name__)

MAX_LAYERS = 40
MAX_THREADS = 60


def _resolve_path(filename):
    filename = os.path.basename(filename or '')
    if not filename:
        return None
    for folder in (UPLOAD_DIR, RESULTS_DIR):
        path = os.path.join(folder, filename)
        if os.path.exists(path):
            return path
    return None


def _coverage(path):
    """Share of a motif's bounding box that is opaque (0..1)."""
    try:
        with Image.open(path) as img:
            alpha = np.array(img.convert('RGBA').split()[3])
        return float((alpha > 24).mean())
    except Exception:
        return 0.6


def _num(value, default=0.0):
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def summarize_layers(layers, doc_width_px, physical_width_cm, resolve_path=_resolve_path):
    """Convert placement layers (document px, centre origin) to centimetres with stitch estimates."""
    px_per_cm = doc_width_px / physical_width_cm if physical_width_cm > 0 else 0
    summary = []
    for layer in layers[:MAX_LAYERS]:
        if not isinstance(layer, dict):
            continue
        scale_x = abs(_num(layer.get('scaleX'), 1.0)) or 1.0
        scale_y = abs(_num(layer.get('scaleY'), 1.0)) or 1.0
        width_px = _num(layer.get('width'), 0) * scale_x
        height_px = _num(layer.get('height'), 0) * scale_y
        angle = _num(layer.get('angle'), 0) % 360
        rad = math.radians(angle)
        footprint_w = abs(width_px * math.cos(rad)) + abs(height_px * math.sin(rad))
        footprint_h = abs(width_px * math.sin(rad)) + abs(height_px * math.cos(rad))
        path = resolve_path(layer.get('filename')) if layer.get('filename') else None
        coverage = _coverage(path) if path else 0.6
        style = layer.get('stitchStyle') if layer.get('stitchStyle') in STITCH_STYLES else 'satin'
        density = layer.get('density') if layer.get('density') in DENSITIES else 'medium'
        area_cm2 = (width_px * height_px * coverage) / (px_per_cm ** 2) if px_per_cm else 0
        summary.append({
            'name': str(layer.get('name') or 'Motif')[:80],
            'filename': os.path.basename(str(layer.get('filename') or '')),
            'x_cm': _num(layer.get('x')) / px_per_cm if px_per_cm else 0,
            'y_cm': _num(layer.get('y')) / px_per_cm if px_per_cm else 0,
            'w_cm': footprint_w / px_per_cm if px_per_cm else 0,
            'h_cm': footprint_h / px_per_cm if px_per_cm else 0,
            'angle': angle,
            'coverage': coverage,
            'stitch_style': style,
            'density': density,
            'area_cm2': area_cm2,
            'stitches': estimate_stitches(area_cm2, style, density),
        })
    return summary, px_per_cm


@bp.route('/api/techpack/embroidery', methods=['POST'])
@login_required
def embroidery_tech_pack():
    data = request.get_json(silent=True) or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user = g.current_user
    user_id = user['id']

    design_filename = os.path.basename(str(data.get('designFilename') or ''))
    design_path = None
    if design_filename:
        from routes.upload import _user_can_access_file
        design_path = _resolve_path(design_filename)
        if not design_path:
            return jsonify({'success': False, 'error': 'Design file not found'}), 404
        if not _user_can_access_file(design_filename, user_id, user.get('role')):
            return jsonify({'success': False, 'error': 'You do not have access to the design file'}), 403

    doc_width_px = int(_num(data.get('docWidthPx'), 0)) or None
    doc_height_px = int(_num(data.get('docHeightPx'), 0)) or None
    if design_path and (not doc_width_px or not doc_height_px):
        with Image.open(design_path) as img:
            doc_width_px, doc_height_px = img.size
    doc_width_px = doc_width_px or 2000
    doc_height_px = doc_height_px or 2000
    physical_width_cm = _num(data.get('physicalWidthCm'), 30.0)
    if not (1 <= physical_width_cm <= 500):
        return jsonify({'success': False, 'error': 'physicalWidthCm must be between 1 and 500'}), 400

    layers = data.get('layers') if isinstance(data.get('layers'), list) else []
    if len(layers) > MAX_LAYERS:
        return jsonify({'success': False, 'error': f'At most {MAX_LAYERS} layers'}), 400
    threads = [t for t in (data.get('threads') or []) if isinstance(t, dict)][:MAX_THREADS] if isinstance(data.get('threads'), list) else []

    with db_lock:
        conn = db()
        try:
            project_row = conn.execute("SELECT name FROM projects WHERE id = ?", (project_id,)).fetchone()
        finally:
            conn.close()

    required_credits = credit_requirement('embroideryTechPack', 3)
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'export', 1)
    if not ok:
        return jsonify(err), 403

    try:
        layer_summary, px_per_cm = summarize_layers(layers, doc_width_px, physical_width_cm)
        spec = {
            'title': str(data.get('title') or 'Embroidery tech pack')[:80],
            'project_name': project_row['name'] if project_row else 'Project',
            'company': str(data.get('company') or '')[:80],
            'design_path': design_path,
            'doc_width_px': doc_width_px,
            'doc_height_px': doc_height_px,
            'physical_width_cm': physical_width_cm,
            'px_per_cm': px_per_cm,
            'product': str(data.get('product') or '')[:60],
            'zone': str(data.get('zone') or '')[:60],
            'technique': str(data.get('technique') or '')[:60],
            'fabric': str(data.get('fabric') or '')[:60],
            'base': str(data.get('base') or '')[:60],
            'thread_card': str(data.get('threadCard') or '')[:80],
            'layers': layer_summary,
            'threads': threads,
            'notes': str(data.get('notes') or '')[:2000],
        }
        pdf_name = f"embtechpack_{uuid.uuid4().hex[:8]}.pdf"
        pdf_path = os.path.join(RESULTS_DIR, pdf_name)
        build_embroidery_tech_pack(pdf_path, spec)
        storage.sync_to_s3(pdf_path)
        log_export(
            project_id=project_id,
            filename=pdf_name,
            input_filename=design_filename or None,
            tool_type='Embroidery Tech Pack',
            settings_dict={'layers': len(layer_summary), 'threads': len(threads), 'physicalWidthCm': physical_width_cm, 'product': spec['product'], 'zone': spec['zone']},
            user_id=user_id,
        )
        return jsonify({
            'success': True,
            'resultUrl': f'/results/{pdf_name}',
            'filename': pdf_name,
            'fileAccessToken': media_access_token(pdf_name, user_id),
            'summary': {
                'pxPerCm': px_per_cm,
                'physicalWidthCm': physical_width_cm,
                'physicalHeightCm': (doc_height_px / px_per_cm) if px_per_cm else None,
                'totalStitches': sum(item['stitches'] for item in layer_summary),
                'layers': layer_summary,
            },
            'creditsUsed': required_credits,
            **get_updated_credits(user_id),
        })
    except Exception as exc:
        refund_credits(user_id, project_id, required_credits, note='Embroidery tech pack failed')
        print(f"  [EmbTechPack] Error: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': f'Tech pack failed: {exc}'}), 500
