"""add recurring expenses table

Revision ID: 438af8c69e49
Revises: 5a647b39836b
Create Date: 2026-04-18

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '438af8c69e49'
down_revision: Union[str, Sequence[str], None] = '5a647b39836b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.execute("""
        CREATE TABLE recurring_expenses (
            id SERIAL PRIMARY KEY,
            name VARCHAR NOT NULL,
            amount FLOAT NOT NULL,
            currency currencyenum NOT NULL,
            due_day INTEGER NOT NULL,
            category VARCHAR,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    op.create_index(op.f('ix_recurring_expenses_id'), 'recurring_expenses', ['id'], unique=False)

def downgrade() -> None:
    op.drop_index(op.f('ix_recurring_expenses_id'), table_name='recurring_expenses')
    op.drop_table('recurring_expenses')