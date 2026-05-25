import os
import uuid
import base64
import replicate
from groq import Groq
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Configuration
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), 'uploads')
RESULTS_DIR = os.path.join(os.path.dirname(__file__), 'results')
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp'}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB
# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

# Replicate API token (from env)
os.environ.setdefault("REPLICATE_API_TOKEN", os.getenv("REPLICATE_API_TOKEN", ""))

# Groq API client (from env)
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


import json
import sqlite3
import threading
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), 'rimi_ai.sqlite3')

db_lock = threading.Lock()

def db():
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.row_factory = sqlite3.Row
    # Enable Write-Ahead Logging (WAL) for high concurrency scaling
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

def log_export(project_id, filename, input_filename, tool_type, settings_dict=None, pipeline_run_id=None, pipeline_steps_list=None):
    settings_json = json.dumps(settings_dict) if settings_dict is not None else '{}'
    pipeline_steps_json = json.dumps(pipeline_steps_list) if pipeline_steps_list is not None else None
    created_at = datetime.utcnow().isoformat()
    
    with db_lock:
        conn = db()
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO exports 
                (project_id, filename, input_filename, tool_type, settings_json, pipeline_run_id, pipeline_steps_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (project_id, filename, input_filename, tool_type, settings_json, pipeline_run_id, pipeline_steps_json, created_at)
            )
            conn.commit()
        except Exception as e:
            print(f"Error logging export: {e}")
        finally:
            conn.close()

def init_db():
    conn = db()
    
    # Auto-migration of users table to support the expanded columns
    try:
        conn.execute("SELECT email FROM users LIMIT 1")
    except sqlite3.OperationalError:
        # Table exists but doesn't have the email column, or doesn't exist at all.
        # Drop users table so we can recreate it with new schema
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
    """)
    
    # Auto-migration of existing files in the results directory
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
                        else:
                            tool_type = "Seamless Fix"
                        
                        try:
                            mtime = os.path.getmtime(filepath)
                            created_at = datetime.utcfromtimestamp(mtime).isoformat()
                        except Exception:
                            created_at = datetime.utcnow().isoformat()
                            
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

    # Seed users and demo database entries if project_count is 0
    project_count = conn.execute("SELECT COUNT(*) AS c FROM projects").fetchone()["c"]
    
    # Ensure users are seeded regardless if table was just recreated/empty
    user_count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
    if user_count == 0:
        now = datetime.utcnow()
        reset_at = now + timedelta(days=12)
        # Admin account
        conn.execute(
            """
            INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at)
            VALUES (1, 'admin@rim.ai', 'admin123', 'Admin User', 'AU', 'admin', 'Enterprise Admin', 0, 1000000, ?)
            """,
            (reset_at.isoformat(),)
        )
        # Normal user account
        conn.execute(
            """
            INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at)
            VALUES (2, 'user@rim.ai', 'user123', 'Normal User', 'NU', 'user', 'Business Pro', 8450, 50000, ?)
            """,
            (reset_at.isoformat(),)
        )
        conn.commit()
        print("Seeded database with pre-approved admin and normal user accounts.")

    if project_count == 0:
        now = datetime.utcnow()
        project_rows = [
            (1, "Spring Bloom Collection", "In Progress", "/demo_floral.png", "/demo_floral.png", now - timedelta(hours=2)),
            (2, "Botanical Dreams", "Completed", "/demo_botanical.png", "/demo_botanical.png", now - timedelta(days=1)),
            (3, "Heritage Archive", "Draft", "/demo_geometric.png", "/demo_geometric.png", now - timedelta(days=3)),
        ]
        conn.executemany(
            "INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [(pid, name, status, thumb, hero, ts.isoformat()) for pid, name, status, thumb, hero, ts in project_rows],
        )
        # Variations insert removed to clean hardcoded data
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

def log_replicate_call(project_id, model_name, duration, credits, cost_usd):
    created_at = datetime.utcnow().isoformat()
    with db_lock:
        conn = db()
        try:
            conn.execute(
                """
                INSERT INTO replicate_logs (project_id, model_name, duration, credits, cost_usd, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (project_id, model_name, duration, credits, cost_usd, created_at)
            )
            conn.commit()
        except Exception as e:
            print(f"Error logging replicate call: {e}")
        finally:
            conn.close()

def get_studio_state(project_id=1, user_id=None):
    conn = db()
    if user_id is not None:
        user_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    else:
        user_row = conn.execute("SELECT * FROM users ORDER BY id LIMIT 1").fetchone()
        
    if not user_row:
        user = {
            "id": 1,
            "email": "user@rim.ai",
            "name": "Default User",
            "initials": "DU",
            "role": "user",
            "plan": "Business Pro",
            "credits_used": 0,
            "credits_limit": 50000,
            "reset_at": datetime.utcnow().isoformat()
        }
    else:
        user = dict(user_row)
        
    projects = rows_to_dicts(conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall())
    project = dict(conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone() or projects[0])
    variations = rows_to_dicts(conn.execute("SELECT * FROM pattern_variations WHERE project_id = ? ORDER BY id", (project["id"],)).fetchall())
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
        now_iso = datetime.utcnow().isoformat()
        conn.execute("INSERT INTO project_controls (project_id, grid_size, scale, rotation, repeat_type, color_cleanup, edge_match, background_clean, export_format, export_dpi, h_brush, v_brush, print_width, updated_at) VALUES (?, 2, 100, 0, 'block', 1, 1, 0, 'PNG', 300, 8, 8, 12, ?)", (project["id"], now_iso))
        controls_row = conn.execute("SELECT * FROM project_controls WHERE project_id = ?", (project["id"],)).fetchone()
    controls = dict(controls_row)
    suggestion = conn.execute("SELECT body FROM suggestions WHERE project_id = ? ORDER BY id DESC LIMIT 1", (project["id"],)).fetchone()
    conn.close()

    try:
        reset_at = datetime.fromisoformat(user["reset_at"])
        reset_days = max(0, (reset_at.date() - datetime.utcnow().date()).days)
    except Exception:
        reset_days = 30

    user_payload = {
        "id": user["id"],
        "email": user.get("email", ""),
        "role": user.get("role", "user"),
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
    user_id = request.args.get('userId')
    if user_id:
        try:
            user_id = int(user_id)
        except ValueError:
            user_id = None
    return jsonify({'success': True, 'state': get_studio_state(project_id, user_id)})

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

    user_id = request.args.get('userId') or data.get('userId') or data.get('user_id')
    if user_id:
        try:
            user_id = int(user_id)
        except ValueError:
            user_id = None

    if updates:
        updates.append("updated_at = ?")
        values.append(datetime.utcnow().isoformat())
        values.append(project_id)

        conn = db()
        cur = conn.execute(f"UPDATE project_controls SET {', '.join(updates)} WHERE project_id = ?", values)
        if cur.rowcount == 0:
            now_iso = datetime.utcnow().isoformat()
            conn.execute(
                "INSERT INTO project_controls (project_id, grid_size, scale, rotation, repeat_type, color_cleanup, edge_match, background_clean, export_format, export_dpi, h_brush, v_brush, print_width, updated_at) VALUES (?, 2, 100, 0, 'block', 1, 1, 0, 'PNG', 300, 8, 8, 12, ?)",
                (project_id, now_iso)
            )
            conn.execute(f"UPDATE project_controls SET {', '.join(updates)} WHERE project_id = ?", values)
        conn.commit()
        conn.close()

    return jsonify({'success': True, 'state': get_studio_state(project_id, user_id)})

def record_activity(project_id, activity_type='export', count=1, credits=50, user_id=None):
    now = datetime.utcnow().isoformat()
    conn = db()
    if activity_type == 'export':
        conn.execute(
            """
            UPDATE project_metrics
            SET exports = exports + ?,
                exports_delta = exports_delta + ?,
                credits_used = credits_used + ?,
                credits_delta = credits_delta + ?
            WHERE project_id = ?
            """,
            (count, count, credits, credits, project_id),
        )
    elif activity_type == 'generation':
        conn.execute(
            """
            UPDATE project_metrics
            SET ai_generations = ai_generations + ?,
                ai_generations_delta = ai_generations_delta + ?,
                credits_used = credits_used + ?,
                credits_delta = credits_delta + ?
            WHERE project_id = ?
            """,
            (count, count, credits, credits, project_id),
        )
    
    # Resolve user_id dynamically
    if not user_id:
        user_id = 2  # Default to the normal user (ID 2)
    conn.execute("UPDATE users SET credits_used = credits_used + ? WHERE id = ?", (credits, user_id))
    conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    conn.commit()
    conn.close()

# --------------- Upload Endpoint ---------------

@app.route('/api/upload', methods=['POST'])
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


# --------------- Generate Inspirations (Grok Imagine) ---------------
# --------------- Describe Image (Groq Llama 4 Scout Vision) ---------------
@app.route('/api/describe-image', methods=['POST'])
def describe_image():
    """
    Uses Groq Llama 4 Scout vision model to automatically describe an uploaded image.
    Expects JSON: { filename, creativity }
    Returns a detailed description suitable for seamless pattern regeneration.
    """
    data = request.get_json()
    filename = data.get('filename', '')
    creativity = int(data.get('creativity', 3))

    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404

    try:
        # Read and encode image to base64
        with open(filepath, 'rb') as f:
            image_bytes = f.read()
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')

        # Detect MIME type from extension
        ext = filename.rsplit('.', 1)[1].lower()
        mime_map = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp'}
        mime_type = mime_map.get(ext, 'image/jpeg')

        print(f"  [Describe] Sending image to Groq Llama 4 Scout (Creativity: {creativity})...")

        # Map creativity level to custom description instructions
        creativity_guidelines = {
            1: (
                "Describe this image in meticulous literal detail. Focus on reproducing the exact design, scale, motifs, layout, and colors. "
                "The description should be structured so that an AI image generator can recreate this exact pattern as a seamless repeating tile with absolute fidelity."
            ),
            2: (
                "Describe this image in close detail. Focus on reproducing the key motifs, color palettes, and overall style closely, "
                "allowing only minor refinements for repeating tiles."
            ),
            3: (
                "Describe this image in an artistic and balanced way. Focus on capturing the core art style, colors, and pattern motifs "
                "while allowing a professional amount of creative freedom to generate variations."
            ),
            4: (
                "Describe the underlying artistic style, color psychology, mood, and elements of this image in a highly creative, designer-focused way. "
                "Highlight how a brand new, highly aesthetic variation can be created while maintaining the design's core theme."
            ),
            5: (
                "Describe the abstract theme, aesthetic mood, color interactions, and overall essence of this design in a highly artistic, "
                "imaginative, and avant-garde fashion. Prompt for a wildly creative, bold reinterpretation of this design concept."
            )
        }

        style_instruction = creativity_guidelines.get(creativity, creativity_guidelines[3])

        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{image_b64}"
                            }
                        },
                        {
                            "type": "text",
                            "text": (
                                f"You are a professional luxury textile designer. Analyze this image. \n"
                                f"{style_instruction}\n"
                                "Write the description as a single detailed paragraph (max 100 words) suitable for an AI image generator prompt. "
                                "Do NOT include any preamble like 'This image shows' or quotes — just describe it directly."
                            )
                        }
                    ]
                }
            ],
            temperature=0.3 + (creativity * 0.1),
            max_completion_tokens=512,
            top_p=1,
        )

        description = completion.choices[0].message.content.strip()
        print(f"  [Describe] Got description: {description[:100]}...")

        return jsonify({
            'success': True,
            'description': description
        })

    except Exception as e:
        print(f"  [Describe] Error: {e}")
        return jsonify({'error': f'Failed to describe image: {str(e)}'}), 500


@app.route('/api/extract-design', methods=['POST'])
def extract_design():
    """
    Uses Groq LLM API to describe the image, then uses black-forest-labs/flux-fill-pro 
    to extract and generate a flat fabric pattern.
    Expects JSON: { filename, projectId, userId }
    """
    import base64
    import requests as http_requests
    import time
    data = request.get_json()
    filename = data.get('filename', '')
    
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404
        
    try:
        print(f"  [Extract Design] Processing {filename} with openai/gpt-image-2...")
        
        with open(filepath, "rb") as img_file:
            image_bytes = img_file.read()
            encoded_string = base64.b64encode(image_bytes).decode('utf-8')
            mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
            data_uri = f"data:{mime_type};base64,{encoded_string}"

        start_time = time.time()
        output = replicate.run(
            "openai/gpt-image-2",
            input={
                "prompt": "A perfectly flat, 2D seamless repeating pattern tile of the exact fabric design, motif, and colors seen in the input image. Extract the design out of the outfit. High resolution, perfectly flat texture.",
                "input_images": [data_uri],
                "aspect_ratio": "1:1"
            }
        )
        duration = time.time() - start_time
        credits_used = max(10, int(round(duration * 12)))
        cost_usd = duration * 0.00115
        
        project_id = int(data.get('projectId', 1))
        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                user_id = None

        log_replicate_call(project_id, "openai/gpt-image-2", duration, credits_used, cost_usd)

        # output is typically a list of URLs
        image_urls = [str(url) for url in output] if isinstance(output, list) else [str(output)]
        print(f"  [Extract Design] Done! Generated {len(image_urls)} tiles. Downloading locally...")

        local_result_urls = []
        
        for url in image_urls:
            resp = http_requests.get(url, timeout=60)
            resp.raise_for_status()
            
            local_uuid = uuid.uuid4().hex
            local_filename = f"extracted_{local_uuid}.png"
            local_filepath = os.path.join(RESULTS_DIR, local_filename)
            
            with open(local_filepath, 'wb') as f:
                f.write(resp.content)
                
            local_url = f"/results/{local_filename}"
            local_result_urls.append(local_url)
            
            # Log export
            log_export(
                project_id=project_id,
                filename=local_filename,
                input_filename=filename,
                tool_type="Extract Design",
                settings_dict={"prompt": "Extract design out of outfit"}
            )

        record_activity(project_id, 'generation', len(local_result_urls), credits_used, user_id=user_id)

        return jsonify({
            'success': True,
            'resultUrls': local_result_urls
        })

    except Exception as e:
        print(f"  [Extract Design] Error: {e}")
        return jsonify({'error': f'Failed to extract design: {str(e)}'}), 500


@app.route('/api/generate-inspirations', methods=['POST'])
def generate_inspirations():
    """
    Acts like a designer: Uses Groq LLM (llama-4-scout) to dynamically write/enhance 
    the prompt based on the creativity slider, then uses openai/gpt-image-2 on Replicate
    to generate highly aesthetic variations.
    Expects JSON: { prompt, creativity, count, filename, imageUrl, projectId }
    """
    import base64
    import requests as http_requests
    from io import BytesIO

    data = request.get_json()
    user_prompt = data.get('prompt', '')
    creativity = int(data.get('creativity', 3))
    count = int(data.get('count', 3))
    filename = data.get('filename', '')
    image_url = data.get('imageUrl', '')

    if not user_prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    # 1. Load the input image if present
    data_uri = None
    mime_type = "image/png"
    try:
        if image_url and image_url.startswith('http'):
            print(f"  [Inspirations] Downloading image from URL...")
            resp = http_requests.get(image_url, timeout=30)
            encoded_string = base64.b64encode(resp.content).decode('utf-8')
            data_uri = f"data:{mime_type};base64,{encoded_string}"
        elif filename:
            filepath = os.path.join(UPLOAD_DIR, filename)
            if os.path.exists(filepath):
                with open(filepath, "rb") as img_file:
                    encoded_string = base64.b64encode(img_file.read()).decode('utf-8')
                    mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
                    data_uri = f"data:{mime_type};base64,{encoded_string}"
    except Exception as e:
        print(f"  [Inspirations] Image load error: {e}")

    # 2. Use Groq llama-4-scout to rewrite the prompt like a professional textile designer
    try:
        print(f"  [Inspirations] Consulting Llama-4-Scout to rewrite prompt (Creativity: {creativity})...")
        
        system_instruction = (
            "You are a luxury textile & fashion designer and an expert prompt engineer. "
            f"Analyze the user's basic pattern idea: '{user_prompt}'. "
            f"The user wants a creativity level of {creativity} out of 5 (1 = very safe/faithful, 5 = extremely wild/abstract/bold). "
            "Write a highly professional, rich, and sophisticated prompt for an AI image generator (like openai/gpt-image-2) "
            "that describes a stunning, flat 2D repeating fabric pattern tile in meticulous detail. "
            "Focus on the exact arrangement of motifs, luxurious color palette (use specific designer color terms), "
            "composition, spacing, and fine artistic textures. "
            "Keep the prompt to a single, powerful, highly descriptive paragraph (max 100 words). "
            "Do NOT include any introduction, explanations, notes, or quotes. Output ONLY the optimized prompt text itself."
        )

        messages = []
        if data_uri:
            messages.append({
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_uri}},
                    {"type": "text", "text": system_instruction}
                ]
            })
        else:
            messages.append({
                "role": "user",
                "content": system_instruction
            })

        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=messages,
            temperature=0.4 + (creativity * 0.1), # Higher temperature = more creative
            max_completion_tokens=256,
        )
        designer_prompt = completion.choices[0].message.content.strip()
        print(f"  [Inspirations] Designer Prompt: {designer_prompt}")
    except Exception as e:
        print(f"  [Inspirations] Groq prompt enhancement failed: {e}")
        designer_prompt = f"A repeating pattern of {user_prompt}, flat 2D textile design, highly detailed."

    # 3. Generate variations — use FSTL seamless model if seamless=true, else GPT-Image-2
    use_seamless = data.get('seamless', False)
    results = []
    errors = []
    total_credits = 0
    project_id = int(data.get('projectId', 1))
    user_id = data.get('userId') or data.get('user_id')
    if user_id:
        try:
            user_id = int(user_id)
        except ValueError:
            user_id = None

    if use_seamless:
        # Use FSTL text-to-image for natively seamless tiles (all at once)
        try:
            print(f"  [Inspirations] Generating {count} seamless tiles using FSTL text-to-image...")
            import time
            start_time = time.time()
            output = replicate.run(
                "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
                input={
                    "prompt": f"FSTL {designer_prompt}, seamless repeating textile pattern, tileable",
                    "model": "dev",
                    "aspect_ratio": "1:1",
                    "num_outputs": min(4, count),
                    "num_inference_steps": 28,
                    "guidance_scale": 3.0,
                    "output_format": "png",
                }
            )
            duration = time.time() - start_time
            credits_used = max(10, int(round(duration * 12)))
            cost_usd = duration * 0.00115
            log_replicate_call(project_id, "replicate/seamless-texture", duration, credits_used, cost_usd)
            total_credits += credits_used

            for idx, out_url in enumerate(output if isinstance(output, list) else [output]):
                url_str = str(out_url.url) if hasattr(out_url, 'url') else str(out_url)
                results.append(url_str)
                print(f"  [Inspirations] FSTL tile {idx+1} done: {url_str[:80]}...")
        except Exception as e:
            print(f"  [Inspirations] FSTL generation error: {e}")
            errors.append(str(e))
    else:
        for i in range(count):
            try:
                print(f"  [Inspirations] Generating variant {i+1}/{count} using openai/gpt-image-2...")
                
                replicate_input = {
                    "prompt": designer_prompt + " - flat 2D repeating fabric pattern tile texture.",
                    "aspect_ratio": "1:1"
                }
                if data_uri:
                    replicate_input["input_images"] = [data_uri]

                import time
                start_time = time.time()
                output = replicate.run(
                    "openai/gpt-image-2",
                    input=replicate_input
                )
                duration = time.time() - start_time
                credits_used = max(10, int(round(duration * 12)))
                cost_usd = duration * 0.00115
                log_replicate_call(project_id, "openai/gpt-image-2", duration, credits_used, cost_usd)
                total_credits += credits_used

                image_url = str(output[0].url) if isinstance(output, list) and len(output) > 0 else str(output)
                results.append(image_url)
                print(f"  [Inspirations] Variant {i+1} done: {image_url[:80]}...")

            except Exception as e:
                print(f"  [Inspirations] Replicate generation error on variant {i+1}: {e}")
                errors.append(str(e))

    if results:
        record_activity(project_id, 'generation', len(results), total_credits, user_id=user_id)

    return jsonify({
        'success': True,
        'variations': results,
        'errors': errors
    })


# --------------- Generate Seamless Pattern (FSTL Text-to-Image) ---------------
@app.route('/api/generate-seamless', methods=['POST'])
def generate_seamless():
    """
    Uses replicate/seamless-texture FSTL model in text-to-image mode to generate
    natively seamless tiles. This is the PRIMARY method — the model uses circular
    padding internally, so tiles are seamless by construction.
    
    Expects JSON: { prompt, count, creativity, projectId, filename, imageUrl }
    """
    import base64
    import requests as http_requests
    from io import BytesIO
    import numpy as np
    from PIL import Image

    data = request.get_json()
    user_prompt = data.get('prompt', '')
    count = min(4, max(1, int(data.get('count', 4))))
    creativity = int(data.get('creativity', 3))
    filename = data.get('filename', '')
    image_url = data.get('imageUrl', '')
    project_id = int(data.get('projectId', 1))

    if not user_prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    try:
        # Step 1: Use Groq LLM to enhance the prompt for seamless tile generation
        print(f"  [Generate Seamless] Enhancing prompt with Groq LLM (Creativity: {creativity})...")
        
        system_instruction = (
            "You are a luxury textile designer and expert prompt engineer. "
            f"The user wants a seamless, tileable fabric pattern based on: '{user_prompt}'. "
            f"Creativity level: {creativity}/5 (1=faithful, 5=wild). "
            "Write a prompt for the FSTL seamless texture model. "
            "Describe the pattern in detail: motifs, arrangement, colors (use specific designer color terms), "
            "background, artistic style (flat 2D vector, watercolor, hand-drawn, etc). "
            "Keep it to a single paragraph, max 80 words. "
            "Do NOT include any introduction, explanations, or quotes. Output ONLY the prompt text."
        )

        # Optionally include reference image in the LLM call
        data_uri = None
        if filename:
            filepath = os.path.join(UPLOAD_DIR, filename)
            if os.path.exists(filepath):
                with open(filepath, "rb") as img_file:
                    encoded_string = base64.b64encode(img_file.read()).decode('utf-8')
                    mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
                    data_uri = f"data:{mime_type};base64,{encoded_string}"
        elif image_url and image_url.startswith('http'):
            resp = http_requests.get(image_url, timeout=30)
            encoded_string = base64.b64encode(resp.content).decode('utf-8')
            data_uri = f"data:image/png;base64,{encoded_string}"

        messages = []
        if data_uri:
            messages.append({
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_uri}},
                    {"type": "text", "text": system_instruction}
                ]
            })
        else:
            messages.append({"role": "user", "content": system_instruction})

        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=messages,
            temperature=0.3 + (creativity * 0.12),
            max_completion_tokens=256,
        )
        designer_prompt = completion.choices[0].message.content.strip()
        print(f"  [Generate Seamless] Designer prompt: {designer_prompt[:120]}...")

        # Step 2: Generate seamless tiles using FSTL text-to-image mode
        # Map creativity to guidance_scale: low creativity = higher guidance (more faithful)
        guidance_map = {1: 4.5, 2: 3.5, 3: 3.0, 4: 2.5, 5: 2.0}
        guidance = guidance_map.get(creativity, 3.0)

        print(f"  [Generate Seamless] Generating {count} seamless tiles (guidance={guidance})...")
        import time
        start_time = time.time()
        output = replicate.run(
            "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
            input={
                "prompt": f"FSTL {designer_prompt}, seamless repeating textile pattern, tileable",
                "model": "dev",
                "aspect_ratio": "1:1",
                "num_outputs": count,
                "num_inference_steps": 28,
                "guidance_scale": guidance,
                "output_format": "png",
            }
        )
        duration = time.time() - start_time
        credits_used = max(10, int(round(duration * 12)))
        cost_usd = duration * 0.00115
        log_replicate_call(project_id, "replicate/seamless-texture", duration, credits_used, cost_usd)

        # Step 3: Download, score, save, and return results
        results = []
        best_url = None
        best_score = -1.0

        for idx, out_url in enumerate(output if isinstance(output, list) else [output]):
            url_str = str(out_url.url) if hasattr(out_url, 'url') else str(out_url)
            
            # Download and score
            resp = http_requests.get(url_str, timeout=60)
            img = Image.open(BytesIO(resp.content)).convert('RGB')
            
            # Compute perceptual seam score (absolute + ratio combined)
            arr = np.array(img, dtype=np.float32)
            h, w = arr.shape[:2]
            # Absolute boundary pixel difference (most perceptually relevant)
            seam_x = np.mean(np.abs(arr[:, 0, :] - arr[:, -1, :]))
            seam_y = np.mean(np.abs(arr[0, :, :] - arr[-1, :, :]))
            abs_score_x = max(0.0, 1.0 - seam_x / 50.0)
            abs_score_y = max(0.0, 1.0 - seam_y / 50.0)
            abs_score = (abs_score_x + abs_score_y) / 2.0
            # Gradient ratio (boundary vs internal)
            diff_x = np.mean(np.abs(arr[:, 1:, :] - arr[:, :-1, :]))
            diff_y = np.mean(np.abs(arr[1:, :, :] - arr[:-1, :, :]))
            rx = seam_x / max(1e-5, diff_x)
            ry = seam_y / max(1e-5, diff_y)
            ratio_x = max(0.0, min(1.0, 1.0 - (rx - 1.5) / 4.0)) if rx > 1.5 else 1.0
            ratio_y = max(0.0, min(1.0, 1.0 - (ry - 1.5) / 4.0)) if ry > 1.5 else 1.0
            ratio_score = (ratio_x + ratio_y) / 2.0
            # Combined: absolute weighted more (70%) as it matches perception
            score = abs_score * 0.7 + ratio_score * 0.3
            
            # Save tile locally
            result_name = f"seamless_gen_{uuid.uuid4().hex[:8]}.png"
            result_path = os.path.join(RESULTS_DIR, result_name)
            img.save(result_path, 'PNG')
            local_url = f'/results/{result_name}'
            
            results.append({
                'url': local_url,
                'remoteUrl': url_str,
                'score': round(score, 3),
                'index': idx
            })
            
            if score > best_score:
                best_score = score
                best_url = local_url
            
            print(f"  [Generate Seamless] Tile {idx+1}: score={score:.3f} (abs_x={abs_score_x:.3f} abs_y={abs_score_y:.3f})")

        # Update project with best tile
        if best_url:
            conn = db()
            now = datetime.utcnow().isoformat()
            conn.execute(
                "UPDATE projects SET hero_image_url = ?, thumbnail_url = ?, updated_at = ? WHERE id = ?",
                (best_url, best_url, now, project_id)
            )
            
            # Update health score
            score_pct = int(best_score * 100)
            tile_seamless = 1 if best_score >= 0.70 else 0
            label = "A - Excellent" if best_score >= 0.90 else "B - Good" if best_score >= 0.75 else "C - Fair" if best_score >= 0.60 else "D - Poor"
            note = f"Generated natively seamless tile ({score_pct}% match)."
            conn.execute(
                "INSERT INTO pattern_health (project_id, score, label, tile_seamless, color_balance, print_readiness, resolution, note) "
                "VALUES (?, ?, ?, ?, 1, ?, 1, ?) "
                "ON CONFLICT(project_id) DO UPDATE SET "
                "score=excluded.score, label=excluded.label, tile_seamless=excluded.tile_seamless, "
                "color_balance=excluded.color_balance, print_readiness=excluded.print_readiness, "
                "resolution=excluded.resolution, note=excluded.note",
                (project_id, score_pct, label, tile_seamless, 1 if tile_seamless else 0, note)
            )
            conn.commit()
            conn.close()

            # Log best export
            best_filename = best_url.split('/')[-1]
            input_fn = filename if filename else (image_url.split('/')[-1] if image_url else None)
            log_export(
                project_id=project_id,
                filename=best_filename,
                input_filename=input_fn,
                tool_type="Seamless Fix",
                settings_dict={"prompt": designer_prompt, "creativity": creativity, "input_image": input_fn or image_url}
            )

        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                user_id = None

        record_activity(project_id, 'generation', count, credits_used, user_id=user_id)

        print(f"  [Generate Seamless] Done! Best score: {best_score:.3f}")
        return jsonify({
            'success': True,
            'tiles': results,
            'bestUrl': best_url,
            'bestScore': round(best_score, 3),
            'designerPrompt': designer_prompt,
        })

    except Exception as e:
        print(f"  [Generate Seamless] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to generate seamless pattern: {str(e)}'}), 500


# --------------- Make Seamless (Flux-2-Flex via Replicate) ---------------
@app.route('/api/make-seamless', methods=['POST'])
def make_seamless():
    """
    Uses Flux Fill Pro to inpaint only the seams, keeping the rest of the image exactly the same.
    Expects JSON: { filename, imageUrl, projectId }
    """
    import base64
    from io import BytesIO
    import numpy as np
    from PIL import Image, ImageDraw, ImageChops, ImageFilter
    import requests as http_requests
    import time
    import uuid
    from datetime import datetime
    import replicate

    data = request.get_json()
    filename = data.get('filename', '')
    image_url = data.get('imageUrl', '')
    project_id = int(data.get('projectId', 1))

    if not filename and not image_url:
        return jsonify({'error': 'Filename or imageUrl is required'}), 400

    try:
        # 1. Load the source image
        if image_url and image_url.startswith('http'):
            print(f"  [Make Seamless] Downloading image from URL...")
            resp = http_requests.get(image_url, timeout=30)
            img = Image.open(BytesIO(resp.content))
        elif filename:
            filepath = os.path.join(UPLOAD_DIR, filename)
            if not os.path.exists(filepath):
                return jsonify({'error': 'File not found'}), 404
            img = Image.open(filepath)
        else:
            return jsonify({'error': 'Provide either filename or imageUrl'}), 400

        if img.mode != 'RGB':
            img = img.convert('RGB')

        orig_w, orig_h = img.size
        print(f"  [Make Seamless] Making {orig_w}x{orig_h} base tile seamless...")

        def img_to_data_uri(pil_img):
            buf = BytesIO()
            pil_img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
            return f"data:image/png;base64,{b64}"

        def compute_seam_score(img_to_score):
            arr = np.array(img_to_score.convert("RGB"), dtype=np.float32)
            h, w = arr.shape[:2]
            strip_w = max(3, int(w * 0.03))
            strip_h = max(3, int(h * 0.03))

            left  = arr[:, :strip_w, :]
            right = arr[:, -strip_w:, :]
            v_diff = np.mean(np.abs(left - right[:, ::-1, :])) / 255.0
            v_score = max(0.0, 1.0 - v_diff * 6.0)

            top    = arr[:strip_h, :, :]
            bottom = arr[-strip_h:, :, :]
            h_diff = np.mean(np.abs(top - bottom[::-1, :, :])) / 255.0
            h_score = max(0.0, 1.0 - h_diff * 6.0)

            overall = (v_score + h_score) / 2.0
            return {
                "v": round(v_score, 4), "h": round(h_score, 4),
                "overall": round(overall, 4),
                "is_seamless": bool(v_score > 0.82 and h_score > 0.82),
            }

        pre_score = compute_seam_score(img)
        print(f"  [Make Seamless] Pre-score: Overall={pre_score['overall']:.3f}")

        # 2. Get LLM description
        print("  [Make Seamless] Describing pattern with Groq LLM...")
        tile_uri = img_to_data_uri(img.resize((512, 512), Image.Resampling.LANCZOS))
        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": tile_uri}},
                    {"type": "text", "text": "Describe this repeating fabric/textile pattern precisely. Focus on: motif shapes, colors, background. 2 sentences max."}
                ]
            }],
            temperature=0.2,
            max_completion_tokens=200,
        )
        description = completion.choices[0].message.content.strip()
        print(f"  [Make Seamless] Description: {description}")

        # 3. Helpers for inpainting
        def create_cross_mask(width, height, h_pct, v_pct, feather=True):
            mask = Image.new("L", (width, height), 0)
            draw = ImageDraw.Draw(mask)
            x_off, y_off = width // 2, height // 2
            h_brush = max(4, int(height * (h_pct / 100.0)))
            v_brush = max(4, int(width * (v_pct / 100.0)))
            draw.rectangle([0, y_off - h_brush // 2, width, y_off + h_brush // 2], fill=255)
            draw.rectangle([x_off - v_brush // 2, 0, x_off + v_brush // 2, height], fill=255)
            if feather:
                mask = mask.filter(ImageFilter.GaussianBlur(radius=max(3, min(h_brush, v_brush) // 6)))
                arr = np.array(mask, dtype=np.float32)
                arr = np.clip(arr * 1.5, 0, 255).astype(np.uint8)
                mask = Image.fromarray(arr)
            return mask

        replicate_calls = []

        def inpaint_pass(offset_img, mask_img, pass_num, guidance, steps):
            print(f"  [Make Seamless] Running flux-fill-pro (Pass {pass_num}, guidance={guidance}, steps={steps})...")
            prompt = (
                f"A perfectly seamless, continuously repeating textile pattern. "
                f"The design shows {description}. "
                f"In the masked region, seamlessly continue and reconnect all motifs, "
                f"lines, shapes, and background textures so the tile repeats perfectly "
                f"with no visible seams, breaks, or discontinuities. "
                f"Match the exact style, colors, line weights, and artistic technique."
            )
            img_uri = img_to_data_uri(offset_img)
            mask_uri = img_to_data_uri(mask_img)

            for attempt in range(3):
                try:
                    t0 = time.time()
                    output = replicate.run(
                        "black-forest-labs/flux-fill-pro",
                        input={
                            "image": img_uri,
                            "mask": mask_uri,
                            "prompt": prompt,
                            "output_format": "png",
                            "steps": steps,
                            "guidance": guidance,
                        }
                    )
                    duration = time.time() - t0
                    credits_used = max(10, int(round(duration * 12)))
                    cost_usd = duration * 0.00115
                    log_replicate_call(project_id, "black-forest-labs/flux-fill-pro", duration, credits_used, cost_usd)
                    replicate_calls.append((duration, credits_used))
                    print(f"  [Make Seamless] Done in {duration:.1f}s. Downloading...")
                    resp_img = http_requests.get(str(output), timeout=60)
                    result_img = Image.open(BytesIO(resp_img.content))
                    if result_img.mode != "RGB":
                        result_img = result_img.convert("RGB")
                    return result_img
                except Exception as e:
                    print(f"  [Make Seamless] Attempt {attempt+1}/3 failed: {e}")
                    if attempt < 2:
                        time.sleep((attempt + 1) * 10)
                    else:
                        raise

        # 4. Multi-pass Seamless Pipeline
        best_tile = img
        best_score = pre_score

        if not pre_score["is_seamless"]:
            width, height = img.size
            x_off, y_off = width // 2, height // 2
            
            # --- PASS 1 ---
            print(f"  [Make Seamless] --- PASS 1 (wide mask 22%, guidance=50) ---")
            offset1 = ImageChops.offset(img, x_off, y_off)
            mask1 = create_cross_mask(width, height, h_pct=22, v_pct=22, feather=True)
            filled1 = inpaint_pass(offset1, mask1, pass_num=1, guidance=50, steps=40)
            
            if filled1.size != (width, height):
                filled1 = filled1.resize((width, height), Image.Resampling.LANCZOS)
                
            tile1 = ImageChops.offset(filled1, -x_off, -y_off)
            score1 = compute_seam_score(tile1)
            print(f"  [Make Seamless] SCORE: Overall={score1['overall']:.3f}")
            
            if score1["overall"] > best_score["overall"]:
                best_tile = tile1
                best_score = score1
                
            # --- PASS 2 ---
            if not score1["is_seamless"]:
                print(f"  [Make Seamless] --- PASS 2 (narrow mask 10%, guidance=70) ---")
                offset2 = ImageChops.offset(tile1, x_off, y_off)
                mask2 = create_cross_mask(width, height, h_pct=10, v_pct=10, feather=True)
                filled2 = inpaint_pass(offset2, mask2, pass_num=2, guidance=70, steps=45)
                
                if filled2.size != (width, height):
                    filled2 = filled2.resize((width, height), Image.Resampling.LANCZOS)
                    
                tile2 = ImageChops.offset(filled2, -x_off, -y_off)
                score2 = compute_seam_score(tile2)
                print(f"  [Make Seamless] SCORE: Overall={score2['overall']:.3f}")
                
                if score2["overall"] > best_score["overall"]:
                    best_tile = tile2
                    best_score = score2
        
        fixed_tile = best_tile

        print("  [Make Seamless] Base tile completed!")

        # 5. Save result
        result_name = f"seamless_tile_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        fixed_tile.save(result_path, 'PNG', quality=95)

        # 6. Database updates and response
        overall_score = best_score["overall"]
        score_pct = int(overall_score * 100)
        tile_seamless = 1 if overall_score >= 0.70 else 0
        resolution = 1 if (orig_w >= 1024 and orig_h >= 1024) else 0
        print_readiness = 1 if (tile_seamless and resolution) else 0
        color_balance = 1

        if overall_score >= 0.90:
            label = "A - Excellent"
            note = f"Perfect seamless tiling ({score_pct}% match)."
        elif overall_score >= 0.75:
            label = "B - Good"
            note = f"High-quality seamless tiling ({score_pct}% match)."
        elif overall_score >= 0.60:
            label = "C - Fair"
            note = f"Seamless tiling with minor edge variations ({score_pct}% match)."
        else:
            label = "D - Poor"
            note = f"Significant seam mismatch detected ({score_pct}% match)."

        conn = db()
        new_url = f'/results/{result_name}'
        now = datetime.utcnow().isoformat()
        
        # Update project hero and thumbnail
        conn.execute(
            "UPDATE projects SET hero_image_url = ?, thumbnail_url = ?, updated_at = ? WHERE id = ?",
            (new_url, new_url, now, project_id)
        )
        
        # Update/insert pattern health
        conn.execute(
            "INSERT INTO pattern_health (project_id, score, label, tile_seamless, color_balance, print_readiness, resolution, note) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(project_id) DO UPDATE SET "
            "score=excluded.score, label=excluded.label, tile_seamless=excluded.tile_seamless, "
            "color_balance=excluded.color_balance, print_readiness=excluded.print_readiness, "
            "resolution=excluded.resolution, note=excluded.note",
            (project_id, score_pct, label, tile_seamless, color_balance, print_readiness, resolution, note)
        )
        
        # Increment metrics
        metrics_db = conn.execute("SELECT versions, ai_generations FROM project_metrics WHERE project_id = ?", (project_id,)).fetchone()
        if metrics_db:
            conn.execute(
                "UPDATE project_metrics SET versions = versions + 1, ai_generations = ai_generations + 1 WHERE project_id = ?",
                (project_id,)
            )
            
        conn.commit()
        conn.close()

        # Log export
        input_fn = filename if filename else (image_url.split('/')[-1] if image_url else None)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=input_fn,
            tool_type="Seamless Fix",
            settings_dict={"input_image": input_fn or image_url}
        )

        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                user_id = None

        total_credits = sum(c[1] for c in replicate_calls) if replicate_calls else 20
        record_activity(project_id, 'generation', 1, total_credits, user_id=user_id)

        return jsonify({
            'success': True,
            'resultUrl': new_url,
            'health': {
                'score': score_pct,
                'label': label,
                'tileSeamless': bool(tile_seamless),
                'colorBalance': bool(color_balance),
                'printReadiness': bool(print_readiness),
                'resolution': bool(resolution),
                'note': note
            }
        })

    except Exception as e:
        print(f"  [Make Seamless] Error: {e}")
        return jsonify({'error': str(e)}), 500


# --------------- Create Repeat Set (PIL tiling — server-side) ---------------
@app.route('/api/create-repeat-set', methods=['POST'])
def create_repeat_set():
    """
    Takes an image (uploaded or a URL from seamless result) and a grid size,
    generates a real tiled image using PIL, saves it, and returns the URL.
    Expects JSON: { filename, imageUrl, gridSize }
    - filename: local uploaded file name (used if imageUrl not provided)
    - imageUrl: URL of a remote image (e.g. from seamless result)
    - gridSize: e.g. 3 for 3x3 tiling
    - dpi: output DPI (default 300)
    - format: output format — PNG, JPG, or TIFF (default PNG)
    """
    import requests as http_requests
    from PIL import Image
    from io import BytesIO

    data = request.get_json()
    filename = data.get('filename', '')
    image_url = data.get('imageUrl', '')
    grid_size = int(data.get('gridSize', 3))
    scale = float(data.get('scale', 100)) / 100.0
    repeat_type = data.get('repeatType', 'block')
    dpi = int(data.get('dpi', 300))
    out_format = data.get('format', 'PNG').upper()

    # Clamp grid size
    grid_size = max(2, min(grid_size, 6))

    try:
        # Load the source image
        if image_url and image_url.startswith('http'):
            print(f"  [Repeat Set] Downloading image from URL...")
            resp = http_requests.get(image_url, timeout=30)
            img = Image.open(BytesIO(resp.content))
        elif filename:
            filepath = os.path.join(UPLOAD_DIR, filename)
            if not os.path.exists(filepath):
                # Fallback: check results directory (for pipeline chaining)
                filepath = os.path.join(RESULTS_DIR, filename)
            if not os.path.exists(filepath):
                return jsonify({'error': 'File not found'}), 404
            img = Image.open(filepath)
        else:
            return jsonify({'error': 'Provide either filename or imageUrl'}), 400

        if img.mode != 'RGB':
            img = img.convert('RGB')

        width, height = img.size
        print(f"  [Repeat Set] Creating {grid_size}x{grid_size} tile ({repeat_type}) from {width}x{height} image (scaled to {scale})...")

        if scale != 1.0:
            draw_w = int(width * scale)
            draw_h = int(height * scale)
            img = img.resize((draw_w, draw_h), Image.Resampling.LANCZOS)
            print(f"  [Repeat Set] Scaled image to {draw_w}x{draw_h}")
            width, height = img.size

        tiled = Image.new('RGB', (width * grid_size, height * grid_size), color='#fbfaf7')
        
        # Paste the tiled image according to repeatType
        expand = 2
        for row in range(-expand, grid_size + expand):
            for col in range(-expand, grid_size + expand):
                if repeat_type == 'half_brick':
                    offset = (width // 2) if abs(row) % 2 else 0
                    tiled.paste(img, (col * width + offset, row * height))
                elif repeat_type == 'half_drop':
                    offset = (height // 2) if abs(col) % 2 else 0
                    tiled.paste(img, (col * width, row * height + offset))
                elif repeat_type == 'mirror':
                    from PIL import ImageOps
                    flip_x = abs(col) % 2
                    flip_y = abs(row) % 2
                    mirrored = img
                    if flip_x:
                        mirrored = ImageOps.mirror(mirrored)
                    if flip_y:
                        mirrored = ImageOps.flip(mirrored)
                    tiled.paste(mirrored, (col * width, row * height))
                else:
                    tiled.paste(img, (col * width, row * height))

        # Save result in the requested format with DPI metadata
        if out_format == 'JPG' or out_format == 'JPEG':
            ext = 'jpg'
            save_format = 'JPEG'
        elif out_format == 'TIFF':
            ext = 'tiff'
            save_format = 'TIFF'
        else:
            ext = 'png'
            save_format = 'PNG'

        result_name = f"repeat_{grid_size}x{grid_size}_{uuid.uuid4().hex[:8]}.{ext}"
        result_path = os.path.join(RESULTS_DIR, result_name)
        tiled.save(result_path, save_format, quality=95, dpi=(dpi, dpi))

        print(f"  [Repeat Set] Saved: {result_name} ({tiled.size[0]}x{tiled.size[1]}) @ {dpi} DPI as {save_format}")

        project_id = int(data.get('projectId', 1))
        record_activity(project_id, 'export', 1, 50)

        # Log export
        input_fn = filename if filename else (image_url.split('/')[-1] if image_url else None)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=input_fn,
            tool_type="Repeat Set",
            settings_dict={
                "gridSize": grid_size,
                "scale": scale,
                "repeatType": repeat_type,
                "dpi": dpi,
                "format": save_format
            }
        )

        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            'gridSize': grid_size,
            'dimensions': f'{tiled.size[0]}x{tiled.size[1]}',
            'dpi': dpi,
            'format': save_format,
        })

    except Exception as e:
        print(f"  [Repeat Set] Error: {e}")
        return jsonify({'error': str(e)}), 500


# --------------- Vectorize (vtracer Local / Recraft API) ---------------
@app.route('/api/vectorize', methods=['POST'])
def vectorize_image():
    """
    Vectorizes a raster image to SVG.
    - engine='local': Uses vtracer (Rust-based, multi-color, runs locally)
    - engine='api': Uses recraft-ai/recraft-vectorize on Replicate ($0.01/run)
    Expects JSON: { filename, engine, numColors, removeBg, projectId, userId }
    """
    import requests as http_requests
    from io import BytesIO
    import time
    import base64

    data = request.get_json()
    filename = data.get('filename', '')
    image_url = data.get('imageUrl', '')
    engine = data.get('engine', 'local')
    num_colors = int(data.get('numColors', 32))
    remove_bg = data.get('removeBg', False)
    project_id = int(data.get('projectId', 1))

    # Resolve filepath from filename or imageUrl
    filepath = None
    PUBLIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'public')
    if filename:
        filepath = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(filepath):
            # Fallback: check public/ folder (for demo images like demo_floral.png)
            filepath = os.path.join(PUBLIC_DIR, filename)
            if not os.path.exists(filepath):
                return jsonify({'error': f'File not found: {filename}'}), 404
    elif image_url and image_url.startswith('http'):
        # Download remote image to a temp file
        print(f"  [Vectorize] Downloading image from URL...")
        resp = http_requests.get(image_url, timeout=30)
        ext = '.png' if 'png' in image_url.lower() else '.jpg'
        filename = f"tmp_vec_{uuid.uuid4().hex[:8]}{ext}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        with open(filepath, 'wb') as f:
            f.write(resp.content)
    else:
        return jsonify({'error': 'Provide either filename or imageUrl'}), 400

    credits_used = 5  # local engine default
    try:
        if engine == 'api':
            # ---- Recraft AI Vectorize (Replicate) ----
            print(f"  [Vectorize] Using recraft-ai/recraft-vectorize API...")

            with open(filepath, "rb") as img_file:
                encoded_string = base64.b64encode(img_file.read()).decode('utf-8')
                mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
                data_uri = f"data:{mime_type};base64,{encoded_string}"

            start_time = time.time()
            output = replicate.run(
                "recraft-ai/recraft-vectorize",
                input={"image": data_uri}
            )
            duration = time.time() - start_time
            credits_used = 100  # Recraft API / Vectorize Replicate flat
            cost_usd = duration * 0.00115  # standard GPU-based logging estimation
            log_replicate_call(project_id, "recraft-ai/recraft-vectorize", duration, credits_used, cost_usd)

            # Download the SVG result
            svg_url = str(output.url) if hasattr(output, 'url') else str(output)
            print(f"  [Vectorize] Downloading SVG from {svg_url[:60]}...")

            result_name = f"vec_{uuid.uuid4().hex[:8]}.svg"
            result_path = os.path.join(RESULTS_DIR, result_name)

            try:
                with open(result_path, "wb") as f:
                    f.write(output.read())
            except (AttributeError, TypeError):
                resp = http_requests.get(svg_url, timeout=30)
                with open(result_path, "wb") as f:
                    f.write(resp.content)

            print(f"  [Vectorize] Recraft done! Saved: {result_name}")

        else:
            # ---- vtracer Local ----
            import vtracer
            from PIL import Image as PILImage

            print(f"  [Vectorize] Using vtracer local engine (colors={num_colors})...")

            # vtracer crashes if file extension doesn't match actual format
            # (e.g. JPEG data in a .png file). Re-save through PIL as clean PNG.
            tmp_name = f"_vtracer_tmp_{uuid.uuid4().hex[:6]}.png"
            tmp_path = os.path.abspath(os.path.join(UPLOAD_DIR, tmp_name))
            img = PILImage.open(filepath).convert('RGB')
            img.save(tmp_path, format="PNG")
            print(f"  [Vectorize] Normalized to PNG: {img.size}, {os.path.getsize(tmp_path)//1024}KB")

            result_name = f"vec_{uuid.uuid4().hex[:8]}.svg"
            result_path = os.path.abspath(os.path.join(RESULTS_DIR, result_name))

            # Map numColors slider (2-256) to vtracer parameters
            # Higher slider = more detail: higher color_precision, lower filter_speckle
            import math
            # color_precision: 3 (low detail) to 8 (max detail)
            color_precision = min(8, max(3, round(3 + 5 * math.log(num_colors, 256))))
            # filter_speckle: 1 (keep everything) to 10 (aggressive cleanup)
            filter_speckle = max(1, round(10 - 9 * math.log(num_colors, 256)))
            print(f"  [Vectorize] Params: color_precision={color_precision}, filter_speckle={filter_speckle}")

            vtracer.convert_image_to_svg_py(
                image_path=tmp_path,
                out_path=result_path,
                colormode="color",
                hierarchical="stacked",
                mode="spline",
                filter_speckle=filter_speckle,
                color_precision=color_precision,
                layer_difference=16,
                corner_threshold=60,
                length_threshold=4.0,
                max_iterations=10,
                splice_threshold=45,
                path_precision=3,
            )

            # Cleanup temp file
            os.remove(tmp_path)
            credits_used = 5  # CPU edits (local PIL fixes) flat

            print(f"  [Vectorize] vtracer done! Saved: {result_name} ({os.path.getsize(result_path) // 1024}KB)")

        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                user_id = None

        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)

        # Log export
        input_fn = filename if filename else (image_url.split('/')[-1] if image_url else None)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=input_fn,
            tool_type="Vectorize",
            settings_dict={
                "engine": engine,
                "numColors": num_colors,
                "removeBg": remove_bg
            }
        )

        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}'
        })

    except Exception as e:
        print(f"  [Vectorize] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Vectorization failed: {str(e)}'}), 500


# --------------- Upscale (Super Resolution) ---------------
@app.route('/api/upscale', methods=['POST'])
def upscale():
    data = request.get_json()
    filename = data.get('filename', '')
    upscale_factor = data.get('upscaleFactor', 'x4')
    
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404

    try:
        import base64
        import uuid
        import time
        
        print(f"  [Upscale] Processing {filename} with google/upscaler ({upscale_factor})...")
        
        with open(filepath, "rb") as img_file:
            image_bytes = img_file.read()
            encoded_string = base64.b64encode(image_bytes).decode('utf-8')
            mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
            data_uri = f"data:{mime_type};base64,{encoded_string}"

        start_time = time.time()
        output = replicate.run(
            "google/upscaler",
            input={
                "image": data_uri,
                "upscale_factor": upscale_factor
            }
        )
        duration = time.time() - start_time
        credits_used = max(10, int(round(duration * 12)))
        cost_usd = duration * 0.00115

        project_id = int(data.get('projectId', 1))
        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                user_id = None

        log_replicate_call(project_id, "google/upscaler", duration, credits_used, cost_usd)

        result_name = f"upscale_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        
        try:
            with open(result_path, "wb") as file:
                file.write(output.read())
        except AttributeError:
            # Fallback if output is just a URL string or list
            import requests as http_requests
            url = output[0] if isinstance(output, list) else str(output)
            resp = http_requests.get(url)
            with open(result_path, "wb") as file:
                file.write(resp.content)

        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)

        # Log export
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=filename,
            tool_type="Super Resolution",
            settings_dict={
                "upscaleFactor": upscale_factor
            }
        )

        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}'
        })

    except Exception as e:
        print(f"  [Upscale] Error: {e}")
        return jsonify({'error': f'Failed to upscale image: {str(e)}'}), 500


# --------------- Download Proxy ---------------
@app.route('/api/download')
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

    # For remote URLs (like replicate.delivery)
    import requests as http_requests
    from flask import Response
    
    try:
        print(f"  [Download Proxy] Streaming from {url}...")
        resp = http_requests.get(url, stream=True, timeout=30)
        resp.raise_for_status()
        
        filename = url.split('/')[-1]
        if '?' in filename:
            filename = filename.split('?')[0]
        if not filename:
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
        return f'Failed to proxy download: {str(e)}', 500


# --------------- Serve uploaded & result files ---------------
@app.route('/uploads/<filename>')
def serve_upload(filename):
    return send_from_directory(UPLOAD_DIR, filename)

@app.route('/results/<filename>')
def serve_result(filename):
    mimetype = 'image/svg+xml' if filename.endswith('.svg') else None
    return send_from_directory(RESULTS_DIR, filename, mimetype=mimetype)

@app.route('/results/previews/<filename>')
def serve_preview(filename):
    previews_dir = os.path.join(RESULTS_DIR, 'previews')
    return send_from_directory(previews_dir, filename)


# --------------- Exports ---------------
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

@app.route('/api/exports')
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


@app.route('/api/exports', methods=['DELETE'])
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

# --------------- Projects CRUD ---------------
@app.route('/api/projects', methods=['POST'])
def create_project():
    data = request.get_json() or {}
    name = data.get('name', 'New Project')
    conn = db()
    now = datetime.utcnow().isoformat()
    cur = conn.execute(
        "INSERT INTO projects (name, status, thumbnail_url, hero_image_url, updated_at) VALUES (?, ?, ?, ?, ?)",
        (name, "Draft", "/demo_geometric.png", "/demo_geometric.png", now)
    )
    project_id = cur.lastrowid
    conn.execute("INSERT INTO project_metrics (project_id) VALUES (?)", (project_id,))
    conn.execute("INSERT INTO pattern_health (project_id, score, label, tile_seamless, color_balance, print_readiness, resolution, note) VALUES (?, 0, 'No Data', 0, 0, 0, 0, '')", (project_id,))
    conn.execute("INSERT INTO project_controls (project_id, updated_at) VALUES (?, ?)", (project_id, now))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'projectId': project_id})

@app.route('/api/projects/<int:project_id>', methods=['PUT'])
def update_project(project_id):
    data = request.get_json() or {}
    conn = db()
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
        vals.append(datetime.utcnow().isoformat())
        vals.append(project_id)
        conn.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/projects/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    conn = db()
    
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
            path = os.path.join(UPLOAD_DIR, url.split('/')[-1])
            if os.path.exists(path): os.remove(path)
        elif url.startswith('/results/'):
            path = os.path.join(RESULTS_DIR, url.split('/')[-1])
            if os.path.exists(path): os.remove(path)

    # 3. Database Cascade Delete
    conn.execute("DELETE FROM pattern_variations WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM project_metrics WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM pattern_health WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM project_controls WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM suggestions WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM pipeline_runs WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# --------------- Pipeline Runs ---------------
@app.route('/api/pipeline-runs', methods=['POST'])
def create_pipeline_run():
    """Create a new pipeline run record (status=running)."""
    data = request.get_json()
    now = datetime.utcnow().isoformat()
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


@app.route('/api/pipeline-runs/<int:run_id>', methods=['PATCH'])
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
        vals.append(datetime.utcnow().isoformat())
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


@app.route('/api/pipeline-runs')
def list_pipeline_runs():
    """List recent pipeline runs (newest first, max 20). Optionally filter by project_id."""
    project_id = request.args.get('project_id')
    conn = db()
    if project_id:
        rows = conn.execute(
            "SELECT * FROM pipeline_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 20",
            (project_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT 20"
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
@app.route('/api/workflows', methods=['POST'])
def save_workflow():
    """Save a workflow configuration."""
    data = request.get_json()
    now = datetime.utcnow().isoformat()
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


@app.route('/api/workflows')
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


@app.route('/api/workflows/<int:wf_id>', methods=['DELETE'])
def delete_workflow(wf_id):
    """Delete a saved workflow."""
    conn = db()
    conn.execute("DELETE FROM saved_workflows WHERE id = ?", (wf_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# --------------- Generate Mockup (Style Transfer) ---------------
@app.route('/api/generate-mockup', methods=['POST'])
def generate_mockup():
    """
    Uses fofr/style-transfer on Replicate to transfer a pattern/print onto a product
    template photo.
    Expects JSON: { patternFilename, patternUrl, productType, category, projectId }
    """
    import requests as http_requests
    import time

    data = request.get_json()
    pattern_filename = data.get('patternFilename', '')
    pattern_url = data.get('patternUrl', '')
    product_type = data.get('productType', '')
    category = data.get('category', '')
    project_id = int(data.get('projectId', 1))

    if not product_type:
        return jsonify({'error': 'productType is required'}), 400

    if not pattern_filename and not pattern_url:
        return jsonify({'error': 'patternFilename or patternUrl is required'}), 400

    style_image_file = None
    content_image_file = None
    try:
        # 1. Prepare style_image
        style_image_input = None
        if pattern_filename:
            filepath = os.path.join(UPLOAD_DIR, pattern_filename)
            if not os.path.exists(filepath):
                return jsonify({'error': 'Pattern file not found'}), 404
            style_image_file = open(filepath, 'rb')
            style_image_input = style_image_file
        elif pattern_url and pattern_url.startswith('http'):
            style_image_input = pattern_url
        else:
            return jsonify({'error': 'Provide either patternFilename or patternUrl'}), 400

        # 2. Load the product template image
        product_template_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            'public', 'products', f'{product_type}.png'
        )
        if not os.path.exists(product_template_path):
            return jsonify({'error': f'Product template not found for: {product_type}'}), 404

        content_image_file = open(product_template_path, 'rb')

        # 3. Call fofr/style-transfer with retry logic
        print(f"  [Generate Mockup] Running style-transfer for product '{product_type}'...")
        result_url = None
        credits_used = 0
        for attempt in range(3):
            try:
                if style_image_file:
                    style_image_file.seek(0)
                content_image_file.seek(0)
                t0 = time.time()
                output = replicate.run(
                    'fofr/style-transfer:f1023890703bc0a5a3a2c21b5e498833be5f6ef6e70e9daf6b9b3a4fd8309cf0',
                    input={
                        'style_image': style_image_input,
                        'content_image': content_image_file,
                        'style_strength': 0.75,
                        'output_quality': 90,
                    }
                )
                duration = time.time() - t0
                credits_used = max(10, int(round(duration * 12)))
                cost_usd = duration * 0.00115
                log_replicate_call(project_id, 'fofr/style-transfer', duration, credits_used, cost_usd)
                
                result_url = str(output[0].url) if isinstance(output, list) and len(output) > 0 else str(output)
                print(f"  [Generate Mockup] Style transfer done: {result_url[:80]}...")
                break
            except Exception as e:
                print(f"  [Generate Mockup] Attempt {attempt+1}/3 failed: {e}")
                if attempt < 2:
                    time.sleep((attempt + 1) * 10)
                else:
                    raise

        # 4. Download and save the result
        resp = http_requests.get(result_url, timeout=60)
        mockup_name = f"mockup_{uuid.uuid4().hex[:8]}.png"
        mockup_path = os.path.join(RESULTS_DIR, mockup_name)
        with open(mockup_path, 'wb') as f:
            f.write(resp.content)
        print(f"  [Generate Mockup] Saved mockup: {mockup_name}")

        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                user_id = None

        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)

        # Log export
        input_fn = pattern_filename if pattern_filename else (pattern_url.split('/')[-1] if pattern_url else None)
        log_export(
            project_id=project_id,
            filename=mockup_name,
            input_filename=input_fn,
            tool_type="Mappings",
            settings_dict={
                "productType": product_type,
                "category": category
            }
        )

        return jsonify({
            'success': True,
            'mockupUrl': f'/results/{mockup_name}',
            'productType': product_type,
        })

    except Exception as e:
        print(f"  [Generate Mockup] Error: {e}")
        return jsonify({'error': f'Failed to generate mockup: {str(e)}'}), 500
    finally:
        if style_image_file:
            style_image_file.close()
        if content_image_file:
            content_image_file.close()


# --------------- Generate Mockups Batch ---------------
@app.route('/api/generate-mockups-batch', methods=['POST'])
def generate_mockups_batch():
    """
    Batch version of generate-mockup. Transfers a pattern onto multiple product
    templates sequentially.
    Expects JSON: { patternFilename, products, category, projectId }
    """
    import requests as http_requests
    import time

    data = request.get_json()
    pattern_filename = data.get('patternFilename', '')
    products = data.get('products', [])
    category = data.get('category', '')
    project_id = int(data.get('projectId', 1))

    if not pattern_filename:
        return jsonify({'error': 'patternFilename is required'}), 400

    if not products or not isinstance(products, list):
        return jsonify({'error': 'products must be a non-empty list'}), 400

    pattern_image_file = None
    try:
        # 1. Open the pattern image once
        filepath = os.path.join(UPLOAD_DIR, pattern_filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'Pattern file not found'}), 404

        pattern_image_file = open(filepath, 'rb')

        # 2. Process each product
        mockups = []
        errors = []
        total_credits = 0
        for idx, product_type in enumerate(products):
            content_image_file = None
            try:
                print(f"  [Batch Mockup] Processing product {idx+1}/{len(products)}: {product_type}")

                # Load product template
                product_template_path = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'public', 'products', f'{product_type}.png'
                )
                if not os.path.exists(product_template_path):
                    errors.append({'productType': product_type, 'error': f'Template not found for: {product_type}'})
                    continue

                content_image_file = open(product_template_path, 'rb')

                # Call style-transfer with retry
                result_url = None
                for attempt in range(3):
                    try:
                        pattern_image_file.seek(0)
                        content_image_file.seek(0)
                        t0 = time.time()
                        output = replicate.run(
                            'fofr/style-transfer:f1023890703bc0a5a3a2c21b5e498833be5f6ef6e70e9daf6b9b3a4fd8309cf0',
                            input={
                                'style_image': pattern_image_file,
                                'content_image': content_image_file,
                                'style_strength': 0.75,
                                'output_quality': 90,
                            }
                        )
                        duration = time.time() - t0
                        credits_used = max(10, int(round(duration * 12)))
                        cost_usd = duration * 0.00115
                        log_replicate_call(project_id, 'fofr/style-transfer', duration, credits_used, cost_usd)
                        total_credits += credits_used

                        result_url = str(output[0].url) if isinstance(output, list) and len(output) > 0 else str(output)
                        print(f"  [Batch Mockup] Style transfer done for {product_type}: {result_url[:80]}...")
                        break
                    except Exception as e:
                        print(f"  [Batch Mockup] Attempt {attempt+1}/3 for {product_type} failed: {e}")
                        if attempt < 2:
                            time.sleep((attempt + 1) * 10)
                        else:
                            raise

                # Download and save
                resp = http_requests.get(result_url, timeout=60)
                mockup_name = f"mockup_{uuid.uuid4().hex[:8]}.png"
                mockup_path = os.path.join(RESULTS_DIR, mockup_name)
                with open(mockup_path, 'wb') as f:
                    f.write(resp.content)
                print(f"  [Batch Mockup] Saved mockup: {mockup_name}")

                mockups.append({
                    'productType': product_type,
                    'mockupUrl': f'/results/{mockup_name}',
                })

                # Rate-limit delay between requests
                if idx < len(products) - 1:
                    time.sleep(2)

            except Exception as e:
                print(f"  [Batch Mockup] Error for {product_type}: {e}")
                errors.append({'productType': product_type, 'error': str(e)})
            finally:
                if content_image_file:
                    content_image_file.close()

        if mockups:
            user_id = data.get('userId') or data.get('user_id')
            if user_id:
                try:
                    user_id = int(user_id)
                except ValueError:
                    user_id = None
            record_activity(project_id, 'generation', len(mockups), total_credits, user_id=user_id)

            # Log each mockup in the batch
            for m in mockups:
                mockup_fn = m['mockupUrl'].split('/')[-1]
                log_export(
                    project_id=project_id,
                    filename=mockup_fn,
                    input_filename=pattern_filename,
                    tool_type="Mappings",
                    settings_dict={
                        "productType": m['productType'],
                        "category": category,
                        "batch": True
                    }
                )

        return jsonify({
            'success': True,
            'mockups': mockups,
            'errors': errors,
        })

    except Exception as e:
        print(f"  [Batch Mockup] Error: {e}")
        return jsonify({'error': f'Failed to generate batch mockups: {str(e)}'}), 500
    finally:
        if pattern_image_file:
            pattern_image_file.close()


# --------------- Authentication & Administrator Endpoints ---------------

@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'success': False, 'error': 'Email and password are required'}), 400
        
    conn = db()
    try:
        user_row = conn.execute("SELECT * FROM users WHERE email = ?", (email.strip(),)).fetchone()
        if user_row:
            user = dict(user_row)
            if user['password'] == password:
                # Resolve resetDays
                try:
                    reset_at = datetime.fromisoformat(user["reset_at"])
                    reset_days = max(0, (reset_at.date() - datetime.utcnow().date()).days)
                except Exception:
                    reset_days = 30
                    
                user_payload = {
                    "id": user["id"],
                    "email": user["email"],
                    "role": user["role"],
                    "name": user["name"],
                    "initials": user["initials"],
                    "plan": user["plan"],
                    "creditsUsed": user["credits_used"],
                    "creditsLimit": user["credits_limit"],
                    "resetDays": reset_days,
                }
                return jsonify({'success': True, 'user': user_payload})
        return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
    except Exception as e:
        print(f"Error during login: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/admin/logs', methods=['GET'])
def admin_logs():
    conn = db()
    try:
        replicate_logs_rows = conn.execute("SELECT * FROM replicate_logs ORDER BY id DESC").fetchall()
        exports_rows = conn.execute("SELECT * FROM exports ORDER BY id DESC").fetchall()
        
        replicate_logs = rows_to_dicts(replicate_logs_rows)
        exports = rows_to_dicts(exports_rows)
        
        return jsonify({
            'success': True,
            'replicateLogs': replicate_logs,
            'exports': exports
        })
    except Exception as e:
        print(f"Error fetching admin logs: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/admin/users', methods=['GET'])
def admin_users():
    conn = db()
    try:
        users_rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
        users = []
        for row in users_rows:
            u = dict(row)
            try:
                reset_at = datetime.fromisoformat(u["reset_at"])
                reset_days = max(0, (reset_at.date() - datetime.utcnow().date()).days)
            except Exception:
                reset_days = 30
            users.append({
                "id": u["id"],
                "email": u["email"],
                "name": u["name"],
                "initials": u["initials"],
                "role": u["role"],
                "plan": u["plan"],
                "creditsUsed": u["credits_used"],
                "creditsLimit": u["credits_limit"],
                "resetDays": reset_days
            })
        return jsonify({'success': True, 'users': users})
    except Exception as e:
        print(f"Error fetching admin users: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/admin/adjust-credits', methods=['POST'])
def admin_adjust_credits():
    data = request.get_json() or {}
    user_id = data.get('userId')
    credits_limit = data.get('creditsLimit')
    
    if user_id is None or credits_limit is None:
        return jsonify({'success': False, 'error': 'userId and creditsLimit are required'}), 400
        
    try:
        user_id = int(user_id)
        credits_limit = int(credits_limit)
    except ValueError:
        return jsonify({'success': False, 'error': 'userId and creditsLimit must be integers'}), 400
        
    conn = db()
    try:
        cur = conn.execute("UPDATE users SET credits_limit = ? WHERE id = ?", (credits_limit, user_id))
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        return jsonify({'success': True, 'message': 'Credits limit updated successfully'})
    except Exception as e:
        print(f"Error adjusting credits: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()


# --------------- Health check ---------------
@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'service': 'RIM AI Backend'})


if __name__ == '__main__':
    port = int(os.getenv('PORT', 3001))
    print("=" * 50)
    print("  RIM AI Backend — Flask + Replicate")
    print(f"  http://localhost:{port}")
    print("=" * 50)
    app.run(host='0.0.0.0', port=port, debug=(os.getenv('FLASK_ENV') != 'production'))
