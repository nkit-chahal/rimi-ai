"""Upload and static file serving routes."""
import os
import uuid
from flask import Blueprint, request, jsonify, send_from_directory

from config import UPLOAD_DIR, RESULTS_DIR, allowed_file

bp = Blueprint('upload', __name__)


@bp.route('/api/upload', methods=['POST'])
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
    filepath = os.path.join(UPLOAD_DIR, unique_name)
    file.save(filepath)

    return jsonify({
        'success': True,
        'filename': unique_name,
        'fileUrl': f'/uploads/{unique_name}',
        'originalName': file.filename
    })


@bp.route('/uploads/<filename>')
def serve_upload(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@bp.route('/results/<filename>')
def serve_result(filename):
    mimetype = 'image/svg+xml' if filename.endswith('.svg') else None
    return send_from_directory(RESULTS_DIR, filename, mimetype=mimetype)


@bp.route('/results/previews/<filename>')
def serve_preview(filename):
    previews_dir = os.path.join(RESULTS_DIR, 'previews')
    return send_from_directory(previews_dir, filename)
