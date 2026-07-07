"""Qwen layered session CRUD, export, semantic select, and version history."""
import json
import os
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, g
from middleware import login_required, project_access_from_payload

from auth import (
    check_credits,
    credit_error_payload,
    credit_requirement,
    get_updated_credits,
    log_export,
    record_activity,
)
from config import groq_client, RESULTS_DIR
from db import db, db_lock
from qwen_session_helpers import (
    append_layer_version,
    get_session_versions,
    serialize_session_row,
)
from services.qwen_export import (
    export_session_png,
    export_session_psd,
    export_session_svg,
    export_session_zip,
    save_export_bytes,
)
from services.qwen_layers import _resolve_filepath

bp = Blueprint('qwen_sessions', __name__)


def _now_iso():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def _get_session(session_id, user_id):
    with db_lock:
        conn = db()
        try:
            row = conn.execute(
                "SELECT * FROM qwen_layered_sessions WHERE id = ? AND user_id = ? AND is_archived = 0",
                (session_id, user_id),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()


@bp.route('/api/qwen-sessions', methods=['POST'])
@login_required
def create_session():
    data = request.get_json() or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error

    user_id = g.current_user['id']
    source_filename = os.path.basename(data.get('sourceFilename', '') or data.get('filename', '') or '')
    name = (data.get('name') or 'Untitled Session').strip()[:120]
    canvas_width = int(data.get('canvasWidth', 1024))
    canvas_height = int(data.get('canvasHeight', 1024))
    document = data.get('document') or {'layers': [], 'canvas': {'width': canvas_width, 'height': canvas_height}}
    now = _now_iso()

    with db_lock:
        conn = db()
        try:
            cur = conn.execute(
                """
                INSERT INTO qwen_layered_sessions (
                    user_id, project_id, name, source_filename, canvas_width, canvas_height,
                    thumbnail_filename, last_composed_filename, document_json, created_at, updated_at, is_archived
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """,
                (
                    user_id,
                    project_id,
                    name,
                    source_filename or None,
                    canvas_width,
                    canvas_height,
                    data.get('thumbnailFilename'),
                    None,
                    json.dumps(document),
                    now,
                    now,
                ),
            )
            conn.commit()
            session_id = cur.lastrowid
        finally:
            conn.close()

    session = _get_session(session_id, user_id)
    return jsonify({'success': True, 'session': serialize_session_row(session)})


@bp.route('/api/qwen-sessions', methods=['GET'])
@login_required
def list_sessions():
    project_id = request.args.get('projectId') or request.args.get('project_id')
    if not project_id:
        return jsonify({'error': 'projectId is required'}), 400

    user_id = g.current_user['id']
    with db_lock:
        conn = db()
        try:
            rows = conn.execute(
                """
                SELECT * FROM qwen_layered_sessions
                WHERE project_id = ? AND user_id = ? AND is_archived = 0
                ORDER BY updated_at DESC
                """,
                (int(project_id), user_id),
            ).fetchall()
        finally:
            conn.close()

    sessions = [serialize_session_row(dict(row)) for row in rows]
    return jsonify({'success': True, 'sessions': sessions})


@bp.route('/api/qwen-sessions/<int:session_id>', methods=['GET'])
@login_required
def get_session(session_id):
    user_id = g.current_user['id']
    session = _get_session(session_id, user_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    versions = get_session_versions(session_id)
    payload = serialize_session_row(session)
    payload['versions'] = [
        {
            'id': v['id'],
            'layerLocalId': v['layer_local_id'],
            'version': v['version'],
            'filename': v['filename'],
            'editType': v['edit_type'],
            'prompt': v['prompt'],
            'parentFilename': v['parent_filename'],
            'createdAt': v['created_at'],
        }
        for v in versions
    ]
    return jsonify({'success': True, 'session': payload})


@bp.route('/api/qwen-sessions/<int:session_id>', methods=['PATCH'])
@login_required
def patch_session(session_id):
    data = request.get_json() or {}
    user_id = g.current_user['id']
    session = _get_session(session_id, user_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    updates = []
    params = []
    if 'name' in data:
        updates.append('name = ?')
        params.append(str(data['name'])[:120])
    if 'document' in data:
        updates.append('document_json = ?')
        params.append(json.dumps(data['document']))
    if 'canvasWidth' in data:
        updates.append('canvas_width = ?')
        params.append(int(data['canvasWidth']))
    if 'canvasHeight' in data:
        updates.append('canvas_height = ?')
        params.append(int(data['canvasHeight']))
    if 'thumbnailFilename' in data:
        updates.append('thumbnail_filename = ?')
        params.append(data['thumbnailFilename'])
    if 'lastComposedFilename' in data:
        updates.append('last_composed_filename = ?')
        params.append(data['lastComposedFilename'])

    if not updates:
        return jsonify({'error': 'No fields to update'}), 400

    now = _now_iso()
    updates.append('updated_at = ?')
    params.append(now)
    params.extend([session_id, user_id])

    with db_lock:
        conn = db()
        try:
            conn.execute(
                f"UPDATE qwen_layered_sessions SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
                params,
            )
            conn.commit()
        finally:
            conn.close()

    session = _get_session(session_id, user_id)
    return jsonify({'success': True, 'session': serialize_session_row(session)})


@bp.route('/api/qwen-sessions/<int:session_id>', methods=['DELETE'])
@login_required
def archive_session(session_id):
    user_id = g.current_user['id']
    session = _get_session(session_id, user_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    now = _now_iso()
    with db_lock:
        conn = db()
        try:
            conn.execute(
                "UPDATE qwen_layered_sessions SET is_archived = 1, updated_at = ? WHERE id = ? AND user_id = ?",
                (now, session_id, user_id),
            )
            conn.commit()
        finally:
            conn.close()
    return jsonify({'success': True})


@bp.route('/api/qwen-sessions/<int:session_id>/versions', methods=['POST'])
@login_required
def append_version(session_id):
    data = request.get_json() or {}
    user_id = g.current_user['id']
    if not _get_session(session_id, user_id):
        return jsonify({'error': 'Session not found'}), 404

    version = append_layer_version(
        session_id=session_id,
        layer_local_id=int(data.get('layerLocalId', 0)),
        filename=os.path.basename(data.get('filename', '') or ''),
        edit_type=data.get('editType', 'edit'),
        prompt=data.get('prompt'),
        parent_filename=data.get('parentFilename'),
        cost_usd=data.get('costUsd'),
        credits=data.get('credits'),
        duration_ms=data.get('durationMs'),
    )
    return jsonify({'success': True, 'version': version})


@bp.route('/api/qwen-sessions/<int:session_id>/revert', methods=['POST'])
@login_required
def revert_version(session_id):
    data = request.get_json() or {}
    user_id = g.current_user['id']
    session = _get_session(session_id, user_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    version_id = data.get('versionId')
    layer_local_id = data.get('layerLocalId')
    if not version_id and layer_local_id is None:
        return jsonify({'error': 'versionId or layerLocalId is required'}), 400

    with db_lock:
        conn = db()
        try:
            if version_id:
                row = conn.execute(
                    "SELECT * FROM qwen_layer_versions WHERE id = ? AND session_id = ?",
                    (version_id, session_id),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT * FROM qwen_layer_versions
                    WHERE session_id = ? AND layer_local_id = ?
                    ORDER BY version DESC LIMIT 1
                    """,
                    (session_id, layer_local_id),
                ).fetchone()
        finally:
            conn.close()

    if not row:
        return jsonify({'error': 'Version not found'}), 404

    version = dict(row)
    document = json.loads(session.get('document_json') or '{}')
    layers = document.get('layers', [])
    target_id = version['layer_local_id']
    updated = False
    for layer in layers:
        lid = layer.get('local_id', layer.get('id'))
        if lid == target_id:
            layer['filename'] = version['filename']
            layer['url'] = f"/results/{version['filename']}"
            updated = True
            break

    if not updated:
        return jsonify({'error': 'Layer not found in session document'}), 404

    now = _now_iso()
    with db_lock:
        conn = db()
        try:
            conn.execute(
                "UPDATE qwen_layered_sessions SET document_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(document), now, session_id),
            )
            conn.commit()
        finally:
            conn.close()

    session = _get_session(session_id, user_id)
    return jsonify({
        'success': True,
        'session': serialize_session_row(session),
        'revertedFilename': version['filename'],
        'layerLocalId': target_id,
    })


@bp.route('/api/qwen-sessions/<int:session_id>/semantic-select', methods=['POST'])
@login_required
def semantic_select(session_id):
    """Score layers against a natural-language query using Groq vision."""
    data = request.get_json() or {}
    query = (data.get('query') or '').strip()
    user_id = g.current_user['id']
    session = _get_session(session_id, user_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404
    if not query:
        return jsonify({'error': 'query is required'}), 400

    document = json.loads(session.get('document_json') or '{}')
    matches = []
    import base64

    for layer in document.get('layers', []):
        fname = layer.get('filename')
        path = _resolve_filepath(fname)
        if not path:
            continue
        try:
            with open(path, 'rb') as f:
                image_b64 = base64.b64encode(f.read()).decode('utf-8')
            completion = groq_client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
                        {"type": "text", "text": (
                            f'Does this layer match the query "{query}"? '
                            'Answer with JSON only: {"match": true|false, "confidence": 0.0-1.0, "reason": "..."}'
                        )},
                    ],
                }],
                temperature=0.1,
                max_completion_tokens=80,
            )
            raw = completion.choices[0].message.content.strip()
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {'match': query.lower() in raw.lower(), 'confidence': 0.5, 'reason': raw}
            if parsed.get('match'):
                matches.append({
                    'layerLocalId': layer.get('local_id', layer.get('id')),
                    'name': layer.get('name'),
                    'filename': fname,
                    'confidence': parsed.get('confidence', 0.5),
                    'reason': parsed.get('reason', ''),
                })
        except Exception as exc:
            print(f"  [Semantic Select] Layer {fname} failed: {exc}")

    matches.sort(key=lambda m: m.get('confidence', 0), reverse=True)
    return jsonify({'success': True, 'matches': matches, 'query': query})


@bp.route('/api/qwen-sessions/<int:session_id>/export', methods=['POST'])
@login_required
def export_session(session_id):
    data = request.get_json() or {}
    export_format = (data.get('format') or request.args.get('format') or 'png').lower()
    user_id = g.current_user['id']
    session = _get_session(session_id, user_id)
    if not session:
        return jsonify({'error': 'Session not found'}), 404

    credit_keys = {
        'png': None,
        'zip': 'qwenSessionExportZip',
        'psd': 'qwenSessionExportPsd',
        'svg': 'qwenSessionExportSvg',
    }
    tool_key = credit_keys.get(export_format)
    required_credits = 0
    if tool_key:
        required_credits = credit_requirement(tool_key, {'zip': 2, 'psd': 5, 'svg': 15}[export_format])
        ok, remaining, limit, used = check_credits(user_id, required_credits)
        if not ok:
            return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

    document = json.loads(session.get('document_json') or '{}')
    canvas_width = int(session.get('canvas_width') or document.get('canvas', {}).get('width', 1024))
    canvas_height = int(session.get('canvas_height') or document.get('canvas', {}).get('height', 1024))
    session_name = session.get('name') or 'qwen_session'

    try:
        if export_format == 'png':
            data_bytes = export_session_png(document, canvas_width, canvas_height)
            filename, url = save_export_bytes(data_bytes, 'composed', 'png')
        elif export_format == 'zip':
            data_bytes = export_session_zip(document, session_name)
            filename, url = save_export_bytes(data_bytes, 'qwen_export', 'zip')
        elif export_format == 'psd':
            data_bytes = export_session_psd(document, canvas_width, canvas_height)
            filename, url = save_export_bytes(data_bytes, 'qwen_export', 'psd')
        elif export_format == 'svg':
            data_bytes = export_session_svg(document, canvas_width, canvas_height)
            filename, url = save_export_bytes(data_bytes, 'qwen_export', 'svg')
        else:
            return jsonify({'error': f'Unsupported format: {export_format}'}), 400

        if required_credits:
            record_activity(session.get('project_id'), 'export', 1, required_credits, user_id=user_id)

        log_export(
            project_id=session.get('project_id'),
            filename=filename,
            input_filename=session.get('source_filename'),
            tool_type=f'Qwen Export {export_format.upper()}',
            settings_dict={'session_id': session_id, 'format': export_format},
            user_id=user_id,
        )

        updated_credits = get_updated_credits(user_id)
        return jsonify({
            'success': True,
            'format': export_format,
            'resultUrl': url,
            'filename': filename,
            **updated_credits,
        })
    except Exception as e:
        print(f"  [Qwen Export] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Export failed: {str(e)}'}), 500


@bp.route('/api/qwen-sessions/cleanup', methods=['POST'])
@login_required
def run_cleanup():
    """Admin/manual trigger for orphaned layer file sweep."""
    if g.current_user.get('role') != 'admin':
        return jsonify({'error': 'Admin only'}), 403
    from services.qwen_cleanup import sweep_orphaned_layer_files
    dry_run = bool((request.get_json() or {}).get('dryRun', False))
    result = sweep_orphaned_layer_files(dry_run=dry_run)
    return jsonify({'success': True, **result})
