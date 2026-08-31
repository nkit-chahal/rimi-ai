from datetime import datetime, timedelta, timezone

import bcrypt


def _seed_export_history(app, results_dir):
    from db import db

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    password_hash = bcrypt.hashpw(b'Test@12345', bcrypt.gensalt()).decode()
    with app.app_context():
        conn = db()
        conn.execute(
            """
            INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
            VALUES (901, 'archive@test.example', ?, 'Archive User', 'AU', 'user', 'Starter', 0, 1000, ?, 'active', ?)
            """,
            (password_hash, (now + timedelta(days=60)).isoformat(), now.isoformat()),
        )
        conn.execute(
            """
            INSERT INTO projects (id, name, status, thumbnail_url, hero_image_url, updated_at, user_id)
            VALUES (901, 'Archive Project', 'Draft', '/results/old.png', '/results/old.png', ?, 901)
            """,
            (now.isoformat(),),
        )
        conn.execute(
            "INSERT INTO project_metrics (project_id, versions, exports) VALUES (901, 2, 2)"
        )
        conn.execute(
            """
            INSERT INTO exports (user_id, project_id, filename, tool_type, created_at)
            VALUES (901, 901, 'old.png', 'pattern', ?)
            """,
            ((now - timedelta(minutes=1)).isoformat(),),
        )
        conn.execute(
            """
            INSERT INTO exports (user_id, project_id, filename, tool_type, created_at)
            VALUES (901, 901, 'fallback.png', 'pattern', ?)
            """,
            (now.isoformat(),),
        )
        conn.execute(
            """
            INSERT INTO pattern_variations (id, project_id, name, image_url, is_selected, created_at, export_filename)
            VALUES (901, 901, 'Old selected', '/results/old.png', 1, ?, 'old.png')
            """,
            ((now - timedelta(minutes=1)).isoformat(),),
        )
        conn.execute(
            """
            INSERT INTO pattern_variations (id, project_id, name, image_url, is_selected, created_at, export_filename)
            VALUES (902, 901, 'Fallback', '/results/fallback.png', 0, ?, 'fallback.png')
            """,
            (now.isoformat(),),
        )
        conn.execute(
            """
            INSERT INTO share_links (token, user_id, project_id, export_filename, expires_at, created_at)
            VALUES ('archive-share-token', 901, 901, 'old.png', ?, ?)
            """,
            ((now + timedelta(days=7)).isoformat(), now.isoformat()),
        )
        conn.commit()
        conn.close()

    results_dir.mkdir(parents=True, exist_ok=True)
    (results_dir / 'old.png').write_bytes(b'not-removed')


def test_archive_hides_linked_history_retains_s3_and_can_restore(client, app, tmp_path, monkeypatch):
    import routes.exports as exports_route

    results_dir = tmp_path / 'results'
    previews_dir = results_dir / 'previews'
    monkeypatch.setattr(exports_route, 'RESULTS_DIR', str(results_dir))
    monkeypatch.setattr(exports_route, 'PREVIEWS_DIR', str(previews_dir))
    monkeypatch.setattr(exports_route, 'USE_S3', True)
    tag_calls = []

    def record_tags(directory_type, filename, tags, remove_keys=()):
        tag_calls.append((directory_type, filename, tags, tuple(remove_keys)))
        return True

    monkeypatch.setattr(exports_route.storage, 'update_object_tags', record_tags)
    _seed_export_history(app, results_dir)

    login = client.post('/api/login', json={'email': 'archive@test.example', 'password': 'Test@12345'})
    assert login.status_code == 200
    headers = {'Authorization': f"Bearer {login.get_json()['token']}"}

    archived = client.delete('/api/exports', json={'filenames': ['old.png']}, headers=headers)
    assert archived.status_code == 200
    assert archived.get_json()['archived'] == ['old.png']
    assert (results_dir / 'old.png').read_bytes() == b'not-removed'
    assert tag_calls[0][2]['lifecycle'] == 'archived'

    exports_response = client.get('/api/exports?project_id=901', headers=headers).get_json()
    assert [item['filename'] for item in exports_response['exports']] == ['fallback.png']
    versions_response = client.get('/api/projects/901/versions', headers=headers).get_json()
    assert [item['exportFilename'] for item in versions_response['versions']] == ['fallback.png']
    assert client.get('/api/share/archive-share-token').status_code == 404

    from db import db
    with app.app_context():
        conn = db()
        export = conn.execute("SELECT deleted_at, deleted_by FROM exports WHERE filename = 'old.png'").fetchone()
        variation = conn.execute("SELECT deleted_at, is_selected FROM pattern_variations WHERE id = 901").fetchone()
        share = conn.execute("SELECT revoked_at FROM share_links WHERE token = 'archive-share-token'").fetchone()
        project = conn.execute("SELECT hero_image_url, thumbnail_url FROM projects WHERE id = 901").fetchone()
        fallback = conn.execute("SELECT is_selected FROM pattern_variations WHERE id = 902").fetchone()
        assert export['deleted_at'] and export['deleted_by'] == 901
        assert variation['deleted_at'] and variation['is_selected'] == 0
        assert share['revoked_at']
        assert project['hero_image_url'] == '/results/fallback.png'
        assert project['thumbnail_url'] == '/results/fallback.png'
        assert fallback['is_selected'] == 1
        conn.close()

    restored = client.post('/api/exports/restore', json={'filenames': ['old.png']}, headers=headers)
    assert restored.status_code == 200
    assert restored.get_json()['restored'] == ['old.png']
    assert tag_calls[-1][2] == {'lifecycle': 'active'}
    assert set(tag_calls[-1][3]) == {'deleted_at', 'deleted_by', 'project_id'}
    assert len(client.get('/api/exports?project_id=901', headers=headers).get_json()['exports']) == 2
    assert len(client.get('/api/projects/901/versions', headers=headers).get_json()['versions']) == 2
    assert client.get('/api/share/archive-share-token').status_code == 200


def test_update_object_tags_merges_without_deleting(monkeypatch):
    import storage

    class FakeS3:
        def __init__(self):
            self.updated = None

        def get_object_tagging(self, **_kwargs):
            return {'TagSet': [{'Key': 'owner', 'Value': 'rimi'}, {'Key': 'deleted_at', 'Value': 'old'}]}

        def put_object_tagging(self, **kwargs):
            self.updated = kwargs

    fake = FakeS3()
    monkeypatch.setattr(storage, 'USE_S3', True)
    monkeypatch.setattr(storage, '_s3_client', fake)

    assert storage.update_object_tags(
        'results', 'pattern.png', {'lifecycle': 'active'}, remove_keys=('deleted_at',)
    ) is True
    assert fake.updated['Key'] == 'results/pattern.png'
    assert fake.updated['Tagging']['TagSet'] == [
        {'Key': 'lifecycle', 'Value': 'active'},
        {'Key': 'owner', 'Value': 'rimi'},
    ]
