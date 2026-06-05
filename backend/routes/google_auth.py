"""Google OAuth routes for browser login."""
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import jwt as pyjwt
import requests
from flask import Blueprint, jsonify, make_response, redirect, request

from db import db

bp = Blueprint('google_auth', __name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def frontend_url():
    return os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def callback_url():
    return os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:3001/api/auth/google/callback")


def redirect_with_error(message):
    return redirect(f"{frontend_url()}?{urlencode({'google_error': message})}")


def initials_from_name(name, email):
    parts = [part for part in (name or "").strip().split() if part]
    if parts:
        return "".join(part[0].upper() for part in parts[:2])
    return (email[:2] if email else "U").upper()


def reset_days(user):
    try:
        reset_at = datetime.fromisoformat(user["reset_at"])
        today = utc_now().date()
        return max(0, (reset_at.date() - today).days)
    except Exception:
        return 30


def user_payload(user):
    return {
        "id": user["id"],
        "email": user["email"],
        "role": user["role"],
        "name": user["name"],
        "initials": user["initials"],
        "plan": user["plan"],
        "creditsUsed": user["credits_used"],
        "creditsLimit": user["credits_limit"],
        "resetDays": reset_days(user),
        "loginProvider": user["login_provider"],
        "avatarUrl": user["avatar_url"],
        "emailVerified": bool(user["email_verified"]),
        "lastLoginAt": user["last_login_at"],
    }


def record_login(conn, user_id, provider):
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO login_events (user_id, provider, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            user_id,
            provider,
            request.headers.get("X-Forwarded-For", request.remote_addr),
            request.headers.get("User-Agent", ""),
            now,
        ),
    )
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now, user_id))
    return now


@bp.route('/api/auth/google/start', methods=['GET'])
def google_start():
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        return redirect_with_error("Google login is not configured yet.")

    state = secrets.token_urlsafe(32)
    params = {
        "client_id": client_id,
        "redirect_uri": callback_url(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    response = make_response(redirect(f"{GOOGLE_AUTH_URL}?{urlencode(params)}"))
    response.set_cookie(
        "google_oauth_state",
        state,
        max_age=600,
        httponly=True,
        secure=os.getenv("FLASK_ENV") == "production",
        samesite="Lax",
    )
    return response


@bp.route('/api/auth/google/callback', methods=['GET'])
def google_callback():
    if request.args.get("error"):
        return redirect_with_error("Google login was cancelled.")

    code = request.args.get("code", "")
    state = request.args.get("state", "")
    expected_state = request.cookies.get("google_oauth_state", "")
    if not code or not state or state != expected_state:
        return redirect_with_error("Google login state was invalid. Try again.")

    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        return redirect_with_error("Google login is not configured yet.")

    try:
        token_res = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": callback_url(),
                "grant_type": "authorization_code",
            },
            timeout=12,
        )
        token_res.raise_for_status()
        access_token = token_res.json().get("access_token")
        if not access_token:
            return redirect_with_error("Google did not return an access token.")

        profile_res = requests.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=12,
        )
        profile_res.raise_for_status()
        profile = profile_res.json()
    except requests.RequestException as exc:
        print(f"Google OAuth request failed: {exc}")
        return redirect_with_error("Google login failed. Try again.")

    email = (profile.get("email") or "").strip().lower()
    google_sub = profile.get("sub")
    email_verified = bool(profile.get("email_verified"))
    if not email or not google_sub or not email_verified:
        return redirect_with_error("Google account email must be verified.")

    name = (profile.get("name") or email.split("@")[0]).strip()
    avatar_url = profile.get("picture")
    now = utc_now()
    reset_at = (now + timedelta(days=30)).isoformat()

    conn = db()
    try:
        user = conn.execute(
            "SELECT * FROM users WHERE google_sub = ? OR email = ?",
            (google_sub, email),
        ).fetchone()

        if user:
            user_id = user["id"]
            conn.execute(
                """
                UPDATE users
                SET google_sub = ?,
                    login_provider = CASE WHEN login_provider = 'email' THEN 'google' ELSE login_provider END,
                    name = COALESCE(NULLIF(name, ''), ?),
                    initials = COALESCE(NULLIF(initials, ''), ?),
                    avatar_url = ?,
                    email_verified = 1
                WHERE id = ?
                """,
                (google_sub, name, initials_from_name(name, email), avatar_url, user_id),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO users
                (email, password, name, initials, role, plan, credits_used, credits_limit,
                 reset_at, login_provider, google_sub, avatar_url, email_verified, created_at)
                VALUES (?, ?, ?, ?, 'user', 'Free Trial', 0, 200, ?, 'google', ?, ?, 1, ?)
                """,
                (
                    email,
                    "GOOGLE_OAUTH_ONLY",
                    name,
                    initials_from_name(name, email),
                    reset_at,
                    google_sub,
                    avatar_url,
                    now.isoformat(),
                ),
            )
            user_id = cur.lastrowid

        record_login(conn, user_id, "google")
        login_token = secrets.token_urlsafe(32)
        conn.execute(
            """
            INSERT INTO oauth_login_tokens (token, user_id, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (login_token, user_id, (now + timedelta(minutes=5)).isoformat(), now.isoformat()),
        )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        print(f"Google OAuth DB failure: {exc}")
        return redirect_with_error("Could not finish Google login.")
    finally:
        conn.close()

    response = make_response(redirect(f"{frontend_url()}?{urlencode({'google_login_token': login_token})}"))
    response.delete_cookie("google_oauth_state")
    return response


@bp.route('/api/auth/google/exchange', methods=['POST'])
def google_exchange():
    data = request.get_json() or {}
    token = data.get("token", "")
    if not token:
        return jsonify({"success": False, "error": "Missing Google login token"}), 400

    conn = db()
    try:
        row = conn.execute(
            """
            SELECT olt.*, u.*
            FROM oauth_login_tokens olt
            JOIN users u ON u.id = olt.user_id
            WHERE olt.token = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            return jsonify({"success": False, "error": "Invalid Google login token"}), 400
        if row["used_at"]:
            return jsonify({"success": False, "error": "Google login token was already used"}), 400
        if datetime.fromisoformat(row["expires_at"]) < utc_now():
            return jsonify({"success": False, "error": "Google login token expired"}), 400

        conn.execute(
            "UPDATE oauth_login_tokens SET used_at = ? WHERE token = ?",
            (utc_now().isoformat(), token),
        )
        conn.commit()
        jwt_secret = os.getenv('JWT_SECRET', 'rimi-ai-dev-secret-change-in-production')
        jwt_token = pyjwt.encode(
            {'user_id': row['user_id'], 'role': row['role'], 'exp': utc_now() + timedelta(hours=24)},
            jwt_secret, algorithm='HS256'
        )
        return jsonify({"success": True, "user": user_payload(row), "token": jwt_token})
    except Exception as exc:
        conn.rollback()
        print(f"Google token exchange failed: {exc}")
        return jsonify({"success": False, "error": "Could not exchange Google login token"}), 500
    finally:
        conn.close()
