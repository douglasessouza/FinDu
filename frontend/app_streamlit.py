import streamlit as st
import requests
import os
import json
import uuid
import pandas as pd
from datetime import datetime, date
from collections import defaultdict

API_URL = os.getenv("API_URL", "http://127.0.0.1:8000")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

CATEGORIES = ["Housing","Rent","Food","Restaurant","Coffee","Transport","Gas","Health","Wellness",
              "Education","Subscriptions","Entertainment","Leisure","Travel","Clothing",
              "Phone","Car","Insurance","Investments","Salary","Other Income","Transfer","Other"]

def get_categories():
    try:
        r = requests.get(f"{API_URL}/categories", timeout=10)
        if r.status_code == 200:
            data = r.json()
            if data and isinstance(data[0], dict):
                return sorted([c["name"] for c in data])
    except:
        pass
    return CATEGORIES

def get_accounts():
    try:
        r = requests.get(f"{API_URL}/accounts", timeout=15)
        return r.json() if r.status_code == 200 else []
    except:
        return []

def get_recurring():
    try:
        r = requests.get(f"{API_URL}/recurring-expenses", timeout=15)
        return r.json() if r.status_code == 200 else []
    except:
        return []

def get_imports():
    try:
        r = requests.get(f"{API_URL}/imports", timeout=15)
        return r.json() if r.status_code == 200 else []
    except:
        return []

def post_data(endpoint, payload):
    try:
        return requests.post(f"{API_URL}/{endpoint}", json=payload, timeout=15)
    except Exception as e:
        st.error(f"Connection error: {e}")
        return None

def delete_data(endpoint, id):
    try:
        return requests.delete(f"{API_URL}/{endpoint}/{id}", timeout=15)
    except Exception as e:
        st.error(f"Error: {e}")
        return None

def patch_account(account_id, data):
    try:
        return requests.patch(f"{API_URL}/accounts/{account_id}", json=data, timeout=15)
    except:
        return None

def fmt(v, c):
    if c in ["BRL", "EUR"]:
        return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{v:,.2f}"

# ── Statement parser ───────────────────────────────────────────────

def parse_statement(uploaded, from_date):
    filename = uploaded.name.lower()

    if filename.endswith(".xls") or filename.endswith(".xlsx"):
        try:
            engine = "xlrd" if filename.endswith(".xls") else "openpyxl"
            raw = pd.read_excel(uploaded, header=None, engine=engine)
            header_idx = None
            for i, row in raw.iterrows():
                row_str = " ".join(str(v).lower() for v in row.values)
                if "date" in row_str and "amount" in row_str:
                    header_idx = i
                    break
            if header_idx is None:
                return None, "Could not find header row in Excel file."
            df_raw = pd.read_excel(uploaded, header=header_idx, engine=engine)
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
                return None, f"Could not identify columns. Found: {list(df_raw.columns)}"
            df = df_raw[[col_map["date"], col_map["description"], col_map["amount"]]].copy()
            df.columns = ["date", "description", "amount"]
            df = df.dropna(subset=["description"])
            df = df[df["description"].astype(str).str.strip() != ""]
            df["amount"] = pd.to_numeric(
                df["amount"].astype(str).str.replace("$", "", regex=False).str.replace(",", "", regex=False).str.strip(),
                errors="coerce"
            ) * -1
            df["date_parsed"] = pd.to_datetime(df["date"].astype(str).str.strip(), format="mixed", dayfirst=True, errors="coerce")
            df["date"] = df["date_parsed"].dt.strftime("%-m/%-d/%Y")
            bank = "Amex"
        except Exception as e:
            return None, f"Error reading Excel file: {e}"
    else:
        content = uploaded.read().decode("utf-8-sig", errors="ignore")
        uploaded.seek(0)
        if ";" in content.split("\n")[0] or "Transaction Details" in content[:500]:
            lines = content.split("\n")
            header_idx = next(
                (i for i, l in enumerate(lines) if l.startswith("Date;") or ("Description" in l and "Amount" in l and ";" in l)),
                None
            )
            if header_idx is None:
                return None, "Could not find header row in Amex file."
            import io
            raw = pd.read_csv(io.StringIO(content), sep=";", skiprows=header_idx)
            raw.columns = [c.strip() for c in raw.columns]
            df = raw[["Date", "Description", "Amount"]].copy()
            df.columns = ["date", "description", "amount"]
            df = df.dropna(subset=["description"])
            df = df[df["description"].str.strip() != ""]
            df["amount"] = df["amount"].astype(str).str.replace("$", "", regex=False).str.replace(",", "", regex=False).str.strip()
            df["amount"] = pd.to_numeric(df["amount"], errors="coerce") * -1
            df["date_parsed"] = pd.to_datetime(df["date"].str.strip(), format="%d %b. %Y", errors="coerce")
            df["date"] = df["date_parsed"].dt.strftime("%-m/%-d/%Y")
            bank = "Amex"
        else:
            raw = pd.read_csv(uploaded)
            uploaded.seek(0)
            cols = [c.strip().lower() for c in raw.columns]
            if "transaction date" in cols and "cad$" in cols:
                raw.columns = [c.strip() for c in raw.columns]
                df = raw.rename(columns={"Transaction Date": "date", "Description 1": "description", "CAD$": "amount"})
                df = df[["date", "description", "amount"]].dropna(subset=["amount"])
                df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
                df["date_parsed"] = pd.to_datetime(df["date"])
                bank = f"RBC {raw['Account Type'].iloc[0]}" if "Account Type" in raw.columns else "RBC"
            elif "transaction amount" in cols:
                raw.columns = [c.strip() for c in raw.columns]
                df = raw.rename(columns={"Transaction Date": "date", "Transaction Amount": "amount", "Description": "description"})
                df = df[["date", "description", "amount"]].dropna(subset=["amount"])
                df["amount"] = pd.to_numeric(df["amount"], errors="coerce") * -1
                df["date_parsed"] = pd.to_datetime(df["date"].astype(str), format="%Y%m%d")
                df["date"] = df["date_parsed"].dt.strftime("%-m/%-d/%Y")
                bank = "BMO"
            else:
                return None, f"Unrecognized format. Columns: {list(raw.columns)}"

    df = df.dropna(subset=["amount", "date_parsed"])
    df = df[df["date_parsed"] >= pd.Timestamp(from_date)]
    df = df.drop(columns=["date_parsed"])
    return df, bank

# ── App layout ─────────────────────────────────────────────────────

st.set_page_config(page_title="FinDu", page_icon="💰", layout="centered")
st.title("💰 FinDu")
st.caption("Personal multi-currency financial control")

if "current_page" not in st.session_state:
    st.session_state.current_page = "Dashboard"

MENU = [
    ("📊", "Dashboard"),
    ("📂", "Import Statement"),
    ("📅", "Monthly View"),
    ("📈", "Spending Analysis"),
    ("💳", "Card Summary"),
    ("💸", "Transactions"),
    ("🏦", "Accounts"),
    ("💳", "Credit Cards"),
    ("🔄", "Recurring Expenses"),
    ("🏷️", "Categories"),
]

st.sidebar.markdown("""
<style>
    div[data-testid="stSidebar"] .stButton button {
        width: 100%;
        text-align: left;
        background: transparent;
        border: none;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 15px;
        color: inherit;
        cursor: pointer;
        transition: background 0.15s;
    }
    div[data-testid="stSidebar"] .stButton button:hover {
        background: rgba(128,128,128,0.15);
    }
    div[data-testid="stSidebar"] .stButton button[kind="primary"] {
        background: rgba(99, 102, 241, 0.18);
        font-weight: 600;
        border-left: 3px solid #6366f1;
    }
</style>
""", unsafe_allow_html=True)

st.sidebar.markdown("### 💰 FinDu")

try:
    _fx = requests.get("https://api.exchangerate-api.com/v4/latest/USD", timeout=5).json()
    _usd_cad = _fx["rates"]["CAD"]
    st.sidebar.markdown(f"""
    <div style="display:inline-block;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.3);
    border-radius:20px;padding:3px 10px;font-size:12px;margin-bottom:4px;color:inherit">
    💵 1 USD = CAD$ {_usd_cad:.4f}
    </div>
    """, unsafe_allow_html=True)
except:
    pass

st.sidebar.divider()

for icon, label in MENU:
    is_active = st.session_state.current_page == label
    if st.sidebar.button(f"{icon}  {label}", key=f"nav_{label}", type="primary" if is_active else "secondary", use_container_width=True):
        st.session_state.current_page = label
        st.rerun()

page = st.session_state.current_page

@st.cache_data(ttl=3600)
def get_fx():
    try:
        r1 = requests.get("https://api.exchangerate-api.com/v4/latest/BRL", timeout=10)
        r2 = requests.get("https://api.exchangerate-api.com/v4/latest/USD", timeout=10)
        return {"BRL_CAD": r1.json()["rates"]["CAD"], "USD_CAD": r2.json()["rates"]["CAD"]}
    except:
        return {"BRL_CAD": None, "USD_CAD": None}

# ─────────────────────────────────────────────────────────────────
if page == "Dashboard":
    st.header("📊 Dashboard")
    st.caption(f"Today: {date.today().strftime('%B %d, %Y')}")
    fx = get_fx()
    c1, c2 = st.columns(2)
    with c1:
        if fx["BRL_CAD"]:
            st.metric("🇨🇦 1 CAD", f"R$ {fmt(1/fx['BRL_CAD'],'BRL')}")
    with c2:
        if fx["USD_CAD"]:
            st.metric("🇺🇸 1 USD", f"CAD$ {fmt(fx['USD_CAD'],'CAD')}")
    st.divider()
    accounts = get_accounts()
    recurring = get_recurring()
    checking = [a for a in accounts if a["account_type"] != "CREDIT_CARD"]
    cards = [a for a in accounts if a["account_type"] == "CREDIT_CARD"]
    cad_checking = [a for a in checking if a["currency"] == "CAD"]
    cad_cards = [a for a in cards if a["currency"] == "CAD"]
    brl_checking = [a for a in checking if a["currency"] == "BRL"]
    brl_cards_list = [a for a in cards if a["currency"] == "BRL"]

    if cad_checking or cad_cards:
        st.subheader("🇨🇦 Canada (CAD)")
        total_cad_cash = 0
        for a in cad_checking:
            st.metric(f"🏦 {a['name']}", f"CAD$ {fmt(a['balance'],'CAD')}")
            total_cad_cash += a["balance"]
        total_cards_due = 0
        if cad_cards:
            st.write("**💳 Card payments due:**")
            for card in cad_cards:
                try:
                    summary = requests.get(f"{API_URL}/accounts/{card['id']}/statement-summary", timeout=10).json()
                    due_groups = defaultdict(float)
                    for month, data in summary.items():
                        due = data.get("payment_due_date", "")[:10]
                        charges = data.get("charges", 0)
                        if due and charges > 0:
                            due_groups[due] += charges
                    for due, total in sorted(due_groups.items()):
                        due_dt = datetime.strptime(due, "%Y-%m-%d").date()
                        days_left = (due_dt - date.today()).days
                        if days_left >= -30:
                            status = "🔴 OVERDUE" if days_left < 0 else f"⏳ {days_left}d" if days_left <= 7 else f"📅 {due}"
                            col1, col2 = st.columns([3, 1])
                            with col1:
                                st.write(f"  • **{card['name']}**: CAD$ {fmt(total,'CAD')} (due {due})")
                            with col2:
                                st.caption(status)
                            total_cards_due += total
                except:
                    pass
            if total_cards_due > 0:
                st.caption(f"Total due: CAD$ {fmt(total_cards_due,'CAD')}")
        st.divider()
        cad_rec = sum(e["amount"] for e in recurring if e["currency"] == "CAD" and e.get("type") != "INCOME")
        cad_inc = sum(e["amount"] for e in recurring if e["currency"] == "CAD" and e.get("type") == "INCOME")
        col1, col2 = st.columns(2)
        with col1:
            st.metric("💰 In Bank", f"CAD$ {fmt(total_cad_cash,'CAD')}")
            st.metric("💳 Cards Due", f"- CAD$ {fmt(total_cards_due,'CAD')}", delta_color="inverse")
            st.metric("🔄 Recurring", f"- CAD$ {fmt(cad_rec,'CAD')}", delta_color="inverse")
        with col2:
            net = total_cad_cash - total_cards_due - cad_rec
            st.metric("📊 Net Position", f"CAD$ {fmt(net,'CAD')}")
            if cad_inc > 0:
                st.metric("📈 + Income", f"CAD$ {fmt(cad_inc,'CAD')}")
                st.metric("🎯 After Income", f"CAD$ {fmt(net+cad_inc,'CAD')}")
    st.divider()

    if brl_checking or brl_cards_list:
        st.subheader("🇧🇷 Brazil (BRL)")
        total_brl_cash = 0
        for a in brl_checking:
            st.metric(f"🏦 {a['name']}", f"R$ {fmt(a['balance'],'BRL')}")
            total_brl_cash += a["balance"]
        st.metric("💰 In Bank", f"R$ {fmt(total_brl_cash,'BRL')}")
        if fx["BRL_CAD"]:
            st.caption(f"≈ CAD$ {fmt(total_brl_cash*fx['BRL_CAD'],'CAD')}")
    st.divider()

    st.subheader("💰 Net Worth (CAD)")
    total_cad_cash = sum(a["balance"] for a in cad_checking) if cad_checking else 0
    total_brl_cash = sum(a["balance"] for a in brl_checking) if brl_checking else 0
    total_bruto = total_cad_cash + (total_brl_cash * fx["BRL_CAD"] if fx["BRL_CAD"] else 0)
    st.caption(f"🇧🇷 R$ {fmt(total_brl_cash,'BRL')} ≈ CAD$ {fmt(total_brl_cash*fx['BRL_CAD'] if fx['BRL_CAD'] else 0,'CAD')} + 🇨🇦 CAD$ {fmt(total_cad_cash,'CAD')}")
    st.metric("Total assets", f"CAD$ {fmt(total_bruto,'CAD')}")

# ─────────────────────────────────────────────────────────────────
elif page == "Monthly View":
    import calendar
    st.header("📅 Monthly View")
    today = date.today()
    if "mv_year" not in st.session_state:
        st.session_state.mv_year = today.year
    if "mv_month" not in st.session_state:
        st.session_state.mv_month = today.month

    col_prev, col_title, col_next = st.columns([1, 3, 1])
    with col_prev:
        if st.button("←"):
            if st.session_state.mv_month == 1:
                st.session_state.mv_month = 12
                st.session_state.mv_year -= 1
            else:
                st.session_state.mv_month -= 1
            st.rerun()
    with col_title:
        st.subheader(f"{calendar.month_name[st.session_state.mv_month]} {st.session_state.mv_year}")
    with col_next:
        if st.button("→"):
            if st.session_state.mv_month == 12:
                st.session_state.mv_month = 1
                st.session_state.mv_year += 1
            else:
                st.session_state.mv_month += 1
            st.rerun()
    st.divider()

    recurring = get_recurring()
    accounts = get_accounts()
    fx = get_fx()
    current_month_str = f"{st.session_state.mv_year}-{st.session_state.mv_month:02d}"

    for currency, flag, symbol in [("CAD", "🇨🇦", "CAD$"), ("BRL", "🇧🇷", "R$")]:
        st.subheader(f"{flag} {currency}")

        card_accounts = [a for a in accounts if a["currency"] == currency and a["account_type"] == "CREDIT_CARD"]
        checking_accounts = [a for a in accounts if a["currency"] == currency and a["account_type"] != "CREDIT_CARD"]
        account_balance = sum(a["balance"] for a in checking_accounts)

        # Recurring income
        income_rec = [e for e in recurring if e["currency"] == currency and e.get("type") == "INCOME"]
        total_rec_income = sum(e["amount"] for e in income_rec)

        # Recurring expenses
        expense_rec = [e for e in recurring if e["currency"] == currency and e.get("type") != "INCOME"]
        total_rec_expense = sum(e["amount"] for e in expense_rec)

        # Card charges due this month
        card_charges = 0
        card_breakdown = {}
        for acc in card_accounts:
            try:
                summary = requests.get(f"{API_URL}/accounts/{acc['id']}/statement-summary", timeout=10).json()
                acc_total = 0
                for month_data in summary.values():
                    due = month_data.get("payment_due_date", "")[:7]
                    if due == current_month_str:
                        acc_total += month_data.get("charges", 0)
                if acc_total > 0:
                    card_charges += acc_total
                    card_breakdown[acc["name"]] = acc_total
            except:
                pass

        # Chequing transactions this month (info only)
        checking_expenses = 0
        checking_income = 0
        category_totals = defaultdict(float)
        for acc in checking_accounts:
            try:
                txs = requests.get(f"{API_URL}/accounts/{acc['id']}/transactions", timeout=10).json()
                for t in txs:
                    if t["date"][:7] == current_month_str:
                        if t["amount"] < 0:
                            checking_expenses += abs(t["amount"])
                            cat = t.get("category") or "Other"
                            category_totals[cat] += abs(t["amount"])
                        elif t["amount"] > 0:
                            checking_income += t["amount"]
            except:
                pass

        # ── 💰 INCOME ──────────────────────────────────────────────
        st.markdown("#### 💰 Income")
        if income_rec:
            for e in income_rec:
                valid_str = ""
                if e.get("valid_until"):
                    try:
                        vd = datetime.fromisoformat(e["valid_until"]).strftime("%b %d, %Y")
                        valid_str = f' <span style="color:#f0a500;font-size:11px">until {vd}</span>'
                    except:
                        pass
                st.markdown(
                    f'<div style="display:flex;justify-content:space-between;padding:6px 0;'
                    f'border-bottom:1px solid rgba(128,128,128,0.1)">'
                    f'<span>📈 {e["name"]}{valid_str} <span style="color:#888;font-size:11px">(day {e["due_day"]})</span></span>'
                    f'<span style="color:#2ecc71;font-weight:600">+ {symbol} {fmt(e["amount"], currency)}</span>'
                    f'</div>',
                    unsafe_allow_html=True
                )
            st.markdown(
                f'<div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700">'
                f'<span>Total Income</span>'
                f'<span style="color:#2ecc71">+ {symbol} {fmt(total_rec_income, currency)}</span>'
                f'</div>',
                unsafe_allow_html=True
            )
        else:
            st.caption("No recurring income registered.")

        st.markdown("<br>", unsafe_allow_html=True)

        # ── 💸 EXPENSES ────────────────────────────────────────────
        st.markdown("#### 💸 Expenses")

         if card_charges > 0:
            st.markdown(
                f'<div style="display:flex;justify-content:space-between;padding:6px 0;'
                f'border-bottom:1px solid rgba(128,128,128,0.1)">'
                f'<span style="font-weight:600">💳 Card charges</span>'
                f'<span style="color:#e05a5a;font-weight:600">- {symbol} {fmt(card_charges, currency)}</span>'
                f'</div>',
                unsafe_allow_html=True
            )
            # Linha por cartão (sem expander)
            for card_name, amount in card_breakdown.items():
                st.markdown(
                    f'<div style="display:flex;justify-content:space-between;padding:4px 0 4px 16px;'
                    f'border-bottom:1px solid rgba(128,128,128,0.07)">'
                    f'<span style="color:#888;font-size:13px">↳ {card_name}</span>'
                    f'<span style="color:#e05a5a;font-size:13px">- {symbol} {fmt(amount, currency)}</span>'
                    f'</div>',
                    unsafe_allow_html=True
                )
 
        if expense_rec:
            for e in expense_rec:
                valid_str = ""
                if e.get("valid_until"):
                    try:
                        vd = datetime.fromisoformat(e["valid_until"]).strftime("%b %d, %Y")
                        valid_str = f' <span style="color:#f0a500;font-size:11px">until {vd}</span>'
                    except:
                        pass
                st.markdown(
                    f'<div style="display:flex;justify-content:space-between;padding:6px 0;'
                    f'border-bottom:1px solid rgba(128,128,128,0.1)">'
                    f'<span>🔄 {e["name"]}{valid_str} <span style="color:#888;font-size:11px">(day {e["due_day"]})</span></span>'
                    f'<span style="color:#e05a5a;font-weight:600">- {symbol} {fmt(e["amount"], currency)}</span>'
                    f'</div>',
                    unsafe_allow_html=True
                )
 
        total_expenses = card_charges + total_rec_expense
        st.markdown(
            f'<div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700">'
            f'<span>Total Expenses</span>'
            f'<span style="color:#e05a5a">- {symbol} {fmt(total_expenses, currency)}</span>'
            f'</div>',
            unsafe_allow_html=True
        )
 
        st.markdown("<br>", unsafe_allow_html=True)
 
        # CHANGE 2: Balance — In Bank + Income - Expenses (cálculo correto)
        st.markdown("#### 📊 Balance")
        balance = account_balance + total_rec_income - total_expenses
 
        c1, c2 = st.columns(2)
        with c1:
            st.metric("🏦 In Bank", f"{symbol} {fmt(account_balance, currency)}")
        with c2:
            st.metric(
                "📊 Balance",
                f"{symbol} {fmt(balance, currency)}",
                delta=f"{'+ ' if balance >= 0 else ''}{symbol} {fmt(balance, currency)}",
                delta_color="normal" if balance >= 0 else "inverse"
            )
        st.caption(
            f"In Bank ({symbol} {fmt(account_balance, currency)}) "
            f"+ Income ({symbol} {fmt(total_rec_income, currency)}) "
            f"− Expenses ({symbol} {fmt(total_expenses, currency)}) "
            f"= {symbol} {fmt(balance, currency)}"
        )

        if checking_expenses > 0 or checking_income > 0:
            with st.expander("🏦 Chequing transactions (already deducted from bank balance)"):
                st.caption("These are debit transactions already paid — not added to balance calculation.")
                col1, col2 = st.columns(2)
                with col1:
                    st.metric("Spent", f"{symbol} {fmt(checking_expenses, currency)}")
                with col2:
                    st.metric("Received", f"{symbol} {fmt(checking_income, currency)}")
                if category_totals:
                    st.write("**By category:**")
                    for cat, amount in sorted(category_totals.items(), key=lambda x: -x[1]):
                        st.write(f"  • {cat}: {symbol} {fmt(amount, currency)}")

        st.divider()

# ─────────────────────────────────────────────────────────────────
elif page == "Spending Analysis":
    import plotly.express as px
    import plotly.graph_objects as go

    st.header("📈 Spending Analysis")

    try:
        data = requests.get(f"{API_URL}/spending-analysis", timeout=15).json()
    except:
        data = {}

    if not data:
        st.info("No spending data yet. Import some transactions first!")
    else:
        months_available = sorted(data.keys(), reverse=True)
        month_labels = {m: datetime.strptime(m, "%Y-%m").strftime("%B %Y") for m in months_available}

        selected_month = st.selectbox(
            "Select month",
            months_available,
            format_func=lambda m: month_labels[m]
        )
        st.divider()

        month_data = data.get(selected_month, {})
        categories = []
        totals = []
        for cat, vals in month_data.items():
            total = vals.get("cards", 0) + vals.get("debit", 0)
            if total > 0:
                categories.append(cat)
                totals.append(round(total, 2))

        if not categories:
            st.info("No expenses for this month.")
        else:
            color_palette = px.colors.qualitative.Set3
            color_map = {cat: color_palette[i % len(color_palette)] for i, cat in enumerate(categories)}

            cat_sorted = sorted(
                [(cat, round(month_data[cat].get("cards", 0) + month_data[cat].get("debit", 0), 2))
                 for cat in categories],
                key=lambda x: -x[1]
            )
            grand_total = sum(t for _, t in cat_sorted)

            accounts = get_accounts()

            if "sa_transactions_cache" not in st.session_state:
                st.session_state["sa_transactions_cache"] = {}

            def get_account_txs(account_id):
                if account_id not in st.session_state["sa_transactions_cache"]:
                    try:
                        r = requests.get(f"{API_URL}/accounts/{account_id}/transactions", timeout=15)
                        st.session_state["sa_transactions_cache"][account_id] = r.json() if r.status_code == 200 else []
                    except:
                        st.session_state["sa_transactions_cache"][account_id] = []
                return st.session_state["sa_transactions_cache"][account_id]

            def get_txs_for_month_category(sel_month, category):
                results = []
                excluded_cats = {"Salary", "Other Income", "Transfer"}
                if category in excluded_cats:
                    return results
                for acc in accounts:
                    txs = get_account_txs(acc["id"])
                    is_card = acc["account_type"] == "CREDIT_CARD"
                    for t in txs:
                        if float(t.get("amount", 0)) >= 0:
                            continue
                        if (t.get("category") or "Other") != category:
                            continue
                        if is_card:
                            if t.get("statement_month") == sel_month:
                                results.append({**t, "_account_name": acc["name"], "_is_card": True})
                        else:
                            if t["date"][:7] == sel_month:
                                results.append({**t, "_account_name": acc["name"], "_is_card": False})
                results.sort(key=lambda x: x["date"], reverse=True)
                return results

            col_chart, col_list = st.columns([1.1, 0.9], gap="large")

            with col_chart:
                fig = px.pie(
                    names=categories,
                    values=totals,
                    hole=0.4,
                    color_discrete_sequence=color_palette,
                )
                fig.update_traces(textposition="inside", textinfo="percent+label")
                fig.update_layout(
                    showlegend=False,
                    margin=dict(t=10, b=10, l=10, r=10),
                    height=460,
                )
                st.plotly_chart(fig, use_container_width=True)

                if st.button("🔄 Refresh", key="sa_refresh", help="Reload transaction data"):
                    st.session_state["sa_transactions_cache"] = {}
                    st.rerun()

            with col_list:
                st.markdown("""
                <style>
                div[data-testid="stExpander"] { margin-bottom: 4px !important; }
                div[data-testid="stExpander"] summary { padding: 6px 10px !important; }
                </style>
                """, unsafe_allow_html=True)

                all_cats_list = get_categories()

                for cat, total in cat_sorted:
                    pct = round(total / grand_total * 100, 1) if grand_total else 0
                    color = color_map.get(cat, "#aaa")
                    dot_html = f'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{color};margin-right:6px;vertical-align:middle"></span>'
                    label = f"{cat} — CAD$ {fmt(total, 'CAD')} · {pct}%"

                    with st.expander(label):
                        st.markdown(
                            f'{dot_html}<strong>{cat}</strong> &nbsp;·&nbsp; CAD$ {fmt(total, "CAD")} &nbsp;·&nbsp; {pct}%',
                            unsafe_allow_html=True
                        )
                        st.markdown("---")

                        txs = get_txs_for_month_category(selected_month, cat)

                        if not txs:
                            st.caption("No transactions found for this category.")
                        else:
                            cat_running = 0.0
                            for t in txs:
                                amt = abs(float(t["amount"]))
                                cat_running += amt
                                raw_date = t.get("date", "")
                                try:
                                    date_fmt = datetime.fromisoformat(raw_date).strftime("%b %d")
                                except:
                                    date_fmt = raw_date[:10]

                                icon = "💳" if t.get("_is_card") else "🏦"

                                r1, r2, r3 = st.columns([1, 2.8, 1.2])
                                with r1:
                                    st.markdown(f'<span style="color:#888;font-size:11px">{date_fmt}</span>', unsafe_allow_html=True)
                                with r2:
                                    st.markdown(f'<span style="font-size:12px">{t.get("description","—")}</span>', unsafe_allow_html=True)
                                with r3:
                                    st.markdown(f'<span style="font-weight:600;color:#e05a5a;font-size:12px">$ {fmt(amt,"CAD")}</span>', unsafe_allow_html=True)

                                edit_key = f"cat_edit_{t['id']}"
                                save_key = f"cat_save_{t['id']}"
                                current_cat = t.get("category") or "Other"
                                try:
                                    default_idx = all_cats_list.index(current_cat)
                                except ValueError:
                                    default_idx = 0

                                re1, re2 = st.columns([3, 1])
                                with re1:
                                    new_cat = st.selectbox("Category", all_cats_list, index=default_idx, key=edit_key, label_visibility="collapsed")
                                with re2:
                                    if st.button("Save", key=save_key, use_container_width=True):
                                        try:
                                            r = requests.patch(f"{API_URL}/transactions/{t['id']}", json={"category": new_cat}, timeout=10)
                                            if r.status_code in [200, 201]:
                                                acc_id = t.get("account_id")
                                                if acc_id and acc_id in st.session_state["sa_transactions_cache"]:
                                                    del st.session_state["sa_transactions_cache"][acc_id]
                                                st.success("✅ Saved!")
                                                st.rerun()
                                            else:
                                                st.error("Failed to save.")
                                        except Exception as e:
                                            st.error(f"Error: {e}")

                                st.markdown('<hr style="margin:4px 0;opacity:0.15">', unsafe_allow_html=True)

                            st.caption(f"**{len(txs)} transactions · CAD$ {fmt(cat_running, 'CAD')}**")

        st.divider()

        st.subheader("📊 Category Trends")
        all_months_sorted = sorted(data.keys())
        n_months = st.slider("Number of months to compare", min_value=1, max_value=len(all_months_sorted), value=min(3, len(all_months_sorted)))
        months_to_show = all_months_sorted[-n_months:]
        all_cats_bar = sorted(set(cat for m in months_to_show for cat in data.get(m, {}).keys()))

        bar_rows = []
        for m in months_to_show:
            label = datetime.strptime(m, "%Y-%m").strftime("%b %Y")
            for cat in all_cats_bar:
                cards_val = data.get(m, {}).get(cat, {}).get("cards", 0)
                debit_val = data.get(m, {}).get(cat, {}).get("debit", 0)
                total_val = round(cards_val + debit_val, 2)
                if total_val > 0:
                    bar_rows.append({"Month": label, "Category": cat, "Amount": total_val})

        if bar_rows:
            df_bar = pd.DataFrame(bar_rows)
            cat_totals = df_bar.groupby("Category")["Amount"].sum().sort_values(ascending=False)
            cat_order = cat_totals.index.tolist()
            fig_bar = px.bar(df_bar, x="Category", y="Amount", color="Month", barmode="group",
                category_orders={"Category": cat_order},
                title=f"Spending by Category — Last {n_months} month{'s' if n_months > 1 else ''}",
                color_discrete_sequence=px.colors.qualitative.Set2,
                labels={"Amount": "CAD$", "Category": ""},
            )
            fig_bar.update_layout(xaxis_tickangle=-35, legend_title="Month", margin=dict(t=50, b=80, l=20, r=20), height=420)
            st.plotly_chart(fig_bar, use_container_width=True)
        else:
            st.info("No data for the selected months.")

        st.divider()

        st.subheader("📋 Category Breakdown by Month")
        all_cats = sorted(set(cat for month in data.values() for cat in month.keys()))
        all_months = sorted(data.keys())

        rows = []
        for cat in all_cats:
            row = {"Category": cat}
            cat_total = 0
            for m in all_months:
                cards_val = data.get(m, {}).get(cat, {}).get("cards", 0)
                debit_val = data.get(m, {}).get(cat, {}).get("debit", 0)
                total_val = round(cards_val + debit_val, 2)
                label = datetime.strptime(m, "%Y-%m").strftime("%b %Y")
                row[label] = total_val if total_val > 0 else ""
                cat_total += total_val
            row["Total"] = round(cat_total, 2) if cat_total > 0 else ""
            rows.append(row)

        totals_row = {"Category": "💰 TOTAL"}
        grand_total = 0
        for m in all_months:
            m_total = sum(data.get(m, {}).get(cat, {}).get("cards", 0) + data.get(m, {}).get(cat, {}).get("debit", 0) for cat in all_cats)
            label = datetime.strptime(m, "%Y-%m").strftime("%b %Y")
            totals_row[label] = round(m_total, 2)
            grand_total += m_total
        totals_row["Total"] = round(grand_total, 2)
        rows.append(totals_row)

        df_table = pd.DataFrame(rows)
        col_config = {"Category": st.column_config.TextColumn("Category", width="medium")}
        for m in all_months:
            label = datetime.strptime(m, "%Y-%m").strftime("%b %Y")
            col_config[label] = st.column_config.NumberColumn(label, format="$ %.2f")
        col_config["Total"] = st.column_config.NumberColumn("Total", format="$ %.2f")
        st.dataframe(df_table, use_container_width=True, height=min(50 + len(rows) * 35, 600), column_config=col_config,
            column_order=["Category"] + [datetime.strptime(m, "%Y-%m").strftime("%b %Y") for m in all_months] + ["Total"])
        st.caption(f"Grand total: CAD$ {fmt(grand_total, 'CAD')}")

# ─────────────────────────────────────────────────────────────────
elif page == "Categories":
    st.header("🏷️ Categories")
    st.caption("Manage your spending categories. Default categories (🔒) cannot be deleted.")
    try:
        cats_resp = requests.get(f"{API_URL}/categories", timeout=10)
        cats = cats_resp.json() if cats_resp.status_code == 200 else []
        if cats and isinstance(cats[0], str):
            st.info("Categories are being migrated. Please redeploy the API.")
            cats = []
    except:
        cats = []

    expense_cats = [c for c in cats if isinstance(c, dict) and c.get("type") == "EXPENSE"]
    income_cats = [c for c in cats if isinstance(c, dict) and c.get("type") == "INCOME"]
    transfer_cats = [c for c in cats if isinstance(c, dict) and c.get("type") == "TRANSFER"]

    for section_label, section_cats in [("💸 Expense", expense_cats), ("💰 Income", income_cats), ("↔️ Transfer", transfer_cats)]:
        if section_cats:
            st.subheader(section_label)
            for c in section_cats:
                col1, col2 = st.columns([6, 1])
                with col1:
                    badge = "🔒" if c["is_default"] else "✏️"
                    st.write(f"{badge} {c['name']}")
                with col2:
                    if not c["is_default"]:
                        if st.button("🗑️", key=f"del_cat_{c['id']}"):
                            r = requests.delete(f"{API_URL}/categories/{c['id']}", timeout=10)
                            if r.status_code == 200:
                                st.success(f"Deleted {c['name']}!")
                                st.rerun()
            st.divider()

    st.subheader("➕ Add New Category")
    with st.form("new_category"):
        new_name = st.text_input("Category name", placeholder="e.g. Rent, Groceries, Pet")
        new_type = st.selectbox("Type", ["EXPENSE", "INCOME", "TRANSFER"])
        if st.form_submit_button("Add Category"):
            if not new_name.strip():
                st.error("Name cannot be empty.")
            else:
                r = requests.post(f"{API_URL}/categories", json={"name": new_name.strip(), "type": new_type}, timeout=10)
                if r.status_code == 200:
                    st.success(f"Category '{new_name}' added!")
                    st.rerun()
                elif r.status_code == 400:
                    st.warning("Category already exists.")
                else:
                    st.error(f"Error: {r.text}")

# ─────────────────────────────────────────────────────────────────
elif page == "Card Summary":
    st.header("💳 Card Summary")
    accounts = get_accounts()
    cards = [a for a in accounts if a["account_type"] == "CREDIT_CARD"]
    if not cards:
        st.info("No credit cards registered.")
    else:
        selected_card = st.selectbox("Select card", [f"{c['id']} | {c['name']} ({c['bank']})" for c in cards])
        card_id = int(selected_card.split("|")[0].strip())
        card = next(c for c in cards if c["id"] == card_id)
        st.divider()
        try:
            summary = requests.get(f"{API_URL}/accounts/{card_id}/statement-summary", timeout=10).json()
            if not summary:
                st.info("No transactions imported yet for this card.")
            else:
                due_groups = defaultdict(float)
                for month, data in summary.items():
                    due = data.get("payment_due_date", "")[:10]
                    if due:
                        due_groups[due] += data.get("charges", 0)
                st.subheader("💰 Upcoming Payments")
                for due_date, total in sorted(due_groups.items()):
                    st.metric(f"Due {due_date}", f"CAD$ {fmt(total,'CAD')}")
                st.divider()
                st.subheader("📅 By Statement Period")
                for month, data in sorted(summary.items(), reverse=True):
                    due = data.get("payment_due_date", "")[:10] if data.get("payment_due_date") else "—"
                    total = data.get("charges", 0)
                    col1, col2, col3 = st.columns(3)
                    with col1:
                        st.metric(f"📅 {month}", f"CAD$ {fmt(total,'CAD')}")
                    with col2:
                        st.caption(f"Transactions: {data['count']}")
                    with col3:
                        st.caption(f"Due: {due}")
                    if st.button(f"View transactions — {month}", key=f"view_{month}"):
                        st.session_state["current_page"] = "Transactions"
                        st.session_state["nav_account_id"] = card_id
                        st.session_state["nav_month"] = month
                        st.rerun()
        except Exception as e:
            st.error(f"Error loading summary: {e}")

# ─────────────────────────────────────────────────────────────────
elif page == "Transactions":
    st.header("💸 Transactions")
    accounts = get_accounts()
    if not accounts:
        st.info("No accounts yet.")
    else:
        default_acc_idx = 0
        default_month = f"{date.today().year}-{date.today().month:02d}"
        nav_id = st.session_state.pop("nav_account_id", None)
        default_month = st.session_state.pop("nav_month", default_month)
        if nav_id:
            ids = [a["id"] for a in accounts]
            if nav_id in ids:
                default_acc_idx = ids.index(nav_id)
        selected = st.selectbox(
            "Select account or card",
            [f"{a['id']} | {a['name']} ({a['bank']}) — {'Card' if a['account_type']=='CREDIT_CARD' else 'Account'}" for a in accounts],
            index=default_acc_idx
        )
        acc_id = int(selected.split("|")[0].strip())
        acc = next(a for a in accounts if a["id"] == acc_id)
        is_card = acc["account_type"] == "CREDIT_CARD"
        col_f1, col_f2 = st.columns(2)
        with col_f1:
            if is_card:
                month_filter = st.text_input("Filter by statement month (e.g. 2026-04)", value=default_month)
            else:
                month_filter = st.text_input("Filter by month (e.g. 2026-04, leave empty for all)", value="")
        st.divider()
        try:
            txs = requests.get(f"{API_URL}/accounts/{acc_id}/transactions", timeout=10).json()
            if is_card and month_filter:
                txs = [t for t in txs if t.get("statement_month") == month_filter]
            elif not is_card and month_filter:
                txs = [t for t in txs if t.get("date", "")[:7] == month_filter]
            if not txs:
                st.info("No transactions found.")
            else:
                cols_to_show = ["id", "date", "description", "amount", "category", "statement_month"] if is_card else ["id", "date", "description", "amount", "category"]
                df = pd.DataFrame(txs)[cols_to_show]
                df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
                edited = st.data_editor(
                    df,
                    column_config={
                        "id": st.column_config.NumberColumn("ID", width="small"),
                        "date": st.column_config.TextColumn("Date", width="small"),
                        "description": st.column_config.TextColumn("Description", width="large"),
                        "amount": st.column_config.NumberColumn("Amount", format="%.2f", width="small"),
                        "category": st.column_config.SelectboxColumn("Category", options=get_categories(), width="medium"),
                        "statement_month": st.column_config.TextColumn("Statement", width="small"),
                    },
                    use_container_width=True, num_rows="fixed", height=400
                )
                col1, col2 = st.columns(2)
                with col1:
                    if st.button("💾 Save category changes", type="primary"):
                        updated = 0
                        for _, row in edited.iterrows():
                            orig = next((t for t in txs if t["id"] == row["id"]), None)
                            if orig and orig["category"] != row["category"]:
                                requests.patch(f"{API_URL}/transactions/{row['id']}", json={"category": row["category"]}, timeout=10)
                                updated += 1
                        st.success(f"Updated {updated} transactions!")
                with col2:
                    if is_card:
                        charges = sum(abs(t["amount"]) for t in txs if t["amount"] < 0)
                        payments = sum(t["amount"] for t in txs if t["amount"] > 0)
                        st.metric("Total Charges", f"CAD$ {fmt(charges,'CAD')}")
                        if payments > 0:
                            st.caption(f"Payments: CAD$ {fmt(payments,'CAD')}")
                    else:
                        expenses = sum(abs(t["amount"]) for t in txs if t["amount"] < 0)
                        income = sum(t["amount"] for t in txs if t["amount"] > 0)
                        st.metric("💸 Spent", f"CAD$ {fmt(expenses,'CAD')}")
                        if income > 0:
                            st.metric("💰 Received", f"CAD$ {fmt(income,'CAD')}")
        except Exception as e:
            st.error(f"Error: {e}")

# ─────────────────────────────────────────────────────────────────
elif page == "Accounts":
    st.header("🏦 Bank Accounts")
    accounts = [a for a in get_accounts() if a["account_type"] != "CREDIT_CARD"]
    for a in accounts:
        col1, col2, col3 = st.columns([4, 1, 1])
        with col1:
            st.write(f"**{a['name']}** — {a['bank']} | {a['currency']} {fmt(a['balance'],a['currency'])}")
        with col2:
            if st.button("✏️", key=f"edit_{a['id']}"):
                st.session_state[f"editing_{a['id']}"] = True
        with col3:
            if st.button("🗑️", key=f"del_{a['id']}"):
                r = delete_data("accounts", a["id"])
                if r is not None and r.status_code in [200, 204]:
                    st.success("Deleted!")
                    st.rerun()
        if st.session_state.get(f"editing_{a['id']}"):
            new_bal = st.number_input(f"New balance for {a['name']}", value=float(a["balance"]), key=f"bal_{a['id']}")
            if st.button(f"Save", key=f"save_{a['id']}"):
                patch_account(a["id"], {"balance": new_bal})
                st.session_state.pop(f"editing_{a['id']}", None)
                st.success("Balance updated!")
                st.rerun()
    if accounts:
        st.divider()
    with st.form("new_account"):
        name = st.text_input("Account name")
        bank = st.text_input("Bank")
        atype = st.selectbox("Type", ["CHECKING", "SAVINGS"])
        currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
        balance = st.number_input("Initial balance", value=0.0)
        if st.form_submit_button("Add Account"):
            r = post_data("accounts", {"name": name, "bank": bank, "account_type": atype, "currency": currency,
                                       "balance": balance, "credit_limit": None, "closing_day": None, "due_day": None})
            if r is not None and r.status_code in [200, 201]:
                st.success("Account created!")
                st.rerun()
            else:
                st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

# ─────────────────────────────────────────────────────────────────
elif page == "Credit Cards":
    st.header("💳 Credit Cards")
    cards = [a for a in get_accounts() if a["account_type"] == "CREDIT_CARD"]
    for c in cards:
        col1, col2 = st.columns([6, 1])
        with col1:
            st.write(f"**{c['name']}** — {c['bank']} | {c['currency']} | Limit: {fmt(c['credit_limit'],c['currency'])} | Closes: day {c['closing_day']} | Due: day {c['due_day']}")
        with col2:
            if st.button("🗑️", key=f"del_card_{c['id']}"):
                r = delete_data("accounts", c["id"])
                if r is not None and r.status_code in [200, 204]:
                    st.success("Deleted!")
                    st.rerun()
    if cards:
        st.divider()
    with st.form("new_card"):
        name = st.text_input("Card name")
        bank = st.text_input("Bank")
        currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
        limit = st.number_input("Credit limit", value=0.0)
        current_balance = st.number_input("Current balance (amount you already owe)", value=0.0, min_value=0.0)
        closing = st.number_input("Closing day", min_value=1, max_value=31, value=1)
        due = st.number_input("Due day", min_value=1, max_value=31, value=10)
        if st.form_submit_button("Add Credit Card"):
            r = post_data("accounts", {"name": name, "bank": bank, "account_type": "CREDIT_CARD", "currency": currency,
                                       "balance": current_balance, "credit_limit": limit,
                                       "closing_day": int(closing), "due_day": int(due)})
            if r is not None and r.status_code in [200, 201]:
                st.success("Card created!")
                st.rerun()
            else:
                st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

# ─────────────────────────────────────────────────────────────────
elif page == "Recurring Expenses":
    st.header("🔄 Recurring Expenses & Income")
    expenses = get_recurring()
    income_list = [e for e in expenses if e.get("type") == "INCOME"]
    expense_list = [e for e in expenses if e.get("type") != "INCOME"]

    if income_list:
        st.subheader("💰 Income")
        for e in income_list:
            col1, col2 = st.columns([6, 1])
            with col1:
                valid_str = f" | Until: {e['valid_until'][:10]}" if e.get("valid_until") else ""
                st.write(f"**{e['name']}** — {e['currency']} {fmt(e['amount'],e['currency'])} | Receive: day {e['due_day']} | {e['category'] or 'No category'}{valid_str}")
            with col2:
                if st.button("🗑️", key=f"del_inc_{e['id']}"):
                    delete_data("recurring-expenses", e["id"])
                    st.rerun()
        st.divider()

    if expense_list:
        st.subheader("💸 Expenses")
        for e in expense_list:
            col1, col2 = st.columns([6, 1])
            with col1:
                valid_str = f" | Until: {e['valid_until'][:10]}" if e.get("valid_until") else ""
                st.write(f"**{e['name']}** — {e['currency']} {fmt(e['amount'],e['currency'])} | Due: day {e['due_day']} | {e['category'] or 'No category'}{valid_str}")
            with col2:
                if st.button("🗑️", key=f"del_exp_{e['id']}"):
                    delete_data("recurring-expenses", e["id"])
                    st.rerun()
        st.divider()

    tab1, tab2 = st.tabs(["➕ Add Expense", "➕ Add Income"])
    with tab1:
        with st.form("new_expense"):
            name = st.text_input("Name", placeholder="e.g. Rent, Netflix")
            amount = st.number_input("Amount", value=0.0, min_value=0.0)
            currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
            due = st.number_input("Due day", min_value=1, max_value=31, value=1)
            category = st.selectbox("Category", get_categories())
            valid_until = st.date_input(
                "Valid until (optional — leave as-is if ongoing)",
                value=None,
                help="Set a date if this expense will stop. It will disappear automatically after this date."
            )
            if st.form_submit_button("Add Expense"):
                payload = {"name": name, "amount": amount, "currency": currency,
                           "due_day": int(due), "category": category, "type": "EXPENSE",
                           "valid_until": valid_until.isoformat() if valid_until else None}
                r = post_data("recurring-expenses", payload)
                if r is not None and r.status_code in [200, 201]:
                    st.success("Expense added!")
                    st.rerun()
                else:
                    st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

    with tab2:
        with st.form("new_income"):
            name = st.text_input("Name", placeholder="e.g. Doug Salary, Vida Salary")
            amount = st.number_input("Amount", value=0.0, min_value=0.0)
            currency = st.selectbox("Currency", ["BRL", "CAD", "USD", "EUR"])
            due = st.number_input("Receive day", min_value=1, max_value=31, value=1)
            category = st.selectbox("Category", ["Salary", "Other Income", "Transfer", "Other"])
            valid_until = st.date_input(
                "Valid until (optional — leave as-is if ongoing)",
                value=None,
                help="Set a date if this income will change or stop. It will disappear automatically after this date."
            )
            if st.form_submit_button("Add Income"):
                payload = {"name": name, "amount": amount, "currency": currency,
                           "due_day": int(due), "category": category, "type": "INCOME",
                           "valid_until": valid_until.isoformat() if valid_until else None}
                r = post_data("recurring-expenses", payload)
                if r is not None and r.status_code in [200, 201]:
                    st.success("Income added!")
                    st.rerun()
                else:
                    st.error(f"Error {r.status_code if r else 'None'}: {r.text if r else 'No response'}")

# ─────────────────────────────────────────────────────────────────
elif page == "Import Statement":
    st.header("📂 Import Bank Statement")
    st.caption("Supports RBC (Chequing & Credit), Amex (CSV and XLS/XLSX), and BMO CSV.")
    accounts = get_accounts()
    if not accounts:
        st.warning("Please create an account first.")
    else:
        with st.expander("🗂️ Import History — view and delete past imports"):
            imports = get_imports()
            if not imports:
                st.info("No imports found.")
            else:
                for imp in imports:
                    col1, col2, col3 = st.columns([5, 1, 1])
                    with col1:
                        st.write(f"**{imp['account_name']}** — {imp['transaction_count']} transactions ({imp['first_date']} → {imp['last_date']}) · imported {imp['imported_at']}")
                    with col2:
                        if st.button("🗑️ All", key=f"del_batch_{imp['import_batch_id']}"):
                            r = requests.delete(f"{API_URL}/imports/{imp['import_batch_id']}", timeout=15)
                            if r and r.status_code == 200:
                                st.success(f"Deleted {imp['transaction_count']} transactions!")
                                st.rerun()
                            else:
                                st.error("Error deleting batch.")
                    with col3:
                        if st.button("👁️ View", key=f"view_batch_{imp['import_batch_id']}"):
                            st.session_state["current_page"] = "Transactions"
                            st.session_state["nav_account_id"] = imp["account_id"]
                            st.rerun()
            st.divider()

        col1, col2 = st.columns(2)
        with col1:
            account_options = [
                f"{a['id']} | {a['name']} ({a['currency']}) — {'Credit Card' if a['account_type']=='CREDIT_CARD' else 'Chequing/Savings'}"
                for a in accounts
            ]
            selected_account = st.selectbox("Select account to import into", account_options)
            account_id = int(selected_account.split("|")[0].strip())
            selected_acc = next(a for a in accounts if a["id"] == account_id)
            is_credit = selected_acc["account_type"] == "CREDIT_CARD"
        with col2:
            from_date = st.date_input("Import transactions from", value=date.today().replace(day=1))
        st.divider()

        if "reconcile_acc_id" in st.session_state:
            r_acc_id = st.session_state["reconcile_acc_id"]
            r_acc = next((a for a in accounts if a["id"] == r_acc_id), None)
            auto_balance = st.session_state.get("reconcile_new_balance", float(r_acc["balance"]) if r_acc else 0.0)
            st.subheader("💰 Confirm Account Balance")
            st.caption("We calculated the new balance automatically. Please confirm or correct it.")
            if r_acc:
                st.write(f"Account: **{r_acc['name']}**")
            st.info(f"Calculated new balance: **CAD$ {fmt(auto_balance,'CAD')}**")
            new_bal = st.number_input("Confirm or correct balance:", value=auto_balance, key="new_bal_input")
            col_a, col_b = st.columns(2)
            with col_a:
                if st.button("✅ Update balance", type="primary"):
                    patch_account(r_acc_id, {"balance": new_bal})
                    st.success(f"✅ Balance updated to CAD$ {fmt(new_bal,'CAD')}!")
                    del st.session_state["reconcile_acc_id"]
                    st.rerun()
            with col_b:
                if st.button("Skip"):
                    del st.session_state["reconcile_acc_id"]
                    st.rerun()
            st.divider()

        uploaded = st.file_uploader("📁 Upload statement file (CSV, XLS, or XLSX)", type=["csv", "xls", "xlsx"])
        if uploaded:
            try:
                df, bank_detected = parse_statement(uploaded, from_date)
                if df is None:
                    st.error(bank_detected)
                elif df.empty:
                    st.warning("No transactions found after the selected date.")
                else:
                    try:
                        last_tx = requests.get(f"{API_URL}/accounts/{account_id}/last-transaction", timeout=10).json()
                        last_date = last_tx.get("last_date")
                        if last_date:
                            last_dt = pd.Timestamp(last_date)
                            new_df = df[pd.to_datetime(df["date"]) > last_dt]
                            st.info(f"📅 Last transaction: **{last_dt.strftime('%b %d, %Y')}**. Found **{len(new_df)} new transactions** out of {len(df)}.")
                            df = new_df
                        else:
                            st.info("No previous transactions found. Showing all transactions.")
                    except:
                        pass
                    if df.empty:
                        st.success("✅ All transactions already registered!")
                    else:
                        st.success(f"✅ **{bank_detected}** — **{len(df)} new transactions**")
                        st.dataframe(df, use_container_width=True)
                        st.divider()
                        if st.button("🤖 Analyze with AI", type="primary"):
                            with st.spinner("AI is reading and categorizing... (15-30 seconds)"):
                                recurring = get_recurring()
                                recurring_names = [e["name"] for e in recurring]
                                account_type_hint = "credit card" if is_credit else "chequing/debit"
                                credit_note = (
                                    "IMPORTANT: This is a credit card statement. "
                                    "Payments like 'Payment - Thank You' or 'PAYMENT RECEIVED' must be categorized as 'Transfer'. "
                                    "Focus on categorizing actual purchases."
                                ) if is_credit else ""
                                prompt = f"""You are a financial assistant analyzing a Canadian bank statement ({selected_acc['bank']} {account_type_hint}, {bank_detected}).
{credit_note}

Transactions:
{df.to_csv(index=False)}

Recurring expenses already registered: {recurring_names}

Return a JSON array. Each item must have:
- "date": original date string
- "description": clean merchant name (remove codes like "CONTACTLESS INTERAC PURCHASE - 1234 ")
- "amount": numeric (negative = expense, positive = income/payment)
- "category": one of: {", ".join(get_categories())}
- "is_recurring": true if matches known recurring or clearly a regular bill
- "recurring_match": matching recurring name or null

Return ONLY the JSON array, no markdown."""
                                try:
                                    resp = requests.post(
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
                                    ai_text = resp.json()["content"][0]["text"]
                                    analyzed = json.loads(ai_text)
                                    st.session_state["analyzed"] = analyzed
                                    st.session_state["import_account_id"] = account_id
                                    st.session_state["import_is_credit"] = is_credit
                                    st.rerun()
                                except Exception as e:
                                    st.error(f"AI error: {e}")
                                    st.write(resp.json() if "resp" in locals() else "No response")
            except Exception as e:
                st.error(f"Error reading file: {e}")

        if "analyzed" in st.session_state:
            analyzed = st.session_state["analyzed"]
            acc_id = st.session_state["import_account_id"]
            is_credit_import = st.session_state.get("import_is_credit", False)
            st.subheader(f"📋 Review & Confirm ({len(analyzed)} transactions)")
            st.caption("Edit any field before importing.")
            edited = st.data_editor(
                analyzed,
                column_config={
                    "date": st.column_config.TextColumn("Date", width="small"),
                    "description": st.column_config.TextColumn("Description", width="large"),
                    "amount": st.column_config.NumberColumn("Amount", format="%.2f", width="small"),
                    "category": st.column_config.SelectboxColumn("Category", options=get_categories(), width="medium"),
                    "is_recurring": st.column_config.CheckboxColumn("Recurring?", width="small"),
                    "recurring_match": st.column_config.TextColumn("Match", width="medium"),
                },
                use_container_width=True, num_rows="fixed", height=400
            )
            total_expenses = abs(sum(t["amount"] for t in analyzed if t["amount"] < 0))
            total_income = sum(t["amount"] for t in analyzed if t["amount"] > 0)
            if is_credit_import:
                st.info("💳 Credit card import — payments are categorized as Transfer.")
                st.metric("Total charges this period", f"CAD$ {fmt(total_expenses,'CAD')}")
            else:
                col1, col2 = st.columns(2)
                with col1:
                    st.metric("Total Expenses", f"CAD$ {fmt(total_expenses,'CAD')}")
                with col2:
                    st.metric("Total Income", f"CAD$ {fmt(total_income,'CAD')}")
            st.divider()
            col1, col2 = st.columns(2)
            with col1:
                if st.button("✅ Import All Transactions", type="primary"):
                    success = 0
                    errors = 0
                    batch_id = str(uuid.uuid4())
                    with st.spinner("Importing..."):
                        for t in edited:
                            try:
                                date_obj = None
                                for fmt_str in ["%m/%d/%Y", "%Y%m%d", "%d %b. %Y", "%d/%m/%Y", "%Y-%m-%d"]:
                                    try:
                                        date_obj = datetime.strptime(str(t["date"]).strip(), fmt_str)
                                        break
                                    except:
                                        continue
                                if not date_obj:
                                    errors += 1
                                    continue
                                r = post_data("transactions", {
                                    "account_id": acc_id,
                                    "description": t["description"],
                                    "amount": float(t["amount"]),
                                    "currency": selected_acc.get("currency", "CAD"),
                                    "date": date_obj.strftime("%Y-%m-%dT%H:%M:%S"),
                                    "category": t["category"],
                                    "import_batch_id": batch_id,
                                })
                                if r and r.status_code in [200, 201]:
                                    success += 1
                                else:
                                    errors += 1
                            except Exception as e:
                                errors += 1
                    st.success(f"✅ Imported {success} transactions!")
                    if errors:
                        st.warning(f"⚠️ {errors} failed.")
                    if not is_credit_import:
                        net = sum(float(t.get("amount", 0)) for t in edited)
                        current_balance = float(selected_acc.get("balance", 0))
                        new_balance = round(current_balance + net, 2)
                        patch_result = patch_account(acc_id, {"balance": new_balance})
                        if patch_result and patch_result.status_code in [200, 201]:
                            st.info(f"💰 Account balance automatically updated: CAD$ {fmt(new_balance,'CAD')}")
                        st.session_state["reconcile_acc_id"] = acc_id
                        st.session_state["reconcile_new_balance"] = new_balance
                    del st.session_state["analyzed"]
                    st.rerun()
            with col2:
                if st.button("🗑️ Clear and start over"):
                    del st.session_state["analyzed"]
                    st.rerun()