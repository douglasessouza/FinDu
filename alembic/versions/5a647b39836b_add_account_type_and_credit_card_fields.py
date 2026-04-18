"""add account_type and credit card fields

Revision ID: 5a647b39836b
Revises: e5c01ad06da2
Create Date: 2026-04-18 17:02:28.847580

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '5a647b39836b'
down_revision: Union[str, Sequence[str], None] = 'e5c01ad06da2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Define the enum type
account_type_enum = sa.Enum('CHECKING', 'SAVINGS', 'CREDIT_CARD', name='accounttypeenum')

def upgrade() -> None:
    # Create the enum type first
    account_type_enum.create(op.get_bind(), checkfirst=True)

    op.add_column('accounts', sa.Column('account_type', account_type_enum, nullable=True))
    op.add_column('accounts', sa.Column('credit_limit', sa.Float(), nullable=True))
    op.add_column('accounts', sa.Column('closing_day', sa.Integer(), nullable=True))
    op.add_column('accounts', sa.Column('due_day', sa.Integer(), nullable=True))

def downgrade() -> None:
    op.drop_column('accounts', 'due_day')
    op.drop_column('accounts', 'closing_day')
    op.drop_column('accounts', 'credit_limit')
    op.drop_column('accounts', 'account_type')
    account_type_enum.drop(op.get_bind(), checkfirst=True)