"""Signup anti-abuse guards: IP cooldown, device fingerprint, Gmail normalization."""
import re
from datetime import datetime, timedelta, timezone

from db import db, db_lock

# How long to block signups from the same IP (days)
IP_COOLDOWN_DAYS = 10


def normalize_gmail(email: str) -> str:
    """Normalize Gmail/Googlemail addresses by stripping dots and +tags.

    j.o.h.n+spam@gmail.com  ->  john@gmail.com
    Non-Gmail addresses are returned lowercase but otherwise unchanged.
    """
    email = email.strip().lower()
    local, at, domain = email.rpartition("@")
    if not at:
        return email

    # Gmail and Googlemail treat dots and +suffixes as identical
    if domain in ("gmail.com", "googlemail.com"):
        local = local.split("+")[0]      # strip +tag
        local = local.replace(".", "")   # strip dots
        domain = "gmail.com"             # unify domain

    return f"{local}@{domain}"


def check_signup_guards(ip_address: str, fingerprint: str, email: str):
    """Check all signup guards. Returns (allowed: bool, reason: str | None).

    Checks in order:
    1. Normalized email — same canonical email already registered
    2. IP cooldown     — same IP created an account within IP_COOLDOWN_DAYS
    3. Fingerprint     — same device fingerprint already used
    """
    norm_email = normalize_gmail(email)
    cutoff = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=IP_COOLDOWN_DAYS)).isoformat()

    with db_lock:
        conn = db()
        try:
            # 1. Normalized email check
            dup_email = conn.execute(
                "SELECT id FROM signup_guards WHERE normalized_email = ?",
                (norm_email,),
            ).fetchone()
            if dup_email:
                return False, "An account with this email already exists."

            # 2. IP cooldown check
            if ip_address:
                recent_ip = conn.execute(
                    "SELECT id FROM signup_guards WHERE ip_address = ? AND created_at > ?",
                    (ip_address, cutoff),
                ).fetchone()
                if recent_ip:
                    return False, "Too many signups from this network. Please try again later."

            # 3. Device fingerprint check
            if fingerprint and len(fingerprint) > 8:
                dup_fp = conn.execute(
                    "SELECT id FROM signup_guards WHERE device_fingerprint = ?",
                    (fingerprint,),
                ).fetchone()
                if dup_fp:
                    return False, "An account has already been created from this device."

            return True, None
        finally:
            conn.close()


def record_signup_guard(user_id: int, ip_address: str, fingerprint: str, email: str):
    """Store guard data after a successful signup."""
    norm_email = normalize_gmail(email)
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

    with db_lock:
        conn = db()
        try:
            conn.execute(
                """
                INSERT INTO signup_guards
                (user_id, ip_address, device_fingerprint, normalized_email, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, ip_address or "", fingerprint or "", norm_email, now),
            )
            conn.commit()
        finally:
            conn.close()


def get_client_ip():
    """Extract the real client IP from the request, respecting proxy headers."""
    from flask import request
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or ""
