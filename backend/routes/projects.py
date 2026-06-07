"""Projects CRUD routes."""
import os
import json
from flask import Blueprint, request, jsonify, g
from datetime import datetime, timezone

from config import UPLOAD_DIR, RESULTS_DIR
from db import db
from middleware import login_required

bp = Blueprint('projects', __name__)


# --------------- Projects CRUD ---------------
@bp.route('/api/projects', methods=['POST'])
@login_required
def create_project():
    data = request.get_json() or {}
    name = data.get('name', 'New Project')
    user_id = g.current_user['id']
    conn = db()
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    cur = conn.execute(
        "INSERT INTO projects (name, status, thumbnail_url, hero_image_url, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)",
        (name, "Draft", "/demo_geometric.png", "/demo_geometric.png", now, user_id)
    )
    project_id = cur.lastrowid
    conn.execute("INSERT INTO project_metrics (project_id) VALUES (?)", (project_id,))
    conn.execute("INSERT INTO pattern_health (project_id, score, label, tile_seamless, color_balance, print_readiness, resolution, note) VALUES (?, 0, 'No Data', 0, 0, 0, 0, '')", (project_id,))
    conn.execute("INSERT INTO project_controls (project_id, updated_at) VALUES (?, ?)", (project_id, now))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'projectId': project_id})


@bp.route('/api/projects/<int:project_id>', methods=['PUT'])
@login_required
def update_project(project_id):
    data = request.get_json() or {}
    user_id = g.current_user['id']
    conn = db()

    # Verify ownership
    project = conn.execute("SELECT id FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id)).fetchone()
    if not project:
        conn.close()
        return jsonify({'success': False, 'error': 'Project not found'}), 404

    sets = []
    vals = []
    if 'name' in data and data['name']:
        sets.append('name = ?')
        vals.append(data['name'])
    if 'thumbnail_url' in data:
        sets.append('thumbnail_url = ?')
        vals.append(data['thumbnail_url'])
        sets.append('hero_image_url = ?')
        vals.append(data['thumbnail_url'])
        
    if sets:
        sets.append('updated_at = ?')
        vals.append(datetime.now(timezone.utc).replace(tzinfo=None).isoformat())
        vals.append(project_id)
        conn.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()
    conn.close()
    return jsonify({'success': True})


@bp.route('/api/projects/<int:project_id>', methods=['DELETE'])
@login_required
def delete_project(project_id):
    user_id = g.current_user['id']
    conn = db()

    # Verify ownership
    project = conn.execute("SELECT id FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id)).fetchone()
    if not project:
        conn.close()
        return jsonify({'success': False, 'error': 'Project not found'}), 404
    
    # 1. Collect all associated file URLs
    files_to_delete = set()
    
    proj = conn.execute("SELECT thumbnail_url, hero_image_url FROM projects WHERE id = ?", (project_id,)).fetchone()
    if proj:
        files_to_delete.add(proj['thumbnail_url'])
        files_to_delete.add(proj['hero_image_url'])
        
    vars_rows = conn.execute("SELECT image_url FROM pattern_variations WHERE project_id = ?", (project_id,)).fetchall()
    for v in vars_rows: files_to_delete.add(v['image_url'])
        
    runs_rows = conn.execute("SELECT results_json FROM pipeline_runs WHERE project_id = ?", (project_id,)).fetchall()
    for r in runs_rows:
        if r['results_json']:
            try:
                results = json.loads(r['results_json'])
                for url in results: files_to_delete.add(url)
            except: pass

    # 2. Delete physical files from disk
    for url in files_to_delete:
        if not url: continue
        if url.startswith('/uploads/'):
            path = os.path.join(UPLOAD_DIR, os.path.basename(url))
            if os.path.exists(path): os.remove(path)
        elif url.startswith('/results/'):
            path = os.path.join(RESULTS_DIR, os.path.basename(url))
            if os.path.exists(path): os.remove(path)

    # 3. Database Cascade Delete
    conn.execute("DELETE FROM pattern_variations WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM project_metrics WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM pattern_health WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM project_controls WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM suggestions WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM pipeline_runs WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM exports WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})
