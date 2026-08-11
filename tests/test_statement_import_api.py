from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime
import io
import json
from threading import Barrier, Lock, get_ident

from sqlalchemy import event
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.imports import transaction_fingerprint
from app.main import app, get_db
from app.models import (
    Account,
    AccountTypeEnum,
    Base,
    CurrencyEnum,
    StatementImportBatch,
    Transaction,
)


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
    rows = [STATEMENT_ROW] if rows is None else rows
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
    assert len(body["transactions"]) == 1
    preview_row = body["transactions"][0]
    assert {key: preview_row[key] for key in unseen} == unseen
    assert preview_row["import_fingerprint"] == transaction_fingerprint(
        account.id, unseen["date"], unseen["description"], unseen["amount"]
    )
    assert preview_row["import_occurrence"] == 1
    assert isinstance(preview_row["import_identity_token"], str)
    assert preview_row["import_identity_token"]


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


def test_analysis_preserves_server_import_identity_metadata(
    client, db_session, monkeypatch
):
    account = add_account(db_session)
    parsed = {
        **STATEMENT_ROW,
        "import_fingerprint": "server-fingerprint",
        "import_occurrence": 2,
        "import_identity_token": "signed-token",
    }

    class FakeResponse:
        status_code = 200
        text = ""

        def json(self):
            return {
                "content": [
                    {
                        "text": json.dumps(
                            [
                                {
                                    "date": STATEMENT_ROW["date"],
                                    "description": "Clean Coffee Shop",
                                    "amount": STATEMENT_ROW["amount"],
                                    "category": "Dining",
                                    "is_recurring": False,
                                    "recurring_match": None,
                                    "source_row_id": "source-0",
                                }
                            ]
                        )
                    }
                ]
            }

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(
        "app.main.http_requests.post", lambda *args, **kwargs: FakeResponse()
    )

    response = client.post(
        "/analyze-statement",
        data={
            "account_id": account.id,
            "transactions_json": json.dumps([parsed]),
        },
    )

    assert response.status_code == 200
    analyzed = response.json()["transactions"][0]
    assert analyzed["description"] == "Clean Coffee Shop"
    assert analyzed["import_fingerprint"] == "server-fingerprint"
    assert analyzed["import_occurrence"] == 2
    assert analyzed["import_identity_token"] == "signed-token"


def test_reordered_analysis_maps_identity_by_source_row_id_and_confirms(
    client, db_session, monkeypatch
):
    account = add_account(db_session)
    rows = [
        STATEMENT_ROW.copy(),
        {
            "date": "2026-08-11",
            "description": "Book Store",
            "amount": -21.75,
        },
    ]
    monkeypatch.setattr(
        "app.main.parse_statement_file", lambda *_args: (rows, "TD", None)
    )
    preview = client.post(
        "/parse-statement",
        data={"account_id": account.id, "from_date": "2026-08-01"},
        files={"file": ("statement.csv", b"ignored", "text/csv")},
    )
    preview_rows = preview.json()["transactions"]
    expected_fingerprints = {
        row["description"]: row["import_fingerprint"] for row in preview_rows
    }

    class ReorderedResponse:
        status_code = 200
        text = ""

        def __init__(self, analyzed):
            self.analyzed = analyzed

        def json(self):
            return {"content": [{"text": json.dumps(self.analyzed)}]}

    def reorder_from_prompt(*_args, **kwargs):
        prompt = kwargs["json"]["messages"][0]["content"]
        csv_text = prompt.split("Transactions:\n", 1)[1].split(
            "\n\nRecurring expenses", 1
        )[0]
        prompt_rows = list(csv.DictReader(io.StringIO(csv_text)))
        assert all(row.get("source_row_id") for row in prompt_rows)
        analyzed = [
            {
                "source_row_id": row["source_row_id"],
                "date": row["date"],
                "description": f'Reviewed {row["description"]}',
                "amount": float(row["amount"]),
                "category": "Other",
                "is_recurring": False,
                "recurring_match": None,
            }
            for row in reversed(prompt_rows)
        ]
        return ReorderedResponse(analyzed)

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr("app.main.http_requests.post", reorder_from_prompt)
    analyzed_response = client.post(
        "/analyze-statement",
        data={
            "account_id": account.id,
            "transactions_json": json.dumps(
                [
                    {**row, "source_row_id": "untrusted-duplicate"}
                    for row in preview_rows
                ]
            ),
        },
    )

    assert analyzed_response.status_code == 200
    analyzed_rows = analyzed_response.json()["transactions"]
    assert [row["description"] for row in analyzed_rows] == [
        "Reviewed Book Store",
        "Reviewed Coffee Shop",
    ]
    for row in analyzed_rows:
        original_description = row["description"].removeprefix("Reviewed ")
        assert row["import_fingerprint"] == expected_fingerprints[original_description]
        assert "source_row_id" not in row

    confirmation = client.post(
        "/imports/confirm",
        json={
            "account_id": account.id,
            "idempotency_key": "reordered-analysis",
            "transactions": [
                {**row, "currency": "CAD"} for row in analyzed_rows
            ],
        },
    )

    assert confirmation.status_code == 200
    assert confirmation.json()["inserted_count"] == 2
    for row in confirmation.json()["transactions"]:
        original_description = row["description"].removeprefix("Reviewed ")
        assert row["import_fingerprint"] == expected_fingerprints[original_description]


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
        "description": "Clean Coffee Shop",
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
    assert response.json()["transactions"][0]["import_fingerprint"] == (
        preview.json()["transactions"][0]["import_fingerprint"]
    )
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


def test_empty_confirmation_replays_persisted_result_after_database_changes(
    client, db_session
):
    account = add_account(db_session)
    existing = add_legacy_transaction(db_session, account)
    payload = import_payload(account.id, "empty-retry-key")

    first = client.post("/imports/confirm", json=payload)
    assert first.status_code == 200
    assert first.json()["inserted_count"] == 0
    db_session.delete(existing)
    db_session.commit()

    replay = client.post("/imports/confirm", json=payload)

    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert db_session.query(Transaction).count() == 0


def test_empty_transaction_list_persists_an_idempotent_result(client, db_session):
    account = add_account(db_session)
    payload = import_payload(account.id, "literally-empty-key", rows=[])

    first = client.post("/imports/confirm", json=payload)
    replay = client.post("/imports/confirm", json=payload)

    assert first.status_code == 200
    assert first.json()["inserted_count"] == 0
    assert first.json()["skipped_count"] == 0
    assert first.json()["transactions"] == []
    assert replay.json() == first.json()
    batch = db_session.query(StatementImportBatch).one()
    assert batch.idempotency_key == "literally-empty-key"


def test_zero_row_batch_is_visible_in_import_history(client, db_session):
    account = add_account(db_session)
    confirmation = client.post(
        "/imports/confirm",
        json=import_payload(account.id, "zero-history", rows=[]),
    )

    history = client.get("/imports")

    assert confirmation.status_code == 200
    assert history.status_code == 200
    assert len(history.json()) == 1
    history_row = history.json()[0]
    assert {
        key: value for key, value in history_row.items() if key != "imported_at"
    } == {
        "import_batch_id": confirmation.json()["import_batch_id"],
        "account_id": account.id,
        "account_name": "Chequing",
        "account_currency": "CAD",
        "transaction_count": 0,
        "first_date": None,
        "last_date": None,
    }
    datetime.strptime(history_row["imported_at"], "%Y-%m-%d %H:%M")


def test_delete_zero_row_batch_removes_persisted_claim(client, db_session):
    account = add_account(db_session)
    confirmation = client.post(
        "/imports/confirm",
        json=import_payload(account.id, "delete-empty", rows=[]),
    )

    response = client.delete(
        f'/imports/{confirmation.json()["import_batch_id"]}'
    )

    assert response.status_code == 200
    assert response.json() == {
        "message": (
            f'Deleted 0 transactions from batch '
            f'{confirmation.json()["import_batch_id"]}'
        )
    }
    assert db_session.query(StatementImportBatch).count() == 0
    assert client.get("/imports").json() == []


def test_delete_import_removes_claim_and_allows_same_key_to_import_again(
    client, db_session
):
    account = add_account(db_session)
    payload = import_payload(account.id, "delete-and-retry")
    first = client.post("/imports/confirm", json=payload)

    deleted = client.delete(f'/imports/{first.json()["import_batch_id"]}')
    retried = client.post("/imports/confirm", json=payload)

    assert deleted.status_code == 200
    assert retried.status_code == 200
    assert retried.json()["inserted_count"] == 1
    assert db_session.query(Transaction).count() == 1
    assert db_session.query(StatementImportBatch).count() == 1


def test_delete_import_failure_rolls_back_transactions_and_claim(
    client, db_session
):
    account = add_account(db_session)
    confirmation = client.post(
        "/imports/confirm",
        json=import_payload(account.id, "delete-rollback"),
    )

    def fail_batch_delete(_mapper, _connection, _target):
        raise RuntimeError("forced delete failure")

    event.listen(StatementImportBatch, "after_delete", fail_batch_delete)
    try:
        response = client.delete(
            f'/imports/{confirmation.json()["import_batch_id"]}'
        )
    finally:
        event.remove(StatementImportBatch, "after_delete", fail_batch_delete)

    assert response.status_code == 500
    assert db_session.query(Transaction).count() == 1
    assert db_session.query(StatementImportBatch).count() == 1


def test_same_idempotency_key_rejects_a_different_payload(client, db_session):
    account = add_account(db_session)
    original = import_payload(account.id, "bound-payload-key")
    changed = import_payload(
        account.id,
        "bound-payload-key",
        [
            {
                "date": "2026-08-10",
                "description": "Different merchant",
                "amount": -18,
            }
        ],
    )

    first = client.post("/imports/confirm", json=original)
    divergent = client.post("/imports/confirm", json=changed)

    assert first.status_code == 200
    assert divergent.status_code == 409
    assert divergent.json() == {
        "detail": "Idempotency key already used with a different payload"
    }
    assert db_session.query(Transaction).count() == 1


def test_client_occurrence_cannot_bypass_server_deduplication(client, db_session):
    account = add_account(db_session)
    add_legacy_transaction(db_session, account)
    fingerprint = transaction_fingerprint(
        account.id,
        STATEMENT_ROW["date"],
        STATEMENT_ROW["description"],
        STATEMENT_ROW["amount"],
    )
    payload = import_payload(account.id, "forged-occurrence")
    payload["transactions"][0].update(
        {"import_fingerprint": fingerprint, "import_occurrence": 999}
    )

    response = client.post("/imports/confirm", json=payload)

    assert response.status_code == 200
    assert response.json()["inserted_count"] == 0
    assert response.json()["skipped_count"] == 1
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


def run_concurrent_imports(tmp_path, idempotency_keys):
    database_path = tmp_path / "concurrent-import.db"
    local_engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    with local_engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
    Base.metadata.create_all(local_engine)
    local_session = sessionmaker(
        autocommit=False, autoflush=False, bind=local_engine
    )
    with local_session() as setup_session:
        account = add_account(setup_session)
        account_id = account.id

    barrier = Barrier(2)
    seen_threads = set()
    seen_lock = Lock()

    def synchronize_first_idempotency_lookup(
        _connection, _cursor, statement, _parameters, _context, _executemany
    ):
        sql = statement.lower()
        if not sql.lstrip().startswith("select") or "idempotency_key" not in sql:
            return
        thread_id = get_ident()
        with seen_lock:
            if thread_id in seen_threads:
                return
            seen_threads.add(thread_id)
        barrier.wait(timeout=5)

    event.listen(
        local_engine, "after_cursor_execute", synchronize_first_idempotency_lookup
    )

    def override_get_db():
        session = local_session()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    payloads = [
        import_payload(account_id, idempotency_key)
        for idempotency_key in idempotency_keys
    ]
    try:
        with TestClient(app) as first_client, TestClient(app) as second_client:
            with ThreadPoolExecutor(max_workers=2) as executor:
                responses = list(
                    executor.map(
                        lambda item: item[0].post(
                            "/imports/confirm", json=item[1]
                        ),
                        zip((first_client, second_client), payloads),
                    )
                )
    finally:
        app.dependency_overrides.clear()
        event.remove(
            local_engine, "after_cursor_execute", synchronize_first_idempotency_lookup
        )

    with local_session() as verification_session:
        transaction_count = verification_session.query(Transaction).count()
        batch_count = verification_session.query(StatementImportBatch).count()
    local_engine.dispose()
    return responses, transaction_count, batch_count


def test_concurrent_same_key_requests_return_the_winning_result(tmp_path):
    responses, transaction_count, batch_count = run_concurrent_imports(
        tmp_path, ("concurrent-key", "concurrent-key")
    )

    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert transaction_count == 1
    assert batch_count == 1


def test_concurrent_different_keys_for_same_rows_skip_the_loser(tmp_path):
    responses, transaction_count, batch_count = run_concurrent_imports(
        tmp_path, ("concurrent-first", "concurrent-second")
    )

    assert [response.status_code for response in responses] == [200, 200]
    assert sorted(response.json()["inserted_count"] for response in responses) == [0, 1]
    assert transaction_count == 1
    assert batch_count == 2


def test_identity_integrity_race_retries_as_a_skipped_batch(
    client, db_session, monkeypatch
):
    account = add_account(db_session)
    existing = add_legacy_transaction(db_session, account)
    existing.import_fingerprint = transaction_fingerprint(
        account.id,
        existing.date,
        existing.description,
        existing.amount,
    )
    existing.import_occurrence = 1
    existing.import_idempotency_key = "concurrent-winner"
    db_session.commit()

    from app.main import statement_fingerprint_counts as real_counts

    count_calls = 0

    def stale_counts_once(session, account_id):
        nonlocal count_calls
        count_calls += 1
        if count_calls == 1:
            return {}
        return real_counts(session, account_id)

    original_flush = db_session.flush
    flush_calls = 0

    def concurrent_identity_conflict(*args, **kwargs):
        nonlocal flush_calls
        flush_calls += 1
        original_flush(*args, **kwargs)
        if flush_calls == 2:
            raise IntegrityError(
                "INSERT INTO transactions",
                {},
                RuntimeError("simulated concurrent identity conflict"),
            )

    monkeypatch.setattr("app.main.statement_fingerprint_counts", stale_counts_once)
    monkeypatch.setattr(db_session, "flush", concurrent_identity_conflict)

    response = client.post(
        "/imports/confirm",
        json=import_payload(account.id, "concurrent-loser"),
    )

    assert response.status_code == 200
    assert response.json()["inserted_count"] == 0
    assert response.json()["skipped_count"] == 1
    assert count_calls == 2
    assert db_session.query(Transaction).count() == 1
    batch = db_session.query(StatementImportBatch).one()
    assert batch.idempotency_key == "concurrent-loser"


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
    assert db_session.query(StatementImportBatch).count() == 0
