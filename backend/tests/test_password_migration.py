import bcrypt

from db import db, migrate_legacy_email_passwords


def test_legacy_email_passwords_are_hashed_and_remain_usable(app, client):
    conn = db()
    try:
        conn.execute(
            """
            INSERT INTO users
            (email, password, name, initials, role, plan, credits_used,
             credits_limit, reset_at, status, login_provider)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "legacy@example.com",
                "LegacyPass123!",
                "Legacy User",
                "LU",
                "user",
                "Starter",
                0,
                200,
                "2099-01-01T00:00:00",
                "active",
                "email",
            ),
        )
        conn.execute(
            """
            INSERT INTO users
            (email, password, name, initials, role, plan, credits_used,
             credits_limit, reset_at, status, login_provider)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "google@example.com",
                "GOOGLE_AUTH_ONLY",
                "Google User",
                "GU",
                "user",
                "Starter",
                0,
                200,
                "2099-01-01T00:00:00",
                "active",
                "google",
            ),
        )

        assert migrate_legacy_email_passwords(conn) == 1
        conn.commit()

        email_password = conn.execute(
            "SELECT password FROM users WHERE email = ?", ("legacy@example.com",)
        ).fetchone()["password"]
        google_password = conn.execute(
            "SELECT password FROM users WHERE email = ?", ("google@example.com",)
        ).fetchone()["password"]
    finally:
        conn.close()

    assert email_password.startswith("$2")
    assert bcrypt.checkpw(b"LegacyPass123!", email_password.encode("utf-8"))
    assert google_password == "GOOGLE_AUTH_ONLY"

    response = client.post(
        "/api/login",
        json={"email": "legacy@example.com", "password": "LegacyPass123!"},
    )
    assert response.status_code == 200
    assert response.get_json()["success"] is True
