"""Admin routes: login, logs, users, credit management, health check."""
import json
import os
import sqlite3
from flask import Blueprint, request, jsonify, g
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt

from db import db, rows_to_dicts
from middleware import admin_required, login_required

bp = Blueprint('admin', __name__)

VALID_ROLES = {'user', 'admin'}
VALID_STATUSES = {'active', 'suspended'}


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
                jwt_secret = os.getenv('JWT_SECRET', 'rimi-ai-dev-secret-change-in-production')
                token = jwt.encode(
                    {'user_id': user['id'], 'role': user['role'], 'exp': datetime.now(timezone.utc) + timedelta(hours=24)},
                    jwt_secret, algorithm='HS256'
                )
                return jsonify({'success': True, 'user': user_payload, 'token': token})
        return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
    except Exception as e:
        print(f"Error during login: {e}")
        return jsonify({'success': False, 'error': 'Login failed. Please try again.'}), 500
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


# --------------- Credit Pricing (dynamic averages) ---------------
@bp.route('/api/credit-pricing')
def credit_pricing():
    """Returns average credits per tool type based on actual replicate_logs data."""
    conn = db()
    try:
        rows = conn.execute("""
            SELECT model_name, AVG(credits) as avg_credits, COUNT(*) as call_count 
            FROM replicate_logs GROUP BY model_name
        """).fetchall()
    finally:
        conn.close()

    # Map model names to frontend tool types
    model_to_tool = {
        "openai/gpt-image-2": "extract",
        "replicate/seamless-texture": "seamless",
        "black-forest-labs/flux-fill-pro": "seamless",
        "recraft-ai/recraft-vectorize": "vectorize",
        "google/upscaler": "upscale",
        "qwen/qwen-image-layered": "imageLayers",
    }

    # Defaults if no data yet
    defaults = {
        "upload": 0, "extract": 50, "seamless": 80,
        "repeat": 10, "upscale": 60, "vectorize": 100, "export": 0,
        "inspire": 50, "mappings": 50, "imageLayers": 100,
    }

    pricing = dict(defaults)
    for row in rows:
        tool = model_to_tool.get(row["model_name"])
        if tool and row["call_count"] >= 1:
            pricing[tool] = int(round(row["avg_credits"]))

    return jsonify({'success': True, 'pricing': pricing})


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
