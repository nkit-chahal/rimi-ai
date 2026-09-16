"""Mockup batches belong on the job queue, not in a web worker.

A batch is one Replicate call per product through a three-wide pool, so six products take
minutes. Gunicorn serves four workers of two threads, so eight concurrent batches occupy
every slot and the API stops answering for everyone.
"""
import os

import bcrypt
import pytest
from datetime import datetime, timezone
from PIL import Image

PATTERN = "mockup_pattern.png"


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


@pytest.fixture()
def pro_user(app):
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
                VALUES (1, 'pro@test.example', ?, 'P', 'P', 'user', 'Pro', 0, 50000, ?, 'active', ?,
                        '2099-01-01T00:00:00')
                """,
                (pw, now, now),
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
                (PATTERN, now),
            )
            conn.commit()
        finally:
            conn.close()

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    Image.new("RGB", (64, 64), (150, 90, 70)).save(os.path.join(UPLOAD_DIR, PATTERN))
    return None


@pytest.fixture()
def fake_mockups(monkeypatch):
    """Stand in for the Replicate round trip so no test spends money."""
    from routes import mockups

    made = []

    def fake_single(_img, product_type, _project_id, **_kwargs):
        made.append(product_type)
        return f"mockup_{product_type}.png", 67

    monkeypatch.setattr(mockups, "_generate_single_mockup", fake_single)
    monkeypatch.setattr(mockups, "log_export", lambda *_a, **_k: None)
    return made


def _token(client):
    resp = client.post("/api/login", json={"email": "pro@test.example", "password": "Test@12345"})
    assert resp.status_code == 200
    return resp.get_json()["token"]


def _payload(**extra):
    base = {
        "patternFilename": PATTERN,
        "products": ["tshirt", "cushion"],
        "projectId": 1,
        "category": "apparel",
    }
    base.update(extra)
    return base


def test_the_worker_dispatch_knows_the_batch_tool():
    """A job whose toolKey nothing dispatches would sit queued for ever."""
    import inspect

    import workers

    source = inspect.getsource(workers.run_generation_job)
    assert "generate-mockups-batch" in source


def test_async_request_returns_a_job_instead_of_the_result(client, app, pro_user, fake_mockups, monkeypatch):
    monkeypatch.setenv("RIMI_SYNC_JOBS", "1")  # run inline so the test stays deterministic

    resp = client.post(
        "/api/generate-mockups-batch",
        json=_payload(**{"async": True}),
        headers={"Authorization": f"Bearer {_token(client)}"},
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert "jobId" in body, "an async request must hand back a job to poll"


def test_the_queued_job_produces_the_same_result_as_a_direct_call(app, pro_user, fake_mockups):
    """Same function either way, so the queue cannot drift from the request path."""
    from routes.mockups import execute_mockups_batch

    with app.app_context():
        result = execute_mockups_batch({**_payload(), "userId": 1, "projectId": 1})

    assert result["success"] is True
    assert {m["productType"] for m in result["mockups"]} == {"tshirt", "cushion"}
    assert sorted(fake_mockups) == ["cushion", "tshirt"]


def test_the_synchronous_path_still_works(client, app, pro_user, fake_mockups):
    """Existing clients that do not ask for async must keep working unchanged."""
    resp = client.post(
        "/api/generate-mockups-batch",
        json=_payload(),
        headers={"Authorization": f"Bearer {_token(client)}"},
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert len(body["mockups"]) == 2


def test_progress_is_reported_per_product(app, pro_user, fake_mockups):
    """The browser polls for this, so it has to move as products finish."""
    from routes.mockups import execute_mockups_batch

    seen = []
    with app.app_context():
        execute_mockups_batch(
            {**_payload(), "userId": 1, "projectId": 1},
            on_progress=lambda pct, stage: seen.append((pct, stage)),
        )

    assert seen, "no progress was reported"
    assert seen[-1][0] == 100
    assert any("of 2 products" in stage for _pct, stage in seen)


def test_an_unaffordable_batch_raises_before_any_model_runs(app, pro_user, fake_mockups):
    from db import db
    from routes.mockups import execute_mockups_batch

    with app.app_context():
        conn = db()
        try:
            conn.execute("UPDATE users SET credits_limit = 10 WHERE id = 1")
            conn.commit()
        finally:
            conn.close()

        with pytest.raises(ValueError):
            execute_mockups_batch({**_payload(), "userId": 1, "projectId": 1})

    assert fake_mockups == [], "no product should have been generated"
