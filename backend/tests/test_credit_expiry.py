import bcrypt
from datetime import datetime, timedelta, timezone

import pytest

from auth import (
    CREDIT_EXPIRY_DAYS,
    check_credits,
    expire_credits_if_needed,
    extend_credit_expiry,
    reserve_credits_or_error,
)
from db import db


def _seed_user(conn, *, credits_limit=100, credits_used=20, reset_at=None):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (1, 'expiry@test.example', ?, 'Expiry Tester', 'ET', 'user', 'Starter', ?, ?, ?, 'active', ?)
        """,
        (
            password_hash,
            credits_used,
            credits_limit,
            (reset_at or now).isoformat(),
            now.isoformat(),
        ),
    )
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (1, 'Test Project', 'Draft', '/demo.png', '/demo.png', ?, 1)
        """,
        (now.isoformat(),),
    )
    conn.execute(
        """
        INSERT INTO project_metrics (project_id, versions, versions_delta, exports, exports_delta, ai_generations, ai_generations_delta, credits_used, credits_delta)
        VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0)
        """
    )
    conn.commit()


@pytest.fixture()
def expired_user(app):
    with app.app_context():
        conn = db()
        try:
            past = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
            _seed_user(conn, credits_limit=100, credits_used=20, reset_at=past)
        finally:
            conn.close()
    yield


@pytest.fixture()
def active_user(app):
    with app.app_context():
        conn = db()
        try:
            future = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30)
            _seed_user(conn, credits_limit=100, credits_used=20, reset_at=future)
        finally:
            conn.close()
    yield


def test_expire_credits_if_needed_zeroes_remaining(expired_user):
    applied = expire_credits_if_needed(1)
    assert applied is True

    ok, remaining, limit, used = check_credits(1, 1)
    assert ok is False
    assert remaining == 0
    assert used == 100
    assert limit == 100

    conn = db()
    try:
        row = conn.execute(
            "SELECT note FROM credit_transactions WHERE user_id = 1 AND note = '1-month credit expiry'"
        ).fetchone()
        assert row is not None
    finally:
        conn.close()


def test_expire_credits_noop_when_not_due(active_user):
    applied = expire_credits_if_needed(1)
    assert applied is False

    ok, remaining, limit, used = check_credits(1, 1)
    assert ok is True
    assert remaining == 80
    assert used == 20
    assert limit == 100


def test_reserve_rejects_after_expiry(expired_user):
    ok, err = reserve_credits_or_error(1, 1, 10, activity_type='generation', count=1)
    assert ok is False
    assert err is not None
    assert err['creditsRemaining'] == 0


def test_extend_credit_expiry_stacks_from_future_reset(active_user):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    future = now + timedelta(days=10)
    conn = db()
    try:
        conn.execute(
            "UPDATE users SET reset_at = ? WHERE id = 1",
            (future.isoformat(),),
        )
        conn.commit()
        new_reset = extend_credit_expiry(1, conn=conn, from_dt=now)
        conn.commit()
        assert new_reset is not None
        parsed = datetime.fromisoformat(new_reset)
        expected = future + timedelta(days=CREDIT_EXPIRY_DAYS)
        assert abs((parsed - expected).total_seconds()) < 2
        # Must be later than now + 30 (stacked leftover days)
        assert parsed > now + timedelta(days=CREDIT_EXPIRY_DAYS)
    finally:
        conn.close()


def test_extend_credit_expiry_from_now_when_expired(expired_user):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    new_reset = extend_credit_expiry(1, from_dt=now)
    assert new_reset is not None
    parsed = datetime.fromisoformat(new_reset)
    expected = now + timedelta(days=CREDIT_EXPIRY_DAYS)
    assert abs((parsed - expected).total_seconds()) < 2
