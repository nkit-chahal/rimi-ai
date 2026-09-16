"""Recovering orders that were paid but never credited.

verify-payment only runs if the customer's browser makes it back from Razorpay, and the
webhook only helps once RAZORPAY_WEBHOOK_SECRET is configured. Anyone who closes the tab after
paying was charged and received nothing, with the order left at 'created' forever.
"""
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import bcrypt
import pytest

KEY_SECRET = "test-key-secret"
WEBHOOK_SECRET = "test-webhook-secret"
ORDER = "order_stuck_1"
PACK_AMOUNT = 52800
PACK_CREDITS = 3960


def _utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture()
def razorpay_env(monkeypatch):
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", KEY_SECRET)
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET)


class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


def _fake_order_payments(monkeypatch, items, status_code=200):
    """Stand in for GET /v1/orders/<id>/payments."""
    import routes.billing as billing

    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return _FakeResponse({"items": items}, status_code)

    monkeypatch.setattr(billing.requests, "get", fake_get)
    return calls


def _seed(app, *, age_minutes=30, role="user", user_id=1, email="buyer@test.example",
          with_payment=True):
    from db import db

    now = _utc_now()
    created = (now - timedelta(minutes=age_minutes)).isoformat()
    pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    with app.app_context():
        conn = db()
        try:
            conn.execute(
                """
                INSERT INTO users (id, email, password, name, initials, role, plan, credits_used,
                                   credits_limit, reset_at, status, created_at)
                VALUES (?, ?, ?, 'Buyer', 'BY', ?, 'Free Trial', 0, 200, ?, 'active', ?)
                """,
                (user_id, email, pw, role, now.isoformat(), now.isoformat()),
            )
            if with_payment:
                conn.execute(
                    """
                    INSERT INTO payments (user_id, provider, provider_order_id, amount, currency,
                                          credits, pack_id, receipt, status, created_at)
                    VALUES (?, 'razorpay', ?, ?, 'INR', ?, 'starter', 'rcpt', 'created', ?)
                    """,
                    (user_id, ORDER, PACK_AMOUNT, PACK_CREDITS, created),
                )
            conn.commit()
        finally:
            conn.close()


def _payment_row(app, order_id=ORDER):
    from db import db

    with app.app_context():
        conn = db()
        try:
            return dict(conn.execute(
                "SELECT status, credits, provider_payment_id FROM payments WHERE provider_order_id = ?",
                (order_id,),
            ).fetchone())
        finally:
            conn.close()


def _credits(app, user_id=1):
    from db import db

    with app.app_context():
        conn = db()
        try:
            return conn.execute(
                "SELECT credits_limit FROM users WHERE id = ?", (user_id,)
            ).fetchone()["credits_limit"]
        finally:
            conn.close()


CAPTURED = [{"id": "pay_recovered_1", "status": "captured", "amount": PACK_AMOUNT}]


def test_captured_order_is_recovered(app, razorpay_env, monkeypatch):
    _seed(app)
    _fake_order_payments(monkeypatch, CAPTURED)

    from routes.billing import reconcile_pending_payments

    with app.app_context():
        result = reconcile_pending_payments()

    assert result["success"] is True
    assert result["granted"] == [ORDER]
    assert _credits(app) == 200 + PACK_CREDITS
    row = _payment_row(app)
    assert row["status"] == "paid"
    assert row["provider_payment_id"] == "pay_recovered_1"


def test_reconciling_twice_grants_once(app, razorpay_env, monkeypatch):
    _seed(app)
    _fake_order_payments(monkeypatch, CAPTURED)

    from routes.billing import reconcile_pending_payments

    with app.app_context():
        reconcile_pending_payments()
        second = reconcile_pending_payments()

    assert second["granted"] == []
    assert _credits(app) == 200 + PACK_CREDITS


def test_checkout_still_in_flight_is_left_alone(app, razorpay_env, monkeypatch):
    """An order created a minute ago may simply not be finished yet."""
    _seed(app, age_minutes=1)
    _fake_order_payments(monkeypatch, CAPTURED)

    from routes.billing import reconcile_pending_payments

    with app.app_context():
        result = reconcile_pending_payments(max_age_minutes=10)

    assert result["checked"] == 0
    assert result["granted"] == []
    assert _credits(app) == 200


def test_unpaid_order_is_not_granted(app, razorpay_env, monkeypatch):
    _seed(app)
    _fake_order_payments(monkeypatch, [{"id": "pay_x", "status": "failed", "amount": PACK_AMOUNT}])

    from routes.billing import reconcile_pending_payments

    with app.app_context():
        result = reconcile_pending_payments()

    assert result["granted"] == []
    assert _credits(app) == 200
    assert _payment_row(app)["status"] == "created"


def test_amount_mismatch_is_refused_and_reported(app, razorpay_env, monkeypatch):
    """Paying 1 rupee must never unlock a pack priced at 528."""
    _seed(app)
    _fake_order_payments(monkeypatch, [{"id": "pay_y", "status": "captured", "amount": 100}])

    from routes.billing import reconcile_pending_payments

    with app.app_context():
        result = reconcile_pending_payments()

    assert result["granted"] == []
    assert any("amount" in err for err in result["errors"])
    assert _credits(app) == 200


def test_razorpay_error_is_reported_not_swallowed(app, razorpay_env, monkeypatch):
    _seed(app)
    _fake_order_payments(monkeypatch, [], status_code=500)

    from routes.billing import reconcile_pending_payments

    with app.app_context():
        result = reconcile_pending_payments()

    assert result["granted"] == []
    assert any("500" in err for err in result["errors"])


def test_webhook_rejects_a_mismatched_captured_amount(app, client, razorpay_env):
    _seed(app)
    body = json.dumps({
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": "pay_z", "order_id": ORDER, "amount": 100}}},
    }).encode("utf-8")
    signature = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()

    resp = client.post(
        "/api/billing/razorpay-webhook",
        data=body,
        headers={"X-Razorpay-Signature": signature, "Content-Type": "application/json"},
    )
    assert resp.status_code == 400
    assert _credits(app) == 200
    assert _payment_row(app)["status"] == "created"


def test_reconcile_endpoint_requires_an_admin(app, client, razorpay_env):
    _seed(app)
    login = client.post(
        "/api/login", json={"email": "buyer@test.example", "password": "Test@12345"}
    )
    token = login.get_json()["token"]

    resp = client.post(
        "/api/admin/reconcile-payments",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_reconcile_endpoint_runs_for_an_admin(app, client, razorpay_env, monkeypatch):
    _seed(app)
    # The order belongs to the buyer seeded above; the admin only needs an account.
    _seed(app, user_id=9, email="admin@test.example", role="admin", with_payment=False)
    _fake_order_payments(monkeypatch, CAPTURED)

    login = client.post(
        "/api/login", json={"email": "admin@test.example", "password": "Test@12345"}
    )
    token = login.get_json()["token"]

    resp = client.post(
        "/api/admin/reconcile-payments",
        json={"olderThanMinutes": 10, "limit": 10},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["granted"] == [ORDER]


def test_config_endpoint_reports_whether_the_webhook_can_work(app, client, monkeypatch):
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", KEY_SECRET)
    monkeypatch.delenv("RAZORPAY_WEBHOOK_SECRET", raising=False)
    _seed(app)

    login = client.post(
        "/api/login", json={"email": "buyer@test.example", "password": "Test@12345"}
    )
    token = login.get_json()["token"]
    body = client.get(
        "/api/billing/razorpay-config", headers={"Authorization": f"Bearer {token}"}
    ).get_json()

    assert body["configured"] is True
    assert body["webhookConfigured"] is False
