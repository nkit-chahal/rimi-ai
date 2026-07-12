from datetime import datetime, timedelta, timezone

import bcrypt


def test_share_link_not_found(client):
    response = client.get("/api/share/does-not-exist")
    assert response.status_code == 404


def test_share_og_landing_not_found(client):
    response = client.get("/share/does-not-exist", headers={"User-Agent": "facebookexternalhit/1.1"})
    assert response.status_code == 404
    assert "text/html" in response.content_type
    assert b"Share link unavailable" in response.data


def test_share_og_landing_redirects_browsers(client, app):
    from db import db

    with app.app_context():
        conn = db()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
        conn.execute(
            """
            INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
            VALUES (1, 'share@test.example', ?, 'Sharer', 'SH', 'user', 'Starter', 0, 1000, ?, 'active', ?)
            """,
            (pw, (now + timedelta(days=60)).isoformat(), now.isoformat()),
        )
        conn.execute(
            """
            INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
            VALUES (1, 'Floral Drop', 'Draft', '', '', ?, 1)
            """,
            (now.isoformat(),),
        )
        conn.execute(
            """
            INSERT INTO share_links (token, user_id, project_id, export_filename, expires_at, created_at)
            VALUES ('sharetokenseo123', 1, 1, 'tile.png', ?, ?)
            """,
            ((now + timedelta(days=7)).isoformat(), now.isoformat()),
        )
        conn.commit()
        conn.close()

    browser = client.get("/share/sharetokenseo123", headers={"User-Agent": "Mozilla/5.0"})
    assert browser.status_code in (302, 301)
    assert "/share/sharetokenseo123" in (browser.headers.get("Location") or "")

    bot = client.get("/share/sharetokenseo123", headers={"User-Agent": "facebookexternalhit/1.1"})
    assert bot.status_code == 200
    assert b"og:image" in bot.data
    assert b"Floral Drop" in bot.data
