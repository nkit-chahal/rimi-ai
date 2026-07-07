"""Add hot-path indexes and workflow ownership columns."""

revision = "20260610_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op = __import__("alembic.op", fromlist=["op"]).op
    op.execute("ALTER TABLE saved_workflows ADD COLUMN IF NOT EXISTS user_id INTEGER")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_uploads (
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_background_jobs_user_status ON background_jobs (user_id, status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created ON credit_transactions (user_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_payments_user_status ON payments (user_id, status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_saved_workflows_user ON saved_workflows (user_id)")


def downgrade():
    op = __import__("alembic.op", fromlist=["op"]).op
    op.execute("DROP INDEX IF EXISTS idx_saved_workflows_user")
    op.execute("DROP INDEX IF EXISTS idx_projects_user")
    op.execute("DROP INDEX IF EXISTS idx_payments_user_status")
    op.execute("DROP INDEX IF EXISTS idx_credit_tx_user_created")
    op.execute("DROP INDEX IF EXISTS idx_background_jobs_user_status")
    op.execute("DROP TABLE IF EXISTS user_uploads")
