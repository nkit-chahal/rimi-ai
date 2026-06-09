"""JWT issue and validation helpers (shared by login routes and middleware)."""
import os
from datetime import datetime, timezone, timedelta

import jwt

_DEV_JWT_SECRET = 'rimi-ai-dev-secret-change-in-production'
_IS_PRODUCTION = os.getenv('FLASK_ENV') == 'production'
_JWT_SECRET_ENV = os.getenv('JWT_SECRET', '')
if _IS_PRODUCTION and (not _JWT_SECRET_ENV or _JWT_SECRET_ENV == _DEV_JWT_SECRET):
    raise RuntimeError('JWT_SECRET must be configured in production')
JWT_SECRET = _JWT_SECRET_ENV or _DEV_JWT_SECRET
JWT_ALGORITHM = 'HS256'
JWT_TTL_HOURS = 24


def issue_access_token(user_id, role):
    """Create a signed JWT string safe for JSON responses and Authorization headers."""
    now = datetime.now(timezone.utc)
    payload = {
        'user_id': int(user_id),
        'role': role,
        'iat': int(now.timestamp()),
        'exp': int((now + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    if isinstance(token, bytes):
        token = token.decode('utf-8')
    return token


def decode_access_token(token):
    """Decode and verify a JWT; returns payload dict or raises jwt exceptions."""
    return jwt.decode(
        token,
        JWT_SECRET,
        algorithms=[JWT_ALGORITHM],
        leeway=30,
    )
