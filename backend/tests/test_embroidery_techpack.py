"""Embroidery tech pack: unit conversion, stitch estimates and the PDF endpoint."""
import os
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
from PIL import Image

from config import RESULTS_DIR, UPLOAD_DIR
from db import db
from routes.embroidery_techpack import summarize_layers
from services.embroidery_techpack import build_embroidery_tech_pack, estimate_stitches


def test_estimate_scales_with_area_style_and_density():
    assert estimate_stitches(10, 'satin', 'medium') == 9000
    assert estimate_stitches(10, 'fill', 'medium') == 12000
    assert estimate_stitches(10, 'satin', 'dense') == 12600
    assert estimate_stitches(10, 'kantha', 'light') == 1400
    assert estimate_stitches(-5, 'satin', 'medium') == 0


def test_summarize_layers_converts_to_cm_with_rotation_and_coverage(tmp_path):
    motif = tmp_path / 'm.png'
    img = Image.new('RGBA', (100, 50), (0, 0, 0, 0))
    for x in range(50):
        for y in range(50):
            img.putpixel((x, y), (200, 0, 0, 255))   # left half opaque -> coverage 0.5
    img.save(str(motif), 'PNG')
    resolver = lambda name: str(motif) if name == 'm.png' else None

    layers = [{'name': 'Border', 'filename': 'm.png', 'x': 1000, 'y': 500, 'width': 100, 'height': 50, 'scaleX': 2, 'scaleY': 2, 'angle': 90, 'stitchStyle': 'fill', 'density': 'dense'}]
    summary, px_per_cm = summarize_layers(layers, doc_width_px=2000, physical_width_cm=40, resolve_path=resolver)
    assert px_per_cm == 50
    row = summary[0]
    assert row['x_cm'] == 20 and row['y_cm'] == 10
    # 200 x 100 px footprint rotated 90 degrees -> 100 x 200 px -> 2 x 4 cm
    assert abs(row['w_cm'] - 2) < 1e-6 and abs(row['h_cm'] - 4) < 1e-6
    assert row['coverage'] == 0.5
    # area = 200*100*0.5 px² = 10000 px² = 4 cm² -> fill dense = 4 * 1200 * 1.4
    assert row['stitches'] == 6720


def test_pdf_builds_with_threads_and_many_layers(tmp_path):
    design = tmp_path / 'design.png'
    Image.new('RGB', (400, 300), (250, 240, 230)).save(str(design), 'PNG')
    out = tmp_path / 'pack.pdf'
    layers = [{'name': f'Motif {i}', 'x_cm': i, 'y_cm': 2, 'w_cm': 3, 'h_cm': 2, 'angle': 0, 'stitch_style': 'satin', 'density': 'medium', 'stitches': 1200, 'coverage': 0.6} for i in range(30)]
    threads = [{'code': 'T-015', 'name': 'Scarlet', 'hex': '#c8102e', 'deltaE': 0.4, 'sourceHex': '#c9102f'}]
    build_embroidery_tech_pack(str(out), {
        'title': 'Saree pallu', 'project_name': 'Test', 'company': 'Studio', 'design_path': str(design),
        'doc_width_px': 400, 'doc_height_px': 300, 'physical_width_cm': 40, 'px_per_cm': 10,
        'product': 'Saree', 'zone': 'pallu', 'technique': 'zari', 'fabric': 'silk', 'base': 'print',
        'layers': layers, 'threads': threads, 'notes': 'Line one\nLine two',
    })
    data = out.read_bytes()
    assert data.startswith(b'%PDF')
    assert data.count(b'/Type /Page') >= 4  # overview, placement (spills), threads, notes


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
def _seed(conn, user_id=1, email='tp@test.example', project_id=1):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (?, ?, ?, 'TP Tester', 'TP', 'user', 'Pro', 0, 100, ?, 'active', ?)
        """,
        (user_id, email, password_hash, now, now),
    )
    conn.execute(
        "INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id) VALUES (?, 'Pallu Project', 'Draft', '/d.png', '/d.png', ?, ?)",
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
            _seed(conn, user_id=2, email='other-tp@test.example', project_id=2)
        finally:
            conn.close()
    yield


@pytest.fixture()
def owned_design(app, seeded):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"test_tpdesign_{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(UPLOAD_DIR, filename)
    Image.new('RGB', (200, 100), (240, 230, 220)).save(path, 'PNG')
    with app.app_context():
        from routes.upload import _record_user_upload
        _record_user_upload(1, filename)
    yield filename
    try:
        os.remove(path)
    except OSError:
        pass


def test_techpack_endpoint_generates_pdf_and_summary(seeded, owned_design, client):
    resp = client.post('/api/techpack/embroidery', json={
        'projectId': 1,
        'designFilename': owned_design,
        'physicalWidthCm': 20,
        'product': 'Saree', 'zone': 'pallu', 'technique': 'zari', 'fabric': 'silk', 'base': 'Maroon velvet',
        'layers': [{'name': 'Paisley', 'filename': owned_design, 'x': 100, 'y': 50, 'width': 200, 'height': 100, 'scaleX': 0.5, 'scaleY': 0.5, 'angle': 0, 'stitchStyle': 'zardozi', 'density': 'medium'}],
        'threads': [{'code': 'T-006', 'name': 'Zari Gold', 'hex': '#b8860b', 'deltaE': 1.1, 'sourceHex': '#b98a10'}],
        'threadCard': 'Starter thread card (demo)',
        'notes': 'Sample before bulk.',
    }, headers=_auth())
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    try:
        assert body['filename'].endswith('.pdf')
        assert body['summary']['pxPerCm'] == 10
        assert body['summary']['physicalHeightCm'] == 10
        layer = body['summary']['layers'][0]
        assert layer['x_cm'] == 10 and layer['w_cm'] == 10 and layer['h_cm'] == 5
        assert layer['coverage'] == 1.0
        assert layer['stitches'] == 35000  # 10 x 5 cm x 700 stitches/cm² (zardozi, medium)
        assert body['summary']['totalStitches'] == 35000
        pdf_path = os.path.join(RESULTS_DIR, body['filename'])
        assert open(pdf_path, 'rb').read(4) == b'%PDF'
        with client.application.app_context():
            conn = db()
            try:
                used = conn.execute("SELECT credits_used FROM users WHERE id = 1").fetchone()['credits_used']
                export = conn.execute("SELECT tool_type FROM exports WHERE filename = ?", (body['filename'],)).fetchone()
            finally:
                conn.close()
        assert used == body['creditsUsed'] > 0
        assert export['tool_type'] == 'Embroidery Tech Pack'
    finally:
        try:
            os.remove(os.path.join(RESULTS_DIR, body['filename']))
        except OSError:
            pass


def test_techpack_endpoint_validation(seeded, owned_design, client):
    assert client.post('/api/techpack/embroidery', json={'projectId': 1, 'designFilename': 'nope.png'}, headers=_auth()).status_code == 404
    assert client.post('/api/techpack/embroidery', json={'projectId': 2, 'designFilename': owned_design}, headers=_auth(2)).status_code == 403
    assert client.post('/api/techpack/embroidery', json={'projectId': 1, 'physicalWidthCm': 0}, headers=_auth()).status_code == 400
