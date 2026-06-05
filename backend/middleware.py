"""Authentication middleware for protecting API endpoints."""
import os
import functools
import logging
from flask import request, jsonify, g
import jwt
from db import db

logger = logging.getLogger(__name__)

JWT_SECRET = os.getenv('JWT_SECRET', 'rimi-ai-dev-secret-change-in-production')
JWT_ALGORITHM = 'HS256'


def _get_current_user():
    """Extract and validate JWT from Authorization header."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get('user_id')
        if not user_id:
            return None
        conn = db()
        try:
            user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
            if not user:
                return None
            user_dict = dict(user)
            # Reject banned or suspended users
            if user_dict.get('status') in ('banned', 'suspended'):
                return None
            return user_dict
        finally:
            conn.close()
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def login_required(f):
    """Decorator that requires a valid JWT token."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        user = _get_current_user()
        if not user:
            return jsonify({'success': False, 'error': 'Authentication required'}), 401
        g.current_user = user
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    """Decorator that requires a valid JWT token with admin role."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        user = _get_current_user()
        if not user:
            return jsonify({'success': False, 'error': 'Authentication required'}), 401
        if user.get('role') != 'admin':
            return jsonify({'success': False, 'error': 'Admin access required'}), 403
        g.current_user = user
        return f(*args, **kwargs)
    return decorated


def optional_auth(f):
    """Decorator that attaches user if token present, but doesn't require it."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        g.current_user = _get_current_user()
        return f(*args, **kwargs)
    return decorated
