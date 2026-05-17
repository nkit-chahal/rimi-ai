import json
import sqlite3
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), 'rimi_ai.sqlite3')

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def rows_to_dicts(rows):
    return [dict(row) for row in rows]

def init_db():
    conn = db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            initials TEXT NOT NULL,
            plan TEXT NOT NULL,
            credits_used INTEGER NOT NULL DEFAULT 0,
            credits_limit INTEGER NOT NULL DEFAULT 20000,
            reset_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            thumbnail_url TEXT NOT NULL,
            hero_image_url TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pattern_variations (
            id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            image_url TEXT NOT NULL,
            is_selected INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS project_metrics (
            project_id INTEGER PRIMARY KEY,
            versions INTEGER NOT NULL DEFAULT 0,
            versions_delta INTEGER NOT NULL DEFAULT 0,
            exports INTEGER NOT NULL DEFAULT 0,
            exports_delta INTEGER NOT NULL DEFAULT 0,
            ai_generations INTEGER NOT NULL DEFAULT 0,
            ai_generations_delta INTEGER NOT NULL DEFAULT 0,
            credits_used INTEGER NOT NULL DEFAULT 0,
            credits_delta INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS pattern_health (
            project_id INTEGER PRIMARY KEY,
            score INTEGER NOT NULL,
            label TEXT NOT NULL,
            tile_seamless INTEGER NOT NULL,
            color_balance INTEGER NOT NULL,
            print_readiness INTEGER NOT NULL,
            resolution INTEGER NOT NULL,
            note TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS project_controls (
            project_id INTEGER PRIMARY KEY,
            grid_size INTEGER NOT NULL DEFAULT 2,
            scale INTEGER NOT NULL DEFAULT 100,
            rotation INTEGER NOT NULL DEFAULT 0,
            repeat_type TEXT NOT NULL DEFAULT 'block',
            color_cleanup INTEGER NOT NULL DEFAULT 1,
            edge_match INTEGER NOT NULL DEFAULT 1,
            background_clean INTEGER NOT NULL DEFAULT 0,
            export_format TEXT NOT NULL DEFAULT 'PNG',
            export_dpi INTEGER NOT NULL DEFAULT 300,
            h_brush INTEGER NOT NULL DEFAULT 8,
            v_brush INTEGER NOT NULL DEFAULT 8,
            print_width INTEGER NOT NULL DEFAULT 12,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS suggestions (
            id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
    """)
    project_count = conn.execute("SELECT COUNT(*) AS c FROM projects").fetchone()["c"]
    if project_count == 0:
        now = datetime.utcnow()
        reset_at = now + timedelta(days=12)
        conn.execute(
            "INSERT INTO users (id, name, initials, plan, credits_used, credits_limit, reset_at) VALUES (1, ?, ?, ?, ?, ?, ?)",
            ("Olivia Carter", "OC", "Pro Plan", 8450, 20000, reset_at.isoformat()),
        )
        project_rows = [
            (1, "Spring Bloom Collection", "In Progress", "/demo_floral.png", "/demo_floral.png", now - timedelta(hours=2)),
            (2, "Botanical Dreams", "Completed", "/demo_botanical.png", "/demo_botanical.png", now - timedelta(days=1)),
            (3, "Heritage Archive", "Draft", "/demo_geometric.png", "/demo_geometric.png", now - timedelta(days=3)),
        ]
        conn.executemany(
            "INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [(pid, name, status, thumb, hero, ts.isoformat()) for pid, name, status, thumb, hero, ts in project_rows],
        )
        variations = [
            ("Original", "/demo_floral.png", 1),
            ("Dusty Blue", "/demo_botanical.png", 0),
            ("Sage Green", "/demo_geometric.png", 0),
            ("Blush Pink", "/demo_floral.png", 0),
            ("Midnight", "/demo_botanical.png", 0),
            ("Warm Neutral", "/demo_geometric.png", 0),
        ]
        conn.executemany(
            "INSERT INTO pattern_variations (project_id, name, image_url, is_selected, created_at) VALUES (1, ?, ?, ?, ?)",
            [(name, url, selected, now.isoformat()) for name, url, selected in variations],
        )
        conn.execute(
            "INSERT INTO project_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (1, 24, 12, 18, 8, 52, 24, 1250, 15),
        )
        conn.execute(
            "INSERT INTO pattern_health VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (1, 92, "Excellent", 1, 1, 1, 1, "Great job. Your pattern is print-ready."),
        )
        conn.execute(
            "INSERT INTO project_controls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (1, 2, 100, 0, "block", 1, 1, 0, "PNG", 300, 8, 8, 12, now.isoformat()),
        )
        conn.execute(
            "INSERT INTO suggestions (project_id, body, created_at) VALUES (?, ?, ?)",
            (1, "Try increasing contrast in the floral elements for better print definition.", now.isoformat()),
        )
        conn.commit()
    conn.close()

def time_ago(iso_value):
    try:
        then = datetime.fromisoformat(iso_value)
    except ValueError:
        return "Updated recently"
    delta = datetime.utcnow() - then
    if delta.days >= 1:
        return f"Updated {delta.days} day{'s' if delta.days != 1 else ''} ago"
    hours = max(1, int(delta.total_seconds() // 3600))
    return f"Updated {hours}h ago"

def get_studio_state(project_id=1):
    conn = db()
    user = dict(conn.execute("SELECT * FROM users WHERE id = 1").fetchone())
    projects = rows_to_dicts(conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall())
    project = dict(conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone() or projects[0])
    variations = rows_to_dicts(conn.execute("SELECT * FROM pattern_variations WHERE project_id = ? ORDER BY id", (project["id"],)).fetchall())
    metrics = dict(conn.execute("SELECT * FROM project_metrics WHERE project_id = ?", (project["id"],)).fetchone())
    health = dict(conn.execute("SELECT * FROM pattern_health WHERE project_id = ?", (project["id"],)).fetchone())
    controls = dict(conn.execute("SELECT * FROM project_controls WHERE project_id = ?", (project["id"],)).fetchone())
    suggestion = conn.execute("SELECT body FROM suggestions WHERE project_id = ? ORDER BY id DESC LIMIT 1", (project["id"],)).fetchone()
    conn.close()

    reset_at = datetime.fromisoformat(user["reset_at"])
    reset_days = max(0, (reset_at.date() - datetime.utcnow().date()).days)

    user_payload = {
        "name": user["name"],
        "initials": user["initials"],
        "plan": user["plan"],
        "creditsUsed": user["credits_used"],
        "creditsLimit": user["credits_limit"],
        "resetDays": reset_days,
    }
    return {
        "user": user_payload,
        "activeProject": {
            "id": project["id"],
            "name": project["name"],
            "status": project["status"],
            "thumbnailUrl": project["thumbnail_url"],
            "heroImageUrl": project["hero_image_url"],
            "updatedAt": project["updated_at"],
            "updatedLabel": time_ago(project["updated_at"]),
        },
        "projects": [
            {
                "id": p["id"],
                "name": p["name"],
                "status": p["status"],
                "thumbnailUrl": p["thumbnail_url"],
                "heroImageUrl": p["hero_image_url"],
                "updatedAt": p["updated_at"],
                "updatedLabel": time_ago(p["updated_at"]),
            }
            for p in projects
        ],
        "variations": [
            {"id": v["id"], "name": v["name"], "imageUrl": v["image_url"], "isSelected": bool(v["is_selected"])}
            for v in variations
        ],
        "metrics": {
            "versions": metrics["versions"],
            "versionsDelta": metrics["versions_delta"],
            "exports": metrics["exports"],
            "exportsDelta": metrics["exports_delta"],
            "aiGenerations": metrics["ai_generations"],
            "aiGenerationsDelta": metrics["ai_generations_delta"],
            "creditsUsed": metrics["credits_used"],
            "creditsDelta": metrics["credits_delta"],
        },
        "health": {
            "score": health["score"],
            "label": health["label"],
            "tileSeamless": bool(health["tile_seamless"]),
            "colorBalance": bool(health["color_balance"]),
            "printReadiness": bool(health["print_readiness"]),
            "resolution": bool(health["resolution"]),
            "note": health["note"],
        },
        "controls": {
            "gridSize": controls["grid_size"],
            "scale": controls["scale"],
            "rotation": controls["rotation"],
            "repeatType": controls["repeat_type"],
            "colorCleanup": bool(controls["color_cleanup"]),
            "edgeMatch": bool(controls["edge_match"]),
            "backgroundClean": bool(controls["background_clean"]),
            "exportFormat": controls["export_format"],
            "exportDpi": controls["export_dpi"],
            "hBrush": controls["h_brush"],
            "vBrush": controls["v_brush"],
            "printWidth": controls["print_width"],
        },
        "suggestion": suggestion["body"] if suggestion else None,
    }

init_db()

@app.route('/api/studio-state')
def studio_state():
    project_id = int(request.args.get('projectId', 1))
    return jsonify({'success': True, 'state': get_studio_state(project_id)})

@app.route('/api/projects/<int:project_id>/controls', methods=['PATCH'])
def update_project_controls(project_id):
    data = request.get_json() or {}
    allowed = {
        "gridSize": ("grid_size", int),
        "scale": ("scale", int),
        "rotation": ("rotation", int),
        "repeatType": ("repeat_type", str),
        "colorCleanup": ("color_cleanup", lambda v: 1 if v else 0),
        "edgeMatch": ("edge_match", lambda v: 1 if v else 0),
        "backgroundClean": ("background_clean", lambda v: 1 if v else 0),
        "exportFormat": ("export_format", str),
        "exportDpi": ("export_dpi", int),
        "hBrush": ("h_brush", int),
        "vBrush": ("v_brush", int),
        "printWidth": ("print_width", int),
    }

    updates = []
    values = []
    for key, (column, caster) in allowed.items():
        if key in data:
            updates.append(f"{column} = ?")
            values.append(caster(data[key]))

    if updates:
        updates.append("updated_at = ?")
        values.append(datetime.utcnow().isoformat())
        values.append(project_id)

        conn = db()
        conn.execute(f"UPDATE project_controls SET {', '.join(updates)} WHERE project_id = ?", values)
        conn.commit()
        conn.close()

    return jsonify({'success': True, 'state': get_studio_state(project_id)})

def record_export(project_id, credits=50):
    now = datetime.utcnow().isoformat()
    conn = db()
    conn.execute(
        """
        UPDATE project_metrics
        SET exports = exports + 1,
            exports_delta = exports_delta + 1,
            credits_used = credits_used + ?,
            credits_delta = credits_delta + ?
        WHERE project_id = ?
        """,
        (credits, credits, project_id),
    )
    conn.execute("UPDATE users SET credits_used = credits_used + ? WHERE id = 1", (credits,))
    conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    conn.commit()
    conn.close()

# --------------- Upload Endpoint ---------------
