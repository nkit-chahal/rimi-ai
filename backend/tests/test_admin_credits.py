"""Admin credit extend / limit clamp behavior."""
from datetime import datetime, timedelta, timezone

import bcrypt
import pytest

from db import db


def _seed_admin_and_user(conn, *, credits_limit=100, credits_used=100, reset_at=None):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (1, 'admin-credits@test.example', ?, 'Admin', 'AD', 'admin', 'Enterprise', 0, 50000, ?, 'active', ?)
        """,
        (password_hash, (now + timedelta(days=60)).isoformat(), now.isoformat()),
    )
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (2, 'member-credits@test.example', ?, 'Member', 'MB', 'user', 'Starter', ?, ?, ?, 'active', ?)
        """,
        (
            password_hash,
            credits_used,
            credits_limit,
            (reset_at or now).isoformat(),
            now.isoformat(),
        ),
    )
    conn.commit()


@pytest.fixture()
def admin_headers(client, app):
    with app.app_context():
        conn = db()
        try:
            past = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
            _seed_admin_and_user(conn, credits_limit=100, credits_used=100, reset_at=past)
        finally:
            conn.close()

    login = client.post(
        "/api/login",
        json={"email": "admin-credits@test.example", "password": "Test@12345"},
    )
    assert login.status_code == 200
    token = login.get_json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_extend_expiry_restores_credits_to_full(client, admin_headers, app):
    resp = client.post(
        "/api/admin/extend-expiry",
        json={"userId": 2},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["creditsUsed"] == 0
    assert body["creditsLimit"] == 100
    assert body["resetDays"] > 0

    with app.app_context():
        conn = db()
        try:
            user = conn.execute(
                "SELECT credits_used, credits_limit, reset_at FROM users WHERE id = 2"
            ).fetchone()
            assert int(user["credits_used"]) == 0
            assert int(user["credits_limit"]) == 100
            reset_at = datetime.fromisoformat(user["reset_at"])
            assert reset_at.date() > datetime.now(timezone.utc).replace(tzinfo=None).date()

            tx = conn.execute(
                """
                SELECT note FROM credit_transactions
                WHERE user_id = 2 AND note = 'Admin expiry extend — credits restored'
                """
            ).fetchone()
            assert tx is not None
        finally:
            conn.close()


def test_adjust_credits_clamps_used_when_lowering_limit(client, admin_headers, app):
    resp = client.post(
        "/api/admin/adjust-credits",
        json={"userId": 2, "creditsLimit": 50},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["creditsLimit"] == 50
    assert body["creditsUsed"] == 50

    with app.app_context():
        conn = db()
        try:
            user = conn.execute(
                "SELECT credits_used, credits_limit FROM users WHERE id = 2"
            ).fetchone()
            assert int(user["credits_limit"]) == 50
            assert int(user["credits_used"]) == 50
        finally:
            conn.close()


def test_update_user_clamps_used_when_lowering_limit(client, admin_headers, app):
    resp = client.put(
        "/api/admin/users/2",
        json={
            "email": "member-credits@test.example",
            "name": "Member",
            "role": "user",
            "plan": "Starter",
            "status": "active",
            "creditsLimit": 40,
        },
        headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["creditsLimit"] == 40
    assert body["creditsUsed"] == 40

    with app.app_context():
        conn = db()
        try:
            user = conn.execute(
                "SELECT credits_used, credits_limit FROM users WHERE id = 2"
            ).fetchone()
            assert int(user["credits_limit"]) == 40
            assert int(user["credits_used"]) == 40
        finally:
            conn.close()
