from datetime import datetime

from app.main import apply_card_statement_fields
from app.models import Account, AccountTypeEnum, CurrencyEnum


def rbc_card() -> Account:
    return Account(
        name="Doug's RBC",
        bank="RBC",
        account_type=AccountTypeEnum.CREDIT_CARD,
        currency=CurrencyEnum.CAD,
        closing_day=26,
        due_day=16,
    )


def test_purchase_after_closing_is_paid_two_calendar_months_later():
    data = {}

    apply_card_statement_fields(data, rbc_card(), datetime(2026, 7, 31))

    assert data["statement_month"] == "2026-08"
    assert data["payment_due_date"] == datetime(2026, 9, 16)


def test_purchase_on_closing_day_stays_in_current_statement():
    data = {}

    apply_card_statement_fields(data, rbc_card(), datetime(2026, 7, 26))

    assert data["statement_month"] == "2026-07"
    assert data["payment_due_date"] == datetime(2026, 8, 16)


def test_bmo_costco_purchase_has_august_budget_and_september_cash_flow():
    card = Account(
        name="Doug's BMO",
        bank="BMO",
        account_type=AccountTypeEnum.CREDIT_CARD,
        currency=CurrencyEnum.CAD,
        closing_day=11,
        due_day=4,
    )
    data = {}

    apply_card_statement_fields(data, card, datetime(2026, 7, 28))

    # How FinDu Works contract: the closing cycle owns the budget month,
    # while the payment due date owns the Monthly Cash Flow month.
    assert data["statement_month"] == "2026-08"
    assert data["payment_due_date"] == datetime(2026, 9, 4)
