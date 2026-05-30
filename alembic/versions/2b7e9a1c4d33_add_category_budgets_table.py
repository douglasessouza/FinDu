"""add category budgets table

Revision ID: 2b7e9a1c4d33
Revises: 8d3a5c0e9f12
Create Date: 2026-05-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "2b7e9a1c4d33"
down_revision: Union[str, Sequence[str], None] = "8d3a5c0e9f12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


currency_enum = postgresql.ENUM("BRL", "CAD", "USD", "EUR", name="currencyenum", create_type=False)


def upgrade() -> None:
    op.create_table(
        "category_budgets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", currency_enum, nullable=False),
        sa.Column("start_month", sa.String(), nullable=False),
        sa.Column("valid_until", sa.DateTime(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_category_budgets_id"), "category_budgets", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_category_budgets_id"), table_name="category_budgets")
    op.drop_table("category_budgets")
