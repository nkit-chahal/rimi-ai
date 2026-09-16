"""Tools must refuse another account's files.

Every tool resolved its input by bare basename against the uploads and results folders. Any
logged-in user who learned a filename, from a share link, an exports list or a pipeline
result, could run tools on another customer's artwork and get the output in their own project.
"""
import os

import bcrypt
import pytest
from datetime import datetime, timezone
from PIL import Image

OWNED = "owned_by_alice.png"


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


@pytest.fixture()
def two_accounts(app):
    """Alice (user 1) owns OWNED. Mallory (user 2) owns nothing."""
    from config import UPLOAD_DIR
    from db import db

    now = _now()
    pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    with app.app_context():
        conn = db()
        try:
            for uid, email in ((1, "alice@test.example"), (2, "mallory@test.example")):
                conn.execute(
                    """
                    INSERT INTO users (id, email, password, name, initials, role, plan,
                                       credits_used, credits_limit, reset_at, status, created_at)
                    VALUES (?, ?, ?, 'N', 'N', 'user', 'Starter', 0, 5000, ?, 'active', ?)
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
            conn.execute(
                "INSERT INTO user_uploads (user_id, filename, created_at) VALUES (1, ?, ?)",
                (OWNED, now),
            )
            conn.commit()
        finally:
            conn.close()

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    Image.new("RGB", (48, 48), (180, 60, 60)).save(os.path.join(UPLOAD_DIR, OWNED))
    return None


def _token(client, email):
    resp = client.post("/api/login", json={"email": email, "password": "Test@12345"})
    assert resp.status_code == 200
    return resp.get_json()["token"]


def _headers(client, email):
    return {"Authorization": f"Bearer {_token(client, email)}"}


# (route, payload builder) for tools that resolve the file before doing any paid work.
CASES = [
    ("/api/extract-palette", lambda pid: {"filename": OWNED, "projectId": pid}),
    ("/api/remove-bg", lambda pid: {"filename": OWNED, "projectId": pid}),
    ("/api/print-advisor", lambda pid: {"filename": OWNED, "projectId": pid, "fabricType": "cotton"}),
]


@pytest.mark.parametrize("route,payload", CASES)
def test_another_account_cannot_use_the_file(client, two_accounts, route, payload):
    resp = client.post(
        route, json=payload(2), headers=_headers(client, "mallory@test.example")
    )
    assert resp.status_code == 404, (
        f"{route} let user 2 reach user 1's file (status {resp.status_code})"
    )


@pytest.mark.parametrize("route,payload", CASES)
def test_the_owner_is_not_blocked(client, two_accounts, route, payload):
    """The check must not break the legitimate case."""
    resp = client.post(
        route, json=payload(1), headers=_headers(client, "alice@test.example")
    )
    assert resp.status_code != 404, f"{route} refused the owner their own file"


def test_refusal_costs_the_caller_nothing(client, app, two_accounts):
    """remove-bg resolves before reserving, so a refused request must be free."""
    from db import db

    client.post(
        "/api/remove-bg",
        json={"filename": OWNED, "projectId": 2},
        headers=_headers(client, "mallory@test.example"),
    )
    with app.app_context():
        conn = db()
        try:
            used = conn.execute(
                "SELECT credits_used FROM users WHERE id = 2"
            ).fetchone()["credits_used"]
        finally:
            conn.close()
    assert used == 0


def test_shared_demo_artwork_stays_available_to_everyone(client, app, two_accounts):
    """public/ holds demo images that belong to nobody; they must not be locked away."""
    from file_access import resolve_readable_path

    with app.app_context():
        resolved = resolve_readable_path("demo_floral.png", user={"id": 2, "role": "user"})
    assert resolved and os.path.exists(resolved), "demo artwork should resolve for any user"
