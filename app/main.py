from fastapi import FastAPI, HTTPException, Depends, Request
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, func, inspect, or_, text
from sqlalchemy.orm import sessionmaker
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import base64
import hmac
import hashlib
import json as auth_json
import time
import requests as http_requests
from dotenv import load_dotenv
from app.models import Base, Account, Transaction, AccountTypeEnum, CurrencyEnum, RecurringExpense, RecurringMonthlyOverride, RecurringTypeEnum, Category, CategoryTypeEnum, MonthlyPayment, RecurringMatch, CategoryBudget, CategoryBudgetItem
from datetime import datetime
from datetime import timedelta
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
APP_PASSWORD = os.getenv("FINDU_APP_PASSWORD")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
EXCHANGE_RATE_API_KEY = os.getenv("EXCHANGE_RATE_API_KEY")
ALLOWED_GOOGLE_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ALLOWED_GOOGLE_EMAILS", "").split(",")
    if email.strip()
}
GOOGLE_AUTH_ENABLED = bool(GOOGLE_CLIENT_ID and ALLOWED_GOOGLE_EMAILS)
AUTH_ENABLED = bool(APP_PASSWORD or GOOGLE_AUTH_ENABLED)
SECRET_KEY = os.getenv("SECRET_KEY") or APP_PASSWORD or GOOGLE_CLIENT_ID or "dev-secret"
AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30

engine = create_engine(
    DATABASE_URL,
    pool_size=3,
    max_overflow=0,
    pool_timeout=30,
    pool_recycle=300,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

app = FastAPI(
    title="FinDu API",
    description="Personal multi-currency financial control app",
    version="0.1.0",
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

AUTH_PUBLIC_PATHS = {
    "/",
    "/health",
    "/auth/login",
    "/auth/google",
    "/auth/status",
}

class LoginRequest(BaseModel):
    password: str

class GoogleLoginRequest(BaseModel):
    credential: str

def base64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

def base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)

def create_auth_token(subject: str = "douglas") -> str:
    payload = {
        "sub": subject,
        "iat": int(time.time()),
        "exp": int(time.time()) + AUTH_TOKEN_TTL_SECONDS,
    }
    payload_raw = auth_json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_part = base64url_encode(payload_raw)
    signature = hmac.new(SECRET_KEY.encode("utf-8"), payload_part.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_part}.{base64url_encode(signature)}"

def verify_auth_token(token: str) -> bool:
    try:
        payload_part, signature_part = token.split(".", 1)
        expected = hmac.new(SECRET_KEY.encode("utf-8"), payload_part.encode("utf-8"), hashlib.sha256).digest()
        provided = base64url_decode(signature_part)
        if not hmac.compare_digest(expected, provided):
            return False
        payload = auth_json.loads(base64url_decode(payload_part))
        return int(payload.get("exp", 0)) >= int(time.time())
    except Exception:
        return False

@app.middleware("http")
async def require_auth(request: Request, call_next):
    path = request.url.path
    if not AUTH_ENABLED:
        return await call_next(request)
    if request.method == "OPTIONS" or path in AUTH_PUBLIC_PATHS or path.startswith("/static"):
        return await call_next(request)
    header = request.headers.get("Authorization", "")
    token = header.removeprefix("Bearer ").strip()
    if not token or not verify_auth_token(token):
        return JSONResponse({"detail": "Authentication required"}, status_code=401)
    return await call_next(request)

@app.get("/")
def root():
    return FileResponse("app/static/index.html")

@app.get("/auth/status")
def auth_status():
    return {
        "requires_auth": AUTH_ENABLED,
        "providers": {
            "password": bool(APP_PASSWORD),
            "google": GOOGLE_AUTH_ENABLED,
        },
        "google_client_id": GOOGLE_CLIENT_ID if GOOGLE_AUTH_ENABLED else None,
    }

@app.post("/auth/login")
def auth_login(login: LoginRequest):
    if not APP_PASSWORD:
        return {"token": create_auth_token()}
    if not hmac.compare_digest(login.password, APP_PASSWORD):
        raise HTTPException(status_code=401, detail="Invalid password")
    return {"token": create_auth_token("password")}

@app.post("/auth/google")
def auth_google(login: GoogleLoginRequest):
    if not GOOGLE_AUTH_ENABLED:
        raise HTTPException(status_code=400, detail="Google sign-in is not configured")
    try:
        response = http_requests.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": login.credential},
            timeout=10,
        )
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google credential")
        token_info = response.json()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Could not verify Google credential")

    email = str(token_info.get("email", "")).lower()
    email_verified = token_info.get("email_verified")
    if token_info.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Invalid Google audience")
    if email_verified not in (True, "true", "True", "1", 1):
        raise HTTPException(status_code=403, detail="Google email is not verified")
    if email not in ALLOWED_GOOGLE_EMAILS:
        raise HTTPException(status_code=403, detail="Google email is not allowed")

    return {"token": create_auth_token(email)}

@app.get("/auth/me")
def auth_me():
    return {"authenticated": True}

@app.get("/exchange-rates")
def exchange_rates(base: str = "CAD"):
    base_currency = base.upper()
    supported = {"CAD", "USD", "BRL"}
    if base_currency not in supported:
        raise HTTPException(status_code=400, detail="Unsupported currency")

    fetched_at = datetime.utcnow().isoformat() + "Z"

    if EXCHANGE_RATE_API_KEY:
        try:
            response = http_requests.get(
                f"https://v6.exchangerate-api.com/v6/{EXCHANGE_RATE_API_KEY}/latest/{base_currency}",
                timeout=12,
            )
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail="Could not load hourly exchange rates")
            payload = response.json()
            rates = payload.get("conversion_rates") or {}
            if payload.get("result") != "success" or not rates:
                raise HTTPException(status_code=502, detail="Invalid hourly exchange rate response")

            updated_unix = int(payload.get("time_last_update_unix") or time.time())
            next_unix = int(payload.get("time_next_update_unix") or updated_unix)
            return {
                "base": base_currency,
                "rates": {currency: rates.get(currency) for currency in supported},
                "rate_last_updated_at": datetime.utcfromtimestamp(updated_unix).isoformat() + "Z",
                "rate_next_update_at": datetime.utcfromtimestamp(next_unix).isoformat() + "Z",
                "fetched_at": fetched_at,
                "source": "exchange-rate-api-v6",
                "update_frequency": "hourly",
            }
        except Exception:
            pass

    try:
        response = http_requests.get(
            f"https://api.exchangerate-api.com/v4/latest/{base_currency}",
            timeout=12,
        )
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail="Could not load exchange rates")
        payload = response.json()
        rates = payload.get("rates") or {}
        updated_unix = int(payload.get("time_last_updated") or time.time())
        return {
            "base": base_currency,
            "rates": {currency: rates.get(currency) for currency in supported},
            "rate_last_updated_at": datetime.utcfromtimestamp(updated_unix).isoformat() + "Z",
            "rate_next_update_at": None,
            "fetched_at": fetched_at,
            "source": "exchange-rate-api-v4-public",
            "update_frequency": "daily",
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Could not load exchange rates")

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
def initialize_reference_data():
    """Create missing tables and seed reference data on startup."""
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    recurring_columns = {
        column["name"]
        for column in inspector.get_columns("recurring_expenses")
    } if inspector.has_table("recurring_expenses") else set()
    if "start_month" not in recurring_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE recurring_expenses ADD COLUMN start_month VARCHAR"))

    db = SessionLocal()
    try:
        for name, cat_type in DEFAULT_CATEGORIES:
            exists = db.query(Category).filter(Category.name == name).first()
            if not exists:
                db.add(Category(name=name, type=CategoryTypeEnum[cat_type], is_default=True))

        budgets_without_items = (
            db.query(CategoryBudget)
            .outerjoin(CategoryBudgetItem, CategoryBudgetItem.budget_id == CategoryBudget.id)
            .filter(CategoryBudgetItem.id == None)
            .all()
        )
        for budget in budgets_without_items:
            if budget.amount > 0:
                db.add(CategoryBudgetItem(budget_id=budget.id, name="General", amount=budget.amount))
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

class CategoryBudgetItemPayload(BaseModel):
    name: str
    amount: float

class CategoryBudgetCreate(BaseModel):
    category: str
    amount: float = 0
    currency: CurrencyEnum = CurrencyEnum.CAD
    start_month: str
    valid_until: Optional[datetime] = None
    items: list[CategoryBudgetItemPayload] = Field(default_factory=list)

class CategoryBudgetAdjustment(BaseModel):
    start_month: str
    valid_until: Optional[datetime] = None
    items: list[CategoryBudgetItemPayload] = Field(default_factory=list)

class FinancialChatMessage(BaseModel):
    role: str
    content: str

class FinancialChatRequest(BaseModel):
    message: str
    history: list[FinancialChatMessage] = Field(default_factory=list)
    mode: str = "chat"

class BudgetMethodologySuggestRequest(BaseModel):
    categories: list[str] = Field(default_factory=list)
    model: str = "60-20-20"

def month_start(month: str) -> datetime:
    try:
        year, month_number = [int(part) for part in month.split("-")]
        return datetime(year, month_number, 1)
    except Exception:
        raise HTTPException(status_code=400, detail="Month must use YYYY-MM format")

def previous_month_end(month: str) -> datetime:
    return month_start(month) - timedelta(days=1)

def apply_card_statement_fields(data: dict, account: Account, tx_date: datetime):
    """Set statement cycle fields for credit card transactions."""
    if account.account_type.value != "CREDIT_CARD" or not account.closing_day or not account.due_day:
        return

    closing = account.closing_day
    due = account.due_day

    if tx_date.day >= closing:
        if tx_date.month == 12:
            stmt_month = tx_date.replace(year=tx_date.year + 1, month=1, day=1)
        else:
            stmt_month = tx_date.replace(month=tx_date.month + 1, day=1)
    else:
        stmt_month = tx_date.replace(day=1)

    data["statement_month"] = stmt_month.strftime("%Y-%m")

    if stmt_month.month == 12:
        due_date = stmt_month.replace(year=stmt_month.year + 1, month=1, day=due)
    else:
        due_date = stmt_month.replace(month=stmt_month.month + 1, day=due)

    data["payment_due_date"] = due_date

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

def category_budget_is_active_for_month(budget: CategoryBudget, month: Optional[str]) -> bool:
    if not budget.is_active:
        return False
    if not month:
        return True
    if budget.start_month and budget.start_month > month:
        return False
    if budget.valid_until:
        try:
            year, month_number = [int(part) for part in month.split("-")]
            month_start = datetime(year, month_number, 1)
            if budget.valid_until < month_start:
                return False
        except Exception:
            return True
    return True

def serialize_category_budget(budget: CategoryBudget):
    items = [
        {
            "id": item.id,
            "name": item.name,
            "amount": item.amount,
            "created_at": item.created_at.isoformat() if item.created_at else None,
        }
        for item in sorted(budget.items, key=lambda item: item.id)
    ]
    amount = round(sum(item["amount"] for item in items), 2) if items else budget.amount
    return {
        "id": budget.id,
        "category": budget.category,
        "amount": amount,
        "currency": budget.currency.value if hasattr(budget.currency, "value") else budget.currency,
        "start_month": budget.start_month,
        "valid_until": budget.valid_until.isoformat() if budget.valid_until else None,
        "is_active": budget.is_active,
        "items": items,
        "created_at": budget.created_at.isoformat() if budget.created_at else None,
    }

def fallback_budget_bucket(category: str) -> str:
    value = category.lower()
    if any(token in value for token in ["investment", "saving", "emergency", "debt", "loan", "tfsa", "rrsp"]):
        return "savings"
    if any(token in value for token in ["coffee", "restaurant", "leisure", "entertainment", "travel", "clothing", "subscription"]):
        return "wants"
    if any(token in value for token in ["rent", "housing", "food", "grocery", "transport", "gas", "car", "insurance", "phone", "health", "wellness", "education"]):
        return "needs"
    return "wants"

@app.post("/budget-methodology/suggest")
def suggest_budget_methodology_mapping(request: BudgetMethodologySuggestRequest):
    categories = [
        category.strip()
        for category in request.categories
        if category and category.strip() and category.strip() not in {"Salary", "Other Income", "Transfer"}
    ]
    fallback = {category: fallback_budget_bucket(category) for category in categories}
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_api_key or not categories:
        return {"mapping": fallback, "source": "fallback"}

    system_prompt = """You classify personal finance categories into budget buckets.
Return only compact JSON in this exact shape: {"mapping":{"Category":"needs|wants|savings"}}.
Use:
- needs: required living costs such as rent, housing, groceries, basic food, transport, gas, car, insurance, phone, health, education, required bills.
- wants: flexible lifestyle costs such as coffee, restaurants, leisure, entertainment, subscriptions, travel, clothing.
- savings: investments, savings, emergency fund, debt acceleration, future goals.
If a category is personal/ambiguous, choose the most likely bucket and keep the category name exactly as provided."""

    try:
        resp = http_requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": "claude-sonnet-4-6",
                "max_tokens": 800,
                "system": system_prompt,
                "messages": [{
                    "role": "user",
                    "content": auth_json.dumps({
                        "budget_model": request.model,
                        "categories": categories,
                    }),
                }],
            },
            timeout=45,
        )
        body = resp.json()
        if resp.status_code >= 400:
            return {"mapping": fallback, "source": "fallback"}
        text = body["content"][0]["text"]
        parsed = auth_json.loads(text)
        raw_mapping = parsed.get("mapping", {})
        allowed = {"needs", "wants", "savings"}
        mapping = {}
        for category in categories:
            bucket = raw_mapping.get(category)
            mapping[category] = bucket if bucket in allowed else fallback[category]
        return {"mapping": mapping, "source": "ai"}
    except Exception:
        return {"mapping": fallback, "source": "fallback"}

@app.get("/category-budgets")
def list_category_budgets(month: Optional[str] = None, db: Session = Depends(get_db)):
    """Returns active category budgets, optionally filtered for a month."""
    budgets = db.query(CategoryBudget).order_by(CategoryBudget.category).all()
    return [serialize_category_budget(budget) for budget in budgets if category_budget_is_active_for_month(budget, month)]

@app.post("/category-budgets")
def create_category_budget(budget: CategoryBudgetCreate, db: Session = Depends(get_db)):
    """Creates a monthly budget for variable spending by category."""
    clean_items = [
        item for item in budget.items
        if item.name.strip() and item.amount > 0
    ]
    amount = round(sum(item.amount for item in clean_items), 2) if clean_items else budget.amount
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    db_budget = CategoryBudget(
        category=budget.category,
        amount=amount,
        currency=budget.currency,
        start_month=budget.start_month,
        valid_until=budget.valid_until,
    )
    db_budget.items = [
        CategoryBudgetItem(name=item.name.strip(), amount=item.amount)
        for item in clean_items
    ] or [CategoryBudgetItem(name=budget.category, amount=amount)]
    db.add(db_budget)
    db.commit()
    db.refresh(db_budget)
    return serialize_category_budget(db_budget)

@app.patch("/category-budgets/{budget_id}")
def update_category_budget(budget_id: int, updates: dict, db: Session = Depends(get_db)):
    budget = db.query(CategoryBudget).filter(CategoryBudget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Category budget not found")
    allowed = {"category", "amount", "currency", "start_month", "valid_until", "is_active", "items"}
    for key, value in updates.items():
        if key not in allowed:
            continue
        if key == "items" and isinstance(value, list):
            clean_items = [
                item for item in value
                if str(item.get("name", "")).strip() and float(item.get("amount", 0) or 0) > 0
            ]
            budget.items = [
                CategoryBudgetItem(name=str(item["name"]).strip(), amount=float(item["amount"]))
                for item in clean_items
            ]
            budget.amount = round(sum(item.amount for item in budget.items), 2)
            continue
        if key == "currency" and isinstance(value, str):
            value = CurrencyEnum[value]
        if key == "valid_until" and isinstance(value, str):
            value = datetime.fromisoformat(value)
        setattr(budget, key, value)
    if "amount" in updates and "items" not in updates:
        budget.items = [CategoryBudgetItem(name=budget.category, amount=budget.amount)]
    db.commit()
    db.refresh(budget)
    return serialize_category_budget(budget)

@app.post("/category-budgets/{budget_id}/adjust")
def adjust_category_budget(budget_id: int, adjustment: CategoryBudgetAdjustment, db: Session = Depends(get_db)):
    """Creates a new budget version from a future month while preserving previous months."""
    budget = db.query(CategoryBudget).filter(CategoryBudget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Category budget not found")

    new_start = month_start(adjustment.start_month)
    old_start = month_start(budget.start_month)
    if new_start <= old_start:
        raise HTTPException(status_code=400, detail="New start month must be after the current budget start month")
    if budget.valid_until and budget.valid_until < new_start:
        raise HTTPException(status_code=400, detail="Budget already ends before the selected start month")

    clean_items = [
        item for item in adjustment.items
        if item.name.strip() and item.amount > 0
    ]
    if not clean_items:
        raise HTTPException(status_code=400, detail="Add at least one budget item with an amount greater than zero")

    original_valid_until = budget.valid_until
    budget.valid_until = previous_month_end(adjustment.start_month)
    next_budget = CategoryBudget(
        category=budget.category,
        amount=round(sum(item.amount for item in clean_items), 2),
        currency=budget.currency,
        start_month=adjustment.start_month,
        valid_until=adjustment.valid_until if adjustment.valid_until is not None else original_valid_until,
        is_active=budget.is_active,
    )
    next_budget.items = [
        CategoryBudgetItem(name=item.name.strip(), amount=item.amount)
        for item in clean_items
    ]
    db.add(next_budget)
    db.commit()
    db.refresh(budget)
    db.refresh(next_budget)
    return {
        "previous": serialize_category_budget(budget),
        "current": serialize_category_budget(next_budget),
    }

@app.delete("/category-budgets/{budget_id}")
def delete_category_budget(budget_id: int, db: Session = Depends(get_db)):
    budget = db.query(CategoryBudget).filter(CategoryBudget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Category budget not found")
    db.delete(budget)
    db.commit()
    return {"message": "Category budget deleted"}

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

class TransactionSplitLine(BaseModel):
    description: str = Field(min_length=1)
    amount: float = Field(gt=0)
    category: Optional[str] = None

class TransactionSplitRequest(BaseModel):
    lines: List[TransactionSplitLine] = Field(min_length=2)

class RecurringExpenseCreate(BaseModel):
    name: str
    amount: float
    currency: CurrencyEnum
    due_day: int
    category: Optional[str] = None
    type: RecurringTypeEnum = RecurringTypeEnum.EXPENSE
    start_month: Optional[str] = None
    valid_until: Optional[datetime] = None   # ← NEW FIELD

class RecurringExpenseUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[CurrencyEnum] = None
    due_day: Optional[int] = None
    category: Optional[str] = None
    type: Optional[RecurringTypeEnum] = None
    start_month: Optional[str] = None
    valid_until: Optional[datetime] = None
    is_active: Optional[bool] = None

class RecurringMonthlyOverrideUpsert(BaseModel):
    amount: float = Field(gt=0)

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

    apply_card_statement_fields(data, account, transaction.date)

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

@app.get("/other-income-transactions")
def list_other_income_transactions(month: str, db: Session = Depends(get_db)):
    try:
        start = datetime.fromisoformat(f"{month}-01T00:00:00")
    except ValueError:
        raise HTTPException(status_code=400, detail="Month must be in YYYY-MM format")

    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)

    return db.query(Transaction)\
        .filter(Transaction.amount > 0)\
        .filter(Transaction.date >= start)\
        .filter(Transaction.date < end)\
        .filter(func.lower(func.trim(Transaction.category)) == "other income")\
        .order_by(Transaction.date.desc())\
        .all()

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
            summary[month] = {
                "charges": 0,
                "credits": 0,
                "payments": 0,
                "amount_due": 0,
                "count": 0,
                "payment_due_date": None,
            }
        if t.amount < 0:
            summary[month]["charges"] += abs(t.amount)
            summary[month]["count"] += 1
        elif (t.category or "").strip().lower() == "transfer":
            summary[month]["payments"] += t.amount
        else:
            summary[month]["credits"] += t.amount
        if t.payment_due_date:
            summary[month]["payment_due_date"] = t.payment_due_date.isoformat()
    for item in summary.values():
        item["amount_due"] = max(0, item["charges"] - item["credits"])
    return dict(sorted(summary.items()))

@app.patch("/transactions/{transaction_id}")
def update_transaction(transaction_id: int, updates: dict, db: Session = Depends(get_db)):
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    for key, value in updates.items():
        if hasattr(transaction, key):
            if key in {"date", "payment_due_date"} and isinstance(value, str):
                value = datetime.fromisoformat(value)
            setattr(transaction, key, value)
    if "date" in updates:
        account = db.query(Account).filter(Account.id == transaction.account_id).first()
        if account:
            data = {}
            apply_card_statement_fields(data, account, transaction.date)
            for key, value in data.items():
                setattr(transaction, key, value)
    db.commit()
    db.refresh(transaction)
    return transaction

@app.post("/transactions/{transaction_id}/split")
def split_transaction(transaction_id: int, split: TransactionSplitRequest, db: Session = Depends(get_db)):
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    original_cents = round(abs(transaction.amount) * 100)
    split_cents = sum(round(line.amount * 100) for line in split.lines)
    if split_cents != original_cents:
        remaining = abs(original_cents - split_cents) / 100
        raise HTTPException(
            status_code=400,
            detail=f"Split total must equal original amount. Remaining difference: {remaining:.2f}",
        )

    sign = -1 if transaction.amount < 0 else 1
    split_transactions = []
    for line in split.lines:
        db_transaction = Transaction(
            account_id=transaction.account_id,
            description=line.description.strip(),
            amount=sign * (round(line.amount * 100) / 100),
            currency=transaction.currency,
            date=transaction.date,
            category=line.category or transaction.category or "Other",
            statement_month=transaction.statement_month,
            payment_due_date=transaction.payment_due_date,
            import_batch_id=transaction.import_batch_id,
        )
        db.add(db_transaction)
        split_transactions.append(db_transaction)

    db.query(RecurringMatch).filter(RecurringMatch.transaction_id == transaction.id).delete()
    db.delete(transaction)
    db.commit()
    for item in split_transactions:
        db.refresh(item)
    return split_transactions

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
    Returns recurring expenses/income.
    Month-based screens decide whether valid_until applies to their selected
    month, so this endpoint must not mutate recurrence state based on today.
    """
    return db.query(RecurringExpense).order_by(
        RecurringExpense.due_day,
        RecurringExpense.name,
    ).all()

@app.patch("/recurring-expenses/{expense_id}")
def update_recurring_expense(expense_id: int, updates: RecurringExpenseUpdate, db: Session = Depends(get_db)):
    expense = db.query(RecurringExpense).filter(RecurringExpense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    changes = updates.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(expense, key, value)

    db.commit()
    db.refresh(expense)
    return expense

@app.delete("/recurring-expenses/{expense_id}")
def delete_recurring_expense(expense_id: int, db: Session = Depends(get_db)):
    expense = db.query(RecurringExpense).filter(RecurringExpense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.delete(expense)
    db.commit()
    return {"message": f"Expense {expense_id} deleted"}

def validate_month_key(month: str) -> None:
    try:
        parsed = datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=422, detail="Month must use YYYY-MM format")
    if parsed.strftime("%Y-%m") != month:
        raise HTTPException(status_code=422, detail="Month must use YYYY-MM format")

@app.get("/recurring-monthly-overrides")
def list_recurring_monthly_overrides(month: str, db: Session = Depends(get_db)):
    validate_month_key(month)
    return db.query(RecurringMonthlyOverride).filter(
        RecurringMonthlyOverride.month == month
    ).all()

@app.put("/recurring-expenses/{expense_id}/monthly-overrides/{month}")
def upsert_recurring_monthly_override(
    expense_id: int,
    month: str,
    override: RecurringMonthlyOverrideUpsert,
    db: Session = Depends(get_db),
):
    validate_month_key(month)
    expense = db.query(RecurringExpense).filter(RecurringExpense.id == expense_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Recurring item not found")

    saved = db.query(RecurringMonthlyOverride).filter(
        RecurringMonthlyOverride.recurring_id == expense_id,
        RecurringMonthlyOverride.month == month,
    ).first()
    if saved:
        saved.amount = override.amount
    else:
        saved = RecurringMonthlyOverride(
            recurring_id=expense_id,
            month=month,
            amount=override.amount,
        )
        db.add(saved)
    db.commit()
    db.refresh(saved)
    return saved

@app.delete("/recurring-expenses/{expense_id}/monthly-overrides/{month}")
def delete_recurring_monthly_override(
    expense_id: int,
    month: str,
    db: Session = Depends(get_db),
):
    validate_month_key(month)
    saved = db.query(RecurringMonthlyOverride).filter(
        RecurringMonthlyOverride.recurring_id == expense_id,
        RecurringMonthlyOverride.month == month,
    ).first()
    if not saved:
        raise HTTPException(status_code=404, detail="Monthly override not found")
    db.delete(saved)
    db.commit()
    return {"message": "Monthly override removed"}

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
    Returns spending by category grouped by spending cycle.
    - Credit cards: grouped by statement month (defined by closing day)
    - Checking accounts: grouped by transaction date month
    Separates card vs debit spending per category per month.
    """
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
            month_key = t.statement_month or t.date.strftime("%Y-%m")
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

def build_financial_snapshot(db: Session) -> dict:
    accounts = db.query(Account).order_by(Account.bank, Account.name).all()
    account_by_id = {account.id: account for account in accounts}
    transactions = db.query(Transaction).order_by(Transaction.date.desc()).limit(500).all()
    recurring = db.query(RecurringExpense).filter(RecurringExpense.is_active == True).order_by(RecurringExpense.name).all()
    budgets = db.query(CategoryBudget).order_by(CategoryBudget.category).all()

    monthly = {}
    category_monthly = {}
    excluded_spending_categories = {"Salary", "Other Income", "Transfer"}
    today_month = datetime.utcnow().strftime("%Y-%m")

    for tx in transactions:
        account = account_by_id.get(tx.account_id)
        month = tx.statement_month if account and account.account_type.value == "CREDIT_CARD" and tx.amount < 0 else tx.date.strftime("%Y-%m")
        currency = tx.currency.value if hasattr(tx.currency, "value") else str(tx.currency)
        category = tx.category or "Other"
        if month not in monthly:
            monthly[month] = {}
        if currency not in monthly[month]:
            monthly[month][currency] = {"income": 0.0, "expenses": 0.0, "net": 0.0}
        if tx.amount >= 0:
            monthly[month][currency]["income"] += tx.amount
        else:
            monthly[month][currency]["expenses"] += abs(tx.amount)
        monthly[month][currency]["net"] += tx.amount

        if tx.amount < 0 and category not in excluded_spending_categories:
            if month not in category_monthly:
                category_monthly[month] = {}
            category_monthly[month][category] = category_monthly[month].get(category, 0.0) + abs(tx.amount)

    for month_data in monthly.values():
        for values in month_data.values():
            for key in values:
                values[key] = round(values[key], 2)

    category_monthly = {
        month: dict(sorted(
            ((category, round(amount, 2)) for category, amount in categories.items()),
            key=lambda item: item[1],
            reverse=True,
        )[:12])
        for month, categories in category_monthly.items()
    }

    budget_rows = []
    budget_alerts = []
    for budget in budgets:
        if not category_budget_is_active_for_month(budget, today_month):
            continue
        amount = sum(item.amount for item in budget.items) if budget.items else budget.amount
        spent = category_monthly.get(today_month, {}).get(budget.category, 0.0)
        usage = (spent / amount) if amount else 0
        budget_rows.append({
            "category": budget.category,
            "amount": round(amount, 2),
            "currency": budget.currency.value if hasattr(budget.currency, "value") else budget.currency,
            "month": today_month,
            "spent": round(spent, 2),
            "usage_pct": round(usage * 100, 1),
        })
        if amount and usage >= 0.9:
            budget_alerts.append(f"{budget.category} is at {round(usage * 100, 1)}% of its {today_month} budget.")

    account_rows = []
    account_alerts = []
    for account in accounts:
        row = {
            "id": account.id,
            "name": account.name,
            "bank": account.bank,
            "type": account.account_type.value,
            "currency": account.currency.value,
            "balance": round(account.balance or 0, 2),
            "credit_limit": round(account.credit_limit, 2) if account.credit_limit else None,
        }
        if account.account_type.value == "CREDIT_CARD" and account.credit_limit:
            utilization = abs(min(account.balance or 0, 0)) / account.credit_limit
            row["utilization_pct"] = round(utilization * 100, 1)
            if utilization >= 0.8:
                account_alerts.append(f"{account.name} credit utilization is high at {round(utilization * 100, 1)}%.")
        account_rows.append(row)

    latest_transactions = [
        {
            "date": tx.date.strftime("%Y-%m-%d"),
            "account": account_by_id.get(tx.account_id).name if account_by_id.get(tx.account_id) else "Unknown",
            "description": tx.description,
            "amount": round(tx.amount, 2),
            "currency": tx.currency.value if hasattr(tx.currency, "value") else str(tx.currency),
            "category": tx.category or "Other",
            "statement_month": tx.statement_month,
        }
        for tx in transactions[:80]
    ]

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "current_month": today_month,
        "accounts": account_rows,
        "monthly_summary": dict(sorted(monthly.items(), reverse=True)[:8]),
        "category_spending_by_month": dict(sorted(category_monthly.items(), reverse=True)[:6]),
        "budgets": budget_rows,
        "recurring": [
            {
                "name": item.name,
                "amount": round(item.amount, 2),
                "currency": item.currency.value if hasattr(item.currency, "value") else str(item.currency),
                "due_day": item.due_day,
                "type": item.type.value,
                "category": item.category,
                "start_month": item.start_month,
                "valid_until": item.valid_until.strftime("%Y-%m-%d") if item.valid_until else None,
            }
            for item in recurring
        ],
        "latest_transactions": latest_transactions,
        "system_alerts": account_alerts + budget_alerts,
    }

@app.post("/financial-chat")
def financial_chat(request: FinancialChatRequest, db: Session = Depends(get_db)):
    anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    snapshot = build_financial_snapshot(db)
    user_message = request.message.strip()
    if not user_message:
        user_message = "Generate the most important financial insights and alerts for me right now."

    history = [
        {"role": item.role, "content": item.content[:1200]}
        for item in request.history[-8:]
        if item.role in {"user", "assistant"} and item.content.strip()
    ]

    system_prompt = """You are FinDu's private financial assistant for one user.
Use only the provided financial snapshot. Be concrete, concise, and actionable.
Focus on cash flow, unusual spending, budget risk, recurring bills, credit cards, and practical next steps.
When mentioning money, include the currency from the data. If the data is insufficient, say what is missing.
Do not provide legal, tax, or investment advice. Do not invent transactions or balances.
Return plain text with short sections and bullets when useful."""

    messages = history + [{
        "role": "user",
        "content": (
            f"Financial snapshot JSON:\n{auth_json.dumps(snapshot, ensure_ascii=False)}\n\n"
            f"User request: {user_message}"
        ),
    }]

    try:
        resp = http_requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": anthropic_api_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": "claude-sonnet-4-6",
                "max_tokens": 1400,
                "system": system_prompt,
                "messages": messages,
            },
            timeout=60,
        )
        resp_body = resp.json()
        if resp.status_code >= 400:
            error_message = resp_body.get("error", {}).get("message", resp.text)
            raise HTTPException(status_code=500, detail=f"AI error: {error_message}")
        return {
            "answer": resp_body["content"][0]["text"],
            "alerts": snapshot["system_alerts"],
            "snapshot_month": snapshot["current_month"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

# ── File upload imports ────────────────────────────────────────────
from fastapi import UploadFile, File, Form
import pandas as pd
import io
import uuid
import json

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


def find_matching_statement_account(db: Session, selected_account_id: int, bank: str | None) -> int:
    """
    Keep anti-duplicate checks aligned with the detected statement bank.
    This prevents an Amex/BMO file from being filtered using the wrong selected account.
    """
    if not bank:
        return selected_account_id

    selected = db.query(Account).filter(Account.id == selected_account_id).first()
    selected_text = f"{selected.name} {selected.bank}".lower() if selected else ""
    bank_name = bank.lower()

    if "amex" in bank_name or "american express" in bank_name:
        keyword = "%amex%"
    elif "bmo" in bank_name:
        keyword = "%bmo%"
    else:
        return selected_account_id

    if keyword.strip("%") in selected_text:
        return selected_account_id

    match = db.query(Account)\
        .filter(Account.account_type == AccountTypeEnum.CREDIT_CARD)\
        .filter(or_(Account.name.ilike(keyword), Account.bank.ilike(keyword)))\
        .order_by(Account.id.asc())\
        .first()

    return match.id if match else selected_account_id


def parse_ai_json_array(text: str):
    """Parse a JSON array even if the model wraps it in a markdown code fence."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```").strip()
        cleaned = cleaned.removesuffix("```").strip()

    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise ValueError("AI response did not contain a JSON array")

    return json.loads(cleaned[start:end + 1])


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

    matched_account_id = find_matching_statement_account(db, account_id, bank)

    # Anti-duplicate: get last transaction date for this account
    last_tx = db.query(Transaction)\
        .filter(Transaction.account_id == matched_account_id)\
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
        "account_id": matched_account_id,
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
                "model": "claude-sonnet-4-6",
                "max_tokens": 4000,
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=60
        )
        resp_body = resp.json()
        if resp.status_code >= 400:
            error_message = resp_body.get("error", {}).get("message", resp.text)
            raise HTTPException(status_code=500, detail=f"AI error: {error_message}")

        ai_text = resp_body["content"][0]["text"]
        analyzed = parse_ai_json_array(ai_text)
        return {"transactions": analyzed}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")
# ── Monthly Payments (paid tracking) ──────────────────────────────

class MonthlyPaymentCreate(BaseModel):
    month: str          # "2026-06"
    item_type: str      # "card" or "recurring"
    item_id: int
    item_name: str

class RecurringMatchCreate(BaseModel):
    month: str
    recurring_id: int
    transaction_id: int
    planned_amount: float
    actual_amount: float
    variance: float
    confidence: str
    score: float
    source: str = "auto"

def serialize_recurring_match(match: RecurringMatch, transaction: Optional[Transaction] = None):
    tx = transaction
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
        "transaction": {
            "id": tx.id,
            "account_id": tx.account_id,
            "description": tx.description,
            "amount": tx.amount,
            "currency": tx.currency.value if hasattr(tx.currency, "value") else tx.currency,
            "date": tx.date.isoformat(),
            "category": tx.category,
            "statement_month": tx.statement_month,
            "payment_due_date": tx.payment_due_date.isoformat() if tx.payment_due_date else None,
        } if tx else None,
    }

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

@app.get("/recurring-matches")
def get_recurring_matches(month: str, db: Session = Depends(get_db)):
    """Returns saved recurring-to-transaction matches for a month."""
    matches = db.query(RecurringMatch).filter(RecurringMatch.month == month).all()
    tx_ids = [m.transaction_id for m in matches]
    transactions = {
        t.id: t for t in db.query(Transaction).filter(Transaction.id.in_(tx_ids)).all()
    } if tx_ids else {}
    return [serialize_recurring_match(match, transactions.get(match.transaction_id)) for match in matches]

@app.post("/recurring-matches")
def upsert_recurring_match(match: RecurringMatchCreate, db: Session = Depends(get_db)):
    """Save or update a recurring expense/income match for a specific month."""
    recurring = db.query(RecurringExpense).filter(RecurringExpense.id == match.recurring_id).first()
    if not recurring:
        raise HTTPException(status_code=404, detail="Recurring item not found")
    transaction = db.query(Transaction).filter(Transaction.id == match.transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    existing = db.query(RecurringMatch).filter(
        RecurringMatch.month == match.month,
        RecurringMatch.recurring_id == match.recurring_id,
    ).first()
    if existing:
        for key, value in match.model_dump().items():
            setattr(existing, key, value)
        db.commit()
        db.refresh(existing)
        return serialize_recurring_match(existing, transaction)

    db_match = RecurringMatch(**match.model_dump())
    db.add(db_match)
    db.commit()
    db.refresh(db_match)
    return serialize_recurring_match(db_match, transaction)

@app.delete("/recurring-matches/{match_id}")
def delete_recurring_match(match_id: int, db: Session = Depends(get_db)):
    """Delete a saved recurring match."""
    match = db.query(RecurringMatch).filter(RecurringMatch.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Recurring match not found")
    db.delete(match)
    db.commit()
    return {"message": "Recurring match deleted"}

@app.post("/recurring-matches/{match_id}/ignore")
def ignore_recurring_match(match_id: int, db: Session = Depends(get_db)):
    """Keep a recurring match unmarked for the month so auto matching does not recreate it."""
    match = db.query(RecurringMatch).filter(RecurringMatch.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Recurring match not found")
    match.source = "ignored"
    db.commit()
    db.refresh(match)
    transaction = db.query(Transaction).filter(Transaction.id == match.transaction_id).first()
    return serialize_recurring_match(match, transaction)
