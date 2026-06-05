"""Exports routes: download proxy, list exports, delete exports."""
import os
import json
from flask import Blueprint, request, jsonify, send_from_directory, Response

from config import UPLOAD_DIR, RESULTS_DIR
from db import db, db_lock, resolve_input_url, iso_to_epoch

bp = Blueprint('exports', __name__)

PREVIEWS_DIR = os.path.join(RESULTS_DIR, 'previews')


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
            directory = RESULTS_DIR if path.startswith('/results/') else UPLOAD_DIR
            return send_from_directory(directory, filename, as_attachment=True)

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
def list_exports():
    """
    Returns a list of all logged exports from the database,
    sorted by newest first. Includes resolved input urls, tools,
    settings, pipeline logs, file size, type, etc.
    """
    try:
        conn = db()
        # Retrieve all exports from SQLite database
        rows = conn.execute("SELECT * FROM exports ORDER BY created_at DESC").fetchall()
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
            
            files.append({
                'id': filename,
                'projectId': row['project_id'],
                'filename': filename,
                'imageUrl': f'/results/{filename}',
                'previewUrl': preview_url,
                'type': 'vector' if is_vector else 'image',
                'format': ext.upper(),
                'size': format_file_size(file_size),
                'sizeBytes': file_size,
                'timestamp': mtime,
                'createdAt': row['created_at'],
                'inputFilename': row['input_filename'],
                'inputUrl': resolve_input_url(row['input_filename']),
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
    
    with db_lock:
        conn = db()
        try:
            for filename in filenames:
                # Sanitize to avoid directory traversal
                safe_name = os.path.basename(filename)
                filepath = os.path.join(RESULTS_DIR, safe_name)
                
                db_exists = conn.execute("SELECT 1 FROM exports WHERE filename = ?", (safe_name,)).fetchone()
                disk_exists = os.path.isfile(filepath)
                
                if db_exists or disk_exists:
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
