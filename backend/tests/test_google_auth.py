"""Google OAuth redirect + exchange regression tests."""
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse


def _utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def test_frontend_login_url_keeps_oauth_query_on_login_path(monkeypatch):
    # Set after import so dotenv override=True in config cannot clobber the value.
    import routes.google_auth as google_auth

    monkeypatch.setenv("FRONTEND_URL", "https://rimiai.pro")
    assert google_auth.frontend_url() == "https://rimiai.pro"
    assert google_auth.frontend_login_url() == "https://rimiai.pro/login"
    url = google_auth.frontend_login_url({"google_login_token": "abc123"})
    parsed = urlparse(url)
    assert parsed.scheme == "https"
    assert parsed.netloc == "rimiai.pro"
    assert parsed.path == "/login"
    assert parse_qs(parsed.query)["google_login_token"] == ["abc123"]


def test_google_start_unconfigured_redirects_to_login(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:5173")
    res = client.get("/api/auth/google/start", follow_redirects=False)
    assert res.status_code in (301, 302, 303, 307, 308)
    location = res.headers["Location"]
    parsed = urlparse(location)
    assert parsed.path.endswith("/login")
    qs = parse_qs(parsed.query)
    assert "google_error" in qs
    assert qs["google_error"][0]


def test_google_exchange_issues_jwt(client, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-for-pytest-only")
    from db import db

    now = _utc_now()
    token = "oauth-exchange-test-token"
    conn = db()
    try:
        conn.execute(
            """
            INSERT INTO users
            (id, email, password, name, initials, role, plan, credits_used, credits_limit,
             reset_at, login_provider, google_sub, email_verified, created_at, status)
            VALUES (901, 'google-user@example.com', 'x', 'Google User', 'GU', 'user',
                    'Free Trial', 0, 200, ?, 'google', 'sub-901', 1, ?, 'active')
            """,
            ((now + timedelta(days=30)).isoformat(), now.isoformat()),
        )
        conn.execute(
            """
            INSERT INTO oauth_login_tokens (token, user_id, expires_at, created_at)
            VALUES (?, 901, ?, ?)
            """,
            (token, (now + timedelta(minutes=5)).isoformat(), now.isoformat()),
        )
        conn.commit()
    finally:
        conn.close()

    res = client.post(
        "/api/auth/google/exchange",
        json={"token": token},
    )
    data = res.get_json()
    assert res.status_code == 200
    assert data["success"] is True
    assert data["user"]["email"] == "google-user@example.com"
    assert data["token"]
