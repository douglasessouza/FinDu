"""Pure helpers for statement-import identity and deduplication."""

from datetime import date, datetime
from decimal import Decimal
import hashlib
import hmac
import json
from typing import Collection, Mapping
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


def create_occurrence_token(
    secret: str, account_id: int, fingerprint: str, occurrence: int
) -> str:
    """Sign a server-calculated preview occurrence for later confirmation."""
    message = f"{account_id}:{fingerprint}:{occurrence}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"{occurrence}.{fingerprint}.{signature}"


def verified_identity_from_token(
    secret: str, account_id: int, token: str | None
) -> tuple[str, int] | None:
    """Return the server-signed source identity, or None for invalid input."""
    if not token:
        return None
    try:
        occurrence_text, fingerprint, provided_signature = token.split(".", 2)
        occurrence = int(occurrence_text)
        if occurrence < 1 or not fingerprint:
            return None
    except (TypeError, ValueError):
        return None

    message = f"{account_id}:{fingerprint}:{occurrence}".encode("utf-8")
    expected_signature = hmac.new(
        secret.encode("utf-8"), message, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(provided_signature, expected_signature):
        return None
    return fingerprint, occurrence


def filter_unseen_occurrences(
    parsed: list[dict],
    existing_identity: Mapping[str, int | Collection[int]],
    account_id: int,
    *,
    include_identity: bool = False,
) -> list[dict]:
    """Keep source-order occurrences not represented by existing import identity."""
    statement_counts: dict[str, int] = {}
    unseen: list[dict] = []

    for row in parsed:
        fingerprint = transaction_fingerprint(
            account_id, row["date"], row["description"], row["amount"]
        )
        occurrence = statement_counts.get(fingerprint, 0) + 1
        statement_counts[fingerprint] = occurrence
        existing = existing_identity.get(fingerprint, 0)
        already_seen = (
            occurrence <= existing
            if isinstance(existing, int)
            else occurrence in existing
        )
        if already_seen:
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
