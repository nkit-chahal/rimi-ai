"""Image Layers routes: decompose, caption, edit, inpaint, compose."""
import json
import os
import base64

from flask import Blueprint, request, jsonify, g
from middleware import login_required, project_access_from_payload
from plan_tiers import require_pro_or_error, current_user_plan

from config import UPLOAD_DIR, RESULTS_DIR, groq_client
from auth import (
    log_export,
    check_credits,
    credit_error_payload,
    credit_requirement,
    get_updated_credits,
    record_activity,
)
from jobs import enqueue_or_run
from job_runners import run_edit_layer_job, run_image_layers_job, run_inpaint_layer_job
from services.qwen_layers import (
    execute_batch_edit_layer,
    execute_edit_layer,
    execute_image_layers,
    execute_inpaint_layer,
    _resolve_filepath,
)
from security_utils import media_access_token
import storage

bp = Blueprint('layers', __name__)


def _pro_gate(feature="Image Layers (Qwen Studio)"):
    return require_pro_or_error(current_user_plan(), feature)


def _enqueue_layer_job(job_type, tool_key, worker_fn, data, user_id, project_id):
    worker_payload = {**data, 'userId': user_id, 'projectId': project_id, 'toolKey': tool_key}
    job = enqueue_or_run(
        job_type,
        user_id,
        project_id,
        worker_payload,
        run_generation_job_proxy,
        json.dumps(worker_payload),
    )
    if job.get('error') == 'concurrency_limit':
        return jsonify({
            'error': job.get('message'),
            'retryAfterMs': job.get('retryAfterMs', 15000),
            'inflight': job.get('inflight', 0),
        }), 429
    return jsonify({'success': True, **job})


def run_generation_job_proxy(job_id, payload_json):
    """Proxy so enqueue_or_run can call the correct worker without circular imports."""
    from workers import run_generation_job
    return run_generation_job(job_id, payload_json)


# --------------- Image Layers (Qwen Image Layered) ---------------
@bp.route('/api/image-layers', methods=['POST'])
@login_required
def image_layers():
  """
  Decompose an image into separate RGBA layers using Qwen Image Layered.
  Expects JSON: { filename, numLayers (2-10), description, outputFormat, projectId, userId, async?, sessionId? }
  Returns: { success, layers: [{ url, index }] } or { success, jobId, status }
  """
  data = request.get_json() or {}
  filename = os.path.basename(data.get('filename', '') or '')
  project_id, access_error = project_access_from_payload(data)
  if access_error:
    return access_error

  user_id = g.current_user['id']
  ok_pro, pro_body, pro_code = require_pro_or_error(current_user_plan(), 'Qwen Image Layers')
  if not ok_pro:
    return pro_body, pro_code

  required_credits = credit_requirement('imageLayers', 69)
  ok, remaining, limit, used = check_credits(user_id, required_credits)
  if not ok:
    return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

  if not filename:
    return jsonify({'error': 'Filename is required'}), 400

  if not _resolve_filepath(filename):
    return jsonify({'error': 'File not found'}), 404

  if data.get('async'):
    return _enqueue_layer_job('image-layers', 'image-layers', run_image_layers_job, data, user_id, project_id)

  try:
    result = execute_image_layers({**data, 'userId': user_id, 'projectId': project_id})
    return jsonify(result)
  except Exception as e:
    print(f"  [Image Layers] Error: {e}")
    import traceback
    traceback.print_exc()
    return jsonify({'error': f'Image layer decomposition failed: {str(e)}'}), 500


# --------------- Caption Layer (Groq Vision) ---------------
@bp.route('/api/caption-layer', methods=['POST'])
@login_required
def caption_layer():
  """
  Auto-name a layer image using Groq Vision.
  Expects JSON: { filename }
  Returns: { success, name }
  """
  data = request.get_json() or {}
  filename = os.path.basename(data.get('filename', '') or '')

  if not filename:
    return jsonify({'error': 'Filename is required'}), 400

  filepath = _resolve_filepath(filename)
  if not filepath:
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
    if len(name) > 30:
      name = name[:30]

    print(f"  [Caption Layer] {filename} -> {name}")
    return jsonify({'success': True, 'name': name})

  except Exception as e:
    print(f"  [Caption Layer] Error: {e}")
    return jsonify({'success': True, 'name': 'Layer'})


# --------------- OCR text on layer ---------------
@bp.route('/api/layer-ocr', methods=['POST'])
@login_required
def layer_ocr():
  """Detect text content in a layer for text-aware revise."""
  data = request.get_json() or {}
  filename = os.path.basename(data.get('filename', '') or '')
  filepath = _resolve_filepath(filename)
  if not filepath:
    return jsonify({'error': 'File not found'}), 404

  try:
    with open(filepath, 'rb') as f:
      image_bytes = f.read()
    image_b64 = base64.b64encode(image_bytes).decode('utf-8')

    completion = groq_client.chat.completions.create(
      model="meta-llama/llama-4-scout-17b-16e-instruct",
      messages=[{
        "role": "user",
        "content": [
          {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
          {"type": "text", "text": (
            "Read any visible text in this image layer. Return JSON only: "
            '{"text":"...", "isTextHeavy": true|false}. If no text, text is empty string.'
          )},
        ],
      }],
      temperature=0.1,
      max_completion_tokens=120,
    )
    raw = completion.choices[0].message.content.strip()
    try:
      parsed = json.loads(raw)
    except json.JSONDecodeError:
      parsed = {'text': raw, 'isTextHeavy': bool(raw)}
    return jsonify({'success': True, **parsed})
  except Exception as e:
    print(f"  [Layer OCR] Error: {e}")
    return jsonify({'success': True, 'text': '', 'isTextHeavy': False})


# --------------- Edit Layer (AI per-layer editing) ---------------
@bp.route('/api/edit-layer', methods=['POST'])
@login_required
def edit_layer():
  """
  AI-edit layer(s) based on natural language prompt.
  Expects JSON: { filename | filenames[], prompt, editType, projectId, userId, async?, sessionId?, preserveSilhouette?, referenceFilename? }
  """
  data = request.get_json() or {}
  ok_pro, pro_body, pro_code = _pro_gate("Layer editing")
  if not ok_pro:
    return pro_body, pro_code
  filenames = data.get('filenames') or []
  filename = os.path.basename(data.get('filename', '') or '')
  user_prompt = data.get('prompt', '')
  project_id, access_error = project_access_from_payload(data)
  if access_error:
    return access_error

  user_id = g.current_user['id']
  ok_pro, pro_body, pro_code = require_pro_or_error(current_user_plan(), 'Qwen layer edit')
  if not ok_pro:
    return pro_body, pro_code

  batch_count = len(filenames) if filenames else 1
  required_credits = credit_requirement('imageLayerEdit', 35) * batch_count
  ok, remaining, limit, used = check_credits(user_id, required_credits)
  if not ok:
    return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

  if (not filename and not filenames) or not user_prompt:
    return jsonify({'error': 'Filename and prompt are required'}), 400

  if data.get('async'):
    return _enqueue_layer_job('edit-layer', 'edit-layer', run_edit_layer_job, data, user_id, project_id)

  try:
    if filenames:
      result = execute_batch_edit_layer({**data, 'userId': user_id, 'projectId': project_id})
    else:
      result = execute_edit_layer({**data, 'userId': user_id, 'projectId': project_id})
    return jsonify(result)
  except Exception as e:
    print(f"  [Edit Layer] Error: {e}")
    import traceback
    traceback.print_exc()
    return jsonify({'error': f'Layer editing failed: {str(e)}'}), 500


# --------------- Inpaint Layer (Qwen localized edit) ---------------
@bp.route('/api/inpaint-layer', methods=['POST'])
@login_required
def inpaint_layer():
  """
  Localized Qwen edit for one RGBA layer using a painted canvas mask.
  Expects JSON: { filename, prompt, mask, canvasWidth, canvasHeight, transform, projectId, userId, async?, sessionId? }
  """
  data = request.get_json() or {}
  ok_pro, pro_body, pro_code = _pro_gate("Layer inpaint")
  if not ok_pro:
    return pro_body, pro_code
  filename = os.path.basename(data.get('filename', '') or '')
  user_prompt = (data.get('prompt') or '').strip()
  mask_data_url = data.get('mask', '')
  project_id, access_error = project_access_from_payload(data)
  if access_error:
    return access_error

  user_id = g.current_user['id']
  ok_pro, pro_body, pro_code = require_pro_or_error(current_user_plan(), 'Qwen layer inpaint')
  if not ok_pro:
    return pro_body, pro_code

  required_credits = credit_requirement('imageLayerEdit', 35)
  ok, remaining, limit, used = check_credits(user_id, required_credits)
  if not ok:
    return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

  if not filename or not user_prompt or not mask_data_url:
    return jsonify({'error': 'Filename, prompt, and mask are required'}), 400

  if data.get('async'):
    return _enqueue_layer_job('inpaint-layer', 'inpaint-layer', run_inpaint_layer_job, data, user_id, project_id)

  try:
    result = execute_inpaint_layer({**data, 'userId': user_id, 'projectId': project_id})
    return jsonify(result)
  except Exception as e:
    print(f"  [Inpaint Layer] Error: {e}")
    import traceback
    traceback.print_exc()
    return jsonify({'error': f'Layer inpainting failed: {str(e)}'}), 500


# --------------- Smart mask (Qwen-assisted) ---------------
@bp.route('/api/smart-mask', methods=['POST'])
@login_required
def smart_mask():
  """Generate a mask image from a click point and prompt on a layer."""
  import io
  import uuid
  import replicate
  from PIL import Image
  from auth import rgba_layer_to_green_matte
  from services.qwen_layers import _download_replicate_output

  data = request.get_json() or {}
  filename = os.path.basename(data.get('filename', '') or '')
  prompt = (data.get('prompt') or '').strip()
  click_x = int(data.get('x', 0))
  click_y = int(data.get('y', 0))
  project_id, access_error = project_access_from_payload(data)
  if access_error:
    return access_error

  user_id = g.current_user['id']
  filepath = _resolve_filepath(filename)
  if not filepath or not prompt:
    return jsonify({'error': 'Filename and prompt are required'}), 400

  try:
    original_img = Image.open(filepath).convert('RGBA')
    matte_color = (30, 215, 96)
    matte_img = rgba_layer_to_green_matte(original_img, matte_color)
    matte_buffer = io.BytesIO()
    matte_img.save(matte_buffer, format='PNG')
    data_uri = f"data:image/png;base64,{base64.b64encode(matte_buffer.getvalue()).decode('utf-8')}"

    ai_prompt = (
      f"On this image with a chroma green background, create a high-contrast black-and-white mask "
      f"highlighting only: {prompt}. The mask region should be white on black. "
      f"Focus near coordinate ({click_x}, {click_y}). Keep background black."
    )
    output = replicate.run('qwen/qwen-image-edit', input={'image': data_uri, 'prompt': ai_prompt})
    result_bytes = _download_replicate_output(output)
    result_name = f'smartmask_{uuid.uuid4().hex[:8]}.png'
    result_path = os.path.join(RESULTS_DIR, result_name)
    with open(result_path, 'wb') as f:
      f.write(result_bytes)
    storage.sync_to_s3(result_path)
    log_export(
      project_id=project_id,
      filename=result_name,
      input_filename=filename,
      tool_type='Smart Mask',
      settings_dict={'prompt': prompt, 'x': click_x, 'y': click_y},
      user_id=user_id,
    )
    return jsonify({
      'success': True,
      'maskUrl': f'/results/{result_name}',
      'resultUrl': f'/results/{result_name}',
      'filename': result_name,
      'fileAccessToken': media_access_token(result_name, user_id),
    })
  except Exception as e:
    print(f"  [Smart Mask] Error: {e}")
    return jsonify({'error': f'Smart mask failed: {str(e)}'}), 500


# --------------- Compose Layers (Server-side Pillow) ---------------
@bp.route('/api/compose-layers', methods=['POST'])
@login_required
def compose_layers():
  """
  Flatten visible layers with transforms into a clean PNG.
  Expects JSON: { layers: [...], width, height, projectId, userId, sessionId? }
  """
  data = request.get_json() or {}
  layer_data = data.get('layers', [])
  canvas_width = int(data.get('width', 1024))
  canvas_height = int(data.get('height', 1024))
  session_id = data.get('sessionId')
  project_id, access_error = project_access_from_payload(data)
  if access_error:
    return access_error
  user_id = g.current_user['id']
  required_credits = credit_requirement('layerCompose', 10)
  ok, remaining, limit, used = check_credits(user_id, required_credits)
  if not ok:
    return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

  if not layer_data:
    return jsonify({'error': 'No layers provided'}), 400

  try:
    from PIL import Image
    import uuid

    print(f"  [Compose] Flattening {len(layer_data)} layers at {canvas_width}x{canvas_height}")

    visible_layers = [layer for layer in layer_data if layer.get('visible', True)]
    if not visible_layers:
      return jsonify({'error': 'No visible layers provided'}), 400

    def render_layer(layer_info):
      fname = layer_info.get('filename', '')
      if not fname:
        return None

      lpath = _resolve_filepath(fname)
      if not lpath:
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

    record_activity(project_id, 'export', 1, required_credits, user_id=user_id)
    log_export(
      project_id=project_id,
      filename=result_name,
      input_filename=None,
      tool_type="Layer Compose",
      settings_dict={
        "numLayers": len(rendered_layers),
        "width": canvas_width,
        "height": canvas_height,
        "session_id": session_id,
      },
      user_id=user_id,
    )

    if session_id:
      from datetime import datetime, timezone
      from db import db, db_lock
      now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
      with db_lock:
        conn = db()
        try:
          conn.execute(
            "UPDATE qwen_layered_sessions SET last_composed_filename = ?, updated_at = ? WHERE id = ?",
            (result_name, now, session_id),
          )
          conn.commit()
        finally:
          conn.close()

    print(f"  [Compose] Saved {result_name}")
    updated_credits = get_updated_credits(user_id)
    return jsonify({
      'success': True,
      'resultUrl': f'/results/{result_name}',
      'filename': result_name,
      'fileAccessToken': media_access_token(result_name, user_id),
      'creditsUsed': required_credits,
      **updated_credits
    })

  except Exception as e:
    print(f"  [Compose] Error: {e}")
    import traceback
    traceback.print_exc()
    return jsonify({'error': f'Composition failed: {str(e)}'}), 500
