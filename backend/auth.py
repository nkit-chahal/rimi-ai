"""
Authentication, credit management, activity logging, and image utility helpers.
Extracted from server.py to be importable by all route modules.
"""
import os
import io
import json
import base64
from contextlib import contextmanager
from datetime import datetime, timezone

from flask import request

from db import db, db_lock
from jwt_tokens import decode_access_token


def resolve_user_id(user_id=None):
    """Resolve a billable user from an explicit id or the current bearer token."""
    if user_id:
        try:
            return int(user_id)
        except (TypeError, ValueError):
            pass

    auth_header = request.headers.get('Authorization', '') if request else ''
    if not auth_header.startswith('Bearer '):
        return None

    try:
        payload = decode_access_token(auth_header[7:].strip())
        resolved = payload.get('user_id')
        return int(resolved) if resolved else None
    except Exception:
        return None


def log_export(project_id, filename, input_filename, tool_type, settings_dict=None, pipeline_run_id=None, pipeline_steps_list=None, user_id=None):
    user_id = resolve_user_id(user_id)
    settings_json = json.dumps(settings_dict) if settings_dict is not None else '{}'
    pipeline_steps_json = json.dumps(pipeline_steps_list) if pipeline_steps_list is not None else None
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    image_url = f"/results/{filename}" if filename and not str(filename).startswith("/") else filename
    variation_name = f"{tool_type} · {created_at[:16].replace('T', ' ')}"

    with db_lock:
        conn = db()
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO exports 
                (user_id, project_id, filename, input_filename, tool_type, settings_json, pipeline_run_id, pipeline_steps_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, project_id, filename, input_filename, tool_type, settings_json, pipeline_run_id, pipeline_steps_json, created_at)
            )
            conn.execute(
                "UPDATE pattern_variations SET is_selected = 0 WHERE project_id = ?",
                (project_id,),
            )
            conn.execute(
                """
                INSERT INTO pattern_variations (project_id, name, image_url, is_selected, created_at, export_filename)
                VALUES (?, ?, ?, 1, ?, ?)
                """,
                (project_id, variation_name, image_url, created_at, filename),
            )
            conn.execute(
                "UPDATE project_metrics SET versions = versions + 1 WHERE project_id = ?",
                (project_id,),
            )
            conn.commit()
        except Exception as e:
            print(f"Error logging export: {e}")
        finally:
            conn.close()


def log_replicate_call(project_id, model_name, duration, credits, cost_usd, session_id=None, output_bytes=None):
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db_lock:
        conn = db()
        try:
            conn.execute(
                """
                INSERT INTO replicate_logs (
                    project_id, model_name, duration, credits, cost_usd, created_at,
                    session_id, output_bytes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (project_id, model_name, duration, credits, cost_usd, created_at, session_id, output_bytes),
            )
            conn.commit()
        except Exception as e:
            print(f"Error logging replicate call: {e}")
        finally:
            conn.close()


def check_credits(user_id, required_credits=1):
    """Check if a user has enough remaining credits. Returns (ok, remaining, limit, used)."""
    user_id = resolve_user_id(user_id)
    if not user_id:
        return False, 0, 0, 0
    try:
        required_credits = max(1, int(required_credits))
    except (TypeError, ValueError):
        required_credits = 1
    conn = db()
    try:
        user = conn.execute("SELECT credits_used, credits_limit FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return False, 0, 0, 0
        remaining = user["credits_limit"] - user["credits_used"]
        return remaining >= required_credits, remaining, user["credits_limit"], user["credits_used"]
    finally:
        conn.close()


def get_updated_credits(user_id):
    """Fetch a user's latest credits_used and credits_limit after a generation."""
    user_id = resolve_user_id(user_id)
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


def get_credit_price(tool_key, default=0):
    conn = db()
    try:
        row = conn.execute(
            "SELECT credits FROM credit_pricing WHERE tool_key = ? AND is_active = 1",
            (tool_key,),
        ).fetchone()
        if not row:
            return int(default)
        return int(row["credits"])
    except Exception:
        return int(default)
    finally:
        conn.close()


def credit_requirement(tool_key, default=1, quantity=1):
    try:
        quantity = max(1, int(quantity))
    except (TypeError, ValueError):
        quantity = 1
    return max(1, int(get_credit_price(tool_key, default)) * quantity)


def credit_error_payload(required, remaining, limit, used):
    return {
        "error": f"Insufficient AI credits. This action needs {required} credits, but you have {remaining} remaining.",
        "creditsUsed": used,
        "creditsLimit": limit,
        "creditsRequired": required,
        "creditsRemaining": remaining,
    }


def record_activity(project_id, activity_type='export', count=1, credits=50, user_id=None, note=None):
    """Atomically deduct credits and log activity. Raises ValueError if insufficient."""
    user_id = resolve_user_id(user_id)
    credits = int(credits)
    count = max(0, int(count))
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conn = db()
    try:
        if not user_id:
            raise ValueError("user_id is required to record billable activity")
        if credits <= 0:
            conn.commit()
            return

        user_update = conn.execute(
            """
            UPDATE users
            SET credits_used = credits_used + ?
            WHERE id = ? AND credits_used + ? <= credits_limit
            """,
            (credits, user_id, credits),
        )
        if user_update.rowcount != 1:
            user = conn.execute("SELECT credits_used, credits_limit FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ValueError("User not found for billable activity")
            remaining = user["credits_limit"] - user["credits_used"]
            raise ValueError(f"Insufficient AI credits. This action needs {credits} credits, but you have {remaining} remaining.")

        if activity_type == 'export' and count > 0:
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
        elif activity_type == 'generation' and count > 0:
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

        conn.execute(
            """
            INSERT INTO credit_transactions
            (user_id, project_id, transaction_type, credits, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, project_id, activity_type, -abs(credits), note or f"{activity_type} usage", now)
        )
        conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def refund_credits(user_id, project_id, credits, note='Operation failed — credits refunded'):
    """Refund previously reserved credits after a failed operation."""
    user_id = resolve_user_id(user_id)
    credits = int(credits)
    if credits <= 0 or not user_id:
        return
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db_lock:
        conn = db()
        try:
            conn.execute(
                """
                UPDATE users
                SET credits_used = CASE
                    WHEN credits_used >= ? THEN credits_used - ?
                    ELSE 0
                END
                WHERE id = ?
                """,
                (credits, credits, user_id),
            )
            conn.execute(
                """
                INSERT INTO credit_transactions
                (user_id, project_id, transaction_type, credits, note, created_at)
                VALUES (?, ?, 'refund', ?, ?, ?)
                """,
                (user_id, project_id, abs(credits), note, now),
            )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            print(f"Error refunding credits: {exc}")
        finally:
            conn.close()


def reserve_credits(user_id, project_id, credits, activity_type='generation', count=1, note=None):
    """Reserve credits atomically before an expensive operation."""
    record_activity(project_id, activity_type, count, credits, user_id=user_id, note=note or f"{activity_type} reserved")


def reserve_credits_or_error(user_id, project_id, credits, activity_type='generation', count=1):
    """Reserve credits; return (True, None) or (False, credit_error_payload dict)."""
    try:
        reserve_credits(user_id, project_id, credits, activity_type, count)
        return True, None
    except ValueError:
        ok, remaining, limit, used = check_credits(user_id, credits)
        return False, credit_error_payload(credits, remaining, limit, used)


def adjust_reserved_credits(user_id, project_id, reserved, actual, note='Partial success adjustment'):
    """Refund the difference when actual charge is less than reserved amount."""
    diff = int(reserved) - int(actual)
    if diff > 0:
        refund_credits(user_id, project_id, diff, note=note)


@contextmanager
def credit_guard(user_id, project_id, credits, activity_type='generation', count=1):
    """Context manager: reserve credits upfront, refund on any exception."""
    reserve_credits(user_id, project_id, credits, activity_type, count)
    try:
        yield
    except Exception:
        refund_credits(user_id, project_id, credits, note=f"{activity_type} failed — refunded")
        raise


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
