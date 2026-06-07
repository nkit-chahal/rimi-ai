"""Seamless pattern routes: generate-seamless (FSTL text-to-image) and make-seamless (Flux Fill Pro inpainting)."""
import os
import uuid
import base64
import time
import numpy as np
import requests as http_requests
from io import BytesIO
from flask import Blueprint, request, jsonify
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageChops, ImageFilter

from config import UPLOAD_DIR, RESULTS_DIR, groq_client
from db import db
from auth import (
    check_credits, credit_error_payload, credit_requirement,
    record_activity, get_updated_credits, log_export, log_replicate_call,
)
import replicate
import storage

bp = Blueprint('seamless', __name__)


@bp.route('/api/generate-seamless', methods=['POST'])
def generate_seamless():
    data = request.get_json()
    user_prompt = data.get('prompt', '')
    count = min(4, max(1, int(data.get('count', 4))))
    creativity = int(data.get('creativity', 3))
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    image_url = data.get('imageUrl', '')
    project_id = int(data.get('projectId', 1))
    user_id = data.get('userId') or data.get('user_id')
    if user_id:
        try: user_id = int(user_id)
        except ValueError: user_id = None
    required_credits = credit_requirement('seamless_texture', 84)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403
    if not user_prompt:
        return jsonify({'error': 'Prompt is required'}), 400
    try:
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
            messages.append({"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": data_uri}},
                {"type": "text", "text": system_instruction}
            ]})
        else:
            messages.append({"role": "user", "content": system_instruction})
        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=messages, temperature=0.3 + (creativity * 0.12), max_completion_tokens=256,
        )
        designer_prompt = completion.choices[0].message.content.strip()
        print(f"  [Generate Seamless] Designer prompt: {designer_prompt[:120]}...")
        guidance_map = {1: 4.5, 2: 3.5, 3: 3.0, 4: 2.5, 5: 2.0}
        guidance = guidance_map.get(creativity, 3.0)
        print(f"  [Generate Seamless] Generating {count} seamless tiles (guidance={guidance})...")
        start_time = time.time()
        output = replicate.run(
            "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
            input={"prompt": f"FSTL {designer_prompt}, seamless repeating textile pattern, tileable",
                   "model": "dev", "aspect_ratio": "1:1", "num_outputs": count,
                   "num_inference_steps": 28, "guidance_scale": guidance, "output_format": "png"}
        )
        duration = time.time() - start_time
        cost_usd = duration * 0.001525
        credits_used = required_credits
        log_replicate_call(project_id, "replicate/seamless-texture", duration, credits_used, cost_usd)
        results = []
        best_url = None
        best_score = -1.0
        for idx, out_url in enumerate(output if isinstance(output, list) else [output]):
            url_str = str(out_url.url) if hasattr(out_url, 'url') else str(out_url)
            resp = http_requests.get(url_str, timeout=60)
            img = Image.open(BytesIO(resp.content)).convert('RGB')
            arr = np.array(img, dtype=np.float32)
            h, w = arr.shape[:2]
            seam_x = np.mean(np.abs(arr[:, 0, :] - arr[:, -1, :]))
            seam_y = np.mean(np.abs(arr[0, :, :] - arr[-1, :, :]))
            abs_score_x = max(0.0, 1.0 - seam_x / 50.0)
            abs_score_y = max(0.0, 1.0 - seam_y / 50.0)
            abs_score = (abs_score_x + abs_score_y) / 2.0
            diff_x = np.mean(np.abs(arr[:, 1:, :] - arr[:, :-1, :]))
            diff_y = np.mean(np.abs(arr[1:, :, :] - arr[:-1, :, :]))
            rx = seam_x / max(1e-5, diff_x)
            ry = seam_y / max(1e-5, diff_y)
            ratio_x = max(0.0, min(1.0, 1.0 - (rx - 1.5) / 4.0)) if rx > 1.5 else 1.0
            ratio_y = max(0.0, min(1.0, 1.0 - (ry - 1.5) / 4.0)) if ry > 1.5 else 1.0
            ratio_score = (ratio_x + ratio_y) / 2.0
            score = abs_score * 0.7 + ratio_score * 0.3
            result_name = f"seamless_gen_{uuid.uuid4().hex[:8]}.png"
            result_path = os.path.join(RESULTS_DIR, result_name)
            img.save(result_path, 'PNG')
            storage.sync_to_s3(result_path)
            local_url = f'/results/{result_name}'
            results.append({'url': local_url, 'remoteUrl': url_str, 'score': round(score, 3), 'index': idx})
            if score > best_score:
                best_score = score
                best_url = local_url
            print(f"  [Generate Seamless] Tile {idx+1}: score={score:.3f}")
        if best_url:
            conn = db()
            now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            conn.execute("UPDATE projects SET hero_image_url = ?, thumbnail_url = ?, updated_at = ? WHERE id = ?",
                         (best_url, best_url, now, project_id))
            score_pct = int(best_score * 100)
            tile_seamless = 1 if best_score >= 0.70 else 0
            label = "A - Excellent" if best_score >= 0.90 else "B - Good" if best_score >= 0.75 else "C - Fair" if best_score >= 0.60 else "D - Poor"
            note = f"Generated natively seamless tile ({score_pct}% match)."
            conn.execute(
                "INSERT INTO pattern_health (project_id, score, label, tile_seamless, color_balance, print_readiness, resolution, note) "
                "VALUES (?, ?, ?, ?, 1, ?, 1, ?) ON CONFLICT(project_id) DO UPDATE SET "
                "score=excluded.score, label=excluded.label, tile_seamless=excluded.tile_seamless, "
                "color_balance=excluded.color_balance, print_readiness=excluded.print_readiness, "
                "resolution=excluded.resolution, note=excluded.note",
                (project_id, score_pct, label, tile_seamless, 1 if tile_seamless else 0, note)
            )
            conn.commit()
            conn.close()
            best_filename = best_url.split('/')[-1]
            input_fn = filename if filename else (image_url.split('/')[-1] if image_url else None)
            log_export(project_id, best_filename, input_fn, "Seamless Fix",
                       {"prompt": designer_prompt, "creativity": creativity, "input_image": input_fn or image_url})
        record_activity(project_id, 'generation', count, credits_used, user_id=user_id)
        updated_credits = get_updated_credits(user_id)
        return jsonify({'success': True, 'tiles': results, 'bestUrl': best_url,
                        'bestScore': round(best_score, 3), 'designerPrompt': designer_prompt, **updated_credits})
    except Exception as e:
        print(f"  [Generate Seamless] Error: {e}")
        import traceback; traceback.print_exc()
        return jsonify({'error': f'Failed to generate seamless pattern: {str(e)}'}), 500


@bp.route('/api/make-seamless', methods=['POST'])
def make_seamless():
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    image_url = data.get('imageUrl', '')
    project_id = int(data.get('projectId', 1))
    user_id_raw = data.get('userId') or data.get('user_id')
    user_id_early = None
    if user_id_raw:
        try: user_id_early = int(user_id_raw)
        except ValueError: pass
    required_credits = credit_requirement('seamless', 58)
    ok, remaining, limit, used = check_credits(user_id_early, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403
    if not filename and not image_url:
        return jsonify({'error': 'Filename or imageUrl is required'}), 400
    try:
        if image_url and image_url.startswith('http'):
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
            left = arr[:, :strip_w, :]
            right = arr[:, -strip_w:, :]
            v_diff = np.mean(np.abs(left - right[:, ::-1, :])) / 255.0
            v_score = max(0.0, 1.0 - v_diff * 6.0)
            top = arr[:strip_h, :, :]
            bottom = arr[-strip_h:, :, :]
            h_diff = np.mean(np.abs(top - bottom[::-1, :, :])) / 255.0
            h_score = max(0.0, 1.0 - h_diff * 6.0)
            overall = (v_score + h_score) / 2.0
            return {"v": round(v_score, 4), "h": round(h_score, 4), "overall": round(overall, 4),
                    "is_seamless": bool(v_score > 0.82 and h_score > 0.82)}

        pre_score = compute_seam_score(img)
        print(f"  [Make Seamless] Pre-score: Overall={pre_score['overall']:.3f}")

        # LLM description
        tile_uri = img_to_data_uri(img.resize((512, 512), Image.Resampling.LANCZOS))
        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": tile_uri}},
                {"type": "text", "text": "Describe this repeating fabric/textile pattern precisely. Focus on: motif shapes, colors, background. 2 sentences max."}
            ]}], temperature=0.2, max_completion_tokens=200,
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

        replicate_calls = []

        def inpaint_pass(offset_img, mask_img, pass_num, guidance, steps):
            prompt = (f"A perfectly seamless, continuously repeating textile pattern. "
                      f"The design shows {description}. "
                      f"In the masked region, seamlessly continue and reconnect all motifs, "
                      f"lines, shapes, and background textures so the tile repeats perfectly "
                      f"with no visible seams, breaks, or discontinuities. "
                      f"Match the exact style, colors, line weights, and artistic technique.")
            img_uri = img_to_data_uri(offset_img)
            mask_uri = img_to_data_uri(mask_img)
            for attempt in range(3):
                try:
                    t0 = time.time()
                    output = replicate.run("black-forest-labs/flux-fill-pro", input={
                        "image": img_uri, "mask": mask_uri, "prompt": prompt,
                        "output_format": "png", "steps": steps, "guidance": guidance,
                    })
                    duration = time.time() - t0
                    # Per-call vendor cost for admin cost-log only. Actual user
                    # billing uses `required_credits` aggregated at end of route.
                    credits_used = credit_requirement('seamless', 58)
                    cost_usd = 0.05
                    log_replicate_call(project_id, "black-forest-labs/flux-fill-pro", duration, credits_used, cost_usd)
                    replicate_calls.append((duration, credits_used))
                    resp_img = http_requests.get(str(output), timeout=60)
                    result_img = Image.open(BytesIO(resp_img.content))
                    if result_img.mode != "RGB":
                        result_img = result_img.convert("RGB")
                    return result_img
                except Exception as e:
                    if attempt < 2:
                        time.sleep((attempt + 1) * 10)
                    else:
                        raise

        # Multi-pass pipeline
        best_tile = img
        best_score = pre_score
        if not pre_score["is_seamless"]:
            width, height = img.size
            x_off, y_off = width // 2, height // 2
            offset1 = ImageChops.offset(img, x_off, y_off)
            mask1 = create_cross_mask(width, height, h_pct=22, v_pct=22, feather=True)
            filled1 = inpaint_pass(offset1, mask1, pass_num=1, guidance=50, steps=40)
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
                filled2 = inpaint_pass(offset2, mask2, pass_num=2, guidance=70, steps=45)
                if filled2.size != (width, height):
                    filled2 = filled2.resize((width, height), Image.Resampling.LANCZOS)
                tile2 = ImageChops.offset(filled2, -x_off, -y_off)
                score2 = compute_seam_score(tile2)
                if score2["overall"] > best_score["overall"]:
                    best_tile = tile2
                    best_score = score2
        fixed_tile = best_tile
        result_name = f"seamless_tile_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        fixed_tile.save(result_path, 'PNG', quality=95)
        storage.sync_to_s3(result_path)
        overall_score = best_score["overall"]
        score_pct = int(overall_score * 100)
        tile_seamless = 1 if overall_score >= 0.70 else 0
        resolution = 1 if (orig_w >= 1024 and orig_h >= 1024) else 0
        print_readiness = 1 if (tile_seamless and resolution) else 0
        color_balance = 1
        if overall_score >= 0.90: label, note = "A - Excellent", f"Perfect seamless tiling ({score_pct}% match)."
        elif overall_score >= 0.75: label, note = "B - Good", f"High-quality seamless tiling ({score_pct}% match)."
        elif overall_score >= 0.60: label, note = "C - Fair", f"Seamless tiling with minor edge variations ({score_pct}% match)."
        else: label, note = "D - Poor", f"Significant seam mismatch detected ({score_pct}% match)."
        conn = db()
        new_url = f'/results/{result_name}'
        now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn.execute("UPDATE projects SET hero_image_url = ?, thumbnail_url = ?, updated_at = ? WHERE id = ?",
                     (new_url, new_url, now, project_id))
        conn.execute(
            "INSERT INTO pattern_health (project_id, score, label, tile_seamless, color_balance, print_readiness, resolution, note) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET "
            "score=excluded.score, label=excluded.label, tile_seamless=excluded.tile_seamless, "
            "color_balance=excluded.color_balance, print_readiness=excluded.print_readiness, "
            "resolution=excluded.resolution, note=excluded.note",
            (project_id, score_pct, label, tile_seamless, color_balance, print_readiness, resolution, note)
        )
        metrics_db = conn.execute("SELECT versions FROM project_metrics WHERE project_id = ?", (project_id,)).fetchone()
        if metrics_db:
            conn.execute("UPDATE project_metrics SET versions = versions + 1, ai_generations = ai_generations + 1 WHERE project_id = ?", (project_id,))
        conn.commit()
        conn.close()
        input_fn = filename if filename else (image_url.split('/')[-1] if image_url else None)
        log_export(project_id, result_name, input_fn, "Seamless Fix", {"input_image": input_fn or image_url})
        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try: user_id = int(user_id)
            except ValueError: user_id = None
        total_credits = required_credits
        record_activity(project_id, 'generation', 1, total_credits, user_id=user_id)
        updated_credits = get_updated_credits(user_id)
        return jsonify({'success': True, 'resultUrl': new_url, 'health': {
            'score': score_pct, 'label': label, 'tileSeamless': bool(tile_seamless),
            'colorBalance': bool(color_balance), 'printReadiness': bool(print_readiness),
            'resolution': bool(resolution), 'note': note}, **updated_credits})
    except Exception as e:
        print(f"  [Make Seamless] Error: {e}")
        return jsonify({'error': str(e)}), 500
