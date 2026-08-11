from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import threading
import time

import pytest
from fastapi import HTTPException

from app.exchange_rates import CachedExchangeRate, ExchangeRateCache
from app.main import exchange_rates
from app.models import Account, AccountTypeEnum, CurrencyEnum, Transaction


class StubResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


def seed_transactions(db_session):
    account = Account(
        name="Checking",
        bank="FinDu Bank",
        account_type=AccountTypeEnum.CHECKING,
        currency=CurrencyEnum.CAD,
    )
    db_session.add(account)
    db_session.flush()
    transactions = [
        Transaction(
            account_id=account.id,
            description="Groceries",
            amount=-42.50,
            currency=CurrencyEnum.CAD,
            date=datetime(2026, 8, 1),
            category="Other",
        ),
        Transaction(
            account_id=account.id,
            description="Lunch",
            amount=-18.25,
            currency=CurrencyEnum.CAD,
            date=datetime(2026, 8, 2),
            category="Other",
        ),
    ]
    db_session.add_all(transactions)
    db_session.commit()
    return transactions


def test_batch_category_update_changes_only_requested_transactions(client, db_session):
    groceries, lunch = seed_transactions(db_session)

    response = client.patch(
        "/transactions/categories",
        json={
            "updates": [
                {"id": groceries.id, "category": "Groceries"},
                {"id": lunch.id, "category": "Dining"},
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()["updated_count"] == 2
    db_session.expire_all()
    updated_groceries = db_session.get(Transaction, groceries.id)
    updated_lunch = db_session.get(Transaction, lunch.id)
    assert (updated_groceries.category, updated_groceries.description, updated_groceries.amount) == (
        "Groceries",
        "Groceries",
        -42.50,
    )
    assert (updated_lunch.category, updated_lunch.description, updated_lunch.amount) == (
        "Dining",
        "Lunch",
        -18.25,
    )


def test_batch_category_update_rolls_back_every_change_when_any_id_is_unknown(client, db_session):
    groceries, lunch = seed_transactions(db_session)

    response = client.patch(
        "/transactions/categories",
        json={
            "updates": [
                {"id": groceries.id, "category": "Groceries"},
                {"id": 999999, "category": "Dining"},
            ]
        },
    )

    assert response.status_code == 404
    db_session.expire_all()
    assert db_session.get(Transaction, groceries.id).category == "Other"
    assert db_session.get(Transaction, lunch.id).category == "Other"


@pytest.fixture(autouse=True)
def reset_exchange_rate_cache():
    from app import main

    cache = getattr(main, "exchange_rate_cache", None)
    if cache:
        cache.clear()
    yield
    if cache:
        cache.clear()


def public_rate_payload(base):
    return {
        "rates": {
            "CAD": 1.0 if base == "CAD" else 0.72,
            "USD": 0.72 if base == "CAD" else 1.0,
            "BRL": 4.05 if base == "CAD" else 5.62,
        },
        "time_last_updated": 1_785_600_000,
    }


def test_exchange_rates_reuses_a_fresh_cached_response_for_the_same_base(monkeypatch):
    from app import main

    calls = []

    def get(url, timeout):
        calls.append(url)
        return StubResponse(public_rate_payload("CAD"))

    monkeypatch.setattr(main, "EXCHANGE_RATE_API_KEY", None)
    monkeypatch.setattr(main.http_requests, "get", get)

    first = exchange_rates("CAD")
    second = exchange_rates("CAD")

    assert len(calls) == 1
    assert first["cache_status"] == "fresh"
    assert second["cache_status"] == "cached"
    assert second["rates"] == {"CAD": 1.0, "USD": 0.72, "BRL": 4.05}
    assert set(second) >= {
        "base",
        "rates",
        "rate_last_updated_at",
        "rate_next_update_at",
        "fetched_at",
        "source",
        "update_frequency",
        "cache_status",
    }


def test_exchange_rate_cache_is_partitioned_by_base_currency(monkeypatch):
    from app import main

    calls = []

    def get(url, timeout):
        base = url.rsplit("/", 1)[-1]
        calls.append(base)
        return StubResponse(public_rate_payload(base))

    monkeypatch.setattr(main, "EXCHANGE_RATE_API_KEY", None)
    monkeypatch.setattr(main.http_requests, "get", get)

    cad = exchange_rates("CAD")
    usd = exchange_rates("USD")

    assert calls == ["CAD", "USD"]
    assert cad["base"] == "CAD"
    assert usd["base"] == "USD"
    assert cad["rates"]["USD"] == 0.72
    assert usd["rates"]["USD"] == 1.0


def test_exchange_rates_serve_last_known_good_data_after_refresh_failure(monkeypatch):
    from app import main

    calls = 0

    def get(url, timeout):
        nonlocal calls
        calls += 1
        if calls == 1:
            return StubResponse(public_rate_payload("CAD"))
        raise OSError("upstream unavailable")

    monkeypatch.setattr(main, "EXCHANGE_RATE_API_KEY", None)
    monkeypatch.setattr(main, "EXCHANGE_RATE_CACHE_TTL_SECONDS", 0)
    monkeypatch.setattr(main.http_requests, "get", get)

    first = exchange_rates("CAD")
    fallback = exchange_rates("CAD")

    assert calls == 2
    assert fallback["cache_status"] == "stale"
    assert fallback["rates"] == first["rates"]
    assert fallback["fetched_at"] == first["fetched_at"]


def test_exchange_rate_cache_coalesces_concurrent_refreshes(monkeypatch):
    from app import main

    started = threading.Event()
    release = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def get(url, timeout):
        nonlocal calls
        with calls_lock:
            calls += 1
        started.set()
        assert release.wait(timeout=1)
        return StubResponse(public_rate_payload("CAD"))

    monkeypatch.setattr(main, "EXCHANGE_RATE_API_KEY", None)
    monkeypatch.setattr(main.http_requests, "get", get)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(exchange_rates, "CAD")
        assert started.wait(timeout=1)
        second = executor.submit(exchange_rates, "CAD")
        time.sleep(0.05)
        release.set()
        responses = [first.result(timeout=1), second.result(timeout=1)]

    assert calls == 1
    assert {response["cache_status"] for response in responses} == {"fresh", "cached"}


def test_exchange_rate_cache_coalesces_concurrent_cold_cache_failures(monkeypatch):
    from app import main

    started = threading.Event()
    release = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def get(url, timeout):
        nonlocal calls
        with calls_lock:
            calls += 1
        started.set()
        assert release.wait(timeout=1)
        raise OSError("upstream unavailable")

    monkeypatch.setattr(main, "EXCHANGE_RATE_API_KEY", None)
    monkeypatch.setattr(main.http_requests, "get", get)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(exchange_rates, "CAD")
        assert started.wait(timeout=1)
        second = executor.submit(exchange_rates, "CAD")
        time.sleep(0.05)
        release.set()
        with pytest.raises(HTTPException) as first_error:
            first.result(timeout=1)
        with pytest.raises(HTTPException) as second_error:
            second.result(timeout=1)

    assert calls == 1
    assert first_error.value.status_code == second_error.value.status_code == 502


def test_exchange_rate_waiters_receive_stale_data_when_refresh_fails(monkeypatch):
    from app import main

    started = threading.Event()
    release = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def get(url, timeout):
        nonlocal calls
        with calls_lock:
            calls += 1
            call_number = calls
        if call_number == 1:
            return StubResponse(public_rate_payload("CAD"))
        started.set()
        assert release.wait(timeout=1)
        raise OSError("upstream unavailable")

    monkeypatch.setattr(main, "EXCHANGE_RATE_API_KEY", None)
    monkeypatch.setattr(main, "EXCHANGE_RATE_CACHE_TTL_SECONDS", 0)
    monkeypatch.setattr(main.http_requests, "get", get)
    exchange_rates("CAD")

    with ThreadPoolExecutor(max_workers=2) as executor:
        owner = executor.submit(exchange_rates, "CAD")
        assert started.wait(timeout=1)
        waiter = executor.submit(exchange_rates, "CAD")
        time.sleep(0.05)
        release.set()
        responses = [owner.result(timeout=1), waiter.result(timeout=1)]

    assert calls == 2
    assert [response["cache_status"] for response in responses] == ["stale", "stale"]


def test_exchange_rate_waiter_resolves_the_refresh_generation_it_observed():
    cache = ExchangeRateCache()
    first_refresh = ("CAD", 1)

    with cache._condition:
        cache._refreshing.add("CAD")
        cache._refresh_generations["CAD"] = first_refresh[1]

    with ThreadPoolExecutor(max_workers=1) as executor:
        waiter = executor.submit(
            cache.get_or_fetch,
            "CAD",
            lambda: {"base": "CAD", "rates": {"CAD": 1.0}},
            300,
        )
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            with cache._condition:
                if cache._waiters.get(first_refresh) == 1:
                    break
            time.sleep(0.01)
        else:
            pytest.fail("waiter did not join the first refresh generation")

        with cache._condition:
            cache._refresh_failures[first_refresh] = HTTPException(
                status_code=502,
                detail="first refresh failed",
            )
            cache._refreshing.remove("CAD")
            cache._condition.notify_all()
            cache._refresh_generations["CAD"] = 2
            cache._refreshing.add("CAD")
            cache._entries["CAD"] = CachedExchangeRate(
                value={"base": "CAD", "rates": {"CAD": 1.0}},
                fetched_at=time.monotonic(),
            )
            cache._refreshing.remove("CAD")
            cache._condition.notify_all()

        with pytest.raises(HTTPException, match="first refresh failed"):
            waiter.result(timeout=1)
