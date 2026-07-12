"""Tests for Normal vs Pro plan tiers and credit helpers."""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from plan_tiers import (
    credits_from_usd,
    flux2_pro_credits,
    is_pro_plan,
    model_allowed_for_tool,
    require_pro_or_error,
    require_model_or_error,
    tier_label,
    attach_tier_fields,
)


def test_credits_from_usd_exact_panels():
    assert credits_from_usd(0.012) == 14
    assert credits_from_usd(0.047) == 55
    assert credits_from_usd(0.128) == 148
    assert credits_from_usd(0.06) == 69
    assert credits_from_usd(0.030) == 35
    assert credits_from_usd(0.045) == 52


def test_flux2_pro_credits():
    assert flux2_pro_credits(has_reference=False) == 35
    assert flux2_pro_credits(has_reference=True) == 52


def test_is_pro_plan_matrix():
    assert is_pro_plan("Pro") is True
    assert is_pro_plan("SCALE") is True
    assert is_pro_plan("Business Studio") is True
    assert is_pro_plan("Enterprise Pro") is True
    assert is_pro_plan("Business Pro") is True
    assert is_pro_plan("Free Trial") is False
    assert is_pro_plan("Starter") is False
    assert is_pro_plan("Creator") is False
    assert is_pro_plan("Basic") is False
    assert is_pro_plan(None) is False
    assert tier_label("Pro") == "pro"
    assert tier_label("Starter") == "normal"


def test_attach_tier_fields():
    payload = attach_tier_fields({"id": 1, "plan": "Pro"})
    assert payload["isPro"] is True
    assert payload["tier"] == "pro"
    payload2 = attach_tier_fields({"id": 2, "plan": "Free Trial"})
    assert payload2["isPro"] is False
    assert payload2["tier"] == "normal"


def test_model_allowed_inspire_extract():
    assert model_allowed_for_tool("Free Trial", "google/nano-banana", "inspire") is True
    assert model_allowed_for_tool("Free Trial", "openai/gpt-image-2", "inspire") is False
    assert model_allowed_for_tool("Pro", "openai/gpt-image-2", "inspire") is True
    assert model_allowed_for_tool("Starter", "google/nano-banana-2", "extract") is False
    assert model_allowed_for_tool("Scale", "google/nano-banana-2", "extract") is True
    assert model_allowed_for_tool("Creator", "black-forest-labs/flux-schnell", "extract") is True


def test_require_helpers_without_app_context_json():
    from flask import Flask
    app = Flask(__name__)
    with app.app_context():
        ok, body, code = require_pro_or_error("Free Trial", "Qwen")
        assert ok is False
        assert code == 403
        ok2, _, _ = require_pro_or_error("Pro", "Qwen")
        assert ok2 is True

        ok3, _, code3 = require_model_or_error("Starter", "openai/gpt-image-2", "inspire")
        assert ok3 is False
        assert code3 == 403
        ok4, _, _ = require_model_or_error("Pro", "openai/gpt-image-2", "inspire")
        assert ok4 is True


def test_formula_matches_ceil():
    for usd in (0.012, 0.047, 0.128, 0.06, 0.03, 0.045):
        assert credits_from_usd(usd) == int(math.ceil(usd * 1150))


def _seed_user(conn, user_id, email, plan, credits_limit=50000):
    from datetime import datetime, timezone
    import bcrypt

    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (?, ?, ?, ?, 'U', 'user', ?, 0, ?, ?, 'active', ?)
        """,
        (user_id, email, pw, f"User {user_id}", plan, credits_limit, now, now),
    )
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (?, 'Test', 'Draft', '', '', ?, ?)
        """,
        (user_id, now, user_id),
    )
    conn.execute(
        """
        INSERT INTO project_metrics (project_id, versions, versions_delta, exports, exports_delta, ai_generations, ai_generations_delta, credits_used, credits_delta)
        VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0)
        """,
        (user_id,),
    )


def _login(client, email):
    resp = client.post("/api/login", json={"email": email, "password": "Test@12345"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert "isPro" in data["user"]
    return data["token"], data["user"]


def test_login_exposes_is_pro(client, app):
    with app.app_context():
        from db import db
        conn = db()
        _seed_user(conn, 1, "normal@test.example", "Starter")
        _seed_user(conn, 2, "pro@test.example", "Pro")
        conn.commit()
        conn.close()

    _, normal = _login(client, "normal@test.example")
    assert normal["isPro"] is False
    assert normal["tier"] == "normal"

    _, pro = _login(client, "pro@test.example")
    assert pro["isPro"] is True
    assert pro["tier"] == "pro"


def test_normal_403_on_pro_extract_model(client, app):
    with app.app_context():
        from db import db
        from config import UPLOAD_DIR
        conn = db()
        _seed_user(conn, 1, "normal-extract@test.example", "Creator")
        conn.commit()
        conn.close()
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        sample = os.path.join(UPLOAD_DIR, "tier_test.png")
        with open(sample, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)

    token, user = _login(client, "normal-extract@test.example")
    assert user["isPro"] is False

    resp = client.post(
        "/api/extract-design-single",
        json={"filename": "tier_test.png", "projectId": 1, "modelId": "google/nano-banana-2"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert resp.get_json().get("requiresPro") is True


def test_pro_allowed_extract_model_passes_tier_gate(client, app, monkeypatch):
    with app.app_context():
        from db import db
        from config import UPLOAD_DIR
        conn = db()
        _seed_user(conn, 1, "pro-extract@test.example", "Pro")
        conn.commit()
        conn.close()
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        sample = os.path.join(UPLOAD_DIR, "tier_pro.png")
        with open(sample, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)

    monkeypatch.setattr(
        "routes.generation._run_single_extract",
        lambda *a, **k: {
            "modelId": "google/nano-banana-2",
            "modelName": "Nano Banana 2",
            "resultUrl": "/results/fake.png",
            "duration": 0.1,
            "creditsUsed": 78,
            "error": None,
        },
    )
    monkeypatch.setattr("routes.generation.adjust_reserved_credits", lambda *a, **k: None)
    monkeypatch.setattr("routes.generation.reserve_credits_or_error", lambda *a, **k: (True, None))
    monkeypatch.setattr(
        "routes.generation.get_updated_credits",
        lambda *a, **k: {"creditsUsed": 78, "creditsLimit": 50000},
    )

    token, user = _login(client, "pro-extract@test.example")
    assert user["isPro"] is True

    resp = client.post(
        "/api/extract-design-single",
        json={"filename": "tier_pro.png", "projectId": 1, "modelId": "google/nano-banana-2"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.get_json().get("success") is True


def test_normal_403_on_image_layers(client, app):
    with app.app_context():
        from db import db
        conn = db()
        _seed_user(conn, 1, "normal-layers@test.example", "Starter")
        conn.commit()
        conn.close()

    token, _ = _login(client, "normal-layers@test.example")
    resp = client.post(
        "/api/image-layers",
        json={"filename": "x.png", "projectId": 1, "numLayers": 3},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert resp.get_json().get("requiresPro") is True


def test_normal_403_on_mockups(client, app):
    with app.app_context():
        from db import db
        conn = db()
        _seed_user(conn, 1, "normal-mock@test.example", "Free Trial")
        conn.commit()
        conn.close()

    token, _ = _login(client, "normal-mock@test.example")
    resp = client.post(
        "/api/generate-mockup",
        json={"patternFilename": "x.png", "productType": "tshirt", "projectId": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert resp.get_json().get("requiresPro") is True
