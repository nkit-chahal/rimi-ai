"""Embroidery Mockups: placement-aware product renders.

Unlike Mappings, which tiles a print over the whole product, this asks the image model to
recreate a flattened placement as raised embroidery on one zone (pallu, neckline, border...)
and to leave the rest of the fabric plain.
"""
import os
import time
import uuid

import replicate
from flask import Blueprint, g, jsonify, request
from PIL import Image

from auth import (
    adjust_reserved_credits,
    credit_requirement,
    get_updated_credits,
    log_export,
    log_replicate_call,
    refund_credits,
    reserve_credits_or_error,
)
from config import RESULTS_DIR, UPLOAD_DIR, groq_client
from middleware import login_required, project_access_from_payload
from plan_tiers import current_user_plan, require_pro_or_error
from rate_limits import generation_rate_limit
from routes.mockups import MAX_RETRIES, MODEL_ID, PRODUCT_PROMPTS, RETRY_BACKOFF_SECONDS, _image_to_data_uri
from security_utils import media_access_token, safe_fetch_url
import storage

bp = Blueprint('embroidery_mockups', __name__)

TECHNIQUE_PROMPTS = {
    'thread': 'hand-guided thread embroidery with visible satin and fill stitches and a soft thread sheen',
    'zari': 'zari embroidery in metallic gold and silver thread with a raised, glinting texture',
    'applique': 'appliqué work: fabric patches stitched down with a neat satin-stitch edge',
    'sequin': 'sequin and bead work catching the light, each sequin and bead individually visible',
    'mirror': 'shisha mirror work with small mirrors held by stitched thread rings',
}
BACKGROUNDS = {
    'studio': 'Premium studio background.',
    'lifestyle': 'Tasteful lifestyle scene.',
    'transparent': 'Clean isolated white background.',
    'dark': 'Refined dark editorial background.',
}
SHOTS = {
    'editorial': 'Editorial product photography.',
    'flat lay': 'Flat-lay top-down photography.',
    'close-up': 'Close-up emphasizing the stitch texture.',
}
MAX_TEXT = 60


def _resolve_path(filename):
    filename = os.path.basename(filename or '')
    if not filename:
        return None
    for folder in (UPLOAD_DIR, RESULTS_DIR):
        path = os.path.join(folder, filename)
        if os.path.exists(path):
            return path
    return None


def _clean_text(value, fallback=''):
    text = str(value or '').strip().replace('\n', ' ')
    return text[:MAX_TEXT] if text else fallback


def build_prompt(product_type, zone, technique, fabric, background, shot_style, description, custom_prompt=''):
    """Compose the model prompt. Kept separate so tests can pin the wording."""
    technique_text = TECHNIQUE_PROMPTS.get(technique, TECHNIQUE_PROMPTS['thread'])
    base_prompt = PRODUCT_PROMPTS.get(product_type, PRODUCT_PROMPTS['custom_product'])
    prompt = (
        f"Use @Image 1 as the embroidery placement design. It shows: {description}. "
        f"Recreate this design as real {technique_text}, keeping the exact arrangement, proportions and colours of the motifs in @Image 1. "
        f"Place the embroidery on the {zone} of the product only. Do NOT repeat it as an all-over print; the rest of the fabric stays plain {fabric}. "
        f"Product: {base_prompt} "
        f"Fabric: {fabric} with realistic weave, natural folds and draping; the stitches sit on top of the fabric with slight relief and shadow. "
        f"{BACKGROUNDS.get(background, BACKGROUNDS['studio'])} {SHOTS.get(shot_style, SHOTS['editorial'])} "
        "Photorealistic product photography, 4K."
    )
    if custom_prompt:
        prompt += f" Art direction: {custom_prompt}"
    return prompt


def _describe(image_uri):
    try:
        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_uri}},
                    {"type": "text", "text": (
                        "Describe this embroidery placement design for an AI image generator: the motifs, their arrangement "
                        "on the base fabric, thread colours (specific names) and the base colour. 2 sentences max. Output ONLY the description."
                    )},
                ],
            }],
            temperature=0.2,
            max_completion_tokens=160,
        )
        return completion.choices[0].message.content.strip()
    except Exception as exc:
        print(f"  [EmbMockup] Groq description failed: {exc}")
        return 'embroidered motifs arranged on a fabric base'


def render_mockup(source_img, product_type, zone, technique, fabric, background, shot_style, custom_prompt, project_id):
    """Call the image model with retries. Returns (filename, credits_used, prompt)."""
    image_uri = _image_to_data_uri(source_img)
    description = _describe(image_uri)
    prompt = build_prompt(product_type, zone, technique, fabric, background, shot_style, description, custom_prompt)

    result_url = None
    credits_used = 0
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            t0 = time.time()
            output = replicate.run(MODEL_ID, input={'prompt': prompt, 'image_input': [image_uri], 'aspect_ratio': '1:1'})
            duration = time.time() - t0
            credits_used = credit_requirement('embroideryMockup', 67)
            log_replicate_call(project_id, MODEL_ID, duration, credits_used, 0.067)
            result_url = str(output[0]) if isinstance(output, list) and output else str(output)
            break
        except Exception as exc:
            print(f"  [EmbMockup] Attempt {attempt}/{MAX_RETRIES} failed: {exc}")
            if attempt < MAX_RETRIES:
                time.sleep(attempt * RETRY_BACKOFF_SECONDS)
            else:
                raise
    if not result_url:
        raise RuntimeError('Model returned no output.')

    content = safe_fetch_url(result_url, timeout=120)
    name = f"embmockup_{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(RESULTS_DIR, name)
    with open(path, 'wb') as handle:
        handle.write(content)
    storage.sync_to_s3(path)
    return name, credits_used, prompt


@bp.route('/api/embroidery/mockup', methods=['POST'])
@login_required
@generation_rate_limit
def embroidery_mockup():
    ok_pro, pro_body, pro_code = require_pro_or_error(current_user_plan(), 'Embroidery Mockups')
    if not ok_pro:
        return pro_body, pro_code

    data = request.get_json(silent=True) or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user = g.current_user
    user_id = user['id']

    source_filename = os.path.basename(str(data.get('sourceFilename') or ''))
    product_type = str(data.get('productType') or '')
    zone = _clean_text(data.get('zone'))
    technique = str(data.get('technique') or 'thread')
    fabric = _clean_text(data.get('fabric'), 'cotton')
    background = str(data.get('background') or 'studio')
    shot_style = str(data.get('shotStyle') or 'editorial')
    custom_prompt = str(data.get('customPrompt') or '').strip()[:300]

    if not source_filename:
        return jsonify({'success': False, 'error': 'sourceFilename is required'}), 400
    if product_type not in PRODUCT_PROMPTS or product_type == 'custom_product':
        return jsonify({'success': False, 'error': 'productType is not a supported product'}), 400
    if not zone:
        return jsonify({'success': False, 'error': 'zone is required (for example pallu, neckline, border)'}), 400
    if technique not in TECHNIQUE_PROMPTS:
        return jsonify({'success': False, 'error': f"technique must be one of: {', '.join(TECHNIQUE_PROMPTS)}"}), 400

    from routes.upload import _user_can_access_file
    source_path = _resolve_path(source_filename)
    if not source_path:
        return jsonify({'success': False, 'error': 'Source file not found'}), 404
    if not _user_can_access_file(source_filename, user_id, user.get('role')):
        return jsonify({'success': False, 'error': 'You do not have access to the source file'}), 403

    required_credits = credit_requirement('embroideryMockup', 67)
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', 1)
    if not ok:
        return jsonify(err), 403

    try:
        with Image.open(source_path) as img:
            source = img.convert('RGBA')
        # Bare motifs on transparency are shown to the model on white so the placement reads clearly.
        flat = Image.new('RGBA', source.size, (255, 255, 255, 255))
        flat.alpha_composite(source)
        mockup_name, credits_used, prompt = render_mockup(
            flat.convert('RGB'), product_type, zone, technique, fabric, background, shot_style, custom_prompt, project_id,
        )
        adjust_reserved_credits(user_id, project_id, required_credits, credits_used, note='Embroidery mockup partial refund')
        log_export(
            project_id=project_id,
            filename=mockup_name,
            input_filename=source_filename,
            tool_type='Embroidery Mockup',
            settings_dict={'productType': product_type, 'zone': zone, 'technique': technique, 'fabric': fabric},
            user_id=user_id,
        )
        return jsonify({
            'success': True,
            'mockupUrl': f'/results/{mockup_name}',
            'filename': mockup_name,
            'fileAccessToken': media_access_token(mockup_name, user_id),
            'productType': product_type,
            'zone': zone,
            'technique': technique,
            'fabric': fabric,
            'prompt': prompt,
            'creditsUsed': credits_used,
            **get_updated_credits(user_id),
        })
    except Exception as exc:
        refund_credits(user_id, project_id, required_credits, note='Embroidery mockup failed')
        print(f"  [EmbMockup] Error: {exc}")
        return jsonify({'success': False, 'error': f'Failed to generate mockup: {exc}'}), 500
