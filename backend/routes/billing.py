"""Razorpay Standard Checkout routes."""
import hashlib
import hmac
import os
import time
from datetime import datetime, timezone

import requests
from flask import Blueprint, jsonify, request

from db import db, db_lock
from middleware import login_required

bp = Blueprint("billing", __name__)

RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders"


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

    try:
        amount = int(data.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "amount must be an integer in paise"}), 400

    if amount < 100:
        return jsonify({"success": False, "error": "amount must be at least 100 paise"}), 400

    currency = str(data.get("currency") or "INR").upper()
    receipt = str(data.get("receipt") or f"receipt_{int(time.time())}")[:40]
    pack_id = str(data.get("packId") or "").strip()[:40] or None
    try:
        user_id = int(data.get("userId")) if data.get("userId") else None
    except (TypeError, ValueError):
        user_id = None
    try:
        credits = int(data.get("credits", 0))
    except (TypeError, ValueError):
        credits = 0

    key_id, key_secret = _razorpay_credentials()
    if not key_id or not key_secret:
        return jsonify({"success": False, "error": "Razorpay is not configured"}), 500

    try:
        response = requests.post(
            RAZORPAY_ORDERS_URL,
            json={"amount": amount, "currency": currency, "receipt": receipt},
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
    })


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

            if payment["status"] != "paid":
                conn.execute(
                    """
                    UPDATE payments
                    SET provider_payment_id = ?, status = 'paid', paid_at = ?
                    WHERE id = ?
                    """,
                    (payment_id, paid_at, payment["id"])
                )
                if payment["user_id"] and payment["credits"] > 0:
                    conn.execute(
                        "UPDATE users SET credits_limit = credits_limit + ? WHERE id = ?",
                        (payment["credits"], payment["user_id"])
                    )
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
                        )
                    )
                conn.commit()

            updated_user = None
            if payment["user_id"]:
                updated_user = conn.execute(
                    "SELECT credits_used, credits_limit FROM users WHERE id = ?",
                    (payment["user_id"],)
                ).fetchone()
        finally:
            conn.close()

    credits_payload = {}
    if updated_user:
        credits_payload = {
            "creditsUsed": updated_user["credits_used"],
            "creditsLimit": updated_user["credits_limit"],
        }

    return jsonify({
        "success": True,
        "order_id": order_id,
        "payment_id": payment_id,
        **credits_payload,
    })
