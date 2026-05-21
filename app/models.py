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
    name = Column(String, nullable=False)        # User-defined label e.g. "RBC Chequing"
    bank = Column(String, nullable=False)        # Financial institution e.g. "RBC"
    account_type = Column(Enum(AccountTypeEnum), nullable=False)  # Checking, Savings or Credit Card
    currency = Column(Enum(CurrencyEnum), nullable=False)         # BRL, CAD, USD or EUR
    balance = Column(Float, default=0.0)         # Current balance (negative for credit card debt)
    credit_limit = Column(Float, nullable=True)         # Credit limit (credit card only)
    closing_day = Column(Integer, nullable=True)        # Statement closing day (credit card only)
    due_day = Column(Integer, nullable=True)            # Payment due day (credit card only)
    created_at = Column(DateTime, default=datetime.utcnow)

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)       # Positive = income, negative = expense
    currency = Column(Enum(CurrencyEnum), nullable=False)
    date = Column(DateTime, nullable=False)
    category = Column(String, nullable=True)     # e.g. "Food", "Transport", "Salary"
    statement_month = Column(String, nullable=True)    # Format: "2026-05" — billing period for credit cards
    payment_due_date = Column(DateTime, nullable=True) # Payment due date for credit card statements
    import_batch_id = Column(String, nullable=True)    # UUID grouping all transactions from the same import
    created_at = Column(DateTime, default=datetime.utcnow)

class RecurringExpense(Base):
    __tablename__ = "recurring_expenses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)        # e.g. "Rent", "Netflix"
    amount = Column(Float, nullable=False)        # Fixed monthly amount
    currency = Column(Enum(CurrencyEnum), nullable=False)
    due_day = Column(Integer, nullable=False)    # Day of month it's due (1-31)
    type = Column(Enum(RecurringTypeEnum), nullable=False, default=RecurringTypeEnum.EXPENSE)
    category = Column(String, nullable=True)     # e.g. "Housing", "Subscriptions"
    is_active = Column(Boolean, default=True)    # Can be deactivated without deleting
    created_at = Column(DateTime, default=datetime.utcnow)