from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Enum
from sqlalchemy.orm import declarative_base
from datetime import datetime
import enum

Base = declarative_base()

class CurrencyEnum(enum.Enum):
    BRL = "BRL"   # Brazilian Real
    CAD = "CAD"   # Canadian Dollar
    USD = "USD"   # US Dollar
    EUR = "EUR"   # Euro

class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)     # User-defined label, e.g. "Nubank Personal", "TD Checking"
    bank = Column(String, nullable=False)     # Financial institution name, e.g. "Nubank", "TD Bank"
    currency = Column(Enum(CurrencyEnum), nullable=False)  # BRL, CAD, USD or EUR
    balance = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)          # Positive = income, negative = expense
    currency = Column(Enum(CurrencyEnum), nullable=False)
    date = Column(DateTime, nullable=False)
    category = Column(String, nullable=True)        # Ex: "food", "transport"
    created_at = Column(DateTime, default=datetime.utcnow)