"""
Database connection, schema initialization, and shared DB helpers.
Supports both SQLite (local dev) and PostgreSQL (Railway production).
"""
import os
import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

import bcrypt

from config import DB_PATH, DATABASE_URL, UPLOAD_DIR, RESULTS_DIR

db_lock = threading.Lock()
_pg_pool = None

# ---------------------------------------------------------------------------
# Credit pricing
# Economics: INR 100 = USD 1.  1 credit = $0.001 of vendor budget.
# Razorpay ~3% + target 22% profit  =>  vendor cost budget = 75% of gross.
# Per-call credits include a +15% safety markup over raw vendor cost to absorb
# Groq side-calls and invoice variance.   credits = ceil(cost_usd * 1150)
# Pack pricing: 7.5 credits per INR 1 (gives ~22% margin after Razorpay).
# ---------------------------------------------------------------------------
DEFAULT_CREDIT_PRICING = [
    # ----- Uploads / Exports (free) -----
    ("upload", "Upload", "Upload artwork", 0, "fixed", 1),
    ("export", "Export", "Standard export", 0, "fixed", 1),

    # ----- Pattern Extraction (default + per-model overrides) -----
    # Default key falls back to Nano Banana 2 pricing.
    ("extract", "Pattern Extraction (default)", "/api/extract-design", 78, "dynamic", 1),



    ("extract_imagen_fast", "Extract — Imagen 4 Fast", "google/imagen-4-fast", 23, "dynamic", 1),


    ("extract_seedream", "Extract — Seedream 4.5", "bytedance/seedream-4.5", 46, "dynamic", 1),
    ("extract_nano_banana", "Extract — Nano Banana", "google/nano-banana", 45, "dynamic", 1),
    ("extract_nano_banana_2", "Extract — Nano Banana 2", "google/nano-banana-2", 78, "dynamic", 1),

    ("extract_grok", "Extract — Grok Imagine", "xai/grok-imagine-image", 23, "dynamic", 1),
    ("extract_flux_schnell", "Extract — Flux Schnell", "black-forest-labs/flux-schnell", 4, "dynamic", 1),

    # ----- Inspirations (mirrors extract pricing per model) -----
    ("inspire", "Inspirations (default)", "/api/generate-inspirations", 45, "dynamic", 1),

    # ----- Seamless -----
    ("seamless", "Make Seamless (Flux Fill Pro)", "/api/make-seamless", 58, "dynamic", 1),
    ("seamless_texture", "Seamless Texture (text-to-img)", "replicate/seamless-texture", 84, "dynamic", 1),

    # ----- Mockups / Mappings -----
    # Uses MODEL_ID = google/nano-banana-2 in backend/routes/mockups.py.
    # Per-call cost ($0.067 -> 67 credits, zero margin). Input images compressed to 768px.
    ("mappings", "Mappings / Mockups", "/api/generate-mockup", 67, "dynamic", 1),

    # ----- Image Layers -----
    ("imageLayers", "Image Layers (3-layer default)", "/api/image-layers", 69, "dynamic", 1),
    ("imageLayerEdit", "Image Layer Edit", "/api/edit-layer", 35, "fixed", 1),
    ("qwenSessionExportPsd", "Qwen Session Export PSD", "/api/qwen-sessions/export/psd", 5, "fixed", 1),
    ("qwenSessionExportZip", "Qwen Session Export ZIP", "/api/qwen-sessions/export/zip", 2, "fixed", 1),
    ("qwenSessionExportSvg", "Qwen Session Export SVG", "/api/qwen-sessions/export/svg", 15, "fixed", 1),

    # ----- Upscale / Vectorize / Misc Replicate -----
    ("upscale", "Super Resolution", "/api/upscale", 23, "dynamic", 1),
    ("vectorize", "Vectorize (cloud)", "/api/vectorize cloud", 12, "fixed", 1),
    ("vectorizeLocal", "Vectorize (local)", "/api/vectorize local", 3, "fixed", 1),
    ("removeBg", "Remove Background", "851-labs/background-remover", 2, "fixed", 1),
    ("styleTransfer", "Style Transfer", "fofr/style-transfer", 23, "dynamic", 1),

    # ----- Local / cheap CPU-side tools -----
    ("repeat", "Repeat Set", "/api/create-repeat-set", 5, "fixed", 1),
    ("colorways", "Colorways", "/api/colorways", 3, "dynamic", 1),
    ("recolor", "Recolor", "/api/recolor", 3, "fixed", 1),
    ("colorReduction", "Color Reduction", "/api/reduce-colors", 3, "fixed", 1),
    ("layerExport", "Layer Export", "/api/layer-export", 2, "fixed", 1),
    ("techPack", "Tech Pack Export", "/api/export-techpack", 2, "fixed", 1),
]

# ---------------------------------------------------------------------------
# Transparent PostgreSQL / SQLite wrapper
# ---------------------------------------------------------------------------
_USE_PG = bool(DATABASE_URL)

if _USE_PG:
    import psycopg2
    import psycopg2.extras


class _PgCursorWrapper:
    """Wraps a psycopg2 cursor so callers can use SQLite-style '?' placeholders."""
    _RETURNING_ID_TABLES = {
        "brand_palettes",
        "projects",
        "pipeline_runs",
        "saved_workflows",
        "users",
    }

    def __init__(self, cursor):
        self._cur = cursor

    @staticmethod
    def _convert_query(sql):
        import re
        # Detect INSERT OR IGNORE before replacing ? placeholders
        had_or_ignore = bool(re.search(r'INSERT\s+OR\s+IGNORE\s+INTO', sql, flags=re.IGNORECASE))
        sql = sql.replace('?', '%s')
        if had_or_ignore:
            sql = re.sub(r'INSERT\s+OR\s+IGNORE\s+INTO', 'INSERT INTO', sql, flags=re.IGNORECASE)
            # Add ON CONFLICT DO NOTHING at the end
            sql = sql.rstrip().rstrip(';')
            sql += ' ON CONFLICT DO NOTHING'
        return sql

    @classmethod
    def _insert_returns_id(cls, sql):
        import re
        match = re.match(r'\s*INSERT\s+INTO\s+(?:"?[\w]+"?\.)?"?([\w]+)"?', sql, flags=re.IGNORECASE)
        return bool(match and match.group(1).lower() in cls._RETURNING_ID_TABLES)

    def execute(self, sql, params=None):
        converted = self._convert_query(sql)
        # Only add RETURNING id for tables where callers consume lastrowid.
        self._last_was_insert = self._insert_returns_id(converted)
        if self._last_was_insert and 'RETURNING' not in converted.upper():
            converted = converted.rstrip().rstrip(';') + ' RETURNING id'
        self._cur.execute(converted, params or ())
        if self._last_was_insert:
            try:
                row = self._cur.fetchone()
                self._lastrowid = row['id'] if row and isinstance(row, dict) else (row[0] if row else None)
            except Exception:
                self._lastrowid = None
        else:
            self._lastrowid = None
        return self

    def executemany(self, sql, seq_of_params):
        for params in seq_of_params:
            self._cur.execute(self._convert_query(sql), params)
        return self

    def executescript(self, sql):
        self._cur.execute(sql)
        return self

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    @property
    def lastrowid(self):
        return getattr(self, '_lastrowid', None)

    @property
    def description(self):
        return self._cur.description

    @property
    def rowcount(self):
        return self._cur.rowcount


class _PgConnectionWrapper:
    """Wraps a psycopg2 connection so it looks like a sqlite3.Connection."""
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=None):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        wrapper = _PgCursorWrapper(cur)
        wrapper.execute(sql, params)
        return wrapper

    def executemany(self, sql, seq_of_params):
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        wrapper = _PgCursorWrapper(cur)
        wrapper.executemany(sql, seq_of_params)
        return wrapper

    def executescript(self, sql):
        """Run multiple DDL statements — psycopg2 does not support multi-statement execute."""
        cur = self._conn.cursor()
        statements = _split_sql_script(sql)
        for stmt in statements:
            cur.execute(stmt)
        return _PgCursorWrapper(cur)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        if getattr(self, "_pooled", False):
            _get_pg_pool().putconn(self._conn)
        else:
            self._conn.close()

    def cursor(self):
        return _PgCursorWrapper(self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor))


def _get_pg_pool():
    global _pg_pool
    if _pg_pool is None:
        from psycopg2 import pool
        max_conn = int(os.getenv("DB_POOL_MAX", "20"))
        _pg_pool = pool.ThreadedConnectionPool(1, max_conn, DATABASE_URL)
    return _pg_pool


def db():
    if _USE_PG:
        raw = _get_pg_pool().getconn()
        raw.autocommit = False
        wrapper = _PgConnectionWrapper(raw)
        wrapper._pooled = True
        return wrapper
    else:
        conn = sqlite3.connect(DB_PATH, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn


def rows_to_dicts(rows):
    if _USE_PG:
        return [dict(row) for row in rows]
    return [dict(row) for row in rows]


def seed_credit_pricing(conn):
    updated_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    if _USE_PG:
        for tool_key, label, api_name, credits, pricing_type, is_active in DEFAULT_CREDIT_PRICING:
            conn.execute(
                """
                INSERT INTO credit_pricing
                (tool_key, label, api_name, credits, pricing_type, is_active, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (tool_key) DO UPDATE SET
                    label = EXCLUDED.label,
                    api_name = EXCLUDED.api_name,
                    credits = EXCLUDED.credits,
                    pricing_type = EXCLUDED.pricing_type,
                    is_active = EXCLUDED.is_active,
                    updated_at = EXCLUDED.updated_at
                """,
                (tool_key, label, api_name, credits, pricing_type, is_active, updated_at),
            )
    else:
        conn.executemany(
            """
            INSERT INTO credit_pricing
            (tool_key, label, api_name, credits, pricing_type, is_active, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tool_key) DO UPDATE SET
                label = excluded.label,
                api_name = excluded.api_name,
                credits = excluded.credits,
                pricing_type = excluded.pricing_type,
                is_active = excluded.is_active,
                updated_at = excluded.updated_at
            """,
            [
                (tool_key, label, api_name, credits, pricing_type, is_active, updated_at)
                for tool_key, label, api_name, credits, pricing_type, is_active in DEFAULT_CREDIT_PRICING
            ],
        )


def resolve_input_url(input_filename):
    if not input_filename:
        return None
    if input_filename.startswith('http://') or input_filename.startswith('https://') or input_filename.startswith('/'):
        return input_filename
    
    if os.path.exists(os.path.join(UPLOAD_DIR, input_filename)):
        return f"/uploads/{input_filename}"
    if os.path.exists(os.path.join(RESULTS_DIR, input_filename)):
        return f"/results/{input_filename}"
    
    PUBLIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public')
    if os.path.exists(os.path.join(PUBLIC_DIR, input_filename)):
        return f"/{input_filename}"
    return f"/uploads/{input_filename}"


def iso_to_epoch(iso_str):
    try:
        return datetime.fromisoformat(iso_str).timestamp()
    except Exception:
        return 0.0


def time_ago(iso_value):
    try:
        then = datetime.fromisoformat(iso_value)
    except ValueError:
        return "Updated recently"
    delta = datetime.now(timezone.utc).replace(tzinfo=None) - then
    if delta.days >= 1:
        return f"Updated {delta.days} day{'s' if delta.days != 1 else ''} ago"
    hours = max(1, int(delta.total_seconds() // 3600))
    return f"Updated {hours}h ago"


# ---------------------------------------------------------------------------
# Schema initialisation (supports both SQLite & PostgreSQL)
# ---------------------------------------------------------------------------
def _pg_schema_sql():
    """Return CREATE TABLE statements in PostgreSQL dialect."""
    return """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            initials TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            plan TEXT NOT NULL DEFAULT 'Free Trial',
            credits_used INTEGER NOT NULL DEFAULT 0,
            credits_limit INTEGER NOT NULL DEFAULT 200,
            reset_at TEXT NOT NULL DEFAULT '',
            login_provider TEXT NOT NULL DEFAULT 'email',
            google_sub TEXT,
            avatar_url TEXT,
            email_verified INTEGER NOT NULL DEFAULT 0,
            last_login_at TEXT,
            created_at TEXT,
            status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

        CREATE TABLE IF NOT EXISTS replicate_logs (
            id SERIAL PRIMARY KEY,
            project_id INTEGER,
            model_name TEXT NOT NULL,
            duration REAL NOT NULL,
            credits INTEGER NOT NULL,
            cost_usd REAL NOT NULL,
            created_at TEXT NOT NULL,
            session_id INTEGER,
            output_bytes INTEGER
        );
        CREATE TABLE IF NOT EXISTS projects (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            thumbnail_url TEXT NOT NULL DEFAULT '',
            hero_image_url TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT '',
            user_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS pattern_variations (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            image_url TEXT NOT NULL,
            is_selected INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_metrics (
            project_id INTEGER PRIMARY KEY,
            versions INTEGER NOT NULL DEFAULT 0,
            versions_delta INTEGER NOT NULL DEFAULT 0,
            exports INTEGER NOT NULL DEFAULT 0,
            exports_delta INTEGER NOT NULL DEFAULT 0,
            ai_generations INTEGER NOT NULL DEFAULT 0,
            ai_generations_delta INTEGER NOT NULL DEFAULT 0,
            credits_used INTEGER NOT NULL DEFAULT 0,
            credits_delta INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS pattern_health (
            project_id INTEGER PRIMARY KEY,
            score INTEGER NOT NULL DEFAULT 0,
            label TEXT NOT NULL DEFAULT '',
            tile_seamless INTEGER NOT NULL DEFAULT 0,
            color_balance INTEGER NOT NULL DEFAULT 0,
            print_readiness INTEGER NOT NULL DEFAULT 0,
            resolution INTEGER NOT NULL DEFAULT 0,
            note TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS project_controls (
            project_id INTEGER PRIMARY KEY,
            grid_size INTEGER NOT NULL DEFAULT 2,
            scale INTEGER NOT NULL DEFAULT 100,
            rotation INTEGER NOT NULL DEFAULT 0,
            repeat_type TEXT NOT NULL DEFAULT 'block',
            color_cleanup INTEGER NOT NULL DEFAULT 1,
            edge_match INTEGER NOT NULL DEFAULT 1,
            background_clean INTEGER NOT NULL DEFAULT 0,
            export_format TEXT NOT NULL DEFAULT 'PNG',
            export_dpi INTEGER NOT NULL DEFAULT 300,
            h_brush INTEGER NOT NULL DEFAULT 8,
            v_brush INTEGER NOT NULL DEFAULT 8,
            print_width INTEGER NOT NULL DEFAULT 12,
            updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS suggestions (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pipeline_runs (
            id SERIAL PRIMARY KEY,
            project_id INTEGER,
            name TEXT NOT NULL DEFAULT 'Custom Pipeline',
            steps_json TEXT NOT NULL,
            settings_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            results_json TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS saved_workflows (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            name TEXT NOT NULL,
            steps_json TEXT NOT NULL,
            settings_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_uploads (
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exports (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            project_id INTEGER,
            filename TEXT NOT NULL UNIQUE,
            input_filename TEXT,
            tool_type TEXT NOT NULL,
            settings_json TEXT DEFAULT '{}',
            pipeline_run_id INTEGER,
            pipeline_steps_json TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS brand_palettes (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            colors_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS payments (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            provider TEXT NOT NULL DEFAULT 'razorpay',
            provider_order_id TEXT NOT NULL UNIQUE,
            provider_payment_id TEXT,
            amount INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'INR',
            credits INTEGER NOT NULL DEFAULT 0,
            pack_id TEXT,
            receipt TEXT,
            status TEXT NOT NULL DEFAULT 'created',
            created_at TEXT NOT NULL,
            paid_at TEXT
        );
        CREATE TABLE IF NOT EXISTS credit_transactions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            payment_id INTEGER,
            project_id INTEGER,
            transaction_type TEXT NOT NULL,
            credits INTEGER NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS credit_pricing (
            tool_key TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            api_name TEXT NOT NULL DEFAULT '',
            credits INTEGER NOT NULL DEFAULT 0,
            pricing_type TEXT NOT NULL DEFAULT 'fixed',
            is_active INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_events (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            provider TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS admin_audit_events (
            id SERIAL PRIMARY KEY,
            admin_user_id INTEGER,
            target_user_id INTEGER,
            action TEXT NOT NULL,
            details_json TEXT NOT NULL DEFAULT '{}',
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_login_tokens (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS email_otps (
            email TEXT PRIMARY KEY,
            otp_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS google_signup_tokens (
            token TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            google_sub TEXT NOT NULL,
            name TEXT NOT NULL,
            avatar_url TEXT,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS signup_guards (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            ip_address TEXT,
            device_fingerprint TEXT,
            normalized_email TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sg_ip ON signup_guards (ip_address);
        CREATE INDEX IF NOT EXISTS idx_sg_fp ON signup_guards (device_fingerprint);
        CREATE INDEX IF NOT EXISTS idx_sg_email ON signup_guards (normalized_email);
        CREATE TABLE IF NOT EXISTS background_jobs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            project_id INTEGER,
            job_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            payload_json TEXT,
            result_json TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS share_links (
            id SERIAL PRIMARY KEY,
            token TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            export_filename TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS api_keys (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            key_prefix TEXT NOT NULL,
            key_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT
        );
        CREATE TABLE IF NOT EXISTS team_members (
            id SERIAL PRIMARY KEY,
            owner_user_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            status TEXT NOT NULL DEFAULT 'invited',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS qwen_layered_sessions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL DEFAULT 'Untitled Session',
            source_filename TEXT,
            canvas_width INTEGER NOT NULL DEFAULT 1024,
            canvas_height INTEGER NOT NULL DEFAULT 1024,
            thumbnail_filename TEXT,
            last_composed_filename TEXT,
            document_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_archived INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS qwen_layer_versions (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL,
            layer_local_id INTEGER NOT NULL,
            version INTEGER NOT NULL,
            filename TEXT NOT NULL,
            edit_type TEXT NOT NULL DEFAULT 'decompose',
            prompt TEXT,
            parent_filename TEXT,
            cost_usd REAL,
            credits INTEGER,
            duration_ms INTEGER,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_qwen_versions_session_layer ON qwen_layer_versions (session_id, layer_local_id, version);
        CREATE INDEX IF NOT EXISTS idx_qwen_sessions_project_updated ON qwen_layered_sessions (project_id, updated_at);
        CREATE INDEX IF NOT EXISTS idx_exports_user_project ON exports (user_id, project_id);
        CREATE INDEX IF NOT EXISTS idx_exports_created ON exports (created_at);
        CREATE INDEX IF NOT EXISTS idx_replicate_logs_project ON replicate_logs (project_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_background_jobs_user_status ON background_jobs (user_id, status);
        CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created ON credit_transactions (user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_payments_user_status ON payments (user_id, status);
        CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id);
        CREATE INDEX IF NOT EXISTS idx_saved_workflows_user ON saved_workflows (user_id);
    """


def _split_sql_script(sql):
    """Split a SQL script into individual statements for PostgreSQL execution."""
    import re
    cleaned_lines = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith('--'):
            continue
        cleaned_lines.append(line)
    cleaned = '\n'.join(cleaned_lines)
    return [stmt.strip() for stmt in re.split(r';\s*\n', cleaned) if stmt.strip()]


# Serialize PostgreSQL DDL across Gunicorn workers (prevents ALTER TABLE deadlocks).
PG_INIT_ADVISORY_LOCK = 82910421


def _pg_column_exists(conn, table, column):
    row = conn.execute(
        """
        SELECT 1 AS ok
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
        LIMIT 1
        """,
        (table, column),
    ).fetchone()
    return bool(row)


def _pg_ensure_column(conn, table, column, definition):
    if _pg_column_exists(conn, table, column):
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _pg_advisory_lock(conn):
    conn.execute("SELECT pg_advisory_lock(?)", (PG_INIT_ADVISORY_LOCK,))


def _pg_advisory_unlock(conn):
    conn.execute("SELECT pg_advisory_unlock(?)", (PG_INIT_ADVISORY_LOCK,))


def _pg_run_migrations(conn):
    """Apply column migrations on existing PostgreSQL databases (mirrors SQLite ensure_column)."""
    _pg_ensure_column(conn, "users", "login_provider", "TEXT NOT NULL DEFAULT 'email'")
    _pg_ensure_column(conn, "users", "google_sub", "TEXT")
    _pg_ensure_column(conn, "users", "avatar_url", "TEXT")
    _pg_ensure_column(conn, "users", "email_verified", "INTEGER NOT NULL DEFAULT 0")
    _pg_ensure_column(conn, "users", "last_login_at", "TEXT")
    _pg_ensure_column(conn, "users", "created_at", "TEXT")
    _pg_ensure_column(conn, "users", "status", "TEXT NOT NULL DEFAULT 'active'")
    _pg_ensure_column(conn, "projects", "user_id", "INTEGER")
    _pg_ensure_column(conn, "exports", "user_id", "INTEGER")
    _pg_ensure_column(conn, "project_controls", "print_height", "INTEGER NOT NULL DEFAULT 12")
    _pg_ensure_column(conn, "project_controls", "fabric_width", "INTEGER NOT NULL DEFAULT 54")
    _pg_ensure_column(conn, "background_jobs", "progress_pct", "INTEGER NOT NULL DEFAULT 0")
    _pg_ensure_column(conn, "background_jobs", "stage", "TEXT NOT NULL DEFAULT ''")
    _pg_ensure_column(conn, "pattern_variations", "export_filename", "TEXT")
    _pg_ensure_column(conn, "replicate_logs", "session_id", "INTEGER")
    _pg_ensure_column(conn, "replicate_logs", "output_bytes", "INTEGER")
    _pg_ensure_column(conn, "saved_workflows", "user_id", "INTEGER")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_uploads (
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_background_jobs_user_status ON background_jobs (user_id, status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created ON credit_transactions (user_id, created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_payments_user_status ON payments (user_id, status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_saved_workflows_user ON saved_workflows (user_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS qwen_layered_sessions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL DEFAULT 'Untitled Session',
            source_filename TEXT,
            canvas_width INTEGER NOT NULL DEFAULT 1024,
            canvas_height INTEGER NOT NULL DEFAULT 1024,
            thumbnail_filename TEXT,
            last_composed_filename TEXT,
            document_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_archived INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS qwen_layer_versions (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL,
            layer_local_id INTEGER NOT NULL,
            version INTEGER NOT NULL,
            filename TEXT NOT NULL,
            edit_type TEXT NOT NULL DEFAULT 'decompose',
            prompt TEXT,
            parent_filename TEXT,
            cost_usd REAL,
            credits INTEGER,
            duration_ms INTEGER,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_qwen_versions_session_layer ON qwen_layer_versions (session_id, layer_local_id, version)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_qwen_sessions_project_updated ON qwen_layered_sessions (project_id, updated_at)"
    )

    # Assign orphaned projects to the first user so studio-state queries work.
    conn.execute(
        """
        UPDATE projects
        SET user_id = sub.owner_id
        FROM (SELECT id AS owner_id FROM users ORDER BY id LIMIT 1) AS sub
        WHERE projects.user_id IS NULL
        """
    )


def _pg_init_schema_and_migrations(conn):
    """Create tables and apply column migrations — must run under advisory lock."""
    conn.executescript(_pg_schema_sql())
    _pg_run_migrations(conn)


def init_db():
    conn = db()

    if _USE_PG:
        # Only one Gunicorn worker may run DDL at a time (others wait, then skip fast).
        _pg_advisory_lock(conn)
        try:
            _pg_init_schema_and_migrations(conn)
            conn.commit()
        finally:
            try:
                _pg_advisory_unlock(conn)
                conn.commit()
            except Exception:
                conn.rollback()
    else:
        # SQLite: original schema + migration
        try:
            conn.execute("SELECT email FROM users LIMIT 1")
        except sqlite3.OperationalError:
            try:
                conn.execute("DROP TABLE IF EXISTS users")
                conn.commit()
                print("Dropped old users table for migration.")
            except Exception as e:
                print(f"Error dropping users table: {e}")

        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                initials TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                plan TEXT NOT NULL,
                credits_used INTEGER NOT NULL DEFAULT 0,
                credits_limit INTEGER NOT NULL DEFAULT 200,
                reset_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS replicate_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                model_name TEXT NOT NULL,
                duration REAL NOT NULL,
                credits INTEGER NOT NULL,
                cost_usd REAL NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                thumbnail_url TEXT NOT NULL,
                hero_image_url TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pattern_variations (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                image_url TEXT NOT NULL,
                is_selected INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS project_metrics (
                project_id INTEGER PRIMARY KEY,
                versions INTEGER NOT NULL DEFAULT 0,
                versions_delta INTEGER NOT NULL DEFAULT 0,
                exports INTEGER NOT NULL DEFAULT 0,
                exports_delta INTEGER NOT NULL DEFAULT 0,
                ai_generations INTEGER NOT NULL DEFAULT 0,
                ai_generations_delta INTEGER NOT NULL DEFAULT 0,
                credits_used INTEGER NOT NULL DEFAULT 0,
                credits_delta INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS pattern_health (
                project_id INTEGER PRIMARY KEY,
                score INTEGER NOT NULL,
                label TEXT NOT NULL,
                tile_seamless INTEGER NOT NULL,
                color_balance INTEGER NOT NULL,
                print_readiness INTEGER NOT NULL,
                resolution INTEGER NOT NULL,
                note TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS project_controls (
                project_id INTEGER PRIMARY KEY,
                grid_size INTEGER NOT NULL DEFAULT 2,
                scale INTEGER NOT NULL DEFAULT 100,
                rotation INTEGER NOT NULL DEFAULT 0,
                repeat_type TEXT NOT NULL DEFAULT 'block',
                color_cleanup INTEGER NOT NULL DEFAULT 1,
                edge_match INTEGER NOT NULL DEFAULT 1,
                background_clean INTEGER NOT NULL DEFAULT 0,
                export_format TEXT NOT NULL DEFAULT 'PNG',
                export_dpi INTEGER NOT NULL DEFAULT 300,
                h_brush INTEGER NOT NULL DEFAULT 8,
                v_brush INTEGER NOT NULL DEFAULT 8,
                print_width INTEGER NOT NULL DEFAULT 12,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS suggestions (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS pipeline_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                name TEXT NOT NULL DEFAULT 'Custom Pipeline',
                steps_json TEXT NOT NULL,
                settings_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                results_json TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS saved_workflows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                name TEXT NOT NULL,
                steps_json TEXT NOT NULL,
                settings_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_uploads (
                user_id INTEGER NOT NULL,
                filename TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS exports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                project_id INTEGER,
                filename TEXT NOT NULL UNIQUE,
                input_filename TEXT,
                tool_type TEXT NOT NULL,
                settings_json TEXT DEFAULT '{}',
                pipeline_run_id INTEGER,
                pipeline_steps_json TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS brand_palettes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                colors_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                provider TEXT NOT NULL DEFAULT 'razorpay',
                provider_order_id TEXT NOT NULL UNIQUE,
                provider_payment_id TEXT,
                amount INTEGER NOT NULL,
                currency TEXT NOT NULL DEFAULT 'INR',
                credits INTEGER NOT NULL DEFAULT 0,
                pack_id TEXT,
                receipt TEXT,
                status TEXT NOT NULL DEFAULT 'created',
                created_at TEXT NOT NULL,
                paid_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS credit_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                payment_id INTEGER,
                project_id INTEGER,
                transaction_type TEXT NOT NULL,
                credits INTEGER NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(payment_id) REFERENCES payments(id),
                FOREIGN KEY(project_id) REFERENCES projects(id)
            );
            CREATE TABLE IF NOT EXISTS credit_pricing (
                tool_key TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                api_name TEXT NOT NULL DEFAULT '',
                credits INTEGER NOT NULL DEFAULT 0,
                pricing_type TEXT NOT NULL DEFAULT 'fixed',
                is_active INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                provider TEXT NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS admin_audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_user_id INTEGER,
                target_user_id INTEGER,
                action TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}',
                ip_address TEXT,
                user_agent TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(admin_user_id) REFERENCES users(id),
                FOREIGN KEY(target_user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS oauth_login_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS email_otps (
                email TEXT PRIMARY KEY,
                otp_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS google_signup_tokens (
                token TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                google_sub TEXT NOT NULL,
                name TEXT NOT NULL,
                avatar_url TEXT,
                expires_at TEXT NOT NULL,
                used_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS signup_guards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                ip_address TEXT,
                device_fingerprint TEXT,
                normalized_email TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE INDEX IF NOT EXISTS idx_sg_ip ON signup_guards (ip_address);
            CREATE INDEX IF NOT EXISTS idx_sg_fp ON signup_guards (device_fingerprint);
            CREATE INDEX IF NOT EXISTS idx_sg_email ON signup_guards (normalized_email);
            CREATE TABLE IF NOT EXISTS background_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                project_id INTEGER,
                job_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                payload_json TEXT,
                result_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS share_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                export_filename TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                key_prefix TEXT NOT NULL,
                key_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_used_at TEXT
            );
            CREATE TABLE IF NOT EXISTS team_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_user_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                status TEXT NOT NULL DEFAULT 'invited',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS qwen_layered_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL DEFAULT 'Untitled Session',
                source_filename TEXT,
                canvas_width INTEGER NOT NULL DEFAULT 1024,
                canvas_height INTEGER NOT NULL DEFAULT 1024,
                thumbnail_filename TEXT,
                last_composed_filename TEXT,
                document_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_archived INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS qwen_layer_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                layer_local_id INTEGER NOT NULL,
                version INTEGER NOT NULL,
                filename TEXT NOT NULL,
                edit_type TEXT NOT NULL DEFAULT 'decompose',
                prompt TEXT,
                parent_filename TEXT,
                cost_usd REAL,
                credits INTEGER,
                duration_ms INTEGER,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_qwen_versions_session_layer ON qwen_layer_versions (session_id, layer_local_id, version);
            CREATE INDEX IF NOT EXISTS idx_qwen_sessions_project_updated ON qwen_layered_sessions (project_id, updated_at);
            CREATE INDEX IF NOT EXISTS idx_exports_user_project ON exports (user_id, project_id);
            CREATE INDEX IF NOT EXISTS idx_exports_created ON exports (created_at);
            CREATE INDEX IF NOT EXISTS idx_replicate_logs_project ON replicate_logs (project_id, created_at);
        """)

        def ensure_column(table, column, definition):
            existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

        ensure_column("users", "login_provider", "TEXT NOT NULL DEFAULT 'email'")
        ensure_column("users", "google_sub", "TEXT")
        ensure_column("users", "avatar_url", "TEXT")
        ensure_column("users", "email_verified", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("users", "last_login_at", "TEXT")
        ensure_column("users", "created_at", "TEXT")
        ensure_column("users", "status", "TEXT NOT NULL DEFAULT 'active'")
        ensure_column("projects", "user_id", "INTEGER REFERENCES users(id)")
        ensure_column("exports", "user_id", "INTEGER REFERENCES users(id)")
        ensure_column("project_controls", "print_height", "INTEGER NOT NULL DEFAULT 12")
        ensure_column("project_controls", "fabric_width", "INTEGER NOT NULL DEFAULT 54")
        ensure_column("background_jobs", "progress_pct", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("background_jobs", "stage", "TEXT NOT NULL DEFAULT ''")
        ensure_column("pattern_variations", "export_filename", "TEXT")
        ensure_column("saved_workflows", "user_id", "INTEGER REFERENCES users(id)")
        ensure_column("replicate_logs", "session_id", "INTEGER")
        ensure_column("replicate_logs", "output_bytes", "INTEGER")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_uploads (
                user_id INTEGER NOT NULL,
                filename TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS qwen_layered_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL DEFAULT 'Untitled Session',
                source_filename TEXT,
                canvas_width INTEGER NOT NULL DEFAULT 1024,
                canvas_height INTEGER NOT NULL DEFAULT 1024,
                thumbnail_filename TEXT,
                last_composed_filename TEXT,
                document_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                is_archived INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS qwen_layer_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                layer_local_id INTEGER NOT NULL,
                version INTEGER NOT NULL,
                filename TEXT NOT NULL,
                edit_type TEXT NOT NULL DEFAULT 'decompose',
                prompt TEXT,
                parent_filename TEXT,
                cost_usd REAL,
                credits INTEGER,
                duration_ms INTEGER,
                created_at TEXT NOT NULL
            )
            """
        )

        _sqlite_hot_path_indexes = [
            "CREATE INDEX IF NOT EXISTS idx_background_jobs_user_status ON background_jobs (user_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created ON credit_transactions (user_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_payments_user_status ON payments (user_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id)",
            "CREATE INDEX IF NOT EXISTS idx_saved_workflows_user ON saved_workflows (user_id)",
            "CREATE INDEX IF NOT EXISTS idx_qwen_versions_session_layer ON qwen_layer_versions (session_id, layer_local_id, version)",
            "CREATE INDEX IF NOT EXISTS idx_qwen_sessions_project_updated ON qwen_layered_sessions (project_id, updated_at)",
        ]
        for stmt in _sqlite_hot_path_indexes:
            conn.execute(stmt)

        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL")
        conn.commit()

        # Auto-migration of existing result files
        try:
            if os.path.exists(RESULTS_DIR):
                skip_prefixes = ('mask_', 'test_', 'omnisvg_', 'thumb_', 'prev_')
                for filename in os.listdir(RESULTS_DIR):
                    filepath = os.path.join(RESULTS_DIR, filename)
                    if os.path.isfile(filepath):
                        if filename.lower().startswith(skip_prefixes):
                            continue
                        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
                        if ext not in ('png', 'jpg', 'jpeg', 'svg', 'tiff'):
                            continue

                        row = conn.execute("SELECT 1 FROM exports WHERE filename = ?", (filename,)).fetchone()
                        if not row:
                            if filename.startswith('seamless_gen_') or filename.startswith('seamless_tile_'):
                                tool_type = "Seamless Fix"
                            elif filename.startswith('repeat_'):
                                tool_type = "Repeat Set"
                            elif filename.startswith('vec_'):
                                tool_type = "Vectorize"
                            elif filename.startswith('upscale_'):
                                tool_type = "Super Resolution"
                            elif filename.startswith('mockup_'):
                                tool_type = "Mappings"
                            elif filename.startswith('extracted_'):
                                tool_type = "Extract Design"
                            elif filename.startswith('layer_'):
                                tool_type = "Image Layers"
                            else:
                                tool_type = "Seamless Fix"

                            try:
                                mtime = os.path.getmtime(filepath)
                                created_at = datetime.utcfromtimestamp(mtime).isoformat()
                            except Exception:
                                created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()

                            conn.execute(
                                """
                                INSERT OR IGNORE INTO exports 
                                (project_id, filename, input_filename, tool_type, settings_json, created_at)
                                VALUES (?, ?, ?, ?, ?, ?)
                                """,
                                (1, filename, None, tool_type, '{}', created_at)
                            )
                conn.commit()
        except Exception as e:
            print(f"Error during auto-migration: {e}")

    seed_credit_pricing(conn)
    conn.commit()
    conn.close()
