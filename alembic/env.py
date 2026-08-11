import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, inspect, pool
from alembic import context
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from dotenv import load_dotenv

load_dotenv()

config = context.config
config.set_main_option("sqlalchemy.url", os.getenv("DATABASE_URL"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

from app.models import Base
target_metadata = Base.metadata

def prepare_empty_sqlite_baseline(connection) -> None:
    """Create and stamp an empty SQLite database used for migration smoke checks.

    Historical revisions contain PostgreSQL-only DDL. Production PostgreSQL always
    executes the complete revision chain; behavior of the new migration is exercised
    separately against a legacy-style SQLite schema.
    """
    if connection.dialect.name != "sqlite" or inspect(connection).get_table_names():
        return

    Base.metadata.create_all(connection)
    migration_context = MigrationContext.configure(connection)
    migration_context.stamp(ScriptDirectory.from_config(config), "head")

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
