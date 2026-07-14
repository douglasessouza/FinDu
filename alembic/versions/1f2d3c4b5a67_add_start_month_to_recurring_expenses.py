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
    op.add_column("recurring_expenses", sa.Column("start_month", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("recurring_expenses", "start_month")
