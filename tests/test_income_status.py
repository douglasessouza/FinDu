from app.models import RecurringExpense, RecurringTypeEnum, CurrencyEnum


def test_income_status_replaces_receipt_and_is_scoped_to_occurrence(client, db_session):
    income = RecurringExpense(name="Salary", amount=3000, due_day=28,
                              type=RecurringTypeEnum.INCOME, currency=CurrencyEnum.CAD)
    db_session.add(income)
    db_session.commit()
    payload = dict(month="2026-09", item_type="income", item_id=income.id, item_name=income.name)
    assert client.post("/monthly-payments", json=payload).status_code == 200
    cancelled = client.post("/monthly-payments", json={**payload, "item_type": "income_cancelled"})
    assert cancelled.status_code == 200
    rows = client.get("/monthly-payments", params={"month": "2026-09"}).json()
    assert [row["item_type"] for row in rows] == ["income_cancelled"]
    assert client.get("/monthly-payments", params={"month": "2026-10"}).json() == []
    dashboard = client.get("/dashboard/monthly", params={"month": "2026-10"})
    assert dashboard.status_code == 200
    assert dashboard.json()["previous_month_payments"] == rows
    assert client.delete(f'/monthly-payments/{cancelled.json()["id"]}').status_code == 200
    assert client.get("/monthly-payments", params={"month": "2026-09"}).json() == []
