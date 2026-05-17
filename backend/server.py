import os
import uuid
import base64
import replicate
from groq import Groq
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

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
    Uses black-forest-labs/flux-2-flex via Replicate to redesign the uploaded image
    as a perfectly seamless repeating pattern tile.
    Expects JSON: { filename, description, count }
    - filename: the uploaded file name
    - description: user's text description of the image content/style
    - count: how many seamless variants to generate (default 3)
    """
    data = request.get_json()
    filename = data.get('filename', '')
    description = data.get('description', '')
    count = int(data.get('count', 3))
    creativity = int(data.get('creativity', 3))

    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404

    if not description:
        return jsonify({'error': 'Please provide a description of the image so the AI can recreate it as seamless'}), 400

    # Map creativity level to how much freedom the AI takes
    creativity_styles = {
        1: "Recreate this EXACTLY as-is but make it perfectly seamless. Do NOT change anything creatively.",
        2: "Recreate this very closely with only minor adjustments needed for seamless tiling.",
        3: "Recreate this faithfully but feel free to make balanced adjustments for perfect seamless tiling.",
        4: "Creatively reinterpret this design while keeping the same theme, make it a beautiful seamless tile.",
        5: "Boldly reimagine this design with maximum artistic freedom, creating a stunning seamless repeating pattern.",
    }

    style_instruction = creativity_styles.get(creativity, creativity_styles[3])

    # Build the seamless prompt using the user's image description + creativity
    seamless_prompt = (
        f"{style_instruction} "
        f"The image contains: {description}. "
        f"Blend all four edges naturally so it tiles without any visible seams or lines. "
        f"Keep it high quality and print-ready."
    )

    results = []
    errors = []

    for i in range(count):
        try:
            print(f"  [Make Seamless] Generating seamless variant {i+1}/{count}...")
            output = replicate.run(
                "black-forest-labs/flux-2-flex",
                input={"prompt": seamless_prompt, "output_format": "png"}
            )

            image_url = str(output.url) if hasattr(output, 'url') else str(output)
            results.append(image_url)
            print(f"  [Make Seamless] Variant {i+1} done: {image_url[:80]}...")

        except Exception as e:
            print(f"  [Make Seamless] Error on variant {i+1}: {e}")
            errors.append(str(e))

    project_id = data.get('projectId', 1)
    if results:
        record_activity(project_id, 'generation', len(results), len(results) * 20)

    return jsonify({
        'success': True,
        'seamlessVariants': results,
        'errors': errors
    })


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
    """
    import requests as http_requests
    from PIL import Image, ImageDraw
    from io import BytesIO
    import base64

    data = request.get_json()
    filename = data.get('filename', '')
    image_url = data.get('imageUrl', '')
    grid_size = int(data.get('gridSize', 3))
    inpaint = data.get('inpaint', False)
    h_brush = int(data.get('hBrush', 0))
    v_brush = int(data.get('vBrush', 0))

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
        print(f"  [Repeat Set] Creating {grid_size}x{grid_size} tile from {width}x{height} image...")

        tiled = Image.new('RGB', (width * grid_size, height * grid_size))
        for row in range(grid_size):
            for col in range(grid_size):
                tiled.paste(img, (col * width, row * height))

        mask_url = None

        if inpaint and (h_brush > 0 or v_brush > 0):
            print(f"  [Repeat Set] Inpainting seams with flux-fill-pro...")
            
            # 1. Generate Mask
            mask = Image.new('L', tiled.size, 0) # Black mask (preserve)
            draw = ImageDraw.Draw(mask)

            # Draw horizontal seam masks (white)
            for row in range(1, grid_size):
                y = row * height
                draw.rectangle([0, y - h_brush // 2, tiled.size[0], y + h_brush // 2], fill=255)
            
            # Draw vertical seam masks (white)
            for col in range(1, grid_size):
                x = col * width
                draw.rectangle([x - v_brush // 2, 0, x + v_brush // 2, tiled.size[1]], fill=255)

            # Save mask for debug/UI feedback
            mask_name = f"mask_{uuid.uuid4().hex[:8]}.png"
            mask_path = os.path.join(RESULTS_DIR, mask_name)
            mask.save(mask_path, 'PNG')
            mask_url = f'/results/{mask_name}'

            # 2. Convert tiled and mask to base64 Data URIs
            def img_to_data_uri(pil_img):
                buf = BytesIO()
                pil_img.save(buf, format="PNG")
                b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
                return f"data:image/png;base64,{b64}"

            tiled_uri = img_to_data_uri(tiled)
            mask_uri = img_to_data_uri(mask)

            # 3. Get LLM description of the single tile
            print("  [Repeat Set] Describing base tile with Groq LLM...")
            tile_uri = img_to_data_uri(img)
            completion = groq_client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": tile_uri}},
                            {"type": "text", "text": "Describe this fabric pattern in detail (colors, shapes, style). Keep it under 2 sentences."}
                        ]
                    }
                ],
                temperature=0.3,
                max_completion_tokens=256,
            )
            description = completion.choices[0].message.content.strip()
            print(f"  [Repeat Set] Description: {description}")

            # 4. Inpaint using flux-fill-pro
            print("  [Repeat Set] Running flux-fill-pro via Replicate...")
            output = replicate.run(
                "black-forest-labs/flux-fill-pro",
                input={
                    "image": tiled_uri,
                    "mask": mask_uri,
                    "prompt": f"A perfectly seamless repeating pattern of {description}. Seamlessly blend the seams.",
                    "output_format": "png",
                    "steps": 50,
                    "guidance": 60
                }
            )
            
            filled_url = str(output)
            print(f"  [Repeat Set] Downloading filled image from {filled_url[:50]}...")
            filled_resp = http_requests.get(filled_url)
            tiled = Image.open(BytesIO(filled_resp.content))

        # Save result
        result_name = f"repeat_{grid_size}x{grid_size}_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        tiled.save(result_path, 'PNG', quality=95)

        print(f"  [Repeat Set] Saved: {result_name} ({tiled.size[0]}x{tiled.size[1]})")

        project_id = data.get('projectId', 1)
        record_activity(project_id, 'export', 1, 50)

        response_data = {
            'success': True,
            'resultUrl': f'/results/{result_name}',
            'gridSize': grid_size,
            'dimensions': f'{tiled.size[0]}x{tiled.size[1]}'
        }
        if mask_url:
            response_data['maskUrl'] = mask_url

        return jsonify(response_data)

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
