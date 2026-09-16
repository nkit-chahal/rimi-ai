"""Free-tier output must carry the watermark wherever it is served.

The download proxy and the public share links stamped free-plan output, but /results/<file>
handed back the original. The studio shows that URL in its own canvas, so the clean image was
one right-click away, and the whole free-tier limit was decorative.
"""
import io
import os

import bcrypt
import pytest
from datetime import datetime, timezone
from PIL import Image

RESULT = "free_user_result.png"
PAID_RESULT = "paid_user_result.png"
VECTOR = "free_user_result.svg"


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


@pytest.fixture()
def accounts(app):
    """User 1 is on Free Trial, user 2 on a paid plan. Each owns one result."""
    from config import RESULTS_DIR
    from db import db

    now = _now()
    pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    with app.app_context():
        conn = db()
        try:
            for uid, email, plan in (
                (1, "free@test.example", "Free Trial"),
                (2, "paid@test.example", "Starter"),
            ):
                conn.execute(
                    """
                    INSERT INTO users (id, email, password, name, initials, role, plan,
                                       credits_used, credits_limit, reset_at, status, created_at)
                    VALUES (?, ?, ?, 'N', 'N', 'user', ?, 0, 500, ?, 'active', ?)
                    """,
                    (uid, email, pw, plan, now, now),
                )
            for uid, name in ((1, RESULT), (1, VECTOR), (2, PAID_RESULT)):
                conn.execute(
                    "INSERT INTO user_uploads (user_id, filename, created_at) VALUES (?, ?, ?)",
                    (uid, name, now),
                )
            conn.commit()
        finally:
            conn.close()

    os.makedirs(RESULTS_DIR, exist_ok=True)
    for name in (RESULT, PAID_RESULT):
        Image.new("RGB", (160, 160), (200, 80, 60)).save(os.path.join(RESULTS_DIR, name))
    with open(os.path.join(RESULTS_DIR, VECTOR), "w", encoding="utf-8") as handle:
        handle.write('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')
    return None


def _token(client, email):
    resp = client.post("/api/login", json={"email": email, "password": "Test@12345"})
    assert resp.status_code == 200
    return resp.get_json()["token"]


def _get(client, email, path):
    return client.get(path, headers={"Authorization": f"Bearer {_token(client, email)}"})


def _source_bytes(app, name):
    from config import RESULTS_DIR

    with app.app_context():
        with open(os.path.join(RESULTS_DIR, name), "rb") as handle:
            return handle.read()


def test_free_plan_result_is_watermarked_when_served(client, app, accounts):
    resp = _get(client, "free@test.example", f"/results/{RESULT}")

    assert resp.status_code == 200
    assert resp.data != _source_bytes(app, RESULT), "the original was served unchanged"
    assert resp.mimetype == "image/png"
    # Still a usable image, just stamped.
    Image.open(io.BytesIO(resp.data)).verify()


def test_paid_plan_result_is_untouched(client, app, accounts):
    resp = _get(client, "paid@test.example", f"/results/{PAID_RESULT}")

    assert resp.status_code == 200
    assert resp.data == _source_bytes(app, PAID_RESULT), "a paying customer got a stamped file"


def test_vector_output_is_never_stamped(client, app, accounts):
    """An SVG cannot be raster-watermarked without destroying it."""
    resp = _get(client, "free@test.example", f"/results/{VECTOR}")

    assert resp.status_code == 200
    assert b"<svg" in resp.data


def test_the_stamped_copy_is_cached(client, app, accounts):
    """Re-encoding a full image on every <img> the studio renders would be unaffordable."""
    from config import RESULTS_DIR

    first = _get(client, "free@test.example", f"/results/{RESULT}")
    cache = os.path.join(RESULTS_DIR, "watermarked", f"wm_{RESULT.rsplit('.', 1)[0]}.png")
    assert os.path.exists(cache), "no cached copy was written"

    second = _get(client, "free@test.example", f"/results/{RESULT}")
    assert second.data == first.data, "the cached copy should be reused byte for byte"


def test_gallery_thumbnail_is_stamped_too(client, app, accounts):
    """A clean 400px copy is still a clean copy."""
    from config import RESULTS_DIR

    previews = os.path.join(RESULTS_DIR, "previews")
    os.makedirs(previews, exist_ok=True)
    preview_name = f"prev_{RESULT.rsplit('.', 1)[0]}.jpg"
    Image.new("RGB", (120, 120), (90, 140, 200)).save(os.path.join(previews, preview_name))

    with app.app_context():
        from db import db
        conn = db()
        try:
            conn.execute(
                "INSERT INTO user_uploads (user_id, filename, created_at) VALUES (1, ?, ?)",
                (preview_name, _now()),
            )
            conn.commit()
        finally:
            conn.close()

    resp = _get(client, "free@test.example", f"/results/previews/{preview_name}")
    assert resp.status_code == 200
    assert resp.mimetype == "image/png", "the thumbnail was served without a stamp"
