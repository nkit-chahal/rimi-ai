"""Mockup generation routes: single and batch product mockups via GPT-Image-2."""
import os
import uuid
import base64
import time
import concurrent.futures
import traceback

import replicate
import requests as http_requests
from PIL import Image
from io import BytesIO
from flask import Blueprint, request, jsonify

from config import UPLOAD_DIR, RESULTS_DIR
from auth import (
    log_export, log_replicate_call, check_credits,
    get_updated_credits, record_activity,
)

bp = Blueprint('mockups', __name__)

# ──────────────────────────────────────────────────────────────────────
# Model configuration
# ──────────────────────────────────────────────────────────────────────
MODEL_ID = "openai/gpt-image-2"
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 10  # multiplied by attempt number

# ──────────────────────────────────────────────────────────────────────
# Comprehensive product prompt library
# ──────────────────────────────────────────────────────────────────────
PRODUCT_PROMPTS = {
    # === HOME & LIVING ===
    'bed_sheet': 'A photorealistic flat bed sheet laid on a king-size bed in a bright, modern bedroom. The sheet features this exact printed fabric pattern. Show natural fabric draping, soft wrinkles, and bedroom lighting. Product photography, editorial style.',
    'pillow_cover': 'A photorealistic square decorative pillow cover on a modern sofa. The pillow features this exact printed fabric pattern. Show fabric texture, clean piped edges, and natural indoor lighting. Product photography.',
    'pillow_lumbar': 'A photorealistic lumbar/rectangular decorative pillow with this exact printed fabric pattern. Styled on a neutral sofa. Show fabric texture and soft shadows. Product photography.',
    'comforter': 'A photorealistic fluffy comforter/duvet on a bed in a cozy bedroom. The comforter features this exact printed fabric pattern. Show natural puffiness, fabric folds, and soft shadows. Product photography.',
    'curtain': 'A photorealistic pair of curtains hanging from a curtain rod next to a bright window. The curtains feature this exact printed fabric pattern. Show natural fabric draping and light filtering through. Interior design photography.',
    'table_runner': 'A photorealistic table runner laid on a wooden dining table. The table runner features this exact printed fabric pattern. Show natural fabric texture, edges, and table setting context. Product photography.',
    'tablecloth': 'A photorealistic tablecloth draped over a round dining table. The tablecloth features this exact printed fabric pattern. Show natural fabric draping, folds at edges, and table setting. Product photography.',
    'napkin_set': 'A photorealistic set of 4 folded cloth napkins arranged on a table. The napkins feature this exact printed fabric pattern. Show fabric texture and elegant folding. Product photography.',
    'cushion_floor': 'A photorealistic large floor cushion/pouf on a hardwood floor. The cushion features this exact printed fabric pattern. Show fabric texture and natural shadows. Interior design photography.',
    'throw_blanket': 'A photorealistic throw blanket casually draped over the arm of a modern sofa. The blanket features this exact printed fabric pattern. Show fabric texture, fringe edges, and cozy styling. Product photography.',
    'duvet_cover': 'A photorealistic duvet cover on a neatly made bed. The duvet features this exact printed fabric pattern. Show natural fabric texture, subtle wrinkles, and bedroom setting. Product photography.',
    'shower_curtain': 'A photorealistic shower curtain hanging in a clean modern bathroom. The curtain features this exact printed fabric pattern. Show fabric draping and bathroom setting. Product photography.',
    'apron': 'A photorealistic kitchen apron hanging on a hook or laid flat. The apron features this exact printed fabric pattern. Show fabric texture, pocket detail, and clean styling. Product photography.',
    'oven_mitt': 'A photorealistic oven mitt/pot holder pair. They feature this exact printed fabric pattern. Show quilted texture and kitchen context. Product photography.',
    'chair_upholstery': 'A photorealistic accent chair with upholstered seat featuring this exact printed fabric pattern. Show natural fabric tension, tufting details, and living room setting. Interior design photography.',
    'sofa_upholstery': 'A photorealistic modern sofa upholstered in this exact printed fabric pattern. Show natural fabric texture, cushion shapes, and living room setting. Interior design photography.',
    'ottoman': 'A photorealistic upholstered ottoman/footstool with this exact printed fabric pattern. Show fabric texture, button tufting, and living room setting. Product photography.',
    'headboard': 'A photorealistic upholstered headboard for a bed with this exact printed fabric pattern. Show fabric texture, button details, and bedroom setting. Interior design photography.',
    'wallpaper': 'A photorealistic room wall covered in wallpaper featuring this exact printed pattern. Show how the pattern repeats across the wall, with furniture in foreground for scale. Interior design photography.',

    # === APPAREL ===
    'tshirt': 'A photorealistic crew neck t-shirt laid flat on a white background. The t-shirt is made from fabric with this exact printed pattern all over. Show natural fabric texture and garment construction. Product flat-lay photography.',
    'polo': 'A photorealistic polo shirt laid flat. The polo is made from fabric with this exact printed pattern. Show collar, buttons, and natural fabric texture. Product flat-lay photography.',
    'hoodie': 'A photorealistic pullover hoodie laid flat on a white background. The hoodie is made from fabric with this exact printed pattern. Show hood, kangaroo pocket, and fabric texture. Product flat-lay photography.',
    'dress': 'A photorealistic A-line midi dress laid flat or on a mannequin. The dress is made from fabric with this exact printed pattern. Show garment silhouette and fabric draping. Product photography.',
    'kurta': 'A photorealistic Indian kurta laid flat. The kurta is made from fabric with this exact printed pattern. Show neckline detail, sleeves, and fabric texture. Product flat-lay photography.',
    'jacket': 'A photorealistic casual jacket/blazer laid flat. The jacket is made from fabric with this exact printed pattern. Show lapels, buttons, and fabric texture. Product flat-lay photography.',
    'tank_top': 'A photorealistic tank top laid flat on a white background. The tank top is made from fabric with this exact printed pattern. Show neckline and fabric texture. Product flat-lay photography.',
    'skirt': 'A photorealistic A-line skirt laid flat or on a mannequin. The skirt is made from fabric with this exact printed pattern. Show waistband and fabric draping. Product flat-lay photography.',
    'shorts': 'A photorealistic pair of casual shorts laid flat. The shorts are made from fabric with this exact printed pattern. Show waistband, pockets, and fabric texture. Product flat-lay photography.',
    'scarf': 'A photorealistic silk/fabric scarf loosely draped. The scarf features this exact printed pattern. Show fabric flow, edges, and light catching the material. Product photography.',
    'bandana': 'A photorealistic folded bandana/kerchief. The bandana features this exact printed pattern. Show fabric texture and folding. Product photography.',
    'saree': 'A photorealistic folded Indian saree fabric. The saree features this exact printed pattern. Show fabric draping, pallu border, and textile richness. Product photography.',
    'lehenga': 'A photorealistic lehenga skirt on a mannequin. The lehenga is made from fabric with this exact printed pattern. Show fabric volume, embellishment potential, and draping. Product photography.',
    'kimono': 'A photorealistic kimono robe laid flat or on a mannequin. The kimono is made from fabric with this exact printed pattern. Show wide sleeves, wrap style, and fabric draping. Product photography.',
    'swimsuit': 'A photorealistic one-piece swimsuit laid flat on a white background. The swimsuit features this exact printed pattern. Show garment shape and fabric stretching. Product flat-lay photography.',

    # === ACCESSORIES ===
    'tote_bag': 'A photorealistic canvas tote bag standing upright. The tote bag features this exact printed fabric pattern. Show bag structure, handles, and fabric texture. Product photography on white background.',
    'laptop_sleeve': 'A photorealistic padded laptop sleeve/case. The sleeve features this exact printed fabric pattern. Show zipper, padding, and fabric texture. Product photography.',
    'phone_case': 'A photorealistic fabric phone case/pouch. The case features this exact printed pattern. Show stitching and fabric texture on the phone-sized accessory. Product photography.',
    'makeup_bag': 'A photorealistic zippered cosmetics/makeup pouch. The pouch features this exact printed fabric pattern. Show zipper, shape, and fabric texture. Product photography.',
    'backpack': 'A photorealistic casual backpack. The backpack features this exact printed fabric pattern. Show straps, zippers, and fabric texture. Product photography.',
    'crossbody': 'A photorealistic crossbody/sling bag. The bag features this exact printed fabric pattern. Show strap, closure, and fabric texture. Product photography.',
    'hat_bucket': 'A photorealistic bucket hat. The hat is made from fabric with this exact printed pattern. Show brim, crown shape, and fabric texture. Product photography.',
    'tie': 'A photorealistic necktie. The tie features this exact printed pattern on silk-like fabric. Show knot, taper, and fabric sheen. Product photography.',
    'bow_tie': 'A photorealistic bow tie. The bow tie features this exact printed pattern. Show butterfly shape and fabric texture. Product photography.',

    # === WALL ART & DECOR ===
    'canvas_print': 'A photorealistic gallery-wrapped canvas print hanging on a white wall. The canvas features this exact pattern as artwork. Show canvas texture, wrapped edges, and wall shadow. Product photography.',
    'framed_print': 'A photorealistic framed art print in a modern black frame hanging on a white wall. The print features this exact pattern as artwork. Show frame, mat, and glass reflection. Product photography.',
    'poster': 'A photorealistic large format poster print. The poster features this exact pattern as a decorative art piece. Show paper quality and size context. Product photography.',

    # === FABRIC PRESENTATION ===
    'fabric_roll': 'A photorealistic bolt/roll of fabric on a table. The fabric features this exact printed pattern. Show how the pattern looks when rolled, with some fabric unrolled to display the full design. Product photography.',
    'fabric_swatch': 'A photorealistic fabric swatch/sample card. The swatch shows this exact printed pattern on fabric. Show pinked edges, fabric texture, and professional presentation. Product photography.',
    'fabric_draped': 'A photorealistic piece of fabric gracefully draped over a mannequin form. The fabric features this exact printed pattern. Show how the pattern looks with natural fabric folds and draping. Product photography.',

    # === STATIONERY ===
    'wrapping_paper': 'A photorealistic sheet of wrapping paper with a gift box partially wrapped. The paper features this exact printed pattern. Show how the pattern tiles across the paper. Product photography.',
    'notebook': 'A photorealistic hardcover notebook/journal with fabric cover. The cover features this exact printed pattern. Show notebook edges, binding, and texture. Product photography.',
}


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────

def _image_to_data_uri(pil_img: Image.Image) -> str:
    """Convert a PIL Image to a base64-encoded PNG data URI."""
    buf = BytesIO()
    pil_img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


def _load_pattern_image(filename: str = "", url: str = "") -> Image.Image:
    """
    Load the pattern image from a local file (preferred) or a remote URL.
    Returns a PIL Image in RGB mode.
    """
    if filename:
        path = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Pattern file not found: {filename}")
        return Image.open(path).convert("RGB")

    if url and url.startswith("http"):
        resp = http_requests.get(url, timeout=30)
        resp.raise_for_status()
        return Image.open(BytesIO(resp.content)).convert("RGB")

    raise ValueError("Provide either patternFilename or patternUrl")


def _get_prompt(product_type: str) -> str:
    """Look up a product prompt, falling back to a generic one."""
    return PRODUCT_PROMPTS.get(
        product_type,
        f"A photorealistic {product_type.replace('_', ' ')} made from fabric "
        f"with this exact printed pattern. Show natural fabric texture and "
        f"realistic product details. Product photography.",
    )


def _parse_user_id(data: dict) -> int | None:
    """Extract and validate userId from the request payload."""
    raw = data.get("userId") or data.get("user_id")
    if raw is None:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None


def _generate_single_mockup(
    pattern_data_uri: str,
    product_type: str,
    project_id: int,
) -> tuple[str, int]:
    """
    Call GPT-Image-2 on Replicate to generate one product mockup.

    Returns:
        (saved_filename, credits_used)

    Raises on failure after all retries are exhausted.
    """
    prompt = _get_prompt(product_type)

    # Retry loop with exponential backoff
    result_url = None
    credits_used = 0

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            t0 = time.time()
            output = replicate.run(
                MODEL_ID,
                input={
                    "prompt": prompt,
                    "input_images": [pattern_data_uri],
                    "aspect_ratio": "1:1",
                },
            )
            duration = time.time() - t0

            # Credit / cost accounting
            credits_used = max(10, int(round(duration * 12)))
            cost_usd = duration * 0.00115
            log_replicate_call(project_id, MODEL_ID, duration, credits_used, cost_usd)

            # GPT-Image-2 returns a FileOutput object; convert to string URL
            if isinstance(output, list):
                result_url = str(output[0])
            else:
                result_url = str(output)

            print(f"  [Mockup] GPT-Image-2 done for '{product_type}' "
                  f"({duration:.1f}s): {result_url[:80]}...")
            break

        except Exception as exc:
            print(f"  [Mockup] Attempt {attempt}/{MAX_RETRIES} for "
                  f"'{product_type}' failed: {exc}")
            if attempt < MAX_RETRIES:
                time.sleep(attempt * RETRY_BACKOFF_SECONDS)
            else:
                raise

    # Download the generated image and persist to RESULTS_DIR
    resp = http_requests.get(result_url, timeout=120)
    resp.raise_for_status()

    mockup_name = f"mockup_{uuid.uuid4().hex[:8]}.png"
    mockup_path = os.path.join(RESULTS_DIR, mockup_name)
    with open(mockup_path, "wb") as f:
        f.write(resp.content)

    print(f"  [Mockup] Saved: {mockup_name}")
    return mockup_name, credits_used


# ──────────────────────────────────────────────────────────────────────
# POST /api/generate-mockup  — single product mockup
# ──────────────────────────────────────────────────────────────────────

@bp.route('/api/generate-mockup', methods=['POST'])
def generate_mockup():
    """
    Generate a single product mockup using GPT-Image-2.

    Expects JSON:
        {
            patternFilename: str,     # file in UPLOAD_DIR (preferred)
            patternUrl:      str,     # or a remote URL
            productType:     str,     # key from PRODUCT_PROMPTS
            category:        str,     # for logging only
            projectId:       int,
            userId:          int|str  # optional
        }

    Returns JSON:
        { success, mockupUrl, productType }
    """
    data = request.get_json()
    pattern_filename = data.get("patternFilename", "")
    pattern_url = data.get("patternUrl", "")
    product_type = data.get("productType", "")
    category = data.get("category", "")
    project_id = int(data.get("projectId", 1))
    user_id = _parse_user_id(data)

    # ── Validation ──────────────────────────────────────────────────
    if not product_type:
        return jsonify({"error": "productType is required"}), 400

    if not pattern_filename and not pattern_url:
        return jsonify({"error": "patternFilename or patternUrl is required"}), 400

    # ── Credit check ────────────────────────────────────────────────
    ok, remaining, limit, used = check_credits(user_id)
    if not ok:
        return jsonify({
            "error": "Insufficient AI credits. Contact your admin to increase your credit limit.",
            "creditsUsed": used,
            "creditsLimit": limit,
        }), 403

    try:
        # 1. Load pattern & convert to data URI
        pattern_img = _load_pattern_image(pattern_filename, pattern_url)
        pattern_data_uri = _image_to_data_uri(pattern_img)

        # 2. Generate the mockup via GPT-Image-2
        mockup_name, credits_used = _generate_single_mockup(
            pattern_data_uri, product_type, project_id,
        )

        # 3. Record activity & log export
        record_activity(project_id, "generation", 1, credits_used, user_id=user_id)

        input_fn = (
            pattern_filename
            if pattern_filename
            else (pattern_url.split("/")[-1] if pattern_url else None)
        )
        log_export(
            project_id=project_id,
            filename=mockup_name,
            input_filename=input_fn,
            tool_type="Mappings",
            settings_dict={
                "productType": product_type,
                "category": category,
            },
        )

        # 4. Return result with updated credits
        updated_credits = get_updated_credits(user_id)
        return jsonify({
            "success": True,
            "mockupUrl": f"/results/{mockup_name}",
            "productType": product_type,
            **updated_credits,
        })

    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404

    except Exception as exc:
        print(f"  [Mockup] Error: {exc}")
        traceback.print_exc()
        return jsonify({"error": f"Failed to generate mockup: {str(exc)}"}), 500


# ──────────────────────────────────────────────────────────────────────
# POST /api/generate-mockups-batch  — multiple product mockups
# ──────────────────────────────────────────────────────────────────────

@bp.route('/api/generate-mockups-batch', methods=['POST'])
def generate_mockups_batch():
    """
    Batch-generate product mockups using GPT-Image-2 with parallel execution.

    Expects JSON:
        {
            patternFilename: str,
            products:        [str, ...],   # list of productType keys
            category:        str,
            projectId:       int,
            userId:          int|str
        }

    Returns JSON:
        { success, mockups: [...], errors: [...], creditsUsed, creditsLimit, creditsRemaining }
    """
    data = request.get_json()
    pattern_filename = data.get("patternFilename", "")
    products = data.get("products", [])
    category = data.get("category", "")
    project_id = int(data.get("projectId", 1))
    user_id = _parse_user_id(data)

    # ── Validation ──────────────────────────────────────────────────
    if not pattern_filename:
        return jsonify({"error": "patternFilename is required"}), 400

    if not products or not isinstance(products, list):
        return jsonify({"error": "products must be a non-empty list"}), 400

    # ── Credit check ────────────────────────────────────────────────
    ok, remaining, limit, used = check_credits(user_id)
    if not ok:
        return jsonify({
            "error": "Insufficient AI credits. Contact your admin to increase your credit limit.",
            "creditsUsed": used,
            "creditsLimit": limit,
        }), 403

    try:
        # 1. Load pattern once and convert to data URI
        filepath = os.path.join(UPLOAD_DIR, pattern_filename)
        if not os.path.exists(filepath):
            return jsonify({"error": "Pattern file not found"}), 404

        pattern_img = Image.open(filepath).convert("RGB")
        pattern_data_uri = _image_to_data_uri(pattern_img)

        # 2. Generate mockups in parallel (max 3 concurrent workers)
        mockups: list[dict] = []
        errors: list[dict] = []
        total_credits = 0

        def _worker(product_type: str) -> dict:
            """Worker function executed in thread pool."""
            print(f"  [Batch Mockup] Generating: {product_type}")
            mockup_name, credits = _generate_single_mockup(
                pattern_data_uri, product_type, project_id,
            )
            return {
                "productType": product_type,
                "mockupUrl": f"/results/{mockup_name}",
                "credits": credits,
            }

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_to_product = {
                executor.submit(_worker, pt): pt for pt in products
            }

            for future in concurrent.futures.as_completed(future_to_product):
                product_type = future_to_product[future]
                try:
                    result = future.result()
                    mockups.append({
                        "productType": result["productType"],
                        "mockupUrl": result["mockupUrl"],
                    })
                    total_credits += result["credits"]
                except Exception as exc:
                    print(f"  [Batch Mockup] Failed for '{product_type}': {exc}")
                    errors.append({
                        "productType": product_type,
                        "error": str(exc),
                    })

        # 3. Record activity and log exports for successful mockups
        if mockups:
            record_activity(
                project_id, "generation", len(mockups), total_credits,
                user_id=user_id,
            )

            for m in mockups:
                mockup_fn = m["mockupUrl"].split("/")[-1]
                log_export(
                    project_id=project_id,
                    filename=mockup_fn,
                    input_filename=pattern_filename,
                    tool_type="Mappings",
                    settings_dict={
                        "productType": m["productType"],
                        "category": category,
                        "batch": True,
                    },
                )

        # 4. Return results with updated credit info
        updated_credits = get_updated_credits(user_id)
        return jsonify({
            "success": True,
            "mockups": mockups,
            "errors": errors,
            **updated_credits,
        })

    except Exception as exc:
        print(f"  [Batch Mockup] Error: {exc}")
        traceback.print_exc()
        return jsonify({"error": f"Failed to generate batch mockups: {str(exc)}"}), 500
