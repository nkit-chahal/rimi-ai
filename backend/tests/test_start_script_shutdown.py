"""The container's shutdown signal has to reach the RQ workers.

A runtime signals PID 1 only. While start-web.sh exec'd into gunicorn, gunicorn was PID 1 and the
backgrounded workers never saw SIGTERM: they were SIGKILLed with the container, never ran RQ's warm
shutdown, and left their Redis registration in place for the full 420s worker TTL. /api/health/ready
counts registered workers, so a deploy whose own workers failed to start could pass its healthcheck
on the registrations of the container it replaced — observed in production as workers=4 for six
minutes after a redeploy of a single-replica service running two workers.

These assert the shape that makes the signal reachable. The behaviour itself is shell, exercised by
running the script against stub binaries rather than from here.
"""
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "start-web.sh"


@pytest.fixture(scope="module")
def script():
    return SCRIPT.read_text(encoding="utf-8")


def test_gunicorn_is_not_exec_d(script):
    """exec replaces the shell, so the script stops existing and cannot fan the signal out."""
    assert "exec gunicorn" not in script, (
        "gunicorn must run as a child so this script stays PID 1 and can forward SIGTERM"
    )


def test_shutdown_is_forwarded_to_the_workers(script):
    assert "trap" in script, "no signal handler: workers would be SIGKILLed without deregistering"
    assert "kill -TERM $supervisors" in script, "shutdown does not reach the worker supervisors"


def test_the_supervisor_forwards_to_the_worker_process_itself(script):
    """Signalling the supervisor subshell alone leaves the rq child running."""
    assert 'kill -TERM "$rq_pid"' in script


def test_the_script_still_waits_on_gunicorn(script):
    """Without this the script would exit immediately and take the container with it."""
    assert 'wait "$gunicorn_pid"' in script
