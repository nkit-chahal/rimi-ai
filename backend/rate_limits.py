"""Rate-limit decorator helpers (initialized from server.create_app)."""
from functools import wraps

_limiter = None

LOGIN_RATE = "10 per minute"
SIGNUP_REQUEST_RATE = "5 per minute"
SIGNUP_VERIFY_RATE = "10 per minute"


GENERATION_RATE = "30 per minute"
EXPENSIVE_GENERATION_RATE = "10 per minute"


def init_rate_limits(limiter):
    global _limiter
    _limiter = limiter


def _require_limiter():
    if _limiter is None:
        raise RuntimeError("Rate limiter not initialized")
    return _limiter


def rate_limit(limit_string):
    """Apply a Flask-Limiter rule lazily (after create_app initializes the limiter)."""

    def decorator(fn):
        limited_fn = None

        @wraps(fn)
        def wrapped(*args, **kwargs):
            nonlocal limited_fn
            if limited_fn is None:
                limited_fn = _require_limiter().limit(limit_string)(fn)
            return limited_fn(*args, **kwargs)

        return wrapped

    return decorator


def login_rate_limit(fn):
    return rate_limit(LOGIN_RATE)(fn)


def signup_request_rate_limit(fn):
    return rate_limit(SIGNUP_REQUEST_RATE)(fn)


def signup_verify_rate_limit(fn):
    return rate_limit(SIGNUP_VERIFY_RATE)(fn)


def generation_rate_limit(fn):
    return rate_limit(GENERATION_RATE)(fn)


def expensive_generation_rate_limit(fn):
    return rate_limit(EXPENSIVE_GENERATION_RATE)(fn)
