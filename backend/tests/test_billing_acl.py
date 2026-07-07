import pytest


def test_verify_payment_rejects_other_users_order(client, app):
    """Payment verification must bind to the authenticated user."""
    with app.app_context():
        from db import db
        from datetime import datetime, timezone
        import bcrypt

        conn = db()
        now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
        conn.execute(
            """
            INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
            VALUES (1, 'owner@test.example', ?, 'Owner', 'OW', 'user', 'Free', 0, 100, ?, 'active', ?)
            """,
            (pw, now, now),
        )
        conn.execute(
            """
            INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
            VALUES (2, 'other@test.example', ?, 'Other', 'OT', 'user', 'Free', 0, 100, ?, 'active', ?)
            """,
            (pw, now, now),
        )
        conn.execute(
            """
            INSERT INTO payments (user_id, provider, provider_order_id, amount, currency, credits, pack_id, status, created_at)
            VALUES (1, 'razorpay', 'order_test_123', 52800, 'INR', 3960, 'starter', 'created', ?)
            """,
            (now,),
        )
        conn.commit()
        conn.close()

    login = client.post("/api/login", json={"email": "other@test.example", "password": "Test@12345"})
    token = login.get_json()["token"]

    resp = client.post(
        "/api/verify-payment",
        json={
            "razorpay_order_id": "order_test_123",
            "razorpay_payment_id": "pay_test",
            "razorpay_signature": "invalid",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code in (400, 403)


def test_workflows_scoped_to_user(client, app):
    with app.app_context():
        from db import db
        from datetime import datetime, timezone
        import bcrypt

        conn = db()
        now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
        for uid, email in ((1, "a@test.example"), (2, "b@test.example")):
            conn.execute(
                """
                INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
                VALUES (?, ?, ?, ?, 'U', 'user', 'Free', 0, 100, ?, 'active', ?)
                """,
                (uid, email, pw, f"User {uid}", now, now),
            )
        conn.execute(
            "INSERT INTO saved_workflows (user_id, name, steps_json, settings_json, created_at) VALUES (1, 'Mine', '[]', '{}', ?)",
            (now,),
        )
        conn.execute(
            "INSERT INTO saved_workflows (user_id, name, steps_json, settings_json, created_at) VALUES (2, 'Theirs', '[]', '{}', ?)",
            (now,),
        )
        conn.commit()
        conn.close()

    login_b = client.post("/api/login", json={"email": "b@test.example", "password": "Test@12345"})
    token_b = login_b.get_json()["token"]
    resp = client.get("/api/workflows", headers={"Authorization": f"Bearer {token_b}"})
    data = resp.get_json()
    assert resp.status_code == 200
    assert len(data["workflows"]) == 1
    assert data["workflows"][0]["name"] == "Theirs"
