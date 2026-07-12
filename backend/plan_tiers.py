"""Plan tiers: Normal vs Pro model/tool access and credit helpers.

Credits formula (backend/db.py): credits = ceil(cost_usd * 1150)
Replicate panel prices locked 2026-07-12 for new Pro models.
"""
from __future__ import annotations

import math
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
    "google/imagen-4-fast",
    "google/nano-banana",
})

PRO_INSPIRE_MODELS = frozenset({
    "bytedance/seedream-4.5",
    "google/nano-banana-2",
    "openai/gpt-image-2",
    "google/imagen-4-ultra",
    "black-forest-labs/flux-2-pro",
})

NORMAL_EXTRACT_MODELS = frozenset({
    "xai/grok-imagine-image",
    "google/nano-banana",
    "google/imagen-4-fast",
    "black-forest-labs/flux-schnell",
})

PRO_EXTRACT_MODELS = frozenset({
    "bytedance/seedream-4.5",
    "google/nano-banana-2",
    "openai/gpt-image-2",
    "google/imagen-4-ultra",  # text-only on Replicate; caption → T2I
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


def is_pro_plan(plan: Any) -> bool:
    if not plan:
        return False
    return str(plan).strip().lower() in PRO_PLANS


def tier_label(plan: Any) -> str:
    return "pro" if is_pro_plan(plan) else "normal"


def attach_tier_fields(payload: dict, plan: Any = None) -> dict:
    """Add isPro + tier onto a user JSON payload."""
    plan_val = plan if plan is not None else payload.get("plan")
    payload = dict(payload)
    payload["isPro"] = is_pro_plan(plan_val)
    payload["tier"] = tier_label(plan_val)
    return payload


def model_allowed_for_tool(plan: Any, model_id: str, tool: str) -> bool:
    """Return True if this plan may run model_id for tool (inspire|extract)."""
    mid = (model_id or "").strip()
    tool_key = (tool or "").strip().lower()
    pro = is_pro_plan(plan)

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


def require_pro_or_error(plan: Any, feature: str = "This feature"):
    """
    If plan is not Pro, return (False, flask response, 403).
    Otherwise (True, None, None).
    """
    if is_pro_plan(plan):
        return True, None, None
    body = jsonify({
        "success": False,
        "error": f"{feature} requires a Pro plan. Upgrade via Billing (Pro or Scale pack).",
        "requiresPro": True,
        "tier": "normal",
    })
    return False, body, 403


def require_model_or_error(plan: Any, model_id: str, tool: str):
    """Gate a single model for inspire/extract."""
    if model_allowed_for_tool(plan, model_id, tool):
        return True, None, None
    body = jsonify({
        "success": False,
        "error": f"Model '{model_id}' is Pro-only. Upgrade via Billing to unlock it.",
        "requiresPro": True,
        "modelId": model_id,
        "tier": tier_label(plan),
    })
    return False, body, 403


def current_user_plan() -> Optional[str]:
    from flask import g
    user = getattr(g, "current_user", None) or {}
    return user.get("plan")
