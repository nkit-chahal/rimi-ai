"""An account with no project is told so — nothing is created behind its back.

Until 2026-09-16 the studio-state route silently inserted a 'My First Project' row for any user
who had none. Those nameless rows piled up in production. Now the route reports the empty state
and the client asks for a name before the studio opens.
"""
from datetime import datetime, timedelta, timezone

import bcrypt
import pytest

from db import db

EMAIL = "no-project@test.example"
PASSWORD = "Test@12345"


@pytest.fixture()
def fresh_user(client, app):
    with app.app_context():
        conn = db()
        try:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            password_hash = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode()
            conn.execute(
                """
                INSERT INTO users (id, email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status, created_at)
                VALUES (1, ?, ?, 'Fresh User', 'FU', 'user', 'Creator', 0, 5000, ?, 'active', ?)
                """,
                (EMAIL, password_hash, (now + timedelta(days=30)).isoformat(), now.isoformat()),
            )
            conn.commit()
        finally:
            conn.close()

    login = client.post("/api/login", json={"email": EMAIL, "password": PASSWORD})
    assert login.status_code == 200, login.get_json()
    return {"Authorization": f"Bearer {login.get_json()['token']}"}


def _project_count(app):
    with app.app_context():
        conn = db()
        try:
            return conn.execute("SELECT COUNT(*) AS n FROM projects WHERE user_id = 1").fetchone()["n"]
        finally:
            conn.close()


def test_state_reports_no_project_and_creates_nothing(client, app, fresh_user):
    res = client.get("/api/studio-state", headers=fresh_user)
    assert res.status_code == 200, res.get_json()
    body = res.get_json()["state"]

    assert body["needsProject"] is True
    assert body["activeProject"] is None
    assert body["projects"] == []
    # The rest of the payload keeps its shape so the client never sees undefined fields.
    assert body["metrics"]["versions"] == 0
    assert body["health"]["label"] == "No Data"
    assert body["controls"]["gridSize"] == 2
    assert body["suggestion"] is None

    assert _project_count(app) == 0, "studio state must not auto-create a project"
    # Asking twice must not create anything either.
    client.get("/api/studio-state", headers=fresh_user)
    assert _project_count(app) == 0


def test_named_project_then_enters_studio(client, app, fresh_user):
    created = client.post("/api/projects", json={"name": "Spring Florals"}, headers=fresh_user)
    assert created.status_code == 200, created.get_json()
    project_id = created.get_json()["projectId"]
    assert project_id

    res = client.get(f"/api/studio-state?projectId={project_id}", headers=fresh_user)
    body = res.get_json()["state"]
    assert body["needsProject"] is False
    assert body["activeProject"]["id"] == project_id
    assert body["activeProject"]["name"] == "Spring Florals"
    assert [p["name"] for p in body["projects"]] == ["Spring Florals"]
    assert _project_count(app) == 1


def test_blank_name_is_rejected(client, fresh_user):
    res = client.post("/api/projects", json={"name": "   "}, headers=fresh_user)
    assert res.status_code == 400
