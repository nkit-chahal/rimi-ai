"""Core make-seamless logic shared by HTTP route and background worker."""
import base64
import os
import random
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
from security_utils import media_access_token, safe_fetch_url
from config import RESULTS_DIR, UPLOAD_DIR, groq_client, GROQ_VISION_MODEL
from db import db
# Re-exported: callers and tests reach the metric through this module.
from seam_metrics import FLAT_FILL_MAX_RATIO, SEAMLESS_MAX_RATIO, band_texture_ratio, seam_continuity  # noqa: F401

# Width of the inpaint band across each seam, as a percentage of the tile's height/width.
# It was 22%, on both axes at once, which regenerated ~40% of the artwork: a redraw, not a seam
# fix. 15% is enough for flux-fill to reconnect motifs across a hard cut.
SEAM_BAND_PCT = 15


def cross_mask(width, height, band_pct, feather=True, arms=("h", "v")):
    """White band(s) through the centre (where a seam sits after a half offset), black elsewhere.
    "h" is the full-width band that heals the top/bottom seam, "v" the full-height band for the
    left/right one. flux-fill-pro inpaints white. Feathered so the composite blends at the edge.

    The pipeline heals one seam per pass. With both arms in one mask the model kept treating the
    blob where they cross as a placeholder and painted a grey badge with text into it.
    """
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    x_off, y_off = width // 2, height // 2
    h_brush = max(4, int(height * (band_pct / 100.0)))
    v_brush = max(4, int(width * (band_pct / 100.0)))
    if "h" in arms:
        draw.rectangle([0, y_off - h_brush // 2, width, y_off + h_brush // 2], fill=255)
    if "v" in arms:
        draw.rectangle([x_off - v_brush // 2, 0, x_off + v_brush // 2, height], fill=255)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=max(3, min(h_brush, v_brush) // 6)))
        arr = np.array(mask, dtype=np.float32)
        arr = np.clip(arr * 1.5, 0, 255).astype(np.uint8)
        mask = Image.fromarray(arr)
    return mask


def composite_patch(original, patched, mask):
    """Take the model's pixels only where the mask is white; keep the original everywhere else.

    Diffusion inpainting re-encodes the whole frame, so the "preserved" region comes back close
    but not identical, and softer every pass. Compositing keeps the artist's file byte-identical
    outside the seam band and absorbs any size change the model made.
    """
    if patched.size != original.size:
        patched = patched.resize(original.size, Image.Resampling.LANCZOS)
    return Image.composite(patched, original, mask)


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
        pre_score = seam_continuity(img)

        _description = []

        def describe_pattern():
            """Groq caption that anchors the inpaint prompt. Lazy and cached: a tile that is
            already seamless never runs a pass, so it should not pay for (or wait on) this."""
            if not _description:
                progress(18, "Analyzing pattern")
                tile_uri = img_to_data_uri(img.resize((512, 512), Image.Resampling.LANCZOS))
                completion = groq_client.chat.completions.create(
                    model=GROQ_VISION_MODEL,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": tile_uri}},
                            {"type": "text", "text": "Describe this fabric/textile print precisely: motif shapes, colors, background, and the artistic technique (e.g. watercolor, gouache, flat vector, block print, pencil). 2 sentences max."},
                        ],
                    }],
                    temperature=0.2,
                    max_completion_tokens=200,
                )
                _description.append(completion.choices[0].message.content.strip())
            return _description[0]

        def inpaint_pass(offset_img, mask_img, guidance, steps, stage_label, stage_pct):
            description = describe_pattern()
            progress(stage_pct, stage_label)
            # Describe the PICTURE, never the task. flux-fill renders text it is told about: the
            # previous prompt ("in the masked region ... so the tile repeats with no visible
            # seams") came back as a grey banner reading "MASKED IN ... TILE REGION" painted
            # straight across the seam. No "mask", "seam", "tile", "region", "repeat" in here.
            prompt = (
                f"{description} "
                "The design continues edge to edge as one dense all-over composition of the "
                "same motifs, in the same technique, palette and line weight throughout."
            )
            seed = random.randint(0, 2**31 - 1)
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
                        "seed": seed,
                    })
                    duration = time.time() - t0
                    credits_used = credit_requirement("seamless", 58)
                    log_replicate_call(project_id, "black-forest-labs/flux-fill-pro", duration, credits_used, 0.05)
                    resp_img = http_requests.get(str(output), timeout=60)
                    result_img = Image.open(BytesIO(resp_img.content))
                    if result_img.mode != "RGB":
                        result_img = result_img.convert("RGB")
                    return composite_patch(offset_img, result_img, mask_img)
                except Exception:
                    if attempt < 2:
                        time.sleep((attempt + 1) * 10)
                    else:
                        raise

        if pre_score["is_seamless"]:
            # Nothing to heal: return the tile as-is and don't bill for a model we never ran.
            best_tile, best_score = img, pre_score
            refund_credits(user_id, project_id, required_credits, note="Make seamless: tile already seamless")
        else:
            # The old code kept the ORIGINAL unless a healed tile beat it on a scorer that floored
            # to 0 for most real artwork. 0 is never > 0, so the model's output was discarded and
            # the user got their own file back, graded "D", after paying for two passes.
            # The healed tile is the result; the score only grades it.
            #
            # One seam per pass. Healing both at once put a big four-way junction in the mask
            # and flux-fill kept painting a grey badge with text into it; a single straight band
            # is an unambiguous "continue the picture across this gap".
            width, height = img.size
            x_off, y_off = width // 2, height // 2

            def heal_seam(tile, arm, stage_pct):
                """Heal one wrap seam ("h" = top/bottom, "v" = left/right). Retries once from the
                same input if the model painted a flat fill. Returns (tile, flat) where flat
                means both attempts failed."""
                dx, dy = (0, y_off) if arm == "h" else (x_off, 0)
                label = "Healing top/bottom seam" if arm == "h" else "Healing left/right seam"
                shifted = ImageChops.offset(tile, dx, dy)
                mask = cross_mask(width, height, SEAM_BAND_PCT, arms=(arm,))
                healed = ImageChops.offset(inpaint_pass(shifted, mask, 50, 40, label, stage_pct), -dx, -dy)
                ratio = band_texture_ratio(healed, SEAM_BAND_PCT, arms=(arm,))
                if ratio >= FLAT_FILL_MAX_RATIO:
                    return healed, False
                retried = ImageChops.offset(
                    inpaint_pass(shifted, mask, 50, 40, label + " (retry)", stage_pct + 8), -dx, -dy)
                retry_ratio = band_texture_ratio(retried, SEAM_BAND_PCT, arms=(arm,))
                best = retried if retry_ratio >= ratio else healed
                return best, max(ratio, retry_ratio) < FLAT_FILL_MAX_RATIO

            tile_h, flat_h = heal_seam(img, "h", 30)
            if flat_h:
                # Two flat fills on the first seam: don't spend another pass on a tile that is
                # already going to be graded D.
                best_tile, flat = tile_h, True
            else:
                best_tile, flat = heal_seam(tile_h, "v", 60)
            best_score = seam_continuity(best_tile)
            if flat:
                # A flat band wraps "perfectly", so the continuity score alone would call this
                # an A; don't let it.
                best_score = {**best_score, "is_seamless": False,
                              "overall": min(best_score["overall"], 0.4), "flat_fill": True}

        progress(88, "Saving result")
        fixed_tile = best_tile
        result_name = f"seamless_tile_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        fixed_tile.save(result_path, "PNG", quality=95)
        storage.sync_to_s3(result_path)

        overall_score = best_score["overall"]
        score_pct = int(overall_score * 100)
        # SEAMLESS_MAX_RATIO (1.5) decides whether to heal at all and is deliberately strict:
        # when in doubt, heal. The flag shown to the user must agree with the letter grade,
        # otherwise a tile can read "A - Excellent" and "not seamless" at once (a 1.53 ratio
        # did exactly that). B or better is seamless; a flat fill never is.
        tile_seamless = 1 if (overall_score >= 0.75 and not best_score.get("flat_fill")) else 0
        resolution = 1 if (orig_w >= 1024 and orig_h >= 1024) else 0
        print_readiness = 1 if (tile_seamless and resolution) else 0
        color_balance = 1
        if best_score.get("flat_fill"):
            label, note = "D - Poor", "The AI painted flat colour over the seam instead of continuing the design. Try running it again."
        elif overall_score >= 0.90:
            label, note = "A - Excellent", f"Perfect seamless tiling ({score_pct}% match)."
        elif overall_score >= 0.75:
            label, note = "B - Good", f"High-quality seamless tiling ({score_pct}% match)."
        elif overall_score >= 0.60:
            label, note = "C - Fair", f"Seamless tiling with minor edge variations ({score_pct}% match)."
        else:
            label, note = "D - Poor", f"Significant seam mismatch detected ({score_pct}% match)."

        if not pre_score["is_seamless"] and not best_score.get("flat_fill"):
            # ~30% of the tile is new paint. Say so; a print buyer should not assume the file is
            # the artist's pixels edge to edge.
            note += " The band along the tile edges was repainted by AI in the artwork's style."

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
            "fileAccessToken": media_access_token(result_name, user_id),
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
