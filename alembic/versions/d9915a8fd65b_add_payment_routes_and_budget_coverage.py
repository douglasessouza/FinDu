"""add payment routes and budget coverage

Revision ID: d9915a8fd65b
Revises: f6a7b8c9d0e1
Create Date: 2026-10-06 16:14:54.645519

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9915a8fd65b'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("recurring_expenses") as batch:
        batch.add_column(sa.Column("planning_kind", sa.String(), nullable=False, server_default="FIXED"))
        batch.add_column(sa.Column("payment_method", sa.String(), nullable=False, server_default="UNSET"))
        batch.add_column(sa.Column("payment_account_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_recurring_payment_account", "accounts", ["payment_account_id"], ["id"], ondelete="SET NULL")
    op.create_table("budget_coverages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("budget_item_id", sa.Integer(), sa.ForeignKey("category_budget_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recurring_id", sa.Integer(), sa.ForeignKey("recurring_expenses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.UniqueConstraint("budget_item_id", "recurring_id", name="uq_budget_coverage_item_recurring"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("budget_coverages")
    with op.batch_alter_table("recurring_expenses") as batch:
        batch.drop_constraint("fk_recurring_payment_account", type_="foreignkey")
        batch.drop_column("payment_account_id")
        batch.drop_column("payment_method")
        batch.drop_column("planning_kind")
