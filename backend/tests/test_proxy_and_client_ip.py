"""The app must derive the client address from a trusted proxy, not from a raw header.

Behind Railway or nginx every request arrives from the proxy, so request.remote_addr is the
proxy. Two things broke as a result:

- Flask-Limiter keyed every limit on that one address, so "10 logins per minute" throttled the
  entire user base together while doing nothing to an individual attacker.
- signup_guard read X-Forwarded-For directly, and a client can set that header to anything, so
  the signup IP cooldown could be walked straight past with a new value per request.
"""
import bcrypt
import pytest
from datetime import datetime, timezone


def _utc_now_iso():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def _build_app(tmp_path, monkeypatch, hops):
    monkeypatch.setenv("TRUSTED_PROXY_COUNT", str(hops))
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-for-pytest-only")
    monkeypatch.setenv("FLASK_ENV", "testing")
    monkeypatch.setenv("RIMI_DISABLE_CLEANUP_SCHEDULER", "1")

    import db
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / f"proxy_{hops}.sqlite3"))
    import middleware
    middleware._USER_CACHE.clear()

    from server import create_app
    application = create_app()
    application.config["TESTING"] = True

    conn = db.db()
    try:
        conn.execute(
            """
            INSERT INTO users (id, email, password, name, initials, role, plan, credits_used,
                               credits_limit, reset_at, status, created_at)
            VALUES (1, 'ip@test.example', ?, 'IP', 'IP', 'user', 'Free Trial', 0, 200, ?, 'active', ?)
            """,
            (
                bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode(),
                _utc_now_iso(),
                _utc_now_iso(),
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return application


def _recorded_ip(app):
    import db
    conn = db.db()
    try:
        row = conn.execute(
            "SELECT ip_address FROM login_events ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return row["ip_address"] if row else None
    finally:
        conn.close()


def _login(client, forwarded_for=None):
    headers = {"X-Forwarded-For": forwarded_for} if forwarded_for else {}
    return client.post(
        "/api/login",
        json={"email": "ip@test.example", "password": "Test@12345"},
        headers=headers,
    )


def test_forwarded_client_ip_is_used_when_a_proxy_is_trusted(tmp_path, monkeypatch):
    app = _build_app(tmp_path, monkeypatch, hops=1)
    resp = _login(app.test_client(), "203.0.113.9")
    assert resp.status_code == 200
    assert _recorded_ip(app) == "203.0.113.9"


def test_forwarded_header_is_ignored_without_a_trusted_proxy(tmp_path, monkeypatch):
    """The security case: a direct client must not be able to name its own address."""
    app = _build_app(tmp_path, monkeypatch, hops=0)
    resp = _login(app.test_client(), "203.0.113.9")
    assert resp.status_code == 200

    recorded = _recorded_ip(app)
    assert recorded != "203.0.113.9", "a forged header must not be believed"
    assert recorded == "127.0.0.1"


def test_rate_limit_is_per_client_not_per_proxy(tmp_path, monkeypatch):
    """Ten failed logins from one address must not lock everyone else out."""
    app = _build_app(tmp_path, monkeypatch, hops=1)
    client = app.test_client()

    attacker = "198.51.100.5"
    codes = []
    for _ in range(12):
        codes.append(
            client.post(
                "/api/login",
                json={"email": "ip@test.example", "password": "wrong"},
                headers={"X-Forwarded-For": attacker},
            ).status_code
        )
    assert 429 in codes, "the attacker should be throttled"

    # A different customer, arriving through the same proxy, is unaffected.
    innocent = _login(client, "198.51.100.200")
    assert innocent.status_code == 200


@pytest.mark.parametrize("hops", [0, 1])
def test_signup_guard_reads_the_same_address_as_the_rest_of_the_app(tmp_path, monkeypatch, hops):
    app = _build_app(tmp_path, monkeypatch, hops=hops)
    from signup_guard import get_client_ip

    with app.test_request_context(headers={"X-Forwarded-For": "203.0.113.77"}):
        # test_request_context bypasses the WSGI middleware, so this only asserts the helper
        # itself no longer parses the header; the end-to-end behaviour is covered above.
        assert get_client_ip() != "203.0.113.77"
