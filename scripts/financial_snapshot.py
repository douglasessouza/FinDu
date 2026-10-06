"""Print a read-only financial row and amount snapshot for migration verification."""
import json
import os

from sqlalchemy import create_engine, text


TABLES = {
    "recurring_expenses": "amount",
    "category_budgets": "amount",
    "category_budget_items": "amount",
    "transactions": "amount",
    "monthly_payments": None,
    "recurring_matches": "actual_amount",
}


def main() -> None:
    engine = create_engine(os.environ["DATABASE_URL"])
    snapshot = {}
    with engine.connect() as connection:
        for table, amount_column in TABLES.items():
            row = connection.execute(text(
                f"SELECT COUNT(*) AS row_count, "
                f"{f'COALESCE(SUM({amount_column}), 0)' if amount_column else '0'} AS amount_total "
                f"FROM {table}"
            )).one()
            snapshot[table] = {"rows": row.row_count, "amount_total": str(row.amount_total)}
    print(json.dumps(snapshot, sort_keys=True))


if __name__ == "__main__":
    main()
