"""Google OAuth routes for browser login."""
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import bcrypt
import requests
from flask import Blueprint, jsonify, make_response, redirect, request

from db import db
from jwt_tokens import issue_access_token

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
    from plan_tiers import attach_tier_fields
    return attach_tier_fields({
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
    })


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
            if user["status"] in ("suspended", "banned"):
                return redirect_with_error("Account is suspended.")
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
            # Enforce correct free tier credits for Free Trial users
            if user["plan"] == "Free Trial" and user["credits_limit"] > 200:
                conn.execute(
                    "UPDATE users SET credits_limit = 200 WHERE id = ? AND plan = 'Free Trial'",
                    (user_id,),
                )
        else:
            reset_at = (now + timedelta(days=30)).isoformat()
            password_hash = bcrypt.hashpw(
                secrets.token_urlsafe(32).encode("utf-8"),
                bcrypt.gensalt(),
            ).decode("utf-8")
            cur = conn.execute(
                """
                INSERT INTO users
                (email, password, name, initials, role, plan, credits_used, credits_limit,
                 reset_at, login_provider, google_sub, avatar_url, email_verified, created_at, status)
                VALUES (?, ?, ?, ?, 'user', 'Free Trial', 0, 200, ?, 'google', ?, ?, 1, ?, 'active')
                """,
                (
                    email,
                    password_hash,
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


@bp.route('/api/auth/google/signup-token', methods=['POST'])
def google_signup_token_info():
    data = request.get_json() or {}
    token = data.get("token", "")
    if not token:
        return jsonify({"success": False, "error": "Missing Google signup token"}), 400

    conn = db()
    try:
        row = conn.execute("SELECT * FROM google_signup_tokens WHERE token = ?", (token,)).fetchone()
        if not row:
            return jsonify({"success": False, "error": "Invalid Google signup token"}), 400
        if row["used_at"]:
            return jsonify({"success": False, "error": "Google signup token was already used"}), 400
        if datetime.fromisoformat(row["expires_at"]) < utc_now():
            return jsonify({"success": False, "error": "Google signup token expired"}), 400
        return jsonify({
            "success": True,
            "email": row["email"],
            "name": row["name"],
            "avatarUrl": row["avatar_url"],
        })
    finally:
        conn.close()


@bp.route('/api/auth/google/complete-signup', methods=['POST'])
def google_complete_signup():
    data = request.get_json() or {}
    token = data.get("token", "")
    name = (data.get("name") or "").strip()
    password = data.get("password") or ""
    fingerprint = data.get("fingerprint", "")

    if not token or not name or not password:
        return jsonify({"success": False, "error": "Name and password are required"}), 400
    if len(password) < 8:
        return jsonify({"success": False, "error": "Password must be at least 8 characters"}), 400

    conn = db()
    try:
        row = conn.execute("SELECT * FROM google_signup_tokens WHERE token = ?", (token,)).fetchone()
        if not row:
            return jsonify({"success": False, "error": "Invalid Google signup token"}), 400
        if row["used_at"]:
            return jsonify({"success": False, "error": "Google signup token was already used"}), 400
        if datetime.fromisoformat(row["expires_at"]) < utc_now():
            return jsonify({"success": False, "error": "Google signup token expired"}), 400

        from signup_guard import check_signup_guards, record_signup_guard, get_client_ip
        ip_address = get_client_ip()
        allowed, reason = check_signup_guards(ip_address, fingerprint, row["email"])
        if not allowed:
            return jsonify({"success": False, "error": reason}), 400

        existing = conn.execute(
            "SELECT id FROM users WHERE google_sub = ? OR email = ?",
            (row["google_sub"], row["email"]),
        ).fetchone()
        if existing:
            conn.execute("UPDATE google_signup_tokens SET used_at = ? WHERE token = ?", (utc_now().isoformat(), token))
            conn.commit()
            return jsonify({"success": False, "error": "An account with this Google email already exists"}), 409

        now = utc_now()
        reset_at = (now + timedelta(days=30)).isoformat()
        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        cur = conn.execute(
            """
            INSERT INTO users
            (email, password, name, initials, role, plan, credits_used, credits_limit,
             reset_at, login_provider, google_sub, avatar_url, email_verified, created_at, status)
            VALUES (?, ?, ?, ?, 'user', 'Free Trial', 0, 200, ?, 'google', ?, ?, 1, ?, 'active')
            """,
            (
                row["email"],
                password_hash,
                name,
                initials_from_name(name, row["email"]),
                reset_at,
                row["google_sub"],
                row["avatar_url"],
                now.isoformat(),
            ),
        )
        user_id = cur.lastrowid
        conn.execute("UPDATE google_signup_tokens SET used_at = ? WHERE token = ?", (now.isoformat(), token))
        last_login_at = record_login(conn, user_id, "google")
        conn.commit()

        try:
            record_signup_guard(user_id, ip_address, fingerprint, row["email"])
        except Exception as guard_exc:
            print(f"Failed to record signup guard: {guard_exc}")

        user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        jwt_token = issue_access_token(user_id, user['role'])
        payload = user_payload(user)
        payload["lastLoginAt"] = last_login_at
        return jsonify({"success": True, "user": payload, "token": jwt_token})
    except Exception as exc:
        conn.rollback()
        print(f"Google signup completion failed: {exc}")
        return jsonify({"success": False, "error": "Could not complete Google signup"}), 500
    finally:
        conn.close()


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
            SELECT
                u.id,
                u.email,
                u.password,
                u.name,
                u.initials,
                u.role,
                u.plan,
                u.credits_used,
                u.credits_limit,
                u.reset_at,
                u.login_provider,
                u.google_sub,
                u.avatar_url,
                u.email_verified,
                u.last_login_at,
                u.created_at,
                u.status,
                olt.expires_at AS oauth_expires_at,
                olt.used_at AS oauth_used_at
            FROM oauth_login_tokens olt
            JOIN users u ON u.id = olt.user_id
            WHERE olt.token = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            return jsonify({"success": False, "error": "Invalid Google login token"}), 400
        if row["oauth_used_at"]:
            return jsonify({"success": False, "error": "Google login token was already used"}), 400
        if datetime.fromisoformat(row["oauth_expires_at"]) < utc_now():
            return jsonify({"success": False, "error": "Google login token expired"}), 400

        conn.execute(
            "UPDATE oauth_login_tokens SET used_at = ? WHERE token = ?",
            (utc_now().isoformat(), token),
        )
        conn.commit()
        jwt_token = issue_access_token(row['id'], row['role'])
        return jsonify({"success": True, "user": user_payload(row), "token": jwt_token})
    except Exception as exc:
        conn.rollback()
        print(f"Google token exchange failed: {exc}")
        return jsonify({"success": False, "error": "Could not exchange Google login token"}), 500
    finally:
        conn.close()
