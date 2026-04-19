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
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

app = FastAPI(
    title="FinDu API",
    description="Personal multi-currency financial control app",
    version="0.1.0",
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

@app.get("/")
def root():
    return FileResponse("app/static/index.html")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

CATEGORIES = [
    "Housing",
    "Food",
    "Transport",
    "Health",
    "Education",
    "Subscriptions",
    "Entertainment",
    "Leisure",
    "Travel",
    "Clothing",
    "Phone",
    "Car",
    "Insurance",
    "Investments",
    "Salary",
    "Other Income",
    "Transfer",
    "Other"
]

@app.get("/categories")
def list_categories():
    return CATEGORIES

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
    amount: float
    currency: CurrencyEnum
    date: datetime
    category: Optional[str] = None

class RecurringExpenseCreate(BaseModel):
    name: str
    amount: float
    currency: CurrencyEnum
    due_day: int
    category: Optional[str] = None

@app.get("/health")
def health_check():
    return {"status": "ok", "app": "FinDu"}

@app.post("/accounts")
def create_account(account: AccountCreate, db: Session = Depends(get_db)):
    db_account = Account(**account.model_dump())
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account

@app.get("/accounts")
def list_accounts(db: Session = Depends(get_db)):
    return db.query(Account).all()

@app.post("/transactions")
def create_transaction(transaction: TransactionCreate, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == transaction.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    db_transaction = Transaction(**transaction.model_dump())
    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)
    return db_transaction

@app.get("/transactions")
def list_transactions(account_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Transaction)
    if account_id:
        query = query.filter(Transaction.account_id == account_id)
    return query.all()

@app.post("/recurring-expenses")
def create_recurring_expense(expense: RecurringExpenseCreate, db: Session = Depends(get_db)):
    from app.models import RecurringExpense
    db_expense = RecurringExpense(**expense.model_dump())
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)
    return db_expense

@app.get("/recurring-expenses")
def list_recurring_expenses(db: Session = Depends(get_db)):
    from app.models import RecurringExpense
    return db.query(RecurringExpense).filter(RecurringExpense.is_active == True).all()

@app.get("/spending-by-category")
def spending_by_category(currency: Optional[str] = None, db: Session = Depends(get_db)):
    transactions = db.query(Transaction).all()
    result = {}
    for t in transactions:
        if currency and t.currency.value != currency:
            continue
        cat = t.category or "Other"
        if cat not in result:
            result[cat] = 0
        result[cat] += t.amount
    return result