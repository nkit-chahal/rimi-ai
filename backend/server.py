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
    """)
    project_count = conn.execute("SELECT COUNT(*) AS c FROM projects").fetchone()["c"]
    if project_count == 0:
        now = datetime.utcnow()
        reset_at = now + timedelta(days=12)
        conn.execute(
            "INSERT INTO users (id, name, initials, plan, credits_used, credits_limit, reset_at) VALUES (1, ?, ?, ?, ?, ?, ?)",
            ("Ankit Chahal", "AC", "Pro Plan", 8450, 20000, reset_at.isoformat()),
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

def get_studio_state(project_id=1):
    conn = db()
    user = dict(conn.execute("SELECT * FROM users WHERE id = 1").fetchone())
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

    return jsonify({'success': True, 'state': get_studio_state(project_id)})

def record_activity(project_id, activity_type='export', count=1, credits=50):
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
    conn.execute("UPDATE users SET credits_used = credits_used + ? WHERE id = 1", (credits,))
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
    Expects JSON: { filename, projectId }
    """
    import base64
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

        output = replicate.run(
            "openai/gpt-image-2",
            input={
                "prompt": "A perfectly flat, 2D seamless repeating pattern tile of the exact fabric design, motif, and colors seen in the input image. Extract the design out of the outfit. High resolution, perfectly flat texture.",
                "input_images": [data_uri],
                "aspect_ratio": "1:1"
            }
        )

        # output is typically a list of URLs
        image_urls = [str(url) for url in output] if isinstance(output, list) else [str(output)]
        print(f"  [Extract Design] Done! Generated {len(image_urls)} tiles.")

        project_id = data.get('projectId', 1)
        record_activity(project_id, 'generation', len(image_urls), len(image_urls) * 20)

        return jsonify({
            'success': True,
            'resultUrls': image_urls
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

    # 3. Call openai/gpt-image-2 for the requested variations
    results = []
    errors = []

    for i in range(count):
        try:
            print(f"  [Inspirations] Generating variant {i+1}/{count} using openai/gpt-image-2...")
            
            replicate_input = {
                "prompt": designer_prompt + " - flat 2D repeating fabric pattern tile texture.",
                "aspect_ratio": "1:1"
            }
            if data_uri:
                replicate_input["input_images"] = [data_uri]

            output = replicate.run(
                "openai/gpt-image-2",
                input=replicate_input
            )

            image_url = str(output[0].url) if isinstance(output, list) and len(output) > 0 else str(output)
            results.append(image_url)
            print(f"  [Inspirations] Variant {i+1} done: {image_url[:80]}...")

        except Exception as e:
            print(f"  [Inspirations] Replicate generation error on variant {i+1}: {e}")
            errors.append(str(e))

    project_id = data.get('projectId', 1)
    if results:
        record_activity(project_id, 'generation', len(results), len(results) * 20)

    return jsonify({
        'success': True,
        'variations': results,
        'errors': errors
    })


# --------------- Make Seamless (Flux-2-Flex via Replicate) ---------------
@app.route('/api/make-seamless', methods=['POST'])
def make_seamless():
    """
    Uses replicate/seamless-texture via Replicate with the 'Offset & Inpaint' 
    technique to convert an image into a perfectly seamless repeating tile.
    Expects JSON: { filename, imageUrl, hBrushPct, vBrushPct, projectId }
    """
    import base64
    from io import BytesIO
    import numpy as np
    from PIL import Image, ImageDraw, ImageChops, ImageFilter
    import requests as http_requests

    data = request.get_json()
    filename = data.get('filename', '')
    image_url = data.get('imageUrl', '')
    h_brush_pct = int(data.get('hBrushPct', 25))
    v_brush_pct = int(data.get('vBrushPct', 25))
    project_id = int(data.get('projectId', 1))

    if not filename and not image_url:
        return jsonify({'error': 'Filename or imageUrl is required'}), 400

    try:
        # Load the source image
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

        # 1. Get Style-Aware LLM description + pattern classification in one call
        print("  [Make Seamless] Describing & classifying pattern with Groq LLM...")
        tile_uri = img_to_data_uri(img)
        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": tile_uri}},
                        {"type": "text", "text": (
                            "Analyze this fabric/textile pattern. Provide TWO things:\n\n"
                            "1. DESCRIPTION: Describe the pattern in detail (motifs, colors, background, "
                            "artistic style like flat 2D vector, watercolor, hand-drawn, etc). Keep it under 2 sentences.\n\n"
                            "2. TYPE: Classify into exactly ONE category:\n"
                            "- organic (watercolor, loose floral, botanical, tossed motifs, painterly)\n"
                            "- structured (line-art floral, damask, block print, toile, chinoiserie, vine trails)\n"
                            "- geometric (stripes, checks, grids, lattice, regular shapes, polka dots)\n\n"
                            "Format your response exactly as:\n"
                            "DESCRIPTION: [your description]\n"
                            "TYPE: [organic/structured/geometric]"
                        )}
                    ]
                }
            ],
            temperature=0.2,
            max_completion_tokens=200,
        )
        llm_response = completion.choices[0].message.content.strip()
        print(f"  [Make Seamless] LLM Response: {llm_response}")

        # Parse description and type from response
        description = llm_response
        pattern_type = "organic"  # Default fallback
        if "DESCRIPTION:" in llm_response and "TYPE:" in llm_response:
            parts = llm_response.split("TYPE:")
            description = parts[0].replace("DESCRIPTION:", "").strip()
            type_str = parts[1].strip().lower()
            if "structured" in type_str:
                pattern_type = "structured"
            elif "geometric" in type_str:
                pattern_type = "geometric"
            else:
                pattern_type = "organic"
        elif "structured" in llm_response.lower():
            pattern_type = "structured"
        elif "geometric" in llm_response.lower():
            pattern_type = "geometric"

        print(f"  [Make Seamless] Description: {description}")
        print(f"  [Make Seamless] Pattern type: {pattern_type}")

        # 3. Per-type settings
        PATTERN_SETTINGS = {
            "organic": {
                "brush_pct": 8,
                "denoise": 0.40,
                "candidates": 4,
                "outside_change_max": 14.0,
                "min_quality": 0.80,
            },
            "structured": {
                "brush_pct": 4,
                "denoise": 0.25,
                "candidates": 4,
                "outside_change_max": 7.0,
                "min_quality": 0.82,
            },
            "geometric": {
                "brush_pct": 2,
                "denoise": 0.10,
                "candidates": 4,
                "outside_change_max": 3.0,
                "min_quality": 0.85,
            },
        }
        settings = PATTERN_SETTINGS[pattern_type]
        brush_pct = settings["brush_pct"]
        prompt_strength = settings["denoise"]
        num_candidates = settings["candidates"]
        outside_change_max = settings["outside_change_max"]
        min_quality = settings["min_quality"]

        print(f"  [Make Seamless] Settings: brush={brush_pct}% denoise={prompt_strength} "
              f"candidates={num_candidates} outside_max={outside_change_max} min_quality={min_quality}")

        # 4. Resize to aspect-ratio preserving dimensions (multiples of 64)
        max_dim = 1024
        if orig_w > orig_h:
            new_w = max_dim
            new_h = int(max_dim * (orig_h / orig_w))
        else:
            new_h = max_dim
            new_w = int(max_dim * (orig_w / orig_h))
            
        new_w = max(64, (new_w // 64) * 64)
        new_h = max(64, (new_h // 64) * 64)

        img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        x_offset, y_offset = new_w // 2, new_h // 2

        # --- Seam scoring helpers ---
        def compute_seam_score(tile_img):
            """Overall seam score (0-1, higher = better)."""
            a = np.array(tile_img.convert("RGB"), dtype=np.float32)
            dx = np.mean(np.abs(a[:, 1:, :] - a[:, :-1, :]))
            dy = np.mean(np.abs(a[1:, :, :] - a[:-1, :, :]))
            sx = np.mean(np.abs(a[:, 0, :] - a[:, -1, :]))
            sy = np.mean(np.abs(a[0, :, :] - a[-1, :, :]))
            rx = sx / max(1e-5, dx)
            ry = sy / max(1e-5, dy)
            cx = max(0.0, 1.0 - (rx - 1.0) / 2.0) if rx > 1.0 else 1.0
            cy = max(0.0, 1.0 - (ry - 1.0) / 2.0) if ry > 1.0 else 1.0
            return (cx + cy) / 2.0

        def compute_directional_scores(tile_img):
            """Returns (h_score, v_score) — horizontal and vertical seam scores separately."""
            a = np.array(tile_img.convert("RGB"), dtype=np.float32)
            dx = np.mean(np.abs(a[:, 1:, :] - a[:, :-1, :]))
            dy = np.mean(np.abs(a[1:, :, :] - a[:-1, :, :]))
            sx = np.mean(np.abs(a[:, 0, :] - a[:, -1, :]))  # left↔right = vertical seam
            sy = np.mean(np.abs(a[0, :, :] - a[-1, :, :]))  # top↔bottom = horizontal seam
            rx = sx / max(1e-5, dx)
            ry = sy / max(1e-5, dy)
            v_score = max(0.0, 1.0 - (rx - 1.0) / 2.0) if rx > 1.0 else 1.0
            h_score = max(0.0, 1.0 - (ry - 1.0) / 2.0) if ry > 1.0 else 1.0
            return h_score, v_score

        def compute_outside_mask_change(original, candidate, mask_img):
            """Detect if AI modified pixels outside the mask. Returns change ratio (lower = better)."""
            o = np.array(original, dtype=np.float32)
            c = np.array(candidate, dtype=np.float32)
            m = np.array(mask_img, dtype=np.float32) / 255.0
            outside = (1.0 - m)
            if outside.ndim == 2:
                outside = outside[:, :, np.newaxis]
            diff = np.abs(o - c) * outside
            return np.mean(diff)

        def qa_accept(score, outside_change, overall_orig):
            """QA: accept candidates better than original + within outside-mask limit."""
            if score <= overall_orig:
                return False, f"score {score:.3f} <= original {overall_orig:.3f}"
            if outside_change > outside_change_max:
                return False, f"outside-mask {outside_change:.1f} > {outside_change_max}"
            return True, "passed"

        # 5. PRE-CHECK: Skip AI if already seamless
        h_score_orig, v_score_orig = compute_directional_scores(img_resized)
        overall_orig = (h_score_orig + v_score_orig) / 2.0
        print(f"  [Make Seamless] Pre-check: H={h_score_orig:.3f} V={v_score_orig:.3f} Overall={overall_orig:.3f}")

        SKIP_THRESHOLD = 0.92
        need_h_fix = h_score_orig < SKIP_THRESHOLD
        need_v_fix = v_score_orig < SKIP_THRESHOLD
        ai_used = need_h_fix or need_v_fix

        if not ai_used:
            print("  [Make Seamless] Image is already seamless (both >= 0.92)! Skipping AI.")
            fixed_tile = img_resized.resize((orig_w, orig_h), Image.Resampling.LANCZOS)
        else:
            current_img = img_resized

            # --- PASS 1: Horizontal Seam Fix (only if H seam failed) ---
            if need_h_fix:
                print(f"  [Make Seamless] Pass 1: Horizontal seam fix (H={h_score_orig:.3f} < {SKIP_THRESHOLD})...")
                img_pass1_offset = ImageChops.offset(current_img, 0, y_offset)

                mask_h = Image.new('L', (new_w, new_h), 0)
                draw_h = ImageDraw.Draw(mask_h)
                v_brush = max(4, int(new_h * (brush_pct / 100.0)))
                draw_h.rectangle([0, y_offset - v_brush // 2, new_w, y_offset + v_brush // 2], fill=255)
                mask_h = mask_h.filter(ImageFilter.GaussianBlur(radius=max(3, v_brush // 6)))
                arr_h = np.array(mask_h, dtype=np.float32)
                arr_h = np.clip(arr_h * 1.5, 0, 255).astype(np.uint8)
                mask_h = Image.fromarray(arr_h)

                print(f"    [{pattern_type}] Generating {num_candidates} candidates (brush={brush_pct}%, denoise={prompt_strength})...")
                output_h = replicate.run(
                    "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
                    input={
                        "model": "dev",
                        "image": img_to_data_uri(img_pass1_offset),
                        "mask": img_to_data_uri(mask_h),
                        "prompt": f"FSTL {description}, seamless repeating pattern, tileable",
                        "prompt_strength": prompt_strength,
                        "guidance_scale": 3.0,
                        "num_outputs": num_candidates,
                        "num_inference_steps": 30,
                        "output_format": "png",
                    }
                )

                # QA: Score candidates with strict thresholds
                best_p1_img = None
                best_p1_score = -1.0
                for idx, out_url in enumerate(output_h if isinstance(output_h, list) else [output_h]):
                    resp_h = http_requests.get(str(out_url), timeout=60)
                    candidate = Image.open(BytesIO(resp_h.content)).convert('RGB')
                    score = compute_seam_score(candidate)
                    outside_change = compute_outside_mask_change(img_pass1_offset, candidate, mask_h)
                    accepted, reason = qa_accept(score, outside_change, overall_orig)
                    status = "" if accepted else f" [REJECTED: {reason}]"
                    if accepted and score > best_p1_score:
                        best_p1_score = score
                        best_p1_img = candidate
                    print(f"    P1 Candidate {idx+1}: score={score:.3f} outside={outside_change:.1f}{status}")

                if best_p1_img is not None:
                    print(f"  [Make Seamless] Pass 1 Best: {best_p1_score:.3f}")
                    current_img = ImageChops.offset(best_p1_img, 0, -y_offset)
                else:
                    print("  [Make Seamless] Pass 1: All candidates rejected, keeping original")
            else:
                print(f"  [Make Seamless] Pass 1: SKIPPED (H={h_score_orig:.3f} >= {SKIP_THRESHOLD})")

            # --- PASS 2: Vertical Seam Fix (only if V seam failed) ---
            if need_v_fix:
                print(f"  [Make Seamless] Pass 2: Vertical seam fix (V={v_score_orig:.3f} < {SKIP_THRESHOLD})...")
                img_pass2_offset = ImageChops.offset(current_img, x_offset, 0)

                mask_v = Image.new('L', (new_w, new_h), 0)
                draw_v = ImageDraw.Draw(mask_v)
                h_brush = max(4, int(new_w * (brush_pct / 100.0)))
                draw_v.rectangle([x_offset - h_brush // 2, 0, x_offset + h_brush // 2, new_h], fill=255)
                mask_v = mask_v.filter(ImageFilter.GaussianBlur(radius=max(3, h_brush // 6)))
                arr_v = np.array(mask_v, dtype=np.float32)
                arr_v = np.clip(arr_v * 1.5, 0, 255).astype(np.uint8)
                mask_v = Image.fromarray(arr_v)

                print(f"    [{pattern_type}] Generating {num_candidates} candidates (brush={brush_pct}%, denoise={prompt_strength})...")
                output_v = replicate.run(
                    "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
                    input={
                        "model": "dev",
                        "image": img_to_data_uri(img_pass2_offset),
                        "mask": img_to_data_uri(mask_v),
                        "prompt": f"FSTL {description}, seamless repeating pattern, tileable",
                        "prompt_strength": prompt_strength,
                        "guidance_scale": 3.0,
                        "num_outputs": num_candidates,
                        "num_inference_steps": 30,
                        "output_format": "png",
                    }
                )

                # QA: Score candidates with strict thresholds
                best_p2_img = None
                best_p2_score = -1.0
                for idx, out_url in enumerate(output_v if isinstance(output_v, list) else [output_v]):
                    resp_v = http_requests.get(str(out_url), timeout=60)
                    candidate = Image.open(BytesIO(resp_v.content)).convert('RGB')
                    score = compute_seam_score(candidate)
                    outside_change = compute_outside_mask_change(img_pass2_offset, candidate, mask_v)
                    accepted, reason = qa_accept(score, outside_change, overall_orig)
                    status = "" if accepted else f" [REJECTED: {reason}]"
                    if accepted and score > best_p2_score:
                        best_p2_score = score
                        best_p2_img = candidate
                    print(f"    P2 Candidate {idx+1}: score={score:.3f} outside={outside_change:.1f}{status}")

                if best_p2_img is not None:
                    print(f"  [Make Seamless] Pass 2 Best: {best_p2_score:.3f}")
                    current_img = ImageChops.offset(best_p2_img, -x_offset, 0)
                else:
                    print("  [Make Seamless] Pass 2: All candidates rejected, keeping original")
            else:
                print(f"  [Make Seamless] Pass 2: SKIPPED (V={v_score_orig:.3f} >= {SKIP_THRESHOLD})")

            # Resize back to original dimensions
            fixed_tile = current_img.resize((orig_w, orig_h), Image.Resampling.LANCZOS)

        print("  [Make Seamless] Base tile completed!")

        # 7. Save result
        result_name = f"seamless_tile_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        fixed_tile.save(result_path, 'PNG', quality=95)

        # 8. Compute mathematical seam quality metrics
        arr = np.array(fixed_tile.convert("RGB"), dtype=np.float32)
        diff_x_internal = np.mean(np.abs(arr[:, 1:, :] - arr[:, :-1, :]))
        diff_y_internal = np.mean(np.abs(arr[1:, :, :] - arr[:-1, :, :]))
        seam_x = np.mean(np.abs(arr[:, 0, :] - arr[:, -1, :]))
        seam_y = np.mean(np.abs(arr[0, :, :] - arr[-1, :, :]))
        
        ratio_x = seam_x / max(1e-5, diff_x_internal)
        ratio_y = seam_y / max(1e-5, diff_y_internal)
        
        score_x = max(0.0, 1.0 - (ratio_x - 1.0) / 2.0) if ratio_x > 1.0 else 1.0
        score_y = max(0.0, 1.0 - (ratio_y - 1.0) / 2.0) if ratio_y > 1.0 else 1.0
        overall_score = (score_x + score_y) / 2.0
        
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

        # 9. Update SQLite Database
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
        metrics = conn.execute("SELECT versions, ai_generations FROM project_metrics WHERE project_id = ?", (project_id,)).fetchone()
        if metrics:
            conn.execute(
                "UPDATE project_metrics SET versions = versions + 1, ai_generations = ai_generations + 1 WHERE project_id = ?",
                (project_id,)
            )
            
        conn.commit()
        conn.close()

        record_activity(project_id, 'generation', 1, 20)

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

        project_id = data.get('projectId', 1)
        record_activity(project_id, 'export', 1, 50)

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
    Expects JSON: { filename, engine, numColors, removeBg, projectId }
    """
    import requests as http_requests
    from io import BytesIO

    data = request.get_json()
    filename = data.get('filename', '')
    image_url = data.get('imageUrl', '')
    engine = data.get('engine', 'local')
    num_colors = int(data.get('numColors', 32))
    remove_bg = data.get('removeBg', False)

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

    try:
        if engine == 'api':
            # ---- Recraft AI Vectorize (Replicate) ----
            print(f"  [Vectorize] Using recraft-ai/recraft-vectorize API...")

            with open(filepath, "rb") as img_file:
                encoded_string = base64.b64encode(img_file.read()).decode('utf-8')
                mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
                data_uri = f"data:{mime_type};base64,{encoded_string}"

            output = replicate.run(
                "recraft-ai/recraft-vectorize",
                input={"image": data_uri}
            )

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

            print(f"  [Vectorize] vtracer done! Saved: {result_name} ({os.path.getsize(result_path) // 1024}KB)")

        project_id = data.get('projectId', 1)
        record_activity(project_id, 'generation', 1, 15)

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
        
        print(f"  [Upscale] Processing {filename} with google/upscaler ({upscale_factor})...")
        
        with open(filepath, "rb") as img_file:
            image_bytes = img_file.read()
            encoded_string = base64.b64encode(image_bytes).decode('utf-8')
            mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
            data_uri = f"data:{mime_type};base64,{encoded_string}"

        output = replicate.run(
            "google/upscaler",
            input={
                "image": data_uri,
                "upscale_factor": upscale_factor
            }
        )

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

        project_id = data.get('projectId', 1)
        record_activity(project_id, 'generation', 1, 30)

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
    Returns a list of all exported files in the results directory,
    sorted by newest first. Includes thumbnails, file size, and type.
    """
    try:
        if not os.path.exists(RESULTS_DIR):
            return jsonify({'success': True, 'exports': []})

        files = []
        skip_prefixes = ('mask_', 'test_', 'omnisvg_', 'thumb_', 'prev_')
        for filename in os.listdir(RESULTS_DIR):
            filepath = os.path.join(RESULTS_DIR, filename)
            if os.path.isfile(filepath):
                if filename.lower().startswith(skip_prefixes):
                    continue
                
                ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
                if ext not in ('png', 'jpg', 'jpeg', 'svg', 'tiff'):
                    continue

                is_vector = ext == 'svg'
                file_size = os.path.getsize(filepath)
                mtime = os.path.getmtime(filepath)
                
                # Generate compressed preview for raster images
                if is_vector:
                    preview_url = f'/results/{filename}'
                else:
                    preview_url = get_preview(filename)

                files.append({
                    'id': filename,
                    'imageUrl': f'/results/{filename}',
                    'previewUrl': preview_url,
                    'type': 'vector' if is_vector else 'image',
                    'format': ext.upper(),
                    'size': format_file_size(file_size),
                    'sizeBytes': file_size,
                    'timestamp': mtime
                })
        
        files.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return jsonify({'success': True, 'exports': files})
    except Exception as e:
        print(f"  [Exports] Error reading results directory: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/exports', methods=['DELETE'])
def delete_exports():
    """
    Deletes one or more export files from the results directory.
    Expects JSON: { filenames: ['file1.png', 'file2.png'] }
    """
    data = request.get_json()
    filenames = data.get('filenames', [])
    
    if not filenames:
        return jsonify({'error': 'No filenames provided'}), 400

    deleted = []
    errors = []
    for filename in filenames:
        # Sanitize: prevent path traversal
        safe_name = os.path.basename(filename)
        filepath = os.path.join(RESULTS_DIR, safe_name)
        if os.path.isfile(filepath):
            try:
                os.remove(filepath)
                deleted.append(safe_name)
                print(f"  [Exports] Deleted: {safe_name}")
            except Exception as e:
                errors.append(f"{safe_name}: {str(e)}")
        else:
            errors.append(f"{safe_name}: not found")

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
    data = request.get_json()
    conn = db()
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
