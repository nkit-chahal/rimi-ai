"""Payment grants must happen exactly once, and Pro access must expire.

Two regressions are covered here:

1. verify-payment (driven by the customer's browser) and the Razorpay webhook both grant
   credits for the same order. They raced: each read `status` and then wrote, so a customer
   whose webhook landed alongside the redirect got the pack twice.
2. Pro was inferred from the plan label, which nothing ever cleared, so Pro tools stayed
   unlocked forever after one purchase — and a later basic top-up silently downgraded a
   paying Pro customer by overwriting that same label.
"""
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import bcrypt
import pytest

KEY_SECRET = "test-key-secret"
WEBHOOK_SECRET = "test-webhook-secret"


def _utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture()
def razorpay_env(monkeypatch):
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", KEY_SECRET)
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET)


def _seed_user(conn, user_id=1, email="buyer@test.example", plan="Free Trial",
               credits_limit=200, role="user", pro_until=None):
    now = _utc_now().isoformat()
    pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used,
                           credits_limit, reset_at, status, created_at, pro_until)
        VALUES (?, ?, ?, 'Buyer', 'BY', ?, ?, 0, ?, ?, 'active', ?, ?)
        """,
        (user_id, email, pw, role, plan, credits_limit, now, now, pro_until),
    )
    # Routes check project ownership before the Pro gate, so a project has to exist for a
    # tool request to reach the gate at all.
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (?, 'Test Project', 'Draft', '', '', ?, ?)
        """,
        (user_id, now, user_id),
    )
    conn.execute(
        """
        INSERT INTO project_metrics (project_id, versions, versions_delta, exports, exports_delta,
                                     ai_generations, ai_generations_delta, credits_used, credits_delta)
        VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0)
        """,
        (user_id,),
    )


def _seed_payment(conn, order_id, user_id=1, pack_id="starter", credits=3960, amount=52800):
    conn.execute(
        """
        INSERT INTO payments (user_id, provider, provider_order_id, amount, currency, credits,
                              pack_id, receipt, status, created_at)
        VALUES (?, 'razorpay', ?, ?, 'INR', ?, ?, 'rcpt_1', 'created', ?)
        """,
        (user_id, order_id, amount, credits, pack_id, _utc_now().isoformat()),
    )


def _login(client, email="buyer@test.example"):
    resp = client.post("/api/login", json={"email": email, "password": "Test@12345"})
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return resp.get_json()["token"]


def _verify_payment(client, token, order_id, payment_id="pay_test_1"):
    signature = hmac.new(
        KEY_SECRET.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return client.post(
        "/api/verify-payment",
        json={
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": signature,
        },
        headers={"Authorization": f"Bearer {token}"},
    )


def _post_webhook(client, order_id, payment_id="pay_test_1", event="payment.captured"):
    body = json.dumps({
        "event": event,
        "payload": {"payment": {"entity": {"id": payment_id, "order_id": order_id}}},
    }).encode("utf-8")
    signature = hmac.new(WEBHOOK_SECRET.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return client.post(
        "/api/billing/razorpay-webhook",
        data=body,
        headers={"X-Razorpay-Signature": signature, "Content-Type": "application/json"},
    )


def _user_row(app, user_id=1):
    with app.app_context():
        from db import db
        conn = db()
        try:
            row = conn.execute(
                "SELECT plan, credits_limit, pro_until FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            return dict(row)
        finally:
            conn.close()


def _recharge_count(app, user_id=1):
    with app.app_context():
        from db import db
        conn = db()
        try:
            rows = conn.execute(
                "SELECT id FROM credit_transactions WHERE user_id = ? AND transaction_type = 'recharge'",
                (user_id,),
            ).fetchall()
            return len(rows)
        finally:
            conn.close()


def _setup(app, **user_kwargs):
    payment_kwargs = {k: user_kwargs.pop(k) for k in ("pack_id", "credits") if k in user_kwargs}
    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(conn, **user_kwargs)
            _seed_payment(conn, "order_test_1", **payment_kwargs)
            conn.commit()
        finally:
            conn.close()


# --------------------------------------------------------------------------- #
# 1. One payment grants one pack
# --------------------------------------------------------------------------- #

def test_verify_then_webhook_grants_credits_once(client, app, razorpay_env):
    _setup(app)
    token = _login(client)

    assert _verify_payment(client, token, "order_test_1").status_code == 200
    assert _user_row(app)["credits_limit"] == 200 + 3960

    # The webhook for the same order arrives moments later and must be a no-op.
    assert _post_webhook(client, "order_test_1").status_code == 200
    assert _user_row(app)["credits_limit"] == 200 + 3960
    assert _recharge_count(app) == 1


def test_webhook_then_verify_grants_credits_once(client, app, razorpay_env):
    _setup(app)
    token = _login(client)

    assert _post_webhook(client, "order_test_1").status_code == 200
    assert _user_row(app)["credits_limit"] == 200 + 3960

    # The browser redirect lands afterwards; the customer still paid for one pack.
    assert _verify_payment(client, token, "order_test_1").status_code == 200
    assert _user_row(app)["credits_limit"] == 200 + 3960
    assert _recharge_count(app) == 1


def test_repeated_webhook_deliveries_grant_once(client, app, razorpay_env):
    """Razorpay retries deliveries; retries must not compound the grant."""
    _setup(app)
    for _ in range(3):
        assert _post_webhook(client, "order_test_1").status_code == 200
    assert _user_row(app)["credits_limit"] == 200 + 3960
    assert _recharge_count(app) == 1


# --------------------------------------------------------------------------- #
# 2. Pro is a dated window
# --------------------------------------------------------------------------- #

def test_pro_pack_opens_a_dated_pro_window(client, app, razorpay_env):
    from plan_tiers import PRO_DURATION_DAYS, is_pro, parse_pro_until

    _setup(app, pack_id="pro", credits=65340)
    token = _login(client)

    resp = _verify_payment(client, token, "order_test_1")
    assert resp.status_code == 200
    assert resp.get_json()["isPro"] is True

    row = _user_row(app)
    assert row["plan"] == "Pro"
    assert is_pro(row) is True
    expires = parse_pro_until(row["pro_until"])
    assert expires is not None
    expected = _utc_now() + timedelta(days=PRO_DURATION_DAYS)
    assert abs((expires - expected).total_seconds()) < 120


def test_second_pro_pack_stacks_onto_the_remaining_window(client, app, razorpay_env):
    from plan_tiers import PRO_DURATION_DAYS, parse_pro_until

    existing = (_utc_now() + timedelta(days=10)).isoformat()
    _setup(app, plan="Pro", pro_until=existing, pack_id="pro", credits=65340)
    token = _login(client)

    assert _verify_payment(client, token, "order_test_1").status_code == 200

    expires = parse_pro_until(_user_row(app)["pro_until"])
    expected = _utc_now() + timedelta(days=10 + PRO_DURATION_DAYS)
    assert abs((expires - expected).total_seconds()) < 120


def test_basic_top_up_does_not_cancel_paid_pro(client, app, razorpay_env):
    """A Starter top-up used to overwrite the plan label and silently demote a Pro customer."""
    from plan_tiers import is_pro

    pro_until = (_utc_now() + timedelta(days=20)).isoformat()
    _setup(app, plan="Pro", credits_limit=1000, pro_until=pro_until)
    token = _login(client)

    assert _verify_payment(client, token, "order_test_1").status_code == 200

    row = _user_row(app)
    assert row["credits_limit"] == 1000 + 3960
    assert row["plan"] == "Pro"
    assert row["pro_until"] == pro_until
    assert is_pro(row) is True


def test_expired_pro_window_locks_pro_tools(client, app):
    """The plan label still says Pro; access must lapse with the window anyway."""
    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(
                conn,
                plan="Pro",
                credits_limit=50000,
                pro_until=(_utc_now() - timedelta(days=1)).isoformat(),
            )
            conn.commit()
        finally:
            conn.close()

    token = _login(client)
    resp = client.post(
        "/api/image-layers",
        json={"filename": "x.png", "projectId": 1, "numLayers": 3},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    body = resp.get_json()
    assert body["requiresPro"] is True
    assert body["proExpired"] is True
    assert body["tier"] == "normal"


def test_login_reports_lapsed_pro_as_normal(client, app):
    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(conn, plan="Pro", pro_until=(_utc_now() - timedelta(days=1)).isoformat())
            conn.commit()
        finally:
            conn.close()

    resp = client.post("/api/login", json={"email": "buyer@test.example", "password": "Test@12345"})
    user = resp.get_json()["user"]
    assert user["isPro"] is False
    assert user["tier"] == "normal"
    assert user["plan"] == "Pro"  # label is history; entitlement is the window


def test_billing_overview_reports_the_pro_window(client, app, razorpay_env):
    pro_until = (_utc_now() + timedelta(days=12)).isoformat()
    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(conn, plan="Pro", pro_until=pro_until)
            conn.commit()
        finally:
            conn.close()

    token = _login(client)
    usage = client.get(
        "/api/billing/overview", headers={"Authorization": f"Bearer {token}"}
    ).get_json()["usage"]
    assert usage["isPro"] is True
    assert usage["proUntil"] == pro_until
    assert usage["proDaysLeft"] == 12
    assert usage["proExpired"] is False


# --------------------------------------------------------------------------- #
# 3. Upgrading an existing database
# --------------------------------------------------------------------------- #

def test_backfill_gives_legacy_pro_accounts_a_window(app):
    """Accounts created before pro_until existed must not lose or keep Pro by accident."""
    from db import backfill_pro_until, db
    from plan_tiers import PRO_DURATION_DAYS, is_pro, parse_pro_until

    future = (_utc_now() + timedelta(days=45)).isoformat()
    past = (_utc_now() - timedelta(days=3)).isoformat()

    with app.app_context():
        conn = db()
        try:
            _seed_user(conn, user_id=1, email="live-pro@test.example", plan="Pro")
            _seed_user(conn, user_id=2, email="lapsed-pro@test.example", plan="Business Studio")
            _seed_user(conn, user_id=3, email="starter@test.example", plan="Starter")
            # Rewind to the pre-change shape: a Pro plan label and no window at all.
            conn.execute("UPDATE users SET pro_until = NULL")
            conn.execute("UPDATE users SET reset_at = ? WHERE id = 1", (future,))
            conn.execute("UPDATE users SET reset_at = ? WHERE id = 2", (past,))
            conn.commit()

            assert backfill_pro_until(conn) == 2
            conn.commit()
            rows = {
                r["id"]: dict(r)
                for r in conn.execute("SELECT id, plan, pro_until FROM users").fetchall()
            }

            # A paying Pro account keeps access for the rest of its credit window.
            assert rows[1]["pro_until"] == future
            assert is_pro(rows[1]) is True

            # One whose window already passed is not cut off mid-session; it gets a fresh one.
            lapsed = parse_pro_until(rows[2]["pro_until"])
            expected = _utc_now() + timedelta(days=PRO_DURATION_DAYS)
            assert abs((lapsed - expected).total_seconds()) < 300

            # Non-Pro plans gain nothing.
            assert rows[3]["pro_until"] is None
            assert is_pro(rows[3]) is False

            # Idempotent: a later boot must not extend anyone.
            assert backfill_pro_until(conn) == 0

            # And a window that has since lapsed stays lapsed.
            conn.execute("UPDATE users SET pro_until = ? WHERE id = 1", (past,))
            conn.commit()
            assert backfill_pro_until(conn) == 0
            row = dict(conn.execute("SELECT plan, pro_until FROM users WHERE id = 1").fetchone())
            assert row["pro_until"] == past
            assert is_pro(row) is False
        finally:
            conn.close()


# --------------------------------------------------------------------------- #
# 4. Admin plan changes move the window
# --------------------------------------------------------------------------- #

def _admin_token(client, app):
    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(conn, user_id=9, email="admin@test.example", role="admin")
            conn.commit()
        finally:
            conn.close()
    return _login(client, "admin@test.example")


def test_admin_promote_opens_window_and_demote_closes_it(client, app):
    from plan_tiers import is_pro

    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(conn, user_id=1, email="target@test.example")
            conn.commit()
        finally:
            conn.close()
    token = _admin_token(client, app)

    promote = client.put(
        "/api/admin/users/1",
        json={"email": "target@test.example", "name": "Buyer", "plan": "Pro",
              "role": "user", "status": "active", "creditsLimit": 50000, "creditsUsed": 0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert promote.status_code == 200
    assert promote.get_json()["proUntil"]
    assert is_pro(_user_row(app)) is True

    demote = client.put(
        "/api/admin/users/1",
        json={"email": "target@test.example", "name": "Buyer", "plan": "Starter",
              "role": "user", "status": "active", "creditsLimit": 50000, "creditsUsed": 0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert demote.status_code == 200
    row = _user_row(app)
    assert row["pro_until"] is None
    assert is_pro(row) is False


def test_admin_edit_does_not_renew_a_lapsed_pro_account(client, app):
    """Saving an unrelated field must not hand a lapsed account another 30 days of Pro."""
    from plan_tiers import is_pro

    lapsed = (_utc_now() - timedelta(days=5)).isoformat()
    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(conn, user_id=1, email="target@test.example", plan="Pro", pro_until=lapsed)
            conn.commit()
        finally:
            conn.close()
    token = _admin_token(client, app)

    resp = client.put(
        "/api/admin/users/1",
        json={"email": "target@test.example", "name": "Renamed Only", "plan": "Pro",
              "role": "user", "status": "active", "creditsLimit": 200, "creditsUsed": 0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200

    row = _user_row(app)
    assert row["pro_until"] == lapsed
    assert is_pro(row) is False


def test_extend_expiry_does_not_promote_a_basic_account(client, app):
    """A leftover expired window from an earlier Pro period is history, not entitlement."""
    from plan_tiers import is_pro

    stale = (_utc_now() - timedelta(days=5)).isoformat()
    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(conn, user_id=1, email="target@test.example", plan="Starter", pro_until=stale)
            conn.commit()
        finally:
            conn.close()
    token = _admin_token(client, app)

    resp = client.post(
        "/api/admin/extend-expiry",
        json={"userId": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["proUntil"] is None

    row = _user_row(app)
    assert row["plan"] == "Starter"
    assert row["pro_until"] == stale
    assert is_pro(row) is False


def test_pro_gate_reads_entitlement_fresh_not_from_the_cache(app):
    """A just-paid customer must not be refused by a worker holding a stale user row."""
    from flask import g
    from plan_tiers import current_user_record, is_pro

    live = (_utc_now() + timedelta(days=30)).isoformat()
    stale = (_utc_now() - timedelta(days=1)).isoformat()
    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(conn, user_id=1, email="buyer@test.example", plan="Pro", pro_until=live)
            conn.commit()
        finally:
            conn.close()

    with app.test_request_context():
        # What a cached row looks like moments after the purchase committed.
        g.current_user = {"id": 1, "plan": "Free Trial", "pro_until": stale}
        record = current_user_record()
        assert record["pro_until"] == live
        assert is_pro(record) is True

    # And the reverse: access revoked in the database is honoured immediately.
    with app.app_context():
        from db import db
        conn = db()
        try:
            conn.execute("UPDATE users SET pro_until = ? WHERE id = 1", (stale,))
            conn.commit()
        finally:
            conn.close()

    with app.test_request_context():
        g.current_user = {"id": 1, "plan": "Pro", "pro_until": live}
        assert is_pro(current_user_record()) is False


def test_admin_extend_expiry_also_renews_a_lapsed_pro_window(client, app):
    from plan_tiers import is_pro

    with app.app_context():
        from db import db
        conn = db()
        try:
            _seed_user(
                conn,
                user_id=1,
                email="target@test.example",
                plan="Pro",
                pro_until=(_utc_now() - timedelta(days=2)).isoformat(),
            )
            conn.commit()
        finally:
            conn.close()
    token = _admin_token(client, app)

    resp = client.post(
        "/api/admin/extend-expiry",
        json={"userId": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["proUntil"]
    assert is_pro(_user_row(app)) is True
