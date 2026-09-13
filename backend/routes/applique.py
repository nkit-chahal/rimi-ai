"""Appliqué patches and embellishment sheets. Deterministic renders that land in the Motif Library."""
import os
import uuid

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
from middleware import login_required, project_access_from_payload
from routes.motifs import create_motif_record
from security_utils import media_access_token
from services.applique_render import (
    EDGE_STYLES,
    EMBELLISHMENT_KINDS,
    LAYOUTS,
    render_applique,
    render_embellishment,
)
import storage

bp = Blueprint('applique', __name__)


def _resolve_path(filename):
    filename = os.path.basename(filename or '')
    if not filename:
        return None
    for folder in (UPLOAD_DIR, RESULTS_DIR):
        path = os.path.join(folder, filename)
        if os.path.exists(path):
            return path
    return None


def _owned_path(filename, user):
    from routes.upload import _user_can_access_file
    path = _resolve_path(filename)
    if not path:
        return None, 'File not found'
    if not _user_can_access_file(os.path.basename(filename), user['id'], user.get('role')):
        return None, 'You do not have access to this file'
    return path, None


def _save_result(canvas, prefix):
    name = f"{prefix}_{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(RESULTS_DIR, name)
    canvas.save(path, 'PNG')
    storage.sync_to_s3(path)
    return name


def _finish(canvas, prefix, user_id, project_id, tool_type, settings, input_filename, save_to_library, name, technique, tags):
    result_name = _save_result(canvas, prefix)
    log_export(
        project_id=project_id,
        filename=result_name,
        input_filename=input_filename,
        tool_type=tool_type,
        settings_dict=settings,
        user_id=user_id,
    )
    motif = None
    if save_to_library:
        motif = create_motif_record(
            user_id=user_id,
            project_id=project_id,
            name=name or prefix,
            technique=technique,
            tags=tags,
            filename=result_name,
            source_filename=input_filename,
            width=canvas.width,
            height=canvas.height,
        )
    return {
        'success': True,
        'resultUrl': f'/results/{result_name}',
        'filename': result_name,
        'fileAccessToken': media_access_token(result_name, user_id),
        'width': canvas.width,
        'height': canvas.height,
        'motif': motif,
    }


@bp.route('/api/applique/create', methods=['POST'])
@login_required
def create_applique():
    data = request.get_json(silent=True) or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user = g.current_user
    user_id = user['id']

    shape_filename = os.path.basename(str(data.get('shapeFilename') or ''))
    if not shape_filename:
        return jsonify({'success': False, 'error': 'shapeFilename is required'}), 400
    shape_path, error = _owned_path(shape_filename, user)
    if error:
        return jsonify({'success': False, 'error': f'Shape: {error}'}), 403 if 'access' in error else 404

    fill = data.get('fill') if isinstance(data.get('fill'), dict) else {'kind': 'solid', 'color': '#c8283c'}
    fill_img = None
    fill_filename = None
    if fill.get('kind') == 'image':
        fill_filename = os.path.basename(str(fill.get('filename') or ''))
        fill_path, error = _owned_path(fill_filename, user)
        if error:
            return jsonify({'success': False, 'error': f'Fill: {error}'}), 403 if 'access' in error else 404
        fill_img = Image.open(fill_path).convert('RGBA')

    edge = data.get('edge') if isinstance(data.get('edge'), dict) else {}
    if edge.get('style') and edge.get('style') not in EDGE_STYLES:
        return jsonify({'success': False, 'error': f"edge.style must be one of: {', '.join(EDGE_STYLES)}"}), 400

    required_credits = credit_requirement('appliqueCreate', 2)
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', 1)
    if not ok:
        return jsonify(err), 403

    try:
        with Image.open(shape_path) as shape_img:
            canvas = render_applique(shape_img, fill, edge, bool(data.get('shadow')), fill_img=fill_img)
        payload = _finish(
            canvas, 'applique', user_id, project_id, 'Appliqué',
            {'fill': fill.get('kind'), 'edge': edge.get('style', 'satin'), 'shadow': bool(data.get('shadow')), 'fillFilename': fill_filename},
            shape_filename, bool(data.get('saveToLibrary')), str(data.get('name') or 'Appliqué patch')[:80],
            'applique', data.get('tags') or ['applique'],
        )
        payload['creditsUsed'] = required_credits
        payload.update(get_updated_credits(user_id))
        return jsonify(payload)
    except ValueError as exc:
        refund_credits(user_id, project_id, required_credits, note='Appliqué failed')
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        refund_credits(user_id, project_id, required_credits, note='Appliqué failed')
        print(f"  [Appliqué] Error: {exc}")
        return jsonify({'success': False, 'error': f'Appliqué failed: {exc}'}), 500


@bp.route('/api/embellish/generate', methods=['POST'])
@login_required
def generate_embellishment():
    data = request.get_json(silent=True) or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']

    kind = str(data.get('kind') or 'sequin')
    layout = str(data.get('layout') or 'scatter')
    if kind not in EMBELLISHMENT_KINDS:
        return jsonify({'success': False, 'error': f"kind must be one of: {', '.join(EMBELLISHMENT_KINDS)}"}), 400
    if layout not in LAYOUTS:
        return jsonify({'success': False, 'error': f"layout must be one of: {', '.join(LAYOUTS)}"}), 400
    colors = data.get('colors') if isinstance(data.get('colors'), list) else None

    required_credits = credit_requirement('embellishGenerate', 1)
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', 1)
    if not ok:
        return jsonify(err), 403

    try:
        canvas = render_embellishment(
            kind=kind,
            layout=layout,
            count=int(data.get('count', 40) or 40),
            size=int(data.get('size', 24) or 24),
            colors=[str(c) for c in colors][:6] if colors else None,
            width=int(data.get('width', 800) or 800),
            height=int(data.get('height', 400) or 400),
            seed=int(data.get('seed', 7) or 7),
        )
        default_name = {'sequin': 'Sequin sheet', 'bead': 'Bead cluster', 'mirror': 'Mirror work'}[kind]
        payload = _finish(
            canvas, 'embellish', user_id, project_id, 'Embellishment',
            {'kind': kind, 'layout': layout, 'count': data.get('count'), 'size': data.get('size')},
            None, bool(data.get('saveToLibrary')), str(data.get('name') or default_name)[:80],
            'embellishment', data.get('tags') or [kind, layout],
        )
        payload['creditsUsed'] = required_credits
        payload.update(get_updated_credits(user_id))
        return jsonify(payload)
    except (TypeError, ValueError) as exc:
        refund_credits(user_id, project_id, required_credits, note='Embellishment failed')
        return jsonify({'success': False, 'error': f'Invalid settings: {exc}'}), 400
    except Exception as exc:
        refund_credits(user_id, project_id, required_credits, note='Embellishment failed')
        print(f"  [Embellish] Error: {exc}")
        return jsonify({'success': False, 'error': f'Embellishment failed: {exc}'}), 500
