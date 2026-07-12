"""Upload and static file serving routes."""
import os
import uuid
from flask import Blueprint, request, jsonify, send_from_directory, Response, abort, g

from middleware import login_required
from security_utils import authorize_file_request, validate_upload_file, issue_file_access_token, media_access_token

from config import UPLOAD_DIR, RESULTS_DIR, allowed_file, USE_S3
from db import db
import storage

bp = Blueprint('upload', __name__)


def _record_user_upload(user_id, filename):
    conn = db()
    try:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn.execute(
            """
            INSERT INTO user_uploads (user_id, filename, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(filename) DO UPDATE SET user_id = excluded.user_id
            """,
            (user_id, filename, now),
        )
        conn.commit()
    finally:
        conn.close()


def _source_export_filename(filename):
    """Map cached preview files back to their backing export filename."""
    safe = os.path.basename(filename or "")
    if safe.startswith("prev_") and safe.endswith(".jpg"):
        base = safe[5:-4]
        conn = db()
        try:
            row = conn.execute(
                "SELECT filename FROM exports WHERE filename LIKE ? LIMIT 1",
                (f"{base}.%",),
            ).fetchone()
            if row:
                return row["filename"]
        finally:
            conn.close()
    return safe


def _lookup_file_owner(filename):
    """Resolve owning user_id for a results/uploads basename.

    Checks user_uploads, exports (falling back to the parent project's owner when
    exports.user_id is NULL), then project hero/thumbnail and pattern_variations.
    """
    lookup_name = _source_export_filename(filename)
    if not lookup_name:
        return None
    results_path = f"/results/{lookup_name}"
    uploads_path = f"/uploads/{lookup_name}"
    like = f"%/{lookup_name}"
    conn = db()
    try:
        row = conn.execute(
            "SELECT user_id FROM user_uploads WHERE filename = ?",
            (lookup_name,),
        ).fetchone()
        if row and row["user_id"] is not None:
            return int(row["user_id"])

        # Prefer exports.user_id; if legacy rows left it NULL, use project owner.
        row = conn.execute(
            """
            SELECT COALESCE(e.user_id, p.user_id) AS user_id
            FROM exports e
            LEFT JOIN projects p ON p.id = e.project_id
            WHERE e.filename = ?
            LIMIT 1
            """,
            (lookup_name,),
        ).fetchone()
        if row and row["user_id"] is not None:
            return int(row["user_id"])

        # Hero / thumbnail set by tools (e.g. seamless_tile_*.png) without a usable export row.
        row = conn.execute(
            """
            SELECT user_id FROM projects
            WHERE hero_image_url IN (?, ?)
               OR thumbnail_url IN (?, ?)
               OR hero_image_url LIKE ?
               OR thumbnail_url LIKE ?
            LIMIT 1
            """,
            (results_path, uploads_path, results_path, uploads_path, like, like),
        ).fetchone()
        if row and row["user_id"] is not None:
            return int(row["user_id"])

        row = conn.execute(
            """
            SELECT p.user_id
            FROM pattern_variations v
            JOIN projects p ON p.id = v.project_id
            WHERE v.export_filename = ?
               OR v.image_url IN (?, ?)
               OR v.image_url LIKE ?
            LIMIT 1
            """,
            (lookup_name, results_path, uploads_path, like),
        ).fetchone()
        if row and row["user_id"] is not None:
            return int(row["user_id"])
    finally:
        conn.close()
    return None


def _require_file_access(filename):
    owner_user_id = _lookup_file_owner(filename)
    if not authorize_file_request(filename, owner_user_id):
        abort(401)


def _user_can_access_file(filename, user_id, role):
    owner = _lookup_file_owner(filename)
    if owner is None:
        return False
    if role == 'admin':
        return True
    return int(owner) == int(user_id)


@bp.route('/api/file-access-token')
@login_required
def file_access_token():
    """Issue a short-lived token for <img> / fabric.js (no Authorization header)."""
    filename = os.path.basename(request.args.get('filename', ''))
    if not filename:
        return jsonify({'error': 'filename required'}), 400
    user_id = g.current_user['id']
    role = g.current_user.get('role')
    if not _user_can_access_file(filename, user_id, role):
        return jsonify({'error': 'Forbidden'}), 403
    owner = _lookup_file_owner(filename)
    token = issue_file_access_token(filename, owner)
    return jsonify({'success': True, 'accessToken': token, 'filename': filename})


@bp.route('/api/file-access-tokens', methods=['POST'])
@login_required
def file_access_tokens_batch():
    """Batch issue file access tokens for studio galleries."""
    data = request.get_json() or {}
    filenames = data.get('filenames') or []
    user_id = g.current_user['id']
    role = g.current_user.get('role')
    tokens = {}
    for raw in filenames[:80]:
        filename = os.path.basename(raw or '')
        if not filename or not _user_can_access_file(filename, user_id, role):
            continue
        owner = _lookup_file_owner(filename)
        if owner:
            tokens[filename] = issue_file_access_token(filename, owner)
    return jsonify({'success': True, 'tokens': tokens})


@bp.route('/api/upload', methods=['POST'])
@login_required
def upload_image():
    if 'image' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    try:
        validate_upload_file(file)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Supported: JPG, PNG, WEBP'}), 400

    ext = file.filename.rsplit('.', 1)[1].lower()
    unique_name = f"{uuid.uuid4().hex}.{ext}"

    filepath = os.path.join(UPLOAD_DIR, unique_name)
    file.save(filepath)

    if USE_S3:
        storage.save_local_file_to_storage('uploads', unique_name)

    _record_user_upload(g.current_user['id'], unique_name)

    access_token = media_access_token(unique_name, g.current_user['id'])
    return jsonify({
        'success': True,
        'filename': unique_name,
        'fileUrl': f'/uploads/{unique_name}',
        'fileAccessToken': access_token,
        'originalName': file.filename
    })


@bp.route('/uploads/<filename>')
def serve_upload(filename):
    filename = os.path.basename(filename)
    _require_file_access(filename)

    local_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(local_path):
        return send_from_directory(UPLOAD_DIR, filename)
    if USE_S3:
        data, ct = storage.get_file('uploads', filename)
        if data:
            return Response(data, mimetype=ct)
    abort(404)


@bp.route('/results/<filename>')
def serve_result(filename):
    filename = os.path.basename(filename)
    _require_file_access(filename)

    mimetype = 'image/svg+xml' if filename.endswith('.svg') else None
    local_path = os.path.join(RESULTS_DIR, filename)
    if os.path.exists(local_path):
        return send_from_directory(RESULTS_DIR, filename, mimetype=mimetype)
    if USE_S3:
        data, ct = storage.get_file('results', filename)
        if data:
            return Response(data, mimetype=ct if not mimetype else mimetype)
    abort(404)


@bp.route('/results/previews/<filename>')
def serve_preview(filename):
    filename = os.path.basename(filename)
    _require_file_access(filename)

    previews_dir = os.path.join(RESULTS_DIR, 'previews')
    local_path = os.path.join(previews_dir, filename)
    if not os.path.exists(local_path):
        source = _source_export_filename(filename)
        if source and source != filename:
            from routes.exports import get_preview
            get_preview(source)
    if os.path.exists(local_path):
        return send_from_directory(previews_dir, filename)
    if USE_S3:
        data, ct = storage.get_file('results', f'previews/{filename}')
        if data:
            return Response(data, mimetype=ct)
    abort(404)
