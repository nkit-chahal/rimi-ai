"""/api/health/ready must fail when nothing is draining the RQ queue.

Reaching Redis is not the same as having a worker. In production enqueue_or_run hands async jobs
to RQ and returns immediately; with no worker process alongside the web service the jobs sit at
'queued' forever and the UI spins with no error anywhere. The readiness probe is the place that
turns that into a visible failure.
"""
import re
import types
from pathlib import Path

import pytest


def _configured_healthcheck_path():
    """The path Railway probes, read from railway.toml rather than restated here."""
    toml = (Path(__file__).resolve().parent.parent / "railway.toml").read_text(encoding="utf-8")
    match = re.search(r'^healthcheckPath\s*=\s*"([^"]+)"', toml, re.MULTILINE)
    assert match, "railway.toml declares no healthcheckPath"
    return match.group(1)


class _FakeQueue:
    def __init__(self, count=0):
        self.count = count


class _FakeWorker:
    def __init__(self, queues):
        self._queues = queues

    def queue_names(self):
        return self._queues


@pytest.fixture()
def redis_env(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    import redis_client
    monkeypatch.setattr(redis_client, "redis_from_url", lambda *a, **k: types.SimpleNamespace(ping=lambda: True))


def _patch_rq(monkeypatch, workers, queue_count=0):
    import rq
    monkeypatch.setattr(rq, "Queue", lambda *a, **k: _FakeQueue(queue_count))
    monkeypatch.setattr(rq, "Worker", types.SimpleNamespace(all=staticmethod(lambda connection=None: workers)))


def test_ready_is_degraded_when_no_worker_listens(client, redis_env, monkeypatch):
    _patch_rq(monkeypatch, workers=[])
    res = client.get("/api/health/ready")
    assert res.status_code == 503
    checks = res.get_json()["checks"]
    assert checks["workers"] == 0
    assert "no RQ worker" in checks["rq_worker"]


def test_ready_is_ok_when_a_worker_listens_on_our_queue(client, redis_env, monkeypatch):
    from jobs import QUEUE_NAME
    _patch_rq(monkeypatch, workers=[_FakeWorker([QUEUE_NAME])], queue_count=3)
    res = client.get("/api/health/ready")
    assert res.status_code == 200
    checks = res.get_json()["checks"]
    assert checks["rq_worker"] == "ok"
    assert checks["workers"] == 1
    assert checks["queueDepth"] == 3


def test_a_worker_on_a_different_queue_does_not_count(client, redis_env, monkeypatch):
    _patch_rq(monkeypatch, workers=[_FakeWorker(["some-other-queue"])])
    res = client.get("/api/health/ready")
    assert res.status_code == 503
    assert res.get_json()["checks"]["workers"] == 0


def test_railway_healthchecks_the_readiness_probe(client, redis_env, monkeypatch):
    """The configured path must exist and answer without a token.

    Railway calls healthcheckPath unauthenticated. If the route is renamed or ever gains an auth
    decorator, every deploy fails on a 404 or 401 that reads like the app itself is broken, so the
    config and the route are pinned together here rather than discovered during a deploy.
    """
    path = _configured_healthcheck_path()

    from jobs import QUEUE_NAME
    _patch_rq(monkeypatch, workers=[_FakeWorker([QUEUE_NAME])])

    res = client.get(path)  # no Authorization header, exactly as Railway calls it
    assert res.status_code == 200, f"{path} answered {res.status_code} to an unauthenticated probe"


def test_the_configured_path_actually_checks_the_worker(client, redis_env, monkeypatch):
    """A path that cannot fail is not a healthcheck.

    /api/health returns 200 whether or not anything drains the queue, which is why it let a
    worker-less deploy go green.
    """
    path = _configured_healthcheck_path()

    _patch_rq(monkeypatch, workers=[])
    assert client.get(path).status_code == 503, f"{path} stays green with no RQ worker listening"
