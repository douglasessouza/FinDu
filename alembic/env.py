import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, inspect, pool
from alembic import context
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from dotenv import load_dotenv

load_dotenv()

config = context.config
config.set_main_option("sqlalchemy.url", os.getenv("DATABASE_URL"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

from app.models import Base
target_metadata = Base.metadata

TASK_2_REVISION = "9a7c2d4e6f80"
TASK_3_REVISION = "d4e5f6a7b8c9"
TASK_2_BASELINE_REVISION = "6c4e8a21f9d0"

def prepare_empty_sqlite_baseline(connection) -> None:
    """Build the prior head used by an empty SQLite migration smoke database.

    Historical revisions contain PostgreSQL-only DDL. Production PostgreSQL always
    executes the complete revision chain. For SQLite, create current metadata, apply
    this revision's real downgrade to reach its previous head, then let Alembic run
    the real upgrade (including seed and backfill behavior).
    """
    if connection.dialect.name != "sqlite" or inspect(connection).get_table_names():
        return

    Base.metadata.create_all(connection)
    migration_context = MigrationContext.configure(connection)
    script_directory = ScriptDirectory.from_config(config)
    for revision in (TASK_3_REVISION, TASK_2_REVISION):
        migration = script_directory.get_revision(revision).module
        migration_op_proxy = migration.op
        try:
            migration.op = Operations(migration_context)
            migration.downgrade()
        finally:
            migration.op = migration_op_proxy
    migration_context.stamp(script_directory, TASK_2_BASELINE_REVISION)

def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        prepare_empty_sqlite_baseline(connection)
        if connection.in_transaction():
            connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
