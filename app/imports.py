"""Pure helpers for statement-import identity and deduplication."""

from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
from typing import Mapping
import unicodedata


def normalize_description(value: str) -> str:
    """Return a stable, whitespace-normalized description for matching."""
    return " ".join(unicodedata.normalize("NFC", value).split()).casefold()


def _canonical_date(value: date | datetime | str) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()


def transaction_fingerprint(
    account_id: int,
    date_value: date | datetime | str,
    description: str,
    amount: Decimal | float | str,
) -> str:
    """Build the account-scoped fingerprint from stable transaction fields."""
    cents = Decimal(str(amount)).quantize(Decimal("0.01")) * 100
    payload = json.dumps(
        [account_id, _canonical_date(date_value), normalize_description(description), int(cents)],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def filter_unseen_occurrences(
    parsed: list[dict],
    existing_counts: Mapping[str, int],
    account_id: int,
    *,
    include_identity: bool = False,
) -> list[dict]:
    """Keep source-order occurrences exceeding the existing count per fingerprint."""
    statement_counts: dict[str, int] = {}
    unseen: list[dict] = []

    for row in parsed:
        fingerprint = transaction_fingerprint(
            account_id, row["date"], row["description"], row["amount"]
        )
        occurrence = statement_counts.get(fingerprint, 0) + 1
        statement_counts[fingerprint] = occurrence
        if occurrence <= existing_counts.get(fingerprint, 0):
            continue

        if include_identity:
            unseen.append(
                {
                    **row,
                    "import_fingerprint": fingerprint,
                    "import_occurrence": occurrence,
                }
            )
        else:
            unseen.append(row)

    return unseen
