"""add start_month to recurring_expenses

Revision ID: 1f2d3c4b5a67
Revises: 7f1d2c3a9b40
Create Date: 2026-07-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "1f2d3c4b5a67"
down_revision: Union[str, Sequence[str], None] = "7f1d2c3a9b40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_context().as_sql:
        op.add_column(
            "recurring_expenses", sa.Column("start_month", sa.String(), nullable=True)
        )
        return

    columns = {
        column["name"]: column
        for column in sa.inspect(op.get_bind()).get_columns("recurring_expenses")
    }
    existing = columns.get("start_month")
    if existing is None:
        op.add_column(
            "recurring_expenses", sa.Column("start_month", sa.String(), nullable=True)
        )
    elif not isinstance(existing["type"], sa.String) or not existing["nullable"]:
        raise RuntimeError(
            "Existing recurring_expenses.start_month column is incompatible"
        )


def downgrade() -> None:
    op.drop_column("recurring_expenses", "start_month")
