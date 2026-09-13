"""Motif Library: a per-user catalogue of embroidery, lace, brocade, zari and appliqué assets.

Motifs reference files the user already owns (uploads or tool results, typically a
Remove Background result), so this module stores metadata only and never moves files.
"""
import json
import os
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from PIL import Image

from config import RESULTS_DIR, UPLOAD_DIR
from db import db, db_lock
from middleware import login_required
from security_utils import media_access_token

bp = Blueprint('motifs', __name__)

TECHNIQUES = ('embroidery', 'lace', 'brocade', 'zari', 'applique', 'embellishment', 'other')
MAX_TAGS = 12
MAX_LIST = 400


def _now_iso():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def _resolve_file(filename):
    """Return (path, url) for a basename living in uploads or results, or (None, None)."""
    filename = os.path.basename(filename or '')
    if not filename:
        return None, None
    upload_path = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(upload_path):
        return upload_path, f'/uploads/{filename}'
    result_path = os.path.join(RESULTS_DIR, filename)
    if os.path.exists(result_path):
        return result_path, f'/results/{filename}'
    return None, None


def _clean_tags(raw):
    if isinstance(raw, str):
        raw = [part.strip() for part in raw.split(',')]
    if not isinstance(raw, list):
        return []
    tags = []
    for tag in raw:
        text = str(tag or '').strip().lower()[:32]
        if text and text not in tags:
            tags.append(text)
        if len(tags) >= MAX_TAGS:
            break
    return tags


def _serialize(row, user_id):
    _, url = _resolve_file(row['filename'])
    return {
        'id': row['id'],
        'projectId': row['project_id'],
        'name': row['name'],
        'technique': row['technique'],
        'tags': json.loads(row['tags_json'] or '[]'),
        'filename': row['filename'],
        'sourceFilename': row['source_filename'],
        'url': url or f"/results/{row['filename']}",
        'width': row['width'],
        'height': row['height'],
        'fileAccessToken': media_access_token(row['filename'], user_id),
        'createdAt': row['created_at'],
    }


@bp.route('/api/motifs', methods=['GET'])
@login_required
def list_motifs():
    user_id = g.current_user['id']
    technique = (request.args.get('technique') or '').strip().lower()
    query = (request.args.get('q') or '').strip().lower()
    project_id = request.args.get('projectId')

    sql = "SELECT * FROM motifs WHERE user_id = ? AND deleted_at IS NULL"
    params = [user_id]
    if technique and technique in TECHNIQUES:
        sql += " AND technique = ?"
        params.append(technique)
    if project_id:
        try:
            sql += " AND (project_id = ? OR project_id IS NULL)"
            params.append(int(project_id))
        except ValueError:
            pass
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(MAX_LIST)

    with db_lock:
        conn = db()
        try:
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    motifs = [_serialize(row, user_id) for row in rows]
    if query:
        motifs = [
            m for m in motifs
            if query in (m['name'] or '').lower() or any(query in tag for tag in m['tags'])
        ]
    return jsonify({'success': True, 'motifs': motifs, 'techniques': list(TECHNIQUES)})


@bp.route('/api/motifs', methods=['POST'])
@login_required
def create_motif():
    from routes.upload import _user_can_access_file

    data = request.get_json(silent=True) or {}
    user = g.current_user
    filename = os.path.basename(str(data.get('filename') or ''))
    if not filename:
        return jsonify({'success': False, 'error': 'filename is required'}), 400

    path, _ = _resolve_file(filename)
    if not path:
        return jsonify({'success': False, 'error': 'File not found'}), 404
    if not _user_can_access_file(filename, user['id'], user.get('role')):
        return jsonify({'success': False, 'error': 'You do not have access to this file'}), 403

    technique = str(data.get('technique') or 'embroidery').strip().lower()
    if technique not in TECHNIQUES:
        return jsonify({'success': False, 'error': f"technique must be one of: {', '.join(TECHNIQUES)}"}), 400

    name = str(data.get('name') or '').strip()[:80] or os.path.splitext(filename)[0][:80]
    tags = _clean_tags(data.get('tags'))
    project_id = data.get('projectId')
    try:
        project_id = int(project_id) if project_id not in (None, '') else None
    except (TypeError, ValueError):
        project_id = None

    try:
        with Image.open(path) as img:
            width, height = img.size
    except Exception:
        return jsonify({'success': False, 'error': 'File is not a readable image'}), 400

    source_filename = os.path.basename(str(data.get('sourceFilename') or '')) or None
    motif = create_motif_record(user['id'], project_id, name, technique, tags, filename, source_filename, width, height)
    return jsonify({'success': True, 'motif': motif})


def create_motif_record(user_id, project_id, name, technique, tags, filename, source_filename, width, height):
    """Insert a motif row and return its serialized form. Shared with the appliqué and embellishment tools."""
    technique = technique if technique in TECHNIQUES else 'other'
    name = str(name or '').strip()[:80] or os.path.splitext(filename)[0][:80]
    now = _now_iso()
    with db_lock:
        conn = db()
        try:
            cur = conn.execute(
                """
                INSERT INTO motifs (user_id, project_id, name, technique, tags_json, filename, source_filename, width, height, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, project_id, name, technique, json.dumps(_clean_tags(tags)), filename, source_filename, width, height, now),
            )
            conn.commit()
            new_id = cur.lastrowid
            row = conn.execute("SELECT * FROM motifs WHERE id = ?", (new_id,)).fetchone()
        finally:
            conn.close()
    return _serialize(row, user_id)


@bp.route('/api/motifs/<int:motif_id>', methods=['PATCH'])
@login_required
def update_motif(motif_id):
    data = request.get_json(silent=True) or {}
    user_id = g.current_user['id']
    updates = []
    params = []
    if 'name' in data:
        name = str(data.get('name') or '').strip()[:80]
        if not name:
            return jsonify({'success': False, 'error': 'name cannot be empty'}), 400
        updates.append('name = ?')
        params.append(name)
    if 'technique' in data:
        technique = str(data.get('technique') or '').strip().lower()
        if technique not in TECHNIQUES:
            return jsonify({'success': False, 'error': f"technique must be one of: {', '.join(TECHNIQUES)}"}), 400
        updates.append('technique = ?')
        params.append(technique)
    if 'tags' in data:
        updates.append('tags_json = ?')
        params.append(json.dumps(_clean_tags(data.get('tags'))))
    if not updates:
        return jsonify({'success': False, 'error': 'No fields to update'}), 400

    params.extend([motif_id, user_id])
    with db_lock:
        conn = db()
        try:
            cur = conn.execute(
                f"UPDATE motifs SET {', '.join(updates)} WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                params,
            )
            conn.commit()
            if cur.rowcount == 0:
                return jsonify({'success': False, 'error': 'Motif not found'}), 404
            row = conn.execute("SELECT * FROM motifs WHERE id = ?", (motif_id,)).fetchone()
        finally:
            conn.close()
    return jsonify({'success': True, 'motif': _serialize(row, user_id)})


@bp.route('/api/motifs/<int:motif_id>', methods=['DELETE'])
@login_required
def delete_motif(motif_id):
    user_id = g.current_user['id']
    with db_lock:
        conn = db()
        try:
            cur = conn.execute(
                "UPDATE motifs SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                (_now_iso(), motif_id, user_id),
            )
            conn.commit()
            deleted = cur.rowcount > 0
        finally:
            conn.close()
    if not deleted:
        return jsonify({'success': False, 'error': 'Motif not found'}), 404
    return jsonify({'success': True})
