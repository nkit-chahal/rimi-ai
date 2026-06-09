import os
import tempfile

import pytest

os.environ.setdefault("FLASK_ENV", "testing")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-pytest-only")


@pytest.fixture()
def app(tmp_path, monkeypatch):
    db_path = tmp_path / "test.sqlite3"
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-for-pytest-only")
    monkeypatch.setenv("FLASK_ENV", "testing")
    monkeypatch.setattr("db.DB_PATH", str(db_path), raising=False)

    from server import create_app

    application = create_app()
    application.config["TESTING"] = True
    return application


@pytest.fixture()
def client(app):
    return app.test_client()
