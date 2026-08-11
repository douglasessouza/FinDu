"""Bounded, SQL-backed reporting helpers for financial API routes."""

from __future__ import annotations

import base64
from datetime import date, datetime, time, timedelta
import json
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_
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

    rows = query.group_by(reporting_month, category).order_by(
        reporting_month, category
    )
    result: dict[str, dict[str, dict[str, float]]] = {}
    for row in rows.all():
        result.setdefault(row.month, {})[row.category] = {
            "cards": round(float(row.cards or 0), 2),
            "debit": round(float(row.debit or 0), 2),
        }
    return result


def card_statement_summary(db: Session, month: str) -> dict:
    """Aggregate statement-cycle totals for every card with rows in one month."""
    month_bounds(month)
    normalized_category = func.lower(func.trim(func.coalesce(Transaction.category, "")))
    rows = (
        db.query(
            Account.id.label("account_id"),
            Account.name.label("account_name"),
            Account.currency.label("currency"),
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
        )
        .join(Account, Account.id == Transaction.account_id)
        .filter(Account.account_type == AccountTypeEnum.CREDIT_CARD)
        .filter(Transaction.statement_month == month)
        .group_by(Account.id, Account.name, Account.currency)
        .order_by(Account.id)
        .all()
    )
    cards = []
    for row in rows:
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
    return {
        "month": month,
        "cards": cards,
        "total_charges": round(sum(card["charges"] for card in cards), 2),
        "total_credits": round(sum(card["credits"] for card in cards), 2),
        "total_payments": round(sum(card["payments"] for card in cards), 2),
        "total_amount_due": round(sum(card["amount_due"] for card in cards), 2),
    }


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
    overrides = db.query(RecurringMonthlyOverride).filter(
        RecurringMonthlyOverride.month == month
    ).all()
    checking_transactions = (
        db.query(Transaction)
        .join(Account, Account.id == Transaction.account_id)
        .filter(Account.account_type != AccountTypeEnum.CREDIT_CARD)
        .filter(Transaction.date >= start, Transaction.date < end)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .all()
    )
    cards = card_statement_summary(db, month)
    return {
        "month": month,
        "accounts": accounts,
        "recurring": recurring,
        "payments": [serialize_payment(payment) for payment in payments],
        "matches": [
            serialize_match(match, transaction) for match, transaction in match_rows
        ],
        "overrides": overrides,
        "checking_transactions": checking_transactions,
        "card_summaries": cards,
    }
