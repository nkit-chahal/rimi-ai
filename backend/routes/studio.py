"""Studio state and project controls routes."""
import logging
import traceback

from flask import Blueprint, request, jsonify, g
from datetime import datetime, timezone

from db import db, db_lock, rows_to_dicts, time_ago
from middleware import login_required
from security_utils import issue_file_access_token

logger = logging.getLogger(__name__)

bp = Blueprint('studio', __name__)


def get_studio_state(project_id=1, user_id=None):
    from auth import expire_credits_if_needed

    if user_id is not None:
        expire_credits_if_needed(user_id)

    conn = db()
    if user_id is not None:
        user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    else:
        user_row = conn.execute("SELECT * FROM users WHERE role != 'admin' ORDER BY id LIMIT 1").fetchone()
        if not user_row:
            user_row = conn.execute("SELECT * FROM users ORDER BY id LIMIT 1").fetchone()

    if not user_row:
        user = {"id": 1, "email": "user@rim.ai", "name": "Default User", "initials": "DU",
                "role": "user", "plan": "Business Pro", "credits_used": 0, "credits_limit": 50000,
                "reset_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()}
    else:
        user = dict(user_row)

    projects = rows_to_dicts(conn.execute(
        "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
        (user["id"],)
    ).fetchall())
    if not projects:
        # Auto-create a default project for this user
        now_iso = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn.execute(
            "INSERT INTO projects (name, status, thumbnail_url, hero_image_url, updated_at, user_id) VALUES ('My First Project', 'Draft', '', '', ?, ?)",
            (now_iso, user["id"])
        )
        conn.commit()
        projects = rows_to_dicts(conn.execute(
            "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
            (user["id"],)
        ).fetchall())
    project_row = conn.execute("SELECT * FROM projects WHERE id = ? AND user_id = ?", (project_id, user["id"])).fetchone()
    project = dict(project_row) if project_row else projects[0]
    variations = rows_to_dicts(conn.execute(
        "SELECT * FROM pattern_variations WHERE project_id = ? AND deleted_at IS NULL ORDER BY id",
        (project["id"],),
    ).fetchall())
    metrics_row = conn.execute("SELECT * FROM project_metrics WHERE project_id = ?", (project["id"],)).fetchone()
    if not metrics_row:
        conn.execute("INSERT INTO project_metrics (project_id) VALUES (?)", (project["id"],))
        metrics_row = conn.execute("SELECT * FROM project_metrics WHERE project_id = ?", (project["id"],)).fetchone()
    metrics = dict(metrics_row)

    health_row = conn.execute("SELECT * FROM pattern_health WHERE project_id = ?", (project["id"],)).fetchone()
    if not health_row:
        conn.execute("INSERT INTO pattern_health (project_id, score, label, tile_seamless, color_balance, print_readiness, resolution, note) VALUES (?, 0, 'No Data', 0, 0, 0, 0, '')", (project["id"],))
        health_row = conn.execute("SELECT * FROM pattern_health WHERE project_id = ?", (project["id"],)).fetchone()
    health = dict(health_row)

    controls_row = conn.execute("SELECT * FROM project_controls WHERE project_id = ?", (project["id"],)).fetchone()
    if not controls_row:
        now_iso = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn.execute("INSERT INTO project_controls (project_id, grid_size, scale, rotation, repeat_type, color_cleanup, edge_match, background_clean, export_format, export_dpi, h_brush, v_brush, print_width, updated_at) VALUES (?, 2, 100, 0, 'block', 1, 1, 0, 'PNG', 300, 8, 8, 12, ?)", (project["id"], now_iso))
        controls_row = conn.execute("SELECT * FROM project_controls WHERE project_id = ?", (project["id"],)).fetchone()
    controls = dict(controls_row)
    suggestion = conn.execute("SELECT body FROM suggestions WHERE project_id = ? ORDER BY id DESC LIMIT 1", (project["id"],)).fetchone()
    conn.close()

    try:
        reset_at = datetime.fromisoformat(user["reset_at"])
        reset_days = max(0, (reset_at.date() - datetime.now(timezone.utc).replace(tzinfo=None).date()).days)
    except Exception:
        reset_days = 60

    from plan_tiers import attach_tier_fields
    user_payload = attach_tier_fields({
        "id": user["id"], "email": user.get("email", ""), "role": user.get("role", "user"),
        "name": user["name"], "initials": user["initials"], "plan": user["plan"],
        "creditsUsed": user["credits_used"], "creditsLimit": user["credits_limit"], "resetDays": reset_days,
    })
    return {
        "user": user_payload,
        "activeProject": {
            "id": project["id"], "name": project["name"], "status": project["status"],
            "thumbnailUrl": project["thumbnail_url"], "heroImageUrl": project["hero_image_url"],
            "updatedAt": project["updated_at"], "updatedLabel": time_ago(project["updated_at"]),
        },
        "projects": [{"id": p["id"], "name": p["name"], "status": p["status"], "thumbnailUrl": p["thumbnail_url"],
                       "heroImageUrl": p["hero_image_url"], "updatedAt": p["updated_at"],
                       "updatedLabel": time_ago(p["updated_at"])} for p in projects],
        "variations": [{
            "id": v["id"], "name": v["name"], "imageUrl": v["image_url"],
            "isSelected": bool(v["is_selected"]),
            "fileAccessToken": (
                issue_file_access_token(v["export_filename"], user_id)
                if user_id and v.get("export_filename")
                else None
            ),
        } for v in variations],
        "metrics": {"versions": metrics["versions"], "versionsDelta": metrics["versions_delta"],
                    "exports": metrics["exports"], "exportsDelta": metrics["exports_delta"],
                    "aiGenerations": metrics["ai_generations"], "aiGenerationsDelta": metrics["ai_generations_delta"],
                    "creditsUsed": metrics["credits_used"], "creditsDelta": metrics["credits_delta"]},
        "health": {"score": health["score"], "label": health["label"],
                   "tileSeamless": bool(health["tile_seamless"]), "colorBalance": bool(health["color_balance"]),
                   "printReadiness": bool(health["print_readiness"]), "resolution": bool(health["resolution"]),
                   "note": health["note"]},
        "controls": {"gridSize": controls["grid_size"], "scale": controls["scale"],
                     "rotation": controls["rotation"], "repeatType": controls["repeat_type"],
                     "colorCleanup": bool(controls["color_cleanup"]), "edgeMatch": bool(controls["edge_match"]),
                     "backgroundClean": bool(controls["background_clean"]),
                     "exportFormat": controls["export_format"], "exportDpi": controls["export_dpi"],
                     "hBrush": controls["h_brush"], "vBrush": controls["v_brush"],
                     "printWidth": controls["print_width"],
                     "printHeight": controls.get("print_height", controls["print_width"]),
                     "fabricWidth": controls.get("fabric_width", 54)},
        "suggestion": suggestion["body"] if suggestion else None,
    }


@bp.route('/api/studio-state')
@login_required
def studio_state():
    try:
        project_id = int(request.args.get('projectId', 1))
        user_id = g.current_user["id"]
        return jsonify({'success': True, 'state': get_studio_state(project_id, user_id)})
    except Exception as exc:
        logger.error("studio-state failed for user %s project %s: %s",
                     getattr(g, 'current_user', {}).get('id'), request.args.get('projectId'), exc)
        traceback.print_exc()
        return jsonify({'success': False, 'error': 'Failed to load workspace. Please try again.'}), 500


@bp.route('/api/projects/<int:project_id>/controls', methods=['PATCH'])
@login_required
def update_project_controls(project_id):
    data = request.get_json() or {}
    allowed = {
        "gridSize": ("grid_size", int), "scale": ("scale", int), "rotation": ("rotation", int),
        "repeatType": ("repeat_type", str),
        "colorCleanup": ("color_cleanup", lambda v: 1 if v else 0),
        "edgeMatch": ("edge_match", lambda v: 1 if v else 0),
        "backgroundClean": ("background_clean", lambda v: 1 if v else 0),
        "exportFormat": ("export_format", str), "exportDpi": ("export_dpi", int),
        "hBrush": ("h_brush", int), "vBrush": ("v_brush", int), "printWidth": ("print_width", int),
        "printHeight": ("print_height", int), "fabricWidth": ("fabric_width", int),
    }

    updates = []
    values = []
    for key, (column, caster) in allowed.items():
        if key in data:
            updates.append(f"{column} = ?")
            values.append(caster(data[key]))

    user_id = g.current_user["id"]

    conn = db()
    project = conn.execute("SELECT id FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id)).fetchone()
    conn.close()
    if not project:
        return jsonify({'success': False, 'error': 'Project not found'}), 404

    if updates:
        updates.append("updated_at = ?")
        values.append(datetime.now(timezone.utc).replace(tzinfo=None).isoformat())
        values.append(project_id)

        conn = db()
        cur = conn.execute(f"UPDATE project_controls SET {', '.join(updates)} WHERE project_id = ?", values)
        if cur.rowcount == 0:
            now_iso = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            conn.execute(
                "INSERT INTO project_controls (project_id, grid_size, scale, rotation, repeat_type, color_cleanup, edge_match, background_clean, export_format, export_dpi, h_brush, v_brush, print_width, updated_at) VALUES (?, 2, 100, 0, 'block', 1, 1, 0, 'PNG', 300, 8, 8, 12, ?)",
                (project_id, now_iso)
            )
            conn.execute(f"UPDATE project_controls SET {', '.join(updates)} WHERE project_id = ?", values)
        conn.commit()
        conn.close()

    state = get_studio_state(project_id, user_id)
    return jsonify({'success': True, 'state': {'controls': state['controls']}})
