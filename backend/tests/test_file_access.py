"""Who may read a file, and where the app looks for it.

Every tool used to resolve its input by bare basename with no owner check, so any logged-in
user who learned a filename could run tools on another customer's artwork. Tools also read
local disk only, so on an ephemeral container every file that had aged out to object storage
came back as "File not found".
"""
import os

import bcrypt
import pytest
from datetime import datetime, timezone

from file_access import FileAccessError, assert_readable, resolve_readable_path


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


@pytest.fixture()
def two_users(app):
    """User 1 owns alice.png; user 2 owns nothing. User 3 is an admin."""
    from config import UPLOAD_DIR
    from db import db

    now = _now()
    pw = bcrypt.hashpw(b"Test@12345", bcrypt.gensalt()).decode()
    with app.app_context():
        conn = db()
        try:
            for uid, email, role in (
                (1, "alice@test.example", "user"),
                (2, "mallory@test.example", "user"),
                (3, "admin@test.example", "admin"),
            ):
                conn.execute(
                    """
                    INSERT INTO users (id, email, password, name, initials, role, plan,
                                       credits_used, credits_limit, reset_at, status, created_at)
                    VALUES (?, ?, ?, 'N', 'N', ?, 'Starter', 0, 100, ?, 'active', ?)
                    """,
                    (uid, email, pw, role, now, now),
                )
            conn.execute(
                "INSERT INTO user_uploads (user_id, filename, created_at) VALUES (1, 'alice.png', ?)",
                (now,),
            )
            conn.commit()
        finally:
            conn.close()

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(os.path.join(UPLOAD_DIR, "alice.png"), "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16)
    return None


ALICE = {"id": 1, "role": "user"}
MALLORY = {"id": 2, "role": "user"}
ADMIN = {"id": 3, "role": "admin"}


def test_owner_may_read_their_own_file(app, two_users):
    with app.app_context():
        assert assert_readable("alice.png", user=ALICE) == "alice.png"
        assert resolve_readable_path("alice.png", user=ALICE)


def test_another_user_is_refused(app, two_users):
    """The regression: a filename seen in a share link or export list was enough."""
    with app.app_context():
        with pytest.raises(FileAccessError) as excinfo:
            assert_readable("alice.png", user=MALLORY)
        assert excinfo.value.status == 404, "should not confirm the file exists"
        assert resolve_readable_path.__name__  # sanity

    with app.app_context():
        with pytest.raises(FileAccessError):
            resolve_readable_path("alice.png", user=MALLORY)


def test_admin_may_read_anything(app, two_users):
    with app.app_context():
        assert assert_readable("alice.png", user=ADMIN) == "alice.png"


def test_a_file_with_no_recorded_owner_is_allowed(app, two_users):
    """Intermediate results are not always recorded, and refusing them would break chaining."""
    with app.app_context():
        assert assert_readable("some-uuid-result.png", user=MALLORY) == "some-uuid-result.png"


def test_background_worker_without_a_request_context_is_allowed(app, two_users):
    """RQ workers act on payloads that were authorised when the route enqueued them."""
    with app.app_context():
        assert assert_readable("alice.png", user={}) == "alice.png"


def test_path_traversal_is_stripped(app, two_users):
    with app.app_context():
        assert assert_readable("../../etc/passwd", user=ALICE) == "passwd"
        with pytest.raises(FileAccessError):
            assert_readable("", user=ALICE)


def test_missing_local_file_is_fetched_from_object_storage(app, two_users, monkeypatch, tmp_path):
    """On an ephemeral disk the file is only in the bucket; it must not read as missing."""
    import file_access
    import storage

    stored = tmp_path / "from_bucket.png"
    stored.write_bytes(b"\x89PNG\r\n\x1a\n")

    def fake_get_file_path(directory_type, filename):
        return str(stored) if filename == "from_bucket.png" else None

    monkeypatch.setattr(storage, "get_file_path", fake_get_file_path)

    with app.app_context():
        resolved = file_access.resolve_readable_path("from_bucket.png", user=ALICE)
        assert resolved == str(stored)


def test_storage_failure_is_not_fatal(app, two_users, monkeypatch):
    import storage

    def boom(*_a, **_k):
        raise RuntimeError("bucket unreachable")

    monkeypatch.setattr(storage, "get_file_path", boom)

    with app.app_context():
        assert resolve_readable_path("nowhere.png", user=ALICE) is None


def test_layer_resolver_refuses_another_users_file(app, two_users):
    """The shared resolver every layer route and exporter uses."""
    from services.qwen_layers import _resolve_filepath

    with app.app_context():
        from flask import g
        with app.test_request_context():
            g.current_user = ALICE
            assert _resolve_filepath("alice.png")
        with app.test_request_context():
            g.current_user = MALLORY
            assert _resolve_filepath("alice.png") is None
