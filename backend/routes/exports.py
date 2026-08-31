"""Exports routes: download proxy, list exports, delete exports."""
import os
import json
from datetime import datetime, timezone
from urllib.parse import urlparse
from flask import Blueprint, request, jsonify, send_from_directory, Response, abort, g

from config import UPLOAD_DIR, RESULTS_DIR, USE_S3
from db import db, db_lock, iso_to_epoch
from middleware import login_required
from security_utils import issue_file_access_token
from watermark import apply_watermark, is_free_plan
import storage

bp = Blueprint('exports', __name__)

PREVIEWS_DIR = os.path.join(RESULTS_DIR, 'previews')


def resolve_export_input_url(input_filename):
    """Resolve an export source image only when the backing file is available."""
    if not input_filename:
        return None

    if input_filename.startswith('http://') or input_filename.startswith('https://'):
        return input_filename

    if input_filename.startswith('/'):
        parsed_path = urlparse(input_filename).path
        filename = os.path.basename(parsed_path)
        if parsed_path.startswith('/uploads/'):
            return parsed_path if storage.file_exists('uploads', filename) else None
        if parsed_path.startswith('/results/'):
            return parsed_path if storage.file_exists('results', filename) else None

        public_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
        public_path = parsed_path.lstrip('/')
        return parsed_path if os.path.exists(os.path.join(public_dir, public_path)) else None

    safe_name = os.path.basename(input_filename)
    if storage.file_exists('uploads', safe_name):
        return f'/uploads/{safe_name}'
    if storage.file_exists('results', safe_name):
        return f'/results/{safe_name}'

    public_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
    if os.path.exists(os.path.join(public_dir, safe_name)):
        return f'/{safe_name}'

    return None


def get_preview(filename):
    """
    Generate a compressed mid-res preview (400px max) for the exports grid.
    Cached in results/previews/. ~30-50 KB per image instead of multi-MB originals.
    """
    from PIL import Image
    os.makedirs(PREVIEWS_DIR, exist_ok=True)
    
    preview_name = f"prev_{filename.rsplit('.', 1)[0]}.jpg"
    preview_path = os.path.join(PREVIEWS_DIR, preview_name)
    
    src_path = os.path.join(RESULTS_DIR, filename)
    if not os.path.isfile(src_path):
        return f'/results/{filename}'
    # Return cached preview if it exists and is newer than source
    if os.path.exists(preview_path) and os.path.getmtime(preview_path) >= os.path.getmtime(src_path):
        return f'/results/previews/{preview_name}'
    
    try:
        img = Image.open(src_path)
        img.thumbnail((400, 400), Image.Resampling.LANCZOS)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        img.save(preview_path, 'JPEG', quality=65, optimize=True)
        return f'/results/previews/{preview_name}'
    except Exception:
        return f'/results/{filename}'


def format_file_size(size_bytes):
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


# --------------- Download Proxy ---------------
@bp.route('/api/download')
@login_required
def download():
    url = request.args.get('url', '')
    if not url:
        return 'Missing url parameter', 400

    from urllib.parse import urlparse
    parsed = urlparse(url)
    
    # Check if it's local (relative path or matches our host)
    if not parsed.netloc or parsed.netloc == request.host:
        path = parsed.path
        if path.startswith('/results/') or path.startswith('/uploads/'):
            filename = path.split('/')[-1]
            dir_type = 'results' if path.startswith('/results/') else 'uploads'
            directory = RESULTS_DIR if dir_type == 'results' else UPLOAD_DIR
            local_path = os.path.join(directory, filename)
            file_bytes = None
            content_type = None
            if os.path.exists(local_path):
                with open(local_path, 'rb') as handle:
                    file_bytes = handle.read()
                content_type = 'image/svg+xml' if filename.endswith('.svg') else 'application/octet-stream'
            elif USE_S3:
                file_bytes, content_type = storage.get_file(dir_type, filename)
            if file_bytes:
                if is_free_plan(g.current_user.get('plan')) and not filename.endswith('.svg'):
                    file_bytes = apply_watermark(file_bytes)
                    content_type = 'image/png'
                    filename = filename.rsplit('.', 1)[0] + '_watermarked.png'
                return Response(
                    file_bytes,
                    mimetype=content_type or 'application/octet-stream',
                    headers={'Content-Disposition': f'attachment; filename={filename}'},
                )

    # For remote URLs — SSRF protection: only allow known domains
    import requests as http_requests

    ALLOWED_DOWNLOAD_DOMAINS = {
        'replicate.delivery',
        'pbxt.replicate.delivery',
        'replicate.com',
        'oaidalleapiprodscus.blob.core.windows.net',
        'storage.googleapis.com',
    }

    domain = parsed.hostname or ''
    if not any(domain == d or domain.endswith('.' + d) for d in ALLOWED_DOWNLOAD_DOMAINS):
        return jsonify({'error': f'Download from this domain is not allowed'}), 403
    
    try:
        print(f"  [Download Proxy] Streaming from {url}...")
        resp = http_requests.get(url, stream=True, timeout=30)
        resp.raise_for_status()
        
        filename = os.path.basename(parsed.path) or 'download.png'
        if not filename or filename == '/':
            filename = 'download.png'
            
        headers = {
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Type': resp.headers.get('Content-Type', 'application/octet-stream')
        }
        
        def generate():
            for chunk in resp.iter_content(chunk_size=8192):
                yield chunk
                
        return Response(generate(), headers=headers)
    except Exception as e:
        print(f"  [Download Proxy] Error: {e}")
        return jsonify({'error': 'Failed to proxy download'}), 500


# --------------- Exports ---------------
@bp.route('/api/exports')
@login_required
def list_exports():
    """
    Returns a list of all logged exports from the database,
    sorted by newest first. Includes resolved input urls, tools,
    settings, pipeline logs, file size, type, etc.
    """
    try:
        current_user = g.current_user
        user_id = current_user["id"]
        is_admin = current_user.get("role") == "admin"
        conn = db()
        project_id = request.args.get('project_id', type=int)
        if is_admin and not project_id:
            rows = conn.execute("SELECT e.* FROM exports e WHERE e.deleted_at IS NULL ORDER BY e.created_at DESC").fetchall()
        elif is_admin and project_id:
            rows = conn.execute(
                "SELECT e.* FROM exports e WHERE e.project_id = ? AND e.deleted_at IS NULL ORDER BY e.created_at DESC",
                (project_id,),
            ).fetchall()
        elif project_id:
            rows = conn.execute(
                """
                SELECT e.*
                FROM exports e
                LEFT JOIN projects p ON p.id = e.project_id
                WHERE e.project_id = ?
                  AND e.deleted_at IS NULL
                  AND (e.user_id = ? OR (e.user_id IS NULL AND p.user_id = ?))
                ORDER BY e.created_at DESC
                """,
                (project_id, user_id, user_id),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT e.*
                FROM exports e
                LEFT JOIN projects p ON p.id = e.project_id
                WHERE e.deleted_at IS NULL
                  AND (e.user_id = ? OR (e.user_id IS NULL AND p.user_id = ?))
                ORDER BY e.created_at DESC
                """,
                (user_id, user_id),
            ).fetchall()
        conn.close()
        
        files = []
        for row in rows:
            filename = row['filename']
            filepath = os.path.join(RESULTS_DIR, filename)
            
            # Extract extension and file size
            ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
            is_vector = ext == 'svg'
            
            if os.path.isfile(filepath):
                file_size = os.path.getsize(filepath)
                mtime = os.path.getmtime(filepath)
            else:
                file_size = 0
                mtime = iso_to_epoch(row['created_at'])
                
            # Generate preview url
            if is_vector:
                preview_url = f'/results/{filename}'
            else:
                preview_url = get_preview(filename)
                
            # Resolve settings and pipeline steps
            settings = {}
            if row['settings_json']:
                try:
                    settings = json.loads(row['settings_json'])
                except Exception:
                    pass
                    
            pipeline_steps = None
            if row['pipeline_steps_json']:
                try:
                    pipeline_steps = json.loads(row['pipeline_steps_json'])
                except Exception:
                    pass

            input_url = resolve_export_input_url(row['input_filename'])
            owner_id = row['user_id']
            file_access_token = (
                issue_file_access_token(filename, int(owner_id))
                if owner_id is not None
                else None
            )
            preview_access_token = None
            if owner_id is not None and preview_url:
                preview_name = os.path.basename(urlparse(preview_url).path)
                preview_access_token = issue_file_access_token(preview_name, int(owner_id))
            input_access_token = None
            if owner_id is not None and input_url and input_url.startswith('/'):
                input_name = os.path.basename(urlparse(input_url).path)
                if input_name:
                    input_access_token = issue_file_access_token(input_name, int(owner_id))

            files.append({
                'id': filename,
                'projectId': row['project_id'],
                'filename': filename,
                'imageUrl': f'/results/{filename}',
                'previewUrl': preview_url,
                'fileAccessToken': file_access_token,
                'previewAccessToken': preview_access_token,
                'inputAccessToken': input_access_token,
                'type': 'vector' if is_vector else 'image',
                'format': ext.upper(),
                'size': format_file_size(file_size),
                'sizeBytes': file_size,
                'timestamp': mtime,
                'createdAt': row['created_at'],
                'inputFilename': row['input_filename'],
                'inputUrl': input_url,
                'inputMissing': bool(row['input_filename'] and not input_url),
                'toolType': row['tool_type'],
                'settings': settings,
                'pipelineRunId': row['pipeline_run_id'],
                'pipelineSteps': pipeline_steps
            })
            
        return jsonify({'success': True, 'exports': files})
    except Exception as e:
        print(f"  [Exports] Error loading exports: {e}")
        return jsonify({'error': str(e)}), 500


@bp.route('/api/exports', methods=['DELETE'])
@login_required
def delete_exports():
    """
    Archives one or more exports while retaining their local/S3 objects.
    Expects JSON: { filenames: ['file1.png', 'file2.png'] }
    """
    data = request.get_json() or {}
    filenames = data.get('filenames', [])
    
    if not filenames:
        return jsonify({'error': 'No filenames provided'}), 400

    archived = []
    errors = []
    current_user = g.current_user
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    
    with db_lock:
        conn = db()
        try:
            for filename in filenames:
                safe_name = os.path.basename(filename)
                if is_admin:
                    export_row = conn.execute(
                        "SELECT e.* FROM exports e WHERE e.filename = ? AND e.deleted_at IS NULL",
                        (safe_name,),
                    ).fetchone()
                else:
                    export_row = conn.execute(
                        """
                        SELECT e.*
                        FROM exports e
                        LEFT JOIN projects p ON p.id = e.project_id
                        WHERE e.filename = ?
                          AND e.deleted_at IS NULL
                          AND (e.user_id = ? OR (e.user_id IS NULL AND p.user_id = ?))
                        """,
                        (safe_name, user_id, user_id),
                    ).fetchone()
                if export_row:
                    conn.execute("SAVEPOINT archive_export")
                    tag_updated = False
                    try:
                        row = dict(export_row)
                        now = datetime.now(timezone.utc).isoformat()
                        tag_updated = storage.update_object_tags('results', safe_name, {
                            'lifecycle': 'archived',
                            'deleted_at': now,
                            'deleted_by': user_id,
                            'project_id': row.get('project_id') or '',
                        })
                        if USE_S3 and not tag_updated:
                            raise RuntimeError('could not update S3 lifecycle tags')

                        result_url = f'/results/{safe_name}'
                        project_id = row.get('project_id')
                        selected_link = conn.execute(
                            """
                            SELECT 1 FROM pattern_variations
                            WHERE project_id = ? AND deleted_at IS NULL
                              AND (export_filename = ? OR image_url = ?)
                              AND is_selected = 1
                            LIMIT 1
                            """,
                            (project_id, safe_name, result_url),
                        ).fetchone() if project_id is not None else None

                        conn.execute(
                            "UPDATE exports SET deleted_at = ?, deleted_by = ? WHERE filename = ?",
                            (now, user_id, safe_name),
                        )
                        conn.execute(
                            """
                            UPDATE pattern_variations
                            SET deleted_at = ?, is_selected = 0
                            WHERE project_id = ? AND deleted_at IS NULL
                              AND (export_filename = ? OR image_url = ?)
                            """,
                            (now, project_id, safe_name, result_url),
                        )
                        conn.execute(
                            "UPDATE share_links SET revoked_at = ? WHERE export_filename = ? AND revoked_at IS NULL",
                            (now, safe_name),
                        )

                        if project_id is not None:
                            project = conn.execute(
                                "SELECT hero_image_url, thumbnail_url FROM projects WHERE id = ?",
                                (project_id,),
                            ).fetchone()
                            project_points_to_archived = bool(project and (
                                project['hero_image_url'] == result_url or project['thumbnail_url'] == result_url
                            ))
                            if selected_link or project_points_to_archived:
                                fallback = conn.execute(
                                    """
                                    SELECT id, image_url FROM pattern_variations
                                    WHERE project_id = ? AND deleted_at IS NULL
                                    ORDER BY created_at DESC, id DESC LIMIT 1
                                    """,
                                    (project_id,),
                                ).fetchone()
                                fallback_url = fallback['image_url'] if fallback else ''
                                conn.execute(
                                    "UPDATE pattern_variations SET is_selected = 0 WHERE project_id = ? AND deleted_at IS NULL",
                                    (project_id,),
                                )
                                if fallback:
                                    conn.execute("UPDATE pattern_variations SET is_selected = 1 WHERE id = ?", (fallback['id'],))
                                conn.execute(
                                    """
                                    UPDATE projects
                                    SET hero_image_url = CASE WHEN hero_image_url = ? THEN ? ELSE hero_image_url END,
                                        thumbnail_url = CASE WHEN thumbnail_url = ? THEN ? ELSE thumbnail_url END,
                                        updated_at = ?
                                    WHERE id = ?
                                    """,
                                    (result_url, fallback_url, result_url, fallback_url, now, project_id),
                                )
                            conn.execute(
                                """
                                UPDATE project_metrics
                                SET versions = (SELECT COUNT(*) FROM pattern_variations WHERE project_id = ? AND deleted_at IS NULL),
                                    exports = (SELECT COUNT(*) FROM exports WHERE project_id = ? AND deleted_at IS NULL)
                                WHERE project_id = ?
                                """,
                                (project_id, project_id, project_id),
                            )

                        conn.execute("RELEASE SAVEPOINT archive_export")
                        archived.append(safe_name)
                        print(f"  [Exports] Archived: {safe_name}")
                    except Exception as exc:
                        conn.execute("ROLLBACK TO SAVEPOINT archive_export")
                        conn.execute("RELEASE SAVEPOINT archive_export")
                        if USE_S3 and tag_updated:
                            storage.update_object_tags(
                                'results', safe_name, {'lifecycle': 'active'},
                                remove_keys=('deleted_at', 'deleted_by', 'project_id'),
                            )
                        errors.append(f"{safe_name}: {str(exc)}")
                else:
                    errors.append(f"{safe_name}: not found")
            conn.commit()
        except Exception as e:
            conn.rollback()
            if USE_S3:
                for archived_name in archived:
                    storage.update_object_tags(
                        'results', archived_name, {'lifecycle': 'active'},
                        remove_keys=('deleted_at', 'deleted_by', 'project_id'),
                    )
            archived.clear()
            errors.append(f"DB Error: {str(e)}")
        finally:
            conn.close()

    return jsonify({
        'success': bool(archived) and not errors,
        'deleted': archived,
        'archived': archived,
        'errors': errors
    })


@bp.route('/api/exports/restore', methods=['POST'])
@login_required
def restore_exports():
    """Restore archived export metadata and reactivate the retained S3 object."""
    data = request.get_json() or {}
    filenames = data.get('filenames', [])
    if not filenames:
        return jsonify({'error': 'No filenames provided'}), 400

    restored = []
    restored_metadata = {}
    errors = []
    user_id = g.current_user['id']
    is_admin = g.current_user.get('role') == 'admin'
    with db_lock:
        conn = db()
        try:
            for filename in filenames:
                safe_name = os.path.basename(filename)
                params = (safe_name,) if is_admin else (safe_name, user_id, user_id)
                owner_clause = '' if is_admin else 'AND (e.user_id = ? OR (e.user_id IS NULL AND p.user_id = ?))'
                row = conn.execute(
                    f"""
                    SELECT e.* FROM exports e
                    LEFT JOIN projects p ON p.id = e.project_id
                    WHERE e.filename = ? AND e.deleted_at IS NOT NULL {owner_clause}
                    """,
                    params,
                ).fetchone()
                if not row:
                    errors.append(f'{safe_name}: not found')
                    continue
                conn.execute("SAVEPOINT restore_export")
                tag_updated = False
                try:
                    tag_updated = storage.update_object_tags(
                        'results',
                        safe_name,
                        {'lifecycle': 'active'},
                        remove_keys=('deleted_at', 'deleted_by', 'project_id'),
                    )
                    if USE_S3 and not tag_updated:
                        raise RuntimeError('could not update S3 lifecycle tags')
                    item = dict(row)
                    project_id = item.get('project_id')
                    result_url = f'/results/{safe_name}'
                    conn.execute(
                        "UPDATE exports SET deleted_at = NULL, deleted_by = NULL WHERE filename = ?",
                        (safe_name,),
                    )
                    conn.execute(
                        """
                        UPDATE pattern_variations SET deleted_at = NULL
                        WHERE project_id = ? AND (export_filename = ? OR image_url = ?)
                        """,
                        (project_id, safe_name, result_url),
                    )
                    conn.execute(
                        "UPDATE share_links SET revoked_at = NULL WHERE export_filename = ?",
                        (safe_name,),
                    )
                    if project_id is not None:
                        conn.execute(
                            """
                            UPDATE project_metrics
                            SET versions = (SELECT COUNT(*) FROM pattern_variations WHERE project_id = ? AND deleted_at IS NULL),
                                exports = (SELECT COUNT(*) FROM exports WHERE project_id = ? AND deleted_at IS NULL)
                            WHERE project_id = ?
                            """,
                            (project_id, project_id, project_id),
                        )
                    conn.execute("RELEASE SAVEPOINT restore_export")
                    restored.append(safe_name)
                    restored_metadata[safe_name] = item
                except Exception as exc:
                    conn.execute("ROLLBACK TO SAVEPOINT restore_export")
                    conn.execute("RELEASE SAVEPOINT restore_export")
                    if USE_S3 and tag_updated:
                        storage.update_object_tags('results', safe_name, {
                            'lifecycle': 'archived',
                            'deleted_at': row['deleted_at'],
                            'deleted_by': row['deleted_by'] or '',
                            'project_id': row['project_id'] or '',
                        })
                    errors.append(f'{safe_name}: {exc}')
            conn.commit()
        except Exception as exc:
            conn.rollback()
            if USE_S3:
                for restored_name, item in restored_metadata.items():
                    storage.update_object_tags('results', restored_name, {
                        'lifecycle': 'archived',
                        'deleted_at': item.get('deleted_at') or '',
                        'deleted_by': item.get('deleted_by') or '',
                        'project_id': item.get('project_id') or '',
                    })
            restored.clear()
            errors.append(f'DB Error: {exc}')
        finally:
            conn.close()
    return jsonify({'success': not errors, 'restored': restored, 'errors': errors}), (200 if restored else 404)
