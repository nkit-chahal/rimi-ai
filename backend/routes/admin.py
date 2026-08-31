"""Admin routes: login, logs, users, credit management, health check."""
import hashlib
import json
import os
import random
import sqlite3
import smtplib
from email.message import EmailMessage
from flask import Blueprint, request, jsonify, g
from datetime import datetime, timezone, timedelta

import bcrypt

from auth import CREDIT_EXPIRY_DAYS, _parse_reset_at, credit_expiry_reset_at, extend_credit_expiry
from db import DEFAULT_CREDIT_PRICING, db, rows_to_dicts
from jwt_tokens import issue_access_token
from middleware import admin_required, login_required
from rate_limits import login_rate_limit, signup_request_rate_limit, signup_verify_rate_limit

bp = Blueprint('admin', __name__)

VALID_ROLES = {'user', 'admin'}
VALID_STATUSES = {'active', 'suspended'}
SIGNUP_DEFAULT_CREDITS = int(os.getenv("SIGNUP_DEFAULT_CREDITS", "200"))
SIGNUP_OTP_TTL_MINUTES = int(os.getenv("SIGNUP_OTP_TTL_MINUTES", "10"))


def _initials_from_name(name):
    return ''.join(w[0].upper() for w in (name or '').split()[:2]) or 'U'


def _safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _compute_reset_days(reset_at_raw, default=30):
    """Days until reset_at (UTC date). Uses _parse_reset_at so Z/+00:00 strings parse correctly."""
    reset_at = _parse_reset_at(reset_at_raw)
    if reset_at is None:
        return default
    today = datetime.now(timezone.utc).replace(tzinfo=None).date()
    return max(0, (reset_at.date() - today).days)


def _is_unique_violation(exc):
    text = str(exc).lower()
    return isinstance(exc, sqlite3.IntegrityError) or 'unique' in text or 'duplicate' in text


def _otp_hash(email, otp):
    from jwt_tokens import JWT_SECRET as secret
    return hashlib.sha256(f"{email.lower()}:{otp}:{secret}".encode("utf-8")).hexdigest()


def _smtp_configured():
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"))


def _send_signup_otp(email, otp):
    if not _smtp_configured():
        return False

    msg = EmailMessage()
    msg["Subject"] = "Your RIMI AI verification code"
    msg["From"] = os.getenv("SMTP_FROM", os.getenv("SMTP_USER"))
    msg["To"] = email
    msg.set_content(
        f"Your RIMI AI verification code is {otp}.\n\n"
        f"This code expires in {SIGNUP_OTP_TTL_MINUTES} minutes."
    )

    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    if use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=15) as server:
            server.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD"))
            server.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.starttls()
            server.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD"))
            server.send_message(msg)
    return True


def _active_admin_count(conn, excluding_user_id=None):
    if excluding_user_id is None:
        row = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'").fetchone()
    else:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active' AND id != ?",
            (excluding_user_id,),
        ).fetchone()
    return row["c"] if isinstance(row, dict) else row[0]


def _record_admin_audit(conn, action, target_user_id=None, details=None):
    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    conn.execute(
        """
        INSERT INTO admin_audit_events
        (admin_user_id, target_user_id, action, details_json, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            g.current_user.get("id"),
            target_user_id,
            action,
            json.dumps(details or {}, sort_keys=True),
            request.headers.get("X-Forwarded-For", request.remote_addr),
            request.headers.get("User-Agent", ""),
            created_at,
        ),
    )


# --------------- Authentication & Administrator Endpoints ---------------

def _record_login_event(conn, user_id, provider):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
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


@bp.route('/api/login', methods=['POST'])
@login_rate_limit
def api_login():
    data = request.get_json() or {}
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'success': False, 'error': 'Email and password are required'}), 400
        
    conn = db()
    try:
        user_row = conn.execute("SELECT * FROM users WHERE email = ?", (email.strip(),)).fetchone()
        if user_row:
            user = dict(user_row)
            if user.get("status") in ("suspended", "banned"):
                return jsonify({'success': False, 'error': 'Account is suspended'}), 403
            stored_pw = user['password']
            if not stored_pw.startswith('$2'):
                return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
            pw_ok = bcrypt.checkpw(password.encode('utf-8'), stored_pw.encode('utf-8'))
            if pw_ok:
                last_login_at = _record_login_event(conn, user["id"], "email")
                conn.commit()
                reset_days = _compute_reset_days(user.get("reset_at"))

                from plan_tiers import attach_tier_fields
                user_payload = attach_tier_fields({
                    "id": user["id"],
                    "email": user["email"],
                    "role": user["role"],
                    "name": user["name"],
                    "initials": user["initials"],
                    "plan": user["plan"],
                    "creditsUsed": user["credits_used"],
                    "creditsLimit": user["credits_limit"],
                    "resetDays": reset_days,
                    "loginProvider": user.get("login_provider", "email"),
                    "avatarUrl": user.get("avatar_url"),
                    "emailVerified": bool(user.get("email_verified", 0)),
                    "lastLoginAt": last_login_at,
                })
                token = issue_access_token(user['id'], user['role'])
                return jsonify({'success': True, 'user': user_payload, 'token': token})
        return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
    except Exception as e:
        print(f"Error during login: {e}")
        return jsonify({'success': False, 'error': 'Login failed. Please try again.'}), 500
    finally:
        conn.close()


@bp.route('/api/signup/request-otp', methods=['POST'])
@signup_request_rate_limit
def signup_request_otp():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    name = (data.get('name') or '').strip()
    fingerprint = data.get('fingerprint', '')

    if not email or not password or not name:
        return jsonify({'success': False, 'error': 'Name, email, and password are required'}), 400
    if '@' not in email or '.' not in email.rsplit('@', 1)[-1]:
        return jsonify({'success': False, 'error': 'Enter a valid email address'}), 400
    if len(password) < 8:
        return jsonify({'success': False, 'error': 'Password must be at least 8 characters'}), 400

    from signup_guard import check_signup_guards, get_client_ip
    ip_address = get_client_ip()
    allowed, reason = check_signup_guards(ip_address, fingerprint, email)
    if not allowed:
        return jsonify({'success': False, 'error': reason}), 400

    conn = db()
    try:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            return jsonify({'success': False, 'error': 'An account with this email already exists'}), 409

        otp = f"{random.randint(0, 999999):06d}"
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        expires_at = (now + timedelta(minutes=SIGNUP_OTP_TTL_MINUTES)).isoformat()
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        otp_hash = _otp_hash(email, otp)
        conn.execute(
            """
            INSERT INTO email_otps (email, otp_hash, name, password_hash, attempts, expires_at, created_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
                otp_hash = excluded.otp_hash,
                name = excluded.name,
                password_hash = excluded.password_hash,
                attempts = 0,
                expires_at = excluded.expires_at,
                created_at = excluded.created_at
            """,
            (email, otp_hash, name, password_hash, expires_at, now.isoformat()),
        )
        sent_email = _send_signup_otp(email, otp)
        conn.commit()
        response = {
            'success': True,
            'message': 'Verification code sent. Check your email.',
            'emailSent': sent_email,
            'expiresInMinutes': SIGNUP_OTP_TTL_MINUTES,
        }
        if not sent_email and os.getenv('FLASK_ENV') != 'production':
            response['devOtp'] = otp
            response['message'] = 'Email service is not configured. Use the development OTP shown here.'
        elif not sent_email:
            response['message'] = 'Email service is not configured. Contact support if you did not receive a code.'
        return jsonify(response)
    except Exception as e:
        conn.rollback()
        print(f"Error requesting signup OTP: {e}")
        return jsonify({'success': False, 'error': 'Could not start signup. Please try again.'}), 500
    finally:
        conn.close()


@bp.route('/api/signup/verify-otp', methods=['POST'])
@signup_verify_rate_limit
def signup_verify_otp():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    otp = (data.get('otp') or '').strip()
    fingerprint = data.get('fingerprint', '')

    if not email or not otp:
        return jsonify({'success': False, 'error': 'Email and verification code are required'}), 400

    conn = db()
    try:
        pending_row = conn.execute("SELECT * FROM email_otps WHERE email = ?", (email,)).fetchone()
        if not pending_row:
            return jsonify({'success': False, 'error': 'No pending signup was found for this email'}), 404
        pending = dict(pending_row)
        expires_at = datetime.fromisoformat(pending["expires_at"])
        if expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
            conn.execute("DELETE FROM email_otps WHERE email = ?", (email,))
            conn.commit()
            return jsonify({'success': False, 'error': 'Verification code expired. Request a new code.'}), 400
        if pending["attempts"] >= 5:
            return jsonify({'success': False, 'error': 'Too many attempts. Request a new code.'}), 429
        if _otp_hash(email, otp) != pending["otp_hash"]:
            conn.execute("UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?", (email,))
            conn.commit()
            return jsonify({'success': False, 'error': 'Invalid verification code'}), 400

        from signup_guard import check_signup_guards, record_signup_guard, get_client_ip
        ip_address = get_client_ip()
        allowed, reason = check_signup_guards(ip_address, fingerprint, email)
        if not allowed:
            return jsonify({'success': False, 'error': reason}), 400

        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            conn.execute("DELETE FROM email_otps WHERE email = ?", (email,))
            conn.commit()
            return jsonify({'success': False, 'error': 'An account with this email already exists'}), 409

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        reset_at = credit_expiry_reset_at(now)
        initials = _initials_from_name(pending["name"])
        cur = conn.execute(
            """
            INSERT INTO users
            (email, password, name, initials, role, plan, credits_used, credits_limit, reset_at,
             login_provider, email_verified, created_at, status)
            VALUES (?, ?, ?, ?, 'user', 'Free Trial', 0, ?, ?, 'email', 1, ?, 'active')
            """,
            (email, pending["password_hash"], pending["name"], initials, SIGNUP_DEFAULT_CREDITS, reset_at, now.isoformat()),
        )
        user_id = cur.lastrowid
        conn.execute("DELETE FROM email_otps WHERE email = ?", (email,))
        conn.commit()

        try:
            record_signup_guard(user_id, ip_address, fingerprint, email)
        except Exception as guard_exc:
            print(f"Failed to record signup guard: {guard_exc}")

        return jsonify({'success': True, 'message': 'Email verified. You can sign in now.'})
    except Exception as e:
        conn.rollback()
        print(f"Error verifying signup OTP: {e}")
        return jsonify({'success': False, 'error': 'Could not verify signup. Please try again.'}), 500
    finally:
        conn.close()


@bp.route('/api/admin/logs', methods=['GET'])
@admin_required
def admin_logs():
    try:
        limit = max(1, min(100, int(request.args.get('limit', 50))))
    except (TypeError, ValueError):
        limit = 50
    try:
        page = max(1, int(request.args.get('page', 1)))
    except (TypeError, ValueError):
        page = 1
    offset = (page - 1) * limit
    include_exports = request.args.get('exports', '0') in ('1', 'true', 'yes')

    conn = db()
    try:
        replicate_total = conn.execute("SELECT COUNT(*) AS c FROM replicate_logs").fetchone()
        replicate_total = int((replicate_total["c"] if isinstance(replicate_total, dict) else replicate_total[0]) or 0)
        replicate_logs_rows = conn.execute(
            "SELECT * FROM replicate_logs ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()

        exports = []
        exports_total = 0
        if include_exports:
            exports_total_row = conn.execute("SELECT COUNT(*) AS c FROM exports WHERE deleted_at IS NULL").fetchone()
            exports_total = int((exports_total_row["c"] if isinstance(exports_total_row, dict) else exports_total_row[0]) or 0)
            exports_rows = conn.execute(
                "SELECT * FROM exports WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
            exports = rows_to_dicts(exports_rows)

        login_event_rows = conn.execute("""
            SELECT
                le.*,
                u.name AS user_name,
                u.email AS user_email
            FROM login_events le
            LEFT JOIN users u ON u.id = le.user_id
            ORDER BY le.created_at DESC
            LIMIT ?
        """, (limit,)).fetchall()
        admin_audit_rows = conn.execute("""
            SELECT
                a.*,
                admin.name AS admin_name,
                admin.email AS admin_email,
                target.name AS target_user_name,
                target.email AS target_user_email
            FROM admin_audit_events a
            LEFT JOIN users admin ON admin.id = a.admin_user_id
            LEFT JOIN users target ON target.id = a.target_user_id
            ORDER BY a.created_at DESC
            LIMIT ?
        """, (limit,)).fetchall()

        return jsonify({
            'success': True,
            'page': page,
            'limit': limit,
            'replicateLogs': rows_to_dicts(replicate_logs_rows),
            'replicateTotal': replicate_total,
            'exports': exports,
            'exportsTotal': exports_total,
            'loginEvents': rows_to_dicts(login_event_rows),
            'adminAuditEvents': rows_to_dicts(admin_audit_rows),
        })
    except Exception as e:
        print(f"Error fetching admin logs: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


@bp.route('/api/admin/projects', methods=['GET'])
@admin_required
def admin_projects():
    conn = db()
    try:
        projects = rows_to_dicts(conn.execute("""
            SELECT p.*, u.name AS userName 
            FROM projects p
            LEFT JOIN users u ON u.id = p.user_id
            ORDER BY p.updated_at DESC
        """).fetchall())
        return jsonify({'success': True, 'projects': projects})
    except Exception as e:
        print(f"Error fetching admin projects: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


@bp.route('/api/admin/budget', methods=['GET', 'POST', 'OPTIONS'])
@admin_required
def admin_budget():
    if request.method == 'OPTIONS':
        return jsonify({'success': True})

    settings_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'admin_settings.json')
    
    # Handle POST to update budget
    if request.method == 'POST':
        data = request.get_json() or {}
        try:
            budget = float(data.get('budget', 50.0))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Invalid budget value'}), 400
        
        try:
            with open(settings_path, 'w') as f:
                json.dump({'budget': budget}, f)
        except Exception as e:
            print(f"Failed to write admin settings: {e}")
    else:
        # Handle GET - read budget
        budget = 50.0  # default
        if os.path.exists(settings_path):
            try:
                with open(settings_path, 'r') as f:
                    config = json.load(f)
                    budget = float(config.get('budget', 50.0))
            except Exception as e:
                print(f"Failed to read admin settings: {e}")

    # Query replicate logs for total cost
    conn = db()
    try:
        row = conn.execute("SELECT SUM(cost_usd) AS total_spent FROM replicate_logs").fetchone()
        total_spent = float(row['total_spent'] or 0.0) if row else 0.0
    except Exception as e:
        print(f"Error querying replicate logs: {e}")
        total_spent = 0.0
    finally:
        conn.close()

    remaining = budget - total_spent
    return jsonify({
        'success': True,
        'budget': budget,
        'totalSpent': total_spent,
        'remaining': remaining
    })


@bp.route('/api/admin/qwen-burn', methods=['GET'])
@admin_required
def admin_qwen_burn():
    """Aggregate Qwen-related replicate spend and output volume."""
    conn = db()
    try:
        qwen_models = (
            'qwen/qwen-image-layered',
            'qwen/qwen-image-edit',
            'fofr/style-transfer',
        )
        placeholders = ','.join('?' for _ in qwen_models)
        # Prefer PostgreSQL-compatible date math; SQLite still accepts this ISO compare.
        since_7d = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)).isoformat()
        row = conn.execute(
            f"""
            SELECT
                COUNT(*) AS call_count,
                COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
                COALESCE(SUM(credits), 0) AS total_credits,
                COALESCE(SUM(output_bytes), 0) AS total_output_bytes
            FROM replicate_logs
            WHERE model_name IN ({placeholders})
               OR session_id IS NOT NULL
            """,
            qwen_models,
        ).fetchone()
        session_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM qwen_layered_sessions"
        ).fetchone()
        version_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM qwen_layer_versions"
        ).fetchone()
        last_7d = conn.execute(
            f"""
            SELECT COALESCE(SUM(cost_usd), 0) AS burn_7d
            FROM replicate_logs
            WHERE (model_name IN ({placeholders}) OR session_id IS NOT NULL)
              AND created_at >= ?
            """,
            (*qwen_models, since_7d),
        ).fetchone()
    except Exception as e:
        print(f"Error fetching qwen burn: {e}")
        return jsonify({'success': False, 'error': 'Unable to load Qwen burn stats'}), 500
    finally:
        conn.close()

    return jsonify({
        'success': True,
        'callCount': int(row['call_count'] or 0) if row else 0,
        'totalCostUsd': float(row['total_cost_usd'] or 0) if row else 0.0,
        'totalCredits': int(row['total_credits'] or 0) if row else 0,
        'totalOutputBytes': int(row['total_output_bytes'] or 0) if row else 0,
        'sessionCount': int(session_count['cnt'] or 0) if session_count else 0,
        'versionCount': int(version_count['cnt'] or 0) if version_count else 0,
        'burnLast7DaysUsd': float(last_7d['burn_7d'] or 0) if last_7d else 0.0,
    })


@bp.route('/api/admin/users', methods=['GET'])
@admin_required
def admin_users():
    conn = db()
    try:
        users_rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
        users = []
        for row in users_rows:
            u = dict(row)
            reset_days = _compute_reset_days(u.get("reset_at"))
            users.append({
                "id": u["id"],
                "email": u["email"],
                "name": u["name"],
                "initials": u["initials"],
                "role": u["role"],
                "plan": u["plan"],
                "creditsUsed": u["credits_used"],
                "creditsLimit": u["credits_limit"],
                "resetDays": reset_days,
                "resetAt": u.get("reset_at"),
                "loginProvider": u.get("login_provider", "email"),
                "googleSub": u.get("google_sub"),
                "avatarUrl": u.get("avatar_url"),
                "emailVerified": bool(u.get("email_verified", 0)),
                "lastLoginAt": u.get("last_login_at"),
                "createdAt": u.get("created_at"),
                "status": u.get("status", "active")
            })
        return jsonify({'success': True, 'users': users})
    except Exception as e:
        print(f"Error fetching admin users: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


@bp.route('/api/admin/adjust-credits', methods=['POST'])
@admin_required
def admin_adjust_credits():
    data = request.get_json() or {}
    user_id = data.get('userId')
    credits_limit = data.get('creditsLimit')
    
    if user_id is None or credits_limit is None:
        return jsonify({'success': False, 'error': 'userId and creditsLimit are required'}), 400
        
    try:
        user_id = int(user_id)
        credits_limit = int(credits_limit)
    except ValueError:
        return jsonify({'success': False, 'error': 'userId and creditsLimit must be integers'}), 400

    if credits_limit < 0:
        return jsonify({'success': False, 'error': 'Credit limit cannot be negative'}), 400
        
    conn = db()
    try:
        existing_user = conn.execute(
            "SELECT credits_limit, credits_used FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not existing_user:
            return jsonify({'success': False, 'error': 'User not found'}), 404

        previous_limit = existing_user["credits_limit"]
        previous_used = int(existing_user["credits_used"] or 0)
        clamped_used = min(previous_used, credits_limit)
        created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

        conn.execute(
            "UPDATE users SET credits_limit = ?, credits_used = ? WHERE id = ?",
            (credits_limit, clamped_used, user_id),
        )
        delta = credits_limit - previous_limit
        conn.execute(
            """
            INSERT INTO credit_transactions
            (user_id, transaction_type, credits, note, created_at)
            VALUES (?, 'admin_adjustment', ?, ?, ?)
            """,
            (user_id, delta, "Admin credit limit adjustment", created_at),
        )
        if previous_limit is not None and credits_limit > previous_limit:
            extend_credit_expiry(user_id, conn=conn)
        _record_admin_audit(
            conn,
            "credits.adjust",
            target_user_id=user_id,
            details={
                "previousCreditsLimit": previous_limit,
                "creditsLimit": credits_limit,
                "delta": delta,
                "previousCreditsUsed": previous_used,
                "creditsUsed": clamped_used,
                "clampedUsed": clamped_used < previous_used,
            },
        )
        conn.commit()
        return jsonify({
            'success': True,
            'message': 'Credits limit updated successfully',
            'creditsLimit': credits_limit,
            'creditsUsed': clamped_used,
        })
    except Exception as e:
        print(f"Error adjusting credits: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


@bp.route('/api/admin/extend-expiry', methods=['POST'])
@admin_required
def admin_extend_expiry():
    data = request.get_json() or {}
    user_id = data.get('userId')
    if user_id is None:
        return jsonify({'success': False, 'error': 'userId is required'}), 400
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'userId must be an integer'}), 400

    conn = db()
    try:
        existing = conn.execute(
            "SELECT id, reset_at, credits_used, credits_limit FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not existing:
            return jsonify({'success': False, 'error': 'User not found'}), 404

        previous_reset_at = existing["reset_at"]
        previous_used = int(existing["credits_used"] or 0)
        credits_limit = int(existing["credits_limit"] or 0)
        new_reset_at = extend_credit_expiry(user_id, conn=conn)
        if not new_reset_at:
            return jsonify({'success': False, 'error': 'Failed to extend expiry'}), 500

        # Admin renew: bump window and restore full remaining balance for the new period.
        created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn.execute(
            "UPDATE users SET credits_used = 0 WHERE id = ?",
            (user_id,),
        )
        if previous_used > 0:
            conn.execute(
                """
                INSERT INTO credit_transactions
                (user_id, transaction_type, credits, note, created_at)
                VALUES (?, 'admin_adjustment', ?, ?, ?)
                """,
                (
                    user_id,
                    previous_used,
                    "Admin expiry extend — credits restored",
                    created_at,
                ),
            )

        reset_days = _compute_reset_days(new_reset_at)
        _record_admin_audit(
            conn,
            "credits.extend_expiry",
            target_user_id=user_id,
            details={
                "previousResetAt": previous_reset_at,
                "resetAt": new_reset_at,
                "resetDays": reset_days,
                "extendedByDays": CREDIT_EXPIRY_DAYS,
                "previousCreditsUsed": previous_used,
                "creditsUsed": 0,
                "creditsLimit": credits_limit,
                "creditsRestored": True,
            },
        )
        conn.commit()
        return jsonify({
            'success': True,
            'message': (
                f'Credit expiry extended by {CREDIT_EXPIRY_DAYS} days '
                'and remaining credits restored to full limit'
            ),
            'resetAt': new_reset_at,
            'resetDays': reset_days,
            'creditsUsed': 0,
            'creditsLimit': credits_limit,
        })
    except Exception as e:
        print(f"Error extending credit expiry: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


@bp.route('/api/admin/billing-overview', methods=['GET'])
@admin_required
def admin_billing_overview():
    conn = db()
    try:
        users = rows_to_dicts(conn.execute("""
            SELECT id, email, name, initials, role, plan, credits_used, credits_limit,
                   reset_at, login_provider, avatar_url, email_verified, last_login_at, created_at
            FROM users
            ORDER BY id
        """).fetchall())

        usage_rows = conn.execute("""
            SELECT
                user_id,
                COUNT(CASE WHEN transaction_type IN ('generation', 'export') THEN 1 END) AS api_calls,
                COALESCE(SUM(CASE WHEN credits < 0 THEN -credits ELSE 0 END), 0) AS credits_spent,
                COALESCE(SUM(CASE WHEN transaction_type IN ('recharge', 'admin_adjustment') AND credits > 0 THEN credits ELSE 0 END), 0) AS credits_added,
                COALESCE(SUM(CASE WHEN transaction_type = 'recharge' AND credits > 0 THEN credits ELSE 0 END), 0) AS recharge_credits
            FROM credit_transactions
            GROUP BY user_id
        """).fetchall()
        usage_by_user = {row["user_id"]: dict(row) for row in usage_rows}

        payment_rows = rows_to_dicts(conn.execute("""
            SELECT
                p.*,
                u.name AS user_name,
                u.email AS user_email
            FROM payments p
            LEFT JOIN users u ON u.id = p.user_id
            ORDER BY p.created_at DESC
            LIMIT 100
        """).fetchall())

        recent_transactions = rows_to_dicts(conn.execute("""
            SELECT
                ct.*,
                u.name AS user_name,
                u.email AS user_email
            FROM credit_transactions ct
            LEFT JOIN users u ON u.id = ct.user_id
            ORDER BY ct.created_at DESC
            LIMIT 150
        """).fetchall())

        payment_summary = conn.execute("""
            SELECT
                COUNT(*) AS total_orders,
                COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_orders,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid_amount,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN credits ELSE 0 END), 0) AS paid_credits
            FROM payments
        """).fetchone()

        total_api_calls = 0
        total_credits_spent = 0
        total_recharge_credits = 0
        user_summaries = []
        for user in users:
            usage = usage_by_user.get(user["id"], {})
            api_calls = int(usage.get("api_calls") or 0)
            credits_spent = int(usage.get("credits_spent") or user["credits_used"] or 0)
            recharge_credits = int(usage.get("recharge_credits") or 0)
            total_api_calls += api_calls
            total_credits_spent += credits_spent
            total_recharge_credits += recharge_credits
            user_summaries.append({
                "id": user["id"],
                "email": user["email"],
                "name": user["name"],
                "initials": user["initials"],
                "role": user["role"],
                "plan": user["plan"],
                "creditsUsed": user["credits_used"],
                "creditsLimit": user["credits_limit"],
                "apiCalls": api_calls,
                "creditsSpent": credits_spent,
                "creditsAdded": int(usage.get("credits_added") or 0),
                "rechargeCredits": recharge_credits,
                "remainingCredits": max(0, user["credits_limit"] - user["credits_used"]),
                "loginProvider": user.get("login_provider", "email"),
                "avatarUrl": user.get("avatar_url"),
                "emailVerified": bool(user.get("email_verified", 0)),
                "lastLoginAt": user.get("last_login_at"),
                "createdAt": user.get("created_at"),
            })

        return jsonify({
            'success': True,
            'summary': {
                'totalUsers': len(users),
                'totalApiCalls': total_api_calls,
                'totalCreditsSpent': total_credits_spent,
                'totalRechargeCredits': total_recharge_credits,
                'totalOrders': payment_summary["total_orders"],
                'paidOrders': payment_summary["paid_orders"],
                'paidAmount': payment_summary["paid_amount"],
                'paidCredits': payment_summary["paid_credits"],
            },
            'users': user_summaries,
            'payments': payment_rows,
            'transactions': recent_transactions,
        })
    except Exception as e:
        print(f"Error fetching billing overview: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


# --------------- Credit Pricing ---------------
@bp.route('/api/credit-pricing')
def credit_pricing():
    """Returns active credit pricing mapped by frontend tool key."""
    conn = db()
    try:
        rows = rows_to_dicts(conn.execute("""
            SELECT tool_key, label, api_name, credits, pricing_type, is_active, updated_at
            FROM credit_pricing
            WHERE is_active = 1
            ORDER BY label ASC
        """).fetchall())
    finally:
        conn.close()

    pricing = {tool_key: credits for tool_key, _label, _api, credits, _type, active in DEFAULT_CREDIT_PRICING if active}
    for row in rows:
        pricing[row["tool_key"]] = int(row["credits"])

    return jsonify({'success': True, 'pricing': pricing, 'rows': rows})


@bp.route('/api/admin/credit-pricing', methods=['GET'])
@admin_required
def admin_credit_pricing():
    conn = db()
    try:
        rows = rows_to_dicts(conn.execute("""
            SELECT tool_key, label, api_name, credits, pricing_type, is_active, updated_at
            FROM credit_pricing
            ORDER BY label ASC
        """).fetchall())
        return jsonify({'success': True, 'pricing': rows})
    finally:
        conn.close()


@bp.route('/api/admin/credit-pricing/<tool_key>', methods=['PUT'])
@admin_required
def admin_update_credit_pricing(tool_key):
    data = request.json or {}
    label = (data.get('label') or '').strip()
    api_name = (data.get('apiName') or data.get('api_name') or '').strip()
    pricing_type = (data.get('pricingType') or data.get('pricing_type') or 'fixed').strip().lower()
    credits = _safe_int(data.get('credits'), -1)
    is_active = 1 if data.get('isActive', data.get('is_active', True)) else 0

    if not tool_key:
        return jsonify({'success': False, 'error': 'Tool key is required'}), 400
    if not label:
        return jsonify({'success': False, 'error': 'Label is required'}), 400
    if credits < 0:
        return jsonify({'success': False, 'error': 'Credits must be zero or greater'}), 400
    if pricing_type not in {'fixed', 'dynamic'}:
        return jsonify({'success': False, 'error': 'Pricing type must be fixed or dynamic'}), 400

    conn = db()
    try:
        existing = conn.execute(
            "SELECT tool_key, label, api_name, credits, pricing_type, is_active FROM credit_pricing WHERE tool_key = ?",
            (tool_key,),
        ).fetchone()
        if not existing:
            return jsonify({'success': False, 'error': 'Pricing row not found'}), 404

        updated_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        conn.execute(
            """
            UPDATE credit_pricing
            SET label = ?, api_name = ?, credits = ?, pricing_type = ?, is_active = ?, updated_at = ?
            WHERE tool_key = ?
            """,
            (label, api_name, credits, pricing_type, is_active, updated_at, tool_key),
        )
        _record_admin_audit(conn, "credit_pricing.update", details={
            "toolKey": tool_key,
            "before": dict(existing),
            "after": {
                "label": label,
                "api_name": api_name,
                "credits": credits,
                "pricing_type": pricing_type,
                "is_active": is_active,
            },
        })
        conn.commit()
        return jsonify({'success': True, 'message': 'Credit pricing updated'})
    except Exception as e:
        conn.rollback()
        print(f"Error updating credit pricing: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


# --------------- Admin Create User ---------------
@bp.route('/api/admin/create-user', methods=['POST'])
@admin_required
def admin_create_user():
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    name = data.get('name', '').strip()
    role = data.get('role', 'user')
    plan = data.get('plan', 'Business Studio')
    credits_limit = _safe_int(data.get('creditsLimit'), 25000)
    status = data.get('status', 'active')

    if not email or not password or not name:
        return jsonify({'success': False, 'error': 'Email, password, and name are required'}), 400
    if role not in VALID_ROLES:
        return jsonify({'success': False, 'error': 'Invalid role'}), 400
    if status not in VALID_STATUSES:
        return jsonify({'success': False, 'error': 'Invalid status'}), 400
    if credits_limit < 0:
        return jsonify({'success': False, 'error': 'Credit limit cannot be negative'}), 400

    initials = _initials_from_name(name)
    reset_at = credit_expiry_reset_at()

    conn = db()
    try:
        hashed_pw = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cur = conn.execute(
            "INSERT INTO users (email, password, name, initials, role, plan, credits_used, credits_limit, reset_at, status) VALUES (?,?,?,?,?,?,0,?,?,?)",
            (email, hashed_pw, name, initials, role, plan, credits_limit, reset_at, status)
        )
        _record_admin_audit(
            conn,
            "user.create",
            target_user_id=cur.lastrowid,
            details={"email": email, "name": name, "role": role, "plan": plan, "creditsLimit": credits_limit, "status": status},
        )
        conn.commit()
        return jsonify({'success': True, 'message': f'User {name} created successfully'})
    except Exception as e:
        if _is_unique_violation(e):
            conn.rollback()
            return jsonify({'success': False, 'error': 'A user with this email already exists'}), 400
        conn.rollback()
        print(f"Error creating user: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


@bp.route('/api/admin/users/<int:user_id>', methods=['PUT'])
@admin_required
def admin_update_user(user_id):
    data = request.get_json() or {}
    conn = db()
    try:
        existing = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not existing:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        existing = dict(existing)

        email = data.get('email', existing['email'])
        email = email.strip().lower() if isinstance(email, str) else existing['email']
        name = data.get('name', existing['name'])
        name = name.strip() if isinstance(name, str) else existing['name']
        role = data.get('role', existing['role'])
        plan = data.get('plan', existing['plan'])
        status = data.get('status', existing.get('status', 'active'))
        credits_limit = _safe_int(data.get('creditsLimit'), existing['credits_limit'])
        password = data.get('password', '')
        previous_used = int(existing.get('credits_used') or 0)
        if 'creditsUsed' in data:
            try:
                raw_credits_used = data['creditsUsed']
                if isinstance(raw_credits_used, bool):
                    raise ValueError
                credits_used = int(raw_credits_used)
                if isinstance(raw_credits_used, float) and raw_credits_used != credits_used:
                    raise ValueError
            except (TypeError, ValueError):
                return jsonify({'success': False, 'error': 'Credits used must be an integer'}), 400
        else:
            # Keep older clients compatible while preserving the database invariant.
            credits_used = min(previous_used, credits_limit)

        if not email or not name:
            return jsonify({'success': False, 'error': 'Email and name are required'}), 400
        if role not in VALID_ROLES:
            return jsonify({'success': False, 'error': 'Invalid role'}), 400
        if status not in VALID_STATUSES:
            return jsonify({'success': False, 'error': 'Invalid status'}), 400
        if credits_limit < 0:
            return jsonify({'success': False, 'error': 'Credit limit cannot be negative'}), 400
        if credits_used < 0:
            return jsonify({'success': False, 'error': 'Credits used cannot be negative'}), 400
        if credits_used > credits_limit:
            return jsonify({'success': False, 'error': 'Credits used cannot exceed the credit limit'}), 400
        if existing['role'] == 'admin' and (role != 'admin' or status != 'active') and _active_admin_count(conn, user_id) == 0:
            return jsonify({'success': False, 'error': 'Cannot remove or suspend the last active admin'}), 403
        if user_id == g.current_user['id'] and status != 'active':
            return jsonify({'success': False, 'error': 'Cannot suspend your own admin account'}), 403

        initials = _initials_from_name(name)
        updates = [
            "email = ?",
            "name = ?",
            "initials = ?",
            "role = ?",
            "plan = ?",
            "credits_limit = ?",
            "credits_used = ?",
            "status = ?",
        ]
        values = [email, name, initials, role, plan, credits_limit, credits_used, status]
        changed = {
            "email": {"from": existing["email"], "to": email},
            "name": {"from": existing["name"], "to": name},
            "role": {"from": existing["role"], "to": role},
            "plan": {"from": existing["plan"], "to": plan},
            "creditsLimit": {"from": existing["credits_limit"], "to": credits_limit},
            "status": {"from": existing.get("status", "active"), "to": status},
        }
        if credits_used != previous_used:
            changed["creditsUsed"] = {"from": previous_used, "to": credits_used}
        changed = {key: value for key, value in changed.items() if value["from"] != value["to"]}
        if password:
            if len(password) < 8:
                return jsonify({'success': False, 'error': 'Password must be at least 8 characters'}), 400
            updates.append("password = ?")
            values.append(bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8'))
            changed["passwordReset"] = True
        values.append(user_id)

        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values)
        _record_admin_audit(conn, "user.update", target_user_id=user_id, details=changed)
        conn.commit()
        return jsonify({
            'success': True,
            'message': f'User {name} updated successfully',
            'creditsLimit': credits_limit,
            'creditsUsed': credits_used,
        })
    except Exception as e:
        if _is_unique_violation(e):
            conn.rollback()
            return jsonify({'success': False, 'error': 'A user with this email already exists'}), 400
        conn.rollback()
        print(f"Error updating user: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


# --------------- Admin Delete User ---------------
@bp.route('/api/admin/delete-user/<int:user_id>', methods=['DELETE'])
@admin_required
def admin_delete_user(user_id):
    conn = db()
    try:
        user = conn.execute("SELECT id, role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        if user_id == g.current_user['id']:
            return jsonify({'success': False, 'error': 'Cannot delete your own account'}), 403
        if user['role'] == 'admin':
            return jsonify({'success': False, 'error': 'Cannot delete admin users. Demote or suspend first.'}), 403

        cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        _record_admin_audit(
            conn,
            "user.delete",
            target_user_id=user_id,
            details={"role": user["role"]},
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        return jsonify({'success': True, 'message': 'User deleted successfully'})
    except Exception as e:
        conn.rollback()
        print(f"Error deleting user: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


# --------------- Admin Suspend / Unsuspend User ---------------
@bp.route('/api/admin/suspend-user/<int:user_id>', methods=['POST'])
@admin_required
def admin_suspend_user(user_id):
    conn = db()
    try:
        user = conn.execute("SELECT id, role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        if user_id == g.current_user['id']:
            return jsonify({'success': False, 'error': 'Cannot suspend your own account'}), 403
        if user['role'] == 'admin':
            return jsonify({'success': False, 'error': 'Cannot suspend admin users'}), 403
        conn.execute("UPDATE users SET status = 'suspended' WHERE id = ?", (user_id,))
        _record_admin_audit(conn, "user.suspend", target_user_id=user_id)
        conn.commit()
        return jsonify({'success': True, 'message': 'User suspended successfully'})
    except Exception as e:
        conn.rollback()
        print(f"Error suspending user: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


@bp.route('/api/admin/unsuspend-user/<int:user_id>', methods=['POST'])
@admin_required
def admin_unsuspend_user(user_id):
    conn = db()
    try:
        cur = conn.execute("UPDATE users SET status = 'active' WHERE id = ?", (user_id,))
        if cur.rowcount:
            _record_admin_audit(conn, "user.activate", target_user_id=user_id)
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        return jsonify({'success': True, 'message': 'User reactivated successfully'})
    except Exception as e:
        conn.rollback()
        print(f"Error unsuspending user: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


def _parse_day(value):
    if not value:
        return None
    try:
        text = str(value).replace("Z", "")
        return datetime.fromisoformat(text).date().isoformat()
    except Exception:
        try:
            return str(value)[:10]
        except Exception:
            return None


@bp.route('/api/admin/analytics', methods=['GET'])
@admin_required
def admin_analytics():
    """Chart-ready aggregates for the supervisor dashboard (last N days)."""
    try:
        days = max(1, min(90, int(request.args.get('days', 30))))
    except (TypeError, ValueError):
        days = 30

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    start_iso = start.isoformat()
    day_labels = [(start + timedelta(days=i)).date().isoformat() for i in range(days)]

    def empty_day_map():
        return {d: 0 for d in day_labels}

    feature_by_day = empty_day_map()
    feature_totals = {}
    spend_by_day = empty_day_map()
    calls_by_day = empty_day_map()
    cost_by_model = {}
    calls_by_model = {}
    logins_by_day = empty_day_map()
    revenue_by_day = empty_day_map()
    paid_orders = 0
    paid_amount = 0
    paid_credits = 0

    conn = db()
    try:
        export_rows = conn.execute(
            "SELECT tool_type, created_at FROM exports WHERE created_at >= ? ORDER BY id DESC",
            (start_iso,),
        ).fetchall()
        for row in export_rows:
            day = _parse_day(row["created_at"])
            tool = (row["tool_type"] or "Unknown").strip() or "Unknown"
            feature_totals[tool] = feature_totals.get(tool, 0) + 1
            if day in feature_by_day:
                feature_by_day[day] += 1

        replicate_rows = conn.execute(
            """
            SELECT model_name, cost_usd, credits, created_at
            FROM replicate_logs
            WHERE created_at >= ?
            ORDER BY id DESC
            """,
            (start_iso,),
        ).fetchall()
        for row in replicate_rows:
            day = _parse_day(row["created_at"])
            cost = float(row["cost_usd"] or 0)
            model = (row["model_name"] or "unknown").strip() or "unknown"
            cost_by_model[model] = cost_by_model.get(model, 0.0) + cost
            calls_by_model[model] = calls_by_model.get(model, 0) + 1
            if day in spend_by_day:
                spend_by_day[day] += cost
                calls_by_day[day] += 1

        login_rows = conn.execute(
            "SELECT created_at FROM login_events WHERE created_at >= ? ORDER BY id DESC",
            (start_iso,),
        ).fetchall()
        for row in login_rows:
            day = _parse_day(row["created_at"])
            if day in logins_by_day:
                logins_by_day[day] += 1

        payment_rows = conn.execute(
            """
            SELECT amount, credits, paid_at, created_at
            FROM payments
            WHERE status = 'paid'
              AND COALESCE(paid_at, created_at) >= ?
            ORDER BY id DESC
            """,
            (start_iso,),
        ).fetchall()
        for row in payment_rows:
            day = _parse_day(row["paid_at"] or row["created_at"])
            amount = int(row["amount"] or 0)
            credits = int(row["credits"] or 0)
            paid_orders += 1
            paid_amount += amount
            paid_credits += credits
            if day in revenue_by_day:
                revenue_by_day[day] += amount
    except Exception as e:
        print(f"Error building admin analytics: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()

    top_features = sorted(
        [{"tool": k, "count": v} for k, v in feature_totals.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:12]
    top_models = sorted(
        [
            {
                "model": k,
                "costUsd": round(v, 6),
                "count": int(calls_by_model.get(k, 0)),
            }
            for k, v in cost_by_model.items()
        ],
        key=lambda x: x["count"],
        reverse=True,
    )[:12]
    top_models_by_cost = sorted(top_models, key=lambda x: x["costUsd"], reverse=True)

    return jsonify({
        'success': True,
        'days': days,
        'labels': day_labels,
        'featureUsageByDay': [feature_by_day[d] for d in day_labels],
        'featureUsageByTool': top_features,
        'apiSpendByDay': [round(spend_by_day[d], 6) for d in day_labels],
        'apiCallsByDay': [calls_by_day[d] for d in day_labels],
        'costByModel': top_models_by_cost,
        'usageByModel': top_models,
        'loginsByDay': [logins_by_day[d] for d in day_labels],
        'revenueByDay': [revenue_by_day[d] for d in day_labels],
        'summary': {
            'featureExports': sum(feature_by_day.values()),
            'apiCalls': sum(calls_by_day.values()),
            'apiSpendUsd': round(sum(spend_by_day.values()), 6),
            'logins': sum(logins_by_day.values()),
            'paidOrders': paid_orders,
            'paidAmountPaise': paid_amount,
            'paidCredits': paid_credits,
        },
    })


# --------------- Health checks ---------------
@bp.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'service': 'RIMI AI Backend'})


@bp.route('/api/health/live')
def health_live():
    return jsonify({'status': 'ok', 'service': 'RIMI AI Backend'})


@bp.route('/api/health/ready')
def health_ready():
    checks = {}
    overall_ok = True

    conn = db()
    try:
        conn.execute("SELECT 1").fetchone()
        checks['database'] = 'ok'
    except Exception as exc:
        checks['database'] = f'error: {exc}'
        overall_ok = False
    finally:
        conn.close()

    redis_url = os.getenv('REDIS_URL') or os.getenv('RATELIMIT_STORAGE_URI', '')
    if redis_url.startswith(('redis://', 'rediss://')):
        try:
            from redis_client import redis_from_url
            client = redis_from_url(redis_url, socket_connect_timeout=2)
            client.ping()
            checks['redis'] = 'ok'
        except Exception as exc:
            checks['redis'] = f'error: {exc}'
            overall_ok = False
    else:
        checks['redis'] = 'skipped'

    status_code = 200 if overall_ok else 503
    return jsonify({
        'status': 'ok' if overall_ok else 'degraded',
        'service': 'RIMI AI Backend',
        'checks': checks,
    }), status_code
