"""Plan tiers: Normal vs Pro model/tool access and credit helpers.

Credits formula (backend/db.py): credits = ceil(cost_usd * 1150)
Replicate panel prices locked 2026-07-12 for new Pro models.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from flask import jsonify

# Plans that unlock Pro models and Pro-only tools.
PRO_PLANS = frozenset({
    "pro",
    "scale",
    "business pro",
    "business studio",
    "enterprise pro",
})

# Normal-tier models (Inspire + Pattern extract)
NORMAL_INSPIRE_MODELS = frozenset({
    "black-forest-labs/flux-schnell",
    "xai/grok-imagine-image",
    "google/nano-banana",
})

PRO_INSPIRE_MODELS = frozenset({
    "bytedance/seedream-4.5",
    "google/nano-banana-2",
    "openai/gpt-image-2",
    "black-forest-labs/flux-2-pro",
})

NORMAL_EXTRACT_MODELS = frozenset({
    "xai/grok-imagine-image",
    "google/nano-banana",
    "black-forest-labs/flux-schnell",
})

PRO_EXTRACT_MODELS = frozenset({
    "bytedance/seedream-4.5",
    "google/nano-banana-2",
    "openai/gpt-image-2",
    "black-forest-labs/flux-2-pro",
})

PRO_ONLY_TOOLS = frozenset({
    "imagelayers",
    "mockup3d",
})


def credits_from_usd(cost_usd: float) -> int:
    """Map Replicate USD to RIMI credits with +15% safety (×1150)."""
    return int(math.ceil(float(cost_usd) * 1150))


def flux2_pro_credits(has_reference: bool = False, output_mp: float = 1.0, input_mp: float = 1.0) -> int:
    """
    Flux 2 Pro Replicate pricing (2026-07-12):
      $0.015 / run + $0.015 / input MP + $0.015 / output MP
    Default: 1 MP output; 0 or 1 MP input.
    """
    run = 0.015
    out = 0.015 * float(output_mp)
    inp = (0.015 * float(input_mp)) if has_reference else 0.0
    return credits_from_usd(run + out + inp)


# How long one Pro purchase keeps Pro access open. Matches the credit window in
# auth.CREDIT_EXPIRY_DAYS so a pack's credits and its Pro access lapse together.
PRO_DURATION_DAYS = 30


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def parse_pro_until(value: Any) -> Optional[datetime]:
    """Parse a stored pro_until timestamp into a naive UTC datetime (None when unusable)."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def pro_until_from(current_value: Any = None, now: Optional[datetime] = None,
                   days: int = PRO_DURATION_DAYS) -> str:
    """Next Pro expiry: stack onto an unexpired window, otherwise start from now.

    Buying a second Pro pack while the first is still running adds to the remaining time
    instead of discarding it, which is how credit expiry in auth.py already behaves.
    """
    now = now or _utc_now()
    if getattr(now, "tzinfo", None) is not None:
        now = now.astimezone(timezone.utc).replace(tzinfo=None)
    current = parse_pro_until(current_value)
    base = current if (current and current > now) else now
    return (base + timedelta(days=days)).isoformat()


def _is_record(subject: Any) -> bool:
    """True for a user row (dict / sqlite3.Row / RealDictRow) rather than a plan string."""
    return subject is not None and not isinstance(subject, str)


def _record_field(subject: Any, key: str) -> Any:
    try:
        return subject[key]
    except (KeyError, IndexError, TypeError):
        return None


def _record_has_field(subject: Any, key: str) -> bool:
    """Whether the row actually carries this column.

    A NULL pro_until means "no Pro access"; a missing column means the caller built the
    payload by hand and never fetched it. Those must not be treated the same.
    """
    if isinstance(subject, dict):
        return key in subject
    keys = getattr(subject, "keys", None)
    if callable(keys):
        try:
            return key in list(keys())
        except Exception:
            return False
    return False


def is_pro_plan(plan: Any) -> bool:
    """Legacy plan-name check.

    Carries no expiry information, so it can only answer "is this label a Pro label".
    Gating code must use is_pro(user_row) instead.
    """
    if not plan:
        return False
    return str(plan).strip().lower() in PRO_PLANS


def pro_expires_at(subject: Any) -> Optional[datetime]:
    """When this user's Pro access lapses, or None when they hold no Pro window."""
    if not _is_record(subject):
        return None
    return parse_pro_until(_record_field(subject, "pro_until"))


def is_pro(subject: Any, now: Optional[datetime] = None) -> bool:
    """True when the subject has Pro access right now.

    A user row carrying pro_until is authoritative: Pro is a dated entitlement that lapses
    when that timestamp passes, whatever the plan label still says. A row without the column
    (a hand-built payload) or a bare plan string has no expiry to check, so it falls back to
    the plan name.
    """
    if _is_record(subject):
        if _record_has_field(subject, "pro_until"):
            expires = parse_pro_until(_record_field(subject, "pro_until"))
            return bool(expires and expires > (now or _utc_now()))
        return is_pro_plan(_record_field(subject, "plan"))
    return is_pro_plan(subject)


def tier_label(subject: Any) -> str:
    return "pro" if is_pro(subject) else "normal"


def attach_tier_fields(payload: dict, user: Any = None) -> dict:
    """Add isPro / tier / proUntil onto a user JSON payload.

    Pass the database row as `user` so the dated Pro window decides. Without it only the
    payload's plan label is available, and a lapsed Pro account would still look Pro to
    the client.
    """
    subject = user if user is not None else payload
    payload = dict(payload)
    pro = is_pro(subject)
    payload["isPro"] = pro
    payload["tier"] = "pro" if pro else "normal"
    expires = pro_expires_at(subject)
    payload["proUntil"] = expires.isoformat() if expires else None
    return payload


def model_allowed_for_tool(subject: Any, model_id: str, tool: str) -> bool:
    """Return True if this user may run model_id for tool (inspire|extract)."""
    mid = (model_id or "").strip()
    tool_key = (tool or "").strip().lower()
    pro = is_pro(subject)

    if tool_key == "inspire":
        if mid in NORMAL_INSPIRE_MODELS:
            return True
        if mid in PRO_INSPIRE_MODELS:
            return pro
        # Unknown model: Pro only (safer default)
        return pro

    if tool_key == "extract":
        if mid in NORMAL_EXTRACT_MODELS:
            return True
        if mid in PRO_EXTRACT_MODELS:
            return pro
        return pro

    return pro


def _pro_gate_body(subject: Any, message: str, **extra):
    """Denial payload that says whether Pro lapsed or was never held."""
    expires = pro_expires_at(subject)
    lapsed = expires is not None and expires <= _utc_now()
    body = {
        "success": False,
        "error": message,
        "requiresPro": True,
        "tier": tier_label(subject),
        "proExpired": lapsed,
        "proUntil": expires.isoformat() if expires else None,
    }
    body.update(extra)
    return jsonify(body)


def require_pro_or_error(subject: Any, feature: str = "This feature"):
    """
    If the user has no live Pro access, return (False, flask response, 403).
    Otherwise (True, None, None).
    """
    if is_pro(subject):
        return True, None, None
    expires = pro_expires_at(subject)
    if expires is not None and expires <= _utc_now():
        message = (
            f"{feature} requires Pro. Your Pro access ended on "
            f"{expires.date().isoformat()} - renew with a Pro or Scale pack via Billing."
        )
    else:
        message = f"{feature} requires a Pro plan. Upgrade via Billing (Pro or Scale pack)."
    return False, _pro_gate_body(subject, message), 403


def require_model_or_error(subject: Any, model_id: str, tool: str):
    """Gate a single model for inspire/extract."""
    if model_allowed_for_tool(subject, model_id, tool):
        return True, None, None
    expires = pro_expires_at(subject)
    if expires is not None and expires <= _utc_now():
        message = (
            f"Model '{model_id}' is Pro-only and your Pro access ended on "
            f"{expires.date().isoformat()}. Renew via Billing to unlock it."
        )
    else:
        message = f"Model '{model_id}' is Pro-only. Upgrade via Billing to unlock it."
    return False, _pro_gate_body(subject, message, modelId=model_id), 403


def current_user_record() -> dict:
    """The authenticated user, with entitlement read fresh from the database.

    middleware caches the user row per process for USER_CACHE_TTL_SECONDS. That is fine
    for identity but wrong for entitlement: a customer who has just paid would keep
    getting 403 from any worker still holding the old row, and a demoted account would
    keep its access for the rest of the TTL. Clearing one worker's cache cannot fix it,
    since every worker holds its own. Each caller here guards an expensive AI call, so
    one small SELECT is cheap next to what it protects.
    """
    from flask import g

    user = getattr(g, "current_user", None) or {}
    user_id = user.get("id") if hasattr(user, "get") else None
    if not user_id:
        return user

    try:
        from db import db

        conn = db()
        try:
            row = conn.execute(
                "SELECT plan, pro_until FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        finally:
            conn.close()
    except Exception:
        # A lookup failure must not break the request; fall back to the cached row.
        return user

    if not row:
        return user
    fresh = dict(user)
    fresh["plan"] = row["plan"]
    fresh["pro_until"] = row["pro_until"]
    return fresh


def current_user_plan() -> Optional[str]:
    """The authenticated user's plan label.

    Display only - it says nothing about whether Pro is still in date.
    Use current_user_record() for anything that gates access.
    """
    from flask import g
    user = getattr(g, "current_user", None) or {}
    return user.get("plan")
