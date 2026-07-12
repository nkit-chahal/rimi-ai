from datetime import datetime, timedelta, timezone

import bcrypt
import pytest

from db import db


@pytest.fixture()
def analytics_admin(client, app):
    with app.app_context():
        conn = db()
        try:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            past = now - timedelta(days=2)
            password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
            conn.execute(
                """
                INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
                VALUES (1, 'admin-analytics@test.example', ?, 'Admin', 'AD', 'admin', 'Enterprise', 0, 50000, ?, 'active', ?)
                """,
                (password_hash, (now + timedelta(days=60)).isoformat(), now.isoformat()),
            )
            conn.execute(
                """
                INSERT INTO exports (user_id, project_id, filename, tool_type, created_at)
                VALUES (1, 1, 'exp_analytics_1.png', 'Mappings', ?)
                """,
                (past.isoformat(),),
            )
            conn.execute(
                """
                INSERT INTO replicate_logs (project_id, model_name, duration, credits, cost_usd, created_at)
                VALUES (1, 'black-forest-labs/flux-schnell', 1.2, 4, 0.003, ?)
                """,
                (past.isoformat(),),
            )
            conn.execute(
                """
                INSERT INTO login_events (user_id, provider, ip_address, created_at)
                VALUES (1, 'email', '127.0.0.1', ?)
                """,
                (past.isoformat(),),
            )
            conn.execute(
                """
                INSERT INTO payments (user_id, provider, provider_order_id, amount, currency, credits, pack_id, status, created_at, paid_at)
                VALUES (1, 'razorpay', 'order_analytics_test', 52800, 'INR', 3960, 'starter', 'paid', ?, ?)
                """,
                (past.isoformat(), past.isoformat()),
            )
            conn.commit()
        finally:
            conn.close()

    login = client.post("/api/login", json={"email": "admin-analytics@test.example", "password": "Test@12345"})
    assert login.status_code == 200
    token = login.get_json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_admin_analytics_returns_series(client, analytics_admin):
    res = client.get("/api/admin/analytics?days=30", headers=analytics_admin)
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert len(data["labels"]) == 30
    assert len(data["featureUsageByDay"]) == 30
    assert len(data["apiSpendByDay"]) == 30
    assert len(data["loginsByDay"]) == 30
    assert data["summary"]["featureExports"] >= 1
    assert data["summary"]["apiCalls"] >= 1
    assert data["summary"]["logins"] >= 1
    assert data["summary"]["paidOrders"] >= 1
    assert any(item["tool"] == "Mappings" for item in data["featureUsageByTool"])
