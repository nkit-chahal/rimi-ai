"""Helpers for Qwen layered session persistence and version history."""
import json
from datetime import datetime, timezone

from db import db, db_lock


def _now_iso():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def append_layer_version(
    session_id,
    layer_local_id,
    filename,
    edit_type='decompose',
    prompt=None,
    parent_filename=None,
    cost_usd=None,
    credits=None,
    duration_ms=None,
):
    """Append a version row for a layer within a session."""
    if not session_id:
        return None

    created_at = _now_iso()
    with db_lock:
        conn = db()
        try:
            row = conn.execute(
                """
                SELECT COALESCE(MAX(version), 0) AS max_version
                FROM qwen_layer_versions
                WHERE session_id = ? AND layer_local_id = ?
                """,
                (session_id, layer_local_id),
            ).fetchone()
            next_version = int(row['max_version'] if row else 0) + 1
            cur = conn.execute(
                """
                INSERT INTO qwen_layer_versions (
                    session_id, layer_local_id, version, filename, edit_type, prompt,
                    parent_filename, cost_usd, credits, duration_ms, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    layer_local_id,
                    next_version,
                    filename,
                    edit_type,
                    prompt,
                    parent_filename,
                    cost_usd,
                    credits,
                    duration_ms,
                    created_at,
                ),
            )
            conn.commit()
            return {
                'id': cur.lastrowid,
                'version': next_version,
                'filename': filename,
                'editType': edit_type,
                'prompt': prompt,
                'parentFilename': parent_filename,
                'createdAt': created_at,
            }
        finally:
            conn.close()


def record_job_versions(session_id, job_result):
    """Record version rows from a completed layer job result."""
    if not session_id or not job_result:
        return []

    recorded = []
    if job_result.get('layers'):
        for layer in job_result['layers']:
            version = append_layer_version(
                session_id=session_id,
                layer_local_id=layer.get('index', 0),
                filename=layer.get('filename'),
                edit_type='decompose',
                prompt=job_result.get('description'),
                parent_filename=job_result.get('sourceFilename'),
                cost_usd=job_result.get('costUsd'),
                credits=job_result.get('creditsUsed'),
                duration_ms=int((job_result.get('duration') or 0) * 1000),
            )
            if version:
                recorded.append(version)
    elif job_result.get('results'):
        for item in job_result['results']:
            version = append_layer_version(
                session_id=session_id,
                layer_local_id=item.get('layerLocalId'),
                filename=item.get('filename'),
                edit_type=item.get('editType', 'edit'),
                prompt=item.get('prompt'),
                parent_filename=item.get('parentFilename'),
                cost_usd=item.get('costUsd'),
                credits=item.get('creditsUsed'),
                duration_ms=int((item.get('duration') or 0) * 1000),
            )
            if version:
                recorded.append(version)
    elif job_result.get('filename'):
        version = append_layer_version(
            session_id=session_id,
            layer_local_id=job_result.get('layerLocalId'),
            filename=job_result.get('filename'),
            edit_type=job_result.get('editType', 'edit'),
            prompt=job_result.get('prompt'),
            parent_filename=job_result.get('parentFilename'),
            cost_usd=job_result.get('costUsd'),
            credits=job_result.get('creditsUsed'),
            duration_ms=int((job_result.get('duration') or 0) * 1000),
        )
        if version:
            recorded.append(version)
    return recorded


def get_session_versions(session_id, layer_local_id=None):
    with db_lock:
        conn = db()
        try:
            if layer_local_id is not None:
                rows = conn.execute(
                    """
                    SELECT * FROM qwen_layer_versions
                    WHERE session_id = ? AND layer_local_id = ?
                    ORDER BY version DESC
                    """,
                    (session_id, layer_local_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM qwen_layer_versions
                    WHERE session_id = ?
                    ORDER BY layer_local_id ASC, version DESC
                    """,
                    (session_id,),
                ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()


def serialize_session_row(row):
    data = dict(row)
    try:
        data['document'] = json.loads(data.get('document_json') or '{}')
    except json.JSONDecodeError:
        data['document'] = {}
    data['isArchived'] = bool(data.pop('is_archived', 0))
    data['sourceFilename'] = data.pop('source_filename', None)
    data['canvasWidth'] = data.pop('canvas_width', 1024)
    data['canvasHeight'] = data.pop('canvas_height', 1024)
    data['thumbnailFilename'] = data.pop('thumbnail_filename', None)
    data['lastComposedFilename'] = data.pop('last_composed_filename', None)
    data['projectId'] = data.pop('project_id', None)
    data['userId'] = data.pop('user_id', None)
    data['createdAt'] = data.pop('created_at', None)
    data['updatedAt'] = data.pop('updated_at', None)
    data.pop('document_json', None)
    return data
