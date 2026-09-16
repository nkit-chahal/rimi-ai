"""A request that is refused must not cost credits.

Four routes reserved credits before validating their input, then returned 400 or 404 on a path
with no refund. The user paid for work the server never attempted.
"""
import os

import bcrypt
import pytest
from datetime import datetime, timezone
from PIL import Image


def _utc_now_iso():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


@pytest.fixture()
def buyer(app):
    from db import db

    now = _utc_now_iso()
    pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    with app.app_context():
        conn = db()
        try:
            for uid, email in ((1, "meter@test.example"), (2, "other@test.example")):
                conn.execute(
                    """
                    INSERT INTO users (id, email, password, name, initials, role, plan,
                                       credits_used, credits_limit, reset_at, status, created_at)
                    VALUES (?, ?, ?, 'M', 'M', 'user', 'Starter', 0, 5000, ?, 'active', ?)
                    """,
                    (uid, email, pw, now, now),
                )
                conn.execute(
                    """
                    INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url,
                                          updated_at, user_id)
                    VALUES (?, 'P', 'Draft', '', '', ?, ?)
                    """,
                    (uid, now, uid),
                )
                conn.execute(
                    """
                    INSERT INTO project_metrics (project_id, versions, versions_delta, exports,
                                                 exports_delta, ai_generations,
                                                 ai_generations_delta, credits_used, credits_delta)
                    VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0)
                    """,
                    (uid,),
                )
            # A palette that belongs to user 2, for the ownership case.
            conn.execute(
                """
                INSERT INTO brand_palettes (project_id, name, colors_json, created_at)
                VALUES (2, 'Theirs', '["#112233","#445566"]', ?)
                """,
                (now,),
            )
            conn.commit()
        finally:
            conn.close()
    return None


def _token(client, email="meter@test.example"):
    resp = client.post("/api/login", json={"email": email, "password": "Test@12345"})
    assert resp.status_code == 200
    return resp.get_json()["token"]


def _credits_used(app, user_id=1):
    from db import db

    with app.app_context():
        conn = db()
        try:
            return conn.execute(
                "SELECT credits_used FROM users WHERE id = ?", (user_id,)
            ).fetchone()["credits_used"]
        finally:
            conn.close()


def test_remove_bg_missing_file_costs_nothing(app, client, buyer):
    token = _token(client)
    resp = client.post(
        "/api/remove-bg",
        json={"filename": "does-not-exist.png", "projectId": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404
    assert _credits_used(app) == 0


def test_generate_seamless_without_a_prompt_costs_nothing(app, client, buyer):
    token = _token(client)
    resp = client.post(
        "/api/generate-seamless",
        json={"prompt": "", "projectId": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert _credits_used(app) == 0


def _seed_image(app, name="meter_src.png"):
    from config import UPLOAD_DIR

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, name)
    Image.new("RGB", (32, 32), (200, 40, 40)).save(path)
    return name


def test_color_reduce_with_an_unknown_palette_costs_nothing(app, client, buyer):
    name = _seed_image(app)
    token = _token(client)
    resp = client.post(
        "/api/color-reduce",
        json={"filename": name, "projectId": 1, "numColors": 4, "brandPaletteId": 9999},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404
    assert _credits_used(app) == 0


def test_color_reduce_with_someone_elses_palette_costs_nothing(app, client, buyer):
    name = _seed_image(app, "meter_src2.png")
    token = _token(client)

    from db import db
    with app.app_context():
        conn = db()
        try:
            palette_id = conn.execute(
                "SELECT id FROM brand_palettes WHERE name = 'Theirs'"
            ).fetchone()["id"]
        finally:
            conn.close()

    resp = client.post(
        "/api/color-reduce",
        json={"filename": name, "projectId": 1, "numColors": 4, "brandPaletteId": palette_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert _credits_used(app) == 0


def test_replicate_timeout_stays_under_the_worker_timeout():
    """A prediction that outlives the gunicorn worker can never reach the refund path."""
    import replicate_client

    worker_timeout = 300  # gunicorn_config.timeout
    assert replicate_client.DEFAULT_TIMEOUT < worker_timeout
