"""Shade cards (Pantone / thread) matching and per-project thread palettes."""
from datetime import datetime, timezone

import bcrypt
import pytest

from db import db


def _seed_user_project(conn, user_id=1, email='threads@test.example', project_id=1):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    password_hash = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    conn.execute(
        """
        INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
        VALUES (?, ?, ?, 'Thread Tester', 'TT', 'user', 'Pro', 0, 500, ?, 'active', ?)
        """,
        (user_id, email, password_hash, now, now),
    )
    conn.execute(
        """
        INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
        VALUES (?, 'Thread Project', 'Draft', '/demo.png', '/demo.png', ?, ?)
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
            _seed_user_project(conn, user_id=2, email='other@test.example', project_id=2)
        finally:
            conn.close()
    yield


def test_requires_auth(client):
    assert client.get('/api/shade-cards').status_code == 401


def test_lists_builtin_cards(seeded, client):
    resp = client.get('/api/shade-cards', headers=_auth_headers())
    assert resp.status_code == 200
    cards = {card['id']: card for card in resp.get_json()['cards']}
    assert cards['pantone-tcx']['kind'] == 'pantone'
    assert cards['pantone-tcx']['count'] > 300
    assert cards['starter-threads']['kind'] == 'thread'
    assert cards['starter-threads']['builtIn'] is True
    assert cards['starter-threads']['count'] >= 40


def test_card_detail_normalizes_codes(seeded, client):
    resp = client.get('/api/shade-cards/pantone-tcx', headers=_auth_headers())
    assert resp.status_code == 200
    entries = resp.get_json()['card']['entries']
    first = entries[0]
    assert first['code'] == '11-0601'
    assert first['name'] == 'Bright White'
    assert first['hex'].startswith('#') and len(first['hex']) == 7


def test_match_finds_exact_thread_and_orders_by_distance(seeded, client):
    resp = client.post(
        '/api/shade-cards/match',
        json={'cardId': 'starter-threads', 'colors': ['#c8102e', 'B8860B', 'not-a-colour'], 'topN': 3},
        headers=_auth_headers(),
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['cardName'] == 'Starter thread card (demo)'
    scarlet, zari, bad = body['results']
    assert scarlet['matches'][0]['code'] == 'T-015'
    assert scarlet['matches'][0]['deltaE'] == 0
    assert len(scarlet['matches']) == 3
    assert scarlet['matches'][0]['deltaE'] <= scarlet['matches'][1]['deltaE'] <= scarlet['matches'][2]['deltaE']
    assert zari['hex'] == '#b8860b'
    assert zari['matches'][0]['code'] == 'T-006'
    assert bad['matches'] == [] and bad['error']


def test_match_validation(seeded, client):
    assert client.post('/api/shade-cards/match', json={'colors': []}, headers=_auth_headers()).status_code == 400
    assert client.post('/api/shade-cards/match', json={'colors': ['#ffffff'], 'cardId': 'nope'}, headers=_auth_headers()).status_code == 404


def test_custom_card_lifecycle_is_private_to_owner(seeded, client):
    created = client.post(
        '/api/shade-cards',
        json={
            'name': 'Supplier card',
            'brand': 'Supplier',
            'kind': 'thread',
            'entries': [
                {'code': '101', 'name': 'Snow', 'hex': '#FFFFFF'},
                {'code': '202', 'name': 'Marigold', 'hex': 'f5b400'},
            ],
        },
        headers=_auth_headers(),
    )
    assert created.status_code == 200
    card = created.get_json()['card']
    assert card['id'].startswith('custom-')
    assert card['entries'][1]['hex'] == '#f5b400'

    listed = {c['id'] for c in client.get('/api/shade-cards', headers=_auth_headers()).get_json()['cards']}
    assert card['id'] in listed

    # Another user cannot see or match against it.
    other_listed = {c['id'] for c in client.get('/api/shade-cards', headers=_auth_headers(2)).get_json()['cards']}
    assert card['id'] not in other_listed
    assert client.post('/api/shade-cards/match', json={'cardId': card['id'], 'colors': ['#ffffff']}, headers=_auth_headers(2)).status_code == 404

    match = client.post('/api/shade-cards/match', json={'cardId': card['id'], 'colors': ['#fefefe']}, headers=_auth_headers())
    assert match.get_json()['results'][0]['matches'][0]['code'] == '101'

    assert client.delete(f"/api/shade-cards/{card['id']}", headers=_auth_headers(2)).status_code == 404
    assert client.delete(f"/api/shade-cards/{card['id']}", headers=_auth_headers()).status_code == 200
    assert client.get(f"/api/shade-cards/{card['id']}", headers=_auth_headers()).status_code == 404
    assert client.delete('/api/shade-cards/pantone-tcx', headers=_auth_headers()).status_code == 400


def test_custom_card_rejects_bad_entries(seeded, client):
    bad_hex = client.post('/api/shade-cards', json={'name': 'x', 'entries': [{'code': '1', 'hex': '#12'}]}, headers=_auth_headers())
    assert bad_hex.status_code == 400
    duplicate = client.post(
        '/api/shade-cards',
        json={'name': 'x', 'entries': [{'code': '1', 'hex': '#111111'}, {'code': '1', 'hex': '#222222'}]},
        headers=_auth_headers(),
    )
    assert duplicate.status_code == 400
    assert client.post('/api/shade-cards', json={'entries': [{'code': '1', 'hex': '#111111'}]}, headers=_auth_headers()).status_code == 400


def test_thread_palette_save_list_delete(seeded, client):
    created = client.post(
        '/api/thread-palettes',
        json={
            'projectId': 1,
            'name': 'Saree border',
            'cardId': 'starter-threads',
            'entries': [
                {'sourceHex': '#c9102f', 'code': 'T-015', 'name': 'Scarlet', 'hex': '#c8102e', 'deltaE': 0.4},
                {'sourceHex': '#b98a10', 'code': 'T-006', 'name': 'Zari Gold', 'hex': '#b8860b', 'deltaE': 1.1},
            ],
        },
        headers=_auth_headers(),
    )
    assert created.status_code == 200
    palette = created.get_json()['palette']
    assert palette['entries'][0]['code'] == 'T-015'

    listed = client.get('/api/thread-palettes?projectId=1', headers=_auth_headers()).get_json()['palettes']
    assert [p['id'] for p in listed] == [palette['id']]

    # Project ownership is enforced.
    assert client.get('/api/thread-palettes?projectId=1', headers=_auth_headers(2)).status_code in (403, 404)
    assert client.post('/api/thread-palettes', json={'projectId': 1, 'name': 'x', 'entries': [{'hex': '#000000'}]}, headers=_auth_headers(2)).status_code in (403, 404)

    assert client.delete(f"/api/thread-palettes/{palette['id']}", headers=_auth_headers()).status_code == 200
    assert client.get('/api/thread-palettes?projectId=1', headers=_auth_headers()).get_json()['palettes'] == []
