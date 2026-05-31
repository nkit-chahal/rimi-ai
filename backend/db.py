"""
Database connection, schema initialization, and shared DB helpers.
Extracted from server.py to be importable by all route modules.
"""
import os
import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

from config import DB_PATH, UPLOAD_DIR, RESULTS_DIR

db_lock = threading.Lock()


def db():
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


def resolve_input_url(input_filename):
    if not input_filename:
        return None
    if input_filename.startswith('http://') or input_filename.startswith('https://') or input_filename.startswith('/'):
        return input_filename
    
    if os.path.exists(os.path.join(UPLOAD_DIR, input_filename)):
        return f"/uploads/{input_filename}"
    if os.path.exists(os.path.join(RESULTS_DIR, input_filename)):
        return f"/results/{input_filename}"
    
    PUBLIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
    if os.path.exists(os.path.join(PUBLIC_DIR, input_filename)):
        return f"/{input_filename}"
    return f"/uploads/{input_filename}"


def iso_to_epoch(iso_str):
    try:
        return datetime.fromisoformat(iso_str).timestamp()
    except Exception:
        return 0.0


def time_ago(iso_value):
    try:
        then = datetime.fromisoformat(iso_value)
    except ValueError:
        return "Updated recently"
    delta = datetime.now(timezone.utc).replace(tzinfo=None) - then
    if delta.days >= 1:
        return f"Updated {delta.days} day{'s' if delta.days != 1 else ''} ago"
    hours = max(1, int(delta.total_seconds() // 3600))
    return f"Updated {hours}h ago"


def init_db():
    conn = db()
    
    # Auto-migration of users table
    try:
        conn.execute("SELECT email FROM users LIMIT 1")
    except sqlite3.OperationalError:
        try:
            conn.execute("DROP TABLE IF EXISTS users")
            conn.commit()
            print("Dropped old users table for migration.")
        except Exception as e:
            print(f"Error dropping users table: {e}")
            
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            initials TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            plan TEXT NOT NULL,
            credits_used INTEGER NOT NULL DEFAULT 0,
            credits_limit INTEGER NOT NULL DEFAULT 50000,
            reset_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS replicate_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            model_name TEXT NOT NULL,
            duration REAL NOT NULL,
            credits INTEGER NOT NULL,
            cost_usd REAL NOT NULL,
            created_at TEXT NOT NULL
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
        CREATE TABLE IF NOT EXISTS pipeline_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            name TEXT NOT NULL DEFAULT 'Custom Pipeline',
            steps_json TEXT NOT NULL,
            settings_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            results_json TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS saved_workflows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            steps_json TEXT NOT NULL,
            settings_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            filename TEXT NOT NULL UNIQUE,
            input_filename TEXT,
            tool_type TEXT NOT NULL,
            settings_json TEXT DEFAULT '{}',
            pipeline_run_id INTEGER,
            pipeline_steps_json TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS brand_palettes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            colors_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        );
    """)
    
    # Auto-migration of existing result files
    try:
        if os.path.exists(RESULTS_DIR):
            skip_prefixes = ('mask_', 'test_', 'omnisvg_', 'thumb_', 'prev_')
            for filename in os.listdir(RESULTS_DIR):
                filepath = os.path.join(RESULTS_DIR, filename)
                if os.path.isfile(filepath):
                    if filename.lower().startswith(skip_prefixes):
                        continue
                    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
                    if ext not in ('png', 'jpg', 'jpeg', 'svg', 'tiff'):
                        continue
                    
                    row = conn.execute("SELECT 1 FROM exports WHERE filename = ?", (filename,)).fetchone()
                    if not row:
                        if filename.startswith('seamless_gen_') or filename.startswith('seamless_tile_'):
                            tool_type = "Seamless Fix"
                        elif filename.startswith('repeat_'):
                            tool_type = "Repeat Set"
                        elif filename.startswith('vec_'):
                            tool_type = "Vectorize"
                        elif filename.startswith('upscale_'):
                            tool_type = "Super Resolution"
                        elif filename.startswith('mockup_'):
                            tool_type = "Mappings"
                        elif filename.startswith('extracted_'):
                            tool_type = "Extract Design"
                        elif filename.startswith('layer_'):
                            tool_type = "Image Layers"
                        else:
                            tool_type = "Seamless Fix"
                        
                        try:
                            mtime = os.path.getmtime(filepath)
                            created_at = datetime.utcfromtimestamp(mtime).isoformat()
                        except Exception:
                            created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
                            
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO exports 
                            (project_id, filename, input_filename, tool_type, settings_json, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """,
                            (1, filename, None, tool_type, '{}', created_at)
                        )
            conn.commit()
    except Exception as e:
        print(f"Error during auto-migration: {e}")

    # Seed users
    user_count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
    if user_count == 0:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        reset_at = now + timedelta(days=12)
        conn.execute(
            "INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at) VALUES (1, 'admin@rim.ai', 'admin123', 'Admin User', 'AU', 'admin', 'Enterprise Admin', 0, 1000000, ?)",
            (reset_at.isoformat(),)
        )
        conn.execute(
            "INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at) VALUES (2, 'user@rim.ai', 'user123', 'Normal User', 'NU', 'user', 'Business Pro', 8450, 50000, ?)",
            (reset_at.isoformat(),)
        )
        conn.commit()
        print("Seeded database with pre-approved admin and normal user accounts.")

    # Seed demo projects
    project_count = conn.execute("SELECT COUNT(*) AS c FROM projects").fetchone()["c"]
    if project_count == 0:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        project_rows = [
            (1, "Spring Bloom Collection", "In Progress", "/demo_floral.png", "/demo_floral.png", now - timedelta(hours=2)),
            (2, "Botanical Dreams", "Completed", "/demo_botanical.png", "/demo_botanical.png", now - timedelta(days=1)),
            (3, "Heritage Archive", "Draft", "/demo_geometric.png", "/demo_geometric.png", now - timedelta(days=3)),
        ]
        conn.executemany(
            "INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [(pid, name, status, thumb, hero, ts.isoformat()) for pid, name, status, thumb, hero, ts in project_rows],
        )
        conn.execute("INSERT INTO project_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (1, 24, 12, 18, 8, 52, 24, 1250, 15))
        conn.execute("INSERT INTO pattern_health VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (1, 92, "Excellent", 1, 1, 1, 1, "Great job. Your pattern is print-ready."))
        conn.execute("INSERT INTO project_controls VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (1, 2, 100, 0, "block", 1, 1, 0, "PNG", 300, 8, 8, 12, now.isoformat()))
        conn.execute("INSERT INTO suggestions (project_id, body, created_at) VALUES (?, ?, ?)", (1, "Try increasing contrast in the floral elements for better print definition.", now.isoformat()))
        conn.commit()
    conn.close()
