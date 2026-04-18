from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from pydantic import BaseModel
from typing import Optional
import os
from dotenv import load_dotenv
from app.models import Base, Account, Transaction, AccountTypeEnum, CurrencyEnum
from datetime import datetime

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

app = FastAPI(
    title="FinDu API",
    description="Personal multi-currency financial control app",
    version="0.1.0",
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Schemas ---
class AccountCreate(BaseModel):
    name: str
    bank: str
    account_type: AccountTypeEnum
    currency: CurrencyEnum
    balance: float = 0.0
    credit_limit: Optional[float] = None
    closing_day: Optional[int] = None
    due_day: Optional[int] = None

class TransactionCreate(BaseModel):
    account_id: int
    description: str
    amount: float          # Positive = income, negative = expense
    currency: CurrencyEnum
    date: datetime
    category: Optional[str] = None

# --- Routes ---
@app.get("/health")
def health_check():
    return {"status": "ok", "app": "FinDu"}

@app.post("/accounts")
def create_account(account: AccountCreate, db: Se