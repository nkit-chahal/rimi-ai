import bcrypt
from datetime import datetime, timezone

import pytest

from auth import (
    adjust_reserved_credits,
    check_credits,
    get_updated_credits,
    refund_credits,
    reserve_credits,
    reserve_credits_or_error,
)
from db import db


def _seed_user_project(conn, *, credits_limit=100, credits_used=0):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (1, 'credits@test.example', ?, 'Credits Tester', 'CT', 'user', 'Free Trial', ?, ?, ?, 'active', ?)
        """,
        (password_hash, credits_used, credits_limit, now, now),
    )
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (1, 'Test Project', 'Draft', '/demo.png', '/demo.png', ?, 1)
        """,
        (now,),
    )
    conn.execute(
        """
        INSERT INTO project_metrics (project_id, versions, versions_delta, exports, exports_delta, ai_generations, ai_generations_delta, credits_used, credits_delta)
        VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0)
        """
    )
    conn.commit()


@pytest.fixture()
def seeded_credits(app):
    with app.app_context():
        conn = db()
        try:
            _seed_user_project(conn)
        finally:
            conn.close()
    yield


def test_reserve_credits_deducts_balance(seeded_credits):
    ok, remaining, limit, used = check_credits(1, 10)
    assert ok is True
    assert remaining == 100

    reserve_credits(1, 1, 25, activity_type='generation', count=1)

    ok, remaining, limit, used = check_credits(1, 1)
    assert ok is True
    assert used == 25
    assert remaining == 75
    assert limit == 100


def test_reserve_credits_or_error_rejects_insufficient(seeded_credits):
    ok, err = reserve_credits_or_error(1, 1, 150, activity_type='generation', count=1)
    assert ok is False
    assert err is not None
    assert err['creditsRequired'] == 150
    assert err['creditsRemaining'] == 100

    credits = get_updated_credits(1)
    assert credits['creditsUsed'] == 0


def test_refund_credits_restores_balance(seeded_credits):
    reserve_credits(1, 1, 40, activity_type='generation', count=1)
    refund_credits(1, 1, 40, note='Test refund')

    credits = get_updated_credits(1)
    assert credits['creditsUsed'] == 0

    ok, remaining, _limit, used = check_credits(1, 40)
    assert ok is True
    assert used == 0
    assert remaining == 100


def test_adjust_reserved_credits_partial_refund(seeded_credits):
    reserve_credits(1, 1, 50, activity_type='generation', count=1)
    adjust_reserved_credits(1, 1, 50, 30, note='Partial success')

    credits = get_updated_credits(1)
    assert credits['creditsUsed'] == 30

    ok, remaining, _limit, used = check_credits(1, 1)
    assert ok is True
    assert used == 30
    assert remaining == 70
