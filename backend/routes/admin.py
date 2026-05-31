"""Admin routes: login, logs, users, credit management, health check."""
import os
import sqlite3
from flask import Blueprint, request, jsonify
from datetime import datetime, timezone, timedelta

from db import db, rows_to_dicts

bp = Blueprint('admin', __name__)


# --------------- Authentication & Administrator Endpoints ---------------

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
            if user['password'] == password:
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
                }
                return jsonify({'success': True, 'user': user_payload})
        return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
    except Exception as e:
        print(f"Error during login: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()


@bp.route('/api/admin/logs', methods=['GET'])
def admin_logs():
    conn = db()
    try:
        replicate_logs_rows = conn.execute("SELECT * FROM replicate_logs ORDER BY id DESC").fetchall()
        exports_rows = conn.execute("SELECT * FROM exports ORDER BY id DESC").fetchall()
        
        replicate_logs = rows_to_dicts(replicate_logs_rows)
        exports = rows_to_dicts(exports_rows)
        
        return jsonify({
            'success': True,
            'replicateLogs': replicate_logs,
            'exports': exports
        })
    except Exception as e:
        print(f"Error fetching admin logs: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()


@bp.route('/api/admin/users', methods=['GET'])
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
                "resetDays": reset_days
            })
        return jsonify({'success': True, 'users': users})
    except Exception as e:
        print(f"Error fetching admin users: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()


@bp.route('/api/admin/adjust-credits', methods=['POST'])
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
        cur = conn.execute("UPDATE users SET credits_limit = ? WHERE id = ?", (credits_limit, user_id))
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        return jsonify({'success': True, 'message': 'Credits limit updated successfully'})
    except Exception as e:
        print(f"Error adjusting credits: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
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
def admin_create_user():
    data = request.get_json() or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')
    name = data.get('name', '').strip()
    role = data.get('role', 'user')
    plan = data.get('plan', 'Business Studio')
    credits_limit = int(data.get('creditsLimit', 25000))

    if not email or not password or not name:
        return jsonify({'success': False, 'error': 'Email, password, and name are required'}), 400

    initials = ''.join(w[0].upper() for w in name.split()[:2]) or 'U'
    reset_at = (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30)).isoformat()

    conn = db()
    try:
        conn.execute(
            "INSERT INTO users (email, password, name, initials, role, plan, credits_used, credits_limit, reset_at) VALUES (?,?,?,?,?,?,0,?,?)",
            (email, password, name, initials, role, plan, credits_limit, reset_at)
        )
        conn.commit()
        return jsonify({'success': True, 'message': f'User {name} created successfully'})
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'error': 'A user with this email already exists'}), 400
    except Exception as e:
        print(f"Error creating user: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()


# --------------- Admin Delete User ---------------
@bp.route('/api/admin/delete-user/<int:user_id>', methods=['DELETE'])
def admin_delete_user(user_id):
    conn = db()
    try:
        # Don't allow deleting admin users
        cur = conn.execute("DELETE FROM users WHERE id = ? AND role != 'admin'", (user_id,))
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'success': False, 'error': 'User not found or cannot delete admin'}), 404
        return jsonify({'success': True, 'message': 'User deleted successfully'})
    except Exception as e:
        print(f"Error deleting user: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        conn.close()


# --------------- Health check ---------------
@bp.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'service': 'RIM AI Backend'})
