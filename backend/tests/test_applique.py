"""Appliqué rendering, embellishment sheets and their endpoints."""
import os
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
from PIL import Image, ImageDraw

from config import RESULTS_DIR, UPLOAD_DIR
from db import db
from services.applique_render import render_applique, render_embellishment


def _circle_shape(size=80, radius=30):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    c = size // 2
    draw.ellipse((c - radius, c - radius, c + radius, c + radius), fill=(120, 120, 120, 255))
    return img


def test_applique_fills_silhouette_and_adds_satin_edge():
    shape = _circle_shape()
    out = render_applique(shape, {'kind': 'solid', 'color': '#c8283c'}, {'style': 'satin', 'color': '#f5dc78', 'width': 6}, shadow=False)
    pad = 6 + 2
    assert out.size == (80 + pad * 2, 80 + pad * 2)
    centre = out.getpixel((40 + pad, 40 + pad))
    assert centre[:3] == (0xc8, 0x28, 0x3c) and centre[3] == 255
    # Just outside the circle (radius 30) but inside the 6px ring: edge colour (or its darker groove).
    ring = out.getpixel((40 + pad + 33, 40 + pad))
    assert ring[3] == 255
    assert ring[0] > 180 and ring[2] < 130  # gold-ish, not the red fill
    # Well outside everything stays transparent.
    assert out.getpixel((2, 2))[3] == 0


def test_applique_blanket_edge_has_gaps_and_shadow_adds_alpha():
    shape = _circle_shape()
    plain = render_applique(shape, {'kind': 'solid', 'color': '#c8283c'}, {'style': 'blanket', 'color': '#f5dc78', 'width': 6}, shadow=False)
    pad = 8
    ring_pixels = [plain.getpixel((40 + pad + 33, 40 + pad + dy))[3] for dy in range(-12, 13)]
    assert 0 in ring_pixels and 255 in ring_pixels  # dashes with gaps

    shadowed = render_applique(shape, {'kind': 'solid', 'color': '#c8283c'}, {'style': 'none'}, shadow=True)
    # Below-right of the patch there is a soft shadow, above-left there is none.
    spad = 6 + 2
    # Just below the circle (radius 30) the offset shadow shows; the patch itself is transparent there.
    assert shadowed.getpixel((40 + spad + 3, 40 + spad + 32))[3] > 0
    assert shadowed.getpixel((40 + spad - 36, 40 + spad - 36))[3] == 0


def test_applique_image_fill_tiles_the_print():
    shape = _circle_shape()
    print_img = Image.new('RGBA', (10, 10), (20, 200, 20, 255))
    out = render_applique(shape, {'kind': 'image', 'scale': 0.25}, {'style': 'none'}, fill_img=print_img)
    assert out.getpixel((40 + 2, 40 + 2))[:3] == (20, 200, 20)


def test_applique_rejects_empty_shape():
    with pytest.raises(ValueError):
        render_applique(Image.new('RGBA', (20, 20), (0, 0, 0, 0)), {'kind': 'solid', 'color': '#000000'})


@pytest.mark.parametrize('kind', ['sequin', 'bead', 'mirror'])
@pytest.mark.parametrize('layout', ['scatter', 'row', 'cluster'])
def test_embellishment_sheets_draw_something_deterministically(kind, layout):
    a = render_embellishment(kind=kind, layout=layout, count=12, size=20, colors=['#e6bd5a', '#c8102e'], width=300, height=120, seed=3)
    b = render_embellishment(kind=kind, layout=layout, count=12, size=20, colors=['#e6bd5a', '#c8102e'], width=300, height=120, seed=3)
    assert a.size == (300, 120)
    alpha = a.split()[3]
    assert alpha.getbbox() is not None
    assert list(a.getdata()) == list(b.getdata())  # same seed, same sheet
    if layout == 'row':
        # A row is centred vertically: the top and bottom strips stay empty.
        assert alpha.crop((0, 0, 300, 20)).getbbox() is None
        assert alpha.crop((0, 100, 300, 120)).getbbox() is None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
def _seed_user_project(conn, user_id=1, email='app@test.example', project_id=1):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (?, ?, ?, 'App Tester', 'AT', 'user', 'Pro', 0, 100, ?, 'active', ?)
        """,
        (user_id, email, password_hash, now, now),
    )
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (?, 'App Project', 'Draft', '/demo.png', '/demo.png', ?, ?)
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
            _seed_user_project(conn, user_id=2, email='other-app@test.example', project_id=2)
        finally:
            conn.close()
    yield


@pytest.fixture()
def owned_shape(app, seeded):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"test_shape_{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(UPLOAD_DIR, filename)
    _circle_shape().save(path, 'PNG')
    with app.app_context():
        from routes.upload import _record_user_upload
        _record_user_upload(1, filename)
    yield filename
    try:
        os.remove(path)
    except OSError:
        pass


def _cleanup_result(filename):
    try:
        os.remove(os.path.join(RESULTS_DIR, filename))
    except OSError:
        pass


def test_applique_endpoint_creates_patch_and_library_motif(seeded, owned_shape, client):
    resp = client.post('/api/applique/create', json={
        'projectId': 1,
        'shapeFilename': owned_shape,
        'fill': {'kind': 'solid', 'color': '#c8283c'},
        'edge': {'style': 'satin', 'color': '#f5dc78', 'width': 5},
        'shadow': True,
        'saveToLibrary': True,
        'name': 'Rose patch',
        'tags': ['rose', 'applique'],
    }, headers=_auth_headers())
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    try:
        assert body['success'] is True
        assert body['motif']['technique'] == 'applique'
        assert body['motif']['name'] == 'Rose patch'
        assert body['creditsUsed'] >= 1
        with Image.open(os.path.join(RESULTS_DIR, body['filename'])) as out:
            assert out.mode == 'RGBA' and out.width > 80
        listed = client.get('/api/motifs?technique=applique', headers=_auth_headers()).get_json()['motifs']
        assert [m['filename'] for m in listed] == [body['filename']]
    finally:
        _cleanup_result(body['filename'])


def test_applique_endpoint_validation(seeded, owned_shape, client):
    assert client.post('/api/applique/create', json={'projectId': 1}, headers=_auth_headers()).status_code == 400
    assert client.post('/api/applique/create', json={'projectId': 1, 'shapeFilename': 'nope.png'}, headers=_auth_headers()).status_code == 404
    assert client.post('/api/applique/create', json={'projectId': 2, 'shapeFilename': owned_shape}, headers=_auth_headers(2)).status_code == 403
    assert client.post('/api/applique/create', json={'projectId': 1, 'shapeFilename': owned_shape, 'edge': {'style': 'zigzag'}}, headers=_auth_headers()).status_code == 400


def test_embellish_endpoint_generates_and_charges_one_credit(seeded, client):
    resp = client.post('/api/embellish/generate', json={
        'projectId': 1, 'kind': 'mirror', 'layout': 'row', 'count': 6, 'size': 30, 'colors': ['#c8102e'], 'width': 400, 'height': 120, 'saveToLibrary': True,
    }, headers=_auth_headers())
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    try:
        assert body['motif']['technique'] == 'embellishment'
        assert body['width'] == 400 and body['height'] == 120
        with client.application.app_context():
            conn = db()
            try:
                used = conn.execute("SELECT credits_used FROM users WHERE id = 1").fetchone()['credits_used']
            finally:
                conn.close()
        assert used == body['creditsUsed']
    finally:
        _cleanup_result(body['filename'])
    assert client.post('/api/embellish/generate', json={'projectId': 1, 'kind': 'glitter'}, headers=_auth_headers()).status_code == 400
