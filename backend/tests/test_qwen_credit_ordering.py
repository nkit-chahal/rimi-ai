"""Qwen tools must pay before the model runs, and get the money back if it fails.

The old order was: check the balance, call Replicate, then deduct. Two requests that arrived
together both passed the check and both ran, so Replicate was paid twice while the customer
was charged once. Anything that failed between the model returning and the deduction produced
work nobody paid for. Batch edits were worse: every file ran before any of them was charged,
so an under-funded batch burned the whole run for nothing.
"""
import os

import bcrypt
import pytest
from datetime import datetime, timezone
from PIL import Image

SOURCE = "qwen_src.png"


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


@pytest.fixture()
def seeded(app):
    from config import UPLOAD_DIR
    from db import db

    now = _now()
    pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    with app.app_context():
        conn = db()
        try:
            conn.execute(
                """
                INSERT INTO users (id, email, password, name, initials, role, plan, credits_used,
                                   credits_limit, reset_at, status, created_at, pro_until)
                VALUES (1, 'qwen@test.example', ?, 'Q', 'Q', 'user', 'Pro', 0, 5000, ?, 'active', ?, ?)
                """,
                # Far-future Pro window; the service layer does not gate on it, the routes do.
                (pw, now, now, "2099-01-01T00:00:00"),
            )
            conn.execute(
                """
                INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
                VALUES (1, 'P', 'Draft', '', '', ?, 1)
                """,
                (now,),
            )
            conn.execute(
                """
                INSERT INTO project_metrics (project_id, versions, versions_delta, exports,
                                             exports_delta, ai_generations, ai_generations_delta,
                                             credits_used, credits_delta)
                VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0)
                """
            )
            conn.execute(
                "INSERT INTO user_uploads (user_id, filename, created_at) VALUES (1, ?, ?)",
                (SOURCE, now),
            )
            conn.commit()
        finally:
            conn.close()

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    Image.new("RGB", (32, 32), (120, 90, 200)).save(os.path.join(UPLOAD_DIR, SOURCE))
    return None


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


def _payload(**extra):
    base = {"filename": SOURCE, "projectId": 1, "userId": 1, "numLayers": 2}
    base.update(extra)
    return base


def test_a_failed_decomposition_costs_nothing(app, seeded, monkeypatch):
    """The vendor call raises; the reservation must come back."""
    from services import qwen_layers

    def explode(*_a, **_k):
        raise RuntimeError("replicate exploded")

    monkeypatch.setattr(qwen_layers, "run_model", explode)

    with app.app_context():
        with pytest.raises(RuntimeError):
            qwen_layers.execute_image_layers(_payload())

    assert _credits_used(app) == 0, "a failed run must not leave the reservation spent"


def test_a_failure_after_the_model_also_refunds(app, seeded, monkeypatch):
    """The model succeeded and cost real money, but the work after it failed."""
    from services import qwen_layers

    monkeypatch.setattr(qwen_layers, "run_model", lambda *_a, **_k: ["http://example.test/a.png"])

    def bad_download(*_a, **_k):
        raise RuntimeError("download failed")

    monkeypatch.setattr(qwen_layers, "_download_replicate_output", bad_download)

    with app.app_context():
        with pytest.raises(RuntimeError):
            qwen_layers.execute_image_layers(_payload())

    assert _credits_used(app) == 0


def test_a_successful_run_charges_exactly_once(app, seeded, monkeypatch):
    from auth import credit_requirement
    from services import qwen_layers

    png = _one_pixel_png()
    monkeypatch.setattr(qwen_layers, "run_model", lambda *_a, **_k: ["http://example.test/a.png"])
    monkeypatch.setattr(qwen_layers, "_download_replicate_output", lambda *_a, **_k: png)
    monkeypatch.setattr(qwen_layers.storage, "sync_to_s3", lambda *_a, **_k: None)

    with app.app_context():
        expected = credit_requirement("imageLayers", 69)
        result = qwen_layers.execute_image_layers(_payload())

    assert result["success"] is True
    assert _credits_used(app) == expected, "one run, one charge"


def test_the_reservation_happens_before_the_model_is_called(app, seeded, monkeypatch):
    """The point of the change: the balance moves first, so a second caller cannot slip in."""
    from services import qwen_layers

    seen = {}

    def record_then_fail(*_a, **_k):
        seen["credits_used_at_call_time"] = _credits_used(app)
        raise RuntimeError("stop here")

    monkeypatch.setattr(qwen_layers, "run_model", record_then_fail)

    with app.app_context():
        with pytest.raises(RuntimeError):
            qwen_layers.execute_image_layers(_payload())

    assert seen["credits_used_at_call_time"] > 0, (
        "credits should already be reserved by the time Replicate is called"
    )
    assert _credits_used(app) == 0, "and refunded once it failed"


def test_an_unaffordable_run_never_reaches_the_model(app, seeded, monkeypatch):
    from db import db
    from services import qwen_layers

    with app.app_context():
        conn = db()
        try:
            conn.execute("UPDATE users SET credits_limit = 10 WHERE id = 1")
            conn.commit()
        finally:
            conn.close()

    called = {"model": False}

    def should_not_run(*_a, **_k):
        called["model"] = True
        return []

    monkeypatch.setattr(qwen_layers, "run_model", should_not_run)

    with app.app_context():
        with pytest.raises(ValueError):
            qwen_layers.execute_image_layers(_payload())

    assert called["model"] is False, "Replicate must not be called when the user cannot pay"
    assert _credits_used(app) == 0


def _one_pixel_png():
    import io

    buffer = io.BytesIO()
    Image.new("RGBA", (4, 4), (10, 20, 30, 255)).save(buffer, format="PNG")
    return buffer.getvalue()
