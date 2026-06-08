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

from db import DEFAULT_CREDIT_PRICING, db, rows_to_dicts
from jwt_tokens import issue_access_token
from middleware import admin_required, login_required

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


def _is_unique_violation(exc):
    text = str(exc).lower()
    return isinstance(exc, sqlite3.IntegrityError) or 'unique' in text or 'duplicate' in text


def _otp_hash(email, otp):
    secret = os.getenv('JWT_SECRET', 'rimi-ai-dev-secret-change-in-production')
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
            pw_ok = False
            if stored_pw.startswith('$2'):
                pw_ok = bcrypt.checkpw(password.encode('utf-8'), stored_pw.encode('utf-8'))
            else:
                pw_ok = stored_pw == password
            if pw_ok:
                last_login_at = _record_login_event(conn, user["id"], "email")
                conn.commit()
                # Resolve resetDays
                try:
                    reset_at = datetime.fromisoformat(user["reset_at"])
                    reset_days = max(0, (reset_at.date() - datetime.now(timezone.utc).replace(tzinfo=None).date()).days)
                except Exception:
                    reset_days = 30
                    
                user_payload = {
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
                }
                token = issue_access_token(user['id'], user['role'])
                return jsonify({'success': True, 'user': user_payload, 'token': token})
        return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
    except Exception as e:
        print(f"Error during login: {e}")
        return jsonify({'success': False, 'error': 'Login failed. Please try again.'}), 500
    finally:
        conn.close()


@bp.route('/api/signup/request-otp', methods=['POST'])
def signup_request_otp():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    name = (data.get('name') or '').strip()

    if not email or not password or not name:
        return jsonify({'success': False, 'error': 'Name, email, and password are required'}), 400
    if '@' not in email or '.' not in email.rsplit('@', 1)[-1]:
        return jsonify({'success': False, 'error': 'Enter a valid email address'}), 400
    if len(password) < 8:
        return jsonify({'success': False, 'error': 'Password must be at least 8 characters'}), 400

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
        if not sent_email:
            response['devOtp'] = otp
            response['message'] = 'Email service is not configured. Use the development OTP shown here.'
        return jsonify(response)
    except Exception as e:
        conn.rollback()
        print(f"Error requesting signup OTP: {e}")
        return jsonify({'success': False, 'error': 'Could not start signup. Please try again.'}), 500
    finally:
        conn.close()


@bp.route('/api/signup/verify-otp', methods=['POST'])
def signup_verify_otp():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    otp = (data.get('otp') or '').strip()

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

        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            conn.execute("DELETE FROM email_otps WHERE email = ?", (email,))
            conn.commit()
            return jsonify({'success': False, 'error': 'An account with this email already exists'}), 409

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        reset_at = (now + timedelta(days=30)).isoformat()
        initials = _initials_from_name(pending["name"])
        conn.execute(
            """
            INSERT INTO users
            (email, password, name, initials, role, plan, credits_used, credits_limit, reset_at,
             login_provider, email_verified, created_at, status)
            VALUES (?, ?, ?, ?, 'user', 'Free Trial', 0, ?, ?, 'email', 1, ?, 'active')
            """,
            (email, pending["password_hash"], pending["name"], initials, SIGNUP_DEFAULT_CREDITS, reset_at, now.isoformat()),
        )
        conn.execute("DELETE FROM email_otps WHERE email = ?", (email,))
        conn.commit()
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
    conn = db()
    try:
        replicate_logs_rows = conn.execute("SELECT * FROM replicate_logs ORDER BY id DESC").fetchall()
        exports_rows = conn.execute("SELECT * FROM exports ORDER BY id DESC").fetchall()
        login_event_rows = conn.execute("""
            SELECT
                le.*,
                u.name AS user_name,
                u.email AS user_email
            FROM login_events le
            LEFT JOIN users u ON u.id = le.user_id
            ORDER BY le.created_at DESC
            LIMIT 100
        """).fetchall()
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
            LIMIT 150
        """).fetchall()
        
        replicate_logs = rows_to_dicts(replicate_logs_rows)
        exports = rows_to_dicts(exports_rows)
        login_events = rows_to_dicts(login_event_rows)
        admin_audit_events = rows_to_dicts(admin_audit_rows)
        
        return jsonify({
            'success': True,
            'replicateLogs': replicate_logs,
            'exports': exports,
            'loginEvents': login_events,
            'adminAuditEvents': admin_audit_events
        })
    except Exception as e:
        print(f"Error fetching admin logs: {e}")
        return jsonify({'success': False, 'error': 'An internal error occurred'}), 500
    finally:
        conn.close()


@bp.route('/api/admin/users', methods=['GET'])
@admin_required
def admin_users():
    conn = db()
    try:
        users_rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
        users = []
        for row in users_rows:
            u = dict(row)
            try:
                reset_at = datetime.fromisoformat(u["reset_at"])
                reset_days = max(0, (reset_at.date() - datetime.now(timezone.utc).replace(tzinfo=None).date()).days)
            except Exception:
                reset_days = 30
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
        
    conn = db()
    try:
        existing_user = conn.execute("SELECT credits_limit FROM users WHERE id = ?", (user_id,)).fetchone()
        previous_limit = existing_user["credits_limit"] if existing_user else None
        cur = conn.execute("UPDATE users SET credits_limit = ? WHERE id = ?", (credits_limit, user_id))
        if cur.rowcount:
            delta = credits_limit - previous_limit
            created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
            conn.execute(
                """
                INSERT INTO credit_transactions
                (user_id, transaction_type, credits, note, created_at)
                VALUES (?, 'admin_adjustment', ?, ?, ?)
                """,
                (user_id, delta, "Admin credit limit adjustment", created_at)
            )
            _record_admin_audit(
                conn,
                "credits.adjust",
                target_user_id=user_id,
                details={"previousCreditsLimit": previous_limit, "creditsLimit": credits_limit, "delta": delta},
            )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        return jsonify({'success': True, 'message': 'Credits limit updated successfully'})
    except Exception as e:
        print(f"Error adjusting credits: {e}")
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
    reset_at = (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30)).isoformat()

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

        if not email or not name:
            return jsonify({'success': False, 'error': 'Email and name are required'}), 400
        if role not in VALID_ROLES:
            return jsonify({'success': False, 'error': 'Invalid role'}), 400
        if status not in VALID_STATUSES:
            return jsonify({'success': False, 'error': 'Invalid status'}), 400
        if credits_limit < 0:
            return jsonify({'success': False, 'error': 'Credit limit cannot be negative'}), 400
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
            "status = ?",
        ]
        values = [email, name, initials, role, plan, credits_limit, status]
        changed = {
            "email": {"from": existing["email"], "to": email},
            "name": {"from": existing["name"], "to": name},
            "role": {"from": existing["role"], "to": role},
            "plan": {"from": existing["plan"], "to": plan},
            "creditsLimit": {"from": existing["credits_limit"], "to": credits_limit},
            "status": {"from": existing.get("status", "active"), "to": status},
        }
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
        return jsonify({'success': True, 'message': f'User {name} updated successfully'})
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


# --------------- Health check ---------------
@bp.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'service': 'RIMI AI Backend'})
