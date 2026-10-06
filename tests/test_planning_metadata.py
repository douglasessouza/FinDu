from app.models import Account, AccountTypeEnum, CurrencyEnum


def add_account(db, kind, currency=CurrencyEnum.CAD):
    account = Account(name=f"{kind.value} {currency.value}", bank="Test", account_type=kind,
                      currency=currency, balance=0, closing_day=20 if kind == AccountTypeEnum.CREDIT_CARD else None,
                      due_day=10 if kind == AccountTypeEnum.CREDIT_CARD else None)
    db.add(account)
    db.commit()
    return account


def test_recurring_route_requires_correct_account_and_preserves_legacy_rows(client, db_session):
    card = add_account(db_session, AccountTypeEnum.CREDIT_CARD)
    bank = add_account(db_session, AccountTypeEnum.CHECKING)
    payload = dict(name="Car insurance", amount=418, currency="CAD", due_day=12,
                   category="Insurance", type="EXPENSE", start_month="2026-11")
    legacy = client.post("/recurring-expenses", json=payload)
    assert legacy.status_code == 200
    assert legacy.json()["payment_method"] == "UNSET"
    assert legacy.json()["planning_kind"] == "FIXED"

    invalid = client.post("/recurring-expenses", json={**payload, "payment_method": "CREDIT_CARD", "payment_account_id": bank.id})
    assert invalid.status_code == 400
    saved = client.patch(f"/recurring-expenses/{legacy.json()['id']}",
                         json={"payment_method": "CREDIT_CARD", "payment_account_id": card.id})
    assert saved.status_code == 200
    assert saved.json()["payment_account_id"] == card.id
    assert client.get("/recurring-expenses").json()[0]["amount"] == 418


def test_budget_coverage_does_not_change_budget_amount(client, db_session):
    recurring = client.post("/recurring-expenses", json={"name": "Rent", "amount": 2600,
        "currency": "CAD", "due_day": 1, "type": "EXPENSE", "category": "Rent"}).json()
    budget = client.post("/category-budgets", json={"category": "Rent", "currency": "CAD",
        "start_month": "2026-11", "items": [{"name": "Rent", "amount": 2600}]}).json()
    item_id = budget["items"][0]["id"]
    link = client.post("/budget-coverages", json={"budget_item_id": item_id,
        "recurring_id": recurring["id"], "amount": 2600})
    assert link.status_code == 200
    assert client.get("/category-budgets?month=2026-11").json()[0]["amount"] == 2600
    assert client.get("/budget-coverages?month=2026-11").json()[0]["amount"] == 2600
    assert client.post("/budget-coverages", json={"budget_item_id": item_id,
        "recurring_id": recurring["id"], "amount": 1}).status_code == 400


def test_one_fixed_bill_cannot_be_covered_twice_by_overlapping_budgets(client):
    recurring = client.post("/recurring-expenses", json={"name": "Insurance", "amount": 418,
        "currency": "CAD", "due_day": 12, "type": "EXPENSE", "category": "Insurance"}).json()
    first = client.post("/category-budgets", json={"category": "Insurance", "currency": "CAD",
        "start_month": "2026-11", "items": [{"name": "Car", "amount": 418}]}).json()
    second = client.post("/category-budgets", json={"category": "Car", "currency": "CAD",
        "start_month": "2026-11", "items": [{"name": "Insurance", "amount": 418}]}).json()
    assert client.post("/budget-coverages", json={"budget_item_id": first["items"][0]["id"],
        "recurring_id": recurring["id"], "amount": 418}).status_code == 200
    assert client.post("/budget-coverages", json={"budget_item_id": second["items"][0]["id"],
        "recurring_id": recurring["id"], "amount": 418}).status_code == 400


def test_editing_linked_budget_items_requires_explicit_unlink(client):
    recurring = client.post("/recurring-expenses", json={"name": "Rent", "amount": 2600,
        "currency": "CAD", "due_day": 1, "type": "EXPENSE", "category": "Rent"}).json()
    budget = client.post("/category-budgets", json={"category": "Rent", "currency": "CAD",
        "start_month": "2026-11", "items": [{"name": "Rent", "amount": 2600}]}).json()
    client.post("/budget-coverages", json={"budget_item_id": budget["items"][0]["id"],
        "recurring_id": recurring["id"], "amount": 2600})
    response = client.patch(f"/category-budgets/{budget['id']}", json={"items": [{"name": "Rent", "amount": 2700}]})
    assert response.status_code == 409
    assert client.get("/category-budgets?month=2026-11").json()[0]["amount"] == 2600


def test_unchanged_adjusted_budget_carries_approved_coverage_to_new_version(client):
    recurring = client.post("/recurring-expenses", json={"name": "Rent", "amount": 2600,
        "currency": "CAD", "due_day": 1, "type": "EXPENSE", "category": "Rent"}).json()
    budget = client.post("/category-budgets", json={"category": "Rent", "currency": "CAD",
        "start_month": "2026-11", "items": [{"name": "Rent", "amount": 2600}]}).json()
    client.post("/budget-coverages", json={"budget_item_id": budget["items"][0]["id"],
        "recurring_id": recurring["id"], "amount": 2600})
    adjusted = client.post(f"/category-budgets/{budget['id']}/adjust",
        json={"start_month": "2027-01", "items": [{"name": "Rent", "amount": 2600}]})
    assert adjusted.status_code == 200
    old_item = adjusted.json()["previous"]["items"][0]["id"]
    new_item = adjusted.json()["current"]["items"][0]["id"]
    assert client.get("/budget-coverages?month=2026-12").json()[0]["budget_item_id"] == old_item
    assert client.get("/budget-coverages?month=2027-01").json()[0]["budget_item_id"] == new_item
