"""Standalone job runners for RQ workers (no Flask request context)."""
import base64
import json
import os

from auth import (
    adjust_reserved_credits,
    credit_requirement,
    get_updated_credits,
    refund_credits,
    reserve_credits_or_error,
)
from config import RESULTS_DIR, UPLOAD_DIR
from jobs import update_job_progress, update_job_record


def _progress(job_id, pct, stage):
    if job_id:
        update_job_progress(job_id, pct, stage)


def run_extract_design_single_job(job_id, payload_json):
    """Background worker for /api/extract-design-single."""
    from routes.generation import EXTRACT_MODELS, _describe_image_for_extraction, _run_single_extract

    payload = json.loads(payload_json)
    user_id = int(payload["userId"])
    project_id = int(payload["projectId"])
    filename = os.path.basename(payload.get("filename") or "")
    model_id = payload.get("modelId", "")

    _progress(job_id, 5, "Validating request")
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise ValueError("File not found")

    model_cfg = next((m for m in EXTRACT_MODELS if m["id"] == model_id), None)
    if not model_cfg:
        raise ValueError(f"Unknown model: {model_id}")

    required_credits = int(model_cfg.get("credits") or credit_requirement("extract", 148))
    ok, err = reserve_credits_or_error(user_id, project_id, required_credits, "generation", 1)
    if not ok:
        raise ValueError(err["error"])

    try:
        _progress(job_id, 15, "Preparing image")
        with open(filepath, "rb") as img_file:
            image_bytes = img_file.read()
            encoded_string = base64.b64encode(image_bytes).decode("utf-8")
            mime_type = "image/png" if filename.lower().endswith(".png") else "image/jpeg"
            data_uri = f"data:{mime_type};base64,{encoded_string}"

        image_description = None
        if not model_cfg["supports_image"]:
            _progress(job_id, 25, "Analyzing pattern")
            image_description = _describe_image_for_extraction(data_uri)

        _progress(job_id, 40, f"Running {model_cfg['name']}")
        result = _run_single_extract(model_cfg, data_uri, project_id, filename, image_description)

        if not result.get("resultUrl"):
            refund_credits(user_id, project_id, required_credits, note="Extract single produced no result")
        else:
            adjust_reserved_credits(
                user_id,
                project_id,
                required_credits,
                result.get("creditsUsed", required_credits),
            )

        if result.get("error"):
            raise ValueError(result["error"])

        _progress(job_id, 100, "Complete")
        credits = get_updated_credits(user_id)
        return {
            "modelId": result["modelId"],
            "resultUrl": result["resultUrl"],
            "duration": result["duration"],
            **credits,
        }
    except ValueError:
        raise
    except Exception:
        refund_credits(user_id, project_id, required_credits, note="Extract design single failed")
        raise


def run_make_seamless_job(job_id, payload_json):
    """Background worker for /api/make-seamless."""
    from services.make_seamless import execute_make_seamless

    payload = json.loads(payload_json)

    def on_progress(pct, stage):
        _progress(job_id, pct, stage)

    return execute_make_seamless(payload, on_progress=on_progress)


def _record_layer_job_versions(payload, result):
    from qwen_session_helpers import record_job_versions

    session_id = payload.get('sessionId')
    if session_id and result:
        record_job_versions(session_id, {**result, 'sourceFilename': payload.get('filename')})


def _sentry_breadcrumb(job_type, exc):
    try:
        import sentry_sdk
        sentry_sdk.add_breadcrumb(
            category='qwen_job',
            message=f'{job_type} failed: {exc}',
            level='error',
        )
    except Exception:
        pass


def run_image_layers_job(job_id, payload_json):
    """Background worker for /api/image-layers."""
    from services.qwen_layers import execute_image_layers

    payload = json.loads(payload_json)

    def on_progress(pct, stage):
        _progress(job_id, pct, stage)

    try:
        result = execute_image_layers(payload, on_progress=on_progress)
        _record_layer_job_versions(payload, result)
        return result
    except Exception as exc:
        _sentry_breadcrumb('image-layers', exc)
        raise


def run_edit_layer_job(job_id, payload_json):
    """Background worker for /api/edit-layer."""
    from services.qwen_layers import execute_batch_edit_layer, execute_edit_layer

    payload = json.loads(payload_json)
    filenames = payload.get('filenames') or []

    def on_progress(pct, stage):
        _progress(job_id, pct, stage)

    try:
        if filenames:
            result = execute_batch_edit_layer(payload, on_progress=on_progress)
        else:
            result = execute_edit_layer(payload, on_progress=on_progress)
        _record_layer_job_versions(payload, result)
        return result
    except Exception as exc:
        _sentry_breadcrumb('edit-layer', exc)
        raise


def run_inpaint_layer_job(job_id, payload_json):
    """Background worker for /api/inpaint-layer."""
    from services.qwen_layers import execute_inpaint_layer

    payload = json.loads(payload_json)

    def on_progress(pct, stage):
        _progress(job_id, pct, stage)

    try:
        result = execute_inpaint_layer(payload, on_progress=on_progress)
        _record_layer_job_versions(payload, result)
        return result
    except Exception as exc:
        _sentry_breadcrumb('inpaint-layer', exc)
        raise
