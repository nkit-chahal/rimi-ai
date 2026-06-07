"""Credit affordability API."""
from flask import Blueprint, jsonify, request

from auth import check_credits, credit_error_payload, credit_requirement
from middleware import login_required

bp = Blueprint("credits", __name__)


@bp.route("/api/credits/check", methods=["POST"])
@login_required
def credits_check():
    data = request.get_json() or {}
    tool_key = (data.get("toolKey") or data.get("tool_key") or "").strip()
    default = data.get("default", 1)
    quantity = data.get("quantity", 1)
    if not tool_key:
        return jsonify({"success": False, "error": "toolKey is required"}), 400

    required = credit_requirement(tool_key, default, quantity)
    ok, remaining, limit, used = check_credits(None, required)
    payload = {
        "success": True,
        "ok": ok,
        "toolKey": tool_key,
        "creditsRequired": required,
        "creditsRemaining": remaining,
        "creditsUsed": used,
        "creditsLimit": limit,
    }
    if not ok:
        payload.update(credit_error_payload(required, remaining, limit, used))
        payload["success"] = False
    return jsonify(payload), 200 if ok else 403
