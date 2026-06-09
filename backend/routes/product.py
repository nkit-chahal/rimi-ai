"""Product polish routes: onboarding, share links, notifications, teams, API keys, print advisor."""
import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from flask import Blueprint, g, jsonify, request

from auth import check_credits, credit_requirement
from color_utils import extract_palette
from config import UPLOAD_DIR, RESULTS_DIR
from db import db
from middleware import login_required, project_access_from_payload, assert_project_access
from schemas import ApiKeyCreateRequest, ShareLinkRequest, TeamInviteRequest

bp = Blueprint("product", __name__)


@bp.route("/api/onboarding/status", methods=["GET"])
@login_required
def onboarding_status():
    conn = db()
    try:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM projects WHERE user_id = ?",
            (g.current_user["id"],),
        ).fetchone()
        project_count = count["c"] if isinstance(count, dict) else count[0]
        return jsonify({
            "success": True,
            "needsOnboarding": project_count == 0,
            "sampleProjectName": "My First Pattern",
        })
    finally:
        conn.close()


@bp.route("/api/onboarding/sample-project", methods=["POST"])
@login_required
def create_sample_project():
    user_id = g.current_user["id"]
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conn = db()
    try:
        cur = conn.execute(
            """
            INSERT INTO projects (name, status, thumbnail_url, hero_image_url, updated_at, user_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("My First Pattern", "Draft", "/demo_geometric.png", "/demo_geometric.png", now, user_id),
        )
        project_id = cur.lastrowid
        conn.execute("INSERT INTO project_metrics (project_id) VALUES (?)", (project_id,))
        conn.execute(
            "INSERT INTO pattern_health (project_id, score, label, tile_seamless, color_balance, print_readiness, resolution, note) VALUES (?, 0, 'No Data', 0, 0, 0, 0, '')",
            (project_id,),
        )
        conn.execute("INSERT INTO project_controls (project_id, updated_at) VALUES (?, ?)", (project_id, now))
        conn.commit()
        return jsonify({"success": True, "projectId": project_id})
    finally:
        conn.close()


@bp.route("/api/share-links", methods=["POST"])
@login_required
def create_share_link():
    data = request.get_json() or {}
    try:
        payload = ShareLinkRequest.model_validate(data)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    denied = assert_project_access(payload.project_id)
    if denied:
        return denied

    token = secrets.token_urlsafe(24)
    expires_at = (
        datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=payload.expires_days)
    ).isoformat()
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

    conn = db()
    try:
        conn.execute(
            """
            INSERT INTO share_links (token, user_id, project_id, export_filename, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (token, g.current_user["id"], payload.project_id, payload.export_filename, expires_at, now),
        )
        conn.commit()
        return jsonify({"success": True, "shareUrl": f"/share/{token}", "expiresAt": expires_at})
    finally:
        conn.close()


@bp.route("/api/share/<token>", methods=["GET"])
def resolve_share_link(token):
    conn = db()
    try:
        row = conn.execute(
            "SELECT * FROM share_links WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            return jsonify({"success": False, "error": "Share link not found"}), 404
        link = dict(row)
        if link["expires_at"] < datetime.now(timezone.utc).replace(tzinfo=None).isoformat():
            return jsonify({"success": False, "error": "Share link expired"}), 410
        return jsonify({
            "success": True,
            "exportFilename": link["export_filename"],
            "projectId": link["project_id"],
            "downloadUrl": f"/results/{link['export_filename']}",
        })
    finally:
        conn.close()


@bp.route("/api/notifications/low-credits", methods=["POST"])
@login_required
def notify_low_credits():
    """Queue a low-credits email when configured."""
    from notifications import send_low_credits_email

    user = g.current_user
    remaining = user["credits_limit"] - user["credits_used"]
    sent = send_low_credits_email(user["email"], remaining, user["credits_limit"])
    return jsonify({"success": True, "sent": sent, "remaining": remaining})


@bp.route("/api/teams/members", methods=["GET"])
@login_required
def list_team_members():
    conn = db()
    try:
        rows = conn.execute(
            """
            SELECT tm.id, tm.email, tm.role, tm.status, tm.created_at
            FROM team_members tm
            WHERE tm.owner_user_id = ?
            ORDER BY tm.created_at DESC
            """,
            (g.current_user["id"],),
        ).fetchall()
        return jsonify({"success": True, "members": [dict(r) for r in rows]})
    finally:
        conn.close()


@bp.route("/api/teams/invite", methods=["POST"])
@login_required
def invite_team_member():
    data = request.get_json() or {}
    try:
        payload = TeamInviteRequest.model_validate(data)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conn = db()
    try:
        conn.execute(
            """
            INSERT INTO team_members (owner_user_id, email, role, status, created_at)
            VALUES (?, ?, ?, 'invited', ?)
            """,
            (g.current_user["id"], payload.email.lower(), payload.role, now),
        )
        conn.commit()
        return jsonify({"success": True})
    finally:
        conn.close()


@bp.route("/api/api-keys", methods=["GET"])
@login_required
def list_api_keys():
    conn = db()
    try:
        rows = conn.execute(
            """
            SELECT id, name, key_prefix, created_at, last_used_at
            FROM api_keys WHERE user_id = ? ORDER BY created_at DESC
            """,
            (g.current_user["id"],),
        ).fetchall()
        return jsonify({"success": True, "keys": [dict(r) for r in rows]})
    finally:
        conn.close()


@bp.route("/api/api-keys", methods=["POST"])
@login_required
def create_api_key():
    data = request.get_json() or {}
    try:
        payload = ApiKeyCreateRequest.model_validate(data)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    raw_key = f"rimi_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

    conn = db()
    try:
        cur = conn.execute(
            """
            INSERT INTO api_keys (user_id, name, key_prefix, key_hash, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (g.current_user["id"], payload.name, raw_key[:12], key_hash, now),
        )
        conn.commit()
        return jsonify({"success": True, "apiKey": raw_key, "id": cur.lastrowid})
    finally:
        conn.close()


@bp.route("/api/print-advisor", methods=["POST"])
@login_required
def print_advisor():
    data = request.get_json() or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error

    filename = os.path.basename(data.get("filename", "") or "")
    fabric_type = (data.get("fabricType") or "cotton").lower()
    volume = int(data.get("productionVolume") or 500)

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({"error": "File not found"}), 404

    required = credit_requirement("techPack", 2)
    ok, remaining, limit, used = check_credits(g.current_user["id"], required)
    if not ok:
        return jsonify({
            "success": False,
            "error": f"Insufficient credits ({remaining} remaining, {required} required)",
        }), 403

    palette = extract_palette(filepath, 6)
    color_count = len(palette)

    if volume >= 1000 and color_count <= 6:
        method = "Screen Printing"
        reason = "High volume with limited colors suits rotary/screen production."
    elif fabric_type in ("polyester", "nylon"):
        method = "Sublimation"
        reason = "Synthetic fibers respond well to sublimation for vivid color."
    elif color_count > 8:
        method = "Digital Printing"
        reason = "Complex palettes are most economical with digital print."
    else:
        method = "Rotary Printing"
        reason = "Balanced cost for mid-volume textile runs."

    return jsonify({
        "success": True,
        "analysis": {
            "recommendedMethod": method,
            "reason": reason,
            "colorCount": color_count,
            "fabricType": fabric_type,
            "productionVolume": volume,
            "palette": palette,
        },
    })
