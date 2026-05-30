"""add recurring matches table

Revision ID: 8d3a5c0e9f12
Revises: 4901bae6a200
Create Date: 2026-05-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8d3a5c0e9f12"
down_revision: Union[str, Sequence[str], None] = "4901bae6a200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recurring_matches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("month", sa.String(), nullable=False),
        sa.Column("recurring_id", sa.Integer(), nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=False),
        sa.Column("planned_amount", sa.Float(), nullable=False),
        sa.Column("actual_amount", sa.Float(), nullable=False),
        sa.Column("variance", sa.Float(), nullable=False),
        sa.Column("confidence", sa.String(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["recurring_id"], ["recurring_expenses.id"]),
        sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("month", "recurring_id", name="uq_recurring_match_month_item"),
    )
    op.create_index(op.f("ix_recurring_matches_id"), "recurring_matches", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_recurring_matches_id"), table_name="recurring_matches")
    op.drop_table("recurring_matches")
