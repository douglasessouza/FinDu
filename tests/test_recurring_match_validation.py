from datetime import datetime

from app.models import Account, AccountTypeEnum, CurrencyEnum, RecurringExpense, RecurringTypeEnum, Transaction


def test_card_match_uses_transaction_amount_and_cannot_be_reused(client, db_session):
    card = Account(name="Visa", bank="Test", account_type=AccountTypeEnum.CREDIT_CARD,
                   currency=CurrencyEnum.CAD, balance=0, closing_day=20, due_day=10)
    bank = Account(name="Bank", bank="Test", account_type=AccountTypeEnum.CHECKING,
                   currency=CurrencyEnum.CAD, balance=0)
    db_session.add_all([card, bank])
    db_session.flush()
    insurance = RecurringExpense(name="Insurance", amount=418, currency=CurrencyEnum.CAD,
        due_day=12, type=RecurringTypeEnum.EXPENSE, payment_method="CREDIT_CARD", payment_account_id=card.id)
    other = RecurringExpense(name="Other", amount=418, currency=CurrencyEnum.CAD,
        due_day=12, type=RecurringTypeEnum.EXPENSE, payment_method="CREDIT_CARD", payment_account_id=card.id)
    db_session.add_all([insurance, other])
    db_session.flush()
    charge = Transaction(account_id=card.id, description="Insurance", amount=-420,
        currency=CurrencyEnum.CAD, date=datetime(2026, 11, 12), category="Insurance")
    wrong = Transaction(account_id=bank.id, description="Insurance", amount=-420,
        currency=CurrencyEnum.CAD, date=datetime(2026, 11, 12), category="Insurance")
    db_session.add_all([charge, wrong])
    db_session.commit()
    payload = dict(month="2026-11", recurring_id=insurance.id, transaction_id=wrong.id,
        planned_amount=418, actual_amount=1, variance=0, confidence="High", score=100)
    assert client.post("/recurring-matches", json=payload).status_code == 400
    saved = client.post("/recurring-matches", json={**payload, "transaction_id": charge.id})
    assert saved.status_code == 200
    assert saved.json()["actual_amount"] == 420
    assert client.post("/recurring-matches", json={**payload, "recurring_id": other.id,
        "transaction_id": charge.id}).status_code == 400
