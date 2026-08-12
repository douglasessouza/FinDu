"""optimize performance and imports

Revision ID: 9a7c2d4e6f80
Revises: 6c4e8a21f9d0
Create Date: 2026-08-11

"""
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
from typing import Sequence, Union
import unicodedata

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "9a7c2d4e6f80"
down_revision: Union[str, Sequence[str], None] = "6c4e8a21f9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_CATEGORIES = (
    ("Housing", "EXPENSE"), ("Rent", "EXPENSE"), ("Food", "EXPENSE"),
    ("Restaurant", "EXPENSE"), ("Coffee", "EXPENSE"), ("Transport", "EXPENSE"),
    ("Gas", "EXPENSE"), ("Health", "EXPENSE"), ("Wellness", "EXPENSE"),
    ("Education", "EXPENSE"), ("Subscriptions", "EXPENSE"),
    ("Entertainment", "EXPENSE"), ("Leisure", "EXPENSE"), ("Travel", "EXPENSE"),
    ("Clothing", "EXPENSE"), ("Phone", "EXPENSE"), ("Car", "EXPENSE"),
    ("Insurance", "EXPENSE"), ("Investments", "EXPENSE"), ("Other", "EXPENSE"),
    ("Salary", "INCOME"), ("Other Income", "INCOME"), ("Transfer", "TRANSFER"),
)

QUERY_INDEXES = (
    ("ix_transactions_account_date", "transactions", ("account_id", "date")),
    (
        "ix_transactions_account_statement_month",
        "transactions",
        ("account_id", "statement_month"),
    ),
    ("ix_transactions_date", "transactions", ("date",)),
    ("ix_transactions_statement_month", "transactions", ("statement_month",)),
    ("ix_transactions_import_batch_id", "transactions", ("import_batch_id",)),
    ("ix_transactions_category_date", "transactions", ("category", "date")),
    ("ix_monthly_payments_month", "monthly_payments", ("month",)),
    ("ix_recurring_matches_month", "recurring_matches", ("month",)),
    (
        "ix_recurring_monthly_overrides_month",
        "recurring_monthly_overrides",
        ("month",),
    ),
    (
        "ix_category_budget_items_budget_id",
        "category_budget_items",
        ("budget_id",),
    ),
)

IMPORT_COLUMNS = (
    ("import_fingerprint", sa.String(), True),
    ("import_occurrence", sa.Integer(), True),
    ("import_idempotency_key", sa.String(), True),
)

BACKFILL_BATCH_SIZE = 500


def _canonical_date(value: date | datetime | str) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()


def _transaction_fingerprint(
    account_id: int,
    date_value: date | datetime | str,
    description: str,
    amount: Decimal | float | str,
) -> str:
    normalized_description = " ".join(
        unicodedata.normalize("NFC", description).split()
    ).casefold()
    cents = Decimal(str(amount)).quantize(Decimal("0.01")) * 100
    payload = json.dumps(
        [account_id, _canonical_date(date_value), normalized_description, int(cents)],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _backfill_import_identity(connection: sa.Connection) -> None:
    transactions = sa.table(
        "transactions",
        sa.column("id", sa.Integer),
        sa.column("account_id", sa.Integer),
        sa.column("date", sa.DateTime),
        sa.column("description", sa.String),
        sa.column("amount", sa.Float),
        sa.column("import_batch_id", sa.String),
        sa.column("import_fingerprint", sa.String),
        sa.column("import_occurrence", sa.Integer),
        sa.column("import_idempotency_key", sa.String),
    )
    imported_rows = connection.execution_options(
        stream_results=True,
        max_row_buffer=BACKFILL_BATCH_SIZE,
    ).execute(
        sa.select(
            transactions.c.id,
            transactions.c.account_id,
            transactions.c.date,
            transactions.c.description,
            transactions.c.amount,
            transactions.c.import_batch_id,
            transactions.c.import_fingerprint,
            transactions.c.import_occurrence,
            transactions.c.import_idempotency_key,
        )
        .where(transactions.c.import_batch_id.is_not(None))
        .order_by(transactions.c.account_id, transactions.c.date, transactions.c.id)
    ).mappings()

    occurrences: dict[tuple[int, str], int] = defaultdict(int)
    occurrence_scope: tuple[int, str] | None = None
    update_statement = (
        transactions.update()
        .where(transactions.c.id == sa.bindparam("transaction_id"))
        .values(
            import_fingerprint=sa.bindparam("fingerprint"),
            import_occurrence=sa.bindparam("occurrence"),
            import_idempotency_key=sa.bindparam("idempotency_key"),
        )
    )
    for rows in imported_rows.partitions(BACKFILL_BATCH_SIZE):
        updates = []
        for row in rows:
            row_scope = (row["account_id"], _canonical_date(row["date"]))
            if row_scope != occurrence_scope:
                occurrences.clear()
                occurrence_scope = row_scope
            fingerprint = _transaction_fingerprint(
                row["account_id"], row["date"], row["description"], row["amount"]
            )
            identity = (row["account_id"], fingerprint)
            occurrences[identity] += 1
            if (
                row["import_fingerprint"] is not None
                and row["import_occurrence"] is not None
                and row["import_idempotency_key"] is not None
            ):
                continue
            updates.append(
                {
                    "transaction_id": row["id"],
                    "fingerprint": fingerprint,
                    "occurrence": occurrences[identity],
                    "idempotency_key": row["import_batch_id"],
                }
            )

        if updates:
            connection.execute(
                update_statement,
                updates,
            )


def _seed_reference_data(connection: sa.Connection) -> None:
    connection.execute(
        sa.text(
            """
            INSERT INTO categories (name, type, is_default, created_at)
            VALUES (:name, :type, TRUE, CURRENT_TIMESTAMP)
            ON CONFLICT (name) DO NOTHING
            """
        ),
        [
            {"name": name, "type": category_type}
            for name, category_type in DEFAULT_CATEGORIES
        ],
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO category_budget_items (budget_id, name, amount, created_at)
            SELECT budget.id, 'General', budget.amount,
                   COALESCE(budget.created_at, CURRENT_TIMESTAMP)
            FROM category_budgets AS budget
            WHERE budget.amount > 0
              AND NOT EXISTS (
                  SELECT 1
                  FROM category_budget_items AS item
                  WHERE item.budget_id = budget.id
              )
            """
        )
        )


def _ensure_column(
    connection: sa.Connection,
    table_name: str,
    column_name: str,
    column_type: sa.types.TypeEngine,
    nullable: bool,
) -> None:
    columns = {
        column["name"]: column
        for column in sa.inspect(connection).get_columns(table_name)
    }
    existing = columns.get(column_name)
    if existing is None:
        op.add_column(
            table_name,
            sa.Column(column_name, column_type, nullable=nullable),
        )
        return
    if (
        not isinstance(existing["type"], type(column_type))
        or existing["nullable"] is not nullable
    ):
        raise RuntimeError(
            f"Existing {table_name}.{column_name} column is incompatible"
        )


def _normalize_predicate(predicate: object) -> str:
    normalized = str(predicate).lower()
    for character in '()"':
        normalized = normalized.replace(character, " ")
    return " ".join(normalized.split())


def _ensure_index(
    connection: sa.Connection,
    index_name: str,
    table_name: str,
    columns: tuple[str, ...],
    *,
    unique: bool = False,
    predicate: sa.TextClause | None = None,
) -> None:
    indexes = {
        index["name"]: index
        for index in sa.inspect(connection).get_indexes(table_name)
    }
    existing = indexes.get(index_name)
    if existing is None:
        options = {}
        if predicate is not None:
            options = {
                "postgresql_where": predicate,
                "sqlite_where": predicate,
            }
        op.create_index(
            index_name,
            table_name,
            list(columns),
            unique=unique,
            **options,
        )
        return

    incompatible = (
        tuple(existing["column_names"]) != columns
        or bool(existing["unique"]) is not unique
    )
    if predicate is not None and connection.dialect.name in {"postgresql", "sqlite"}:
        dialect_options = existing.get("dialect_options") or {}
        existing_predicate = dialect_options.get(
            f"{connection.dialect.name}_where"
        )
        incompatible = incompatible or existing_predicate is None or (
            _normalize_predicate(existing_predicate)
            != _normalize_predicate(predicate)
        )
    if incompatible:
        raise RuntimeError(f"Existing {index_name} index is incompatible")


def _ensure_categories_table(connection: sa.Connection) -> None:
    if sa.inspect(connection).has_table("categories"):
        return

    enum_values = ("EXPENSE", "INCOME", "TRANSFER")
    if connection.dialect.name == "postgresql":
        postgresql.ENUM(*enum_values, name="categorytypeenum").create(
            connection, checkfirst=True
        )
        category_type = postgresql.ENUM(
            *enum_values, name="categorytypeenum", create_type=False
        )
    else:
        category_type = sa.Enum(*enum_values, name="categorytypeenum")
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("type", category_type, nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_categories_id", "categories", ["id"], unique=False)


def upgrade() -> None:
    connection = op.get_bind()
    if op.get_context().as_sql:
        for column_name, column_type, nullable in IMPORT_COLUMNS:
            op.add_column(
                "transactions",
                sa.Column(column_name, column_type, nullable=nullable),
            )
    else:
        for column_name, column_type, nullable in IMPORT_COLUMNS:
            _ensure_column(
                connection,
                "transactions",
                column_name,
                column_type,
                nullable,
            )

    _backfill_import_identity(connection)

    identity_predicate = sa.text(
        "import_fingerprint IS NOT NULL AND import_occurrence IS NOT NULL"
    )
    if op.get_context().as_sql:
        for index_name, table_name, columns in QUERY_INDEXES:
            op.create_index(index_name, table_name, list(columns), unique=False)
        op.create_index(
            "uq_transactions_import_identity",
            "transactions",
            ["account_id", "import_fingerprint", "import_occurrence"],
            unique=True,
            postgresql_where=identity_predicate,
            sqlite_where=identity_predicate,
        )
    else:
        for index_name, table_name, columns in QUERY_INDEXES:
            _ensure_index(connection, index_name, table_name, columns)
        _ensure_index(
            connection,
            "uq_transactions_import_identity",
            "transactions",
            ("account_id", "import_fingerprint", "import_occurrence"),
            unique=True,
            predicate=identity_predicate,
        )

    _ensure_categories_table(connection)
    _seed_reference_data(connection)


def downgrade() -> None:
    op.drop_index("uq_transactions_import_identity", table_name="transactions")
    for index_name, table_name, _ in reversed(QUERY_INDEXES):
        op.drop_index(index_name, table_name=table_name)

    op.drop_column("transactions", "import_idempotency_key")
    op.drop_column("transactions", "import_occurrence")
    op.drop_column("transactions", "import_fingerprint")
