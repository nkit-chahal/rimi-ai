"""Placement Studio: the centre-origin render contract and the flatten endpoint."""
import os
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
from PIL import Image

from config import UPLOAD_DIR
from db import db
from services.placement_render import render_document

RED = (220, 30, 30, 255)
BLUE = (30, 30, 220, 255)
WHITE = (255, 255, 255, 255)


def _write_motif(path, width=20, height=10, split=False):
    img = Image.new('RGBA', (width, height), RED)
    if split:
        for x in range(width // 2, width):
            for y in range(height):
                img.putpixel((x, y), BLUE)
    img.save(path, 'PNG')


@pytest.fixture()
def motif_file(tmp_path):
    path = tmp_path / 'motif.png'
    _write_motif(str(path))
    return str(path)


@pytest.fixture()
def split_motif_file(tmp_path):
    path = tmp_path / 'split.png'
    _write_motif(str(path), split=True)
    return str(path)


def _resolver(*paths):
    lookup = {os.path.basename(p): p for p in paths}
    return lambda name: lookup.get(os.path.basename(name or ''))


def _doc(layers, base=None, width=200, height=100):
    return {'width': width, 'height': height, 'base': base or {'kind': 'solid', 'color': '#ffffff'}, 'layers': layers}


def test_layer_position_is_its_centre(motif_file):
    doc = _doc([{'filename': 'motif.png', 'x': 100, 'y': 50, 'scaleX': 1, 'scaleY': 1, 'angle': 0}])
    canvas, rendered = render_document(doc, _resolver(motif_file))
    assert rendered == 1
    assert canvas.size == (200, 100)
    # 20x10 motif centred at (100, 50) covers x in [90, 110) and y in [45, 55).
    assert canvas.getpixel((100, 50)) == RED
    assert canvas.getpixel((91, 46)) == RED
    assert canvas.getpixel((108, 53)) == RED
    assert canvas.getpixel((89, 50)) == WHITE
    assert canvas.getpixel((111, 50)) == WHITE
    assert canvas.getpixel((100, 44)) == WHITE
    assert canvas.getpixel((10, 10)) == WHITE


def test_scale_multiplies_source_pixels(motif_file):
    doc = _doc([{'filename': 'motif.png', 'x': 100, 'y': 50, 'scaleX': 2, 'scaleY': 3}])
    canvas, _ = render_document(doc, _resolver(motif_file))
    # 40x30 footprint: x in [80, 120), y in [35, 65).
    assert canvas.getpixel((81, 36)) == RED
    assert canvas.getpixel((118, 63)) == RED
    assert canvas.getpixel((78, 50)) == WHITE
    assert canvas.getpixel((100, 33)) == WHITE


def test_rotation_is_clockwise_about_the_centre(motif_file):
    doc = _doc([{'filename': 'motif.png', 'x': 100, 'y': 50, 'angle': 90}])
    canvas, _ = render_document(doc, _resolver(motif_file))
    # A 20x10 motif turned 90 degrees stands 10 wide and 20 tall around the same centre.
    assert canvas.getpixel((100, 58)) == RED
    assert canvas.getpixel((100, 42)) == RED
    assert canvas.getpixel((108, 50)) == WHITE
    assert canvas.getpixel((92, 50)) == WHITE


def test_flip_is_applied_before_placement(split_motif_file):
    plain = render_document(_doc([{'filename': 'split.png', 'x': 100, 'y': 50}]), _resolver(split_motif_file))[0]
    flipped = render_document(_doc([{'filename': 'split.png', 'x': 100, 'y': 50, 'flipX': True}]), _resolver(split_motif_file))[0]
    assert plain.getpixel((92, 50)) == RED and plain.getpixel((108, 50)) == BLUE
    assert flipped.getpixel((92, 50)) == BLUE and flipped.getpixel((108, 50)) == RED


def test_opacity_blends_with_the_base(motif_file):
    doc = _doc([{'filename': 'motif.png', 'x': 100, 'y': 50, 'opacity': 0.5}])
    canvas, _ = render_document(doc, _resolver(motif_file))
    r, g, b, a = canvas.getpixel((100, 50))
    assert a == 255
    assert abs(r - 237) <= 3 and abs(g - 143) <= 3 and abs(b - 143) <= 3


def test_hidden_and_missing_layers_are_skipped_and_partial_offsets_clip(motif_file):
    doc = _doc([
        {'filename': 'motif.png', 'x': 100, 'y': 50, 'visible': False},
        {'filename': 'missing.png', 'x': 100, 'y': 50},
        {'filename': 'motif.png', 'x': 2, 'y': 2},  # mostly outside the canvas
    ])
    canvas, rendered = render_document(doc, _resolver(motif_file))
    assert rendered == 1
    assert canvas.getpixel((100, 50)) == WHITE
    assert canvas.getpixel((0, 0)) == RED


def test_swatch_base_darkens_edges_and_image_base_fills(tmp_path):
    canvas, _ = render_document(_doc([], base={'kind': 'swatch', 'color': '#5b1a2b'}), _resolver())
    centre = canvas.getpixel((100, 50))
    corner = canvas.getpixel((0, 0))
    assert centre[:3] == (0x5b, 0x1a, 0x2b)
    assert sum(corner[:3]) < sum(centre[:3])

    base_path = tmp_path / 'base.png'
    Image.new('RGBA', (400, 200), BLUE).save(str(base_path), 'PNG')
    canvas, _ = render_document(_doc([], base={'kind': 'image', 'filename': 'base.png'}), _resolver(str(base_path)))
    assert canvas.getpixel((5, 5)) == BLUE


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
def _seed_user_project(conn, user_id=1, email='place@test.example', project_id=1, credits_limit=100):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (?, ?, ?, 'Place Tester', 'PT', 'user', 'Pro', 0, ?, ?, 'active', ?)
        """,
        (user_id, email, password_hash, credits_limit, now, now),
    )
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (?, 'Place Project', 'Draft', '/demo.png', '/demo.png', ?, ?)
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
            _seed_user_project(conn, user_id=2, email='other-place@test.example', project_id=2)
        finally:
            conn.close()
    yield


@pytest.fixture()
def owned_motif(app, seeded):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"test_place_{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(UPLOAD_DIR, filename)
    _write_motif(path)
    with app.app_context():
        from routes.upload import _record_user_upload
        _record_user_upload(1, filename)
    yield filename
    try:
        os.remove(path)
    except OSError:
        pass


def test_compose_endpoint_renders_charges_and_records_export(seeded, owned_motif, client):
    from config import RESULTS_DIR
    payload = {
        'projectId': 1,
        'document': {
            'width': 200, 'height': 100,
            'base': {'kind': 'solid', 'color': '#ffffff'},
            'layers': [{'filename': owned_motif, 'x': 100, 'y': 50, 'scaleX': 1, 'scaleY': 1, 'angle': 0}],
        },
    }
    resp = client.post('/api/placement/compose', json=payload, headers=_auth_headers())
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body['success'] is True
    assert body['width'] == 200 and body['height'] == 100
    assert body['layersRendered'] == 1
    assert body['creditsUsed'] >= 1
    assert body['fileAccessToken']

    result_path = os.path.join(RESULTS_DIR, body['filename'])
    try:
        with Image.open(result_path) as out:
            assert out.size == (200, 100)
            assert out.convert('RGBA').getpixel((100, 50)) == RED
    finally:
        try:
            os.remove(result_path)
        except OSError:
            pass

    with client.application.app_context():
        conn = db()
        try:
            row = conn.execute("SELECT credits_used FROM users WHERE id = 1").fetchone()
            export = conn.execute("SELECT tool_type FROM exports WHERE filename = ?", (body['filename'],)).fetchone()
        finally:
            conn.close()
    assert row['credits_used'] == body['creditsUsed']
    assert export['tool_type'] == 'Placement Studio'


def test_compose_endpoint_validates_ownership_and_shape(seeded, owned_motif, client):
    good_layer = {'filename': owned_motif, 'x': 10, 'y': 10}
    # Another user cannot flatten with a file they do not own.
    resp = client.post('/api/placement/compose', json={'projectId': 2, 'document': {'width': 200, 'height': 100, 'layers': [good_layer]}}, headers=_auth_headers(2))
    assert resp.status_code == 400
    assert 'access' in resp.get_json()['error']
    # Missing file, empty layers, absurd size.
    assert client.post('/api/placement/compose', json={'projectId': 1, 'document': {'width': 200, 'height': 100, 'layers': [{'filename': 'nope.png'}]}}, headers=_auth_headers()).status_code == 400
    assert client.post('/api/placement/compose', json={'projectId': 1, 'document': {'width': 200, 'height': 100, 'layers': []}}, headers=_auth_headers()).status_code == 400
    assert client.post('/api/placement/compose', json={'projectId': 1, 'document': {'width': 99999, 'height': 100, 'layers': [good_layer]}}, headers=_auth_headers()).status_code == 400
    assert client.post('/api/placement/compose', json={'document': {'width': 200, 'height': 100, 'layers': [good_layer]}}, headers=_auth_headers()).status_code == 400
