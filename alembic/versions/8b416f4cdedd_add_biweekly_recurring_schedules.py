"""add biweekly recurring schedules

Revision ID: 8b416f4cdedd
Revises: e1a2b3c4d5e6
Create Date: 2026-11-10 12:04:43.279774

"""
from typing import Sequence, Union

from alembic import op, context
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b416f4cdedd'
down_revision: Union[str, Sequence[str], None] = 'e1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = None if context.is_offline_mode() else sa.inspect(op.get_bind())
    columns = {row['name'] for row in inspector.get_columns('recurring_expenses')} if inspector else set()
    with op.batch_alter_table('recurring_expenses') as batch:
        if 'frequency' not in columns:
            batch.add_column(sa.Column('frequency', sa.String(), nullable=False, server_default='MONTHLY'))
        if 'anchor_date' not in columns:
            batch.add_column(sa.Column('anchor_date', sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('recurring_expenses') as batch:
        batch.drop_column('anchor_date')
        batch.drop_column('frequency')
