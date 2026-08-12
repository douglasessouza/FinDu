"""add statement import batches

Revision ID: d4e5f6a7b8c9
Revises: 9a7c2d4e6f80
Create Date: 2026-08-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "9a7c2d4e6f80"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


EXPECTED_COLUMNS = {
    "import_batch_id": (sa.String, False),
    "account_id": (sa.Integer, False),
    "idempotency_key": (sa.String, False),
    "payload_hash": (sa.String, False),
    "inserted_count": (sa.Integer, False),
    "skipped_count": (sa.Integer, False),
    "result_json": (sa.Text, False),
    "created_at": (sa.DateTime, True),
}


def _validate_existing_table(connection: sa.Connection) -> None:
    inspector = sa.inspect(connection)
    columns = {
        column["name"]: column
        for column in inspector.get_columns("statement_import_batches")
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
    payload_hash = columns.get("payload_hash")
    if payload_hash is not None and getattr(payload_hash["type"], "length", 64) != 64:
        incompatible.append("payload_hash length is not 64")

    if inspector.get_pk_constraint("statement_import_batches").get(
        "constrained_columns"
    ) != ["import_batch_id"]:
        incompatible.append("primary key is not (import_batch_id)")
    if not any(
        constraint.get("column_names") == ["account_id", "idempotency_key"]
        for constraint in inspector.get_unique_constraints(
            "statement_import_batches"
        )
    ):
        incompatible.append("unique constraint (account_id, idempotency_key) is missing")
    if not any(
        foreign_key.get("constrained_columns") == ["account_id"]
        and foreign_key.get("referred_table") == "accounts"
        and foreign_key.get("referred_columns") == ["id"]
        and (foreign_key.get("options") or {}).get("ondelete", "").upper()
        == "CASCADE"
        for foreign_key in inspector.get_foreign_keys("statement_import_batches")
    ):
        incompatible.append(
            "foreign key account_id -> accounts.id ON DELETE CASCADE is missing"
        )

    if incompatible:
        raise RuntimeError(
            "Existing statement_import_batches table is incompatible; "
            + "; ".join(incompatible)
        )


def _create_table() -> None:
    op.create_table(
        "statement_import_batches",
        sa.Column("import_batch_id", sa.String(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("inserted_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("import_batch_id"),
        sa.UniqueConstraint(
            "account_id",
            "idempotency_key",
            name="uq_statement_import_batches_account_key",
        ),
    )


def upgrade() -> None:
    if op.get_context().as_sql:
        _create_table()
        return

    connection = op.get_bind()
    if sa.inspect(connection).has_table("statement_import_batches"):
        _validate_existing_table(connection)
    else:
        _create_table()


def downgrade() -> None:
    op.drop_table("statement_import_batches")
