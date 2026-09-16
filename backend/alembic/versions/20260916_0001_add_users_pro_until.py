"""Add users.pro_until so Pro access is a dated entitlement rather than a plan label.

Pro used to be inferred from users.plan, which nothing ever cleared, so one Pro purchase
unlocked the Pro tools permanently. pro_until holds the timestamp the access lapses at.

The column is added here; backend/db.py:backfill_pro_until fills it in on the next boot for
accounts that already hold a Pro plan (they keep access until their current credit window
ends, or 30 days from now when that is missing or past). The policy lives in one place there
rather than being duplicated as SQL.
"""

revision = "20260916_0001"
down_revision = "20260627_0001"
branch_labels = None
depends_on = None


def upgrade():
    op = __import__("alembic.op", fromlist=["op"]).op
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_until TEXT")


def downgrade():
    op = __import__("alembic.op", fromlist=["op"]).op
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS pro_until")
