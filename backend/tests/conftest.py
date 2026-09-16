import os
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("FLASK_ENV", "testing")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-pytest-only")


def pytest_addoption(parser):
    parser.addoption(
        "--run-live",
        action="store_true",
        default=False,
        help="Also run tests that call real third-party APIs. They cost money and can "
             "be rate limited, so they are skipped by default.",
    )


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "live: performs a real third-party API call. Skipped unless --run-live is given.",
    )


def pytest_collection_modifyitems(config, items):
    """Skip live tests by default.

    One test ran a real Replicate prediction on every full run. That is a charge per run,
    and running the whole suite made enough calls to trip Replicate's rate limit, so the
    test failed at random and a red suite stopped meaning anything.
    """
    if config.getoption("--run-live"):
        return
    skip_live = pytest.mark.skip(
        reason="calls a real third-party API; pass --run-live to include it"
    )
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip_live)


@pytest.fixture()
def app(tmp_path, monkeypatch):
    db_path = tmp_path / "test.sqlite3"
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-for-pytest-only")
    monkeypatch.setenv("FLASK_ENV", "testing")

    import db

    monkeypatch.setattr(db, "DB_PATH", str(db_path))

    # Each test gets a new database, so cached users from a previous fixture
    # must not leak into authentication/plan checks for the same numeric id.
    import middleware
    middleware._USER_CACHE.clear()

    from server import create_app

    application = create_app()
    application.config["TESTING"] = True
    return application


@pytest.fixture()
def client(app):
    return app.test_client()
