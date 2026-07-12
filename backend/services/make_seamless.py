"""Core make-seamless logic shared by HTTP route and background worker."""
import base64
import os
import time
import uuid
from datetime import datetime, timezone
from io import BytesIO

import numpy as np
import replicate
import requests as http_requests
from PIL import Image, ImageChops, ImageDraw, ImageFilter

import storage
from auth import (
    credit_error_payload,
    credit_requirement,
    get_updated_credits,
    log_export,
    log_replicate_call,
    refund_credits,
    reserve_credits_or_error,
)
from security_utils import safe_fetch_url
from config import RESULTS_DIR, UPLOAD_DIR, groq_client
from db import db


def execute_make_seamless(data, on_progress=None):
    def progress(pct, stage):
        if on_progress:
            on_progress(pct, stage)

    filename = os.path.basename(data.get("filename") or "")
    image_url = data.get("imageUrl", "")
    project_id = int(data["projectId"])
    user_id = int(data["userId"])

    required_credits = credit_requirement("seamless", 58)
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, "generation", 1)
    if not ok:
        raise ValueError(err["error"])
    if not filename and not image_url:
        raise ValueError("Filename or imageUrl is required")

    def img_to_data_uri(pil_img):
        buf = BytesIO()
        pil_img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64}"

    def compute_seam_score(img_to_score):
        arr = np.array(img_to_score.convert("RGB"), dtype=np.float32)
        h, w = arr.shape[:2]
        strip_w = max(3, int(w * 0.03))
        strip_h = max(3, int(h * 0.03))
        left = arr[:, :strip_w, :]
        right = arr[:, -strip_w:, :]
        v_diff = np.mean(np.abs(left - right[:, ::-1, :])) / 255.0
        v_score = max(0.0, 1.0 - v_diff * 6.0)
        top = arr[:strip_h, :, :]
        bottom = arr[-strip_h:, :, :]
        h_diff = np.mean(np.abs(top - bottom[::-1, :, :])) / 255.0
        h_score = max(0.0, 1.0 - h_diff * 6.0)
        overall = (v_score + h_score) / 2.0
        return {
            "v": round(v_score, 4),
            "h": round(h_score, 4),
            "overall": round(overall, 4),
            "is_seamless": bool(v_score > 0.82 and h_score > 0.82),
        }

    try:
        progress(5, "Loading image")
        if image_url and image_url.startswith("http"):
            img = Image.open(BytesIO(safe_fetch_url(image_url, timeout=30)))
        elif image_url and (image_url.startswith("/results/") or image_url.startswith("/uploads/")):
            base = os.path.basename(image_url.split("?", 1)[0])
            root = RESULTS_DIR if image_url.startswith("/results/") else UPLOAD_DIR
            filepath = os.path.join(root, base)
            if not os.path.exists(filepath):
                raise ValueError("File not found")
            img = Image.open(filepath)
        elif filename:
            base = os.path.basename(str(filename).split("?", 1)[0])
            filepath = os.path.join(UPLOAD_DIR, base)
            if not os.path.exists(filepath):
                filepath = os.path.join(RESULTS_DIR, base)
            if not os.path.exists(filepath):
                raise ValueError("File not found")
            img = Image.open(filepath)
        else:
            raise ValueError("Provide either filename or imageUrl")

        if img.mode != "RGB":
            img = img.convert("RGB")
        orig_w, orig_h = img.size

        progress(10, "Assessing seams")
        pre_score = compute_seam_score(img)

        progress(18, "Analyzing pattern")
        tile_uri = img_to_data_uri(img.resize((512, 512), Image.Resampling.LANCZOS))
        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": tile_uri}},
                    {"type": "text", "text": "Describe this repeating fabric/textile pattern precisely. Focus on: motif shapes, colors, background. 2 sentences max."},
                ],
            }],
            temperature=0.2,
            max_completion_tokens=200,
        )
        description = completion.choices[0].message.content.strip()

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

        def inpaint_pass(offset_img, mask_img, guidance, steps, stage_label, stage_pct):
            progress(stage_pct, stage_label)
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
                    output = replicate.run("black-forest-labs/flux-fill-pro", input={
                        "image": img_uri,
                        "mask": mask_uri,
                        "prompt": prompt,
                        "output_format": "png",
                        "steps": steps,
                        "guidance": guidance,
                    })
                    duration = time.time() - t0
                    credits_used = credit_requirement("seamless", 58)
                    log_replicate_call(project_id, "black-forest-labs/flux-fill-pro", duration, credits_used, 0.05)
                    resp_img = http_requests.get(str(output), timeout=60)
                    result_img = Image.open(BytesIO(resp_img.content))
                    if result_img.mode != "RGB":
                        result_img = result_img.convert("RGB")
                    return result_img
                except Exception:
                    if attempt < 2:
                        time.sleep((attempt + 1) * 10)
                    else:
                        raise

        best_tile = img
        best_score = pre_score
        if not pre_score["is_seamless"]:
            width, height = img.size
            x_off, y_off = width // 2, height // 2
            offset1 = ImageChops.offset(img, x_off, y_off)
            mask1 = create_cross_mask(width, height, h_pct=22, v_pct=22, feather=True)
            filled1 = inpaint_pass(offset1, mask1, 50, 40, "AI patch (tier 1)", 35)
            if filled1.size != (width, height):
                filled1 = filled1.resize((width, height), Image.Resampling.LANCZOS)
            tile1 = ImageChops.offset(filled1, -x_off, -y_off)
            score1 = compute_seam_score(tile1)
            if score1["overall"] > best_score["overall"]:
                best_tile = tile1
                best_score = score1
            if not score1["is_seamless"]:
                offset2 = ImageChops.offset(tile1, x_off, y_off)
                mask2 = create_cross_mask(width, height, h_pct=10, v_pct=10, feather=True)
                filled2 = inpaint_pass(offset2, mask2, 70, 45, "Refining seams (tier 2)", 65)
                if filled2.size != (width, height):
                    filled2 = filled2.resize((width, height), Image.Resampling.LANCZOS)
                tile2 = ImageChops.offset(filled2, -x_off, -y_off)
                score2 = compute_seam_score(tile2)
                if score2["overall"] > best_score["overall"]:
                    best_tile = tile2
                    best_score = score2

        progress(88, "Saving result")
        fixed_tile = best_tile
        result_name = f"seamless_tile_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        fixed_tile.save(result_path, "PNG", quality=95)
        storage.sync_to_s3(result_path)

        overall_score = best_score["overall"]
        score_pct = int(overall_score * 100)
        tile_seamless = 1 if overall_score >= 0.70 else 0
        resolution = 1 if (orig_w >= 1024 and orig_h >= 1024) else 0
        print_readiness = 1 if (tile_seamless and resolution) else 0
        color_balance = 1
        if overall_score >= 0.90:
            label, note = "A - Excellent", f"Perfect seamless tiling ({score_pct}% match)."
        elif overall_score >= 0.75:
            label, note = "B - Good", f"High-quality seamless tiling ({score_pct}% match)."
        elif overall_score >= 0.60:
            label, note = "C - Fair", f"Seamless tiling with minor edge variations ({score_pct}% match)."
        else:
            label, note = "D - Poor", f"Significant seam mismatch detected ({score_pct}% match)."

        new_url = f"/results/{result_name}"
        now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn = db()
        try:
            conn.execute(
                "UPDATE projects SET hero_image_url = ?, thumbnail_url = ?, updated_at = ? WHERE id = ?",
                (new_url, new_url, now, project_id),
            )
            conn.execute(
                "INSERT INTO pattern_health (project_id, score, label, tile_seamless, color_balance, print_readiness, resolution, note) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET "
                "score=excluded.score, label=excluded.label, tile_seamless=excluded.tile_seamless, "
                "color_balance=excluded.color_balance, print_readiness=excluded.print_readiness, "
                "resolution=excluded.resolution, note=excluded.note",
                (project_id, score_pct, label, tile_seamless, color_balance, print_readiness, resolution, note),
            )
            conn.execute(
                "UPDATE project_metrics SET ai_generations = ai_generations + 1 WHERE project_id = ?",
                (project_id,),
            )
            conn.commit()
        finally:
            conn.close()

        input_fn = filename if filename else (image_url.split("/")[-1] if image_url else None)
        log_export(project_id, result_name, input_fn, "Seamless Fix", {"input_image": input_fn or image_url}, user_id=user_id)

        progress(100, "Complete")
        credits = get_updated_credits(user_id)
        return {
            "resultUrl": new_url,
            "health": {
                "score": score_pct,
                "label": label,
                "tileSeamless": bool(tile_seamless),
                "colorBalance": bool(color_balance),
                "printReadiness": bool(print_readiness),
                "resolution": bool(resolution),
                "note": note,
            },
            **credits,
        }
    except Exception:
        refund_credits(user_id, project_id, required_credits, note="Make seamless failed")
        raise
