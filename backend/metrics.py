"""Prometheus-style metrics for RIMI AI backend."""
import threading
import time

_lock = threading.Lock()
_counters = {
    "http_requests_total": 0,
    "http_errors_total": 0,
    "credit_transactions_total": 0,
}
_histograms = {
    "http_request_duration_ms": [],
}


def increment(name, amount=1):
    with _lock:
        _counters[name] = _counters.get(name, 0) + amount


def observe_duration(name, duration_ms):
    with _lock:
        bucket = _histograms.setdefault(name, [])
        bucket.append(duration_ms)
        if len(bucket) > 1000:
            del bucket[:500]


def render_prometheus():
    lines = []
    with _lock:
        for key, value in sorted(_counters.items()):
            lines.append(f"rimi_{key} {value}")
        for key, values in sorted(_histograms.items()):
            if not values:
                continue
            avg = sum(values) / len(values)
            lines.append(f"rimi_{key}_avg {avg:.2f}")
    lines.append(f"rimi_process_uptime_seconds {time.time() - _START_TIME:.2f}")
    return "\n".join(lines) + "\n"


_START_TIME = time.time()
