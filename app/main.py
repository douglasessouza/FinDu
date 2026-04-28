from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from pydantic import BaseModel
from typing import Optional
import os
from dotenv import load_dotenv
from app.models import Base, Account, Transaction, AccountTypeEnum, CurrencyEnum, RecurringExpense, RecurringTypeEnum
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
    "Housing", "Food", "Transport", "Health", "Education",
    "Subscriptions", "Entertainment", "Leisure", "Travel",
    "Clothing", "Phone", "Car", "Insurance", "Investments",
    "Salary", "Other Income", "Transfer", "Other"
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
    type: RecurringTypeEnum = RecurringTypeEnum.EXPENSE

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

@app.delete("/accounts/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(account)
    db.commit()
    return {"message": f"Account {account_id} deleted"}

@app.patch("/accounts/{account_id}")
def update_account(account_id: int, updates: dict, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    for key, value in updates.items():
        if hasattr(account, key):
            setattr(account, key, value)
    db.commit()
    db.refresh(account)
    return account

@app.post("/transactions")
def create_transaction(transaction: TransactionCreate, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == transaction.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    data = transaction.model_dump()

    # Auto-calculate statement_month and payment_due_date for credit cards
    if account.account_type.value == "CREDIT_CARD" and account.closing_day and account.due_day:
        tx_date = transaction.date
        closing = account.closing_day
        due = account.due_day

        # If purchase date is after closing day, it goes to next month's statement
        if tx_date.day > closing:
            # Next month's statement
            if tx_date.month == 12:
                stmt_month = tx_date.replace(year=tx_date.year + 1, month=1, day=1)
            else:
                stmt_month = tx_date.replace(month=tx_date.month + 1, day=1)
        else:
            # Current month's statement
            stmt_month = tx_date.replace(day=1)

        data["statement_month"] = stmt_month.strftime("%Y-%m")

        # Payment due date = due_day of the month after statement_month
        if stmt_month.month == 12:
            due_date = stmt_month.replace(year=stmt_month.year + 1, month=1, day=due)
        else:
            due_date = stmt_month.replace(month=stmt_month.month + 1, day=due)

        data["payment_due_date"] = due_date

    db_transaction = Transaction(**data)
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

@app.get("/accounts/{account_id}/last-transaction")
def get_last_transaction(account_id: int, db: Session = Depends(get_db)):
    transaction = db.query(Transaction)\
        .filter(Transaction.account_id == account_id)\
        .order_by(Transaction.date.desc())\
        .first()
    if not transaction:
        return {"last_date": None}
    return {"last_date": transaction.date.isoformat()}

@app.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)):
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(transaction)
    db.commit()
    return {"message": f"Transaction {transaction_id} deleted"}

@app.get("/accounts/{account_id}/transactions")
def get_account_transactions(account_id: int, db: Session = Depends(get_db)):
    return db.query(Transaction)\
        .filter(Transaction.account_id == account_id)\
        .order_by(Transaction.date.desc())\
        .all()

@app.get("/accounts/{account_id}/statement-summary")
def get_statement_summary(account_id: int, db: Session = Depends(get_db)):
    transactions = db.query(Transaction)\
        .filter(Transaction.account_id == account_id)\
        .filter(Transaction.statement_month != None)\
        .all()
    summary = {}
    for t in transactions:
        month = t.statement_month
        if month not in summary:
            summary[month] = {"charges": 0, "payments": 0, "count": 0, "payment_due_date": None}
        if t.amount < 0:
            summary[month]["charges"] += abs(t.amount)
            summary[month]["count"] += 1
        else:
            summary[month]["payments"] += t.amount
        if t.payment_due_date:
            summary[month]["payment_due_date"] = t.payment_due_date.isoformat()
    return dict(sorted(summary.items()))

@app.patch("/transactions/{transaction_id}")
def update_transaction(transaction_id: int, updates: dict, db: Session = Depends(get_db)):
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    for key, value in updates.items():
        if hasattr(transaction, key):
            setattr(transaction, key, value)
    db.commit()
    db.refresh(transaction)
    return transaction

@app.post("/recurring-expenses")
def create_recurring_expense(expense: RecurringExpenseCreate, db: Session = Depends(get_db)):
    db_expense = RecurringExpense(**expense.model_dump())
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)
    return db_expense

@app.get("/recurring-expenses")
def list_recurring_expenses(db: Session = Depends(get_db)):
    return db.query(RecurringExpense).filter(RecurringExpense.is_active == True).all()

@app.delete("/recurring-expenses/{expense_id}")
def delete_recurring_expense(expense_id: int, db: Session = Depends(get_db)):
    expense = db.query(RecurringExpense).filter(RecurringExpense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.delete(expense)
    db.commit()
    return {"message": f"Expense {expense_id} deleted"}

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