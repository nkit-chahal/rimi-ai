"""Shared Redis connection helpers.

Pin RESP2 (protocol=2) so the same code works against:
- local Redis 5.0.x (no RESP3 / HELLO 3)
- Redis 6/7/8 (including Railway), which still speak RESP2
"""
from __future__ import annotations

import os
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

# redis-py 5+/8 defaults to RESP3 (DEFAULT_RESP_VERSION=3), which Redis 5 rejects.
REDIS_PROTOCOL = 2
DEFAULT_REDIS_URL = "redis://localhost:6379/0"


def ensure_redis_protocol(url: str, protocol: int = REDIS_PROTOCOL) -> str:
    """Attach/overwrite ``protocol=N`` on a redis URL for from_url / RQ CLI consumers."""
    if not url or not url.startswith(("redis://", "rediss://", "unix://")):
        return url
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["protocol"] = str(protocol)
    return urlunparse(parsed._replace(query=urlencode(query)))


def get_redis_url(env_var: str = "REDIS_URL", default: str = DEFAULT_REDIS_URL) -> str:
    """Resolve Redis URL from the environment and force RESP2 via query param."""
    return ensure_redis_protocol(os.getenv(env_var) or default)


def redis_from_url(url: str | None = None, **kwargs):
    """Create a ``redis.Redis`` client forced to RESP2."""
    from redis import Redis

    raw = url or os.getenv("REDIS_URL") or DEFAULT_REDIS_URL
    kwargs.setdefault("protocol", REDIS_PROTOCOL)
    return Redis.from_url(raw, **kwargs)
