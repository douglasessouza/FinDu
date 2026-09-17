from datetime import datetime

from sqlalchemy import text

from app.models import (
    Account, AccountTypeEnum, CurrencyEnum, MonthlyPayment, RecurringExpense,
    RecurringMatch, RecurringMonthlyOverride, Transaction,
)


def test_delete_recurring_cleans_dependencies_but_preserves_transactions(client, db_session):
    db_session.execute(text("PRAGMA foreign_keys=ON"))
    try:
        account = Account(name="Bank", bank="RBC", account_type=AccountTypeEnum.CHECKING,
                          currency=CurrencyEnum.CAD)
        expense = RecurringExpense(name="Dizimo", amount=200, currency=CurrencyEnum.CAD, due_day=15)
        other = RecurringExpense(name="Rent", amount=2600, currency=CurrencyEnum.CAD, due_day=1)
        db_session.add_all([account, expense, other])
        db_session.flush()
        transaction = Transaction(account_id=account.id, description="Dizimo", amount=-200,
                                  currency=CurrencyEnum.CAD, date=datetime(2026, 9, 15))
        db_session.add(transaction)
        db_session.flush()
        expense_id, transaction_id = expense.id, transaction.id
        db_session.add_all([
            RecurringMatch(month="2026-09", recurring_id=expense.id, transaction_id=transaction.id,
                           planned_amount=200, actual_amount=200, variance=0, confidence="High", score=100),
            RecurringMonthlyOverride(recurring_id=expense.id, month="2026-09", amount=200),
            MonthlyPayment(month="2026-09", item_type="recurring", item_id=expense.id, item_name="Dizimo"),
            MonthlyPayment(month="2026-09", item_type="card", item_id=expense.id, item_name="Card"),
            MonthlyPayment(month="2026-09", item_type="recurring", item_id=other.id, item_name="Rent"),
        ])
        db_session.commit()

        response = client.delete(f"/recurring-expenses/{expense_id}")

        assert response.status_code == 200
        assert db_session.get(RecurringExpense, expense_id) is None
        assert db_session.get(Transaction, transaction_id) is not None
        assert db_session.get(RecurringExpense, other.id) is not None
        assert db_session.query(RecurringMatch).count() == 0
        assert db_session.query(RecurringMonthlyOverride).count() == 0
        assert {p.item_name for p in db_session.query(MonthlyPayment).all()} == {"Card", "Rent"}
        assert client.delete(f"/recurring-expenses/{expense_id}").status_code == 404
    finally:
        db_session.rollback()
        db_session.execute(text("PRAGMA foreign_keys=OFF"))
        db_session.commit()
