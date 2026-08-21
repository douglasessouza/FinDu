"""Bounded, SQL-backed reporting helpers for financial API routes."""

from __future__ import annotations

import base64
from datetime import date, datetime, time, timedelta
import json
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, case, func, literal, or_
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AccountTypeEnum,
    MonthlyPayment,
    RecurringExpense,
    RecurringMatch,
    RecurringMonthlyOverride,
    Transaction,
)


EXCLUDED_SPENDING_CATEGORIES = ("Salary", "Other Income", "Transfer")
DEFAULT_TRANSACTION_LIMIT = 100
MAX_TRANSACTION_LIMIT = 500


def month_bounds(month: str) -> tuple[datetime, datetime]:
    """Return the inclusive start and exclusive end of a strict YYYY-MM key."""
    try:
        start = datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=422, detail="Month must use YYYY-MM format")
    if start.strftime("%Y-%m") != month:
        raise HTTPException(status_code=422, detail="Month must use YYYY-MM format")
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


def _encode_cursor(transaction: Transaction) -> str:
    raw = json.dumps(
        [transaction.date.isoformat(), transaction.id], separators=(",", ":")
    ).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        padding = "=" * (-len(cursor) % 4)
        value = json.loads(base64.urlsafe_b64decode(cursor + padding))
        if not isinstance(value, list) or len(value) != 2:
            raise ValueError
        cursor_date = datetime.fromisoformat(value[0])
        cursor_id = int(value[1])
        if cursor_id < 1:
            raise ValueError
        return cursor_date, cursor_id
    except (TypeError, ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=422, detail="Invalid transaction cursor")


def transaction_page(
    db: Session,
    *,
    account_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    month: Optional[str] = None,
    category: Optional[str] = None,
    limit: Optional[int] = None,
    cursor: Optional[str] = None,
) -> dict:
    """Return a deterministic keyset page ordered by date and id descending."""
    page_size = limit if limit is not None else DEFAULT_TRANSACTION_LIMIT
    if page_size < 1 or page_size > MAX_TRANSACTION_LIMIT:
        raise HTTPException(
            status_code=422,
            detail=f"Limit must be between 1 and {MAX_TRANSACTION_LIMIT}",
        )

    query = db.query(Transaction)
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)
    if month is not None:
        month_start, month_end = month_bounds(month)
        query = query.filter(
            Transaction.date >= month_start, Transaction.date < month_end
        )
    if date_from is not None:
        query = query.filter(Transaction.date >= datetime.combine(date_from, time.min))
    if date_to is not None:
        query = query.filter(
            Transaction.date < datetime.combine(date_to + timedelta(days=1), time.min)
        )
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must not exceed date_to")
    if category is not None:
        query = query.filter(func.coalesce(Transaction.category, "Other") == category)
    if cursor is not None:
        cursor_date, cursor_id = _decode_cursor(cursor)
        query = query.filter(
            or_(
                Transaction.date < cursor_date,
                and_(Transaction.date == cursor_date, Transaction.id < cursor_id),
            )
        )

    rows = (
        query.order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(page_size + 1)
        .all()
    )
    has_more = len(rows) > page_size
    items = rows[:page_size]
    return {
        "items": items,
        "next_cursor": _encode_cursor(items[-1]) if has_more else None,
    }


def _database_month(db: Session, column):
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        return func.to_char(column, "YYYY-MM")
    return func.strftime("%Y-%m", column)


def spending_summary(
    db: Session,
    *,
    month_from: Optional[str] = None,
    month_to: Optional[str] = None,
) -> dict:
    """Aggregate card-cycle and debit-date spending without loading transactions."""
    if month_from is not None:
        month_bounds(month_from)
    if month_to is not None:
        month_bounds(month_to)
    if month_from is not None and month_to is not None and month_from > month_to:
        raise HTTPException(status_code=422, detail="month_from must not exceed month_to")

    if month_from is None and month_to is None:
        return _legacy_spending_summary(db)

    date_month = _database_month(db, Transaction.date)
    reporting_month = case(
        (
            Account.account_type == AccountTypeEnum.CREDIT_CARD,
            func.coalesce(Transaction.statement_month, date_month),
        ),
        else_=date_month,
    )
    category = func.coalesce(Transaction.category, "Other")
    cards = func.sum(
        case(
            (
                Account.account_type == AccountTypeEnum.CREDIT_CARD,
                -Transaction.amount,
            ),
            else_=0.0,
        )
    )
    debit = func.sum(
        case(
            (
                Account.account_type != AccountTypeEnum.CREDIT_CARD,
                -Transaction.amount,
            ),
            else_=0.0,
        )
    )
    query = (
        db.query(
            reporting_month.label("month"),
            category.label("category"),
            Transaction.currency.label("currency"),
            cards.label("cards"),
            debit.label("debit"),
        )
        .join(Account, Account.id == Transaction.account_id)
        .filter(Transaction.amount < 0)
        .filter(category.notin_(EXCLUDED_SPENDING_CATEGORIES))
    )
    if month_from is not None:
        query = query.filter(reporting_month >= month_from)
    if month_to is not None:
        query = query.filter(reporting_month <= month_to)

    rows = query.group_by(reporting_month, category, Transaction.currency).order_by(
        reporting_month, category, Transaction.currency
    )
    buckets = {}
    for row in rows.all():
        currency = row.currency.value
        buckets.setdefault(row.month, {}).setdefault(row.category, {})[currency] = {
            "cards": round(float(row.cards or 0), 2),
            "debit": round(float(row.debit or 0), 2),
        }
    return _spending_response(buckets)


def _legacy_spending_summary(db: Session) -> dict:
    """Preserve the exact old shape and arithmetic for unbounded requests."""
    rows = (
        db.query(Transaction, Account.account_type)
        .join(Account, Account.id == Transaction.account_id)
        .filter(Transaction.amount < 0)
        .all()
    )
    result = {}
    for transaction, account_type in rows:
        category = transaction.category or "Other"
        if category in EXCLUDED_SPENDING_CATEGORIES:
            continue
        month = (
            transaction.statement_month or transaction.date.strftime("%Y-%m")
            if account_type == AccountTypeEnum.CREDIT_CARD
            else transaction.date.strftime("%Y-%m")
        )
        values = result.setdefault(month, {}).setdefault(
            category, {"cards": 0.0, "debit": 0.0}
        )
        column = (
            "cards"
            if account_type == AccountTypeEnum.CREDIT_CARD
            else "debit"
        )
        values[column] += round(abs(transaction.amount), 2)
    return dict(sorted(result.items()))


def _spending_response(buckets: dict) -> dict:
    """Expose legacy totals only for single-currency category buckets."""
    result = {}
    for month in sorted(buckets):
        result[month] = {}
        for category in sorted(buckets[month]):
            by_currency = {
                currency: buckets[month][category][currency]
                for currency in sorted(buckets[month][category])
            }
            only_currency = next(iter(by_currency)) if len(by_currency) == 1 else None
            only_values = by_currency.get(only_currency) if only_currency else None
            result[month][category] = {
                "cards": only_values["cards"] if only_values else None,
                "debit": only_values["debit"] if only_values else None,
                "currency": only_currency,
                "by_currency": by_currency,
            }
    return result


def _card_summary_query(
    db: Session,
    month: str,
    *,
    by_payment_due_date: bool,
    summary_kind: Optional[str] = None,
):
    start, end = month_bounds(month)
    normalized_category = func.lower(func.trim(func.coalesce(Transaction.category, "")))
    columns = [
        Account.id.label("account_id"),
        Account.name.label("account_name"),
        Transaction.currency.label("currency"),
        func.coalesce(
            func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0.0)),
            0.0,
        ).label("charges"),
        func.coalesce(
            func.sum(
                case(
                    (
                        and_(
                            Transaction.amount >= 0,
                            normalized_category != "transfer",
                        ),
                        Transaction.amount,
                    ),
                    else_=0.0,
                )
            ),
            0.0,
        ).label("credits"),
        func.coalesce(
            func.sum(
                case(
                    (
                        and_(
                            Transaction.amount >= 0,
                            normalized_category == "transfer",
                        ),
                        Transaction.amount,
                    ),
                    else_=0.0,
                )
            ),
            0.0,
        ).label("payments"),
        func.sum(case((Transaction.amount < 0, 1), else_=0)).label("count"),
        func.max(Transaction.payment_due_date).label("payment_due_date"),
    ]
    if summary_kind is not None:
        columns.insert(0, literal(summary_kind).label("summary_kind"))
    query = (
        db.query(*columns)
        .join(Account, Account.id == Transaction.account_id)
        .filter(Account.account_type == AccountTypeEnum.CREDIT_CARD)
    )
    if by_payment_due_date:
        query = query.filter(
            Transaction.payment_due_date >= start,
            Transaction.payment_due_date < end,
        )
    else:
        query = query.filter(Transaction.statement_month == month)
    return query.group_by(Account.id, Account.name, Transaction.currency)


def _card_summary_response(month: str, rows) -> dict:
    cards = []
    for row in sorted(rows, key=lambda item: (item.account_id, item.currency.value)):
        charges = round(float(row.charges), 2)
        credits = round(float(row.credits), 2)
        cards.append(
            {
                "account_id": row.account_id,
                "account_name": row.account_name,
                "currency": row.currency.value,
                "charges": charges,
                "credits": credits,
                "payments": round(float(row.payments), 2),
                "amount_due": round(max(0.0, charges - credits), 2),
                "count": int(row.count or 0),
                "payment_due_date": (
                    row.payment_due_date.isoformat() if row.payment_due_date else None
                ),
            }
        )
    totals_by_currency = {}
    for card in cards:
        totals = totals_by_currency.setdefault(
            card["currency"],
            {"charges": 0.0, "credits": 0.0, "payments": 0.0, "amount_due": 0.0},
        )
        for key in totals:
            totals[key] += card[key]
    totals_by_currency = {
        currency: {key: round(value, 2) for key, value in totals.items()}
        for currency, totals in sorted(totals_by_currency.items())
    }
    only_currency = (
        next(iter(totals_by_currency)) if len(totals_by_currency) == 1 else None
    )
    only_totals = totals_by_currency.get(only_currency) if only_currency else None
    no_cards = not totals_by_currency
    return {
        "month": month,
        "cards": cards,
        "total_charges": only_totals["charges"] if only_totals else (0.0 if no_cards else None),
        "total_credits": only_totals["credits"] if only_totals else (0.0 if no_cards else None),
        "total_payments": only_totals["payments"] if only_totals else (0.0 if no_cards else None),
        "total_amount_due": only_totals["amount_due"] if only_totals else (0.0 if no_cards else None),
        "currency": only_currency,
        "totals_by_currency": totals_by_currency,
    }


def _card_summary(db: Session, month: str, *, by_payment_due_date: bool) -> dict:
    rows = _card_summary_query(
        db, month, by_payment_due_date=by_payment_due_date
    ).all()
    return _card_summary_response(month, rows)


def card_statement_summary(db: Session, month: str) -> dict:
    """Aggregate statement-cycle totals for every card with rows in one month."""
    return _card_summary(db, month, by_payment_due_date=False)


def card_payment_due_summary(db: Session, month: str) -> dict:
    """Aggregate card bills whose persisted payment due date falls in one month."""
    return _card_summary(db, month, by_payment_due_date=True)


def card_dashboard_summaries(db: Session, month: str) -> tuple[dict, dict]:
    statement_query = _card_summary_query(
        db,
        month,
        by_payment_due_date=False,
        summary_kind="statement",
    )
    due_query = _card_summary_query(
        db,
        month,
        by_payment_due_date=True,
        summary_kind="due",
    )
    rows = statement_query.union_all(due_query).all()
    return (
        _card_summary_response(
            month, [row for row in rows if row.summary_kind == "statement"]
        ),
        _card_summary_response(
            month, [row for row in rows if row.summary_kind == "due"]
        ),
    )


def serialize_payment(payment: MonthlyPayment) -> dict:
    return {
        "id": payment.id,
        "month": payment.month,
        "item_type": payment.item_type,
        "item_id": payment.item_id,
        "item_name": payment.item_name,
        "paid_at": payment.paid_at.isoformat(),
    }


def serialize_match(match: RecurringMatch, transaction: Optional[Transaction]) -> dict:
    return {
        "id": match.id,
        "month": match.month,
        "recurring_id": match.recurring_id,
        "transaction_id": match.transaction_id,
        "planned_amount": match.planned_amount,
        "actual_amount": match.actual_amount,
        "variance": match.variance,
        "confidence": match.confidence,
        "score": match.score,
        "source": match.source,
        "created_at": match.created_at.isoformat() if match.created_at else None,
        "transaction": (
            {
                "id": transaction.id,
                "account_id": transaction.account_id,
                "description": transaction.description,
                "amount": transaction.amount,
                "currency": transaction.currency.value,
                "date": transaction.date.isoformat(),
                "category": transaction.category,
                "statement_month": transaction.statement_month,
                "payment_due_date": (
                    transaction.payment_due_date.isoformat()
                    if transaction.payment_due_date
                    else None
                ),
            }
            if transaction
            else None
        ),
    }


def monthly_dashboard(db: Session, month: str) -> dict:
    """Load all monthly dashboard collections with a constant seven queries."""
    start, end = month_bounds(month)
    previous_month = (start - timedelta(days=1)).strftime("%Y-%m")
    matching_start = (start - timedelta(days=1)).replace(day=26)
    accounts = db.query(Account).all()
    recurring = db.query(RecurringExpense).order_by(
        RecurringExpense.due_day, RecurringExpense.name
    ).all()
    payments = db.query(MonthlyPayment).filter(MonthlyPayment.month == month).all()
    match_rows = (
        db.query(RecurringMatch, Transaction)
        .outerjoin(Transaction, Transaction.id == RecurringMatch.transaction_id)
        .filter(RecurringMatch.month == month)
        .all()
    )
    override_rows = db.query(RecurringMonthlyOverride).filter(
        RecurringMonthlyOverride.month.in_((previous_month, month))
    ).all()
    overrides = [override for override in override_rows if override.month == month]
    previous_month_overrides = [
        override for override in override_rows if override.month == previous_month
    ]
    checking_transactions = (
        db.query(Transaction)
        .join(Account, Account.id == Transaction.account_id)
        .filter(Account.account_type != AccountTypeEnum.CREDIT_CARD)
        .filter(Transaction.date >= matching_start, Transaction.date < end)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .all()
    )
    cards, cards_due = card_dashboard_summaries(db, month)
    return {
        "month": month,
        "accounts": accounts,
        "recurring": recurring,
        "payments": [serialize_payment(payment) for payment in payments],
        "matches": [
            serialize_match(match, transaction) for match, transaction in match_rows
        ],
        "overrides": overrides,
        "previous_month_overrides": previous_month_overrides,
        "checking_transactions": checking_transactions,
        "card_summaries": cards,
        "card_summaries_due": cards_due,
    }
