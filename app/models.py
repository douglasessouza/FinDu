from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Enum, Boolean
from sqlalchemy.orm import declarative_base
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
    valid_until = Column(DateTime, nullable=True)
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
    # Tracks which expenses/cards have been paid in a given month
    # item_type: "card" | "recurring"
    # item_id: account.id for cards, recurring_expense.id for recurring

    id = Column(Integer, primary_key=True, index=True)
    month = Column(String, nullable=False)          # e.g. "2026-06"
    item_type = Column(String, nullable=False)      # "card" or "recurring"
    item_id = Column(Integer, nullable=False)       # account.id or recurring_expense.id
    item_name = Column(String, nullable=False)      # display name e.g. "Amex" or "Rent"
    paid_at = Column(DateTime, default=datetime.utcnow)