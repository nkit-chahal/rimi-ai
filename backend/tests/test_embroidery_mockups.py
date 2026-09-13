"""Embroidery Mockups: placement-aware prompt and endpoint (model calls are stubbed)."""
import os
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
from PIL import Image

from config import RESULTS_DIR, UPLOAD_DIR
from db import db
import routes.embroidery_mockups as emb


def test_prompt_is_zone_specific_and_not_all_over():
    prompt = emb.build_prompt('saree', 'pallu', 'zari', 'silk', 'studio', 'editorial', 'gold paisleys on maroon', 'keep it regal')
    assert 'on the pallu of the product only' in prompt
    assert 'Do NOT repeat it as an all-over print' in prompt
    assert 'zari embroidery' in prompt
    assert 'saree' in prompt.lower()
    assert 'stays plain silk' in prompt
    assert prompt.endswith('Art direction: keep it regal')
    assert 'seamless repeating print' not in prompt


def _seed_user_project(conn, user_id=1, email='mock@test.example', project_id=1, plan='Pro'):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (?, ?, ?, 'Mock Tester', 'MK', 'user', ?, 0, 500, ?, 'active', ?)
        """,
        (user_id, email, password_hash, plan, now, now),
    )
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (?, 'Mock Project', 'Draft', '/demo.png', '/demo.png', ?, ?)
        """,
        (project_id, now, user_id),
    )
    conn.execute(
        """
        INSERT INTO project_metrics (project_id, versions, versions_delta, exports, exports_delta, ai_generations, ai_generations_delta, credits_used, credits_delta)
        VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0)
        """,
        (project_id,),
    )
    conn.commit()


def _auth_headers(user_id=1):
    from jwt_tokens import issue_access_token
    token = issue_access_token(user_id, "user")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture()
def seeded(app):
    with app.app_context():
        conn = db()
        try:
            _seed_user_project(conn)
            _seed_user_project(conn, user_id=2, email='basic@test.example', project_id=2, plan='Basic')
        finally:
            conn.close()
    yield


@pytest.fixture()
def owned_source(app, seeded):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"test_embsrc_{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(UPLOAD_DIR, filename)
    Image.new('RGBA', (64, 64), (120, 20, 40, 255)).save(path, 'PNG')
    with app.app_context():
        from routes.upload import _record_user_upload
        _record_user_upload(1, filename)
    yield filename
    try:
        os.remove(path)
    except OSError:
        pass


@pytest.fixture()
def stubbed_model(monkeypatch, tmp_path):
    """Stub Groq, Replicate and the download so no network is used."""
    calls = {}

    class _Msg:
        content = 'gold paisleys with green leaves on a maroon base'

    class _Choice:
        message = _Msg()

    class _Completion:
        choices = [_Choice()]

    class _Completions:
        @staticmethod
        def create(**kwargs):
            return _Completion()

    class _Chat:
        completions = _Completions()

    class _Groq:
        chat = _Chat()

    monkeypatch.setattr(emb, 'groq_client', _Groq())

    def fake_run(model, input):
        calls['model'] = model
        calls['prompt'] = input['prompt']
        return ['https://example.invalid/mock.png']

    monkeypatch.setattr(emb.replicate, 'run', fake_run)
    fake_png = tmp_path / 'mock.png'
    Image.new('RGB', (32, 32), (10, 10, 10)).save(str(fake_png), 'PNG')
    monkeypatch.setattr(emb, 'safe_fetch_url', lambda url, timeout=120: fake_png.read_bytes())
    monkeypatch.setattr(emb, 'log_replicate_call', lambda *args, **kwargs: None)
    return calls


def test_mockup_endpoint_generates_with_zone_prompt(seeded, owned_source, stubbed_model, client):
    resp = client.post('/api/embroidery/mockup', json={
        'projectId': 1,
        'sourceFilename': owned_source,
        'productType': 'saree',
        'zone': 'pallu',
        'technique': 'zari',
        'fabric': 'silk',
    }, headers=_auth_headers())
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    try:
        assert body['success'] is True
        assert body['zone'] == 'pallu' and body['technique'] == 'zari'
        assert stubbed_model['model'] == emb.MODEL_ID
        assert 'on the pallu of the product only' in stubbed_model['prompt']
        assert 'gold paisleys' in stubbed_model['prompt']
        assert os.path.exists(os.path.join(RESULTS_DIR, body['filename']))
        with client.application.app_context():
            conn = db()
            try:
                used = conn.execute("SELECT credits_used FROM users WHERE id = 1").fetchone()['credits_used']
                export = conn.execute("SELECT tool_type FROM exports WHERE filename = ?", (body['filename'],)).fetchone()
            finally:
                conn.close()
        assert used == body['creditsUsed'] > 0
        assert export['tool_type'] == 'Embroidery Mockup'
    finally:
        try:
            os.remove(os.path.join(RESULTS_DIR, body['filename']))
        except OSError:
            pass


def test_mockup_endpoint_validation_and_pro_gate(seeded, owned_source, stubbed_model, client):
    good = {'projectId': 1, 'sourceFilename': owned_source, 'productType': 'saree', 'zone': 'pallu', 'technique': 'thread', 'fabric': 'cotton'}
    assert client.post('/api/embroidery/mockup', json={**good, 'productType': 'spaceship'}, headers=_auth_headers()).status_code == 400
    assert client.post('/api/embroidery/mockup', json={**good, 'zone': ''}, headers=_auth_headers()).status_code == 400
    assert client.post('/api/embroidery/mockup', json={**good, 'technique': 'laser'}, headers=_auth_headers()).status_code == 400
    assert client.post('/api/embroidery/mockup', json={**good, 'sourceFilename': 'missing.png'}, headers=_auth_headers()).status_code == 404
    # Basic plan is gated like Mappings.
    basic = client.post('/api/embroidery/mockup', json={**good, 'projectId': 2}, headers=_auth_headers(2))
    assert basic.status_code in (402, 403)
