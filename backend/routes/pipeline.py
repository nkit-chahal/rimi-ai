"""Pipeline runs and saved workflows routes."""
import json
from flask import Blueprint, request, jsonify, g
from datetime import datetime, timezone

from db import db, rows_to_dicts
from auth import log_export
from middleware import login_required

bp = Blueprint('pipeline', __name__)


# --------------- Pipeline Runs ---------------
@bp.route('/api/pipeline-runs', methods=['POST'])
def create_pipeline_run():
    """Create a new pipeline run record (status=running)."""
    data = request.get_json()
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conn = db()
    cur = conn.execute(
        "INSERT INTO pipeline_runs (project_id, name, steps_json, settings_json, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)",
        (data.get('projectId', 1), data.get('name', 'Custom Pipeline'),
         json.dumps(data.get('steps', [])), json.dumps(data.get('settings', {})), now)
    )
    run_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'runId': run_id})


@bp.route('/api/pipeline-runs/<int:run_id>', methods=['PATCH'])
def update_pipeline_run(run_id):
    """Update a pipeline run's status and results."""
    data = request.get_json() or {}
    conn = db()
    
    # Fetch run details before updating
    run = conn.execute("SELECT * FROM pipeline_runs WHERE id = ?", (run_id,)).fetchone()
    
    sets = []
    vals = []
    if 'status' in data:
        sets.append('status = ?')
        vals.append(data['status'])
    if 'results' in data:
        sets.append('results_json = ?')
        vals.append(json.dumps(data['results']))
    if data.get('status') in ('completed', 'failed'):
        sets.append('completed_at = ?')
        vals.append(datetime.now(timezone.utc).replace(tzinfo=None).isoformat())
    if sets:
        vals.append(run_id)
        conn.execute(f"UPDATE pipeline_runs SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()
    conn.close()
    
    # If run has successfully completed, capture the final output and initial input, plus full pipeline steps logs
    if run and data.get('status') == 'completed':
        project_id = run['project_id']
        
        # Extract initial input from settings or steps
        initial_input = None
        try:
            settings_dict = json.loads(run['settings_json'])
            initial_input = settings_dict.get('inputImage') or settings_dict.get('filename') or settings_dict.get('imageUrl')
        except Exception:
            pass
            
        if not initial_input:
            try:
                steps_list = json.loads(run['steps_json'])
                if steps_list and len(steps_list) > 0:
                    initial_input = steps_list[0].get('inputImage') or steps_list[0].get('filename')
            except Exception:
                pass
                
        # Extract final output from results
        final_output = None
        results_list = data.get('results') or []
        if results_list:
            last_result = results_list[-1]
            if isinstance(last_result, dict):
                final_output = last_result.get('url') or last_result.get('resultUrl') or last_result.get('mockupUrl')
            elif isinstance(last_result, str):
                final_output = last_result
                
        if final_output:
            final_filename = final_output.split('/')[-1] if '/' in final_output else final_output
            input_fn = initial_input.split('/')[-1] if (initial_input and '/' in initial_input) else initial_input
            
            settings_dict = {}
            try:
                settings_dict = json.loads(run['settings_json'])
            except Exception:
                pass
                
            steps_list = []
            try:
                steps_list = json.loads(run['steps_json'])
            except Exception:
                pass
                
            log_export(
                project_id=project_id,
                filename=final_filename,
                input_filename=input_fn,
                tool_type="Pipeline",
                settings_dict=settings_dict,
                pipeline_run_id=run_id,
                pipeline_steps_list=steps_list
            )
            
    return jsonify({'success': True})


@bp.route('/api/pipeline-runs')
@login_required
def list_pipeline_runs():
    """List recent pipeline runs (newest first, max 20). Optionally filter by project_id."""
    project_id = request.args.get('project_id')
    current_user = g.current_user
    user_id = current_user["id"]
    is_admin = current_user.get("role") == "admin"
    conn = db()
    if is_admin and project_id:
        rows = conn.execute(
            "SELECT * FROM pipeline_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 20",
            (project_id,)
        ).fetchall()
    elif is_admin:
        rows = conn.execute(
            "SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT 20"
        ).fetchall()
    elif project_id:
        rows = conn.execute(
            """
            SELECT pr.*
            FROM pipeline_runs pr
            JOIN projects p ON p.id = pr.project_id
            WHERE pr.project_id = ? AND p.user_id = ?
            ORDER BY pr.created_at DESC LIMIT 20
            """,
            (project_id, user_id),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT pr.*
            FROM pipeline_runs pr
            JOIN projects p ON p.id = pr.project_id
            WHERE p.user_id = ?
            ORDER BY pr.created_at DESC LIMIT 20
            """,
            (user_id,),
        ).fetchall()
    conn.close()
    runs = []
    for r in rows_to_dicts(rows):
        runs.append({
            'id': r['id'],
            'name': r['name'],
            'status': r['status'],
            'steps': json.loads(r['steps_json']),
            'results': json.loads(r['results_json']) if r['results_json'] else [],
            'createdAt': r['created_at'],
            'completedAt': r.get('completed_at'),
        })
    return jsonify({'success': True, 'runs': runs})


# --------------- Saved Workflows ---------------
@bp.route('/api/workflows', methods=['POST'])
def save_workflow():
    """Save a workflow configuration."""
    data = request.get_json()
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conn = db()
    cur = conn.execute(
        "INSERT INTO saved_workflows (name, steps_json, settings_json, created_at) VALUES (?, ?, ?, ?)",
        (data.get('name', 'My Workflow'), json.dumps(data.get('steps', [])),
         json.dumps(data.get('settings', {})), now)
    )
    wf_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'workflowId': wf_id})


@bp.route('/api/workflows')
def list_workflows():
    """List all saved workflows."""
    conn = db()
    rows = conn.execute("SELECT * FROM saved_workflows ORDER BY created_at DESC").fetchall()
    conn.close()
    workflows = []
    for r in rows_to_dicts(rows):
        workflows.append({
            'id': r['id'],
            'name': r['name'],
            'steps': json.loads(r['steps_json']),
            'settings': json.loads(r['settings_json']),
            'createdAt': r['created_at'],
        })
    return jsonify({'success': True, 'workflows': workflows})


@bp.route('/api/workflows/<int:wf_id>', methods=['DELETE'])
def delete_workflow(wf_id):
    """Delete a saved workflow."""
    conn = db()
    conn.execute("DELETE FROM saved_workflows WHERE id = ?", (wf_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})
