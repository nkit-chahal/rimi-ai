"""Razorpay Standard Checkout routes."""
import hashlib
import hmac
import os
import time
from datetime import datetime, timezone

import requests
from flask import Blueprint, g, jsonify, request

from auth import expire_credits_if_needed, extend_credit_expiry, _parse_reset_at
from db import db, db_lock
from middleware import login_required
from plan_tiers import attach_tier_fields, is_pro, parse_pro_until, pro_until_from

bp = Blueprint("billing", __name__)

RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders"

# ---------------------------------------------------------------------------
# Billing plans  (7.5 credits per INR 1, ~22% gross margin after Razorpay)
# Economics (INR 100 = USD 1):
#   - Razorpay fee    : ~3% of gross
#   - Vendor budget   : 1 credit = $0.001 of true vendor cost
#                       At 7.5 credits/INR we collect INR 0.133 per credit and
#                       spend INR 0.10  =>  ~25% gross margin per recharge
#   - After Razorpay  : ~22% gross  (covers hosting, free-tier abuse, failed
#                       runs, Groq side-calls; leaves room for GST + tax)
# ---------------------------------------------------------------------------
BILLING_PLANS = [
    {
        "id": "free",
        "label": "Free",
        "track": "basic",
        "description": "Trial credits for testing the studio.",
        "credits": 50,
        "amount": 0,
        "currency": "INR",
        "badge": "",
        "features": [
            "50 starting credits",
            "Normal models only",
            "Recharge anytime",
        ],
        "disabled": True,
    },
    {
        "id": "starter",
        "label": "Starter",
        "track": "basic",
        "description": "Small production runs and evaluation.",
        "credits": 3960,
        "amount": 52800,
        "currency": "INR",
        "badge": "",
        "features": [
            "3,960 AI credits",
            "Normal models: Flux Schnell, Grok, Nano Banana",
            "Mappings (Nano Banana 2), Seamless, Repeat, Colorways, Vectorize",
        ],
    },
    {
        "id": "creator",
        "label": "Creator",
        "track": "basic",
        "description": "Best value for active textile workflows.",
        "credits": 14520,
        "amount": 193600,
        "currency": "INR",
        "badge": "Popular",
        "features": [
            "14,520 AI credits",
            "Normal models + Mappings mockups",
            "Recommended for active studios",
        ],
    },
    {
        "id": "pro",
        "label": "Pro",
        "track": "pro",
        "description": "Unlock Pro models and Pro-only studio tools.",
        "credits": 65340,
        "amount": 871200,
        "currency": "INR",
        "badge": "",
        "features": [
            "65,340 AI credits",
            "GPT Image 2, Flux 2 Pro",
            "Nano Banana 2 + Seedream 4.5 (Inspire/Extract)",
            "Qwen Studio, 3D Mockup",
        ],
    },
    {
        "id": "scale",
        "label": "Scale",
        "track": "pro",
        "description": "For agencies and high-volume Pro teams.",
        "credits": 197340,
        "amount": 2631200,
        "currency": "INR",
        "badge": "",
        "features": [
            "197,340 AI credits",
            "All Pro models + tools unlocked",
            "Priority support",
        ],
    },
]

# Custom top-up: 7.5 credits per INR 1 (matches all subscription plans).
# Internal accounting convention: INR 100 = USD 1, 1 credit = $0.001 of vendor
# budget.  At 7.5 cr/INR we collect INR 0.133 per credit and spend INR 0.10,
# giving ~25% gross margin (~22% after Razorpay's ~3% fee).
CUSTOM_CREDITS_PER_RUPEE = 7.5
CUSTOM_MIN_AMOUNT_INR = 100       # Minimum INR 100  -> 750 credits
CUSTOM_MAX_AMOUNT_INR = 100000    # Maximum INR 1,00,000 -> 7,50,000 credits
INR_PER_USD = 100                 # INR 100 = $1 for internal accounting


def _billing_plan_map():
    return {plan["id"]: plan for plan in BILLING_PLANS}


def _public_plan(plan):
    amount = int(plan["amount"])
    credits = int(plan["credits"])
    return {
        **plan,
        "price": amount / 100,
        "priceLabel": f"₹{amount // 100:,}" if amount else "₹0",
        "pricePerCredit": round((amount / 100) / credits, 4) if amount and credits else 0,
        "checkoutEnabled": amount > 0 and not plan.get("disabled", False),
    }


def _razorpay_credentials():
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if not key_id or not key_secret:
        return None, None
    return key_id, key_secret


@bp.route("/api/create-order", methods=["POST"])
@login_required
def create_order():
    data = request.get_json() or {}
    pack_id = str(data.get("packId") or "").strip()[:40]
    plan = _billing_plan_map().get(pack_id)
    if not plan:
        return jsonify({"success": False, "error": "Unknown credit pack"}), 400

    amount = int(plan["amount"])
    credits = int(plan["credits"])

    if amount < 100:
        return jsonify({"success": False, "error": "This plan does not require checkout"}), 400

    currency = str(plan.get("currency") or "INR").upper()
    receipt = str(data.get("receipt") or f"receipt_{int(time.time())}")[:40]
    user_id = g.current_user["id"]

    key_id, key_secret = _razorpay_credentials()
    if not key_id or not key_secret:
        return jsonify({"success": False, "error": "Razorpay is not configured"}), 500

    try:
        response = requests.post(
            RAZORPAY_ORDERS_URL,
            json={"amount": amount, "currency": currency, "receipt": receipt, "notes": {"pack_id": pack_id, "credits": credits}},
            auth=(key_id, key_secret),
            timeout=20,
        )
    except requests.RequestException:
        return jsonify({"success": False, "error": "Unable to connect to Razorpay"}), 500

    if response.status_code == 401:
        return jsonify({"success": False, "error": "Razorpay authentication failed"}), 401

    if response.status_code >= 400:
        return jsonify({"success": False, "error": "Razorpay order creation failed"}), 500

    order = response.json()
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db_lock:
        conn = db()
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO payments
                (user_id, provider_order_id, amount, currency, credits, pack_id, receipt, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?)
                """,
                (user_id, order["id"], order["amount"], order["currency"], credits, pack_id, receipt, created_at)
            )
            conn.commit()
        finally:
            conn.close()

    return jsonify({
        "success": True,
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": order["currency"],
        "key_id": key_id,
        "pack": _public_plan(plan),
    })


@bp.route("/api/create-custom-order", methods=["POST"])
@login_required
def create_custom_order():
    """Create a Razorpay order for a custom rupee amount.

    Credits = amount_inr * CUSTOM_CREDITS_PER_RUPEE (4 credits per INR 1).
    Internal accounting: INR 100 = $1.
    """
    data = request.get_json() or {}

    try:
        amount_inr = int(data.get("amountInr", 0))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Invalid amount"}), 400

    if amount_inr < CUSTOM_MIN_AMOUNT_INR:
        return jsonify({
            "success": False,
            "error": f"Minimum amount is ₹{CUSTOM_MIN_AMOUNT_INR:,}",
        }), 400

    if amount_inr > CUSTOM_MAX_AMOUNT_INR:
        return jsonify({
            "success": False,
            "error": f"Maximum amount is ₹{CUSTOM_MAX_AMOUNT_INR:,}",
        }), 400

    # Razorpay expects amount in paise (1 INR = 100 paise)
    amount_paise = amount_inr * 100
    credits = int(round(amount_inr * CUSTOM_CREDITS_PER_RUPEE))
    currency = "INR"
    pack_id = "custom"
    receipt = str(data.get("receipt") or f"custom_{int(time.time())}")[:40]
    user_id = g.current_user["id"]

    key_id, key_secret = _razorpay_credentials()
    if not key_id or not key_secret:
        return jsonify({"success": False, "error": "Razorpay is not configured"}), 500

    try:
        response = requests.post(
            RAZORPAY_ORDERS_URL,
            json={
                "amount": amount_paise,
                "currency": currency,
                "receipt": receipt,
                "notes": {
                    "pack_id": pack_id,
                    "credits": credits,
                    "custom_amount_inr": amount_inr,
                },
            },
            auth=(key_id, key_secret),
            timeout=20,
        )
    except requests.RequestException:
        return jsonify({"success": False, "error": "Unable to connect to Razorpay"}), 500

    if response.status_code == 401:
        return jsonify({"success": False, "error": "Razorpay authentication failed"}), 401

    if response.status_code >= 400:
        return jsonify({"success": False, "error": "Razorpay order creation failed"}), 500

    order = response.json()
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db_lock:
        conn = db()
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO payments
                (user_id, provider_order_id, amount, currency, credits, pack_id, receipt, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?)
                """,
                (user_id, order["id"], order["amount"], order["currency"],
                 credits, pack_id, receipt, created_at),
            )
            conn.commit()
        finally:
            conn.close()

    return jsonify({
        "success": True,
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": order["currency"],
        "key_id": key_id,
        "credits": credits,
        "pack": {
            "id": "custom",
            "label": "Custom Top-up",
            "credits": credits,
            "amount": amount_paise,
            "priceLabel": f"₹{amount_inr:,}",
        },
    })


@bp.route("/api/billing/overview", methods=["GET"])
@login_required
def billing_overview():
    user_id = g.current_user["id"]
    expire_credits_if_needed(user_id)
    with db_lock:
        conn = db()
        try:
            user = conn.execute(
                "SELECT id, plan, credits_used, credits_limit, reset_at, pro_until"
                " FROM users WHERE id = ?",
                (user_id,)
            ).fetchone()
            payment_rows = conn.execute(
                """
                SELECT id, provider_order_id, provider_payment_id, amount, currency, credits, pack_id, status, created_at, paid_at
                FROM payments
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT 8
                """,
                (user_id,)
            ).fetchall()
        finally:
            conn.close()

    credits_used = int(user["credits_used"] if user else 0)
    credits_limit = int(user["credits_limit"] if user else 0)
    reset_at_raw = user["reset_at"] if user else None
    reset_at = _parse_reset_at(reset_at_raw)
    today = datetime.now(timezone.utc).replace(tzinfo=None).date()
    if reset_at is None:
        reset_days = None
        credits_expired = False
    else:
        delta_days = (reset_at.date() - today).days
        credits_expired = delta_days < 0
        reset_days = max(0, delta_days)
    pro_until_raw = user["pro_until"] if user else None
    pro_expires = parse_pro_until(pro_until_raw)
    pro_days_left = max(0, (pro_expires.date() - today).days) if pro_expires else None
    pro_active = bool(user) and is_pro(user)
    payments = []
    plan_lookup = _billing_plan_map()
    for row in payment_rows:
        plan = plan_lookup.get(row["pack_id"] or "")
        payments.append({
            "id": row["id"],
            "orderId": row["provider_order_id"],
            "paymentId": row["provider_payment_id"],
            "amount": row["amount"],
            "currency": row["currency"],
            "credits": row["credits"],
            "packId": row["pack_id"],
            "packLabel": plan["label"] if plan else ("Custom Top-up" if row["pack_id"] == "custom" else (row["pack_id"] or "Credits")),
            "status": row["status"],
            "createdAt": row["created_at"],
            "paidAt": row["paid_at"],
        })

    return jsonify({
        "success": True,
        "razorpayConfigured": bool(_razorpay_credentials()[0] and _razorpay_credentials()[1]),
        "plans": [_public_plan(plan) for plan in BILLING_PLANS],
        "usage": {
            "plan": user["plan"] if user else "Free Trial",
            "isPro": pro_active,
            "tier": "pro" if pro_active else "normal",
            "proUntil": pro_until_raw,
            "proDaysLeft": pro_days_left,
            "proExpired": bool(pro_expires is not None and not pro_active),
            "creditsUsed": credits_used,
            "creditsLimit": credits_limit,
            "creditsRemaining": max(0, credits_limit - credits_used),
            "usagePct": min(100, round((credits_used / credits_limit) * 100, 1)) if credits_limit else 0,
            "resetAt": reset_at_raw,
            "resetDays": max(0, reset_days) if reset_days is not None else None,
            "creditsExpired": bool(credits_expired),
        },
        "payments": payments,
    })


@bp.route("/api/billing/razorpay-config", methods=["GET"])
@login_required
def razorpay_config():
    key_id, key_secret = _razorpay_credentials()
    return jsonify({
        "success": True,
        "configured": bool(key_id and key_secret),
        "keyId": key_id if key_id else "",
    })


def _grant_payment_credits(conn, payment, paid_at, provider_payment_id=None):
    """Idempotently mark a payment paid and grant what it bought.

    Returns True only for the call that actually granted.

    The status flip is the lock. verify-payment (driven by the customer's browser) and the
    Razorpay webhook race for the same order, and db_lock only serialises one process, so a
    read-then-write check let both callers add the credits. Flipping the row with
    `status <> 'paid'` inside the WHERE means exactly one caller sees rowcount 1; every other
    caller no-ops. On PostgreSQL the loser blocks on the row lock and then re-evaluates
    against the committed row, so it cannot double-grant either.
    """
    if payment["status"] == "paid":
        return False

    claimed = conn.execute(
        """
        UPDATE payments
        SET provider_payment_id = COALESCE(?, provider_payment_id), status = 'paid', paid_at = ?
        WHERE id = ? AND status <> 'paid'
        """,
        (provider_payment_id, paid_at, payment["id"]),
    )
    if claimed.rowcount != 1:
        return False

    if payment["user_id"] and payment["credits"] > 0:
        plan = _billing_plan_map().get(payment["pack_id"] or "")
        plan_label = plan["label"] if plan else (
            "Custom Top-up" if payment["pack_id"] == "custom" else "Paid Credits"
        )
        paid_dt = None
        try:
            if paid_at:
                paid_dt = datetime.fromisoformat(str(paid_at).replace("Z", ""))
        except Exception:
            paid_dt = None

        user = conn.execute(
            "SELECT plan, pro_until FROM users WHERE id = ?",
            (payment["user_id"],),
        ).fetchone()
        grants_pro = bool(plan and plan.get("track") == "pro")

        if grants_pro:
            # A Pro pack opens a dated Pro window, or extends one that is still running.
            new_pro_until = pro_until_from(
                user["pro_until"] if user else None,
                now=paid_dt,
            )
            conn.execute(
                "UPDATE users SET credits_limit = credits_limit + ?, plan = ?, pro_until = ?"
                " WHERE id = ?",
                (payment["credits"], plan_label, new_pro_until, payment["user_id"]),
            )
        elif is_pro(user):
            # A basic top-up must not cancel Pro the customer has already paid for, so it
            # only adds credits and leaves the plan label and the Pro window untouched.
            conn.execute(
                "UPDATE users SET credits_limit = credits_limit + ? WHERE id = ?",
                (payment["credits"], payment["user_id"]),
            )
        else:
            conn.execute(
                "UPDATE users SET credits_limit = credits_limit + ?, plan = ? WHERE id = ?",
                (payment["credits"], plan_label, payment["user_id"]),
            )

        extend_credit_expiry(payment["user_id"], conn=conn, from_dt=paid_dt)
        conn.execute(
            """
            INSERT INTO credit_transactions
            (user_id, payment_id, transaction_type, credits, note, created_at)
            VALUES (?, ?, 'recharge', ?, ?, ?)
            """,
            (
                payment["user_id"],
                payment["id"],
                payment["credits"],
                f"Razorpay recharge {payment['provider_order_id']}",
                paid_at,
            ),
        )
    return True


@bp.route("/api/billing/razorpay-webhook", methods=["POST"])
def razorpay_webhook():
    webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "").strip()
    if not webhook_secret:
        return jsonify({"success": False, "error": "Webhook not configured"}), 500

    body = request.get_data()
    signature = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(webhook_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        return jsonify({"success": False, "error": "Invalid webhook signature"}), 400

    try:
        event = request.get_json(force=True) or {}
    except Exception:
        return jsonify({"success": False, "error": "Invalid JSON payload"}), 400

    event_type = event.get("event", "")
    if event_type not in ("payment.captured", "order.paid"):
        return jsonify({"success": True, "ignored": True})

    entity = (event.get("payload") or {}).get("payment") or {}
    if isinstance(entity, dict) and "entity" in entity:
        entity = entity["entity"]
    order_id = entity.get("order_id")
    payment_id = entity.get("id")
    if not order_id:
        return jsonify({"success": False, "error": "Missing order_id in webhook payload"}), 400

    paid_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db_lock:
        conn = db()
        try:
            payment = conn.execute(
                "SELECT * FROM payments WHERE provider_order_id = ?",
                (order_id,),
            ).fetchone()
            if not payment:
                return jsonify({"success": False, "error": "Payment order was not found"}), 404

            _grant_payment_credits(conn, payment, paid_at, provider_payment_id=payment_id)
            conn.commit()
        finally:
            conn.close()

    return jsonify({"success": True})


@bp.route("/api/verify-payment", methods=["POST"])
@login_required
def verify_payment():
    data = request.get_json() or {}
    order_id = data.get("razorpay_order_id")
    payment_id = data.get("razorpay_payment_id")
    razorpay_signature = data.get("razorpay_signature")

    if not order_id or not payment_id or not razorpay_signature:
        return jsonify({"success": False, "error": "Missing payment verification fields"}), 400

    _, key_secret = _razorpay_credentials()
    if not key_secret:
        return jsonify({"success": False, "error": "Razorpay is not configured"}), 500

    message = f"{order_id}|{payment_id}".encode("utf-8")
    generated_signature = hmac.new(
        key_secret.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(generated_signature, razorpay_signature):
        return jsonify({"success": False, "error": "Payment signature mismatch"}), 400

    paid_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db_lock:
        conn = db()
        try:
            payment = conn.execute(
                "SELECT * FROM payments WHERE provider_order_id = ?",
                (order_id,)
            ).fetchone()
            if not payment:
                return jsonify({"success": False, "error": "Payment order was not found"}), 404

            if int(payment["user_id"] or 0) != int(g.current_user["id"]):
                return jsonify({"success": False, "error": "Payment does not belong to this user"}), 403

            if payment["status"] != "paid":
                _grant_payment_credits(conn, payment, paid_at, provider_payment_id=payment_id)
                conn.commit()

            updated_user = None
            if payment["user_id"]:
                updated_user = conn.execute(
                    "SELECT plan, credits_used, credits_limit, pro_until FROM users WHERE id = ?",
                    (payment["user_id"],)
                ).fetchone()
        finally:
            conn.close()

    credits_payload = {}
    if updated_user:
        credits_payload = attach_tier_fields({
            "creditsUsed": updated_user["credits_used"],
            "creditsLimit": updated_user["credits_limit"],
            "plan": updated_user["plan"],
        }, updated_user)

    return jsonify({
        "success": True,
        "order_id": order_id,
        "payment_id": payment_id,
        **credits_payload,
    })
