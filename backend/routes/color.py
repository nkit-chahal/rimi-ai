"""Color manipulation routes: palette extraction, recolor, pantone matching, color reduction, layer export, tech pack."""
import os
import uuid
import json
import time
from flask import Blueprint, request, jsonify, g
from middleware import login_required, project_access_from_payload
from datetime import datetime, timezone

from config import UPLOAD_DIR, RESULTS_DIR
from db import db
from auth import (
    check_credits, credit_error_payload, credit_requirement,
    record_activity, get_updated_credits, log_export,
)
from color_utils import extract_palette, recolor_image
from pantone_utils import match_to_pantone, quantize_and_save
from layer_utils import export_zip, export_tiff
from techpack_utils import generate_tech_pack
import storage

bp = Blueprint('color', __name__)


def require_credits(user_id=None, tool_key='colorReduction', default=3):
    user_id = user_id or g.current_user['id']
    required_credits = credit_requirement(tool_key, default)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return user_id, required_credits, jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403
    return user_id, required_credits, None, None


@bp.route('/api/extract-palette', methods=['POST'])
@login_required
def extract_palette_api():
    data = request.get_json(silent=True) or {}
    filename = data.get('filename', '')
    try:
        num_colors = int(data.get('numColors', 5))
    except (TypeError, ValueError):
        num_colors = 5
    num_colors = max(1, min(num_colors, 24))
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    filename = os.path.basename(filename)
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
    try:
        palette = extract_palette(filepath, num_colors)
        return jsonify({'success': True, 'palette': palette})
    except Exception as e:
        print(f"  [Extract Palette] Error: {e}")
        return jsonify({'error': f'Failed to extract palette: {str(e)}'}), 500


@bp.route('/api/recolor', methods=['POST'])
@login_required
def recolor_api():
    data = request.get_json()
    filename = data.get('filename', '')
    color_mapping = data.get('colorMapping', [])
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    filename = os.path.basename(filename)
    user_id, required_credits, error_response, status_code = require_credits(None, 'recolor', 3)
    if error_response:
        return error_response, status_code
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
    try:
        start_time = time.time()
        local_uuid = uuid.uuid4().hex
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'png'
        local_filename = f"recolor_{local_uuid}.{ext}"
        local_filepath = os.path.join(RESULTS_DIR, local_filename)
        recolor_image(filepath, color_mapping, local_filepath)
        storage.sync_to_s3(local_filepath)
        duration = time.time() - start_time
        credits_used = required_credits
        local_url = f"/results/{local_filename}"
        conn = db()
        created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn.execute(
            "INSERT INTO exports (user_id, project_id, filename, input_filename, tool_type, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, project_id, local_filename, filename, "Colorways", json.dumps({"mapping": color_mapping}), created_at)
        )
        conn.commit()
        conn.close()
        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)
        updated_credits = get_updated_credits(user_id)
        return jsonify({'success': True, 'resultUrl': local_url, **updated_credits})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/tech-pack', methods=['POST'])
@login_required
def generate_tech_pack_api():
    data = request.get_json()
    filename = data.get('filename', '')
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    filename = os.path.basename(filename)
    user_id, required_credits, error_response, status_code = require_credits(None, 'techPack', 2)
    if error_response:
        return error_response, status_code
    filepath = os.path.join(RESULTS_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
    conn = db()
    project_row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    controls_row = conn.execute("SELECT * FROM project_controls WHERE project_id = ?", (project_id,)).fetchone()
    conn.close()
    if not project_row:
        return jsonify({'error': 'Project not found'}), 404
    project_metadata = dict(project_row)
    project_metadata['controls'] = dict(controls_row) if controls_row else {}
    tech_pack_options = {}
    for js_key, py_key in [('fabricType','fabric_type'),('gsm','gsm'),('fiberContent','fiber_content'),('printMethod','print_method'),('season','season'),('companyName','company_name'),('description','description'),('shrinkage','shrinkage')]:
        if data.get(js_key):
            tech_pack_options[py_key] = data[js_key]
    local_uuid = uuid.uuid4().hex
    pdf_filename = f"techpack_{local_uuid}.pdf"
    pdf_filepath = os.path.join(RESULTS_DIR, pdf_filename)
    try:
        generate_tech_pack(filepath, project_metadata, pdf_filepath, options=tech_pack_options)
        storage.sync_to_s3(pdf_filepath)
    except Exception as e:
        print(f"Failed to generate PDF: {e}")
        return jsonify({'error': 'Failed to generate Tech Pack PDF'}), 500
    conn = db()
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conn.execute(
        "INSERT INTO exports (user_id, project_id, filename, input_filename, tool_type, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, project_id, pdf_filename, filename, "Tech Pack", json.dumps(tech_pack_options), created_at)
    )
    conn.commit()
    conn.close()
    record_activity(project_id, 'export', 1, required_credits, user_id=user_id)
    updated_credits = get_updated_credits(user_id)
    return jsonify({'success': True, 'resultUrl': f"/results/{pdf_filename}", **updated_credits})


@bp.route('/api/pantone-match', methods=['POST'])
@login_required
def pantone_match_api():
    data = request.get_json()
    hex_color = data.get('hex', '').strip()
    if not hex_color:
        return jsonify({'error': 'hex is required'}), 400
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        return jsonify({'error': 'Invalid hex color'}), 400
    try:
        r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    except ValueError:
        return jsonify({'error': 'Invalid hex color'}), 400
    matches = match_to_pantone((r, g, b), top_n=5)
    return jsonify({'success': True, 'matches': matches})


@bp.route('/api/color-reduce', methods=['POST'])
@login_required
def color_reduce_api():
    data = request.get_json()
    filename = data.get('filename', '')
    n_colors = max(2, min(int(data.get('numColors', 6)), 16))
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    brand_palette_id = data.get('brandPaletteId')
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    filename = os.path.basename(filename)
    user_id, required_credits, error_response, status_code = require_credits(None, 'colorReduction', 3)
    if error_response:
        return error_response, status_code
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
    try:
        start_time = time.time()
        local_uuid = uuid.uuid4().hex
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'png'
        local_filename = f"quantized_{local_uuid}.{ext}"
        local_filepath = os.path.join(RESULTS_DIR, local_filename)
        brand_palette = None
        if brand_palette_id:
            conn = db()
            try:
                row = conn.execute("SELECT colors_json FROM brand_palettes WHERE id = ?", (brand_palette_id,)).fetchone()
                if row:
                    brand_palette = json.loads(row['colors_json'])
            finally:
                conn.close()
        palette = quantize_and_save(filepath, n_colors, local_filepath, brand_palette)
        storage.sync_to_s3(local_filepath)
        credits_used = required_credits
        local_url = f"/results/{local_filename}"
        conn = db()
        created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn.execute(
            "INSERT INTO exports (user_id, project_id, filename, input_filename, tool_type, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, project_id, local_filename, filename, "Color Reduce", json.dumps({"numColors": n_colors}), created_at)
        )
        conn.commit()
        conn.close()
        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)
        updated_credits = get_updated_credits(user_id)
        return jsonify({'success': True, 'resultUrl': local_url, 'palette': palette, **updated_credits})
    except Exception as e:
        print(f"  [Color Reduce] Error: {e}")
        return jsonify({'error': str(e)}), 500


@bp.route('/api/layer-export', methods=['POST'])
@login_required
def layer_export_api():
    data = request.get_json()
    filename = data.get('filename', '')
    n_colors = max(2, min(int(data.get('numColors', 6)), 16))
    export_format = data.get('format', 'zip').lower()
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    filename = os.path.basename(filename)
    if export_format not in ('zip', 'tiff'):
        return jsonify({'error': 'Format must be zip or tiff'}), 400
    user_id, required_credits, error_response, status_code = require_credits(None, 'layerExport', 2)
    if error_response:
        return error_response, status_code
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
    try:
        local_uuid = uuid.uuid4().hex
        if export_format == 'zip':
            out_filename = f"layers_{local_uuid}.zip"
            out_filepath = os.path.join(RESULTS_DIR, out_filename)
            palette = export_zip(filepath, n_colors, out_filepath)
        else:
            out_filename = f"layers_{local_uuid}.tiff"
            out_filepath = os.path.join(RESULTS_DIR, out_filename)
            palette = export_tiff(filepath, n_colors, out_filepath)
        storage.sync_to_s3(out_filepath)
        local_url = f"/results/{out_filename}"
        conn = db()
        created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn.execute(
            "INSERT INTO exports (user_id, project_id, filename, input_filename, tool_type, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, project_id, out_filename, filename, f"Layer Export ({export_format.upper()})", json.dumps({"numColors": n_colors, "format": export_format}), created_at)
        )
        conn.commit()
        conn.close()
        credits_used = required_credits
        record_activity(project_id, 'export', 1, credits_used, user_id=user_id)
        updated_credits = get_updated_credits(user_id)
        return jsonify({'success': True, 'resultUrl': local_url, 'palette': palette, **updated_credits})
    except Exception as e:
        print(f"  [Layer Export] Error: {e}")
        return jsonify({'error': str(e)}), 500
