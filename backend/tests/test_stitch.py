"""Stitch Styles: prompt wording, chroma-key motif path and endpoint (model stubbed)."""
import io
import os
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
from PIL import Image

from config import RESULTS_DIR, UPLOAD_DIR
from db import db
import services.stitch_render as sr
import routes.stitch as stitch_routes


def test_prompts_name_the_style_and_keep_composition():
    motif = sr.build_motif_prompt('zardozi', 'metallic', 'dense', 'follow')
    assert 'zardozi' in motif and 'metallic thread' in motif and 'dense, full coverage' in motif
    assert 'chroma green' in motif
    design = sr.build_design_prompt('satin', 'rayon', 'light', 'diagonal')
    assert 'satin stitch' in design and 'glossy rayon' in design and '45 degree' in design
    assert 'do not repeat the design' in design
    assert '@Image 1' in design


def test_style_catalogue_matches_styles():
    catalogue = sr.style_catalogue()
    assert {entry['id'] for entry in catalogue} == set(sr.STITCH_STYLES)
    assert all(entry['label'] and entry['blurb'] and entry['density'] > 0 for entry in catalogue)


def _green_matte_render(size, box, color):
    """Pretend model output: the motif area in ``color`` on the chroma green matte, with a stray green speck outside."""
    img = Image.new('RGB', size, sr.MATTE)
    for x in range(box[0], box[2]):
        for y in range(box[1], box[3]):
            img.putpixel((x, y), color)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def test_render_motif_keys_transparency_and_clips_to_silhouette(monkeypatch):
    source = Image.new('RGBA', (60, 40), (0, 0, 0, 0))
    for x in range(20, 40):
        for y in range(10, 30):
            source.putpixel((x, y), (200, 30, 30, 255))
    # Model "renders" the square as gold thread, plus a blob far away that must be clipped.
    fake = _green_matte_render((60, 40), (20, 10, 40, 30), (230, 190, 90))
    blob = Image.open(io.BytesIO(fake)).convert('RGB')
    for x in range(2, 8):
        for y in range(32, 38):
            blob.putpixel((x, y), (230, 190, 90))
    buf = io.BytesIO()
    blob.save(buf, format='PNG')
    monkeypatch.setattr(sr, 'run_model', lambda model, model_input: (buf.getvalue(), 0.5))
    monkeypatch.setattr(sr, 'remove_background_with_rmbg', lambda img: None)

    out, prompt, duration = sr.render_motif(source, 'satin', 'rayon', 'medium', 'follow')
    assert out.size == (60, 40)
    assert out.getpixel((30, 20))[3] == 255 and out.getpixel((30, 20))[:3] == (230, 190, 90)
    assert out.getpixel((50, 5))[3] == 0          # green matte keyed out
    assert out.getpixel((4, 35))[3] == 0          # stray blob clipped away
    assert 'satin stitch' in prompt


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
def _seed(conn, user_id=1, email='stitch@test.example', project_id=1, plan='Pro'):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (?, ?, ?, 'Stitch Tester', 'ST', 'user', ?, 0, 500, ?, 'active', ?)
        """,
        (user_id, email, password_hash, plan, now, now),
    )
    conn.execute(
        "INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id) VALUES (?, 'Stitch Project', 'Draft', '/d.png', '/d.png', ?, ?)",
        (project_id, now, user_id),
    )
    conn.execute(
        "INSERT INTO project_metrics (project_id, versions, versions_delta, exports, exports_delta, ai_generations, ai_generations_delta, credits_used, credits_delta) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0)",
        (project_id,),
    )
    conn.commit()


def _auth(user_id=1):
    from jwt_tokens import issue_access_token
    return {"Authorization": f"Bearer {issue_access_token(user_id, 'user')}", "Content-Type": "application/json"}


@pytest.fixture()
def seeded(app):
    with app.app_context():
        conn = db()
        try:
            _seed(conn)
        finally:
            conn.close()
    yield


@pytest.fixture()
def owned_motif(app, seeded):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"test_stitch_{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(UPLOAD_DIR, filename)
    img = Image.new('RGBA', (60, 40), (0, 0, 0, 0))
    for x in range(20, 40):
        for y in range(10, 30):
            img.putpixel((x, y), (200, 30, 30, 255))
    img.save(path, 'PNG')
    with app.app_context():
        from routes.upload import _record_user_upload
        _record_user_upload(1, filename)
    yield filename
    try:
        os.remove(path)
    except OSError:
        pass


def test_styles_endpoint(seeded, client):
    resp = client.get('/api/stitch/styles', headers=_auth())
    assert resp.status_code == 200
    body = resp.get_json()
    assert any(style['id'] == 'zardozi' for style in body['styles'])
    assert 'metallic' in body['finishes'] and 'dense' in body['densities']


def test_render_endpoint_motif_mode_saves_library_motif(seeded, owned_motif, client, monkeypatch):
    fake = _green_matte_render((60, 40), (20, 10, 40, 30), (230, 190, 90))
    monkeypatch.setattr(sr, 'run_model', lambda model, model_input: (fake, 0.4))
    monkeypatch.setattr(sr, 'remove_background_with_rmbg', lambda img: None)
    monkeypatch.setattr(stitch_routes, 'log_replicate_call', lambda *a, **k: None)

    resp = client.post('/api/stitch/render', json={
        'projectId': 1, 'sourceFilename': owned_motif, 'mode': 'motif', 'style': 'zardozi', 'finish': 'metallic', 'density': 'dense', 'direction': 'follow', 'saveToLibrary': True, 'name': 'Gold paisley',
    }, headers=_auth())
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    try:
        assert body['mode'] == 'motif' and body['style'] == 'zardozi'
        assert body['motif']['technique'] == 'embroidery'
        assert 'zardozi' in body['motif']['tags']
        with Image.open(os.path.join(RESULTS_DIR, body['filename'])) as out:
            rgba = out.convert('RGBA')
            assert rgba.getpixel((30, 20))[3] == 255
            assert rgba.getpixel((50, 5))[3] == 0
        with client.application.app_context():
            conn = db()
            try:
                used = conn.execute("SELECT credits_used FROM users WHERE id = 1").fetchone()['credits_used']
            finally:
                conn.close()
        assert used == body['creditsUsed'] > 0
    finally:
        try:
            os.remove(os.path.join(RESULTS_DIR, body['filename']))
        except OSError:
            pass


def test_render_endpoint_design_mode_and_validation(seeded, owned_motif, client, monkeypatch):
    opaque = Image.new('RGB', (48, 32), (90, 20, 40))
    buf = io.BytesIO()
    opaque.save(buf, format='PNG')
    captured = {}

    def fake_run(model, model_input):
        captured['model'] = model
        captured['input'] = model_input
        return buf.getvalue(), 0.3

    monkeypatch.setattr(sr, 'run_model', fake_run)
    monkeypatch.setattr(stitch_routes, 'log_replicate_call', lambda *a, **k: None)

    resp = client.post('/api/stitch/render', json={'projectId': 1, 'sourceFilename': owned_motif, 'mode': 'design', 'style': 'fill'}, headers=_auth())
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    try:
        assert captured['model'] == sr.DESIGN_MODEL
        assert 'image_input' in captured['input'] and captured['input']['aspect_ratio'] == '3:2'
        assert body['motif'] is None
    finally:
        try:
            os.remove(os.path.join(RESULTS_DIR, body['filename']))
        except OSError:
            pass

    assert client.post('/api/stitch/render', json={'projectId': 1, 'sourceFilename': owned_motif, 'mode': 'video'}, headers=_auth()).status_code == 400
    assert client.post('/api/stitch/render', json={'projectId': 1, 'sourceFilename': owned_motif, 'style': 'glitter'}, headers=_auth()).status_code == 400
    assert client.post('/api/stitch/render', json={'projectId': 1, 'sourceFilename': 'nope.png'}, headers=_auth()).status_code == 404
