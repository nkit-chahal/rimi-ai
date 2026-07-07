"""Tests for Qwen Studio sessions, async jobs, and layer helpers."""
import json
import os
from datetime import datetime, timezone

import bcrypt
import pytest

from db import db


def _seed_user_project(conn, *, credits_limit=500, credits_used=0, role='user'):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (1, 'qwen@test.example', ?, 'Qwen Tester', 'QT', ?, 'Pro', ?, ?, ?, 'active', ?)
        """,
        (password_hash, role, credits_used, credits_limit, now, now),
    )
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (1, 'Qwen Project', 'Draft', '/demo.png', '/demo.png', ?, 1)
        """,
        (now,),
    )
    conn.execute(
        """
        INSERT INTO project_metrics (project_id, versions, versions_delta, exports, exports_delta, ai_generations, ai_generations_delta, credits_used, credits_delta)
        VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0)
        """
    )
    conn.commit()


def _auth_headers():
    from jwt_tokens import issue_access_token
    token = issue_access_token(1, "user")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture()
def seeded_qwen(app):
    with app.app_context():
        conn = db()
        try:
            _seed_user_project(conn)
        finally:
            conn.close()
    yield


def test_qwen_session_crud_and_document_snapshot(seeded_qwen, client):
    headers = _auth_headers()
    document = {
        "layers": [
            {"local_id": 0, "name": "Layer 1", "filename": "layer_test_0.png", "url": "/results/layer_test_0.png", "x": 0, "y": 0, "visible": True}
        ],
        "canvas": {"width": 1024, "height": 1024},
    }
    create = client.post(
        "/api/qwen-sessions",
        data=json.dumps({
            "projectId": 1,
            "userId": 1,
            "sourceFilename": "input.png",
            "name": "Test Session",
            "document": document,
        }),
        headers=headers,
    )
    assert create.status_code == 200
    body = create.get_json()
    assert body["success"] is True
    session_id = body["session"]["id"]

    patch = client.patch(
        f"/api/qwen-sessions/{session_id}",
        data=json.dumps({"document": document}),
        headers=headers,
    )
    assert patch.status_code == 200

    get = client.get(f"/api/qwen-sessions/{session_id}", headers=headers)
    assert get.status_code == 200
    loaded = get.get_json()["session"]["document"]
    assert loaded["layers"][0]["filename"] == "layer_test_0.png"
    assert loaded["canvas"]["width"] == 1024


def test_image_layers_async_shape_sync_jobs(seeded_qwen, client, monkeypatch):
    """With RIMI_SYNC_JOBS=1 the endpoint should return jobId for polling."""
    monkeypatch.setenv("RIMI_SYNC_JOBS", "1")
    headers = _auth_headers()

    from config import UPLOAD_DIR
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    test_file = os.path.join(UPLOAD_DIR, "qwen_test_input.png")
    with open(test_file, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + b"\0" * 64)

    def fake_execute(payload, on_progress=None):
        if on_progress:
            on_progress(50, "Testing")
        return {
            "success": True,
            "layers": [{"url": "/results/layer_fake_0.png", "index": 0, "filename": "layer_fake_0.png", "x": 0, "y": 0}],
            "duration": 1.0,
            "costUsd": 0.03,
            "creditsUsed": 69,
            "creditsRemaining": 431,
            "creditsLimit": 500,
            "creditsUsedTotal": 69,
        }

    import services.qwen_layers as ql
    monkeypatch.setattr(ql, "execute_image_layers", fake_execute)

    resp = client.post(
        "/api/image-layers",
        data=json.dumps({
            "filename": "qwen_test_input.png",
            "numLayers": 4,
            "description": "auto",
            "projectId": 1,
            "userId": 1,
            "async": True,
        }),
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert "jobId" in data


def test_idempotency_hash_stable():
    from jobs import _payload_idempotency_hash
    h1 = _payload_idempotency_hash(1, "image-layers", {"filename": "a.png", "numLayers": 4, "projectId": 1})
    h2 = _payload_idempotency_hash(1, "image-layers", {"projectId": 1, "numLayers": 4, "filename": "a.png"})
    assert h1 == h2


def test_open_file_in_tool_key_map():
    """Smoke: helpers openFileInTool / openInQwenStudio exist in frontend helpers."""
    from pathlib import Path
    helpers_path = Path(__file__).resolve().parents[2] / "src" / "components" / "studio" / "shared" / "helpers.js"
    text = helpers_path.read_text(encoding="utf-8")
    assert "openFileInTool" in text
    assert "openInQwenStudio" in text
    assert "setTool('imagelayers')" in text
