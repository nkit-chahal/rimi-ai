"""Upload and static file serving routes."""
import os
import uuid
from flask import Blueprint, request, jsonify, send_from_directory, Response, abort, g
from middleware import login_required

from config import UPLOAD_DIR, RESULTS_DIR, allowed_file, USE_S3
import storage

bp = Blueprint('upload', __name__)


@bp.route('/api/upload', methods=['POST'])
@login_required
def upload_image():
    if 'image' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Supported: JPG, PNG, WEBP'}), 400

    ext = file.filename.rsplit('.', 1)[1].lower()
    unique_name = f"{uuid.uuid4().hex}.{ext}"

    # Save locally first (needed for processing)
    filepath = os.path.join(UPLOAD_DIR, unique_name)
    file.save(filepath)

    # Also upload to S3 if configured
    if USE_S3:
        storage.save_local_file_to_storage('uploads', unique_name)

    return jsonify({
        'success': True,
        'filename': unique_name,
        'fileUrl': f'/uploads/{unique_name}',
        'originalName': file.filename
    })


@bp.route('/uploads/<filename>')
def serve_upload(filename):
    # Try local first, then S3
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
    previews_dir = os.path.join(RESULTS_DIR, 'previews')
    local_path = os.path.join(previews_dir, filename)
    if os.path.exists(local_path):
        return send_from_directory(previews_dir, filename)
    if USE_S3:
        data, ct = storage.get_file('results', f'previews/{filename}')
        if data:
            return Response(data, mimetype=ct)
    abort(404)
