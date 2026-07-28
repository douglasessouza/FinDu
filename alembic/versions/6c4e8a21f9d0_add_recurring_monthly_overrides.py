"""add recurring monthly overrides

Revision ID: 6c4e8a21f9d0
Revises: 1f2d3c4b5a67
Create Date: 2026-07-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "6c4e8a21f9d0"
down_revision: Union[str, Sequence[str], None] = "1f2d3c4b5a67"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recurring_monthly_overrides",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("recurring_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.String(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["recurring_id"],
            ["recurring_expenses.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "recurring_id",
            "month",
            name="uq_recurring_monthly_override_item_month",
        ),
    )
    op.create_index(
        op.f("ix_recurring_monthly_overrides_id"),
        "recurring_monthly_overrides",
        ["id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_recurring_monthly_overrides_id"),
        table_name="recurring_monthly_overrides",
    )
    op.drop_table("recurring_monthly_overrides")
