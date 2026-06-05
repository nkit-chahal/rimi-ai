"""
Authentication, credit management, activity logging, and image utility helpers.
Extracted from server.py to be importable by all route modules.
"""
import os
import io
import json
import base64
from datetime import datetime, timezone

from db import db, db_lock


def log_export(project_id, filename, input_filename, tool_type, settings_dict=None, pipeline_run_id=None, pipeline_steps_list=None):
    settings_json = json.dumps(settings_dict) if settings_dict is not None else '{}'
    pipeline_steps_json = json.dumps(pipeline_steps_list) if pipeline_steps_list is not None else None
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    
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


def log_replicate_call(project_id, model_name, duration, credits, cost_usd):
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
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


def check_credits(user_id):
    """Check if a user has remaining credits. Returns (ok, remaining, limit, used)."""
    if not user_id:
        return True, 999999, 999999, 0
    conn = db()
    try:
        user = conn.execute("SELECT credits_used, credits_limit FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return True, 999999, 999999, 0
        remaining = user["credits_limit"] - user["credits_used"]
        return remaining > 0, remaining, user["credits_limit"], user["credits_used"]
    finally:
        conn.close()


def get_updated_credits(user_id):
    """Fetch a user's latest credits_used and credits_limit after a generation."""
    if not user_id:
        return {}
    conn = db()
    try:
        user = conn.execute("SELECT credits_used, credits_limit FROM users WHERE id = ?", (user_id,)).fetchone()
        if user:
            return {"creditsUsed": user["credits_used"], "creditsLimit": user["credits_limit"]}
        return {}
    finally:
        conn.close()


def record_activity(project_id, activity_type='export', count=1, credits=50, user_id=None):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
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
    
    if not user_id:
        user_id = 2
    conn.execute("UPDATE users SET credits_used = credits_used + ? WHERE id = ?", (credits, user_id))
    conn.execute(
        """
        INSERT INTO credit_transactions
        (user_id, project_id, transaction_type, credits, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, project_id, activity_type, -abs(int(credits)), f"{activity_type} usage", now)
    )
    conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    conn.commit()
    conn.close()


# ===== Image utility helpers =====

def save_rgba_content_layer(image_bytes, output_path, margin=8):
    """Save the visible alpha bounds of an RGBA layer and return placement metadata."""
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()

    if not bbox:
        empty = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
        empty.save(output_path, "PNG")
        return {"x": 0, "y": 0, "width": 1, "height": 1, "sourceWidth": img.width, "sourceHeight": img.height, "empty": True}

    left, top, right, bottom = bbox
    left = max(0, left - margin)
    top = max(0, top - margin)
    right = min(img.width, right + margin)
    bottom = min(img.height, bottom + margin)

    cropped = img.crop((left, top, right, bottom))
    cropped.save(output_path, "PNG")
    return {"x": left, "y": top, "width": cropped.width, "height": cropped.height, "sourceWidth": img.width, "sourceHeight": img.height, "empty": False}


def rgba_layer_to_green_matte(input_img, matte_color=(30, 215, 96)):
    """Composite an RGBA layer on the same green matte used by Qwen's RGBA edit demo."""
    from PIL import Image
    rgba = input_img.convert("RGBA")
    bg = Image.new("RGB", rgba.size, matte_color).convert("RGBA")
    return Image.alpha_composite(bg, rgba).convert("RGB")


def green_matte_to_rgba(input_img, matte_color=(30, 215, 96), preserve_alpha=None):
    """Recover transparency from Qwen's green-matte edit output."""
    from PIL import Image
    import numpy as np

    rgb_img = input_img.convert("RGB")
    rgb = np.asarray(rgb_img).astype(np.int32)
    matte = np.array(matte_color, dtype=np.int32)
    distance = np.sqrt(np.sum((rgb - matte) ** 2, axis=2))
    alpha = np.clip((distance - 18) * 255 / 70, 0, 255).astype(np.uint8)

    if preserve_alpha is not None:
        alpha = np.asarray(preserve_alpha.resize(rgb_img.size)).astype(np.uint8)

    rgba = np.dstack([np.asarray(rgb_img), alpha])
    rgba[alpha == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


_rmbg_model = None
_rmbg_transforms = None
_rmbg_device = None


def remove_background_with_rmbg(input_img):
    """Use briaai/RMBG-2.0 for alpha recovery when local ML dependencies are available."""
    global _rmbg_model, _rmbg_transforms, _rmbg_device

    try:
        import torch
        from torchvision import transforms
        from transformers import AutoModelForImageSegmentation
    except Exception as exc:
        print(f"  [RMBG] Optional dependencies unavailable, using chroma key fallback: {exc}")
        return None

    try:
        if _rmbg_model is None:
            _rmbg_device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"  [RMBG] Loading briaai/RMBG-2.0 on {_rmbg_device}...")
            _rmbg_model = AutoModelForImageSegmentation.from_pretrained(
                "briaai/RMBG-2.0", trust_remote_code=True
            ).eval().to(_rmbg_device)
            _rmbg_transforms = transforms.Compose([
                transforms.Resize((1024, 1024)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
            ])

        rgb_img = input_img.convert("RGB")
        input_tensor = _rmbg_transforms(rgb_img).unsqueeze(0).to(_rmbg_device)
        with torch.no_grad():
            pred = _rmbg_model(input_tensor)[-1].sigmoid().cpu()[0].squeeze()

        mask = transforms.ToPILImage()(pred).resize(rgb_img.size)
        rgba_img = rgb_img.convert("RGBA")
        rgba_img.putalpha(mask)
        return rgba_img
    except Exception as exc:
        print(f"  [RMBG] Cleanup failed, using chroma key fallback: {exc}")
        return None


def decode_data_url_image(data_url):
    from PIL import Image
    if not data_url:
        return None
    payload = data_url.split(',', 1)[1] if ',' in data_url else data_url
    return Image.open(io.BytesIO(base64.b64decode(payload)))
