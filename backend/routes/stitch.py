"""Stitch Styles routes: catalogue and the AI render pass."""
import os
import uuid

from flask import Blueprint, g, jsonify, request
from PIL import Image

from auth import (
    adjust_reserved_credits,
    credit_requirement,
    get_updated_credits,
    log_export,
    log_replicate_call,
    refund_credits,
    reserve_credits_or_error,
)
from config import RESULTS_DIR, UPLOAD_DIR
from middleware import login_required, project_access_from_payload
from plan_tiers import current_user_plan, require_pro_or_error
from rate_limits import generation_rate_limit
from routes.motifs import create_motif_record
from security_utils import media_access_token
from services import stitch_render
import storage

bp = Blueprint('stitch', __name__)

MODES = ('motif', 'design')


def _resolve_path(filename):
    filename = os.path.basename(filename or '')
    if not filename:
        return None
    for folder in (UPLOAD_DIR, RESULTS_DIR):
        path = os.path.join(folder, filename)
        if os.path.exists(path):
            return path
    return None


@bp.route('/api/stitch/styles', methods=['GET'])
@login_required
def stitch_styles():
    return jsonify({
        'success': True,
        'styles': stitch_render.style_catalogue(),
        'finishes': list(stitch_render.FINISHES),
        'densities': list(stitch_render.DENSITIES),
        'directions': list(stitch_render.DIRECTIONS),
    })


@bp.route('/api/stitch/render', methods=['POST'])
@login_required
@generation_rate_limit
def stitch_render_route():
    ok_pro, pro_body, pro_code = require_pro_or_error(current_user_plan(), 'Stitch Styles')
    if not ok_pro:
        return pro_body, pro_code

    data = request.get_json(silent=True) or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user = g.current_user
    user_id = user['id']

    source_filename = os.path.basename(str(data.get('sourceFilename') or ''))
    mode = str(data.get('mode') or 'motif')
    style = str(data.get('style') or 'satin')
    finish = str(data.get('finish') or 'rayon')
    density = str(data.get('density') or 'medium')
    direction = str(data.get('direction') or 'follow')

    if not source_filename:
        return jsonify({'success': False, 'error': 'sourceFilename is required'}), 400
    if mode not in MODES:
        return jsonify({'success': False, 'error': "mode must be 'motif' or 'design'"}), 400
    if style not in stitch_render.STITCH_STYLES:
        return jsonify({'success': False, 'error': f"style must be one of: {', '.join(stitch_render.STITCH_STYLES)}"}), 400
    if finish not in stitch_render.FINISHES or density not in stitch_render.DENSITIES or direction not in stitch_render.DIRECTIONS:
        return jsonify({'success': False, 'error': 'Unknown finish, density or direction'}), 400

    from routes.upload import _user_can_access_file
    source_path = _resolve_path(source_filename)
    if not source_path:
        return jsonify({'success': False, 'error': 'Source file not found'}), 404
    if not _user_can_access_file(source_filename, user_id, user.get('role')):
        return jsonify({'success': False, 'error': 'You do not have access to the source file'}), 403

    credit_key = 'stitchRenderMotif' if mode == 'motif' else 'stitchRenderDesign'
    required_credits = credit_requirement(credit_key, 35 if mode == 'motif' else 67)
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', 1)
    if not ok:
        return jsonify(err), 403

    try:
        with Image.open(source_path) as img:
            source = img.convert('RGBA')
        if mode == 'motif':
            rendered, prompt, duration = stitch_render.render_motif(source, style, finish, density, direction)
            model = stitch_render.MOTIF_MODEL
            cost_usd = 0.03
        else:
            rendered, prompt, duration = stitch_render.render_design(source, style, finish, density, direction)
            model = stitch_render.DESIGN_MODEL
            cost_usd = 0.067
        log_replicate_call(project_id, model, duration, required_credits, cost_usd)
        adjust_reserved_credits(user_id, project_id, required_credits, required_credits, note='Stitch render')

        result_name = f"stitch_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        rendered.save(result_path, 'PNG')
        storage.sync_to_s3(result_path)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=source_filename,
            tool_type='Stitch Render',
            settings_dict={'mode': mode, 'style': style, 'finish': finish, 'density': density, 'direction': direction},
            user_id=user_id,
        )

        motif = None
        if mode == 'motif' and data.get('saveToLibrary'):
            label = stitch_render.STITCH_STYLES[style]['label']
            motif = create_motif_record(
                user_id=user_id,
                project_id=project_id,
                name=str(data.get('name') or f'{label} render')[:80],
                technique='embroidery',
                tags=['stitch-render', style, finish],
                filename=result_name,
                source_filename=source_filename,
                width=rendered.width,
                height=rendered.height,
            )

        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            'filename': result_name,
            'fileAccessToken': media_access_token(result_name, user_id),
            'width': rendered.width,
            'height': rendered.height,
            'mode': mode,
            'style': style,
            'prompt': prompt,
            'motif': motif,
            'creditsUsed': required_credits,
            **get_updated_credits(user_id),
        })
    except Exception as exc:
        refund_credits(user_id, project_id, required_credits, note='Stitch render failed')
        print(f"  [Stitch] Error: {exc}")
        return jsonify({'success': False, 'error': f'Stitch render failed: {exc}'}), 500
