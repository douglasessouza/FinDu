"""add recurring monthly overrides

Revision ID: 6c4e8a21f9d0
Revises: 1f2d3c4b5a67
Create Date: 2026-07-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.migration_ownership import consume_adoption, record_adoption


revision: str = "6c4e8a21f9d0"
down_revision: Union[str, Sequence[str], None] = "1f2d3c4b5a67"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


EXPECTED_COLUMNS = {
    "id": (sa.Integer, False),
    "recurring_id": (sa.Integer, False),
    "month": (sa.String, False),
    "amount": (sa.Float, False),
    "created_at": (sa.DateTime, True),
}


def _validate_existing_table(connection: sa.Connection) -> None:
    inspector = sa.inspect(connection)
    columns = {
        column["name"]: column
        for column in inspector.get_columns("recurring_monthly_overrides")
    }
    missing = [name for name in EXPECTED_COLUMNS if name not in columns]
    incompatible = [f"missing columns: {', '.join(missing)}"] if missing else []
    for name, (expected_type, expected_nullable) in EXPECTED_COLUMNS.items():
        if name not in columns:
            continue
        column = columns[name]
        if not isinstance(column["type"], expected_type):
            incompatible.append(f"{name} has type {column['type']}")
        if column["nullable"] is not expected_nullable:
            incompatible.append(f"{name} has nullable={column['nullable']}")

    if inspector.get_pk_constraint("recurring_monthly_overrides").get(
        "constrained_columns"
    ) != ["id"]:
        incompatible.append("primary key is not (id)")
    if not any(
        constraint.get("column_names") == ["recurring_id", "month"]
        for constraint in inspector.get_unique_constraints(
            "recurring_monthly_overrides"
        )
    ):
        incompatible.append("unique constraint (recurring_id, month) is missing")
    if not any(
        foreign_key.get("constrained_columns") == ["recurring_id"]
        and foreign_key.get("referred_table") == "recurring_expenses"
        and foreign_key.get("referred_columns") == ["id"]
        and (foreign_key.get("options") or {}).get("ondelete", "").upper()
        == "CASCADE"
        for foreign_key in inspector.get_foreign_keys(
            "recurring_monthly_overrides"
        )
    ):
        incompatible.append(
            "foreign key recurring_id -> recurring_expenses.id ON DELETE CASCADE is missing"
        )

    if incompatible:
        raise RuntimeError(
            "Existing recurring_monthly_overrides table is incompatible; "
            + "; ".join(incompatible)
        )


def _ensure_id_index(connection: sa.Connection) -> None:
    indexes = {
        index["name"]: index
        for index in sa.inspect(connection).get_indexes(
            "recurring_monthly_overrides"
        )
    }
    existing = indexes.get("ix_recurring_monthly_overrides_id")
    if existing is None:
        op.create_index(
            op.f("ix_recurring_monthly_overrides_id"),
            "recurring_monthly_overrides",
            ["id"],
            unique=False,
        )
    elif existing["column_names"] != ["id"] or bool(existing["unique"]):
        raise RuntimeError(
            "Existing ix_recurring_monthly_overrides_id index is incompatible"
        )
    else:
        record_adoption(
            connection,
            revision,
            "index",
            "ix_recurring_monthly_overrides_id",
        )


def _create_table() -> None:
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


def upgrade() -> None:
    if op.get_context().as_sql:
        _create_table()
        return

    connection = op.get_bind()
    if sa.inspect(connection).has_table("recurring_monthly_overrides"):
        _validate_existing_table(connection)
        record_adoption(
            connection, revision, "table", "recurring_monthly_overrides"
        )
        _ensure_id_index(connection)
    else:
        _create_table()


def downgrade() -> None:
    if op.get_context().as_sql:
        op.drop_index(
            op.f("ix_recurring_monthly_overrides_id"),
            table_name="recurring_monthly_overrides",
        )
        op.drop_table("recurring_monthly_overrides")
        return

    connection = op.get_bind()
    if not consume_adoption(
        connection,
        revision,
        "index",
        "ix_recurring_monthly_overrides_id",
    ):
        op.drop_index(
            op.f("ix_recurring_monthly_overrides_id"),
            table_name="recurring_monthly_overrides",
        )
    if not consume_adoption(
        connection, revision, "table", "recurring_monthly_overrides"
    ):
        op.drop_table("recurring_monthly_overrides")
