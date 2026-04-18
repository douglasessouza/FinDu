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
    CHECKING = "CHECKING"       # Conta corrente
    SAVINGS = "SAVINGS"         # Poupança
    CREDIT_CARD = "CREDIT_CARD" # Cartão de crédito

class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)        # User-defined label e.g. "Nubank Personal", "TD Checking"
    bank = Column(String, nullable=False)        # Financial institution e.g. "Nubank", "TD Bank"
    account_type = Column(Enum(AccountTypeEnum), nullable=False)  # Checking, Savings or Credit Card
    currency = Column(Enum(CurrencyEnum), nullable=False)         # BRL, CAD, USD or EUR
    balance = Column(Float, default=0.0)         # Current balance (negative for credit card debt)

    # Credit card only fields
    credit_limit = Column(Float, nullable=True)         # Credit limit
    closing_day = Column(Integer, nullable=True)        # Statement closing day (1-31)
    due_day = Column(Integer, nullable=True)            # Payment due day (1-31)

    created_at = Column(DateTime, default=datetime.utcnow)

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)       # Positive = income, negative = expense
    currency = Column(Enum(CurrencyEnum), nullable=False)
    date = Column(DateTime, nullable=False)
    category = Column(String, nullable=True)     # e.g. "food", "transport", "salary"
    created_at = Column(DateTime, default=datetime.utcnow)