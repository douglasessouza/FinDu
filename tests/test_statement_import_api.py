from datetime import datetime

from sqlalchemy import event

from app.imports import transaction_fingerprint
from app.models import Account, AccountTypeEnum, CurrencyEnum, Transaction


STATEMENT_ROW = {
    "date": "2026-08-10",
    "description": "Coffee Shop",
    "amount": -4.5,
}


def add_account(db_session, *, name="Chequing", bank="TD"):
    account = Account(
        name=name,
        bank=bank,
        account_type=AccountTypeEnum.CHECKING,
        currency=CurrencyEnum.CAD,
        balance=0,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def add_legacy_transaction(db_session, account, row=STATEMENT_ROW):
    transaction = Transaction(
        account_id=account.id,
        description=row["description"],
        amount=row["amount"],
        currency=account.currency,
        date=datetime.fromisoformat(f'{row["date"]}T12:00:00'),
    )
    db_session.add(transaction)
    db_session.commit()
    return transaction


def import_payload(account_id, idempotency_key, rows=None):
    rows = rows or [STATEMENT_ROW]
    return {
        "account_id": account_id,
        "idempotency_key": idempotency_key,
        "transactions": [
            {
                **row,
                "currency": "CAD",
                "category": "Dining",
            }
            for row in rows
        ],
    }


def test_preview_keeps_unseen_transaction_on_latest_imported_date(
    client, db_session, monkeypatch
):
    account = add_account(db_session)
    add_legacy_transaction(db_session, account)
    unseen = {
        "date": "2026-08-10",
        "description": "Book Store",
        "amount": -21.75,
    }
    monkeypatch.setattr(
        "app.main.parse_statement_file",
        lambda *_args: ([STATEMENT_ROW.copy(), unseen.copy()], "TD", None),
    )

    response = client.post(
        "/parse-statement",
        data={"account_id": account.id, "from_date": "2026-08-01"},
        files={"file": ("statement.csv", b"ignored", "text/csv")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["last_date"] == "2026-08-10"
    assert body["transactions"] == [
        {
            **unseen,
            "import_fingerprint": transaction_fingerprint(
                account.id, unseen["date"], unseen["description"], unseen["amount"]
            ),
            "import_occurrence": 1,
        }
    ]


def test_preview_deduplication_is_isolated_by_account(client, db_session, monkeypatch):
    selected = add_account(db_session, name="Daily", bank="TD")
    other = add_account(db_session, name="Savings", bank="TD")
    add_legacy_transaction(db_session, other)
    monkeypatch.setattr(
        "app.main.parse_statement_file",
        lambda *_args: ([STATEMENT_ROW.copy()], "TD", None),
    )

    response = client.post(
        "/parse-statement",
        data={"account_id": selected.id, "from_date": "2026-08-01"},
        files={"file": ("statement.csv", b"ignored", "text/csv")},
    )

    assert response.status_code == 200
    assert len(response.json()["transactions"]) == 1


def test_confirmation_preserves_identical_occurrences(client, db_session):
    account = add_account(db_session)

    response = client.post(
        "/imports/confirm",
        json=import_payload(
            account.id,
            "identical-occurrences",
            [STATEMENT_ROW.copy(), STATEMENT_ROW.copy()],
        ),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["inserted_count"] == 2
    assert body["skipped_count"] == 0
    assert [row["import_occurrence"] for row in body["transactions"]] == [1, 2]
    assert db_session.query(Transaction).count() == 2


def test_confirmation_inserts_surplus_occurrence_returned_by_preview(
    client, db_session, monkeypatch
):
    account = add_account(db_session)
    add_legacy_transaction(db_session, account)
    monkeypatch.setattr(
        "app.main.parse_statement_file",
        lambda *_args: (
            [STATEMENT_ROW.copy(), STATEMENT_ROW.copy()],
            "TD",
            None,
        ),
    )
    preview = client.post(
        "/parse-statement",
        data={"account_id": account.id, "from_date": "2026-08-01"},
        files={"file": ("statement.csv", b"ignored", "text/csv")},
    )
    candidate = {
        **preview.json()["transactions"][0],
        "currency": "CAD",
        "category": "Dining",
    }

    response = client.post(
        "/imports/confirm",
        json={
            "account_id": account.id,
            "idempotency_key": "preview-surplus",
            "transactions": [candidate],
        },
    )

    assert preview.status_code == 200
    assert response.status_code == 200
    assert response.json()["inserted_count"] == 1
    assert response.json()["transactions"][0]["import_occurrence"] == 2
    assert db_session.query(Transaction).count() == 2


def test_confirmation_replays_prior_result_for_same_idempotency_key(
    client, db_session
):
    account = add_account(db_session)
    payload = import_payload(account.id, "retry-key")

    first = client.post("/imports/confirm", json=payload)
    replay = client.post("/imports/confirm", json=payload)

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert db_session.query(Transaction).count() == 1


def test_repeated_statement_with_new_key_is_skipped(client, db_session):
    account = add_account(db_session)

    first = client.post(
        "/imports/confirm", json=import_payload(account.id, "first-key")
    )
    repeated = client.post(
        "/imports/confirm", json=import_payload(account.id, "second-key")
    )

    assert first.status_code == 200
    assert repeated.status_code == 200
    assert repeated.json()["inserted_count"] == 0
    assert repeated.json()["skipped_count"] == 1
    assert repeated.json()["transactions"] == []
    assert db_session.query(Transaction).count() == 1


def test_confirmation_deduplication_is_isolated_by_account(client, db_session):
    first_account = add_account(db_session, name="First")
    second_account = add_account(db_session, name="Second")
    add_legacy_transaction(db_session, first_account)

    response = client.post(
        "/imports/confirm", json=import_payload(second_account.id, "other-account")
    )

    assert response.status_code == 200
    assert response.json()["inserted_count"] == 1
    assert db_session.query(Transaction).count() == 2


def test_invalid_account_leaves_database_unchanged(client, db_session):
    response = client.post(
        "/imports/confirm",
        json=import_payload(999_999, "missing-account", [STATEMENT_ROW] * 2),
    )

    assert response.status_code == 404
    assert db_session.query(Transaction).count() == 0


def test_mid_batch_failure_rolls_back_every_insert(client, db_session):
    account = add_account(db_session)
    calls = 0

    def fail_after_second_insert(_mapper, _connection, _target):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("forced mid-batch failure")

    event.listen(Transaction, "after_insert", fail_after_second_insert)
    try:
        response = client.post(
            "/imports/confirm",
            json=import_payload(
                account.id,
                "rollback-key",
                [
                    STATEMENT_ROW,
                    {
                        "date": "2026-08-11",
                        "description": "Groceries",
                        "amount": -35,
                    },
                ],
            ),
        )
    finally:
        event.remove(Transaction, "after_insert", fail_after_second_insert)

    assert response.status_code == 500
    assert calls == 2
    assert db_session.query(Transaction).count() == 0
