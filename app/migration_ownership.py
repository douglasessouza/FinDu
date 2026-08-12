import sqlalchemy as sa


ADOPTION_TABLE = "findu_migration_adoptions"


def _adoptions() -> sa.Table:
    metadata = sa.MetaData()
    return sa.Table(
        ADOPTION_TABLE,
        metadata,
        sa.Column("revision", sa.String(length=32), nullable=False),
        sa.Column("object_type", sa.String(length=16), nullable=False),
        sa.Column("object_name", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("revision", "object_type", "object_name"),
    )


def record_adoption(
    connection: sa.Connection,
    revision: str,
    object_type: str,
    object_name: str,
) -> None:
    adoptions = _adoptions()
    adoptions.create(connection, checkfirst=True)
    existing = connection.scalar(
        sa.select(sa.literal(1)).where(
            adoptions.c.revision == revision,
            adoptions.c.object_type == object_type,
            adoptions.c.object_name == object_name,
        )
    )
    if existing is None:
        connection.execute(
            adoptions.insert(),
            {
                "revision": revision,
                "object_type": object_type,
                "object_name": object_name,
            },
        )


def consume_adoption(
    connection: sa.Connection,
    revision: str,
    object_type: str,
    object_name: str,
) -> bool:
    if not sa.inspect(connection).has_table(ADOPTION_TABLE):
        return False
    adoptions = _adoptions()
    result = connection.execute(
        adoptions.delete().where(
            adoptions.c.revision == revision,
            adoptions.c.object_type == object_type,
            adoptions.c.object_name == object_name,
        )
    )
    return bool(result.rowcount)


def drop_adoption_table_if_empty(connection: sa.Connection) -> None:
    if not sa.inspect(connection).has_table(ADOPTION_TABLE):
        return
    adoptions = _adoptions()
    if connection.scalar(sa.select(sa.func.count()).select_from(adoptions)) == 0:
        adoptions.drop(connection)
