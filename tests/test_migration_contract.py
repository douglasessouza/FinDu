from datetime import datetime
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient

import app.main as main
from app.imports import transaction_fingerprint
from app.models import Base, Transaction


EXPECTED_INDEXES = {
    "transactions": {
        "ix_transactions_account_date": ("account_id", "date"),
        "ix_transactions_account_statement_month": ("account_id", "statement_month"),
        "ix_transactions_date": ("date",),
        "ix_transactions_statement_month": ("statement_month",),
        "ix_transactions_import_batch_id": ("import_batch_id",),
        "ix_transactions_category_date": ("category", "date"),
    },
    "monthly_payments": {"ix_monthly_payments_month": ("month",)},
    "recurring_matches": {"ix_recurring_matches_month": ("month",)},
    "recurring_monthly_overrides": {
        "ix_recurring_monthly_overrides_month": ("month",),
    },
    "category_budget_items": {
        "ix_category_budget_items_budget_id": ("budget_id",),
    },
}

DEFAULT_CATEGORY_NAMES = {
    "Housing", "Rent", "Food", "Restaurant", "Coffee", "Transport", "Gas",
    "Health", "Wellness", "Education", "Subscriptions", "Entertainment",
    "Leisure", "Travel", "Clothing", "Phone", "Car", "Insurance",
    "Investments", "Other", "Salary", "Other Income", "Transfer",
}


def _load_migration_module():
    versions = Path("alembic/versions")
    matches = list(versions.glob("*_optimize_performance_and_imports.py"))
    assert len(matches) == 1
    spec = spec_from_file_location("performance_import_migration", matches[0])
    assert spec and spec.loader
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _legacy_metadata(*, include_categories: bool = True) -> sa.MetaData:
    metadata = sa.MetaData()
    sa.Table("accounts", metadata, sa.Column("id", sa.Integer, primary_key=True))
    sa.Table(
        "transactions",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("account_id", sa.Integer, nullable=False),
        sa.Column("description", sa.String, nullable=False),
        sa.Column("amount", sa.Float, nullable=False),
        sa.Column("date", sa.DateTime, nullable=False),
        sa.Column("category", sa.String),
        sa.Column("statement_month", sa.String),
        sa.Column("import_batch_id", sa.String),
    )
    if include_categories:
        sa.Table(
            "categories",
            metadata,
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("name", sa.String, nullable=False, unique=True),
            sa.Column("type", sa.String, nullable=False),
            sa.Column("is_default", sa.Boolean),
            sa.Column("created_at", sa.DateTime),
        )
    sa.Table(
        "category_budgets",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("amount", sa.Float, nullable=False),
        sa.Column("created_at", sa.DateTime),
    )
    sa.Table(
        "category_budget_items",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("budget_id", sa.Integer, nullable=False),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("amount", sa.Float, nullable=False),
        sa.Column("created_at", sa.DateTime),
    )
    sa.Table(
        "monthly_payments",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("month", sa.String, nullable=False),
    )
    sa.Table(
        "recurring_matches",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("month", sa.String, nullable=False),
    )
    sa.Table(
        "recurring_monthly_overrides",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("month", sa.String, nullable=False),
    )
    return metadata


def test_transaction_model_persists_import_identity():
    columns = Transaction.__table__.columns

    assert columns["import_fingerprint"].nullable is True
    assert columns["import_occurrence"].nullable is True
    assert columns["import_idempotency_key"].nullable is True

    identity_index = next(
        index
        for index in Transaction.__table__.indexes
        if index.name == "uq_transactions_import_identity"
    )
    assert identity_index.unique is True
    assert tuple(column.name for column in identity_index.columns) == (
        "account_id",
        "import_fingerprint",
        "import_occurrence",
    )
    expected_predicate = (
        "import_fingerprint IS NOT NULL AND import_occurrence IS NOT NULL"
    )
    assert str(identity_index.dialect_options["postgresql"]["where"]) == expected_predicate
    assert str(identity_index.dialect_options["sqlite"]["where"]) == expected_predicate


def test_model_indexes_match_query_patterns():
    for table_name, expected_indexes in EXPECTED_INDEXES.items():
        table = Base.metadata.tables[table_name]
        actual = {
            index.name: tuple(column.name for column in index.columns)
            for index in table.indexes
        }
        for index_name, columns in expected_indexes.items():
            assert actual[index_name] == columns


@pytest.mark.parametrize("forbidden_operation", ["create_all", "inspect", "alter", "seed"])
def test_application_startup_performs_no_schema_or_seed_work(monkeypatch, forbidden_operation):
    def fail(*args, **kwargs):
        raise AssertionError(f"startup called forbidden operation: {forbidden_operation}")

    if forbidden_operation == "create_all":
        monkeypatch.setattr(Base.metadata, "create_all", fail)
    elif forbidden_operation == "inspect":
        if hasattr(main, "inspect"):
            monkeypatch.setattr(main, "inspect", fail)
    elif forbidden_operation == "alter":
        class MissingStartMonthInspector:
            def has_table(self, table_name):
                return True

            def get_columns(self, table_name):
                return []

        if hasattr(main, "inspect"):
            monkeypatch.setattr(main, "inspect", lambda engine: MissingStartMonthInspector())
        monkeypatch.setattr(main.engine, "begin", fail)
    else:
        monkeypatch.setattr(main, "SessionLocal", fail)

    with TestClient(main.app):
        pass


def test_migration_backfills_only_imported_rows_and_seeds_reference_data():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite://")
    metadata = _legacy_metadata()
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            metadata.tables["transactions"].insert(),
            [
                {
                    "id": 20,
                    "account_id": 1,
                    "description": "Coffee Shop",
                    "amount": -4.5,
                    "date": datetime(2026, 8, 1, 9),
                    "category": "Food",
                    "statement_month": "2026-08",
                    "import_batch_id": "batch-old",
                },
                {
                    "id": 10,
                    "account_id": 1,
                    "description": " coffee   shop ",
                    "amount": -4.5,
                    "date": datetime(2026, 8, 1, 8),
                    "category": "Food",
                    "statement_month": "2026-08",
                    "import_batch_id": "batch-old",
                },
                {
                    "id": 30,
                    "account_id": 1,
                    "description": "Manual row",
                    "amount": -9,
                    "date": datetime(2026, 8, 2, 8),
                    "category": "Other",
                    "statement_month": None,
                    "import_batch_id": None,
                },
            ],
        )
        connection.execute(
            metadata.tables["categories"].insert(),
            {"id": 1, "name": "Food", "type": "INCOME", "is_default": False},
        )
        connection.execute(
            metadata.tables["category_budgets"].insert(),
            [
                {"id": 1, "amount": 100.0},
                {"id": 2, "amount": 80.0},
                {"id": 3, "amount": 0.0},
            ],
        )
        connection.execute(
            metadata.tables["category_budget_items"].insert(),
            {"id": 1, "budget_id": 2, "name": "Existing", "amount": 80.0},
        )

        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration._seed_reference_data(connection)

        rows = connection.execute(
            sa.text(
                "SELECT id, import_fingerprint, import_occurrence, import_idempotency_key "
                "FROM transactions ORDER BY id"
            )
        ).mappings().all()
        categories = connection.execute(
            sa.text("SELECT name, type, is_default FROM categories ORDER BY name")
        ).mappings().all()
        budget_items = connection.execute(
            sa.text(
                "SELECT budget_id, name, amount FROM category_budget_items ORDER BY budget_id"
            )
        ).mappings().all()

    expected_fingerprint = transaction_fingerprint(
        1, "2026-08-01", "Coffee Shop", -4.5
    )
    assert rows == [
        {
            "id": 10,
            "import_fingerprint": expected_fingerprint,
            "import_occurrence": 1,
            "import_idempotency_key": "batch-old",
        },
        {
            "id": 20,
            "import_fingerprint": expected_fingerprint,
            "import_occurrence": 2,
            "import_idempotency_key": "batch-old",
        },
        {
            "id": 30,
            "import_fingerprint": None,
            "import_occurrence": None,
            "import_idempotency_key": None,
        },
    ]
    assert {row["name"] for row in categories} == DEFAULT_CATEGORY_NAMES
    assert next(row for row in categories if row["name"] == "Food") == {
        "name": "Food",
        "type": "INCOME",
        "is_default": 0,
    }
    assert next(row for row in categories if row["name"] == "Housing") == {
        "name": "Housing",
        "type": "EXPENSE",
        "is_default": 1,
    }
    assert next(row for row in categories if row["name"] == "Salary") == {
        "name": "Salary",
        "type": "INCOME",
        "is_default": 1,
    }
    assert next(row for row in categories if row["name"] == "Transfer") == {
        "name": "Transfer",
        "type": "TRANSFER",
        "is_default": 1,
    }
    assert budget_items == [
        {"budget_id": 1, "name": "General", "amount": 100.0},
        {"budget_id": 2, "name": "Existing", "amount": 80.0},
    ]


def test_migration_creates_query_indexes():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite://")
    metadata = _legacy_metadata()
    metadata.create_all(engine)

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        inspector = sa.inspect(connection)

        for table_name, expected_indexes in EXPECTED_INDEXES.items():
            actual = {
                index["name"]: tuple(index["column_names"])
                for index in inspector.get_indexes(table_name)
            }
            for index_name, columns in expected_indexes.items():
                assert actual[index_name] == columns

        identity = next(
            index
            for index in inspector.get_indexes("transactions")
            if index["name"] == "uq_transactions_import_identity"
        )
        assert identity["unique"] == 1
        assert str(identity["dialect_options"]["sqlite_where"]) == (
            "import_fingerprint IS NOT NULL AND import_occurrence IS NOT NULL"
        )


def test_migration_repairs_the_historical_missing_categories_table():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite://")
    metadata = _legacy_metadata(include_categories=False)
    metadata.create_all(engine)

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        inspector = sa.inspect(connection)
        assert "categories" in inspector.get_table_names()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM categories")) == len(
            DEFAULT_CATEGORY_NAMES
        )


def test_alembic_upgrade_head_bootstraps_an_empty_sqlite_database(tmp_path, monkeypatch):
    database_path = tmp_path / "migration.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")

    command.upgrade(Config("alembic.ini"), "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) >= {
        "accounts",
        "transactions",
        "categories",
        "category_budget_items",
        "alembic_version",
    }
    assert {
        column["name"] for column in inspector.get_columns("transactions")
    } >= {"import_fingerprint", "import_occurrence", "import_idempotency_key"}
    with engine.connect() as connection:
        assert connection.scalar(sa.text("SELECT version_num FROM alembic_version")) == (
            "9a7c2d4e6f80"
        )
