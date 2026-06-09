"""Standalone job runners for RQ workers (no Flask request context)."""
import base64
import json
import os

from auth import (
    check_credits,
    credit_error_payload,
    credit_requirement,
    get_updated_credits,
    record_activity,
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
    ok, remaining, limit, used = check_credits(user_id, required_credits)
    if not ok:
        raise ValueError(credit_error_payload(required_credits, remaining, limit, used)["error"])

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

    if result.get("creditsUsed", 0) > 0:
        record_activity(
            project_id,
            "generation",
            1 if result.get("resultUrl") else 0,
            result["creditsUsed"],
            user_id=user_id,
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


def run_make_seamless_job(job_id, payload_json):
    """Background worker for /api/make-seamless."""
    from services.make_seamless import execute_make_seamless

    payload = json.loads(payload_json)

    def on_progress(pct, stage):
        _progress(job_id, pct, stage)

    return execute_make_seamless(payload, on_progress=on_progress)
