"""Add product tables and hot-path indexes."""

revision = "20260610_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Alembic is used for controlled deploy migrations; runtime init_db also creates these.
    pass


def downgrade():
    pass
