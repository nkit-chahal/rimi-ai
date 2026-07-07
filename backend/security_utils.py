"""Security helpers: SSRF protection, upload validation, signed file tokens."""
import hashlib
import hmac
import io
import ipaddress
import os
import socket
import time
from urllib.parse import urlparse

import requests
from flask import request

from jwt_tokens import JWT_SECRET


BLOCKED_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
PRIVATE_NETWORKS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
)


def _is_private_ip(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
        return any(ip in net for net in PRIVATE_NETWORKS)
    except ValueError:
        return True


def validate_external_url(url, allowed_schemes=("http", "https")):
    """Reject URLs that could target internal networks (SSRF)."""
    if not url or not isinstance(url, str):
        raise ValueError("URL is required")
    parsed = urlparse(url.strip())
    if parsed.scheme not in allowed_schemes:
        raise ValueError(f"URL scheme must be one of: {', '.join(allowed_schemes)}")
    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError("URL must include a hostname")
    if host in BLOCKED_HOSTS:
        raise ValueError("URL host is not allowed")
    try:
        for info in socket.getaddrinfo(host, None):
            addr = info[4][0]
            if _is_private_ip(addr):
                raise ValueError("URL resolves to a private or reserved address")
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve URL host: {host}") from exc
    return url


def safe_fetch_url(url, timeout=30, max_bytes=25 * 1024 * 1024):
    """Fetch a validated external URL with size limits."""
    validate_external_url(url)
    resp = requests.get(url, timeout=timeout, stream=True, allow_redirects=False)
    if resp.status_code in (301, 302, 303, 307, 308):
        location = resp.headers.get("Location", "")
        if location:
            return safe_fetch_url(location, timeout=timeout, max_bytes=max_bytes)
        raise ValueError("Redirect without location header")
    resp.raise_for_status()
    chunks = []
    total = 0
    for chunk in resp.iter_content(chunk_size=65536):
        total += len(chunk)
        if total > max_bytes:
            raise ValueError("Download exceeds maximum allowed size")
        chunks.append(chunk)
    return b"".join(chunks)


def validate_image_bytes(data):
    """Verify bytes are a real image using PIL."""
    from PIL import Image

    if not data:
        raise ValueError("Empty file")
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
        fmt = (img.format or "").upper()
        if fmt not in {"JPEG", "PNG", "WEBP"}:
            raise ValueError(f"Unsupported image format: {fmt}")
        return True
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('File is not a valid JPG, PNG, or WEBP image') from exc


def validate_upload_file(file_storage):
    """Validate an uploaded file's extension and magic bytes."""
    from config import allowed_file, MAX_FILE_SIZE

    if not file_storage or not file_storage.filename:
        raise ValueError("No file selected")
    if not allowed_file(file_storage.filename):
        raise ValueError("Invalid file type. Supported: JPG, PNG, WEBP")
    data = file_storage.stream.read(MAX_FILE_SIZE + 1)
    file_storage.stream.seek(0)
    if len(data) > MAX_FILE_SIZE:
        raise ValueError(f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB")
    validate_image_bytes(data)
    return True


def _file_token_secret():
    return (JWT_SECRET or "rimi-file-token-dev").encode("utf-8")


def issue_file_access_token(filename, user_id, ttl_seconds=3600):
    """Issue a short-lived HMAC token for file access."""
    expires = int(time.time()) + int(ttl_seconds)
    payload = f"{filename}:{user_id}:{expires}"
    sig = hmac.new(_file_token_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{expires}.{sig}"


def media_access_token(filename, user_id, ttl_seconds=3600):
    """Token for embedding in img/src URLs (no Authorization header)."""
    basename = os.path.basename(filename or "")
    if not basename or not user_id:
        return None
    return issue_file_access_token(basename, int(user_id), ttl_seconds)


def verify_file_access_token(filename, user_id, token):
    """Verify a file access token; returns True if valid."""
    if not token or "." not in token:
        return False
    try:
        expires_str, sig = token.split(".", 1)
        expires = int(expires_str)
    except (ValueError, TypeError):
        return False
    if expires < int(time.time()):
        return False
    payload = f"{filename}:{user_id}:{expires}"
    expected = hmac.new(_file_token_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


def authorize_file_request(filename, owner_user_id=None):
    """Allow access via Bearer JWT (owner or admin) or valid signed file token."""
    from jwt_tokens import decode_access_token

    if owner_user_id is None:
        return False

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            payload = decode_access_token(auth_header[7:].strip())
            if payload.get("role") == "admin":
                return True
            if int(payload.get("user_id") or 0) == int(owner_user_id):
                return True
        except Exception:
            pass
    token = request.args.get("access_token") or request.args.get("token")
    if token:
        return verify_file_access_token(filename, owner_user_id, token)
    return False


def issue_sse_ticket(user_id, job_id, ttl_seconds=300):
    """Short-lived ticket for SSE job streaming (avoids JWT in query string)."""
    expires = int(time.time()) + int(ttl_seconds)
    payload = f"sse:{user_id}:{job_id}:{expires}"
    sig = hmac.new(_file_token_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{expires}.{sig}"


def verify_sse_ticket(user_id, job_id, ticket):
    if not ticket or "." not in ticket:
        return False
    try:
        expires_str, sig = ticket.split(".", 1)
        expires = int(expires_str)
    except (ValueError, TypeError):
        return False
    if expires < int(time.time()):
        return False
    payload = f"sse:{user_id}:{job_id}:{expires}"
    expected = hmac.new(_file_token_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)
