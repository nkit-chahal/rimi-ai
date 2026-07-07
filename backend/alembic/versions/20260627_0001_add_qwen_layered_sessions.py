"""Add Qwen layered sessions and version history tables."""

revision = "20260627_0001"
down_revision = "20260610_0001"
branch_labels = None
depends_on = None


def upgrade():
    op = __import__("alembic.op", fromlist=["op"]).op
    op.execute(
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
    op.execute(
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
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_qwen_versions_session_layer ON qwen_layer_versions (session_id, layer_local_id, version)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_qwen_sessions_project_updated ON qwen_layered_sessions (project_id, updated_at)"
    )


def downgrade():
    op = __import__("alembic.op", fromlist=["op"]).op
    op.execute("DROP INDEX IF EXISTS idx_qwen_sessions_project_updated")
    op.execute("DROP INDEX IF EXISTS idx_qwen_versions_session_layer")
    op.execute("DROP TABLE IF EXISTS qwen_layer_versions")
    op.execute("DROP TABLE IF EXISTS qwen_layered_sessions")
