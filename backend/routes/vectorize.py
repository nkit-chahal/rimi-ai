"""Vectorize (vtracer local / Recraft API) and Upscale (Super Resolution) routes."""
import os
import uuid
import base64
import replicate
from flask import Blueprint, request, jsonify, g
from middleware import login_required, project_access_from_payload

from config import UPLOAD_DIR, RESULTS_DIR
from auth import (
    log_export, log_replicate_call,
    get_credit_price, get_updated_credits,
    credit_requirement, refund_credits, reserve_credits_or_error,
)
from security_utils import safe_fetch_url
import storage

bp = Blueprint('vectorize', __name__)


# --------------- Vectorize (vtracer Local / Recraft API) ---------------
@bp.route('/api/vectorize', methods=['POST'])
@login_required
def vectorize_image():
    """
    Vectorizes a raster image to SVG.
    - engine='local': Uses vtracer (Rust-based, multi-color, runs locally)
    - engine='api': Uses recraft-ai/recraft-vectorize on Replicate ($0.01/run)
    Expects JSON: { filename, engine, numColors, projectId, userId }
    """
    import time
    import base64

    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    image_url = data.get('imageUrl', '')
    engine = data.get('engine', 'local')
    num_colors = int(data.get('numColors', 32))
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    pricing_key = 'vectorize' if engine == 'api' else 'vectorizeLocal'
    required_credits = get_credit_price(pricing_key, 25 if engine == 'api' else 5)
    user_id = g.current_user['id']

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
        content = safe_fetch_url(image_url, timeout=30)
        ext = '.png' if 'png' in image_url.lower() else '.jpg'
        filename = f"tmp_vec_{uuid.uuid4().hex[:8]}{ext}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        with open(filepath, 'wb') as f:
            f.write(content)
    else:
        return jsonify({'error': 'Provide either filename or imageUrl'}), 400

    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', 1)
    if not ok:
        return jsonify(err), 403

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
            cost_usd = 0.01
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
                with open(result_path, "wb") as f:
                    f.write(safe_fetch_url(svg_url, timeout=30))

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
        refund_credits(user_id, project_id, required_credits, note='Vectorization failed')
        print(f"  [Vectorize] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Vectorization failed: {str(e)}'}), 500


# --------------- Upscale (Super Resolution) ---------------
@bp.route('/api/upscale', methods=['POST'])
@login_required
def upscale():
    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    upscale_factor = data.get('upscaleFactor', 'x4')

    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    user_id = g.current_user['id']
    required_credits = credit_requirement('upscale', 23)

    if not filename:
        return jsonify({'error': 'Filename is required'}), 400

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404

    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, 'generation', 1)
    if not ok:
        return jsonify(err), 403

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
        credits_used = required_credits
        cost_usd = 0.02

        log_replicate_call(project_id, "google/upscaler", duration, credits_used, cost_usd)

        result_name = f"upscale_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)
        
        try:
            with open(result_path, "wb") as file:
                file.write(output.read())
        except AttributeError:
            # Fallback if output is just a URL string or list
            url = output[0] if isinstance(output, list) else str(output)
            with open(result_path, "wb") as file:
                file.write(safe_fetch_url(url, timeout=60))

        storage.sync_to_s3(result_path)

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
        refund_credits(user_id, project_id, required_credits, note='Upscale failed')
        print(f"  [Upscale] Error: {e}")
        return jsonify({'error': f'Failed to upscale image: {str(e)}'}), 500
