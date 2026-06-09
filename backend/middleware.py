"""Authentication middleware for protecting API endpoints."""
import functools
import logging
from flask import request, jsonify, g
import jwt
from db import db
from jwt_tokens import decode_access_token


def current_user_id():
    """Return the authenticated user's id from flask.g."""
    user = getattr(g, 'current_user', None)
    return user['id'] if user else None


def assert_project_access(project_id):
    """Verify the current user owns the project (admins bypass). Returns (response, status) or None."""
    user = g.current_user
    if user.get('role') == 'admin':
        return None
    try:
        project_id = int(project_id)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Invalid project ID'}), 400
    conn = db()
    try:
        row = conn.execute(
            "SELECT id FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user['id']),
        ).fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Project not found'}), 404
        return None
    finally:
        conn.close()


def project_access_from_payload(data, default_project_id=1):
    """Parse projectId from request JSON and verify ownership."""
    project_id = int((data or {}).get('projectId', default_project_id))
    denied = assert_project_access(project_id)
    if denied:
        return project_id, denied
    return project_id, None

logger = logging.getLogger(__name__)


def _get_current_user():
    """Extract and validate JWT from Authorization header."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None
    token = auth_header[7:].strip()
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        user_id = payload.get('user_id')
        if not user_id:
            return None
        conn = db()
        try:
            user = conn.execute('SELECT * FROM users WHERE id = ?', (int(user_id),)).fetchone()
            if not user:
                logger.warning('JWT user_id=%s not found in database', user_id)
                return None
            user_dict = dict(user)
            # Reject banned or suspended users
            if user_dict.get('status') in ('banned', 'suspended'):
                return None
            return user_dict
        finally:
            conn.close()
    except jwt.ExpiredSignatureError:
        logger.info('JWT expired')
        return None
    except jwt.InvalidTokenError as exc:
        logger.warning('JWT invalid: %s', exc)
        return None
    except Exception as exc:
        logger.error('JWT auth failed: %s', exc)
        return None


def login_required(f):
    """Decorator that requires a valid JWT token."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if request.method == 'OPTIONS':
            return '', 200
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
        if request.method == 'OPTIONS':
            return '', 200
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
