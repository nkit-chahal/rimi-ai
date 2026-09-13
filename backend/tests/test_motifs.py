"""Motif Library catalogue: register owned files as motifs, list, edit, soft delete."""
import os
import uuid
from datetime import datetime, timezone

import bcrypt
import pytest
from PIL import Image

from config import UPLOAD_DIR
from db import db


def _seed_user_project(conn, user_id=1, email='motif@test.example', project_id=1):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (?, ?, ?, 'Motif Tester', 'MT', 'user', 'Pro', 0, 500, ?, 'active', ?)
        """,
        (user_id, email, password_hash, now, now),
    )
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (?, 'Motif Project', 'Draft', '/demo.png', '/demo.png', ?, ?)
        """,
        (project_id, now, user_id),
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
            _seed_user_project(conn, user_id=2, email='other-motif@test.example', project_id=2)
        finally:
            conn.close()
    yield


@pytest.fixture()
def owned_upload(app, seeded):
    """A small RGBA PNG in the uploads folder, recorded as owned by user 1."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"test_motif_{uuid.uuid4().hex[:8]}.png"
    path = os.path.join(UPLOAD_DIR, filename)
    Image.new('RGBA', (48, 32), (200, 40, 80, 255)).save(path, 'PNG')
    with app.app_context():
        from routes.upload import _record_user_upload
        _record_user_upload(1, filename)
    yield filename
    try:
        os.remove(path)
    except OSError:
        pass


def test_register_list_update_and_soft_delete(seeded, owned_upload, client):
    created = client.post(
        '/api/motifs',
        json={'filename': owned_upload, 'name': 'Paisley border', 'technique': 'zari', 'tags': ['Border', 'paisley', 'border'], 'projectId': 1},
        headers=_auth_headers(),
    )
    assert created.status_code == 200, created.get_json()
    motif = created.get_json()['motif']
    assert motif['technique'] == 'zari'
    assert motif['tags'] == ['border', 'paisley']
    assert motif['width'] == 48 and motif['height'] == 32
    assert motif['url'] == f'/uploads/{owned_upload}'
    assert motif['fileAccessToken']

    listed = client.get('/api/motifs', headers=_auth_headers()).get_json()
    assert [m['id'] for m in listed['motifs']] == [motif['id']]
    assert 'zari' in listed['techniques']
    assert client.get('/api/motifs?technique=lace', headers=_auth_headers()).get_json()['motifs'] == []
    assert len(client.get('/api/motifs?q=pais', headers=_auth_headers()).get_json()['motifs']) == 1

    # Other users never see it.
    assert client.get('/api/motifs', headers=_auth_headers(2)).get_json()['motifs'] == []

    updated = client.patch(f"/api/motifs/{motif['id']}", json={'name': 'Paisley pallu', 'technique': 'embroidery', 'tags': 'pallu, gold'}, headers=_auth_headers())
    assert updated.status_code == 200
    assert updated.get_json()['motif']['name'] == 'Paisley pallu'
    assert updated.get_json()['motif']['tags'] == ['pallu', 'gold']
    assert client.patch(f"/api/motifs/{motif['id']}", json={'technique': 'knitting'}, headers=_auth_headers()).status_code == 400
    assert client.patch(f"/api/motifs/{motif['id']}", json={'name': 'x'}, headers=_auth_headers(2)).status_code == 404

    assert client.delete(f"/api/motifs/{motif['id']}", headers=_auth_headers(2)).status_code == 404
    assert client.delete(f"/api/motifs/{motif['id']}", headers=_auth_headers()).status_code == 200
    assert client.get('/api/motifs', headers=_auth_headers()).get_json()['motifs'] == []
    assert client.delete(f"/api/motifs/{motif['id']}", headers=_auth_headers()).status_code == 404


def test_register_rejects_missing_or_foreign_files(seeded, owned_upload, client):
    assert client.post('/api/motifs', json={'filename': 'does-not-exist.png'}, headers=_auth_headers()).status_code == 404
    assert client.post('/api/motifs', json={}, headers=_auth_headers()).status_code == 400
    # user 2 does not own the upload
    assert client.post('/api/motifs', json={'filename': owned_upload}, headers=_auth_headers(2)).status_code == 403
    assert client.post('/api/motifs', json={'filename': owned_upload, 'technique': 'knitting'}, headers=_auth_headers()).status_code == 400
