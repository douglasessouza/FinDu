from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from pydantic import BaseModel
from typing import Optional
import os
from dotenv import load_dotenv
from app.models import Base, Account, Transaction, AccountTypeEnum, CurrencyEnum, RecurringExpense, RecurringTypeEnum, Category, CategoryTypeEnum, MonthlyPayment
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

DEFAULT_CATEGORIES = [
    ("Housing", "EXPENSE"), ("Rent", "EXPENSE"), ("Food", "EXPENSE"),
    ("Restaurant", "EXPENSE"), ("Coffee", "EXPENSE"), ("Transport", "EXPENSE"),
    ("Gas", "EXPENSE"), ("Health", "EXPENSE"), ("Wellness", "EXPENSE"),
    ("Education", "EXPENSE"), ("Subscriptions", "EXPENSE"), ("Entertainment", "EXPENSE"),
    ("Leisure", "EXPENSE"), ("Travel", "EXPENSE"), ("Clothing", "EXPENSE"),
    ("Phone", "EXPENSE"), ("Car", "EXPENSE"), ("Insurance", "EXPENSE"),
    ("Investments", "EXPENSE"), ("Other", "EXPENSE"),
    ("Salary", "INCOME"), ("Other Income", "INCOME"),
    ("Transfer", "TRANSFER"),
]

@app.on_event("startup")
def seed_default_categories():
    """Seed default categories on startup if they don't exist yet."""
    db = SessionLocal()
    try:
        for name, cat_type in DEFAULT_CATEGORIES:
            exists = db.query(Category).filter(Category.name == name).first()
            if not exists:
                db.add(Category(name=name, type=CategoryTypeEnum[cat_type], is_default=True))
        db.commit()
    finally:
        db.close()

@app.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    """Returns all categories (default + user-created) sorted alphabetically."""
    cats = db.query(Category).order_by(Category.name).all()
    return [{"id": c.id, "name": c.name, "type": c.type.value, "is_default": c.is_default} for c in cats]

class CategoryCreate(BaseModel):
    name: str
    type: str = "EXPENSE"

@app.post("/categories")
def create_category(category: CategoryCreate, db: Session = Depends(get_db)):
    """Creates a new user-defined category."""
    existing = db.query(Category).filter(Category.name == category.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")
    db_cat = Category(name=category.name, type=CategoryTypeEnum[category.type], is_default=False)
    db.add(db_cat)
    db.commit()
    db.refresh(db_cat)
    return {"id": db_cat.id, "name": db_cat.name, "type": db_cat.type.value, "is_default": db_cat.is_default}

@app.delete("/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    """Deletes a user-created category. Default categories cannot be deleted."""
    cat = db.query(Category).filter(Category.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if cat.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete default categories")
    db.delete(cat)
    db.commit()
    return {"message": f"Category {cat.name} deleted"}

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
    import_batch_id: Optional[str] = None  # UUID from the import session

class RecurringExpenseCreate(BaseModel):
    name: str
    amount: float
    currency: CurrencyEnum
    due_day: int
    category: Optional[str] = None
    type: RecurringTypeEnum = RecurringTypeEnum.EXPENSE
    valid_until: Optional[datetime] = None   # ← NEW FIELD

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
        if tx_date.day >= closing:
            if tx_date.month == 12:
                stmt_month = tx_date.replace(year=tx_date.year + 1, month=1, day=1)
            else:
                stmt_month = tx_date.replace(month=tx_date.month + 1, day=1)
        else:
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

@app.get("/accounts/{account_id}/card-payments-detected")
def detect_card_payments(account_id: int, db: Session = Depends(get_db)):
    """Returns transactions from this chequing account that look like card payments."""
    transactions = db.query(Transaction)\
        .filter(Transaction.account_id == account_id)\
        .filter(Transaction.amount > 0)\
        .all()

    card_keywords = ["american express", "amex", "visa", "mastercard", "bmo", "credit card payment"]
    payments = []
    for t in transactions:
        desc = t.description.lower()
        if any(k in desc for k in card_keywords):
            payments.append({
                "id": t.id,
                "date": t.date.isoformat(),
                "description": t.description,
                "amount": t.amount,
                "category": t.category
            })
    return payments

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

# --- Import batch endpoints ---

@app.get("/imports")
def list_imports(db: Session = Depends(get_db)):
    """Returns all import batches grouped by import_batch_id, with account info and transaction count."""
    rows = db.query(
        Transaction.import_batch_id,
        Transaction.account_id,
        func.count(Transaction.id).label("count"),
        func.min(Transaction.date).label("first_date"),
        func.max(Transaction.date).label("last_date"),
        func.max(Transaction.created_at).label("imported_at"),
    ).filter(Transaction.import_batch_id != None)\
     .group_by(Transaction.import_batch_id, Transaction.account_id)\
     .order_by(func.max(Transaction.created_at).desc())\
     .all()

    accounts = {a.id: a for a in db.query(Account).all()}
    result = []
    for row in rows:
        acc = accounts.get(row.account_id)
        result.append({
            "import_batch_id": row.import_batch_id,
            "account_id": row.account_id,
            "account_name": acc.name if acc else "Unknown",
            "account_currency": acc.currency.value if acc else "CAD",
            "transaction_count": row.count,
            "first_date": row.first_date.strftime("%Y-%m-%d") if row.first_date else None,
            "last_date": row.last_date.strftime("%Y-%m-%d") if row.last_date else None,
            "imported_at": row.imported_at.strftime("%Y-%m-%d %H:%M") if row.imported_at else None,
        })
    return result

@app.delete("/imports/{batch_id}")
def delete_import_batch(batch_id: str, db: Session = Depends(get_db)):
    """Deletes all transactions belonging to a specific import batch."""
    transactions = db.query(Transaction)\
        .filter(Transaction.import_batch_id == batch_id)\
        .all()
    if not transactions:
        raise HTTPException(status_code=404, detail="Import batch not found")
    count = len(transactions)
    for t in transactions:
        db.delete(t)
    db.commit()
    return {"message": f"Deleted {count} transactions from batch {batch_id}"}

# --- Recurring expenses ---

@app.post("/recurring-expenses")
def create_recurring_expense(expense: RecurringExpenseCreate, db: Session = Depends(get_db)):
    db_expense = RecurringExpense(**expense.model_dump())
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)
    return db_expense

@app.get("/recurring-expenses")
def list_recurring_expenses(db: Session = Depends(get_db)):
    """
    Returns active recurring expenses/income.
    Auto-expires entries where valid_until < today (sets is_active=False).
    """
    now = datetime.utcnow()
 
    # Auto-deactivate expired entries
    expired = db.query(RecurringExpense).filter(
        RecurringExpense.is_active == True,
        RecurringExpense.valid_until != None,
        RecurringExpense.valid_until < now
    ).all()
    for e in expired:
        e.is_active = False
    if expired:
        db.commit()
 
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
@app.get("/spending-analysis")
def spending_analysis(db: Session = Depends(get_db)):
    """
    Returns spending by category grouped by billing month.
    - Credit cards: grouped by payment_due_date month minus 1 (the month you consider the expense)
    - Checking accounts: grouped by transaction date month
    Separates card vs debit spending per category per month.
    """
    from datetime import timedelta

    # Fetch all accounts to classify them
    all_accounts = db.query(Account).all()
    card_ids = {a.id for a in all_accounts if a.account_type.value == "CREDIT_CARD"}
    debit_ids = {a.id for a in all_accounts if a.account_type.value != "CREDIT_CARD"}

    # Only expenses (negative amounts), exclude income and transfer categories
    excluded_categories = {"Salary", "Other Income", "Transfer"}
    transactions = db.query(Transaction).filter(Transaction.amount < 0).all()
    transactions = [t for t in transactions if (t.category or "Other") not in excluded_categories]

    # result[month][category] = {"cards": 0.0, "debit": 0.0}
    result = {}

    for t in transactions:
        cat = t.category or "Other"
        amount = abs(t.amount)

        if t.account_id in card_ids:
            # For credit cards: billing month = payment_due_date month - 1
            if t.payment_due_date:
                due = t.payment_due_date
                # Go back one month
                if due.month == 1:
                    billing_month = due.replace(year=due.year - 1, month=12, day=1)
                else:
                    billing_month = due.replace(month=due.month - 1, day=1)
                month_key = billing_month.strftime("%Y-%m")
            else:
                month_key = t.date.strftime("%Y-%m")
            col = "cards"
        elif t.account_id in debit_ids:
            month_key = t.date.strftime("%Y-%m")
            col = "debit"
        else:
            continue

        if month_key not in result:
            result[month_key] = {}
        if cat not in result[month_key]:
            result[month_key][cat] = {"cards": 0.0, "debit": 0.0}
        result[month_key][cat][col] += round(amount, 2)

    return dict(sorted(result.items()))

# ── File upload imports ────────────────────────────────────────────
from fastapi import UploadFile, File, Form
import pandas as pd
import io
import uuid
import json
import requests as http_requests

def parse_statement_file(content: bytes, filename: str, from_date: str):
    """
    Parse a bank statement file and return a list of transactions.
    Supports: Amex XLS/XLSX, Amex CSV, RBC CSV, BMO CSV
    Returns: (transactions: list[dict], bank: str, error: str | None)
    """
    from_dt = pd.Timestamp(from_date)
    fname = filename.lower()

    try:
        # ── Amex XLS / XLSX ──────────────────────────────────────
        if fname.endswith(".xls") or fname.endswith(".xlsx"):
            engine = "xlrd" if fname.endswith(".xls") else "openpyxl"
            raw = pd.read_excel(io.BytesIO(content), header=None, engine=engine)
            header_idx = None
            for i, row in raw.iterrows():
                row_str = " ".join(str(v).lower() for v in row.values)
                if "date" in row_str and "amount" in row_str:
                    header_idx = i
                    break
            if header_idx is None:
                return None, None, "Could not find header row in Excel file."
            df_raw = pd.read_excel(io.BytesIO(content), header=header_idx, engine=engine)
            df_raw.columns = [str(c).strip() for c in df_raw.columns]
            col_map = {}
            for c in df_raw.columns:
                cl = c.lower()
                if "date" in cl and "process" not in cl and "date" not in col_map:
                    col_map["date"] = c
                elif "description" in cl and "description" not in col_map:
                    col_map["description"] = c
                elif "amount" in cl and "amount" not in col_map:
                    col_map["amount"] = c
            if not all(k in col_map for k in ["date", "description", "amount"]):
                return None, None, f"Could not identify columns. Found: {list(df_raw.columns)}"
            df = df_raw[[col_map["date"], col_map["description"], col_map["amount"]]].copy()
            df.columns = ["date", "description", "amount"]
            df = df.dropna(subset=["description"])
            df = df[df["description"].astype(str).str.strip() != ""]
            df["amount"] = pd.to_numeric(
                df["amount"].astype(str).str.replace("$", "", regex=False).str.replace(",", "", regex=False).str.strip(),
                errors="coerce"
            ) * -1
            df["date_parsed"] = pd.to_datetime(df["date"].astype(str).str.strip(), format="mixed", dayfirst=True, errors="coerce")
            bank = "Amex"

        else:
            text = content.decode("utf-8-sig", errors="ignore")

            # ── BMO CSV ──────────────────────────────────────────
            if "Following data is valid as of" in text or ("Item #" in text and "Transaction Amount" in text):
                lines = text.split("\n")
                header_idx = next(
                    (i for i, l in enumerate(lines) if "Transaction Date" in l and "Transaction Amount" in l),
                    None
                )
                if header_idx is None:
                    return None, None, "Could not find BMO header row."
                df_raw = pd.read_csv(io.StringIO(text), skiprows=header_idx)
                df_raw.columns = [c.strip() for c in df_raw.columns]
                df = df_raw.rename(columns={"Transaction Date": "date", "Transaction Amount": "amount", "Description": "description"})
                df = df[["date", "description", "amount"]].dropna(subset=["amount"])
                df["amount"] = pd.to_numeric(df["amount"], errors="coerce") * -1
                df["date_parsed"] = pd.to_datetime(df["date"].astype(str).str.strip(), format="%Y%m%d", errors="coerce")
                bank = "BMO"

            # ── Amex CSV (semicolon) ──────────────────────────────
            elif ";" in text.split("\n")[0] or "Transaction Details" in text[:500]:
                lines = text.split("\n")
                header_idx = next(
                    (i for i, l in enumerate(lines) if l.startswith("Date;") or ("Description" in l and "Amount" in l and ";" in l)),
                    None
                )
                if header_idx is None:
                    return None, None, "Could not find header row in Amex CSV file."
                raw = pd.read_csv(io.StringIO(text), sep=";", skiprows=header_idx)
                raw.columns = [c.strip() for c in raw.columns]
                df = raw[["Date", "Description", "Amount"]].copy()
                df.columns = ["date", "description", "amount"]
                df = df.dropna(subset=["description"])
                df = df[df["description"].str.strip() != ""]
                df["amount"] = df["amount"].astype(str).str.replace("$", "", regex=False).str.replace(",", "", regex=False).str.strip()
                df["amount"] = pd.to_numeric(df["amount"], errors="coerce") * -1
                df["date_parsed"] = pd.to_datetime(df["date"].str.strip(), format="%d %b. %Y", errors="coerce")
                bank = "Amex"

            else:
                raw = pd.read_csv(io.StringIO(text))
                cols = [c.strip().lower() for c in raw.columns]

                # ── RBC CSV ──────────────────────────────────────
                if "transaction date" in cols and "cad$" in cols:
                    raw.columns = [c.strip() for c in raw.columns]
                    df = raw.rename(columns={"Transaction Date": "date", "Description 1": "description", "CAD$": "amount"})
                    df = df[["date", "description", "amount"]].dropna(subset=["amount"])
                    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
                    df["date_parsed"] = pd.to_datetime(df["date"])
                    bank = f"RBC {raw['Account Type'].iloc[0]}" if "Account Type" in raw.columns else "RBC"
                else:
                    return None, None, f"Unrecognized format. Columns: {list(raw.columns)}"

        # ── Filter by from_date and drop nulls ────────────────────
        df = df.dropna(subset=["amount", "date_parsed"])
        df = df[df["date_parsed"] >= from_dt]

        # Format date as ISO string
        df["date"] = df["date_parsed"].dt.strftime("%Y-%m-%d")
        df = df.drop(columns=["date_parsed"])

        txs = df[["date", "description", "amount"]].to_dict(orient="records")
        return txs, bank, None

    except Exception as e:
        return None, None, str(e)


@app.post("/parse-statement")
async def parse_statement_endpoint(
    file: UploadFile = File(...),
    account_id: int = Form(...),
    from_date: str = Form(...),
    db: Session = Depends(get_db),
):
    """
    Parse an uploaded bank statement file.
    Returns parsed transactions and the last transaction date for anti-duplicate check.
    """
    content = await file.read()
    txs, bank, error = parse_statement_file(content, file.filename, from_date)

    if error:
        raise HTTPException(status_code=400, detail=error)

    if not txs:
        return {"transactions": [], "bank": bank, "last_date": None}

    # Anti-duplicate: get last transaction date for this account
    last_tx = db.query(Transaction)\
        .filter(Transaction.account_id == account_id)\
        .order_by(Transaction.date.desc())\
        .first()
    last_date = last_tx.date.strftime("%Y-%m-%d") if last_tx else None

    # Filter out already-imported transactions
    if last_date:
        txs = [t for t in txs if t["date"] > last_date]

    return {
        "transactions": txs,
        "bank": bank,
        "last_date": last_date,
        "total_parsed": len(txs),
    }


@app.post("/analyze-statement")
async def analyze_statement_endpoint(
    account_id: int = Form(...),
    transactions_json: str = Form(...),
    db: Session = Depends(get_db),
):
    """
    Send transactions to Claude API for categorization.
    Returns transactions with suggested categories.
    """
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    txs = json.loads(transactions_json)
    is_credit = account.account_type.value == "CREDIT_CARD"

    # Get categories
    cats = db.query(Category).order_by(Category.name).all()
    cat_names = [c.name for c in cats]

    # Get recurring expenses for matching
    recurring = db.query(RecurringExpense).filter(RecurringExpense.is_active == True).all()
    recurring_names = [e.name for e in recurring]

    # Build CSV string for AI
    import csv
    csv_buf = io.StringIO()
    writer = csv.DictWriter(csv_buf, fieldnames=["date", "description", "amount"])
    writer.writeheader()
    writer.writerows(txs)
    csv_str = csv_buf.getvalue()

    account_type_hint = "credit card" if is_credit else "chequing/debit"
    credit_note = (
        "IMPORTANT: This is a credit card statement. "
        "Payments like 'Payment - Thank You' or 'PAYMENT RECEIVED' must be categorized as 'Transfer'. "
        "Focus on categorizing actual purchases."
    ) if is_credit else ""

    prompt = f"""You are a financial assistant analyzing a Canadian bank statement ({account.bank} {account_type_hint}).
{credit_note}

Transactions:
{csv_str}

Recurring expenses already registered: {recurring_names}

Return a JSON array. Each item must have:
- "date": original date string (keep as-is)
- "description": clean merchant name (remove codes like "CONTACTLESS INTERAC PURCHASE - 1234")
- "amount": numeric (negative = expense, positive = income/payment)
- "category": one of: {", ".join(cat_names)}
- "is_recurring": true if matches known recurring or clearly a regular bill
- "recurring_match": matching recurring name or null

Return ONLY the JSON array, no markdown, no backticks."""

    try:
        resp = http_requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 4000,
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=60
        )
        ai_text = resp.json()["content"][0]["text"]
        analyzed = json.loads(ai_text)
        return {"transactions": analyzed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")
# ── Monthly Payments (paid tracking) ──────────────────────────────

class MonthlyPaymentCreate(BaseModel):
    month: str          # "2026-06"
    item_type: str      # "card" or "recurring"
    item_id: int
    item_name: str

@app.get("/monthly-payments")
def get_monthly_payments(month: str, db: Session = Depends(get_db)):
    """Returns all paid items for a given month."""
    payments = db.query(MonthlyPayment).filter(MonthlyPayment.month == month).all()
    return [
        {
            "id": p.id,
            "month": p.month,
            "item_type": p.item_type,
            "item_id": p.item_id,
            "item_name": p.item_name,
            "paid_at": p.paid_at.isoformat(),
        }
        for p in payments
    ]

@app.post("/monthly-payments")
def create_monthly_payment(payment: MonthlyPaymentCreate, db: Session = Depends(get_db)):
    """Mark an expense or card as paid for a given month."""
    # Prevent duplicates
    existing = db.query(MonthlyPayment).filter(
        MonthlyPayment.month == payment.month,
        MonthlyPayment.item_type == payment.item_type,
        MonthlyPayment.item_id == payment.item_id,
    ).first()
    if existing:
        return {"id": existing.id, "month": existing.month, "item_type": existing.item_type,
                "item_id": existing.item_id, "item_name": existing.item_name,
                "paid_at": existing.paid_at.isoformat()}
    p = MonthlyPayment(**payment.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id, "month": p.month, "item_type": p.item_type,
            "item_id": p.item_id, "item_name": p.item_name, "paid_at": p.paid_at.isoformat()}

@app.delete("/monthly-payments/{payment_id}")
def delete_monthly_payment(payment_id: int, db: Session = Depends(get_db)):
    """Unmark an expense or card as paid."""
    p = db.query(MonthlyPayment).filter(MonthlyPayment.id == payment_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    db.delete(p)
    db.commit()
    return {"message": "Unmarked as paid"}