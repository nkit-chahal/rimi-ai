"""Seamless pattern routes: generate-seamless (FSTL text-to-image) and make-seamless (Flux Fill Pro inpainting)."""
import os
import uuid
import base64
import time
import numpy as np
import requests as http_requests
from io import BytesIO
from flask import Blueprint, request, jsonify, g
from middleware import login_required, project_access_from_payload
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageChops, ImageFilter

from config import UPLOAD_DIR, RESULTS_DIR, groq_client
from db import db
from auth import (
    check_credits, credit_error_payload, credit_requirement,
    record_activity, get_updated_credits, log_export, log_replicate_call,
)
from jobs import enqueue_or_run
from services.make_seamless import execute_make_seamless
from workers import run_generation_job
import replicate
import storage

bp = Blueprint('seamless', __name__)


@bp.route('/api/generate-seamless', methods=['POST'])
@login_required
def generate_seamless():
    data = request.get_json()
    user_prompt = data.get('prompt', '')
    count = min(4, max(1, int(data.get('count', 4))))
    creativity = int(data.get('creativity', 3))
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    image_url = data.get('imageUrl', '')
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']
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
@login_required
def make_seamless():
    data = request.get_json() or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']

    if data.get("async"):
        worker_payload = {**data, "userId": user_id, "projectId": project_id, "toolKey": "make-seamless"}
        job = enqueue_or_run(
            "make-seamless",
            user_id,
            project_id,
            worker_payload,
            run_generation_job,
            json.dumps(worker_payload),
        )
        return jsonify({"success": True, **job})

    try:
        result = execute_make_seamless({**data, "userId": user_id, "projectId": project_id})
        return jsonify({"success": True, **result})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 403
    except Exception as e:
        print(f"  [Make Seamless] Error: {e}")
        return jsonify({'error': str(e)}), 500
