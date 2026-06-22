"""add category budget items

Revision ID: 7f1d2c3a9b40
Revises: 2b7e9a1c4d33
Create Date: 2026-06-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7f1d2c3a9b40"
down_revision: Union[str, Sequence[str], None] = "2b7e9a1c4d33"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "category_budget_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("budget_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["budget_id"], ["category_budgets.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_category_budget_items_id"), "category_budget_items", ["id"], unique=False)

    op.execute(
        """
        INSERT INTO category_budget_items (budget_id, name, amount, created_at)
        SELECT id, 'General', amount, created_at
        FROM category_budgets
        WHERE amount > 0
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_category_budget_items_id"), table_name="category_budget_items")
    op.drop_table("category_budget_items")
