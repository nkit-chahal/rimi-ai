"""Vectorize (vtracer local / Recraft API) and Upscale (Super Resolution) routes."""
import os
import uuid
import base64
import replicate
from flask import Blueprint, request, jsonify

from config import UPLOAD_DIR, RESULTS_DIR
from auth import (
    log_export, log_replicate_call, check_credits,
    get_credit_price, get_updated_credits, record_activity,
    credit_error_payload, credit_requirement,
)
import storage

bp = Blueprint('vectorize', __name__)


# --------------- Vectorize (vtracer Local / Recraft API) ---------------
@bp.route('/api/vectorize', methods=['POST'])
def vectorize_image():
    """
    Vectorizes a raster image to SVG.
    - engine='local': Uses vtracer (Rust-based, multi-color, runs locally)
    - engine='api': Uses recraft-ai/recraft-vectorize on Replicate ($0.01/run)
    Expects JSON: { filename, engine, numColors, projectId, userId }
    """
    import requests as http_requests
    from io import BytesIO
    import time
    import base64

    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    image_url = data.get('imageUrl', '')
    engine = data.get('engine', 'local')
    num_colors = int(data.get('numColors', 32))
    project_id = int(data.get('projectId', 1))
    pricing_key = 'vectorize' if engine == 'api' else 'vectorizeLocal'
    required_credits = get_credit_price(pricing_key, 100 if engine == 'api' else 5)

    # Extract user_id early for credit check
    user_id_raw = data.get('userId') or data.get('user_id')
    user_id_early = None
    if user_id_raw:
        try:
            user_id_early = int(user_id_raw)
        except ValueError:
            pass
    ok, remaining, limit, used = check_credits(user_id_early, required_credits)
    if not ok:
        return jsonify({
            'error': f'Insufficient AI credits. This action needs {required_credits} credits, but you have {remaining} remaining.',
            'creditsUsed': used,
            'creditsLimit': limit,
            'creditsRequired': required_credits,
            'creditsRemaining': remaining,
        }), 403

    # Resolve filepath from filename or imageUrl
    filepath = None
    PUBLIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'public')
    if filename:
        filepath = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(filepath):
            # Fallback: check public/ folder (for demo images like demo_floral.png)
            filepath = os.path.join(PUBLIC_DIR, filename)
            if not os.path.exists(filepath):
                return jsonify({'error': f'File not found: {filename}'}), 404
    elif image_url and image_url.startswith('http'):
        # Download remote image to a temp file
        print(f"  [Vectorize] Downloading image from URL...")
        resp = http_requests.get(image_url, timeout=30)
        ext = '.png' if 'png' in image_url.lower() else '.jpg'
        filename = f"tmp_vec_{uuid.uuid4().hex[:8]}{ext}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        with open(filepath, 'wb') as f:
            f.write(resp.content)
    else:
        return jsonify({'error': 'Provide either filename or imageUrl'}), 400

    credits_used = required_credits
    try:
        if engine == 'api':
            # ---- Recraft AI Vectorize (Replicate) ----
            print(f"  [Vectorize] Using recraft-ai/recraft-vectorize API...")

            with open(filepath, "rb") as img_file:
                encoded_string = base64.b64encode(img_file.read()).decode('utf-8')
                mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
                data_uri = f"data:{mime_type};base64,{encoded_string}"

            start_time = time.time()
            output = replicate.run(
                "recraft-ai/recraft-vectorize",
                input={"image": data_uri}
            )
            duration = time.time() - start_time
            credits_used = required_credits  # Recraft API / Vectorize Replicate flat
            cost_usd = duration * 0.00115  # standard GPU-based logging estimation
            log_replicate_call(project_id, "recraft-ai/recraft-vectorize", duration, credits_used, cost_usd)

            # Download the SVG result
            svg_url = str(output.url) if hasattr(output, 'url') else str(output)
            print(f"  [Vectorize] Downloading SVG from {svg_url[:60]}...")

            result_name = f"vec_{uuid.uuid4().hex[:8]}.svg"
            result_path = os.path.join(RESULTS_DIR, result_name)

            try:
                with open(result_path, "wb") as f:
                    f.write(output.read())
            except (AttributeError, TypeError):
                resp = http_requests.get(svg_url, timeout=30)
                with open(result_path, "wb") as f:
                    f.write(resp.content)

            storage.sync_to_s3(result_path)
            print(f"  [Vectorize] Recraft done! Saved: {result_name}")

        else:
            # ---- vtracer Local ----
            import vtracer
            from PIL import Image as PILImage

            print(f"  [Vectorize] Using vtracer local engine (colors={num_colors})...")

            # vtracer crashes if file extension doesn't match actual format
            # (e.g. JPEG data in a .png file). Re-save through PIL as clean PNG.
            tmp_name = f"_vtracer_tmp_{uuid.uuid4().hex[:6]}.png"
            tmp_path = os.path.abspath(os.path.join(UPLOAD_DIR, tmp_name))
            img = PILImage.open(filepath).convert('RGB')
            img.save(tmp_path, format="PNG")
            print(f"  [Vectorize] Normalized to PNG: {img.size}, {os.path.getsize(tmp_path)//1024}KB")

            result_name = f"vec_{uuid.uuid4().hex[:8]}.svg"
            result_path = os.path.abspath(os.path.join(RESULTS_DIR, result_name))

            # Map numColors slider (2-256) to vtracer parameters
            # Higher slider = more detail: higher color_precision, lower filter_speckle
            import math
            # color_precision: 3 (low detail) to 8 (max detail)
            color_precision = min(8, max(3, round(3 + 5 * math.log(num_colors, 256))))
            # filter_speckle: 1 (keep everything) to 10 (aggressive cleanup)
            filter_speckle = max(1, round(10 - 9 * math.log(num_colors, 256)))
            print(f"  [Vectorize] Params: color_precision={color_precision}, filter_speckle={filter_speckle}")

            vtracer.convert_image_to_svg_py(
                image_path=tmp_path,
                out_path=result_path,
                colormode="color",
                hierarchical="stacked",
                mode="spline",
                filter_speckle=filter_speckle,
                color_precision=color_precision,
                layer_difference=16,
                corner_threshold=60,
                length_threshold=4.0,
                max_iterations=10,
                splice_threshold=45,
                path_precision=3,
            )

            # Cleanup temp file
            os.remove(tmp_path)
            credits_used = required_credits  # CPU edits (local PIL fixes) flat

            storage.sync_to_s3(result_path)
            print(f"  [Vectorize] vtracer done! Saved: {result_name} ({os.path.getsize(result_path) // 1024}KB)")

        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                user_id = None

        try:
            record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)
        except ValueError as credit_error:
            return jsonify({'error': str(credit_error), **get_updated_credits(user_id)}), 403

        # Log export
        input_fn = filename if filename else (image_url.split('/')[-1] if image_url else None)
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=input_fn,
            tool_type="Vectorize",
            settings_dict={
                "engine": engine,
                "numColors": num_colors
            }
        )

        updated_credits = get_updated_credits(user_id)
        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            **updated_credits
        })

    except Exception as e:
        print(f"  [Vectorize] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Vectorization failed: {str(e)}'}), 500


# --------------- Upscale (Super Resolution) ---------------
@bp.route('/api/upscale', methods=['POST'])
def upscale():
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    upscale_factor = data.get('upscaleFactor', 'x4')

    # Extract user_id early for credit check
    user_id_raw = data.get('userId') or data.get('user_id')
    user_id_early = None
    if user_id_raw:
        try:
            user_id_early = int(user_id_raw)
        except ValueError:
            pass
    required_credits = credit_requirement('upscale', 60)
    ok, remaining, limit, used = check_credits(user_id_early, required_credits)
    if not ok:
        return jsonify(credit_error_payload(required_credits, remaining, limit, used)), 403
    
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404

    try:
        import base64
        import uuid
        import time
        
        print(f"  [Upscale] Processing {filename} with google/upscaler ({upscale_factor})...")
        
        with open(filepath, "rb") as img_file:
            image_bytes = img_file.read()
            encoded_string = base64.b64encode(image_bytes).decode('utf-8')
            mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
            data_uri = f"data:{mime_type};base64,{encoded_string}"

        start_time = time.time()
        output = replicate.run(
            "google/upscaler",
            input={
                "image": data_uri,
                "upscale_factor": upscale_factor
            }
        )
        duration = time.time() - start_time
        credits_used = max(10, int(round(duration * 12)))
        cost_usd = duration * 0.00115

        project_id = int(data.get('projectId', 1))
        user_id = data.get('userId') or data.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                user_id = None

        log_replicate_call(project_id, "google/upscaler", duration, credits_used, cost_usd)

        result_name = f"upscale_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        
        try:
            with open(result_path, "wb") as file:
                file.write(output.read())
        except AttributeError:
            # Fallback if output is just a URL string or list
            import requests as http_requests
            url = output[0] if isinstance(output, list) else str(output)
            resp = http_requests.get(url)
            with open(result_path, "wb") as file:
                file.write(resp.content)

        storage.sync_to_s3(result_path)

        record_activity(project_id, 'generation', 1, credits_used, user_id=user_id)

        # Log export
        log_export(
            project_id=project_id,
            filename=result_name,
            input_filename=filename,
            tool_type="Super Resolution",
            settings_dict={
                "upscaleFactor": upscale_factor
            }
        )

        updated_credits = get_updated_credits(user_id)
        return jsonify({
            'success': True,
            'resultUrl': f'/results/{result_name}',
            **updated_credits
        })

    except Exception as e:
        print(f"  [Upscale] Error: {e}")
        return jsonify({'error': f'Failed to upscale image: {str(e)}'}), 500
