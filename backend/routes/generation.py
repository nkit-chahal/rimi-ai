"""AI generation routes: describe image, extract design, generate inspirations."""
import os
import uuid
import base64
import time
import concurrent.futures
import requests as http_requests
from flask import Blueprint, request, jsonify

from config import UPLOAD_DIR, RESULTS_DIR, groq_client, safe_filename
from auth import (
    check_credits, credit_error_payload, credit_requirement,
    record_activity, get_updated_credits, log_export, log_replicate_call,
)
import replicate
import storage

bp = Blueprint('generation', __name__)


@bp.route('/api/describe-image', methods=['POST'])
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
    project_id = int(data.get('projectId', 1))
    user_id = data.get('userId') or data.get('user_id')
    if user_id:
        try: user_id = int(user_id)
        except ValueError: user_id = None
    required_credits = credit_requirement('extract', 50)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403
    try:
        print(f"  [Extract Design] Processing {filename} with openai/gpt-image-2...")
        with open(filepath, "rb") as img_file:
            image_bytes = img_file.read()
            encoded_string = base64.b64encode(image_bytes).decode('utf-8')
            mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
            data_uri = f"data:{mime_type};base64,{encoded_string}"
        start_time = time.time()
        output = replicate.run("openai/gpt-image-2", input={
            "prompt": "A perfectly flat, 2D seamless repeating pattern tile of the exact fabric design, motif, and colors seen in the input image. Extract the design out of the outfit. High resolution, perfectly flat texture.",
            "input_images": [data_uri], "aspect_ratio": "1:1"
        })
        duration = time.time() - start_time
        credits_used = max(10, int(round(duration * 12)))
        cost_usd = duration * 0.00115
        log_replicate_call(project_id, "openai/gpt-image-2", duration, credits_used, cost_usd)
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
        record_activity(project_id, 'generation', len(local_result_urls), credits_used, user_id=user_id)
        updated_credits = get_updated_credits(user_id)
        return jsonify({'success': True, 'resultUrls': local_result_urls, **updated_credits})
    except Exception as e:
        print(f"  [Extract Design] Error: {e}")
        return jsonify({'error': f'Failed to extract design: {str(e)}'}), 500


EXTRACT_MODELS = [
    {
        'id': 'openai/gpt-image-2',
        'name': 'GPT Image',
        'prompt': 'A perfectly flat, 2D seamless repeating pattern tile of the exact fabric design, motif, and colors seen in the input image. Extract the design out of the outfit. High resolution, perfectly flat texture.',
        'input_key': 'input_images',
        'input_list': True,
        'supports_image': True,
        'cost_per_image': 0.128,
    },
    {
        'id': 'google/imagen-4-ultra',
        'name': 'Imagen 4',
        'prompt': '',  # Will be generated from image description
        'input_key': None,
        'input_list': False,
        'supports_image': False,
        'cost_per_image': 0.06,
    },
    {
        'id': 'black-forest-labs/flux-2-pro',
        'name': 'Flux 2 Pro',
        'prompt': '',  # Will be generated from image description
        'input_key': None,
        'input_list': False,
        'supports_image': False,
        'cost_per_image': 0.09,
    },
    {
        'id': 'bytedance/seedream-4.5',
        'name': 'SeDream',
        'prompt': '',  # Will be generated from image description
        'input_key': None,
        'input_list': False,
        'supports_image': False,
        'cost_per_image': 0.04,
    },
]


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

        credits_used = max(5, int(round(duration * 10)))
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
def extract_design_multi():
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404

    project_id = int(data.get('projectId', 1))
    user_id = data.get('userId') or data.get('user_id')
    if user_id:
        try: user_id = int(user_id)
        except ValueError: user_id = None

    required_credits = credit_requirement('extract', 50, len(EXTRACT_MODELS))
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

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

    if total_credits > 0:
        record_activity(project_id, 'generation', successful, total_credits, user_id=user_id)

    updated_credits = get_updated_credits(user_id)
    return jsonify({'success': True, 'results': results, 'totalCredits': total_credits, **updated_credits})


@bp.route('/api/extract-design-single', methods=['POST'])
def extract_design_single():
    """Run extraction with a single specified model."""
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    model_id = data.get('modelId', '')
    
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    if not model_id:
        return jsonify({'error': 'Model ID is required'}), 400
        
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404

    project_id = int(data.get('projectId', 1))
    user_id = data.get('userId') or data.get('user_id')
    if user_id:
        try: user_id = int(user_id)
        except ValueError: user_id = None

    required_credits = credit_requirement('extract', 50)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

    # Find the model config
    model_cfg = next((m for m in EXTRACT_MODELS if m['id'] == model_id), None)
    if not model_cfg:
        return jsonify({'error': f'Unknown model: {model_id}'}), 400

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
    
    if result['creditsUsed'] > 0:
        record_activity(project_id, 'generation', 1 if result['resultUrl'] else 0, result['creditsUsed'], user_id=user_id)

    updated_credits = get_updated_credits(user_id)
    return jsonify({
        'success': True,
        'modelId': result['modelId'],
        'resultUrl': result['resultUrl'],
        'duration': result['duration'],
        'error': result['error'],
        **updated_credits
    })


@bp.route('/api/extract-edit', methods=['POST'])
def extract_edit():
    """Edit an extracted pattern result using the same model that generated it."""
    data = request.get_json()
    image_url = data.get('imageUrl', '')
    prompt = data.get('prompt', '')
    model_id = data.get('modelId', 'openai/gpt-image-2')
    project_id = int(data.get('projectId', 1))
    user_id = data.get('userId') or data.get('user_id')

    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400
    if not image_url:
        return jsonify({'error': 'Image URL is required'}), 400

    if user_id:
        try: user_id = int(user_id)
        except ValueError: user_id = None

    required_credits = credit_requirement('extract', 50)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

    try:
        # Load the existing result image
        if image_url.startswith('/results/'):
            local_path = os.path.join(RESULTS_DIR, image_url.split('/')[-1])
            with open(local_path, 'rb') as f:
                image_bytes = f.read()
        else:
            resp = http_requests.get(image_url, timeout=60)
            resp.raise_for_status()
            image_bytes = resp.content

        encoded = base64.b64encode(image_bytes).decode('utf-8')
        data_uri = f"data:image/png;base64,{encoded}"

        # Find model config
        model_cfg = next((m for m in EXTRACT_MODELS if m['id'] == model_id), EXTRACT_MODELS[0])

        edit_prompt = f"Edit this pattern tile: {prompt}. Keep it as a flat 2D seamless repeating pattern tile, high resolution."

        replicate_input = {"prompt": edit_prompt, "aspect_ratio": "1:1"}
        if model_cfg['input_list']:
            replicate_input[model_cfg['input_key']] = [data_uri]
        else:
            replicate_input[model_cfg['input_key']] = data_uri

        print(f"  [Extract Edit] Editing with {model_id}: {prompt[:80]}...")
        start_time = time.time()
        output = replicate.run(model_id, input=replicate_input)
        duration = time.time() - start_time

        credits_used = max(5, int(round(duration * 10)))
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

        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)
        updated_credits = get_updated_credits(user_id)

        print(f"  [Extract Edit] Done in {duration:.1f}s")
        return jsonify({'success': True, 'resultUrl': local_url, 'modelId': model_id, **updated_credits})

    except Exception as e:
        print(f"  [Extract Edit] Error: {e}")
        return jsonify({'error': f'Edit failed: {str(e)}'}), 500


@bp.route('/api/generate-inspirations', methods=['POST'])
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

    # Use Groq llama-4-scout to rewrite the prompt
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
    project_id = int(data.get('projectId', 1))
    user_id = data.get('userId') or data.get('user_id')
    if user_id:
        try: user_id = int(user_id)
        except ValueError: user_id = None
    required_credits = credit_requirement('inspire', 50, count)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

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
            credits_used = max(10, int(round(duration * 12)))
            cost_usd = duration * 0.00115
            log_replicate_call(project_id, "replicate/seamless-texture", duration, credits_used, cost_usd)
            total_credits += credits_used
            for idx, out_url in enumerate(output if isinstance(output, list) else [output]):
                url_str = str(out_url.url) if hasattr(out_url, 'url') else str(out_url)
                results.append(url_str)
        except Exception as e:
            print(f"  [Inspirations] FSTL generation error: {e}")
            errors.append(str(e))
    else:
        models = data.get('models', ['openai/gpt-image-2'])
        if not models:
            models = ['openai/gpt-image-2']
        
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
                    elif 'openai' in model_id:
                        # GPT-Image-2 uses size strings
                        size_map = {512: "1024x1024", 1024: "1024x1024", 1536: "1536x1536", 2048: "2048x2048"}
                        replicate_input["size"] = size_map.get(resolution, "1024x1024")
                    elif 'seedream' in model_id:
                        replicate_input["image_size"] = f"{width}x{height}"
                    
                    # Reference image - model-specific key names
                    if data_uri:
                        if 'openai' in model_id:
                            replicate_input["input_images"] = [data_uri]
                        elif 'flux' in model_id:
                            replicate_input["image"] = data_uri
                        else:
                            replicate_input["image"] = data_uri
                        
                    start_time = time.time()
                    output = replicate.run(model_id, input=replicate_input)
                    duration = time.time() - start_time
                    
                    # Exact Per-Image Costs from Replicate Invoice JSON
                    # These models are billed per-image, not per-second!
                    per_image_costs = {
                        'openai/gpt-image-2': 0.128,
                        'xai/grok-imagine-image': 0.02,
                        'google/imagen-4-fast': 0.02,
                        'google/imagen-4-ultra': 0.06, # Estimated from fast
                        'google/nano-banana': 0.039,
                        'google/nano-banana-2': 0.067,
                        'google/nano-banana-pro': 0.150,
                        'bytedance/seedream-4.5': 0.04,
                        'black-forest-labs/flux-schnell': 0.003,
                        'black-forest-labs/flux-fill-pro': 0.05,
                        'qwen/qwen-image-layered': 0.04, # 0.01 + 0.03 run cost
                        'black-forest-labs/flux-2-pro': 0.09 # Avg based on megapixel billing
                    }
                    
                    # Determine cost
                    # 1 generated image per loop iteration
                    if model_id in per_image_costs:
                        cost_usd = per_image_costs[model_id]
                    else:
                        # Fallback to time-based for models running on shared hardware 
                        # like fofr/style-transfer (L40S) or seamless-texture (H100)
                        cost_usd = duration * 0.001525 
                    
                    # Add 20% profit margin for user billing
                    retail_usd = cost_usd * 1.20
                    
                    # 1000 credits = $1.00 scale for accuracy (charged based on retail price)
                    credits_used = max(10, int(round(retail_usd * 1000)))
                    
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
        record_activity(project_id, 'generation', len(results), total_credits, user_id=user_id)
    updated_credits = get_updated_credits(user_id)
    return jsonify({'success': True, 'variations': results, 'errors': errors, **updated_credits})
