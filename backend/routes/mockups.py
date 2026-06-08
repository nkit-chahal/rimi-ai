"""Mockup generation routes: single and batch product mockups via FLUX.2 Pro."""
import os
import uuid
import base64
import time
import concurrent.futures
import numpy as np
from PIL import Image
import replicate
import requests as http_requests
from io import BytesIO
from scipy import ndimage
from flask import Blueprint, request, jsonify

from config import UPLOAD_DIR, RESULTS_DIR, groq_client
from auth import (
    log_export, log_replicate_call, check_credits,
    credit_error_payload, credit_requirement, get_updated_credits, record_activity,
)
import storage

bp = Blueprint('mockups', __name__)

MODEL_ID = "black-forest-labs/flux-2-pro"
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5
MAX_INPUT_PX = 768  # Compress input images to save on per-megapixel billing

PRODUCT_PROMPTS = {
    'bed_sheet': 'A photorealistic flat bed sheet laid on a king-size bed in a bright, modern bedroom.',
    'pillow_cover': 'A photorealistic square decorative pillow cover on a modern sofa. Show clean piped edges.',
    'pillow_lumbar': 'A photorealistic rectangular lumbar pillow mockup on a modern sofa. Show clean piped edges.',
    'comforter': 'A photorealistic fluffy comforter/duvet on a bed in a cozy bedroom. Show natural puffiness and folds.',
    'cushion': 'A photorealistic cushion on a neutral surface. Show natural shadows.',
    'cushion_floor': 'A photorealistic large floor cushion on hardwood floor. Show natural shadows.',
    'curtain': 'A photorealistic pair of curtains hanging from a rod in a bright window. Show natural light filtering.',
    'tablecloth': 'A photorealistic tablecloth draped over a round dining table. Show natural fabric draping.',
    'table_runner': 'A photorealistic table runner laid flat on a wooden table. Show natural fabric draping.',
    'napkin_set': 'A photorealistic folded cloth napkin set mockup on a table. Show fabric folding.',
    'throw_blanket': 'A photorealistic throw blanket draped over a sofa arm. Show natural fabric draping.',
    'duvet_cover': 'A photorealistic duvet cover on a bed. Show natural fabric draping and folds.',
    'sofa_upholstery': 'A photorealistic modern sofa upholstered in this fabric pattern.',
    'wallpaper': 'A photorealistic room wall covered in wallpaper featuring this exact printed pattern.',
    'rug': 'A photorealistic large area rug laid out flat on a hardwood floor in a bright modern living room.',
    'shower_curtain': 'A photorealistic shower curtain hanging in a bright modern bathroom. Show natural folds.',
    'bath_towel': 'A photorealistic fluffy bath towel hanging on a rack or neatly folded in a bright modern bathroom.',
    'lamp_shade': 'A photorealistic cylindrical lamp shade on a modern table lamp in a cozy living room.',
    'tshirt': 'A photorealistic crew neck t-shirt. Show natural garment construction.',
    'hoodie': 'A photorealistic pullover hoodie laid flat. Show hood and pocket details.',
    'dress': 'A photorealistic A-line midi dress. Show garment silhouette and fabric draping.',
    'saree': 'A photorealistic folded Indian saree fabric. Show fabric draping and pallu border.',
    'kimono': 'A photorealistic kimono robe. Show wide sleeves and wrap style.',
    'leggings': 'A photorealistic pair of women\'s leggings. Show garment fit and fabric stretch.',
    'skirt': 'A photorealistic A-line skirt. Show natural fabric draping and silhouette.',
    'tote_bag': 'A photorealistic canvas tote bag standing upright. Show bag structure and handles.',
    'backpack': 'A photorealistic casual backpack. Show straps and zippers.',
    'phone_case': 'A photorealistic fabric-backed phone case. Show clean edges.',
    'scarf': 'A photorealistic silk scarf loosely draped. Show fabric flow and edges.',
    'umbrella': 'A photorealistic open umbrella on a neutral background. Show canopy structure.',
    'socks': 'A photorealistic pair of crew socks. Show fabric texture and shape.',
    'custom_product': 'A photorealistic product mockup matching the reference image.',
}

def _compress_image(pil_img: Image.Image, max_px: int = MAX_INPUT_PX) -> Image.Image:
    """Downscale image so longest side <= max_px to reduce megapixel billing."""
    w, h = pil_img.size
    if max(w, h) > max_px:
        scale = max_px / max(w, h)
        pil_img = pil_img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return pil_img

def _image_to_data_uri(pil_img: Image.Image, compress: bool = True) -> str:
    if compress:
        pil_img = _compress_image(pil_img)
    buf = BytesIO()
    pil_img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"

def _load_pattern_image(filename: str = "", url: str = "") -> Image.Image:
    if filename:
        filename = os.path.basename(filename)
        path = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Pattern file not found: {filename}")
        return Image.open(path).convert("RGB")
    if url and url.startswith("http"):
        resp = http_requests.get(url, timeout=30)
        resp.raise_for_status()
        return Image.open(BytesIO(resp.content)).convert("RGB")
    raise ValueError("Provide either patternFilename or patternUrl")

def _parse_user_id(data: dict) -> int | None:
    raw = data.get("userId") or data.get("user_id")
    if raw is None:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None

def _generate_single_mockup(
    pattern_img: Image.Image,
    product_type: str,
    project_id: int,
    custom_prompt: str = "",
    background: str = "studio",
    shot_style: str = "editorial",
    fabric_texture: str = "cotton",
    product_reference_data_uri: str | None = None,
    mask_data_uri: str | None = None,
) -> tuple[str, int]:
    
    # 1. Convert the source pattern to data URI to pass as a reference
    pattern_uri = _image_to_data_uri(pattern_img)
    input_images = [pattern_uri]

    if product_type == "custom_product" and product_reference_data_uri:
        input_images.append(product_reference_data_uri)

    # 2. Use Groq Vision to describe the pattern, then build a rich prompt
    base_prompt = PRODUCT_PROMPTS.get(product_type, PRODUCT_PROMPTS['custom_product'])
    
    # Ask Groq to analyze the pattern image
    pattern_description = ""
    try:
        print(f"  [Mockup] Describing pattern with Groq Vision...")
        completion = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": pattern_uri}},
                    {"type": "text", "text": (
                        "Describe this textile/fabric pattern design in precise detail for an AI image generator. "
                        "Focus on: exact motifs, shapes, icons, characters, colors (use specific names), "
                        "background color, artistic style, arrangement, and overall mood. "
                        "2-3 sentences max. Output ONLY the description."
                    )}
                ]
            }],
            temperature=0.2,
            max_completion_tokens=200,
        )
        pattern_description = completion.choices[0].message.content.strip()
        print(f"  [Mockup] Pattern described: {pattern_description[:120]}...")
    except Exception as e:
        print(f"  [Mockup] Groq description failed, using generic prompt: {e}")
        pattern_description = "a detailed repeating textile pattern"
    
    bg_p = {
        "studio": "Premium studio background.",
        "lifestyle": "Tasteful lifestyle scene.",
        "transparent": "Clean isolated white background.",
        "dark": "Refined dark editorial background."
    }
    shot_p = {
        "editorial": "Editorial product photography.",
        "flat lay": "Flat-lay top-down photography.",
        "close-up": "Close-up emphasizing material texture."
    }
    
    prompt = (
        f"Use the input reference image as the fabric print design. The pattern shows: {pattern_description}. "
        f"Apply this EXACT pattern as a seamless repeating print covering the ENTIRE fabric surface of the product. "
    )
    
    if product_type == "custom_product" and product_reference_data_uri:
        prompt += f"The product should match the shape and type shown in the second reference image. "
    else:
        prompt += f"Product: {base_prompt} "
        
    prompt += (
        f"Fabric: {fabric_texture} with realistic texture, natural folds, and draping. "
        f"The pattern must be clearly visible and recognizable — NEVER generate a plain or solid-colored product. "
        f"{bg_p.get(background, bg_p['studio'])} {shot_p.get(shot_style, shot_p['editorial'])} "
        f"Photorealistic product photography."
    )
    if custom_prompt.strip():
        prompt += f" User art direction: {custom_prompt.strip()}"

    # 3. Call FLUX.2 Pro
    print(f"  [Mockup] Running {MODEL_ID} for '{product_type}'...")
    print(f"  [Mockup] Prompt: {prompt[:200]}...")
    result_url = None
    credits_used = 0

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            t0 = time.time()
            output = replicate.run(
                MODEL_ID,
                input={
                    "prompt": prompt,
                    "input_images": input_images,
                    "aspect_ratio": "1:1",
                    "resolution": "1 MP",
                }
            )
            duration = time.time() - t0
            # flux-2-pro: $0.015/run + ~$0.009 input (0.59MP) + $0.015 output (1MP) ≈ $0.039
            credits_used = credit_requirement('mappings', 45)
            cost_usd = 0.039
            log_replicate_call(project_id, MODEL_ID, duration, credits_used, cost_usd)

            # flux-2-pro returns a FileOutput object with .url
            if hasattr(output, 'url'):
                result_url = str(output.url)
            elif isinstance(output, list) and len(output) > 0:
                result_url = str(output[0])
            else:
                result_url = str(output)
            
            print(f"  [Mockup] Done ({duration:.1f}s): {result_url[:80]}...")
            break
        except Exception as exc:
            print(f"  [Mockup] Attempt {attempt}/{MAX_RETRIES} failed: {exc}")
            if attempt < MAX_RETRIES:
                time.sleep(attempt * RETRY_BACKOFF_SECONDS)
            else:
                raise

    if not result_url:
        raise RuntimeError("Model returned no output.")

    # 4. Download and save
    resp = http_requests.get(result_url, timeout=120)
    resp.raise_for_status()

    mockup_name = f"mockup_{uuid.uuid4().hex[:8]}.png"
    mockup_path = os.path.join(RESULTS_DIR, mockup_name)
    with open(mockup_path, "wb") as f:
        f.write(resp.content)
    storage.sync_to_s3(mockup_path)

    return mockup_name, credits_used


@bp.route('/api/generate-mockup', methods=['POST'])
def generate_mockup():
    data = request.get_json()
    pattern_filename = data.get("patternFilename", "")
    pattern_filename = os.path.basename(pattern_filename) if pattern_filename else ""
    pattern_url = data.get("patternUrl", "")
    product_type = data.get("productType", "")
    category = data.get("category", "")
    custom_prompt = data.get("customPrompt", "")
    background = data.get("background", "studio")
    shot_style = data.get("shotStyle", "editorial")
    fabric_texture = data.get("fabricTexture", "cotton")
    project_id = int(data.get("projectId", 1))
    user_id = _parse_user_id(data)
    
    product_reference_data_uri = data.get("productReferenceDataUri")
    mask_data_uri = data.get("maskDataUri")

    if not product_type: return jsonify({"error": "productType is required"}), 400
    if not pattern_filename and not pattern_url: return jsonify({"error": "patternFilename or patternUrl is required"}), 400

    required_credits = credit_requirement('mappings', 45)
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok: return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

    try:
        pattern_img = _load_pattern_image(pattern_filename, pattern_url)
        mockup_name, credits_used = _generate_single_mockup(
            pattern_img, product_type, project_id,
            custom_prompt=custom_prompt, background=background, shot_style=shot_style, fabric_texture=fabric_texture,
            product_reference_data_uri=product_reference_data_uri, mask_data_uri=mask_data_uri
        )

        record_activity(project_id, "generation", 1, credits_used, user_id=user_id)
        input_fn = pattern_filename if pattern_filename else (pattern_url.split("/")[-1] if pattern_url else None)
        log_export(
            project_id=project_id, filename=mockup_name, input_filename=input_fn, tool_type="Mappings",
            settings_dict={"productType": product_type, "category": category, "texture": fabric_texture}
        )

        return jsonify({
            "success": True, "mockupUrl": f"/results/{mockup_name}", "productType": product_type,
            **get_updated_credits(user_id)
        })
    except Exception as exc:
        print(f"  [Mockup] Error: {exc}")
        return jsonify({"error": f"Failed to generate mockup: {str(exc)}"}), 500


@bp.route('/api/generate-mockups-batch', methods=['POST'])
def generate_mockups_batch():
    data = request.get_json()
    pattern_filename = data.get("patternFilename", "")
    pattern_filename = os.path.basename(pattern_filename) if pattern_filename else ""
    products = data.get("products", [])
    category = data.get("category", "")
    custom_prompt = data.get("customPrompt", "")
    background = data.get("background", "studio")
    shot_style = data.get("shotStyle", "editorial")
    fabric_texture = data.get("fabricTexture", "cotton")
    project_id = int(data.get("projectId", 1))
    user_id = _parse_user_id(data)

    product_reference_data_uri = data.get("productReferenceDataUri")
    mask_data_uri = data.get("maskDataUri")

    if not pattern_filename: return jsonify({"error": "patternFilename is required"}), 400
    if not products: return jsonify({"error": "products must be a non-empty list"}), 400

    required_credits = credit_requirement('mappings', 45, len(products))
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok: return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403

    try:
        pattern_img = _load_pattern_image(pattern_filename)
        mockups, errors = [], []
        total_credits = 0

        def _worker(product_type: str) -> dict:
            print(f"  [Batch Mockup] Generating: {product_type}")
            m_name, cr = _generate_single_mockup(
                pattern_img, product_type, project_id,
                custom_prompt=custom_prompt, background=background, shot_style=shot_style, fabric_texture=fabric_texture,
                product_reference_data_uri=product_reference_data_uri, mask_data_uri=mask_data_uri
            )
            return {"productType": product_type, "mockupUrl": f"/results/{m_name}", "credits": cr}

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_to_product = {executor.submit(_worker, pt): pt for pt in products}
            for future in concurrent.futures.as_completed(future_to_product):
                product_type = future_to_product[future]
                try:
                    res = future.result()
                    mockups.append({"productType": res["productType"], "mockupUrl": res["mockupUrl"]})
                    total_credits += res["credits"]
                except Exception as exc:
                    print(f"  [Batch Mockup] Failed for '{product_type}': {exc}")
                    errors.append({"productType": product_type, "error": str(exc)})

        if mockups:
            record_activity(project_id, "generation", len(mockups), total_credits, user_id=user_id)
            for m in mockups:
                log_export(
                    project_id=project_id, filename=m["mockupUrl"].split("/")[-1], input_filename=pattern_filename, tool_type="Mappings",
                    settings_dict={"productType": m["productType"], "category": category, "batch": True, "texture": fabric_texture}
                )

        if not mockups:
            message = errors[0]["error"] if errors else "No mockups were generated"
            return jsonify({
                "success": False,
                "error": message,
                "mockups": [],
                "errors": errors,
                **get_updated_credits(user_id),
            }), 500

        return jsonify({
            "success": True, "mockups": mockups, "errors": errors, **get_updated_credits(user_id)
        })

    except Exception as exc:
        print(f"  [Batch Mockup] Error: {exc}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": f"Failed to generate batch mockups: {str(exc)}"}), 500
