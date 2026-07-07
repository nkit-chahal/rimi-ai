"""Exports routes: download proxy, list exports, delete exports."""
import os
import json
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
            rows = conn.execute("SELECT e.* FROM exports e ORDER BY e.created_at DESC").fetchall()
        elif is_admin and project_id:
            rows = conn.execute(
                "SELECT e.* FROM exports e WHERE e.project_id = ? ORDER BY e.created_at DESC",
                (project_id,),
            ).fetchall()
        elif project_id:
            rows = conn.execute(
                """
                SELECT e.*
                FROM exports e
                LEFT JOIN projects p ON p.id = e.project_id
                WHERE e.project_id = ?
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
                WHERE e.user_id = ? OR (e.user_id IS NULL AND p.user_id = ?)
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
    Deletes one or more export files from the results directory and the database.
    Expects JSON: { filenames: ['file1.png', 'file2.png'] }
    """
    data = request.get_json() or {}
    filenames = data.get('filenames', [])
    
    if not filenames:
        return jsonify({'error': 'No filenames provided'}), 400

    deleted = []
    errors = []
    current_user = g.current_user
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    
    with db_lock:
        conn = db()
        try:
            for filename in filenames:
                # Sanitize to avoid directory traversal
                safe_name = os.path.basename(filename)
                filepath = os.path.join(RESULTS_DIR, safe_name)
                
                if is_admin:
                    db_exists = conn.execute("SELECT 1 FROM exports WHERE filename = ?", (safe_name,)).fetchone()
                else:
                    db_exists = conn.execute(
                        """
                        SELECT 1
                        FROM exports e
                        LEFT JOIN projects p ON p.id = e.project_id
                        WHERE e.filename = ?
                          AND (e.user_id = ? OR (e.user_id IS NULL AND p.user_id = ?))
                        """,
                        (safe_name, user_id, user_id),
                    ).fetchone()
                disk_exists = os.path.isfile(filepath)
                
                if db_exists:
                    try:
                        if disk_exists:
                            os.remove(filepath)
                        # Also check if there is a preview cached, and delete it
                        preview_name = f"prev_{safe_name.rsplit('.', 1)[0]}.jpg"
                        preview_path = os.path.join(PREVIEWS_DIR, preview_name)
                        if os.path.isfile(preview_path):
                            os.remove(preview_path)
                            
                        conn.execute("DELETE FROM exports WHERE filename = ?", (safe_name,))
                        deleted.append(safe_name)
                        print(f"  [Exports] Deleted: {safe_name}")
                    except Exception as e:
                        errors.append(f"{safe_name}: {str(e)}")
                else:
                    errors.append(f"{safe_name}: not found")
            conn.commit()
        except Exception as e:
            errors.append(f"DB Error: {str(e)}")
        finally:
            conn.close()

    return jsonify({
        'success': True,
        'deleted': deleted,
        'errors': errors
    })
