"""Background job status API."""
import json

from flask import Blueprint, g, jsonify

from db import db
from middleware import login_required

bp = Blueprint("jobs", __name__)


@bp.route("/api/jobs/<int:job_id>", methods=["GET"])
@login_required
def get_job_status(job_id):
    conn = db()
    try:
        row = conn.execute("SELECT * FROM background_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return jsonify({"success": False, "error": "Job not found"}), 404
        job = dict(row)
        if job["user_id"] != g.current_user["id"] and g.current_user.get("role") != "admin":
            return jsonify({"success": False, "error": "Forbidden"}), 403
        return jsonify({
            "success": True,
            "job": {
                "id": job["id"],
                "status": job["status"],
                "jobType": job["job_type"],
                "result": json.loads(job["result_json"]) if job.get("result_json") else None,
                "error": job.get("error"),
                "createdAt": job["created_at"],
                "completedAt": job.get("completed_at"),
            },
        })
    finally:
        conn.close()
