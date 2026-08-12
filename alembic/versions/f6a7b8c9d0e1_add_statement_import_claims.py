"""add statement import claims

Revision ID: f6a7b8c9d0e1
Revises: d4e5f6a7b8c9
Create Date: 2026-08-12

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BACKFILL_BATCH_SIZE = 500


def _valid_identity(
    fingerprint: object, occurrence: object
) -> tuple[str, int] | None:
    if not isinstance(fingerprint, str) or not fingerprint:
        return None
    if not isinstance(occurrence, int) or isinstance(occurrence, bool) or occurrence < 1:
        return None
    return fingerprint, occurrence


def _batch_result_identities(result_json: object) -> list[tuple[str, int]]:
    if not isinstance(result_json, str):
        return []
    try:
        result = json.loads(result_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(result, dict) or not isinstance(result.get("transactions"), list):
        return []

    identities = []
    for transaction in result["transactions"]:
        if not isinstance(transaction, dict):
            continue
        identity = _valid_identity(
            transaction.get("import_fingerprint"),
            transaction.get("import_occurrence"),
        )
        if identity:
            identities.append(identity)
    return identities


def _backfill_claims(connection: sa.Connection) -> None:
    claims = sa.table(
        "statement_import_claims",
        sa.column("account_id", sa.Integer),
        sa.column("fingerprint", sa.String),
        sa.column("occurrence", sa.Integer),
        sa.column("import_batch_id", sa.String),
    )
    batches = sa.table(
        "statement_import_batches",
        sa.column("import_batch_id", sa.String),
        sa.column("account_id", sa.Integer),
        sa.column("result_json", sa.Text),
        sa.column("created_at", sa.DateTime),
    )
    transactions = sa.table(
        "transactions",
        sa.column("id", sa.Integer),
        sa.column("account_id", sa.Integer),
        sa.column("import_batch_id", sa.String),
        sa.column("import_fingerprint", sa.String),
        sa.column("import_occurrence", sa.Integer),
    )

    pending: list[dict] = []
    seen: set[tuple[int, str, int]] = set()

    def collect(
        account_id: int,
        import_batch_id: str,
        fingerprint: object,
        occurrence: object,
    ) -> None:
        identity = _valid_identity(fingerprint, occurrence)
        if not identity:
            return
        key = (account_id, identity[0], identity[1])
        if key in seen:
            return
        seen.add(key)
        pending.append(
            {
                "account_id": account_id,
                "fingerprint": identity[0],
                "occurrence": identity[1],
                "import_batch_id": import_batch_id,
            }
        )
        if len(pending) >= BACKFILL_BATCH_SIZE:
            connection.execute(claims.insert(), pending)
            pending.clear()

    batch_rows = connection.execution_options(
        stream_results=True,
        max_row_buffer=BACKFILL_BATCH_SIZE,
    ).execute(
        sa.select(
            batches.c.import_batch_id,
            batches.c.account_id,
            batches.c.result_json,
        ).order_by(batches.c.created_at, batches.c.import_batch_id)
    ).mappings()
    for rows in batch_rows.partitions(BACKFILL_BATCH_SIZE):
        for row in rows:
            for fingerprint, occurrence in _batch_result_identities(
                row["result_json"]
            ):
                collect(
                    row["account_id"],
                    row["import_batch_id"],
                    fingerprint,
                    occurrence,
                )

    transaction_rows = connection.execution_options(
        stream_results=True,
        max_row_buffer=BACKFILL_BATCH_SIZE,
    ).execute(
        sa.select(
            transactions.c.account_id,
            transactions.c.import_batch_id,
            transactions.c.import_fingerprint,
            transactions.c.import_occurrence,
        )
        .where(transactions.c.import_batch_id.is_not(None))
        .where(transactions.c.import_fingerprint.is_not(None))
        .where(transactions.c.import_occurrence.is_not(None))
        .order_by(transactions.c.account_id, transactions.c.id)
    ).mappings()
    for rows in transaction_rows.partitions(BACKFILL_BATCH_SIZE):
        for row in rows:
            collect(
                row["account_id"],
                row["import_batch_id"],
                row["import_fingerprint"],
                row["import_occurrence"],
            )

    if pending:
        connection.execute(claims.insert(), pending)


def upgrade() -> None:
    op.create_table(
        "statement_import_claims",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("occurrence", sa.Integer(), nullable=False),
        sa.Column("import_batch_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "account_id",
            "fingerprint",
            "occurrence",
            name="uq_statement_import_claim_identity",
        ),
    )
    op.create_index(
        "ix_statement_import_claims_import_batch_id",
        "statement_import_claims",
        ["import_batch_id"],
        unique=False,
    )
    _backfill_claims(op.get_bind())


def downgrade() -> None:
    op.drop_index(
        "ix_statement_import_claims_import_batch_id",
        table_name="statement_import_claims",
    )
    op.drop_table("statement_import_claims")
