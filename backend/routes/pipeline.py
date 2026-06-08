"""Pipeline runs and saved workflows routes."""
import json
from flask import Blueprint, request, jsonify, g
from datetime import datetime, timezone

from db import db, rows_to_dicts
from auth import log_export
from middleware import login_required

bp = Blueprint('pipeline', __name__)


def _now_iso():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


# --------------- Pipeline Runs ---------------
@bp.route('/api/pipeline-runs', methods=['POST'])
@login_required
def create_pipeline_run():
    """Create a new pipeline run record (status=running)."""
    data = request.get_json() or {}
    now = _now_iso()
    graph = data.get('graph')
    conn = db()
    cur = conn.execute(
        "INSERT INTO pipeline_runs (project_id, name, steps_json, settings_json, graph_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'running', ?)",
        (
            data.get('projectId', 1),
            data.get('name', 'Custom Pipeline'),
            json.dumps(data.get('steps', [])),
            json.dumps(data.get('settings', {})),
            json.dumps(graph) if graph else None,
            now,
        ),
    )
    run_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'runId': run_id})


@bp.route('/api/pipeline-runs/<int:run_id>', methods=['PATCH'])
@login_required
def update_pipeline_run(run_id):
    """Update a pipeline run's status and results."""
    data = request.get_json() or {}
    conn = db()

    run = conn.execute("SELECT * FROM pipeline_runs WHERE id = ?", (run_id,)).fetchone()

    sets = []
    vals = []
    if 'status' in data:
        sets.append('status = ?')
        vals.append(data['status'])
    if 'results' in data:
        sets.append('results_json = ?')
        vals.append(json.dumps(data['results']))
    if 'graph' in data:
        sets.append('graph_json = ?')
        vals.append(json.dumps(data['graph']))
    if data.get('status') in ('completed', 'failed'):
        sets.append('completed_at = ?')
        vals.append(_now_iso())
    if sets:
        vals.append(run_id)
        conn.execute(f"UPDATE pipeline_runs SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()
    conn.close()

    if run and data.get('status') == 'completed':
        project_id = run['project_id']

        initial_input = None
        try:
            settings_dict = json.loads(run['settings_json'])
            initial_input = settings_dict.get('inputImage') or settings_dict.get('filename') or settings_dict.get('imageUrl')
        except Exception:
            pass

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
                pipeline_steps_list=steps_list,
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
            (project_id,),
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
        graph = None
        if r.get('graph_json'):
            try:
                graph = json.loads(r['graph_json'])
            except Exception:
                graph = None
        runs.append({
            'id': r['id'],
            'name': r['name'],
            'status': r['status'],
            'steps': json.loads(r['steps_json']),
            'results': json.loads(r['results_json']) if r['results_json'] else [],
            'graph': graph,
            'createdAt': r['created_at'],
            'completedAt': r.get('completed_at'),
        })
    return jsonify({'success': True, 'runs': runs})


# --------------- Saved Workflows ---------------
@bp.route('/api/workflows', methods=['POST'])
@login_required
def save_workflow():
    """Save a workflow configuration."""
    data = request.get_json() or {}
    now = _now_iso()
    graph = data.get('graph')
    conn = db()
    cur = conn.execute(
        "INSERT INTO saved_workflows (name, steps_json, settings_json, graph_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (
            data.get('name', 'My Workflow'),
            json.dumps(data.get('steps', [])),
            json.dumps(data.get('settings', {})),
            json.dumps(graph) if graph else None,
            now,
            now,
        ),
    )
    wf_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'workflowId': wf_id})


@bp.route('/api/workflows/<int:wf_id>', methods=['PATCH'])
@login_required
def update_workflow(wf_id):
    """Update an existing saved workflow."""
    data = request.get_json() or {}
    now = _now_iso()
    conn = db()
    sets = ['updated_at = ?']
    vals = [now]
    if 'name' in data:
        sets.append('name = ?')
        vals.append(data['name'])
    if 'steps' in data:
        sets.append('steps_json = ?')
        vals.append(json.dumps(data['steps']))
    if 'settings' in data:
        sets.append('settings_json = ?')
        vals.append(json.dumps(data['settings']))
    if 'graph' in data:
        sets.append('graph_json = ?')
        vals.append(json.dumps(data['graph']))
    vals.append(wf_id)
    conn.execute(f"UPDATE saved_workflows SET {', '.join(sets)} WHERE id = ?", vals)
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@bp.route('/api/workflows')
@login_required
def list_workflows():
    """List all saved workflows."""
    conn = db()
    rows = conn.execute(
        "SELECT * FROM saved_workflows ORDER BY COALESCE(updated_at, created_at) DESC"
    ).fetchall()
    conn.close()
    workflows = []
    for r in rows_to_dicts(rows):
        graph = None
        if r.get('graph_json'):
            try:
                graph = json.loads(r['graph_json'])
            except Exception:
                graph = None
        workflows.append({
            'id': r['id'],
            'name': r['name'],
            'steps': json.loads(r['steps_json']),
            'settings': json.loads(r['settings_json']),
            'graph': graph,
            'createdAt': r['created_at'],
            'updatedAt': r.get('updated_at') or r['created_at'],
        })
    return jsonify({'success': True, 'workflows': workflows})


@bp.route('/api/workflows/<int:wf_id>', methods=['DELETE'])
@login_required
def delete_workflow(wf_id):
    """Delete a saved workflow."""
    conn = db()
    conn.execute("DELETE FROM saved_workflows WHERE id = ?", (wf_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})
