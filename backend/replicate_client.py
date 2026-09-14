"""Replicate calls that do not depend on the client library's two broken paths.

Why this module exists (found 2026-09-14 debugging "Flux Schnell — Failed" in the UI while the
Replicate dashboard showed the same prediction Succeeded):

replicate-python 1.0.7 has two independent bugs, and `black-forest-labs/flux-schnell` hits both.

1. `replicate.run()` defaults to `wait=True`, which sends a `Prefer: wait` header asking Replicate
   to hold the HTTP connection open and return the finished result. For flux-schnell that hold
   never releases early. Measured directly: the prediction reached `succeeded` in 5.9s, while the
   `Prefer: wait` request sat for 61.9s and then returned HTTP 202 with status still
   `"processing"` — no output. The caller times out, logs a failure, and the user sees "Failed"
   for work that completed and was billed.

2. Passing `wait=False` avoids that, but then the client's own response model rejects the
   response: `replicate/prediction.py` declares `version: str` as required, while official models
   (addressed as `owner/name`, no version hash) return `version: null` and identify themselves
   through `model` instead. Result: `ValidationError: version - none is not an allowed value`.

1.0.7 is the latest release, so there is no upgrade to take.

This module talks to the REST API directly — create the prediction with no `Prefer` header, then
poll until it reaches a terminal state. The return shape mirrors `replicate.run()` (an object
that stringifies to its URL and supports `.url` / `.read()`, or a list of them), so migrating a
call site is only a change of function name.
"""
from __future__ import annotations

import logging
import os
import time

import requests

logger = logging.getLogger(__name__)

API_ROOT = "https://api.replicate.com/v1"

# How long we are willing to wait for one prediction end to end. Matches the gunicorn worker
# timeout in gunicorn_config.py so the HTTP worker and this client agree on the ceiling; mockups
# are documented at 60-120s per product, so this needs real headroom.
DEFAULT_TIMEOUT = float(os.getenv("REPLICATE_RUN_TIMEOUT", "600"))

# Per-request timeouts. These are short because every request here returns immediately — we poll
# rather than asking the server to hold a connection open, which is the bug we are working around.
CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 30.0

# Polling starts tight so fast models (flux-schnell finishes in ~6s) return promptly, then backs
# off so a two-minute mockup does not generate hundreds of requests.
POLL_START = 0.5
POLL_MAX = 5.0
POLL_GROWTH = 1.3

TERMINAL = {"succeeded", "failed", "canceled"}


class ReplicateError(RuntimeError):
    """A prediction failed, was canceled, or never finished in time."""


class ReplicateOutput:
    """Stands in for the client's FileOutput.

    Call sites variously do `str(output)`, `output.url`, `output.read()`, or index into a list,
    and several already branch on `hasattr(output, 'url')`. Supporting all of those keeps this a
    drop-in swap instead of a rewrite of every caller.
    """

    __slots__ = ("url", "_content")

    def __init__(self, url: str):
        self.url = url
        self._content = None

    def __str__(self) -> str:
        return self.url

    def __repr__(self) -> str:
        return f"ReplicateOutput({self.url!r})"

    def read(self) -> bytes:
        """Download the file. Cached, so repeated reads do not refetch."""
        if self._content is None:
            resp = requests.get(self.url, timeout=(CONNECT_TIMEOUT, 120))
            resp.raise_for_status()
            self._content = resp.content
        return self._content


def _headers() -> dict:
    token = os.getenv("REPLICATE_API_TOKEN", "")
    if not token:
        raise ReplicateError("REPLICATE_API_TOKEN is not set")
    # Deliberately no `Prefer: wait` — see the module docstring.
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _request(method: str, url: str, **kwargs) -> requests.Response:
    """One HTTP call, retrying only on 429 and 5xx. Replicate rate-limits prediction creation."""
    delay = 1.0
    last = None
    for attempt in range(4):
        resp = requests.request(
            method, url, headers=_headers(), timeout=(CONNECT_TIMEOUT, READ_TIMEOUT), **kwargs
        )
        if resp.status_code < 400:
            return resp
        last = resp
        if resp.status_code == 429 or resp.status_code >= 500:
            wait = float(resp.headers.get("Retry-After") or delay)
            logger.warning("replicate %s %s -> %s, retrying in %.1fs (attempt %s/4)",
                           method, url.rsplit("/", 1)[-1], resp.status_code, wait, attempt + 1)
            time.sleep(wait)
            delay = min(delay * 2, 8.0)
            continue
        break

    detail = ""
    try:
        detail = last.json().get("detail") or last.text[:300]
    except Exception:  # noqa: BLE001 - body may not be JSON; the status code is the useful part
        detail = last.text[:300] if last is not None else ""
    raise ReplicateError(f"Replicate returned {last.status_code}: {detail}")


def _create(ref: str, model_input: dict) -> dict:
    """Start a prediction. Official models are addressed by name; pinned ones by version hash."""
    if ":" in ref:
        _, version = ref.split(":", 1)
        return _request("POST", f"{API_ROOT}/predictions",
                        json={"version": version, "input": model_input}).json()
    return _request("POST", f"{API_ROOT}/models/{ref}/predictions",
                    json={"input": model_input}).json()


def _wrap(output):
    if output is None:
        return None
    if isinstance(output, list):
        return [ReplicateOutput(str(o)) if isinstance(o, str) else o for o in output]
    if isinstance(output, str):
        return ReplicateOutput(output)
    return output  # dicts and scalars pass through untouched


def run_model(ref: str, input: dict, timeout: float = DEFAULT_TIMEOUT):  # noqa: A002 - matches replicate.run
    """Run a model to completion and return its output.

    Drop-in for `replicate.run(ref, input=...)`. `ref` is "owner/name" or "owner/name:version".
    Raises ReplicateError if the prediction fails, is canceled, or exceeds `timeout`.
    """
    started = time.time()
    prediction = _create(ref, input)
    pid = prediction.get("id")
    if not pid:
        raise ReplicateError(f"Replicate did not return a prediction id for {ref}")

    poll_url = f"{API_ROOT}/predictions/{pid}"
    interval = POLL_START
    while prediction.get("status") not in TERMINAL:
        elapsed = time.time() - started
        if elapsed > timeout:
            # The prediction keeps running and is still billed, so say so rather than implying
            # nothing happened. The id makes it findable on the dashboard.
            raise ReplicateError(
                f"{ref} did not finish within {timeout:.0f}s (prediction {pid} is still running)"
            )
        time.sleep(min(interval, max(0.0, timeout - elapsed)))
        interval = min(interval * POLL_GROWTH, POLL_MAX)
        prediction = _request("GET", poll_url).json()

    status = prediction.get("status")
    if status != "succeeded":
        raise ReplicateError(
            f"{ref} prediction {pid} {status}: {prediction.get('error') or 'no error detail'}"
        )

    logger.info("replicate %s succeeded in %.1fs (prediction %s)", ref, time.time() - started, pid)
    return _wrap(prediction.get("output"))
