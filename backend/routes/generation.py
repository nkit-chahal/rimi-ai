"""AI generation routes: describe image, extract design, generate inspirations."""
import os
import uuid
import base64
import time
import requests as http_requests
from flask import Blueprint, request, jsonify

from config import UPLOAD_DIR, RESULTS_DIR, groq_client
from auth import check_credits, record_activity, get_updated_credits, log_export, log_replicate_call
import replicate

bp = Blueprint('generation', __name__)


@bp.route('/api/describe-image', methods=['POST'])
def describe_image():
    data = request.get_json()
    filename = data.get('filename', '')
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
    data = request.get_json()
    filename = data.get('filename', '')
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
    ok, remaining, limit, used = check_credits(user_id)
    if not ok:
        return jsonify({'error': 'Insufficient AI credits. Contact your admin to increase your credit limit.',
                        'creditsUsed': used, 'creditsLimit': limit}), 403
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
            local_url = f"/results/{local_filename}"
            local_result_urls.append(local_url)
            log_export(project_id, local_filename, filename, "Extract Design", {"prompt": "Extract design out of outfit"})
        record_activity(project_id, 'generation', len(local_result_urls), credits_used, user_id=user_id)
        updated_credits = get_updated_credits(user_id)
        return jsonify({'success': True, 'resultUrls': local_result_urls, **updated_credits})
    except Exception as e:
        print(f"  [Extract Design] Error: {e}")
        return jsonify({'error': f'Failed to extract design: {str(e)}'}), 500


@bp.route('/api/generate-inspirations', methods=['POST'])
def generate_inspirations():
    data = request.get_json()
    user_prompt = data.get('prompt', '')
    creativity = int(data.get('creativity', 3))
    count = int(data.get('count', 3))
    filename = data.get('filename', '')
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
    ok, remaining, limit, used = check_credits(user_id)
    if not ok:
        return jsonify({'error': 'Insufficient AI credits. Contact your admin to increase your credit limit.',
                        'creditsUsed': used, 'creditsLimit': limit}), 403

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
        for i in range(count):
            try:
                print(f"  [Inspirations] Generating variant {i+1}/{count} using openai/gpt-image-2...")
                replicate_input = {"prompt": designer_prompt + " - flat 2D repeating fabric pattern tile texture.", "aspect_ratio": "1:1"}
                if data_uri:
                    replicate_input["input_images"] = [data_uri]
                start_time = time.time()
                output = replicate.run("openai/gpt-image-2", input=replicate_input)
                duration = time.time() - start_time
                credits_used = max(10, int(round(duration * 12)))
                cost_usd = duration * 0.00115
                log_replicate_call(project_id, "openai/gpt-image-2", duration, credits_used, cost_usd)
                total_credits += credits_used
                image_url_result = str(output[0].url) if isinstance(output, list) and len(output) > 0 else str(output)
                results.append(image_url_result)
            except Exception as e:
                print(f"  [Inspirations] Replicate generation error on variant {i+1}: {e}")
                errors.append(str(e))

    if results:
        record_activity(project_id, 'generation', len(results), total_credits, user_id=user_id)
    updated_credits = get_updated_credits(user_id)
    return jsonify({'success': True, 'variations': results, 'errors': errors, **updated_credits})
