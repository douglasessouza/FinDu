"""add category budget items

Revision ID: 7f1d2c3a9b40
Revises: 2b7e9a1c4d33
Create Date: 2026-06-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7f1d2c3a9b40"
down_revision: Union[str, Sequence[str], None] = "2b7e9a1c4d33"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


EXPECTED_COLUMNS = {
    "id": (sa.Integer, False),
    "budget_id": (sa.Integer, False),
    "name": (sa.String, False),
    "amount": (sa.Float, False),
    "created_at": (sa.DateTime, True),
}


def _validate_existing_table(connection: sa.Connection) -> None:
    inspector = sa.inspect(connection)
    columns = {
        column["name"]: column
        for column in inspector.get_columns("category_budget_items")
    }
    missing = [name for name in EXPECTED_COLUMNS if name not in columns]
    if missing:
        raise RuntimeError(
            "Existing category_budget_items table is incompatible; missing columns: "
            + ", ".join(missing)
        )

    incompatible = []
    for name, (expected_type, expected_nullable) in EXPECTED_COLUMNS.items():
        column = columns[name]
        if not isinstance(column["type"], expected_type):
            incompatible.append(f"{name} has type {column['type']}")
        if column["nullable"] is not expected_nullable:
            incompatible.append(f"{name} has nullable={column['nullable']}")

    primary_key = inspector.get_pk_constraint("category_budget_items")
    if primary_key.get("constrained_columns") != ["id"]:
        incompatible.append("primary key is not (id)")

    foreign_keys = inspector.get_foreign_keys("category_budget_items")
    expected_foreign_key = any(
        foreign_key.get("constrained_columns") == ["budget_id"]
        and foreign_key.get("referred_table") == "category_budgets"
        and foreign_key.get("referred_columns") == ["id"]
        for foreign_key in foreign_keys
    )
    if not expected_foreign_key:
        incompatible.append("foreign key budget_id -> category_budgets.id is missing")

    if incompatible:
        raise RuntimeError(
            "Existing category_budget_items table is incompatible; "
            + "; ".join(incompatible)
        )


def _ensure_id_index(connection: sa.Connection) -> None:
    indexes = {
        index["name"]: index
        for index in sa.inspect(connection).get_indexes("category_budget_items")
    }
    existing = indexes.get("ix_category_budget_items_id")
    if existing is None:
        op.create_index(
            op.f("ix_category_budget_items_id"),
            "category_budget_items",
            ["id"],
            unique=False,
        )
    elif existing["column_names"] != ["id"] or bool(existing["unique"]):
        raise RuntimeError(
            "Existing ix_category_budget_items_id index is incompatible"
        )


def _create_table() -> None:
    op.create_table(
        "category_budget_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("budget_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["budget_id"], ["category_budgets.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_category_budget_items_id"),
        "category_budget_items",
        ["id"],
        unique=False,
    )


def upgrade() -> None:
    if op.get_context().as_sql:
        _create_table()
    else:
        connection = op.get_bind()
        if sa.inspect(connection).has_table("category_budget_items"):
            _validate_existing_table(connection)
            _ensure_id_index(connection)
        else:
            _create_table()

    op.execute(
        """
        INSERT INTO category_budget_items (budget_id, name, amount, created_at)
        SELECT id, 'General', amount, created_at
        FROM category_budgets
        WHERE amount > 0
          AND NOT EXISTS (
              SELECT 1
              FROM category_budget_items AS item
              WHERE item.budget_id = category_budgets.id
          )
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_category_budget_items_id"), table_name="category_budget_items")
    op.drop_table("category_budget_items")
