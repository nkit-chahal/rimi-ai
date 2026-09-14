"""The Replicate wrapper must not reintroduce either client-library bug it exists to avoid.

Found 2026-09-14: the UI showed "Flux Schnell — Failed" while Replicate's dashboard showed the
same prediction Succeeded. Two bugs in replicate-python 1.0.7, both hit by flux-schnell:

  1. run() defaults to wait=True, sending `Prefer: wait`. For flux-schnell that hold never
     releases early — measured 61.9s to return HTTP 202 "processing" for a prediction that had
     finished in 5.9s. The caller times out and records a failure for work that was billed.
  2. wait=False avoids that, but the client's Prediction model declares `version: str` as
     required while official models return `version: null` -> ValidationError.

1.0.7 is the latest release, so these tests guard behaviour a dependency bump cannot fix.
"""
import re
from pathlib import Path

import pytest

import replicate_client as rc

BACKEND = Path(__file__).resolve().parents[1]


class FakeResponse:
    def __init__(self, status_code=200, payload=None, headers=None, content=b""):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}
        self.content = content
        self.text = str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"HTTP {self.status_code}")


@pytest.fixture()
def token(monkeypatch):
    monkeypatch.setenv("REPLICATE_API_TOKEN", "test-token")


@pytest.fixture()
def calls(monkeypatch):
    """Record every HTTP call the module makes, and script the responses."""
    log = []
    script = []
    # Returned once the script runs out. Tests that poll forever override it.
    state = {"default": FakeResponse(200, {"id": "p1", "status": "succeeded"})}

    def fake_request(method, url, **kw):
        log.append({"method": method, "url": url, "headers": kw.get("headers", {}),
                    "json": kw.get("json")})
        return script.pop(0) if script else state["default"]

    monkeypatch.setattr(rc.requests, "request", fake_request)
    monkeypatch.setattr(rc.time, "sleep", lambda *_: None)  # keep polling tests instant
    return {"log": log, "script": script, "state": state}


def test_never_sends_prefer_wait(token, calls):
    """Bug 1. `Prefer: wait` is exactly what hangs for 60s and returns nothing."""
    calls["script"].append(FakeResponse(200, {"id": "p1", "status": "succeeded", "output": ["u"]}))
    rc.run_model("black-forest-labs/flux-schnell", {"prompt": "x"})
    for c in calls["log"]:
        assert not any(h.lower() == "prefer" for h in c["headers"]), c["headers"]


def test_official_model_uses_the_model_endpoint(token, calls):
    """Bug 2's other half: official models are addressed by name, and return version: null."""
    calls["script"].append(FakeResponse(200, {"id": "p1", "status": "succeeded",
                                              "version": None, "output": ["u"]}))
    out = rc.run_model("black-forest-labs/flux-schnell", {"prompt": "x"})
    assert calls["log"][0]["url"].endswith("/models/black-forest-labs/flux-schnell/predictions")
    assert "version" not in (calls["log"][0]["json"] or {})
    assert str(out[0]) == "u"  # a null version must not break parsing


def test_pinned_version_uses_the_predictions_endpoint(token, calls):
    calls["script"].append(FakeResponse(200, {"id": "p1", "status": "succeeded", "output": "u"}))
    rc.run_model("replicate/seamless-texture:9a59c0de", {"prompt": "x"})
    assert calls["log"][0]["url"].endswith("/v1/predictions")
    assert calls["log"][0]["json"]["version"] == "9a59c0de"


def test_polls_until_terminal(token, calls):
    calls["script"] += [
        FakeResponse(200, {"id": "p1", "status": "starting"}),
        FakeResponse(200, {"id": "p1", "status": "processing"}),
        FakeResponse(200, {"id": "p1", "status": "processing"}),
        FakeResponse(200, {"id": "p1", "status": "succeeded", "output": ["done"]}),
    ]
    out = rc.run_model("owner/model", {})
    assert str(out[0]) == "done"
    assert [c["method"] for c in calls["log"]] == ["POST", "GET", "GET", "GET"]


def test_failed_prediction_raises_with_the_reason(token, calls):
    calls["script"].append(
        FakeResponse(200, {"id": "p9", "status": "failed", "error": "NSFW detected"}))
    with pytest.raises(rc.ReplicateError, match="NSFW detected"):
        rc.run_model("owner/model", {})


def test_canceled_prediction_raises(token, calls):
    calls["script"].append(FakeResponse(200, {"id": "p9", "status": "canceled"}))
    with pytest.raises(rc.ReplicateError, match="canceled"):
        rc.run_model("owner/model", {})


def test_timeout_names_the_prediction_and_says_it_is_still_running(token, calls, monkeypatch):
    """A timed-out prediction keeps running and is still billed — the message must not imply
    otherwise, and must give an id that can be found on the dashboard."""
    clock = {"t": 0.0}
    monkeypatch.setattr(rc.time, "time", lambda: clock["t"])

    def advancing_sleep(_s):
        clock["t"] += 10
    monkeypatch.setattr(rc.time, "sleep", advancing_sleep)

    # Never reaches a terminal state, so the timeout is the only way out.
    calls["state"]["default"] = FakeResponse(200, {"id": "pslow", "status": "processing"})
    calls["script"].append(FakeResponse(200, {"id": "pslow", "status": "processing"}))
    with pytest.raises(rc.ReplicateError) as exc:
        rc.run_model("owner/model", {}, timeout=30)
    assert "pslow" in str(exc.value) and "still running" in str(exc.value)


@pytest.mark.parametrize("status", [429, 503])
def test_retries_rate_limits_and_server_errors(token, calls, status):
    """Replicate rate-limits prediction creation; a 429 must not surface as a failed generation."""
    calls["script"] += [
        FakeResponse(status, {"detail": "slow down"}, headers={"Retry-After": "0"}),
        FakeResponse(200, {"id": "p1", "status": "succeeded", "output": ["u"]}),
    ]
    out = rc.run_model("owner/model", {})
    assert str(out[0]) == "u"
    assert len(calls["log"]) == 2


def test_client_errors_are_not_retried(token, calls):
    calls["script"].append(FakeResponse(422, {"detail": "bad input"}))
    with pytest.raises(rc.ReplicateError, match="422"):
        rc.run_model("owner/model", {})
    assert len(calls["log"]) == 1


def test_missing_token_is_a_clear_error(monkeypatch, calls):
    monkeypatch.delenv("REPLICATE_API_TOKEN", raising=False)
    with pytest.raises(rc.ReplicateError, match="REPLICATE_API_TOKEN"):
        rc.run_model("owner/model", {})


class TestOutputShape:
    """Call sites variously use str(), .url, .read() and list indexing; all must keep working."""

    def test_list_output_wraps_each_url(self, token, calls):
        calls["script"].append(
            FakeResponse(200, {"id": "p", "status": "succeeded", "output": ["a", "b"]}))
        out = rc.run_model("owner/model", {})
        assert isinstance(out, list) and len(out) == 2
        assert str(out[0]) == "a" and out[1].url == "b"

    def test_single_string_output_wraps(self, token, calls):
        calls["script"].append(
            FakeResponse(200, {"id": "p", "status": "succeeded", "output": "only"}))
        out = rc.run_model("owner/model", {})
        assert str(out) == "only" and out.url == "only"

    def test_read_downloads_once_and_caches(self, token, calls, monkeypatch):
        hits = []

        def fake_get(url, **kw):
            hits.append(url)
            return FakeResponse(200, content=b"PNGDATA")
        monkeypatch.setattr(rc.requests, "get", fake_get)

        calls["script"].append(
            FakeResponse(200, {"id": "p", "status": "succeeded", "output": ["http://x/y.png"]}))
        out = rc.run_model("owner/model", {})
        assert out[0].read() == b"PNGDATA"
        assert out[0].read() == b"PNGDATA"
        assert len(hits) == 1, "read() must cache, not refetch"

    def test_none_output_passes_through(self, token, calls):
        calls["script"].append(FakeResponse(200, {"id": "p", "status": "succeeded", "output": None}))
        assert rc.run_model("owner/model", {}) is None


def test_no_production_code_calls_replicate_run_directly():
    """The regression guard: one call site slipping back onto replicate.run() reintroduces a
    60s hang for any model Replicate has moved to its AI-gateway path."""
    offenders = []
    for path in list(BACKEND.glob("routes/*.py")) + list(BACKEND.glob("services/*.py")):
        if re.search(r"\breplicate\.run\(", path.read_text(encoding="utf-8")):
            offenders.append(path.name)
    assert not offenders, f"use run_model() from replicate_client instead: {offenders}"
