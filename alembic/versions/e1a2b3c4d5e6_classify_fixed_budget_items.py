"""Classify budget items without changing budget amounts or prior months.

Revision ID: e1a2b3c4d5e6
Revises: d9915a8fd65b
"""
from alembic import op, context
import sqlalchemy as sa

revision = "e1a2b3c4d5e6"
down_revision = "d9915a8fd65b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = None if context.is_offline_mode() else sa.inspect(op.get_bind())
    if not inspector or "budget_item_treatments" not in inspector.get_table_names():
        op.create_table(
            "budget_item_treatments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("budget_item_id", sa.Integer(), sa.ForeignKey("category_budget_items.id", ondelete="CASCADE"), nullable=False),
            sa.Column("effective_month", sa.String(), nullable=False),
            sa.Column("treatment", sa.String(), nullable=False),
            sa.UniqueConstraint("budget_item_id", "effective_month", name="uq_budget_item_treatment_month"),
        )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE budget_item_treatments ENABLE ROW LEVEL SECURITY")
    op.execute("""
        INSERT INTO budget_item_treatments (budget_item_id, effective_month, treatment)
        SELECT i.id, '2026-10', 'EXCLUDED'
        FROM category_budget_items AS i
        JOIN category_budgets AS b ON b.id = i.budget_id
        WHERE b.currency = 'CAD' AND lower(trim(b.category)) IN ('rent', 'insurance')
          AND NOT EXISTS (
            SELECT 1 FROM budget_item_treatments AS t
            WHERE t.budget_item_id = i.id AND t.effective_month = '2026-10'
          )
    """)


def downgrade() -> None:
    op.drop_table("budget_item_treatments")
