"""Credit affordability API."""
from flask import Blueprint, jsonify, g

from auth import check_credits, credit_error_payload, credit_requirement
from middleware import login_required, current_user_id
from schemas import CreditsCheckRequest
from validation import validate_json

bp = Blueprint("credits", __name__)


@bp.route("/api/credits/check", methods=["POST"])
@login_required
@validate_json(CreditsCheckRequest)
def credits_check(data: CreditsCheckRequest):
    tool_key = data.tool_key
    required = credit_requirement(tool_key, data.default, data.quantity)
    ok, remaining, limit, used = check_credits(current_user_id(), required)
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
