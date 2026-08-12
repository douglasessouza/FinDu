from datetime import datetime
from importlib.util import module_from_spec, spec_from_file_location
from io import StringIO
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

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

IMPORT_BATCH_REVISION = "d4e5f6a7b8c9"
IMPORT_CLAIM_REVISION = "f6a7b8c9d0e1"


def _load_migration_module():
    versions = Path("alembic/versions")
    matches = list(versions.glob("*_optimize_performance_and_imports.py"))
    assert len(matches) == 1
    spec = spec_from_file_location("performance_import_migration", matches[0])
    assert spec and spec.loader
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_import_batch_migration_module():
    versions = Path("alembic/versions")
    matches = list(versions.glob("*_add_statement_import_batches.py"))
    assert len(matches) == 1
    spec = spec_from_file_location("statement_import_batch_migration", matches[0])
    assert spec and spec.loader
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_import_claim_migration_module():
    versions = Path("alembic/versions")
    matches = list(versions.glob("*_add_statement_import_claims.py"))
    assert len(matches) == 1
    spec = spec_from_file_location("statement_import_claim_migration", matches[0])
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


def test_statement_import_batch_model_persists_idempotency_result():
    table = Base.metadata.tables["statement_import_batches"]
    columns = table.columns

    assert columns["import_batch_id"].primary_key is True
    assert columns["account_id"].nullable is False
    assert columns["idempotency_key"].nullable is False
    assert columns["payload_hash"].nullable is False
    assert columns["inserted_count"].nullable is False
    assert columns["skipped_count"].nullable is False
    assert columns["result_json"].nullable is False
    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, sa.UniqueConstraint)
    }
    assert ("account_id", "idempotency_key") in unique_columns


def test_statement_import_claim_model_persists_source_lineage():
    table = Base.metadata.tables["statement_import_claims"]
    columns = table.columns

    assert columns["id"].primary_key is True
    assert columns["account_id"].nullable is False
    assert columns["fingerprint"].nullable is False
    assert columns["occurrence"].nullable is False
    assert columns["import_batch_id"].nullable is False
    assert not columns["import_batch_id"].foreign_keys
    unique_columns = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, sa.UniqueConstraint)
    }
    assert ("account_id", "fingerprint", "occurrence") in unique_columns
    batch_index = next(
        index
        for index in table.indexes
        if index.name == "ix_statement_import_claims_import_batch_id"
    )
    assert tuple(column.name for column in batch_index.columns) == ("import_batch_id",)


def test_statement_import_batch_migration_runs_on_sqlite_and_downgrades():
    migration = _load_import_batch_migration_module()
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("accounts", metadata, sa.Column("id", sa.Integer, primary_key=True))
    metadata.create_all(engine)

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert "statement_import_batches" in inspector.get_table_names()
        unique_constraints = inspector.get_unique_constraints(
            "statement_import_batches"
        )
        assert any(
            constraint["column_names"] == ["account_id", "idempotency_key"]
            for constraint in unique_constraints
        )

        migration.downgrade()
        assert "statement_import_batches" not in sa.inspect(connection).get_table_names()


def test_statement_import_batch_postgresql_ddl_has_unique_claim_constraint():
    migration = _load_import_batch_migration_module()
    output = StringIO()
    migration_context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    migration.op = Operations(migration_context)

    migration.upgrade()

    sql = output.getvalue()
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revision = script.get_revision(IMPORT_BATCH_REVISION)
    assert revision.revision == IMPORT_BATCH_REVISION
    assert revision.down_revision == "9a7c2d4e6f80"
    assert "CREATE TABLE statement_import_batches" in sql
    assert "UNIQUE (account_id, idempotency_key)" in sql


def test_statement_import_claim_migration_recovers_split_lineage_and_downgrades():
    migration = _load_import_claim_migration_module()
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    accounts = sa.Table(
        "accounts", metadata, sa.Column("id", sa.Integer, primary_key=True)
    )
    transactions = sa.Table(
        "transactions",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("account_id", sa.Integer, nullable=False),
        sa.Column("description", sa.String, nullable=False),
        sa.Column("amount", sa.Float, nullable=False),
        sa.Column("date", sa.DateTime, nullable=False),
        sa.Column("import_batch_id", sa.String),
        sa.Column("import_fingerprint", sa.String),
        sa.Column("import_occurrence", sa.Integer),
    )
    batches = sa.Table(
        "statement_import_batches",
        metadata,
        sa.Column("import_batch_id", sa.String, primary_key=True),
        sa.Column("account_id", sa.Integer, nullable=False),
        sa.Column("idempotency_key", sa.String, nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("inserted_count", sa.Integer, nullable=False),
        sa.Column("skipped_count", sa.Integer, nullable=False),
        sa.Column("result_json", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime),
    )
    metadata.create_all(engine)
    grocery_fingerprint = transaction_fingerprint(
        1, "2026-08-10", "Grocery", -100
    )
    legacy_fingerprint = transaction_fingerprint(
        1, "2026-08-11", "Coffee Shop", -4.5
    )

    with engine.begin() as connection:
        connection.execute(accounts.insert(), {"id": 1})
        connection.execute(
            batches.insert(),
            {
                "import_batch_id": "split-batch",
                "account_id": 1,
                "idempotency_key": "split-key",
                "payload_hash": "a" * 64,
                "inserted_count": 1,
                "skipped_count": 0,
                "result_json": (
                    '{"transactions":[{"import_fingerprint":"'
                    + grocery_fingerprint
                    + '","import_occurrence":1}]}'
                ),
                "created_at": datetime(2026, 8, 10, 12),
            },
        )
        connection.execute(
            transactions.insert(),
            [
                {
                    "id": 1,
                    "account_id": 1,
                    "description": "Food",
                    "amount": -60,
                    "date": datetime(2026, 8, 10, 12),
                    "import_batch_id": "split-batch",
                    "import_fingerprint": None,
                    "import_occurrence": None,
                },
                {
                    "id": 2,
                    "account_id": 1,
                    "description": "House",
                    "amount": -40,
                    "date": datetime(2026, 8, 10, 12),
                    "import_batch_id": "split-batch",
                    "import_fingerprint": None,
                    "import_occurrence": None,
                },
                {
                    "id": 3,
                    "account_id": 1,
                    "description": "Coffee Shop",
                    "amount": -4.5,
                    "date": datetime(2026, 8, 11, 12),
                    "import_batch_id": "legacy-batch",
                    "import_fingerprint": legacy_fingerprint,
                    "import_occurrence": 1,
                },
                {
                    "id": 4,
                    "account_id": 1,
                    "description": "Manual transaction",
                    "amount": -20,
                    "date": datetime(2026, 8, 12, 12),
                    "import_batch_id": None,
                    "import_fingerprint": None,
                    "import_occurrence": None,
                },
            ],
        )

        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        claims = connection.execute(
            sa.text(
                "SELECT account_id, fingerprint, occurrence, import_batch_id "
                "FROM statement_import_claims ORDER BY import_batch_id"
            )
        ).mappings().all()

        assert claims == [
            {
                "account_id": 1,
                "fingerprint": legacy_fingerprint,
                "occurrence": 1,
                "import_batch_id": "legacy-batch",
            },
            {
                "account_id": 1,
                "fingerprint": grocery_fingerprint,
                "occurrence": 1,
                "import_batch_id": "split-batch",
            },
        ]

        migration.downgrade()
        assert "statement_import_claims" not in sa.inspect(connection).get_table_names()


def test_statement_import_claim_postgresql_ddl_is_the_alembic_head(monkeypatch):
    migration = _load_import_claim_migration_module()
    output = StringIO()
    migration_context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    migration.op = Operations(migration_context)
    monkeypatch.setattr(migration, "_backfill_claims", lambda connection: None)

    migration.upgrade()

    sql = output.getvalue()
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    head = script.get_revision(script.get_current_head())
    assert head.revision == IMPORT_CLAIM_REVISION
    assert head.down_revision == IMPORT_BATCH_REVISION
    assert "CREATE TABLE statement_import_claims" in sql
    assert "UNIQUE (account_id, fingerprint, occurrence)" in sql
    assert "CREATE INDEX ix_statement_import_claims_import_batch_id" in sql


def test_model_indexes_match_query_patterns():
    for table_name, expected_indexes in EXPECTED_INDEXES.items():
        table = Base.metadata.tables[table_name]
        actual = {
            index.name: tuple(column.name for column in index.columns)
            for index in table.indexes
        }
        for index_name, columns in expected_indexes.items():
            assert actual[index_name] == columns


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


def test_import_backfill_writes_in_bounded_batches(monkeypatch):
    migration = _load_migration_module()
    monkeypatch.setattr(migration, "BACKFILL_BATCH_SIZE", 2, raising=False)
    engine = sa.create_engine("sqlite://")
    metadata = _legacy_metadata()
    metadata.create_all(engine)
    update_batch_sizes = []

    @sa.event.listens_for(engine, "before_cursor_execute")
    def record_update_batch(
        connection, cursor, statement, parameters, context, executemany
    ):
        if statement.lstrip().upper().startswith("UPDATE TRANSACTIONS SET"):
            update_batch_sizes.append(len(parameters) if executemany else 1)

    with engine.begin() as connection:
        connection.execute(
            metadata.tables["transactions"].insert(),
            [
                {
                    "id": transaction_id,
                    "account_id": 1,
                    "description": "Repeated import",
                    "amount": -5.0,
                    "date": datetime(2026, 8, 1),
                    "import_batch_id": "batch-old",
                }
                for transaction_id in range(1, 6)
            ],
        )
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        occurrences = connection.scalars(
            sa.text("SELECT import_occurrence FROM transactions ORDER BY id")
        ).all()

    assert update_batch_sizes == [2, 2, 1]
    assert occurrences == [1, 2, 3, 4, 5]


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


def test_postgresql_upgrade_ddl_compiles_from_the_previous_head(monkeypatch):
    migration = _load_migration_module()
    output = StringIO()
    migration_context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"as_sql": True, "output_buffer": output},
    )
    migration.op = Operations(migration_context)
    monkeypatch.setattr(migration, "_backfill_import_identity", lambda connection: None)
    monkeypatch.setattr(migration, "_ensure_categories_table", lambda connection: None)
    monkeypatch.setattr(migration, "_seed_reference_data", lambda connection: None)

    migration.upgrade()

    sql = output.getvalue()
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    task_2_revision = script.get_revision("9a7c2d4e6f80")
    assert task_2_revision.revision == "9a7c2d4e6f80"
    assert task_2_revision.down_revision == "6c4e8a21f9d0"
    assert "ALTER TABLE transactions ADD COLUMN import_fingerprint VARCHAR" in sql
    assert "ALTER TABLE transactions ADD COLUMN import_occurrence INTEGER" in sql
    assert "ALTER TABLE transactions ADD COLUMN import_idempotency_key VARCHAR" in sql
    assert "CREATE UNIQUE INDEX uq_transactions_import_identity" in sql
    assert "WHERE import_fingerprint IS NOT NULL AND import_occurrence IS NOT NULL" in sql
    for expected_indexes in EXPECTED_INDEXES.values():
        for index_name in expected_indexes:
            assert f"CREATE INDEX {index_name}" in sql


def test_postgresql_upgrade_against_isolated_schema_when_configured():
    database_url = os.getenv("FINDU_TEST_POSTGRES_URL")
    if not database_url:
        pytest.skip("FINDU_TEST_POSTGRES_URL is not configured")

    migration = _load_migration_module()
    engine = sa.create_engine(database_url)
    schema_name = f"findu_task2_{uuid4().hex}"
    metadata = _legacy_metadata(include_categories=False)

    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema_name}"')
            connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema_name}"')
            metadata.create_all(connection)
            connection.execute(
                metadata.tables["transactions"].insert(),
                {
                    "id": 1,
                    "account_id": 1,
                    "description": "PostgreSQL import",
                    "amount": -5.0,
                    "date": datetime(2026, 8, 1),
                    "import_batch_id": "batch-postgres",
                },
            )
            migration.op = Operations(MigrationContext.configure(connection))

            migration.upgrade()

            inspector = sa.inspect(connection)
            assert "categories" in inspector.get_table_names()
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM categories")) == len(
                DEFAULT_CATEGORY_NAMES
            )
            assert {
                column["name"] for column in inspector.get_columns("transactions")
            } >= {"import_fingerprint", "import_occurrence", "import_idempotency_key"}
            assert connection.scalar(
                sa.text("SELECT import_occurrence FROM transactions WHERE id = 1")
            ) == 1
        finally:
            transaction.rollback()


def test_clean_import_and_startup_perform_no_database_mutation(tmp_path):
    database_path = tmp_path / "import-startup.db"
    script = """
import os
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

import sqlalchemy
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from sqlalchemy.sql.schema import MetaData

def forbidden(name):
    def fail(*args, **kwargs):
        raise AssertionError(f"forbidden database mutation during import/startup: {name}")
    return fail

MetaData.create_all = forbidden("create_all")
sqlalchemy.inspect = forbidden("inspect")
Engine.begin = forbidden("engine.begin/ALTER TABLE")
Session.query = forbidden("per-category seed query")

from app.main import app
from fastapi.testclient import TestClient

with TestClient(app):
    pass
"""
    environment = os.environ.copy()
    environment["TEST_DATABASE_URL"] = f"sqlite:///{database_path}"

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_alembic_upgrade_head_bootstraps_an_empty_sqlite_database(tmp_path, monkeypatch):
    database_path = tmp_path / "migration.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")

    command.upgrade(Config("alembic.ini"), "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) >= {
        "accounts",
        "transactions",
        "statement_import_batches",
        "statement_import_claims",
        "categories",
        "category_budget_items",
        "alembic_version",
    }
    assert {
        column["name"] for column in inspector.get_columns("transactions")
    } >= {"import_fingerprint", "import_occurrence", "import_idempotency_key"}
    with engine.connect() as connection:
        assert connection.scalar(sa.text("SELECT version_num FROM alembic_version")) == (
            IMPORT_CLAIM_REVISION
        )
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM categories")) == len(
            DEFAULT_CATEGORY_NAMES
        )
