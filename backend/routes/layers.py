"""Image Layers routes: decompose, caption, edit, inpaint, compose."""
import os
import uuid
import base64
import replicate
from flask import Blueprint, request, jsonify

from config import UPLOAD_DIR, RESULTS_DIR, groq_client
from auth import (
    log_export, log_replicate_call, check_credits,
    credit_error_payload, credit_requirement, get_updated_credits, record_activity,
    save_rgba_content_layer, rgba_layer_to_green_matte,
    green_matte_to_rgba, remove_background_with_rmbg,
    decode_data_url_image,
)
import storage

bp = Blueprint('layers', __name__)


# --------------- Image Layers (Qwen Image Layered) ---------------
@bp.route('/api/image-layers', methods=['POST'])
def image_layers():
    """
    Decompose an image into separate RGBA layers using Qwen Image Layered.
    Expects JSON: { filename, numLayers (2-8), description, outputFormat, projectId, userId }
    Returns: { success, layers: [{ url, index }] }
    """
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    num_layers = int(data.get('numLayers', 4))
    description = data.get('description', 'auto')
    output_format = data.get('outputFormat', 'png')
    project_id = int(data.get('projectId', 1))

    # Clamp num_layers to Qwen's demo range.
    num_layers = max(2, min(10, num_layers))

    # Extract user_id early for credit check
    user_id_raw = data.get('userId') or data.get('user_id')
    user_id = None
    if user_id_raw:
        try:
            user_id = int(user_id_raw)
        except ValueError:
            pass
    required_credits = credit_requirement('imageLayers', 315)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404

    try:
        import time
        import requests as http_requests

        print(f"  [Image Layers] Processing {filename} with qwen/qwen-image-layered ({num_layers} layers)...")

        with open(filepath, "rb") as img_file:
            image_bytes = img_file.read()
            encoded_string = base64.b64encode(image_bytes).decode('utf-8')
            mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
            data_uri = f"data:{mime_type};base64,{encoded_string}"

        start_time = time.time()
        output = replicate.run(
            "qwen/qwen-image-layered",
            input={
                "image": data_uri,
                "num_layers": num_layers,
                "description": description,
                "go_fast": True,
                "output_format": output_format,
                "output_quality": 95,
            }
        )
        duration = time.time() - start_time
        credits_used = required_credits
        cost_usd = 0.03 + (0.01 * num_layers)

        log_replicate_call(project_id, "qwen/qwen-image-layered", duration, credits_used, cost_usd)

        # Download each layer image
        layers = []
        batch_id = uuid.uuid4().hex[:8]
        output_list = list(output) if not isinstance(output, list) else output
        for i, layer_output in enumerate(output_list):
            layer_name = f"layer_{batch_id}_{i}.png"
            layer_path = os.path.join(RESULTS_DIR, layer_name)

            try:
                layer_bytes = layer_output.read()
            except AttributeError:
                url = str(layer_output)
                resp = http_requests.get(url)
                layer_bytes = resp.content

            placement = save_rgba_content_layer(layer_bytes, layer_path)
            storage.sync_to_s3(layer_path)

            layers.append({
                'url': f'/results/{layer_name}',
                'index': i,
                'filename': layer_name,
                **placement
            })

        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)

        # Log export for each layer
        for layer in layers:
            log_export(
                project_id=project_id,
                filename=layer['filename'],
                input_filename=filename,
                tool_type="Image Layers",
                settings_dict={
                    "numLayers": num_layers,
                    "description": description,
                    "layerIndex": layer['index']
                }
            )

        print(f"  [Image Layers] Generated {len(layers)} layers in {duration:.1f}s")

        updated_credits = get_updated_credits(user_id)
        return jsonify({
            'success': True,
            'layers': layers,
            **updated_credits
        })

    except Exception as e:
        print(f"  [Image Layers] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Image layer decomposition failed: {str(e)}'}), 500


# --------------- Caption Layer (Groq Vision) ---------------
@bp.route('/api/caption-layer', methods=['POST'])
def caption_layer():
    """
    Auto-name a layer image using Groq Vision.
    Expects JSON: { filename }
    Returns: { success, name }
    """
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''

    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    filepath = os.path.join(RESULTS_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404

    try:
        with open(filepath, 'rb') as f:
            image_bytes = f.read()
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')

        ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else 'png'
        mime_map = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp'}
        mime_type = mime_map.get(ext, 'image/png')

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
                                "In 1-3 words, name the main subject or element visible in this image layer. "
                                "If it's mostly empty/transparent, say 'Background'. "
                                "Respond with ONLY the name, nothing else. Examples: Sky, Person, Tree, Text, Logo, Shadow, Ground"
                            )
                        }
                    ]
                }
            ],
            temperature=0.1,
            max_completion_tokens=20,
            top_p=1,
        )

        name = completion.choices[0].message.content.strip().strip('"').strip("'")
        # Truncate if too long
        if len(name) > 30:
            name = name[:30]
        
        print(f"  [Caption Layer] {filename} -> {name}")
        return jsonify({'success': True, 'name': name})

    except Exception as e:
        print(f"  [Caption Layer] Error: {e}")
        return jsonify({'success': True, 'name': f'Layer'})


# --------------- Edit Layer (AI per-layer editing) ---------------
@bp.route('/api/edit-layer', methods=['POST'])
def edit_layer():
    """
    AI-edit a single layer image based on a natural language prompt.
    Expects JSON: { filename, prompt, editType ('recolor'|'revise'|'replace'|'freeform'), projectId, userId }
    Returns: { success, resultUrl }
    """
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    user_prompt = data.get('prompt', '')
    edit_type = data.get('editType', 'freeform')
    project_id = int(data.get('projectId', 1))

    user_id_raw = data.get('userId') or data.get('user_id')
    user_id = None
    if user_id_raw:
        try:
            user_id = int(user_id_raw)
        except ValueError:
            pass
    required_credits = credit_requirement('imageLayerEdit', 75)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

    if not filename or not user_prompt:
        return jsonify({'error': 'Filename and prompt are required'}), 400

    filepath = os.path.join(RESULTS_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404

    try:
        import time
        import requests as http_requests
        from PIL import Image
        import io

        print(f"  [Edit Layer] Editing {filename} with prompt: {user_prompt[:60]}... (type: {edit_type})")

        # Read original layer to preserve alpha channel
        original_img = Image.open(filepath).convert('RGBA')
        original_alpha = original_img.split()[3]  # Extract alpha channel

        matte_color = (30, 215, 96)

        # Build the AI prompt based on edit type. The Qwen RGBA edit reference
        # composites transparent layers onto a chroma green matte before editing,
        # then removes that matte to recover transparency.
        if edit_type == 'recolor':
            ai_prompt = (
                f"The foreground element is on a flat chroma green background. Recolor only the foreground element: {user_prompt}. "
                "Keep the exact same shape, pose, and composition. Keep the background flat solid chroma green."
            )
        elif edit_type == 'revise':
            ai_prompt = (
                f"The foreground layer is on a flat chroma green background. Revise only the text or graphic details: {user_prompt}. "
                "Do not edit the chroma green background. Keep the background flat solid chroma green for transparency removal."
            )
        elif edit_type == 'replace':
            ai_prompt = (
                f"The foreground element is on a flat chroma green background. Replace only the foreground element with: {user_prompt}. "
                "Do not edit the chroma green background. Keep the background flat solid chroma green for transparency removal."
            )
        else:
            ai_prompt = (
                f"The foreground layer is on a flat chroma green background. {user_prompt}. "
                "Keep the background flat solid chroma green for transparency removal."
            )

        matte_img = rgba_layer_to_green_matte(original_img, matte_color)
        matte_buffer = io.BytesIO()
        matte_img.save(matte_buffer, format='PNG')
        encoded = base64.b64encode(matte_buffer.getvalue()).decode('utf-8')
        data_uri = f"data:image/png;base64,{encoded}"

        start_time = time.time()
        output = replicate.run(
            "qwen/qwen-image-edit",
            input={
                "image": data_uri,
                "prompt": ai_prompt
            }
        )
        duration = time.time() - start_time
        credits_used = required_credits
        cost_usd = 0.03

        log_replicate_call(project_id, "qwen/qwen-image-edit", duration, credits_used, cost_usd)

        # Download the result
        result_id = uuid.uuid4().hex[:8]
        result_name = f"layedit_{result_id}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)

        try:
            result_bytes = output.read()
        except AttributeError:
            if isinstance(output, list):
                url = str(output[0])
            else:
                url = str(output)
            resp = http_requests.get(url)
            result_bytes = resp.content

        result_img = Image.open(io.BytesIO(result_bytes)).convert('RGBA')
        result_img = result_img.resize(original_img.size, Image.LANCZOS)

        if edit_type == 'recolor':
            # Recolor keeps the existing cutout exactly; structural edits need their own alpha.
            final_img = green_matte_to_rgba(result_img, matte_color, preserve_alpha=original_alpha)
        else:
            final_img = remove_background_with_rmbg(result_img) or green_matte_to_rgba(result_img, matte_color)

        final_img.save(result_path, 'PNG')
        storage.sync_to_s3(result_path)

        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=filename,
            tool_type="Layer Edit",
            settings_dict={"prompt": user_prompt, "editType": edit_type}
        )

        print(f"  [Edit Layer] Done in {duration:.1f}s -> {result_name}")

        updated_credits = get_updated_credits(user_id)
        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            **updated_credits
        })

    except Exception as e:
        print(f"  [Edit Layer] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Layer editing failed: {str(e)}'}), 500


# --------------- Inpaint Layer (Qwen localized edit) ---------------
@bp.route('/api/inpaint-layer', methods=['POST'])
def inpaint_layer():
    """
    Localized Qwen edit for one RGBA layer using a painted canvas mask.
    Expects JSON: { filename, prompt, mask, canvasWidth, canvasHeight, transform, projectId, userId }
    Returns a canvas-sized transparent PNG layer with only the masked region changed.
    """
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    user_prompt = data.get('prompt', '').strip()
    mask_data_url = data.get('mask', '')
    canvas_width = int(data.get('canvasWidth', 1024))
    canvas_height = int(data.get('canvasHeight', 1024))
    transform = data.get('transform', {}) or {}
    project_id = int(data.get('projectId', 1))

    user_id_raw = data.get('userId') or data.get('user_id')
    user_id = None
    if user_id_raw:
        try:
            user_id = int(user_id_raw)
        except ValueError:
            pass

    required_credits = credit_requirement('imageLayerEdit', 75)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

    if not filename or not user_prompt or not mask_data_url:
        return jsonify({'error': 'Filename, prompt, and mask are required'}), 400

    filepath = os.path.join(RESULTS_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404

    try:
        import time
        import io
        import requests as http_requests
        from PIL import Image, ImageFilter

        print(f"  [Inpaint Layer] Editing masked area of {filename}: {user_prompt[:60]}...")

        original_img = Image.open(filepath).convert('RGBA')
        layer_canvas = Image.new('RGBA', (canvas_width, canvas_height), (0, 0, 0, 0))

        img = original_img
        if transform.get('flipX', False):
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        if transform.get('flipY', False):
            img = img.transpose(Image.FLIP_TOP_BOTTOM)

        sx = float(transform.get('scaleX', 1.0))
        sy = float(transform.get('scaleY', 1.0))
        new_w = max(1, int(img.width * abs(sx)))
        new_h = max(1, int(img.height * abs(sy)))
        img = img.resize((new_w, new_h), Image.LANCZOS)

        angle = float(transform.get('angle', 0))
        if angle != 0:
            img = img.rotate(-angle, expand=True, resample=Image.BICUBIC)

        x = int(float(transform.get('x', 0)))
        y = int(float(transform.get('y', 0)))
        layer_canvas.paste(img, (x, y), img)

        mask_img = decode_data_url_image(mask_data_url).convert('L').resize((canvas_width, canvas_height), Image.LANCZOS)
        mask_img = mask_img.point(lambda p: 255 if p > 16 else 0).filter(ImageFilter.GaussianBlur(radius=1.2))
        if not mask_img.getbbox():
            return jsonify({'error': 'Mask is empty. Paint over the area to inpaint first.'}), 400

        matte_color = (30, 215, 96)
        matte_img = rgba_layer_to_green_matte(layer_canvas, matte_color)
        matte_buffer = io.BytesIO()
        matte_img.save(matte_buffer, format='PNG')
        data_uri = f"data:image/png;base64,{base64.b64encode(matte_buffer.getvalue()).decode('utf-8')}"

        ai_prompt = (
            f"The image contains a foreground layer on a flat chroma green background. "
            f"Edit only the user-painted masked area according to this instruction: {user_prompt}. "
            "Keep the chroma green background unchanged. Do not change unmasked content."
        )

        start_time = time.time()
        output = replicate.run(
            "qwen/qwen-image-edit",
            input={
                "image": data_uri,
                "prompt": ai_prompt
            }
        )
        duration = time.time() - start_time
        credits_used = required_credits
        cost_usd = 0.03
        log_replicate_call(project_id, "qwen/qwen-image-edit", duration, credits_used, cost_usd)

        try:
            result_bytes = output.read()
        except AttributeError:
            url = str(output[0]) if isinstance(output, list) else str(output)
            resp = http_requests.get(url)
            result_bytes = resp.content

        result_img = Image.open(io.BytesIO(result_bytes)).convert('RGBA').resize((canvas_width, canvas_height), Image.LANCZOS)
        edited_rgba = remove_background_with_rmbg(result_img) or green_matte_to_rgba(result_img, matte_color)
        final_canvas = Image.composite(edited_rgba, layer_canvas, mask_img)

        result_id = uuid.uuid4().hex[:8]
        result_name = f"layinpaint_{result_id}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        final_canvas.save(result_path, 'PNG')
        storage.sync_to_s3(result_path)

        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=filename,
            tool_type="Layer Inpaint",
            settings_dict={"prompt": user_prompt, "width": canvas_width, "height": canvas_height}
        )

        updated_credits = get_updated_credits(user_id)
        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            'width': canvas_width,
            'height': canvas_height,
            **updated_credits
        })

    except Exception as e:
        print(f"  [Inpaint Layer] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Layer inpainting failed: {str(e)}'}), 500


# --------------- Compose Layers (Server-side Pillow) ---------------
@bp.route('/api/compose-layers', methods=['POST'])
def compose_layers():
    """
    Flatten visible layers with transforms into a clean PNG.
    Expects JSON: { layers: [{ filename, x, y, scaleX, scaleY, angle, flipX, flipY, opacity, visible }], width, height, projectId, userId }
    Returns: { success, resultUrl }
    """
    data = request.get_json()
    layer_data = data.get('layers', [])
    canvas_width = int(data.get('width', 1024))
    canvas_height = int(data.get('height', 1024))
    project_id = int(data.get('projectId', 1))

    user_id_raw = data.get('userId') or data.get('user_id')
    user_id = None
    if user_id_raw:
        try:
            user_id = int(user_id_raw)
        except ValueError:
            pass

    if not layer_data:
        return jsonify({'error': 'No layers provided'}), 400

    try:
        from PIL import Image

        print(f"  [Compose] Flattening {len(layer_data)} layers at {canvas_width}x{canvas_height}")

        visible_layers = [layer for layer in layer_data if layer.get('visible', True)]
        if not visible_layers:
            return jsonify({'error': 'No visible layers provided'}), 400

        def render_layer(layer_info):
            fname = layer_info.get('filename', '')
            if not fname:
                return None

            lpath = os.path.join(RESULTS_DIR, fname)
            if not os.path.exists(lpath):
                lpath = os.path.join(UPLOAD_DIR, fname)
                if not os.path.exists(lpath):
                    return None

            img = Image.open(lpath).convert('RGBA')

            if layer_info.get('flipX', False):
                img = img.transpose(Image.FLIP_LEFT_RIGHT)
            if layer_info.get('flipY', False):
                img = img.transpose(Image.FLIP_TOP_BOTTOM)

            sx = float(layer_info.get('scaleX', 1.0))
            sy = float(layer_info.get('scaleY', 1.0))
            new_w = max(1, int(img.width * abs(sx)))
            new_h = max(1, int(img.height * abs(sy)))
            img = img.resize((new_w, new_h), Image.LANCZOS)

            angle = float(layer_info.get('angle', 0))
            if angle != 0:
                img = img.rotate(-angle, expand=True, resample=Image.BICUBIC)

            opacity = float(layer_info.get('opacity', 1.0))
            if opacity < 1.0:
                r, g, b, a = img.split()
                a = a.point(lambda p: int(p * opacity))
                img = Image.merge('RGBA', (r, g, b, a))

            x = int(float(layer_info.get('x', 0)))
            y = int(float(layer_info.get('y', 0)))

            layer_canvas = Image.new('RGBA', (canvas_width, canvas_height), (0, 0, 0, 0))
            layer_canvas.paste(img, (x, y), img)
            return layer_canvas

        rendered_layers = []
        for index, layer_info in enumerate(visible_layers):
            rendered = render_layer(layer_info)
            if rendered is not None:
                rendered_layers.append((index, layer_info, rendered))

        if not rendered_layers:
            return jsonify({'error': 'No renderable layers found'}), 400

        canvas = Image.new('RGBA', (canvas_width, canvas_height), (0, 0, 0, 0))
        for _, _, rendered in rendered_layers:
            canvas.alpha_composite(rendered)

        result_id = uuid.uuid4().hex[:8]
        result_name = f"composed_{result_id}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        canvas.save(result_path, 'PNG')
        storage.sync_to_s3(result_path)

        record_activity(project_id, 'export', 1, 10, user_id=user_id)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=None,
            tool_type="Layer Compose",
            settings_dict={"numLayers": len(rendered_layers), "width": canvas_width, "height": canvas_height}
        )

        print(f"  [Compose] Saved {result_name}")

        updated_credits = get_updated_credits(user_id)
        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            **updated_credits
        })

    except Exception as e:
        print(f"  [Compose] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Composition failed: {str(e)}'}), 500
