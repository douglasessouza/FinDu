from datetime import datetime

from sqlalchemy import event

from app.models import (
    Account,
    AccountTypeEnum,
    CurrencyEnum,
    MonthlyPayment,
    RecurringExpense,
    RecurringMatch,
    RecurringMonthlyOverride,
    RecurringTypeEnum,
    Transaction,
)


def add_account(db_session, name, account_type, *, currency=CurrencyEnum.CAD):
    account = Account(
        name=name,
        bank="Test Bank",
        account_type=account_type,
        currency=currency,
        balance=1000,
        closing_day=20 if account_type == AccountTypeEnum.CREDIT_CARD else None,
        due_day=10 if account_type == AccountTypeEnum.CREDIT_CARD else None,
    )
    db_session.add(account)
    db_session.flush()
    return account


def add_transaction(
    db_session,
    account,
    date,
    amount,
    category,
    description,
    *,
    currency=None,
    statement_month=None,
    payment_due_date=None,
):
    transaction = Transaction(
        account_id=account.id,
        description=description,
        amount=amount,
        currency=currency or account.currency,
        date=datetime.fromisoformat(date),
        category=category,
        statement_month=statement_month,
        payment_due_date=(
            datetime.fromisoformat(payment_due_date) if payment_due_date else None
        ),
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def seed_reporting_data(db_session):
    checking = add_account(db_session, "Chequing", AccountTypeEnum.CHECKING)
    card = add_account(db_session, "Visa", AccountTypeEnum.CREDIT_CARD)

    rows = [
        add_transaction(
            db_session,
            checking,
            "2026-01-03T09:00:00",
            -30,
            "Groceries",
            "Market",
        ),
        add_transaction(
            db_session,
            checking,
            "2026-01-14T09:00:00",
            -20,
            "Transfer",
            "Move money",
        ),
        add_transaction(
            db_session,
            checking,
            "2026-01-31T18:00:00",
            3000,
            "Salary",
            "Payroll",
        ),
        add_transaction(
            db_session,
            checking,
            "2026-02-02T12:00:00",
            -12,
            "Dining",
            "Lunch",
        ),
        add_transaction(
            db_session,
            card,
            "2025-12-22T10:00:00",
            -100,
            "Dining",
            "December dinner",
            statement_month="2026-01",
            payment_due_date="2026-02-10T00:00:00",
        ),
        add_transaction(
            db_session,
            card,
            "2026-01-09T10:00:00",
            -25,
            "Other Income",
            "Excluded card row",
            statement_month="2026-01",
            payment_due_date="2026-02-10T00:00:00",
        ),
        add_transaction(
            db_session,
            card,
            "2026-01-10T10:00:00",
            10,
            "Refund",
            "Merchant refund",
            statement_month="2026-01",
            payment_due_date="2026-02-10T00:00:00",
        ),
        add_transaction(
            db_session,
            card,
            "2026-01-11T10:00:00",
            40,
            "Transfer",
            "Card payment",
            statement_month="2026-01",
            payment_due_date="2026-02-10T00:00:00",
        ),
        add_transaction(
            db_session,
            card,
            "2026-02-22T10:00:00",
            -50,
            "Groceries",
            "Later cycle",
            statement_month="2026-03",
            payment_due_date="2026-04-10T00:00:00",
        ),
    ]
    db_session.commit()
    return checking, card, rows


def test_legacy_unfiltered_reporting_shapes_are_unchanged(client, db_session):
    _, _, rows = seed_reporting_data(db_session)

    transactions = client.get("/transactions")
    spending = client.get("/spending-analysis")

    assert transactions.status_code == 200
    assert isinstance(transactions.json(), list)
    assert {row["id"] for row in transactions.json()} == {row.id for row in rows}
    assert isinstance(spending.json(), dict)
    assert spending.json() == {
        "2026-01": {
            "Dining": {"cards": 100.0, "debit": 0.0},
            "Groceries": {"cards": 0.0, "debit": 30.0},
        },
        "2026-02": {"Dining": {"cards": 0.0, "debit": 12.0}},
        "2026-03": {"Groceries": {"cards": 50.0, "debit": 0.0}},
    }


def test_legacy_spending_rounds_each_transaction_before_summing(client, db_session):
    checking = add_account(db_session, "Chequing", AccountTypeEnum.CHECKING)
    for index in range(2):
        add_transaction(
            db_session,
            checking,
            f"2026-01-0{index + 1}T08:00:00",
            -0.004,
            "Tiny",
            f"Tiny {index}",
        )
    db_session.commit()

    assert client.get("/spending-analysis").json() == {
        "2026-01": {
            "Tiny": {"cards": 0.0, "debit": 0.0}
        }
    }


def test_legacy_spending_mixed_currency_keeps_exact_old_shape(client, db_session):
    checking_cad = add_account(db_session, "CAD", AccountTypeEnum.CHECKING)
    checking_usd = add_account(
        db_session, "USD", AccountTypeEnum.CHECKING, currency=CurrencyEnum.USD
    )
    add_transaction(
        db_session,
        checking_cad,
        "2026-01-03T09:00:00",
        -30,
        "Groceries",
        "CAD market",
    )
    add_transaction(
        db_session,
        checking_usd,
        "2026-01-04T09:00:00",
        -20,
        "Groceries",
        "USD market",
    )
    db_session.commit()

    response = client.get("/spending-analysis")

    assert response.status_code == 200
    assert response.json() == {
        "2026-01": {"Groceries": {"cards": 0.0, "debit": 50.0}}
    }


def test_spending_never_combines_incompatible_currencies(client, db_session):
    checking_cad = add_account(db_session, "CAD", AccountTypeEnum.CHECKING)
    checking_usd = add_account(
        db_session, "USD", AccountTypeEnum.CHECKING, currency=CurrencyEnum.USD
    )
    add_transaction(
        db_session,
        checking_cad,
        "2026-01-03T09:00:00",
        -30,
        "Groceries",
        "CAD market",
    )
    add_transaction(
        db_session,
        checking_usd,
        "2026-01-04T09:00:00",
        -20,
        "Groceries",
        "USD market",
    )
    db_session.commit()

    groceries = client.get(
        "/spending-analysis",
        params={"month_from": "2026-01", "month_to": "2026-01"},
    ).json()["2026-01"]["Groceries"]
    assert groceries == {
        "cards": None,
        "debit": None,
        "currency": None,
        "by_currency": {
            "CAD": {"cards": 0.0, "debit": 30.0},
            "USD": {"cards": 0.0, "debit": 20.0},
        },
    }


def test_legacy_account_id_zero_remains_unfiltered(client, db_session):
    checking = add_account(db_session, "Chequing", AccountTypeEnum.CHECKING)
    rows = [
        add_transaction(
            db_session,
            checking,
            f"2026-01-0{index + 1}T08:00:00",
            -(index + 1),
            "Other",
            f"Row {index}",
        )
        for index in range(2)
    ]
    db_session.commit()

    response = client.get("/transactions", params={"account_id": 0})

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [row.id for row in rows]


def test_transaction_filters_and_cursor_are_bounded_stable_and_complete(
    client, db_session
):
    checking = add_account(db_session, "Chequing", AccountTypeEnum.CHECKING)
    older = add_transaction(
        db_session,
        checking,
        "2026-01-30T08:00:00",
        -8,
        "Groceries",
        "Older",
    )
    same_day = [
        add_transaction(
            db_session,
            checking,
            "2026-01-31T08:00:00",
            -amount,
            "Groceries",
            f"Same day {amount}",
        )
        for amount in (1, 2, 3, 4, 5)
    ]
    add_transaction(
        db_session,
        checking,
        "2026-02-01T08:00:00",
        -99,
        "Dining",
        "Outside filters",
    )
    db_session.commit()

    seen = []
    cursor = None
    while True:
        params = {"month": "2026-01", "category": "Groceries", "limit": 2}
        if cursor:
            params["cursor"] = cursor
        response = client.get("/transactions", params=params)
        assert response.status_code == 200
        body = response.json()
        assert isinstance(body, dict)
        assert set(body) == {"items", "next_cursor"}
        assert len(body["items"]) <= 2
        seen.extend(row["id"] for row in body["items"])
        cursor = body["next_cursor"]
        if cursor is None:
            break

    expected = [row.id for row in reversed(same_day)] + [older.id]
    assert seen == expected
    assert len(seen) == len(set(seen))

    bounded = client.get(
        "/transactions",
        params={"date_from": "2026-01-31", "date_to": "2026-01-31", "limit": 3},
    ).json()
    assert [row["id"] for row in bounded["items"]] == expected[:3]


def test_card_cycle_and_bounded_spending_aggregates_preserve_financial_rules(
    client, db_session
):
    _, card, _ = seed_reporting_data(db_session)

    card_response = client.get(
        "/card-statements/summary", params={"month": "2026-01"}
    )
    spending_response = client.get(
        "/spending-analysis",
        params={"month_from": "2026-01", "month_to": "2026-01"},
    )

    assert card_response.status_code == 200
    assert card_response.json() == {
        "month": "2026-01",
        "cards": [
            {
                "account_id": card.id,
                "account_name": "Visa",
                "currency": "CAD",
                "charges": 125.0,
                "credits": 10.0,
                "payments": 40.0,
                "amount_due": 115.0,
                "count": 2,
                "payment_due_date": "2026-02-10T00:00:00",
            }
        ],
        "total_charges": 125.0,
        "total_credits": 10.0,
        "total_payments": 40.0,
        "total_amount_due": 115.0,
        "currency": "CAD",
        "totals_by_currency": {
            "CAD": {
                "charges": 125.0,
                "credits": 10.0,
                "payments": 40.0,
                "amount_due": 115.0,
            }
        },
    }
    assert spending_response.status_code == 200
    assert spending_response.json() == {
        "2026-01": {
            "Dining": {
                "cards": 100.0,
                "debit": 0.0,
                "currency": "CAD",
                "by_currency": {"CAD": {"cards": 100.0, "debit": 0.0}},
            },
            "Groceries": {
                "cards": 0.0,
                "debit": 30.0,
                "currency": "CAD",
                "by_currency": {"CAD": {"cards": 0.0, "debit": 30.0}},
            },
        }
    }


def test_card_summary_uses_transaction_currency_and_currency_safe_totals(
    client, db_session
):
    cad_card = add_account(db_session, "CAD Card", AccountTypeEnum.CREDIT_CARD)
    usd_card = add_account(
        db_session, "USD Card", AccountTypeEnum.CREDIT_CARD, currency=CurrencyEnum.USD
    )
    add_transaction(
        db_session,
        cad_card,
        "2026-01-02T09:00:00",
        -10,
        "Dining",
        "CAD charge",
        statement_month="2026-01",
    )
    add_transaction(
        db_session,
        usd_card,
        "2026-01-03T09:00:00",
        -20,
        "Dining",
        "USD charge",
        statement_month="2026-01",
    )
    add_transaction(
        db_session,
        cad_card,
        "2026-01-04T09:00:00",
        -5,
        "Dining",
        "USD charge on CAD account",
        currency=CurrencyEnum.USD,
        statement_month="2026-01",
    )
    db_session.commit()

    body = client.get(
        "/card-statements/summary", params={"month": "2026-01"}
    ).json()

    assert [(row["account_name"], row["currency"], row["charges"]) for row in body["cards"]] == [
        ("CAD Card", "CAD", 10.0),
        ("CAD Card", "USD", 5.0),
        ("USD Card", "USD", 20.0),
    ]
    assert body["currency"] is None
    assert body["total_charges"] is None
    assert body["total_credits"] is None
    assert body["total_payments"] is None
    assert body["total_amount_due"] is None
    assert body["totals_by_currency"] == {
        "CAD": {
            "charges": 10.0,
            "credits": 0.0,
            "payments": 0.0,
            "amount_due": 10.0,
        },
        "USD": {
            "charges": 25.0,
            "credits": 0.0,
            "payments": 0.0,
            "amount_due": 25.0,
        },
    }

    dashboard = client.get(
        "/dashboard/monthly", params={"month": "2026-01"}
    ).json()
    assert dashboard["card_summaries"] == body
    assert dashboard["card_summaries"]["total_amount_due"] is None
    assert dashboard["card_summaries"]["totals_by_currency"] == body[
        "totals_by_currency"
    ]


def test_monthly_dashboard_consolidates_legacy_collections(client, db_session):
    checking, _, rows = seed_reporting_data(db_session)
    recurring = RecurringExpense(
        name="Rent",
        amount=1500,
        currency=CurrencyEnum.CAD,
        due_day=1,
        type=RecurringTypeEnum.EXPENSE,
        category="Housing",
        is_active=True,
        start_month="2025-01",
    )
    db_session.add(recurring)
    db_session.flush()
    override = RecurringMonthlyOverride(
        recurring_id=recurring.id, month="2026-01", amount=1550
    )
    payment = MonthlyPayment(
        month="2026-01",
        item_type="recurring",
        item_id=recurring.id,
        item_name=recurring.name,
    )
    match = RecurringMatch(
        month="2026-01",
        recurring_id=recurring.id,
        transaction_id=rows[0].id,
        planned_amount=1500,
        actual_amount=30,
        variance=-1470,
        confidence="Medium",
        score=55,
        source="auto",
    )
    db_session.add_all([override, payment, match])
    db_session.commit()

    response = client.get("/dashboard/monthly", params={"month": "2026-01"})

    assert response.status_code == 200
    body = response.json()
    assert body["month"] == "2026-01"
    assert body["accounts"] == client.get("/accounts").json()
    assert body["recurring"] == client.get("/recurring-expenses").json()
    assert body["payments"] == client.get(
        "/monthly-payments", params={"month": "2026-01"}
    ).json()
    assert body["matches"] == client.get(
        "/recurring-matches", params={"month": "2026-01"}
    ).json()
    assert body["overrides"] == client.get(
        "/recurring-monthly-overrides", params={"month": "2026-01"}
    ).json()
    assert body["card_summaries"] == client.get(
        "/card-statements/summary", params={"month": "2026-01"}
    ).json()
    assert {row["id"] for row in body["checking_transactions"]} == {
        row.id
        for row in rows
        if row.account_id == checking.id and row.date.strftime("%Y-%m") == "2026-01"
    }


def test_monthly_dashboard_query_count_is_independent_of_account_count(
    client, db_session
):
    seed_reporting_data(db_session)

    def dashboard_query_count():
        statements = []

        def record_query(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(db_session.bind, "before_cursor_execute", record_query)
        try:
            response = client.get(
                "/dashboard/monthly", params={"month": "2026-01"}
            )
            assert response.status_code == 200
        finally:
            event.remove(db_session.bind, "before_cursor_execute", record_query)
        return len(statements)

    baseline = dashboard_query_count()
    for index in range(5):
        account = add_account(
            db_session, f"Extra {index}", AccountTypeEnum.CHECKING
        )
        add_transaction(
            db_session,
            account,
            "2026-01-15T08:00:00",
            -(index + 1),
            "Other",
            f"Extra row {index}",
        )
    db_session.commit()

    assert dashboard_query_count() == baseline
    assert baseline <= 7
