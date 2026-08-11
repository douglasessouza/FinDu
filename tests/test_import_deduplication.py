from datetime import date, datetime
from decimal import Decimal

from app.imports import (
    filter_unseen_occurrences,
    normalize_description,
    transaction_fingerprint,
)


ROW = {
    "date": "2026-08-01",
    "description": "  Coffee\tShop  ",
    "amount": "-4.50",
}


def test_normalize_description_collapses_whitespace_and_casefolds_text():
    assert normalize_description("  CAFÉ\n\tSHOP   ") == "café shop"


def test_fingerprint_uses_calendar_date_and_cents_based_amounts():
    canonical = transaction_fingerprint(7, date(2026, 8, 1), "Coffee Shop", "0.30")

    assert canonical == transaction_fingerprint(
        7,
        datetime(2026, 8, 1, 23, 59, 59),
        " coffee   shop ",
        0.1 + 0.2,
    )
    assert canonical != transaction_fingerprint(7, "2026-08-01", "Coffee Shop", "0.31")


def test_fingerprint_isolated_by_account():
    assert transaction_fingerprint(7, "2026-08-01", "Coffee Shop", Decimal("-4.50")) != transaction_fingerprint(
        8, "2026-08-01", "Coffee Shop", Decimal("-4.50")
    )


def test_reimport_of_all_existing_rows_returns_none():
    fingerprint = transaction_fingerprint(7, ROW["date"], ROW["description"], ROW["amount"])

    assert filter_unseen_occurrences([ROW.copy()], {fingerprint: 1}, 7) == []


def test_multiset_deduplication_keeps_identical_rows_when_none_exist():
    rows = [ROW.copy(), ROW.copy()]

    assert filter_unseen_occurrences(rows, {}, 7) == rows


def test_multiset_deduplication_preserves_surplus_occurrence():
    rows = [ROW.copy(), ROW.copy()]
    fingerprint = transaction_fingerprint(7, ROW["date"], ROW["description"], ROW["amount"])

    assert filter_unseen_occurrences(rows, {fingerprint: 1}, 7) == [ROW]
