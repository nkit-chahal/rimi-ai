"""Remove Background route — Replicate 851-labs/background-remover."""
import base64
import os
import time
import uuid

import replicate
import requests as http_requests
from flask import Blueprint, jsonify, request, g
from middleware import login_required, project_access_from_payload

from auth import (
    check_credits,
    credit_error_payload,
    credit_requirement,
    get_updated_credits,
    log_export,
    log_replicate_call,
    record_activity,
)
from config import RESULTS_DIR, UPLOAD_DIR

PUBLIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'public')
import storage

bp = Blueprint('remove_bg', __name__)

REMOVE_BG_MODEL = (
    "851-labs/background-remover:"
    "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"
)
REMOVE_BG_COST_USD = 0.00049


def _resolve_image_path(filename='', image_url=''):
    """Resolve a local upload path or download a remote image for processing."""
    if filename:
        filename = os.path.basename(filename)
        filepath = os.path.join(UPLOAD_DIR, filename)
        if os.path.exists(filepath):
            return filename, filepath
        filepath = os.path.join(PUBLIC_DIR, filename)
        if os.path.exists(filepath):
            return filename, filepath
        raise FileNotFoundError(f'File not found: {filename}')

    if image_url and image_url.startswith('http'):
        ext = '.png' if '.png' in image_url.lower() else '.jpg'
        filename = f"tmp_rmbg_{uuid.uuid4().hex[:8]}{ext}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        resp = http_requests.get(image_url, timeout=30)
        resp.raise_for_status()
        with open(filepath, 'wb') as handle:
            handle.write(resp.content)
        return filename, filepath

    raise ValueError('Provide either filename or imageUrl')


def _image_to_data_uri(filepath, filename):
    with open(filepath, 'rb') as img_file:
        encoded = base64.b64encode(img_file.read()).decode('utf-8')
    mime_type = 'image/png' if filename.lower().endswith('.png') else 'image/jpeg'
    return f"data:{mime_type};base64,{encoded}"


@bp.route('/api/remove-bg', methods=['POST'])
@login_required
def remove_background():
    data = request.get_json() or {}
    filename = data.get('filename', '')
    image_url = data.get('imageUrl', '')
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']

    required_credits = credit_requirement('removeBg', 2)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

    try:
        source_name, filepath = _resolve_image_path(filename, image_url)
    except FileNotFoundError as exc:
        return jsonify({'error': str(exc)}), 404
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    try:
        print(f"  [RemoveBG] Processing {source_name} with {REMOVE_BG_MODEL}...")
        data_uri = _image_to_data_uri(filepath, source_name)

        start_time = time.time()
        output = replicate.run(REMOVE_BG_MODEL, input={'image': data_uri})
        duration = time.time() - start_time
        credits_used = required_credits

        log_replicate_call(project_id, REMOVE_BG_MODEL, duration, credits_used, REMOVE_BG_COST_USD)

        result_name = f"rmbg_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)

        try:
            with open(result_path, 'wb') as handle:
                handle.write(output.read())
        except (AttributeError, TypeError):
            result_url = output.url if hasattr(output, 'url') else (output[0] if isinstance(output, list) else str(output))
            resp = http_requests.get(result_url, timeout=30)
            resp.raise_for_status()
            with open(result_path, 'wb') as handle:
                handle.write(resp.content)

        storage.sync_to_s3(result_path)
        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=source_name,
            tool_type='Remove Background',
            settings_dict={'model': REMOVE_BG_MODEL},
            user_id=user_id,
        )

        updated_credits = get_updated_credits(user_id)
        print(f"  [RemoveBG] Done! Saved: {result_name} ({duration:.1f}s)")
        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            **updated_credits,
        })
    except Exception as exc:
        print(f"  [RemoveBG] Error: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Background removal failed: {exc}'}), 500
