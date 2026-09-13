"""Placement Studio: flatten a placement document (base fabric + motif layers) to a PNG."""
import os
import uuid

from flask import Blueprint, g, jsonify, request
from middleware import login_required, project_access_from_payload

from auth import (
    credit_requirement,
    get_updated_credits,
    log_export,
    refund_credits,
    reserve_credits_or_error,
)
from config import RESULTS_DIR, UPLOAD_DIR
from security_utils import media_access_token
from services.placement_render import MAX_LAYERS, MAX_SIZE, MIN_SIZE, render_document
import storage

bp = Blueprint('placement', __name__)


def _resolve_path(filename):
    filename = os.path.basename(filename or '')
    if not filename:
        return None
    for folder in (UPLOAD_DIR, RESULTS_DIR):
        path = os.path.join(folder, filename)
        if os.path.exists(path):
            return path
    return None


def _validate_document(document, user):
    """Return (clean_document, error_message)."""
    from routes.upload import _user_can_access_file

    if not isinstance(document, dict):
        return None, 'document is required'
    try:
        width = int(round(float(document.get('width'))))
        height = int(round(float(document.get('height'))))
    except (TypeError, ValueError):
        return None, 'document width and height are required'
    if not (MIN_SIZE <= width <= MAX_SIZE and MIN_SIZE <= height <= MAX_SIZE):
        return None, f'document size must be between {MIN_SIZE} and {MAX_SIZE} pixels'

    base = document.get('base') or {}
    if not isinstance(base, dict):
        return None, 'base must be an object'
    clean_base = {'kind': base.get('kind') if base.get('kind') in ('image', 'solid', 'swatch') else 'solid', 'color': base.get('color')}
    if clean_base['kind'] == 'image':
        base_file = os.path.basename(str(base.get('filename') or ''))
        if not base_file or not _resolve_path(base_file):
            return None, 'base image not found'
        if not _user_can_access_file(base_file, user['id'], user.get('role')):
            return None, 'You do not have access to the base image'
        clean_base['filename'] = base_file

    layers = document.get('layers') or []
    if not isinstance(layers, list):
        return None, 'layers must be a list'
    if len(layers) > MAX_LAYERS:
        return None, f'At most {MAX_LAYERS} layers can be flattened'

    clean_layers = []
    for index, layer in enumerate(layers):
        if not isinstance(layer, dict):
            return None, f'Layer {index + 1} must be an object'
        filename = os.path.basename(str(layer.get('filename') or ''))
        if not filename or not _resolve_path(filename):
            return None, f'Layer {index + 1}: file not found'
        if not _user_can_access_file(filename, user['id'], user.get('role')):
            return None, f'Layer {index + 1}: you do not have access to this file'
        try:
            clean_layers.append({
                'filename': filename,
                'x': float(layer.get('x', width / 2)),
                'y': float(layer.get('y', height / 2)),
                'scaleX': float(layer.get('scaleX', 1) or 1),
                'scaleY': float(layer.get('scaleY', 1) or 1),
                'angle': float(layer.get('angle', 0) or 0),
                'flipX': bool(layer.get('flipX')),
                'flipY': bool(layer.get('flipY')),
                'opacity': float(layer.get('opacity', 1) if layer.get('opacity') is not None else 1),
                'visible': layer.get('visible') is not False,
            })
        except (TypeError, ValueError):
            return None, f'Layer {index + 1}: invalid transform values'

    return {'width': width, 'height': height, 'base': clean_base, 'layers': clean_layers}, None


@bp.route('/api/placement/compose', methods=['POST'])
@login_required
def compose_placement():
    data = request.get_json(silent=True) or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user = g.current_user
    user_id = user['id']

    document, error = _validate_document(data.get('document'), user)
    if error:
        return jsonify({'success': False, 'error': error}), 400
    if not document['layers']:
        return jsonify({'success': False, 'error': 'Add at least one motif before flattening'}), 400

    required_credits = credit_requirement('placementCompose', 5)
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'export', 1)
    if not ok:
        return jsonify(err), 403

    try:
        canvas, rendered = render_document(document, _resolve_path)
        result_name = f"placement_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        canvas.save(result_path, 'PNG')
        storage.sync_to_s3(result_path)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=document['base'].get('filename'),
            tool_type='Placement Studio',
            settings_dict={
                'width': document['width'],
                'height': document['height'],
                'base': document['base'].get('kind'),
                'layers': rendered,
            },
            user_id=user_id,
        )
        updated_credits = get_updated_credits(user_id)
        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            'filename': result_name,
            'fileAccessToken': media_access_token(result_name, user_id),
            'width': document['width'],
            'height': document['height'],
            'layersRendered': rendered,
            'creditsUsed': required_credits,
            **updated_credits,
        })
    except Exception as exc:
        refund_credits(user_id, project_id, required_credits, note='Placement flatten failed')
        print(f"  [Placement] Error: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': f'Flatten failed: {exc}'}), 500
