from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime
import enum

Base = declarative_base()

class CurrencyEnum(enum.Enum):
    BRL = "BRL"   # Brazilian Real
    CAD = "CAD"   # Canadian Dollar
    USD = "USD"   # US Dollar
    EUR = "EUR"   # Euro

class AccountTypeEnum(enum.Enum):
    CHECKING = "CHECKING"       # Checking account
    SAVINGS = "SAVINGS"         # Savings account
    CREDIT_CARD = "CREDIT_CARD" # Credit card

class RecurringTypeEnum(enum.Enum):
    EXPENSE = "EXPENSE"
    INCOME = "INCOME"

class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    bank = Column(String, nullable=False)
    account_type = Column(Enum(AccountTypeEnum), nullable=False)
    currency = Column(Enum(CurrencyEnum), nullable=False)
    balance = Column(Float, default=0.0)
    credit_limit = Column(Float, nullable=True)
    closing_day = Column(Integer, nullable=True)
    due_day = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_account_date", "account_id", "date"),
        Index(
            "ix_transactions_account_statement_month",
            "account_id",
            "statement_month",
        ),
        Index("ix_transactions_date", "date"),
        Index("ix_transactions_statement_month", "statement_month"),
        Index("ix_transactions_import_batch_id", "import_batch_id"),
        Index("ix_transactions_category_date", "category", "date"),
        Index(
            "uq_transactions_import_identity",
            "account_id",
            "import_fingerprint",
            "import_occurrence",
            unique=True,
            postgresql_where=text(
                "import_fingerprint IS NOT NULL AND import_occurrence IS NOT NULL"
            ),
            sqlite_where=text(
                "import_fingerprint IS NOT NULL AND import_occurrence IS NOT NULL"
            ),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(Enum(CurrencyEnum), nullable=False)
    date = Column(DateTime, nullable=False)
    category = Column(String, nullable=True)
    statement_month = Column(String, nullable=True)
    payment_due_date = Column(DateTime, nullable=True)
    import_batch_id = Column(String, nullable=True)
    import_fingerprint = Column(String, nullable=True)
    import_occurrence = Column(Integer, nullable=True)
    import_idempotency_key = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class RecurringExpense(Base):
    __tablename__ = "recurring_expenses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(Enum(CurrencyEnum), nullable=False)
    due_day = Column(Integer, nullable=False)
    type = Column(Enum(RecurringTypeEnum), nullable=False, default=RecurringTypeEnum.EXPENSE)
    category = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    start_month = Column(String, nullable=True)
    valid_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class RecurringMonthlyOverride(Base):
    __tablename__ = "recurring_monthly_overrides"
    __table_args__ = (
        UniqueConstraint("recurring_id", "month", name="uq_recurring_monthly_override_item_month"),
        Index("ix_recurring_monthly_overrides_month", "month"),
    )

    id = Column(Integer, primary_key=True, index=True)
    recurring_id = Column(
        Integer,
        ForeignKey("recurring_expenses.id", ondelete="CASCADE"),
        nullable=False,
    )
    month = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class CategoryTypeEnum(enum.Enum):
    EXPENSE = "EXPENSE"
    INCOME = "INCOME"
    TRANSFER = "TRANSFER"

class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    type = Column(Enum(CategoryTypeEnum), nullable=False, default=CategoryTypeEnum.EXPENSE)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class MonthlyPayment(Base):
    __tablename__ = "monthly_payments"
    __table_args__ = (Index("ix_monthly_payments_month", "month"),)
    # Tracks which expenses/cards have been paid in a given month
    # item_type: "card" | "recurring"
    # item_id: account.id for cards, recurring_expense.id for recurring

    id = Column(Integer, primary_key=True, index=True)
    month = Column(String, nullable=False)          # e.g. "2026-06"
    item_type = Column(String, nullable=False)      # "card" or "recurring"
    item_id = Column(Integer, nullable=False)       # account.id or recurring_expense.id
    item_name = Column(String, nullable=False)      # display name e.g. "Amex" or "Rent"
    paid_at = Column(DateTime, default=datetime.utcnow)

class RecurringMatch(Base):
    __tablename__ = "recurring_matches"
    __table_args__ = (
        UniqueConstraint("month", "recurring_id", name="uq_recurring_match_month_item"),
        Index("ix_recurring_matches_month", "month"),
    )

    id = Column(Integer, primary_key=True, index=True)
    month = Column(String, nullable=False)
    recurring_id = Column(Integer, ForeignKey("recurring_expenses.id"), nullable=False)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False)
    planned_amount = Column(Float, nullable=False)
    actual_amount = Column(Float, nullable=False)
    variance = Column(Float, nullable=False)
    confidence = Column(String, nullable=False)
    score = Column(Float, nullable=False)
    source = Column(String, nullable=False, default="auto")
    created_at = Column(DateTime, default=datetime.utcnow)

class CategoryBudget(Base):
    __tablename__ = "category_budgets"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(Enum(CurrencyEnum), nullable=False)
    start_month = Column(String, nullable=False)
    valid_until = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    items = relationship("CategoryBudgetItem", back_populates="budget", cascade="all, delete-orphan")

class CategoryBudgetItem(Base):
    __tablename__ = "category_budget_items"
    __table_args__ = (Index("ix_category_budget_items_budget_id", "budget_id"),)

    id = Column(Integer, primary_key=True, index=True)
    budget_id = Column(Integer, ForeignKey("category_budgets.id"), nullable=False)
    name = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    budget = relationship("CategoryBudget", back_populates="items")
