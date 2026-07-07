"""Background job status API with SSE progress streaming."""
import json
import time

from flask import Blueprint, Response, g, jsonify, request

from db import db
from jobs import get_job_row
from middleware import login_required
from security_utils import issue_sse_ticket, verify_sse_ticket

bp = Blueprint("jobs", __name__)


def _job_payload(job):
    result = None
    if job.get("result_json"):
        try:
            result = json.loads(job["result_json"])
        except (TypeError, json.JSONDecodeError):
            result = job["result_json"]
    return {
        "id": job["id"],
        "status": job["status"],
        "jobType": job["job_type"],
        "progressPct": job.get("progress_pct") or 0,
        "stage": job.get("stage") or "",
        "result": result,
        "error": job.get("error"),
        "createdAt": job["created_at"],
        "completedAt": job.get("completed_at"),
    }


def _authorize_job(job):
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404
    if job["user_id"] != g.current_user["id"] and g.current_user.get("role") != "admin":
        return jsonify({"success": False, "error": "Forbidden"}), 403
    return None


@bp.route("/api/jobs/<int:job_id>", methods=["GET"])
@login_required
def get_job_status(job_id):
    job = get_job_row(job_id)
    denied = _authorize_job(job)
    if denied:
        return denied
    return jsonify({"success": True, "job": _job_payload(job)})


@bp.route("/api/jobs/<int:job_id>/sse-ticket", methods=["POST"])
@login_required
def create_sse_ticket(job_id):
    job = get_job_row(job_id)
    denied = _authorize_job(job)
    if denied:
        return denied
    ticket = issue_sse_ticket(g.current_user["id"], job_id)
    return jsonify({"success": True, "ticket": ticket})


@bp.route("/api/jobs/<int:job_id>/events", methods=["GET"])
def stream_job_events(job_id):
    ticket = request.args.get("ticket")
    if not ticket:
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    job = get_job_row(job_id)
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404
    if not verify_sse_ticket(job["user_id"], job_id, ticket):
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    def generate():
        last_payload = None
        for _ in range(600):
            current = get_job_row(job_id)
            if not current:
                break
            payload = _job_payload(current)
            serialized = json.dumps(payload)
            if serialized != last_payload:
                yield f"data: {serialized}\n\n"
                last_payload = serialized
            if current["status"] in ("completed", "failed"):
                break
            time.sleep(0.5)
        yield "data: {\"done\": true}\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
