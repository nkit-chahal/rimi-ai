"""Mockup generation routes: single and batch product mockups via Flux Fill Pro."""
import os
import uuid
import base64
import replicate
import numpy as np
from PIL import Image
from flask import Blueprint, request, jsonify

from config import UPLOAD_DIR, RESULTS_DIR
from auth import (
    log_export, log_replicate_call, check_credits,
    get_updated_credits, record_activity,
)

bp = Blueprint('mockups', __name__)


# --------------- Generate Mockup (Style Transfer) ---------------
@bp.route('/api/generate-mockup', methods=['POST'])
def generate_mockup():
    """
    Uses Flux Fill Pro inpainting to place a pattern/print onto a product template.
    1. Creates a mask of the white fabric area on the product template.
    2. Tiles the pattern into the masked area as a rough composite.
    3. Uses Flux Fill Pro to refine so it looks naturally draped with folds/shadows.
    Expects JSON: { patternFilename, patternUrl, productType, category, projectId }
    """
    import requests as http_requests
    import time
    import base64
    from io import BytesIO

    data = request.get_json()
    pattern_filename = data.get('patternFilename', '')
    pattern_url = data.get('patternUrl', '')
    product_type = data.get('productType', '')
    category = data.get('category', '')
    project_id = int(data.get('projectId', 1))

    if not product_type:
        return jsonify({'error': 'productType is required'}), 400

    if not pattern_filename and not pattern_url:
        return jsonify({'error': 'patternFilename or patternUrl is required'}), 400

    try:
        # 1. Load pattern image
        if pattern_filename:
            pattern_path = os.path.join(UPLOAD_DIR, pattern_filename)
            if not os.path.exists(pattern_path):
                return jsonify({'error': 'Pattern file not found'}), 404
            pattern_img = Image.open(pattern_path).convert('RGB')
        elif pattern_url and pattern_url.startswith('http'):
            resp = http_requests.get(pattern_url, timeout=30)
            pattern_img = Image.open(BytesIO(resp.content)).convert('RGB')
        else:
            return jsonify({'error': 'Provide either patternFilename or patternUrl'}), 400

        # 2. Load product template
        product_template_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            'public', 'products', f'{product_type}.png'
        )
        if not os.path.exists(product_template_path):
            return jsonify({'error': f'Product template not found for: {product_type}'}), 404

        product_img = Image.open(product_template_path).convert('RGB')
        pw, ph = product_img.size

        # 3. Create mask of white/light fabric area
        product_arr = np.array(product_img)
        # Detect near-white pixels (fabric area)
        r, g, b = product_arr[:,:,0], product_arr[:,:,1], product_arr[:,:,2]
        brightness = (r.astype(float) + g.astype(float) + b.astype(float)) / 3.0
        saturation = np.max(product_arr, axis=2).astype(float) - np.min(product_arr, axis=2).astype(float)
        # White fabric: high brightness, low saturation
        fabric_mask = (brightness > 200) & (saturation < 40)

        # Clean up mask with morphological operations
        from scipy import ndimage
        fabric_mask = ndimage.binary_fill_holes(fabric_mask)
        fabric_mask = ndimage.binary_dilation(fabric_mask, iterations=3)
        fabric_mask = ndimage.binary_erosion(fabric_mask, iterations=3)

        mask_img = Image.fromarray((fabric_mask * 255).astype(np.uint8), mode='L')

        # 4. Tile the pattern into the fabric area to create a rough composite
        tile_w, tile_h = pattern_img.size
        # Scale pattern tile to a reasonable size relative to product
        tile_scale = max(1, min(pw, ph) // max(tile_w, tile_h))
        if tile_scale < 1:
            tile_scale = 1
        scaled_tile = pattern_img.resize((tile_w * tile_scale, tile_h * tile_scale), Image.Resampling.LANCZOS)
        stw, sth = scaled_tile.size

        # Create tiled canvas
        tiled = Image.new('RGB', (pw, ph))
        for y in range(0, ph, sth):
            for x in range(0, pw, stw):
                tiled.paste(scaled_tile, (x, y))

        # Composite: paste tiled pattern only where mask is white
        composite = product_img.copy()
        composite.paste(tiled, mask=mask_img)

        # 5. Convert to data URIs for Flux Fill Pro
        def to_data_uri(pil_img):
            buf = BytesIO()
            pil_img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
            return f"data:image/png;base64,{b64}"

        composite_uri = to_data_uri(composite)
        mask_uri = to_data_uri(mask_img)

        # Product-specific prompt for realistic rendering
        product_prompts = {
            'bed_sheet': 'a photorealistic bed sheet with this printed fabric pattern, showing natural fabric folds, draping, and shadows on a bed, product photography',
            'pillow_cover': 'a photorealistic decorative pillow cover with this printed fabric pattern, showing natural fabric texture, seams, and soft shadows, product photography',
            'comforter': 'a photorealistic comforter/duvet with this printed fabric pattern, showing natural fabric folds, puffiness, and soft shadows on a bed, product photography',
            'cushion': 'a photorealistic cushion with this printed fabric pattern, showing natural fabric texture and soft shadows, product photography',
            'tote_bag': 'a photorealistic tote bag with this printed fabric pattern, showing natural canvas texture and structure, product photography',
            'tshirt': 'a photorealistic t-shirt with this printed fabric pattern, showing natural fabric draping and wrinkles, product photography',
        }
        prompt = product_prompts.get(product_type, f'a photorealistic {product_type.replace("_", " ")} with this printed fabric pattern, product photography')

        # 6. Call Flux Fill Pro for refinement
        print(f"  [Generate Mockup] Running Flux Fill Pro for '{product_type}'...")
        result_url = None
        credits_used = 0
        for attempt in range(3):
            try:
                t0 = time.time()
                output = replicate.run(
                    "black-forest-labs/flux-fill-pro",
                    input={
                        "image": composite_uri,
                        "mask": mask_uri,
                        "prompt": prompt,
                        "output_format": "png",
                        "steps": 30,
                        "guidance": 30,
                    }
                )
                duration = time.time() - t0
                credits_used = max(10, int(round(duration * 12)))
                cost_usd = duration * 0.00115
                log_replicate_call(project_id, 'black-forest-labs/flux-fill-pro', duration, credits_used, cost_usd)

                result_url = str(output)
                print(f"  [Generate Mockup] Flux Fill done: {result_url[:80]}...")
                break
            except Exception as e:
                print(f"  [Generate Mockup] Attempt {attempt+1}/3 failed: {e}")
                if attempt < 2:
                    time.sleep((attempt + 1) * 10)
                else:
                    raise

        # 7. Download and save the result
        resp = http_requests.get(result_url, timeout=60)
        mockup_name = f"mockup_{uuid.uuid4().hex[:8]}.png"
        mockup_path = os.path.join(RESULTS_DIR, mockup_name)
        with open(mockup_path, 'wb') as f:
            f.write(resp.content)
        print(f"  [Generate Mockup] Saved mockup: {mockup_name}")

        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                user_id = None

        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)

        # Log export
        input_fn = pattern_filename if pattern_filename else (pattern_url.split('/')[-1] if pattern_url else None)
        log_export(
            project_id=project_id,
            filename=mockup_name,
            input_filename=input_fn,
            tool_type="Mappings",
            settings_dict={
                "productType": product_type,
                "category": category
            }
        )

        return jsonify({
            'success': True,
            'mockupUrl': f'/results/{mockup_name}',
            'productType': product_type,
        })

    except Exception as e:
        print(f"  [Generate Mockup] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to generate mockup: {str(e)}'}), 500


# --------------- Generate Mockups Batch ---------------
@bp.route('/api/generate-mockups-batch', methods=['POST'])
def generate_mockups_batch():
    """
    Batch version of generate-mockup. Uses Flux Fill Pro inpainting to place a
    pattern onto multiple product templates sequentially.
    Expects JSON: { patternFilename, products, category, projectId }
    """
    import requests as http_requests
    import time
    import base64
    from io import BytesIO

    data = request.get_json()
    pattern_filename = data.get('patternFilename', '')
    products = data.get('products', [])
    category = data.get('category', '')
    project_id = int(data.get('projectId', 1))

    # Extract user_id early for credit check
    user_id_raw = data.get('userId') or data.get('user_id')
    user_id_early = None
    if user_id_raw:
        try:
            user_id_early = int(user_id_raw)
        except ValueError:
            pass
    ok, remaining, limit, used = check_credits(user_id_early)
    if not ok:
        return jsonify({'error': 'Insufficient AI credits. Contact your admin to increase your credit limit.',
                        'creditsUsed': used, 'creditsLimit': limit}), 403

    if not pattern_filename:
        return jsonify({'error': 'patternFilename is required'}), 400

    if not products or not isinstance(products, list):
        return jsonify({'error': 'products must be a non-empty list'}), 400

    try:
        # 1. Load the pattern image once
        filepath = os.path.join(UPLOAD_DIR, pattern_filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'Pattern file not found'}), 404

        pattern_img = Image.open(filepath).convert('RGB')

        def to_data_uri(pil_img):
            buf = BytesIO()
            pil_img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
            return f"data:image/png;base64,{b64}"

        product_prompts = {
            'bed_sheet': 'a photorealistic bed sheet with this printed fabric pattern, showing natural fabric folds, draping, and shadows on a bed, product photography',
            'pillow_cover': 'a photorealistic decorative pillow cover with this printed fabric pattern, showing natural fabric texture, seams, and soft shadows, product photography',
            'comforter': 'a photorealistic comforter/duvet with this printed fabric pattern, showing natural fabric folds, puffiness, and soft shadows on a bed, product photography',
            'cushion': 'a photorealistic cushion with this printed fabric pattern, showing natural fabric texture and soft shadows, product photography',
            'tote_bag': 'a photorealistic tote bag with this printed fabric pattern, showing natural canvas texture and structure, product photography',
            'tshirt': 'a photorealistic t-shirt with this printed fabric pattern, showing natural fabric draping and wrinkles, product photography',
        }

        from scipy import ndimage

        # 2. Process each product
        mockups = []
        errors = []
        total_credits = 0
        for idx, product_type in enumerate(products):
            try:
                print(f"  [Batch Mockup] Processing product {idx+1}/{len(products)}: {product_type}")

                # Load product template
                product_template_path = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'public', 'products', f'{product_type}.png'
                )
                if not os.path.exists(product_template_path):
                    errors.append({'productType': product_type, 'error': f'Template not found for: {product_type}'})
                    continue

                product_img = Image.open(product_template_path).convert('RGB')
                pw, ph = product_img.size

                # Create mask of white/light fabric area
                product_arr = np.array(product_img)
                r, g, b = product_arr[:,:,0], product_arr[:,:,1], product_arr[:,:,2]
                brightness = (r.astype(float) + g.astype(float) + b.astype(float)) / 3.0
                saturation = np.max(product_arr, axis=2).astype(float) - np.min(product_arr, axis=2).astype(float)
                fabric_mask = (brightness > 200) & (saturation < 40)
                fabric_mask = ndimage.binary_fill_holes(fabric_mask)
                fabric_mask = ndimage.binary_dilation(fabric_mask, iterations=3)
                fabric_mask = ndimage.binary_erosion(fabric_mask, iterations=3)
                mask_img = Image.fromarray((fabric_mask * 255).astype(np.uint8), mode='L')

                # Tile pattern into fabric area
                tile_w, tile_h = pattern_img.size
                tile_scale = max(1, min(pw, ph) // max(tile_w, tile_h))
                if tile_scale < 1:
                    tile_scale = 1
                scaled_tile = pattern_img.resize((tile_w * tile_scale, tile_h * tile_scale), Image.Resampling.LANCZOS)
                stw, sth = scaled_tile.size
                tiled = Image.new('RGB', (pw, ph))
                for y in range(0, ph, sth):
                    for x in range(0, pw, stw):
                        tiled.paste(scaled_tile, (x, y))
                composite = product_img.copy()
                composite.paste(tiled, mask=mask_img)

                composite_uri = to_data_uri(composite)
                mask_uri = to_data_uri(mask_img)
                prompt = product_prompts.get(product_type, f'a photorealistic {product_type.replace("_", " ")} with this printed fabric pattern, product photography')

                # Call Flux Fill Pro
                result_url = None
                for attempt in range(3):
                    try:
                        t0 = time.time()
                        output = replicate.run(
                            "black-forest-labs/flux-fill-pro",
                            input={
                                "image": composite_uri,
                                "mask": mask_uri,
                                "prompt": prompt,
                                "output_format": "png",
                                "steps": 30,
                                "guidance": 30,
                            }
                        )
                        duration = time.time() - t0
                        credits_used = max(10, int(round(duration * 12)))
                        cost_usd = duration * 0.00115
                        log_replicate_call(project_id, 'black-forest-labs/flux-fill-pro', duration, credits_used, cost_usd)
                        total_credits += credits_used

                        result_url = str(output)
                        print(f"  [Batch Mockup] Flux Fill done for {product_type}: {result_url[:80]}...")
                        break
                    except Exception as e:
                        print(f"  [Batch Mockup] Attempt {attempt+1}/3 for {product_type} failed: {e}")
                        if attempt < 2:
                            time.sleep((attempt + 1) * 10)
                        else:
                            raise

                # Download and save
                resp = http_requests.get(result_url, timeout=60)
                mockup_name = f"mockup_{uuid.uuid4().hex[:8]}.png"
                mockup_path = os.path.join(RESULTS_DIR, mockup_name)
                with open(mockup_path, 'wb') as f:
                    f.write(resp.content)
                print(f"  [Batch Mockup] Saved mockup: {mockup_name}")

                mockups.append({
                    'productType': product_type,
                    'mockupUrl': f'/results/{mockup_name}',
                })

                # Rate-limit delay between requests
                if idx < len(products) - 1:
                    time.sleep(2)

            except Exception as e:
                print(f"  [Batch Mockup] Error for {product_type}: {e}")
                errors.append({'productType': product_type, 'error': str(e)})

        if mockups:
            user_id = data.get('userId') or data.get('user_id')
            if user_id:
                try:
                    user_id = int(user_id)
                except ValueError:
                    user_id = None
            record_activity(project_id, 'generation', len(mockups), total_credits, user_id=user_id)

            # Log each mockup in the batch
            for m in mockups:
                mockup_fn = m['mockupUrl'].split('/')[-1]
                log_export(
                    project_id=project_id,
                    filename=mockup_fn,
                    input_filename=pattern_filename,
                    tool_type="Mappings",
                    settings_dict={
                        "productType": m['productType'],
                        "category": category,
                        "batch": True
                    }
                )

        updated_credits = get_updated_credits(user_id)
        return jsonify({
            'success': True,
            'mockups': mockups,
            'errors': errors,
            **updated_credits
        })

    except Exception as e:
        print(f"  [Batch Mockup] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Failed to generate batch mockups: {str(e)}'}), 500
