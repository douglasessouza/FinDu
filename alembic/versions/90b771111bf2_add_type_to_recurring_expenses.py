"""add type to recurring_expenses

Revision ID: 90b771111bf2
Revises: 438af8c69e49
Create Date: 2026-04-20 13:53:48.800099

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '90b771111bf2'
down_revision: Union[str, Sequence[str], None] = '438af8c69e49'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE TYPE recurringtypeenum AS ENUM ('EXPENSE', 'INCOME')")
    op.add_column('recurring_expenses', sa.Column('type', sa.Enum('EXPENSE', 'INCOME', name='recurringtypeenum'), nullable=False, server_default='EXPENSE'))

def downgrade() -> None:
    op.drop_column('recurring_expenses', 'type')
    op.execute("DROP TYPE recurringtypeenum")
