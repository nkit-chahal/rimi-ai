"""Core Qwen layer decomposition and editing logic (shared by routes and job runners)."""
import base64
import io
import os
import time
import uuid

import replicate
import requests as http_requests
from PIL import Image, ImageFilter

from auth import (
    credit_requirement,
    decode_data_url_image,
    get_updated_credits,
    green_matte_to_rgba,
    log_export,
    log_replicate_call,
    record_activity,
    remove_background_with_rmbg,
    rgba_layer_to_green_matte,
    save_rgba_content_layer,
)
from config import RESULTS_DIR, UPLOAD_DIR
from security_utils import media_access_token
import storage


def _resolve_filepath(filename):
    filename = os.path.basename(filename) if filename else ''
    if not filename:
        return None
    filepath = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(filepath):
        return filepath
    filepath = os.path.join(RESULTS_DIR, filename)
    if os.path.exists(filepath):
        return filepath
    return None


def _build_edit_prompt(user_prompt, edit_type):
    if edit_type == 'recolor':
        return (
            f"The foreground element is on a flat chroma green background. Recolor only the foreground element: {user_prompt}. "
            "Keep the exact same shape, pose, and composition. Keep the background flat solid chroma green."
        )
    if edit_type == 'revise':
        return (
            f"The foreground layer is on a flat chroma green background. Revise only the text or graphic details: {user_prompt}. "
            "Do not edit the chroma green background. Keep the background flat solid chroma green for transparency removal."
        )
    if edit_type == 'replace':
        return (
            f"The foreground element is on a flat chroma green background. Replace only the foreground element with: {user_prompt}. "
            "Do not edit the chroma green background. Keep the background flat solid chroma green for transparency removal."
        )
    if edit_type == 'style_transfer':
        return (
            f"The foreground layer is on a flat chroma green background. Apply this style transfer: {user_prompt}. "
            "Keep the background flat solid chroma green for transparency removal."
        )
    if edit_type == 'relight':
        return (
            f"The foreground layer is on a flat chroma green background. Relight the foreground element: {user_prompt}. "
            "Keep the background flat solid chroma green for transparency removal."
        )
    if edit_type == 'reference':
        return (
            f"The foreground layer is on a flat chroma green background. Make this layer match the style of the reference image: {user_prompt}. "
            "Do not change subject shape. Keep the background flat solid chroma green for transparency removal."
        )
    return (
        f"The foreground layer is on a flat chroma green background. {user_prompt}. "
        "Keep the background flat solid chroma green for transparency removal."
    )


def _download_replicate_output(output):
    try:
        return output.read()
    except AttributeError:
        if isinstance(output, list):
            url = str(output[0])
        else:
            url = str(output)
        resp = http_requests.get(url, timeout=120)
        resp.raise_for_status()
        return resp.content


def execute_image_layers(payload, on_progress=None):
    """Decompose an image into RGBA layers via Qwen Image Layered."""
    def progress(pct, stage):
        if on_progress:
            on_progress(pct, stage)

    filename = os.path.basename(payload.get('filename', '') or '')
    num_layers = max(2, min(10, int(payload.get('numLayers', 4))))
    description = payload.get('description', 'auto')
    output_format = payload.get('outputFormat', 'png')
    project_id = int(payload.get('projectId') or 0)
    user_id = int(payload.get('userId') or 0)
    session_id = payload.get('sessionId')

    progress(5, 'Validating request')
    filepath = _resolve_filepath(filename)
    if not filepath:
        raise ValueError('File not found')

    progress(10, 'Preparing image')
    with open(filepath, 'rb') as img_file:
        image_bytes = img_file.read()
        encoded_string = base64.b64encode(image_bytes).decode('utf-8')
        mime_type = 'image/png' if filename.lower().endswith('.png') else 'image/jpeg'
        data_uri = f'data:{mime_type};base64,{encoded_string}'

    progress(20, f'Calling Qwen Image Layered ({num_layers} layers)')
    start_time = time.time()
    output = replicate.run(
        'qwen/qwen-image-layered',
        input={
            'image': data_uri,
            'num_layers': num_layers,
            'description': description,
            'go_fast': True,
            'output_format': output_format,
            'output_quality': 95,
        },
    )
    duration = time.time() - start_time
    required_credits = credit_requirement('imageLayers', 69)
    cost_usd = 0.03 + (0.01 * num_layers)
    output_bytes = 0

    progress(70, 'Downloading layers')
    layers = []
    batch_id = uuid.uuid4().hex[:8]
    output_list = list(output) if not isinstance(output, list) else output
    for i, layer_output in enumerate(output_list):
        layer_name = f'layer_{batch_id}_{i}.png'
        layer_path = os.path.join(RESULTS_DIR, layer_name)
        layer_bytes = _download_replicate_output(layer_output)
        output_bytes += len(layer_bytes)
        placement = save_rgba_content_layer(layer_bytes, layer_path)
        storage.sync_to_s3(layer_path)
        layers.append({
            'url': f'/results/{layer_name}',
            'index': i,
            'filename': layer_name,
            'fileAccessToken': media_access_token(layer_name, user_id),
            **placement,
        })

    log_replicate_call(
        project_id,
        'qwen/qwen-image-layered',
        duration,
        required_credits,
        cost_usd,
        session_id=session_id,
        output_bytes=output_bytes,
    )
    record_activity(project_id, 'generation', 1, required_credits, user_id=user_id)

    for layer in layers:
        log_export(
            project_id=project_id,
            filename=layer['filename'],
            input_filename=filename,
            tool_type='Image Layers',
            settings_dict={
                'numLayers': num_layers,
                'description': description,
                'layerIndex': layer['index'],
                'session_id': session_id,
            },
            user_id=user_id,
        )

    progress(100, 'Complete')
    updated_credits = get_updated_credits(user_id)
    return {
        'success': True,
        'layers': layers,
        'duration': duration,
        'costUsd': cost_usd,
        'creditsUsed': required_credits,
        **updated_credits,
    }


def execute_edit_layer(payload, on_progress=None):
    """AI-edit a single layer image based on a natural language prompt."""
    def progress(pct, stage):
        if on_progress:
            on_progress(pct, stage)

    filename = os.path.basename(payload.get('filename', '') or '')
    user_prompt = payload.get('prompt', '')
    edit_type = payload.get('editType', 'freeform')
    preserve_silhouette = bool(payload.get('preserveSilhouette', False))
    reference_filename = os.path.basename(payload.get('referenceFilename', '') or '')
    project_id = int(payload.get('projectId') or 0)
    user_id = int(payload.get('userId') or 0)
    session_id = payload.get('sessionId')
    layer_local_id = payload.get('layerLocalId')

    progress(5, 'Validating request')
    filepath = _resolve_filepath(filename)
    if not filepath or not user_prompt:
        raise ValueError('Filename and prompt are required')

    progress(10, 'Preparing layer')
    original_img = Image.open(filepath).convert('RGBA')
    original_alpha = original_img.split()[3]
    matte_color = (30, 215, 96)
    ai_prompt = _build_edit_prompt(user_prompt, edit_type)

    matte_img = rgba_layer_to_green_matte(original_img, matte_color)
    matte_buffer = io.BytesIO()
    matte_img.save(matte_buffer, format='PNG')
    encoded = base64.b64encode(matte_buffer.getvalue()).decode('utf-8')
    data_uri = f'data:image/png;base64,{encoded}'

    progress(30, 'Calling Qwen Image Edit')
    start_time = time.time()
    model_id = 'qwen/qwen-image-edit'
    if edit_type == 'style_transfer':
        model_id = 'fofr/style-transfer'
        style_uri = data_uri
        if reference_filename:
            ref_path = _resolve_filepath(reference_filename)
            if ref_path:
                with open(ref_path, 'rb') as ref_file:
                    ref_b64 = base64.b64encode(ref_file.read()).decode('utf-8')
                    style_uri = f'data:image/png;base64,{ref_b64}'
        output = replicate.run(model_id, input={
            'structure_image': data_uri,
            'style_image': style_uri,
            'prompt': user_prompt or 'Apply artistic style',
        })
        required_credits = credit_requirement('styleTransfer', 23)
    else:
        replicate_input = {'image': data_uri, 'prompt': ai_prompt}
        if edit_type == 'reference' and reference_filename:
            ref_path = _resolve_filepath(reference_filename)
            if ref_path:
                with open(ref_path, 'rb') as ref_file:
                    ref_b64 = base64.b64encode(ref_file.read()).decode('utf-8')
                    replicate_input['image_2'] = f'data:image/png;base64,{ref_b64}'
        output = replicate.run(model_id, input=replicate_input)
        required_credits = credit_requirement('imageLayerEdit', 35)
    duration = time.time() - start_time
    cost_usd = 0.03 if model_id == 'qwen/qwen-image-edit' else 0.02 + duration * 0.001525

    progress(75, 'Processing result')
    result_id = uuid.uuid4().hex[:8]
    result_name = f'layedit_{result_id}.png'
    result_path = os.path.join(RESULTS_DIR, result_name)
    result_bytes = _download_replicate_output(output)
    result_img = Image.open(io.BytesIO(result_bytes)).convert('RGBA')
    result_img = result_img.resize(original_img.size, Image.LANCZOS)

    if edit_type == 'recolor' or (edit_type == 'replace' and preserve_silhouette):
        final_img = green_matte_to_rgba(result_img, matte_color, preserve_alpha=original_alpha)
    else:
        final_img = remove_background_with_rmbg(result_img) or green_matte_to_rgba(result_img, matte_color)

    final_img.save(result_path, 'PNG')
    storage.sync_to_s3(result_path)

    log_replicate_call(
        project_id,
        model_id,
        duration,
        required_credits,
        cost_usd,
        session_id=session_id,
        output_bytes=len(result_bytes),
    )
    record_activity(project_id, 'generation', 1, required_credits, user_id=user_id)
    log_export(
        project_id=project_id,
        filename=result_name,
        input_filename=filename,
        tool_type='Layer Edit',
        settings_dict={
            'prompt': user_prompt,
            'editType': edit_type,
            'session_id': session_id,
            'layer_local_id': layer_local_id,
        },
        user_id=user_id,
    )

    progress(100, 'Complete')
    updated_credits = get_updated_credits(user_id)
    return {
        'success': True,
        'resultUrl': f'/results/{result_name}',
        'filename': result_name,
        'fileAccessToken': media_access_token(result_name, user_id),
        'duration': duration,
        'costUsd': cost_usd,
        'creditsUsed': required_credits,
        'editType': edit_type,
        'prompt': user_prompt,
        'parentFilename': filename,
        'layerLocalId': layer_local_id,
        **updated_credits,
    }


def execute_inpaint_layer(payload, on_progress=None):
    """Localized Qwen edit for one RGBA layer using a painted canvas mask."""
    def progress(pct, stage):
        if on_progress:
            on_progress(pct, stage)

    filename = os.path.basename(payload.get('filename', '') or '')
    user_prompt = (payload.get('prompt') or '').strip()
    mask_data_url = payload.get('mask', '')
    canvas_width = int(payload.get('canvasWidth', 1024))
    canvas_height = int(payload.get('canvasHeight', 1024))
    transform = payload.get('transform', {}) or {}
    project_id = int(payload.get('projectId') or 0)
    user_id = int(payload.get('userId') or 0)
    session_id = payload.get('sessionId')
    layer_local_id = payload.get('layerLocalId')

    progress(5, 'Validating request')
    filepath = _resolve_filepath(filename)
    if not filepath or not user_prompt or not mask_data_url:
        raise ValueError('Filename, prompt, and mask are required')

    progress(10, 'Building canvas')
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

    mask_img = decode_data_url_image(mask_data_url).convert('L').resize(
        (canvas_width, canvas_height), Image.LANCZOS
    )
    mask_img = mask_img.point(lambda p: 255 if p > 16 else 0).filter(ImageFilter.GaussianBlur(radius=1.2))
    if not mask_img.getbbox():
        raise ValueError('Mask is empty. Paint over the area to inpaint first.')

    matte_color = (30, 215, 96)
    matte_img = rgba_layer_to_green_matte(layer_canvas, matte_color)
    matte_buffer = io.BytesIO()
    matte_img.save(matte_buffer, format='PNG')
    data_uri = f'data:image/png;base64,{base64.b64encode(matte_buffer.getvalue()).decode("utf-8")}'

    ai_prompt = (
        f"The image contains a foreground layer on a flat chroma green background. "
        f"Edit only the user-painted masked area according to this instruction: {user_prompt}. "
        "Keep the chroma green background unchanged. Do not change unmasked content."
    )

    progress(35, 'Calling Qwen Image Edit')
    start_time = time.time()
    output = replicate.run('qwen/qwen-image-edit', input={'image': data_uri, 'prompt': ai_prompt})
    duration = time.time() - start_time
    required_credits = credit_requirement('imageLayerEdit', 35)
    cost_usd = 0.03

    progress(75, 'Compositing inpaint result')
    result_bytes = _download_replicate_output(output)
    result_img = Image.open(io.BytesIO(result_bytes)).convert('RGBA').resize(
        (canvas_width, canvas_height), Image.LANCZOS
    )
    edited_rgba = remove_background_with_rmbg(result_img) or green_matte_to_rgba(result_img, matte_color)
    final_canvas = Image.composite(edited_rgba, layer_canvas, mask_img)

    result_id = uuid.uuid4().hex[:8]
    result_name = f'layinpaint_{result_id}.png'
    result_path = os.path.join(RESULTS_DIR, result_name)
    final_canvas.save(result_path, 'PNG')
    storage.sync_to_s3(result_path)

    log_replicate_call(
        project_id,
        'qwen/qwen-image-edit',
        duration,
        required_credits,
        cost_usd,
        session_id=session_id,
        output_bytes=len(result_bytes),
    )
    record_activity(project_id, 'generation', 1, required_credits, user_id=user_id)
    log_export(
        project_id=project_id,
        filename=result_name,
        input_filename=filename,
        tool_type='Layer Inpaint',
        settings_dict={
            'prompt': user_prompt,
            'width': canvas_width,
            'height': canvas_height,
            'session_id': session_id,
            'layer_local_id': layer_local_id,
        },
        user_id=user_id,
    )

    progress(100, 'Complete')
    updated_credits = get_updated_credits(user_id)
    return {
        'success': True,
        'resultUrl': f'/results/{result_name}',
        'filename': result_name,
        'fileAccessToken': media_access_token(result_name, user_id),
        'width': canvas_width,
        'height': canvas_height,
        'duration': duration,
        'costUsd': cost_usd,
        'creditsUsed': required_credits,
        'editType': 'inpaint',
        'prompt': user_prompt,
        'parentFilename': filename,
        'layerLocalId': layer_local_id,
        **updated_credits,
    }


def execute_batch_edit_layer(payload, on_progress=None):
    """Apply the same edit prompt to multiple layer filenames."""
    filenames = payload.get('filenames') or []
    if not filenames:
        raise ValueError('At least one filename is required')

    results = []
    errors = []
    total = len(filenames)
    for index, fname in enumerate(filenames):
        single_payload = {**payload, 'filename': fname}
        try:
            if on_progress:
                on_progress(int(5 + (index / total) * 90), f'Editing layer {index + 1}/{total}')
            result = execute_edit_layer(single_payload, on_progress=None)
            results.append(result)
        except Exception as exc:
            errors.append({'filename': fname, 'error': str(exc)})

    if on_progress:
        on_progress(100, 'Complete')

    return {
        'success': len(results) > 0,
        'results': results,
        'errors': errors,
    }
