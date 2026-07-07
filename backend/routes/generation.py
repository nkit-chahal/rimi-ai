"""AI generation routes: describe image, extract design, generate inspirations."""
import json
import os
import uuid
import base64
import time
import concurrent.futures
import requests as http_requests
from flask import Blueprint, request, jsonify, g

from config import UPLOAD_DIR, RESULTS_DIR, groq_client, safe_filename
from middleware import login_required, project_access_from_payload
from auth import (
    adjust_reserved_credits,
    credit_error_payload,
    credit_requirement,
    get_updated_credits,
    log_export,
    log_replicate_call,
    refund_credits,
    reserve_credits_or_error,
)
from security_utils import safe_fetch_url, validate_external_url, media_access_token
import replicate
import storage
from jobs import enqueue_or_run
from workers import run_generation_job
from rate_limits import expensive_generation_rate_limit, generation_rate_limit

bp = Blueprint('generation', __name__)


def _resolve_extract_filepath(filename='', image_url=''):
    """Resolve a local uploads path from filename and/or imageUrl."""
    if not filename and image_url:
        filename = os.path.basename(image_url.split('?', 1)[0])
    filename = os.path.basename(filename) if filename else ''
    if not filename:
        raise ValueError('Filename is required')

    filepath = storage.get_file_path('uploads', filename)
    if filepath and os.path.exists(filepath):
        return filename, filepath

    filepath = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(filepath):
        return filename, filepath

    if image_url and image_url.startswith('http'):
        validate_external_url(image_url)
        ext = '.png' if '.png' in image_url.lower() else '.jpg'
        dl_name = f"tmp_extract_{uuid.uuid4().hex[:8]}{ext}"
        filepath = os.path.join(UPLOAD_DIR, dl_name)
        content = safe_fetch_url(image_url, timeout=30)
        with open(filepath, 'wb') as handle:
            handle.write(content)
        storage.sync_to_s3(filepath)
        return dl_name, filepath

    raise FileNotFoundError(f'File not found: {filename}')


@bp.route('/api/describe-image', methods=['POST'])
@login_required
def describe_image():
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    creativity = int(data.get('creativity', 3))
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404
    try:
        with open(filepath, 'rb') as f:
            image_bytes = f.read()
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')
        ext = filename.rsplit('.', 1)[1].lower()
        mime_map = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp'}
        mime_type = mime_map.get(ext, 'image/jpeg')
        print(f"  [Describe] Sending image to Groq Llama 4 Scout (Creativity: {creativity})...")
        creativity_guidelines = {
            1: "Describe this image in meticulous literal detail. Focus on reproducing the exact design, scale, motifs, layout, and colors. The description should be structured so that an AI image generator can recreate this exact pattern as a seamless repeating tile with absolute fidelity.",
            2: "Describe this image in close detail. Focus on reproducing the key motifs, color palettes, and overall style closely, allowing only minor refinements for repeating tiles.",
            3: "Describe this image in an artistic and balanced way. Focus on capturing the core art style, colors, and pattern motifs while allowing a professional amount of creative freedom to generate variations.",
            4: "Describe the underlying artistic style, color psychology, mood, and elements of this image in a highly creative, designer-focused way. Highlight how a brand new, highly aesthetic variation can be created while maintaining the design's core theme.",
            5: "Describe the abstract theme, aesthetic mood, color interactions, and overall essence of this design in a highly artistic, imaginative, and avant-garde fashion. Prompt for a wildly creative, bold reinterpretation of this design concept."
        }
        style_instruction = creativity_guidelines.get(creativity, creativity_guidelines[3])
        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_b64}"}},
                {"type": "text", "text": (
                    f"You are a professional luxury textile designer. Analyze this image. \n"
                    f"{style_instruction}\n"
                    "Write the description as a single detailed paragraph (max 100 words) suitable for an AI image generator prompt. "
                    "Do NOT include any preamble like 'This image shows' or quotes — just describe it directly."
                )}
            ]}],
            temperature=0.3 + (creativity * 0.1), max_completion_tokens=512, top_p=1,
        )
        description = completion.choices[0].message.content.strip()
        print(f"  [Describe] Got description: {description[:100]}...")
        return jsonify({'success': True, 'description': description})
    except Exception as e:
        print(f"  [Describe] Error: {e}")
        return jsonify({'error': f'Failed to describe image: {str(e)}'}), 500


@bp.route('/api/extract-design', methods=['POST'])
@login_required
@expensive_generation_rate_limit
def extract_design():
    data = request.get_json(silent=True) or request.form
    filename = data.get('filename', '')
    image_file = request.files.get('image')
    if image_file:
        original_name = safe_filename(image_file.filename) or "upload.png"
        ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else 'png'
        filename = f"{uuid.uuid4().hex}.{ext}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        image_file.save(filepath)
        storage.sync_to_s3(filepath)
    else:
        image_url = data.get('imageUrl', '')
        if not filename and image_url:
            filename = os.path.basename(image_url.split('?', 1)[0])
        filename = os.path.basename(filename) if filename else ''
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']
    model_id = data.get('modelId', 'google/nano-banana')
    model_cfg = next((m for m in EXTRACT_MODELS if m['id'] == model_id), EXTRACT_MODELS[0])
    required_credits = int(model_cfg.get('credits') or credit_requirement('extract', 78))
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', 1)
    if not ok:
        return jsonify(err), 403
    try:
        print(f"  [Extract Design] Processing {filename} with {model_id}...")
        with open(filepath, "rb") as img_file:
            image_bytes = img_file.read()
            encoded_string = base64.b64encode(image_bytes).decode('utf-8')
            mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
            data_uri = f"data:{mime_type};base64,{encoded_string}"
        start_time = time.time()
        output = replicate.run(model_id, input={
            "prompt": "A perfectly flat, 2D seamless repeating pattern tile of the exact fabric design, motif, and colors seen in the input image. Extract the design out of the outfit. High resolution, perfectly flat texture.",
            "image_input": [data_uri], "aspect_ratio": "1:1"
        })
        duration = time.time() - start_time
        cost_usd = 0.039
        credits_used = required_credits
        log_replicate_call(project_id, model_id, duration, credits_used, cost_usd)
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
            storage.sync_to_s3(local_filepath)
            local_url = f"/results/{local_filename}"
            local_result_urls.append(local_url)
            log_export(project_id, local_filename, filename, "Extract Design", {"prompt": "Extract design out of outfit"})
        if not local_result_urls:
            refund_credits(user_id, project_id, required_credits, note='Extract design produced no results')
        updated_credits = get_updated_credits(user_id)
        return jsonify({'success': True, 'resultUrls': local_result_urls, **updated_credits})
    except Exception as e:
        refund_credits(user_id, project_id, required_credits, note='Extract design failed')
        print(f"  [Extract Design] Error: {e}")
        return jsonify({'error': f'Failed to extract design: {str(e)}'}), 500


# ---------------------------------------------------------------------------
# Per-model credit pricing  (Option A: 4 credits per INR 1, ~57% gross margin)
# Formula: credits = ceil(cost_usd * 1150)  (15% safety markup over raw vendor
# cost to absorb Groq side-calls, invoice variance and failed retries).
# Must stay in sync with DEFAULT_CREDIT_PRICING in backend/db.py.
# ---------------------------------------------------------------------------
EXTRACT_MODELS = [
    {
        'id': 'xai/grok-imagine-image',
        'name': 'Grok Imagine',
        'prompt': '',  # Will be generated from image description
        'input_key': None,
        'input_list': False,
        'supports_image': False,
        'cost_per_image': 0.02,
        'credits': 23,
    },
    {
        'id': 'bytedance/seedream-4.5',
        'name': 'Seedream 4.5',
        'prompt': '',  # Will be generated from image description
        'input_key': None,
        'input_list': False,
        'supports_image': False,
        'cost_per_image': 0.04,
        'credits': 46,
    },

    {
        'id': 'google/nano-banana',
        'name': 'Nano Banana',
        'prompt': '',  # Will be generated from image description
        'input_key': None,
        'input_list': False,
        'supports_image': False,
        'cost_per_image': 0.039,
        'credits': 45,
    },
    {
        'id': 'google/nano-banana-2',
        'name': 'Nano Banana 2',
        'prompt': '',  # Will be generated from image description
        'input_key': None,
        'input_list': False,
        'supports_image': False,
        'cost_per_image': 0.067,
        'credits': 78,
    },
]

# ---------------------------------------------------------------------------
# Per-model credit lookup for Inspirations (and other multi-model endpoints).
# Replaces the old flat `credit_requirement('inspire', 310)`.
# ---------------------------------------------------------------------------
MODEL_TO_CREDITS = {



    'google/imagen-4-fast':            23,
    'google/nano-banana':              45,
    'google/nano-banana-2':            78,

    'google/upscaler':                 23,
    'bytedance/seedream-4.5':          46,
    'black-forest-labs/flux-schnell':  4,
    'black-forest-labs/flux-fill-pro': 58,


    'qwen/qwen-image-edit':            35,
    'qwen/qwen-image-layered':         69,
    'recraft-ai/recraft-vectorize':    12,
    'xai/grok-imagine-image':          23,
    'replicate/seamless-texture':      84,
    'fofr/style-transfer':             23,
    '851-labs/background-remover':     2,
}
DEFAULT_INSPIRE_CREDITS = 45  # safe default = Nano Banana rate


def _describe_image_for_extraction(data_uri):
    """Use Groq vision to describe the pattern/design in an image for text-only models."""
    try:
        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": data_uri}},
                {"type": "text", "text": (
                    "Analyze this image and describe the fabric/textile pattern or design you see in extreme detail. "
                    "Focus on: the exact motifs (flowers, geometric shapes, animals, etc.), their arrangement and spacing, "
                    "the precise color palette (use specific color names like 'dusty rose', 'navy blue', 'sage green'), "
                    "the background color, the style (watercolor, digital, hand-drawn, block print, etc.), "
                    "and any texture details. Write a single dense paragraph, max 100 words. "
                    "Output ONLY the description, no preamble."
                )}
            ]}],
            temperature=0.3,
            max_completion_tokens=200,
        )
        desc = completion.choices[0].message.content.strip()
        print(f"  [Extract Multi] Image description: {desc[:100]}...")
        return desc
    except Exception as e:
        print(f"  [Extract Multi] Image description failed: {e}")
        return "floral fabric pattern with detailed motifs and rich colors"


def _run_single_extract(model_cfg, data_uri, project_id, filename, image_description=None):
    """Run a single model extraction. Returns dict with result or error."""
    model_id = model_cfg['id']
    try:
        print(f"  [Extract Multi] Starting {model_id}...")

        if model_cfg['supports_image']:
            # Model accepts image input directly
            replicate_input = {
                "prompt": model_cfg['prompt'],
                "aspect_ratio": "1:1",
            }
            if model_cfg['input_list']:
                replicate_input[model_cfg['input_key']] = [data_uri]
            else:
                replicate_input[model_cfg['input_key']] = data_uri
        else:
            # Text-only model — use the image description as prompt
            desc = image_description or "detailed fabric pattern"
            text_prompt = (
                f"A perfectly flat, 2D seamless repeating pattern tile for textile/fabric printing. "
                f"The pattern design: {desc}. "
                f"High resolution, perfectly flat texture, no perspective, no shadows, "
                f"clean edges suitable for seamless tiling."
            )
            replicate_input = {
                "prompt": text_prompt,
                "aspect_ratio": "1:1",
            }
            # Model-specific extra params
            if 'imagen' in model_id:
                replicate_input["image_size"] = "2K"
            elif 'flux' in model_id:
                replicate_input["prompt_upsampling"] = True

        start_time = time.time()
        output = replicate.run(model_id, input=replicate_input)
        duration = time.time() - start_time

        credits_used = int(model_cfg.get('credits') or credit_requirement('extract', 148))
        cost_usd = model_cfg['cost_per_image']
        log_replicate_call(project_id, model_id, duration, credits_used, cost_usd)

        image_urls = [str(url) for url in output] if isinstance(output, list) else [str(output)]
        url = image_urls[0]

        # Download locally
        resp = http_requests.get(url, timeout=90)
        resp.raise_for_status()
        local_uuid = uuid.uuid4().hex
        local_filename = f"extracted_{model_id.split('/')[-1]}_{local_uuid}.png"
        local_filepath = os.path.join(RESULTS_DIR, local_filename)
        with open(local_filepath, 'wb') as f:
            f.write(resp.content)
        storage.sync_to_s3(local_filepath)
        local_url = f"/results/{local_filename}"
        log_export(project_id, local_filename, filename, "Extract Design Multi", {"model": model_id})

        print(f"  [Extract Multi] {model_id} done in {duration:.1f}s")
        return {
            'modelId': model_id,
            'modelName': model_cfg['name'],
            'resultUrl': local_url,
            'duration': round(duration, 1),
            'creditsUsed': credits_used,
            'error': None,
        }
    except Exception as e:
        print(f"  [Extract Multi] {model_id} FAILED: {e}")
        return {
            'modelId': model_id,
            'modelName': model_cfg['name'],
            'resultUrl': None,
            'duration': 0,
            'creditsUsed': 0,
            'error': str(e),
        }


@bp.route('/api/extract-design-multi', methods=['POST'])
@login_required
@expensive_generation_rate_limit
def extract_design_multi():
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404

    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']

    required_credits = sum(int(m.get('credits') or credit_requirement('extract', 148)) for m in EXTRACT_MODELS)
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', len(EXTRACT_MODELS))
    if not ok:
        return jsonify(err), 403

    # Read and encode image once
    with open(filepath, "rb") as img_file:
        image_bytes = img_file.read()
        encoded_string = base64.b64encode(image_bytes).decode('utf-8')
        mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
        data_uri = f"data:{mime_type};base64,{encoded_string}"

    print(f"  [Extract Multi] Launching 4 models in parallel for {filename}...")

    # Describe the image once for text-only models
    has_text_only = any(not m['supports_image'] for m in EXTRACT_MODELS)
    image_description = None
    if has_text_only:
        print("  [Extract Multi] Describing image for text-only models...")
        image_description = _describe_image_for_extraction(data_uri)

    # Run all 4 models in parallel
    results = []
    total_credits = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(_run_single_extract, m, data_uri, project_id, filename, image_description): m
            for m in EXTRACT_MODELS
        }
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)
            total_credits += result.get('creditsUsed', 0)

    # Sort results in original model order
    model_order = {m['id']: i for i, m in enumerate(EXTRACT_MODELS)}
    results.sort(key=lambda r: model_order.get(r['modelId'], 99))

    successful = sum(1 for r in results if r['resultUrl'])
    print(f"  [Extract Multi] Complete! {successful}/4 models succeeded. Total credits: {total_credits}")

    adjust_reserved_credits(user_id, project_id, required_credits, total_credits, note='Extract multi partial refund')

    updated_credits = get_updated_credits(user_id)
    return jsonify({'success': True, 'results': results, 'totalCredits': total_credits, **updated_credits})


@bp.route('/api/extract-design-single', methods=['POST'])
@login_required
def extract_design_single():
    """Run extraction with a single specified model."""
    data = request.get_json() or {}
    if data.get("async"):
        project_id, access_error = project_access_from_payload(data)
        if access_error:
            return access_error
        user_id = g.current_user['id']
        worker_payload = {
            **data,
            "userId": user_id,
            "projectId": project_id,
            "toolKey": "extract-design-single",
        }
        job = enqueue_or_run(
            "extract-design-single",
            user_id,
            project_id,
            worker_payload,
            run_generation_job,
            json.dumps(worker_payload),
        )
        return jsonify({"success": True, **job})

    model_id = data.get('modelId', '')
    if not model_id:
        return jsonify({'error': 'Model ID is required'}), 400

    try:
        filename, filepath = _resolve_extract_filepath(
            data.get('filename', ''),
            data.get('imageUrl', ''),
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({'error': str(exc)}), 404

    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']

    model_cfg = next((m for m in EXTRACT_MODELS if m['id'] == model_id), None)
    if not model_cfg:
        return jsonify({'error': f'Unknown model: {model_id}'}), 400

    required_credits = int(model_cfg.get('credits') or credit_requirement('extract', 148))
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', 1)
    if not ok:
        return jsonify(err), 403

    # Read and encode image
    with open(filepath, "rb") as img_file:
        image_bytes = img_file.read()
        encoded_string = base64.b64encode(image_bytes).decode('utf-8')
        mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
        data_uri = f"data:{mime_type};base64,{encoded_string}"

    # Get image description for text-only models
    image_description = None
    if not model_cfg['supports_image']:
        image_description = _describe_image_for_extraction(data_uri)

    result = _run_single_extract(model_cfg, data_uri, project_id, filename, image_description)

    if not result.get('resultUrl'):
        refund_credits(user_id, project_id, required_credits, note='Extract single produced no result')
    else:
        adjust_reserved_credits(user_id, project_id, required_credits, result.get('creditsUsed', required_credits))

    updated_credits = get_updated_credits(user_id)
    payload = {
        'success': True,
        'modelId': result['modelId'],
        'resultUrl': result['resultUrl'],
        'duration': result['duration'],
        'error': result['error'],
        **updated_credits,
    }
    if result.get('resultUrl'):
        payload['fileAccessToken'] = media_access_token(
            os.path.basename(result['resultUrl']), user_id
        )
    return jsonify(payload)


@bp.route('/api/extract-edit', methods=['POST'])
@login_required
def extract_edit():
    """Edit an extracted pattern result using the same model that generated it."""
    data = request.get_json()
    image_url = data.get('imageUrl', '')
    prompt = data.get('prompt', '')
    model_id = data.get('modelId', 'google/nano-banana')
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']

    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400
    if not image_url:
        return jsonify({'error': 'Image URL is required'}), 400

    model_cfg = next((m for m in EXTRACT_MODELS if m['id'] == model_id), EXTRACT_MODELS[0])
    required_credits = int(model_cfg.get('credits') or credit_requirement('extract', 78))
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', 1)
    if not ok:
        return jsonify(err), 403

    try:
        # Load the existing result image
        if image_url.startswith('/results/'):
            local_path = os.path.join(RESULTS_DIR, image_url.split('/')[-1])
            with open(local_path, 'rb') as f:
                image_bytes = f.read()
        else:
            image_bytes = safe_fetch_url(image_url, timeout=60)

        encoded = base64.b64encode(image_bytes).decode('utf-8')
        data_uri = f"data:image/png;base64,{encoded}"

        edit_prompt = f"Edit this pattern tile: {prompt}. Keep it as a flat 2D seamless repeating pattern tile, high resolution."

        replicate_input = {"prompt": edit_prompt, "aspect_ratio": "1:1"}
        if 'nano-banana' in model_id:
            replicate_input["image_input"] = [data_uri]
        else:
            replicate_input["image"] = data_uri

        print(f"  [Extract Edit] Editing with {model_id}: {prompt[:80]}...")
        start_time = time.time()
        output = replicate.run(model_id, input=replicate_input)
        duration = time.time() - start_time

        credits_used = required_credits
        cost_usd = model_cfg['cost_per_image']
        log_replicate_call(project_id, model_id, duration, credits_used, cost_usd)

        image_urls = [str(url) for url in output] if isinstance(output, list) else [str(output)]
        url = image_urls[0]

        resp = http_requests.get(url, timeout=90)
        resp.raise_for_status()
        local_uuid = uuid.uuid4().hex
        local_filename = f"extract_edit_{local_uuid}.png"
        local_filepath = os.path.join(RESULTS_DIR, local_filename)
        with open(local_filepath, 'wb') as f:
            f.write(resp.content)
        storage.sync_to_s3(local_filepath)
        local_url = f"/results/{local_filename}"
        log_export(project_id, local_filename, os.path.basename(image_url) if image_url else '', "Extract Edit", {"model": model_id}, user_id=user_id)

        updated_credits = get_updated_credits(user_id)

        print(f"  [Extract Edit] Done in {duration:.1f}s")
        return jsonify({
            'success': True,
            'resultUrl': local_url,
            'modelId': model_id,
            'fileAccessToken': media_access_token(local_filename, user_id),
            **updated_credits,
        })

    except Exception as e:
        refund_credits(user_id, project_id, required_credits, note='Extract edit failed')
        print(f"  [Extract Edit] Error: {e}")
        return jsonify({'error': f'Edit failed: {str(e)}'}), 500


@bp.route('/api/generate-inspirations', methods=['POST'])
@login_required
@generation_rate_limit
def generate_inspirations():
    data = request.get_json()
    user_prompt = data.get('prompt', '')
    creativity = int(data.get('creativity', 3))
    count = int(data.get('count', 3))
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    image_url = data.get('imageUrl', '')
    if not user_prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    # Load input image if present
    data_uri = None
    mime_type = "image/png"
    try:
        if image_url and image_url.startswith('http'):
            content = safe_fetch_url(image_url, timeout=30)
            encoded_string = base64.b64encode(content).decode('utf-8')
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

    # Use Groq llama-4-scout to rewrite the prompt
    try:
        print(f"  [Inspirations] Consulting Llama-4-Scout to rewrite prompt (Creativity: {creativity})...")
        system_instruction = (
            "You are a luxury textile & fashion designer and an expert prompt engineer. "
            f"Analyze the user's basic pattern idea: '{user_prompt}'. "
            f"The user wants a creativity level of {creativity} out of 5 (1 = very safe/faithful, 5 = extremely wild/abstract/bold). "
            "Write a highly professional, rich, and sophisticated prompt for an AI image generator "
            "that describes a stunning, flat 2D repeating fabric pattern tile in meticulous detail. "
            "Focus on the exact arrangement of motifs, luxurious color palette (use specific designer color terms), "
            "composition, spacing, and fine artistic textures. "
            "Keep the prompt to a single, powerful, highly descriptive paragraph (max 100 words). "
            "Do NOT include any introduction, explanations, notes, or quotes. Output ONLY the optimized prompt text itself."
        )
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
            messages=messages, temperature=0.4 + (creativity * 0.1), max_completion_tokens=256,
        )
        designer_prompt = completion.choices[0].message.content.strip()
        print(f"  [Inspirations] Designer Prompt: {designer_prompt}")
    except Exception as e:
        print(f"  [Inspirations] Groq prompt enhancement failed: {e}")
        designer_prompt = f"A repeating pattern of {user_prompt}, flat 2D textile design, highly detailed."

    # Generate variations
    use_seamless = data.get('seamless', False)
    results = []
    errors = []
    total_credits = 0
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']
    requested_models = data.get('models') or ['google/nano-banana']
    requested_model_count = 1 if use_seamless else max(1, len(requested_models))
    # Up-front credit check uses the most expensive selected model so the user
    # is never undercharged.  Per-call deduction inside the loop uses the
    # actual model via MODEL_TO_CREDITS.
    _max_model_credits = max(
        (MODEL_TO_CREDITS.get(m, DEFAULT_INSPIRE_CREDITS) for m in requested_models),
        default=DEFAULT_INSPIRE_CREDITS,
    )
    required_credits = _max_model_credits * count * requested_model_count
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', count * requested_model_count)
    if not ok:
        return jsonify(err), 403

    if use_seamless:
        try:
            print(f"  [Inspirations] Generating {count} seamless tiles using FSTL text-to-image...")
            start_time = time.time()
            output = replicate.run(
                "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
                input={"prompt": f"FSTL {designer_prompt}, seamless repeating textile pattern, tileable",
                       "model": "dev", "aspect_ratio": "1:1", "num_outputs": min(4, count),
                       "num_inference_steps": 28, "guidance_scale": 3.0, "output_format": "png"}
            )
            duration = time.time() - start_time
            cost_usd = duration * 0.001525
            credits_used = required_credits
            log_replicate_call(project_id, "replicate/seamless-texture", duration, credits_used, cost_usd)
            total_credits += credits_used
            for idx, out_url in enumerate(output if isinstance(output, list) else [output]):
                url_str = str(out_url.url) if hasattr(out_url, 'url') else str(out_url)
                results.append(url_str)
        except Exception as e:
            print(f"  [Inspirations] FSTL generation error: {e}")
            errors.append(str(e))
    else:
        models = requested_models
        if not models:
            models = ['google/nano-banana']
        
        aspect_ratio = data.get('aspect_ratio', '1:1')
        resolution = int(data.get('resolution', 1024))
        
        # Map aspect ratio to width/height for models that need explicit dimensions
        aspect_dimensions = {
            '1:1': (resolution, resolution),
            '4:3': (resolution, int(resolution * 3 / 4)),
            '3:4': (int(resolution * 3 / 4), resolution),
            '16:9': (resolution, int(resolution * 9 / 16)),
            '9:16': (int(resolution * 9 / 16), resolution),
            '3:2': (resolution, int(resolution * 2 / 3)),
            '2:3': (int(resolution * 2 / 3), resolution),
        }
        width, height = aspect_dimensions.get(aspect_ratio, (resolution, resolution))
            
        for model_id in models:
            for i in range(count):
                try:
                    print(f"  [Inspirations] Generating variant {i+1}/{count} using {model_id} ({aspect_ratio}, {resolution}px)...")
                    
                    # Build model-specific input parameters
                    replicate_input = {"prompt": designer_prompt + " - flat 2D repeating fabric pattern tile texture."}
                    
                    # Aspect ratio - most models support this directly
                    replicate_input["aspect_ratio"] = aspect_ratio
                    
                    # Resolution - model-specific handling
                    if 'flux' in model_id:
                        replicate_input["width"] = width
                        replicate_input["height"] = height
                    elif 'seedream' in model_id:
                        replicate_input["image_size"] = f"{width}x{height}"
                    
                    # Reference image
                    if data_uri:
                        if 'nano-banana' in model_id:
                            replicate_input["image_input"] = [data_uri]
                        else:
                            replicate_input["image"] = data_uri
                        
                    start_time = time.time()
                    output = replicate.run(model_id, input=replicate_input)
                    duration = time.time() - start_time
                    
                    # Exact Per-Image Costs from Replicate Invoice JSON
                    # These models are billed per-image, not per-second!
                    per_image_costs = {

                        'xai/grok-imagine-image': 0.02,
                        'google/imagen-4-fast': 0.02,

                        'google/nano-banana': 0.039,
                        'google/nano-banana-2': 0.067,

                        'bytedance/seedream-4.5': 0.04,
                        'black-forest-labs/flux-schnell': 0.003,
                        'black-forest-labs/flux-fill-pro': 0.05,
                        'qwen/qwen-image-layered': 0.04, # 0.01 + 0.03 run cost

                    }
                    
                    # Determine cost
                    # 1 generated image per loop iteration
                    if model_id in per_image_costs:
                        cost_usd = per_image_costs[model_id]
                    else:
                        # Fallback to time-based for models running on shared hardware 
                        # like fofr/style-transfer (L40S) or seamless-texture (H100)
                        cost_usd = duration * 0.001525 
                    
                    credits_used = MODEL_TO_CREDITS.get(model_id, DEFAULT_INSPIRE_CREDITS)
                    
                    # Log actual cost to vendor, but deduct retail credits from user
                    log_replicate_call(project_id, model_id, duration, credits_used, cost_usd)
                    total_credits += credits_used
                    
                    if isinstance(output, list) and len(output) > 0:
                        image_url_result = str(output[0].url) if hasattr(output[0], 'url') else str(output[0])
                    else:
                        image_url_result = str(output.url) if hasattr(output, 'url') else str(output)
                        
                    results.append(image_url_result)
                except Exception as e:
                    print(f"  [Inspirations] Replicate generation error on {model_id} variant {i+1}: {e}")
                    errors.append(str(e))

    if results:
        adjust_reserved_credits(user_id, project_id, required_credits, total_credits, note='Inspirations partial refund')
    else:
        refund_credits(user_id, project_id, required_credits, note='Inspirations produced no results')
    updated_credits = get_updated_credits(user_id)
    return jsonify({'success': True, 'variations': results, 'errors': errors, **updated_credits})
